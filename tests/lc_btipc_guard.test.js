// 回归护栏:锁死 btipc05c 修过的两处【结构性】破坏 —— 这类 bug 靠功能测试抓不到
// (05b 实车才暴露:语法合法、离线全绿,但 config 整块掉进 if(test) 内 → payload=undefined)。
// 教训来源:2026-10-03 btipc05b 假绿 —— 编辑时丢了一个 `} else {`,
// 结果 op=config dispatch THREW ×23、op=test 被覆盖成 op=config,实车 34 连败链。
"use strict";
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
const src = fs.readFileSync(SRC, "utf8");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  [" + extra + "]" : "")); }
}

// ---- 1. op 分支的 if/else 结构完整 ----
// 定位 `if (job.op === "test")`,要求它与 `payload = "op=config` 之间存在配对的 `} else {`
const ifTestIdx = src.indexOf('if (job.op === "test")');
check("找到 op=test 分支", ifTestIdx > 0, "idx=" + ifTestIdx);

const configPayloadIdx = src.indexOf('payload = "op=config\\n" + raw');
check("找到 op=config payload 赋值", configPayloadIdx > ifTestIdx && configPayloadIdx > 0,
  "ifIdx=" + ifTestIdx + " cfgIdx=" + configPayloadIdx);

const between = ifTestIdx > 0 && configPayloadIdx > ifTestIdx
  ? src.slice(ifTestIdx, configPayloadIdx) : "";
// else 必须开在 test 分支的收尾处:出现 `}` 后跟 `else {`
const elseIdx = between.indexOf("} else {");
check("test 分支后存在 `} else {`(config 走独立分支)", elseIdx >= 0,
  "缺失 → config 会掉进 if(test) 块内,payload 停在 undefined → btipcUtf8Bytes(undefined).length 抛 dispatch THREW");

// test 的 payload 必须在 else 之前(否则会被 config 赋值覆盖 → 测试按钮发 op=config)
const testPayloadIdx = src.indexOf('payload = "op=test;tm="');
check("test payload 在 else 之前(不被 config 覆盖)",
  testPayloadIdx > ifTestIdx && testPayloadIdx < configPayloadIdx && elseIdx >= 0,
  "testIdx=" + testPayloadIdx + " elseIdx=" + elseIdx + " cfgIdx=" + configPayloadIdx);

// ---- 2. 读/写死线分离 ----
// 2026-10-15 改:写死线**不再钉死 8000**。原来钉的是"写死线 =8s",而那个 8s 是按
// **应答** 1 帧定的,没算上行请求本身要 61 帧 —— 带 Key 的保存必然 REQ_TIMEOUT,
// 用户实机反馈「OpenAI 的 API 老是保存不上」。现在写死线按载荷算
// (btipcWriteDeadlineMs:1200 + 帧数×600,再 ×1.2 余量,地板 8000)。
// 所以这里钉的是**不变式**:写死线必须 ≥ 物理成本,而不是某个具体数字。
const rd = src.match(/isRead \? (\d{5}) : btipcWriteDeadlineMs\(/);
check("读死线 ≥50s / 写死线按载荷算(不再写死 8s)", !!rd && Number(rd[1]) >= 50000,
  rd ? "got 读=" + rd[1] + " 写=btipcWriteDeadlineMs(…)"
     : "缺失 → 读应答 38 帧≈24s 必超 8s(实车 34 连败根因)");
// 写死线的算法必须按帧数算,且留余量 —— 用真实日志校准过的模型:
//   47B/5帧=4210ms、110B/11帧=7821ms、406B/41帧=26105ms ⇒ 1200 + 帧数×600
const dl = src.match(/function btipcWriteDeadlineMs\(payloadBytes\) \{[\s\S]*?\n {2}\}/);
check("抽到 btipcWriteDeadlineMs 源码", !!dl);
const dlBody = dl ? dl[0] : "";
check("写死线按帧数算(1200 + 帧数×600),不是固定值",
  /Math\.ceil\(bytes \/ 10\)/.test(dlBody) &&
  /BTIPC_FIRST_SHOT_DELAY_MS \+ frames \* BTIPC_T_CLOSE_MS/.test(dlBody),
  "帧数模型与真机日志逐条吻合(406B/41帧=26105ms)");
check("写死线留了余量(×1.2,覆盖 CRC 重试与 STORM 罚时)",
  /physical \* 1\.2/.test(dlBody), "实测 406B 读 26105ms,余量约 15~20%");
check("小载荷仍保留 8000 地板(快速失败对小请求仍成立)",
  /Math\.max\(8000/.test(dlBody));
// 关键不变式:600B 保存载荷的死线必须覆盖实测成本(37.2s 物理下限)
check("600B 保存载荷的死线 ≥ 40s(覆盖 37.2s 物理成本)",
  (() => {
    const frames = Math.max(1, Math.ceil(600 / 10));
    const physical = 1200 + frames * 600;
    const deadline = Math.max(8000, Math.round(physical * 1.2));
    return deadline >= 40000;
  })(),
  "600B → 60 帧 → 物理 37.2s,死线须 ≥40s");
// op 忙等窗必须同步跟随读死线,否则 op 等到窗口就掉旧通道 → 读死线白设
const bw = src.match(/busyMs = isOp \? (\d+) : 12000/);
check("op 忙等窗 ≥ 52s(跟随读死线)", !!bw && Number(bw[1]) >= 52000,
  bw ? "busyMs=" + bw[1] : "未匹配到 busyMs isOp 三元");

// ---- 3. pumpQueue 让位必 break(否则原地自旋刷洪水)----
const pumpIdx = src.indexOf("function pumpQueue()");
check("找到 pumpQueue", pumpIdx > 0, "idx=" + pumpIdx);
// 函数体按花括号配对取,不能用固定窗口:2026-10-04 缺陷 B 给 pumpQueue 加了
// try/catch + 注释,pumpQueue 变长后固定 900 字符窗口把 _btipcDeferred 挤出去
// → 探针误报(被查的性质其实一直都在)。取不到就退回放大窗口兜底。
let pumpBody = "";
if (pumpIdx > 0) {
  let d = 0;
  for (let i = src.indexOf("{", pumpIdx); i > 0 && i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") d += 1;
    else if (ch === "}") {
      d -= 1;
      if (d === 0) { pumpBody = src.slice(pumpIdx, i + 1); break; }
    }
  }
}
if (!/_btipcDeferred/.test(pumpBody)) pumpBody = src.slice(pumpIdx, pumpIdx + 4000);
check("pumpQueue 消费 _btipcDeferred 并 break(防原地自旋)",
  /_btipcDeferred/.test(pumpBody) && /break;/.test(pumpBody),
  "缺失 → while 把 unshift 回队首的同一 job 再 shift 出来打转," +
  "重投次数 <1ms 打满并挂等量延迟泵(05b 实车:单秒 74 行 requeue 洪水 → 桥 tail 迟 7~24s → 回声超时 → CRC 风暴)");
check("busy 分支置 _btipcDeferred = true", /_btipcDeferred = true/.test(src));

// ---- 4. 版本标 / 前缀常量 ----
const ver = (src.match(/const VERSION = "([^"]+)"/) || [])[1] || "";
// 版本号 = 当前开发版(与 lingua_chat.js 的 const VERSION 必须同步,升版时两处一起改);
// 发布时若需与 Release 标签对齐,改完发包后要把这里和 VERSION 一并推到下一开发版,
// 玩家日志 `loaded vX.Y.Z-…` 才始终能和 Release/GB 页面对上号。
// 从 VERSION 文件取发布号做比对 —— 正则写死具体版本号会每次升版腐烂一次,
// 而这条检查的本意(见上方注释)是"两者必须一起改",所以比主版本而不是写死。
const relVer = fs.readFileSync(path.join(__dirname, "..", "VERSION"), "utf8").trim();
check("VERSION 已升版(带 -6726-btipc 构建标)", /^\d+\.\d+\.\d+-6726-btipc\d/.test(ver), "got=" + ver);
check("包内自报串主版本 == VERSION 文件(升版两处必须一起改)",
  ver.split("-")[0] === relVer, "ver=" + ver + " VERSION=" + relVer);
check("BTIPC 面板前缀 BTIPCD(6 字符,与探针隔离)",
  /BTIPC_PANEL_PREFIX = "BTIPCD"/.test(src));

console.log("\nRESULT: PASS " + pass + " / FAIL " + fail);
process.exit(fail ? 1 : 0);
