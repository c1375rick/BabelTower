// 回归护栏:https 面板通道的降级纪律(2026-10-15)。
//
// 这条通道是"有则用、无则退 BTIPC"的增量优化,不是替换。护栏要防的是**后人
// 顺手把它改成必选**,或者把降级路径改坏 —— 那两种都会让没信任证书的用户直接失去
// 翻译功能,而症状是"游戏里没译文",现场极难归因(桥日志一切正常)。
//
// 钉死的七件事:
//   1. 探针门控:通道只在开机探针判活(State.httpsPanelOk === true)后才被使用,
//      判死则全程 BTIPC —— 证书未信任的用户连一次都不试,体感与上线前完全一致。
//   2. 失败分类:只有「通道压根没通」的硬失败才交回 BTIPC;翻译慢之类的软失败
//      不交回(否则出站请求已经被等了 20s,再拖 3~27s 位泵是净损失)。
//   3. 降级交接不消耗 job.attempts(它不是翻译失败,不该扣重试)。
//   4. 交接前必须撤掉面板路径挂的出站超时句柄,否则二次结算会击穿
//      MAX_ACTIVE_REQUESTS=1 的单槽(0.1.3「发中文卡死」事故的同款机制)。
//   5. 连击到线才降级(HTTPS_PANEL_DEAD_STREAK ≥ 2),偶发抖动不误杀;降级后本会话不再试。
//   6. 兜底不丢原文:BTIPC 恰好接不下(busy/too_long)时退回 http 面板,而不是直接发原文。
//   7. 冻结面零侵入:本特性不得写进 core/btipc/*(BTIPC 必须原样可用)。
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat.js"), "utf8");
const HTTPS_SRV = path.join(ROOT, "core", "bridge_https.js");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  [" + extra + "]" : "")); }
}

// ---------- 1. 常量 ----------
const enabledM = SRC.match(/const HTTPS_PANEL_ENABLED = (true|false)/);
check("总开关 HTTPS_PANEL_ENABLED 是布尔字面量(不得写成表达式,现场排障要能一眼改)",
  !!enabledM, enabledM ? "" : "缺失");
check("总开关默认开启(本通道是默认主路)", !!enabledM && enabledM[1] === "true",
  enabledM ? "got=" + enabledM[1] : "");
const streakM = SRC.match(/const HTTPS_PANEL_DEAD_STREAK = (\d+)/);
check("降级连击门槛 ≥2(一次抖动就永久退通道是过激)", !!streakM && Number(streakM[1]) >= 2,
  streakM ? "got=" + streakM[1] : "缺失");
const portM = SRC.match(/const HTTPS_PANEL_PORT = (\d+)/);
check("客户端端口是字面量", !!portM, portM ? "" : "缺失");

// 客户端端口必须与桥侧 TLS 终结进程的默认端口一致 —— 两边各写各的默认值是
// "面板一直判死、却看不出为什么"的经典成因。
const srvPortM = fs.readFileSync(HTTPS_SRV, "utf8")
  .match(/BABEL_TOWER_HTTPS_PORT \|\| (\d+)/);
check("客户端端口与 bridge_https.js 默认端口一致",
  !!portM && !!srvPortM && Number(portM[1]) === Number(srvPortM[1]),
  "client=" + (portM && portM[1]) + " server=" + (srvPortM && srvPortM[1]));

// ---------- 2. 探针门控(护栏第 1 条)----------
check("State 有 httpsPanelOk 三态字段(null=未探)",
  /httpsPanelOk: null/.test(SRC));
const takesSrc = (SRC.match(/function httpsPanelTakes\(job\) \{[\s\S]*?\n  \}/) || [])[0] || "";
check("httpsPanelTakes 已定义", !!takesSrc);
check("取用前必须判活(httpsPanelOk !== true 一律不取)",
  /State\.httpsPanelOk !== true\) return false/.test(takesSrc), takesSrc.slice(0, 120));
check("只接管 outgoing/chat 两条翻译路径(不抢 config/test/log 的既有稳定通道)",
  /job\.kind === "outgoing" \|\| job\.kind === "chat"/.test(takesSrc));
check("总开关为 false 时直接不取(现场排障的旁路开关真实有效)",
  /if \(!HTTPS_PANEL_ENABLED\) return false/.test(takesSrc));
check("boot 里排了开机探针", /\$\.Schedule\(1\.2, maybeProbeHttpsPanel\)/.test(SRC));
check("探针门控三纪律:通道健康早退 / 硬判死(连击到线)不自动重探 / 偶发判死按 REPROBE_MS 节流重探",
  /function maybeProbeHttpsPanel\(\) \{[\s\S]*?State\.httpsPanelOk === true\) return;[\s\S]*?State\.httpsPanelHardDead\) return;[\s\S]*?HTTPS_PANEL_REPROBE_MS\) return;/.test(SRC));
check("判死后自动重探的节流常量存在(2026-10-28:一次偶发 nav 失败不再锁死整场)",
  /const HTTPS_PANEL_REPROBE_MS = \d+/.test(SRC));

// ---------- 3. 失败分类(护栏第 2 条)----------
check("硬失败表存在", /const PANEL_HARD_FAIL = \{[\s\S]*?\};/.test(SRC));
const hardTbl = (SRC.match(/const PANEL_HARD_FAIL = \{[\s\S]*?\};/) || [])[0] || "";
for (const code of ["bridge_nav_failed", "bridge_offline", "bridge_load_failed", "bridge_panel_unavailable"]) {
  check("硬失败含 " + code, hardTbl.indexOf(code) !== -1);
}
check("软失败不在硬失败表里(timeout 类不交回 BTIPC)",
  hardTbl.indexOf("bridge_timeout") === -1 && hardTbl.indexOf("timeout:") === -1);

// 行为校验:把 isPanelHardFail 抽到沙箱真跑一遍(与 lc_panel_nav_guard 同一手法)。
const fnSrc = (SRC.match(/function isPanelHardFail\(payload\) \{[\s\S]*?\n  \}/) || [])[0] || "";
check("抽到 isPanelHardFail 源码", !!fnSrc);
if (fnSrc && hardTbl) {
  // 注意只取对象字面量本身:`const PANEL_HARD_FAIL = {...};` 整句塞进括号是非法表达式。
  const tblObj = (hardTbl.match(/=\s*(\{[\s\S]*?\})/) || [])[1] || "";
  let run = null;
  try {
    run = new Function("PANEL_HARD_FAIL", "return (" + fnSrc + ");")(eval("(" + tblObj + ")"));
  } catch (e) {
    check("isPanelHardFail 可在沙箱内求值", false, e && e.message ? e.message : String(e));
  }
  if (run) {
    check("沙箱求值成功", true);
    check("硬失败判定:bridge_nav_failed 命中", run({ ok: false, error: "bridge_nav_failed" }) === true);
    check("硬失败判定:bridge_offline 命中", run({ ok: false, error: "bridge_offline" }) === true);
    check("软失败判定:bridge_timeout 不命中", run({ ok: false, error: "bridge_timeout" }) === false);
    check("软失败判定:timeout 不命中", run({ ok: false, error: "timeout" }) === false);
    check("成功应答不命中", run({ ok: true, translation: "x" }) === false);
    check("null/空 payload 不命中(不得抛)", run(null) === false && run(undefined) === false);
  }
}
// 交接点必须真的按这个分类过滤,而不是无条件交回
check("setPending 回调按分类过滤后才交接",
  /if \(isPanelHardFail\(payload\) && handOff\(hooks, payload\)\) return;/.test(SRC));

// ---------- 4. 降级交接的卫生(护栏第 3、4 条)----------
const demoteSrc = (SRC.match(/function demoteToBtipc\(job\) \{[\s\S]*?\n  \}/) || [])[0] || "";
check("demoteToBtipc 已定义", !!demoteSrc);
check("交接前撤掉出站超时句柄(否则二次结算击穿单槽)",
  /cancelSched\(job\._timeout\); job\._timeout = null/.test(demoteSrc));
check("已超时的出站 job 不再交接(别把用户的等待再翻一倍)",
  /if \(job\._timedOut\) return false/.test(demoteSrc));
check("连击到线才置死(门槛来自常量而非硬编码)",
  /State\.httpsPanelStreak < HTTPS_PANEL_DEAD_STREAK/.test(demoteSrc));
check("降级后本会话不再使用该通道",
  /State\.httpsPanelOk = false/.test(demoteSrc));
check("降级只告警一次(避免每请求刷屏)",
  /if \(!State\.httpsPanelDemotedLogged\)/.test(demoteSrc));
check("交接不消耗 attempts(不是翻译失败,不该扣重试)",
  !/attempts\s*[-+]=\s*1/.test(demoteSrc) && !/attempts\s*[-+]=\s*1/.test(
    (SRC.match(/function handToBtipc\(job\) \{[\s\S]*?\n  \}/) || [])[0] || ""),
  "出现了 attempts 的加减就会把重试预算吃掉一次");

// ---------- 5. 兜底链完整(护栏第 5、6 条)----------
const handSrc = (SRC.match(/function handToBtipc\(job\) \{[\s\S]*?\n  \}/) || [])[0] || "";
check("handToBtipc 已定义", !!handSrc);
check("BTIPC 仍是兜底第一选择", /outgoingViaBtipc\(job\)/.test(handSrc));
check("BTIPC 接不下时退回 http 面板(不是直接发原文)",
  /dispatchViaPanel\(job, null, true\)/.test(handSrc));
check("dispatchJob 里的 BTIPC 主路仍在(降级后必须有路可走)",
  /if \(viaBtipc && outgoingViaBtipc\(job\)\) return;/.test(SRC));
check("BTIPC 位泵常量仍在(兜底路径的节拍没被动过)",
  /const BTIPC_T_CLOSE_MS = \d+/.test(SRC) && /BTIPC_STORM_TCLOSE_MS/.test(SRC));

// ---------- 6. 冻结面零侵入(护栏第 7 条)----------
const btipcDir = path.join(ROOT, "core", "btipc");
let btipcFiles = [];
try { btipcFiles = fs.readdirSync(btipcDir).filter((f) => f.endsWith(".js")); } catch (e) {}
check("core/btipc 目录可读", btipcFiles.length > 0, "files=" + btipcFiles.length);
let intruders = [];
for (const f of btipcFiles) {
  const body = fs.readFileSync(path.join(btipcDir, f), "utf8");
  if (/HTTPS_PANEL|httpsPanel|bridge_https/.test(body)) intruders.push(f);
}
check("冻结面零侵入:core/btipc/* 不得含本特性任何痕迹",
  intruders.length === 0, intruders.join(", "));

// ---------- 7. 桥侧独立进程 ----------
check("TLS 终结是独立进程(证书出问题不得连带 BTIPC 一起死)",
  fs.existsSync(HTTPS_SRV));
const httpsSrv = fs.existsSync(HTTPS_SRV) ? fs.readFileSync(HTTPS_SRV, "utf8") : "";
check("bridge_https 只监听回环(不对外暴露面)",
  /"127\.0\.0\.1"/.test(httpsSrv) && /"::1"/.test(httpsSrv) && httpsSrv.indexOf("0.0.0.0") === -1);
check("证书缺失以退出码 3 退出(启动器据此跳过,不视为故障)",
  /process\.exit\(3\)/.test(httpsSrv));
check("上游不通返回 502 且不退出(桥起来即自愈)",
  /502/.test(httpsSrv) && httpsSrv.indexOf("process.exit(0)") === -1);

// ---------- 7.1 Origin 白名单(2026-10-15 实机 bug 的钉死)----------
// 实机症状:通道转正(https panel: ALIVE)、页面确实 fetch 了,但桥自己的 B1 跨站闸
// 把 `Origin: https://localhost:8792` 挡掉 → 游戏侧报 "翻译不可用,发原文"。
// 单测里页面从不真发 Origin,所以只有端到端实跑能暴露;这里把它钉成断言。
const bs = fs.readFileSync(path.join(ROOT, "core", "bridge_server.js"), "utf8");
const bsCode = bs.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join("\n");
check("桥的 Origin 白名单含 https 回环源(面板页面的来源)",
  /isLocalOrigin/.test(bs) && /https:\/\/"\s*\+\s*h\s*\+\s*":"/.test(bs) &&
  /PANEL_HTTPS_PORT/.test(bs),
  "缺了就复现 2026-10-15:通道 ALIVE 但 B1 blocked reason=origin:https://localhost:8792");
check("白名单只收回环地址(不放宽成任意源)",
  /const hosts = \["127\.0\.0\.1", "localhost", "\[::1\]"\]/.test(bs));
check("https 端口与 bridge_https.js 一致(同一 env + 同一默认值)",
  /BABEL_TOWER_HTTPS_PORT \|\| 8792/.test(bs) && /BABEL_TOWER_HTTPS_PORT \|\| 8792/.test(httpsSrv),
  "两边默认端口漂移 = 白名单放行不存在的源,同时真源被挡");
check("白名单在 PORT 定义之后求值(否则桥启动即崩)",
  !/const LOCAL_ORIGINS = localOrigins\(\)/.test(bs),
  "模块级常量在 PORT 初始化前求值 → ReferenceError: Cannot access 'PORT' before initialization");
// 行为校验:把 isLocalOrigin 抽到沙箱真跑
const isLocSrc = (bs.match(/function isLocalOrigin\(o\) \{[\s\S]*?\n\}/) || [])[0] || "";
const localOriginsSrc = (bs.match(/function localOrigins\(\) \{[\s\S]*?\n\}/) || [])[0] || "";
check("抽到 localOrigins / isLocalOrigin 源码", !!isLocSrc && !!localOriginsSrc);
if (isLocSrc && localOriginsSrc) {
  let fn = null;
  try {
    fn = new Function("PORT", "PANEL_HTTPS_PORT",
      localOriginsSrc + "\n" + isLocSrc + "\nreturn isLocalOrigin;")(8791, 8792);
  } catch (e) {
    check("白名单函数可在沙箱求值", false, e && e.message ? e.message : String(e));
  }
  if (fn) {
    for (const o of ["https://localhost:8792", "https://127.0.0.1:8792", "https://[::1]:8792",
      "http://127.0.0.1:8791", "http://localhost:8791", "http://[::1]:8791"]) {
      check("放行本机源 " + o, fn(o) === true, "面板页面正是这个 Origin,挡了就没翻译");
    }
    for (const o of ["https://evil.example", "http://evil.example",
      "https://localhost:9999", "http://127.0.0.1:8792", "https://127.0.0.1:8791", ""]) {
      check("拒绝非本机源 " + (o || "(空)"), fn(o) === false, "跨站闸被放宽 = 任意网页能驱动本地桥");
    }
  }
}

// ---------- 7.2 翻译慢的可观测性与回退(2026-10-15 实机)----------
// 实机症状:面板通道已转正(https panel: ALIVE),翻译却慢 8 秒。日志里没有任何解释。
// 根因:bing 命中 429 后在 provider 内部睡 "1s→2s→4s"(共 7 秒),而它的限流提示走
// console.log —— 桥是隐藏窗口启动、stdout 没人接,提示全部蒸发。8 秒只能靠读源码反推。
// 于是钉死三条:① 限流快速失败、把机会让给回退链;② provider 的 console 诊断必须进日志;
// ③ 回退链的"是否需要 Key"由 provider 自己声明(原来硬编码 pid!=="bing",误跳过 google)。
const bing = fs.readFileSync(path.join(ROOT, "core", "providers", "bing.js"), "utf8");
check("bing 声明自己免 Key(回退链据此判定)",
  /requiresKey:\s*false/.test(bing));
check("bing 429 快速失败,不在 provider 内部睡 7 秒",
  /retry < 1/.test(bing) && !/retry < 3/.test(bing) && !/1000 \* Math\.pow/.test(bing),
  "1s→2s→4s 的指数退避会把回退链一起饿死");
check("bing 429 抛错带 rateLimited 标记(桥据此走回退)",
  /err\.rateLimited = true/.test(bing) && /err\.status = 429/.test(bing));
check("console.* 捕获已装(否则 provider 诊断永远看不见)",
  /function captureConsoleToLog\(\)/.test(bsCode) && /console\[level\] = function/.test(bsCode));
check("捕获有防双写闸(log 自己已落盘,不能再写一遍)",
  /_capSuppress = true/.test(bsCode) && /if \(_capSuppress\) return;/.test(bsCode));
check("捕获带自证标记(启动后日志里能看到 console.log 行 = 装上了)",
  /console capture active/.test(bsCode));
check("回退链用 provider 自己声明的 requiresKey,不再硬编码 bing",
  /fb\.requiresKey !== false && !fc\.apiKey/.test(bsCode) &&
  !/pid !== "bing" && !fc\.apiKey/.test(bsCode),
  "硬编码会让同为免 Key 的 google 被误跳过");
// 免 Key 的两个 provider 都必须声明 false,否则回退链形同虚设
for (const p of ["bing", "google"]) {
  const src = fs.readFileSync(path.join(ROOT, "core", "providers", p + ".js"), "utf8");
  check(p + " 声明 requiresKey: false", /requiresKey:\s*false/.test(src));
}
for (const p of ["microsoft", "deepl", "openai"]) {
  const src = fs.readFileSync(path.join(ROOT, "core", "providers", p + ".js"), "utf8");
  check(p + " 声明 requiresKey: true", /requiresKey:\s*true/.test(src));
}

// ---------- 7.3 证书信任的取证能力(2026-10-15 对照实验逼出来的)----------
// 实机经过:撤销证书信任但**不重启 Steam**,游戏仍报 ALIVE,curl 却返回 000 ——
// 同一张证书、同一个时刻,两种结论。要判"游戏到底校不校验证书",必须有三样东西:
//   ① https 进程**把被拒的握手记下来**(含具体 TLS 告警码);
//   ② 8891 那侧不能反推"请求是否走了 https"——它同时接 http 面板与 BTIPC,三条路混在一起;
//   ③ 两个日志文件**时区一致**,否则跨文件对时序会把一次拒绝误判成 8 小时前的事。
// 缺任何一样,那天就只能靠猜,而"游戏根本不校验证书"这个错误结论看起来同样自洽。
check("https 进程用本地时间,不用 toISOString(UTC)(跨文件对时序的前提)",
  /function localTimestamp\(\)/.test(httpsSrv) &&
  !/new Date\(\)\.toISOString\(\)/.test(httpsSrv),
  "bridge.log 用本地时,bridge_https.log 若用 UTC 会差 8 小时(UTC+8)");
check("https 进程把本地时戳格式与 bridge_server 对齐(补零到两位)",
  /pad2\(d\.getHours\(\)\)/.test(httpsSrv) && /pad2\(d\.getMonth\(\) \+ 1\)/.test(httpsSrv));
check("https 进程记录**成功进来的请求**(原来只记失败,取证靠猜)",
  /经 https 面板通道进来/.test(httpsSrv),
  "否则无法判断某条请求是否真的走了 TLS");
check("成功请求日志明确标注它**不证明证书被信任**(带 -k 的 curl 也会进来)",
  /经 https 面板通道进来/.test(httpsSrv) &&
  /不证明|只证明|不证明证书被信任|带 `-k`/.test(
    fs.readFileSync(path.join(ROOT, "docs", "btipc-https-v1.md"), "utf8")),
  "排障表里必须写清这条日志的边界,否则会被当成信任凭证");
// 证书未受信时游戏侧的判据文案必须指向真因(重启 Steam),而不是泛泛的"再跑一次脚本"
check("未受信判据文案含\"完全重启 Steam\"(撤销信任同样要重启,2026-10-15 实测)",
  /FULLY restart Steam|完全退出.{0,4}重启 Steam|完全重启 Steam/.test(
    fs.readFileSync(path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat.js"), "utf8")));

// ---------- 7.4 设置面板保存也走本通道(2026-10-15 用户实机反馈)----------
// 症状:"OpenAI 的 API 老是保存不上,要反复好几次才行"。
// 根因是纯算术:带 Key 的保存载荷 ≈600B,位泵每帧有效 10B → 约 61 帧 ×600ms + 首发起跑
// 1200ms ≈ **38 秒**;而写死线只有 8 秒 —— 死线当初是按**应答**(1 帧 ≈3s)定的,
// 没算上行请求本身要 61 帧 → 必然 REQ_TIMEOUT → 面板显示「保存失败」。
// 实测模型与日志逐条吻合(47B/5帧=4210ms、110B/11帧=7821ms、406B/41帧=26105ms)。
// 这条护栏钉的是"保存必须优先走面板通道",钉不住死线数字(死线属于 BTIPC 兜底,归 lc_btipc_guard)。
const lcSrc2 = fs.readFileSync(path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat.js"), "utf8");
const takesM = lcSrc2.match(/function httpsPanelTakes\(job\) \{[\s\S]*?\n  \}/);
check("抽到 httpsPanelTakes 源码", !!takesM);
const takes = takesM ? takesM[0] : "";
check("保存/读取走本通道(job.kind === \"bridge\" 也接)",
  /job\.kind === "bridge"\) return true/.test(takes),
  "否则带 Key 的保存会继续在位泵上跑 38 秒,而死线只有 8 秒");
check("通道未判活时仍不放行(探针门控对 bridge op 同样成立)",
  /if \(State\.httpsPanelOk !== true\) return false;[\s\S]*job\.kind === "bridge"/.test(takes) ||
  /State\.httpsPanelOk !== true[\s\S]{0,400}job\.kind === "bridge"/.test(takes),
  "先探针后使用是本通道第 1 条纪律,不能因为加了 bridge op 就绕过");
check("总开关仍能一键全量退回 BTIPC",
  /if \(!HTTPS_PANEL_ENABLED\) return false;/.test(takes));
check("bridge op 判死时原样交回 BTIPC(兜底语义与翻译路径一致)",
  /onHardFail: function \(\) \{ return demoteToBtipc\(job\); \}/.test(lcSrc2));
// 打码:URL 会带整份 JSON(含 Key),两处日志(key 会经 URL 过一遍)都不许只靠截断保安全
check("URL 日志对 d= 打码,且不是靠截断长度",
  /redactUrl/.test(httpsSrv) && /d=<redacted /.test(httpsSrv) &&
  /navM = navQ\.match\(\/\[\?&\]d=\/\)/.test(lcSrc2),
  "Key 落在第 ~132 字符而日志取 96 —— 看似安全,但那是算术余量,不是防线");

// ---------- 8. 自启覆盖 https 进程(2026-10-16 实车)----------
// 症状:夜间机器/进程重启后只有 bridge_server 被拉起(自启 vbs 里没写 https),
// 8792 无监听 → 开机探针判死 → 全天退回 BTIPC(08:47 实车:同步 35s、四连存
// 每次 7~17s)。降级本身是对的,但 https 形同没装,快路一项都测不到。
// 钉死:自启模板与已生成的 vbs 都必须拉起 bridge_https.js(缺证书它 exit(3)
// 自退、无影响;老包无此文件则跳过)。vbs 必须纯 ASCII(WSH 读 UTF-8 无 BOM
// 会逐字节误读,中文路径直接乱码,见 autostart.ps1 头部 80070002 教训)。
const AUTO_PS1 = fs.readFileSync(path.join(ROOT, "scripts", "autostart.ps1"), "utf8");
const AUTO_VBS = fs.readFileSync(path.join(ROOT, "scripts", "babel_bridge_autostart.vbs"), "utf8");
check("自启模板拉起 bridge_https(只起 server 会丢 8792)",
  /https = root & "\\core\\bridge_https\.js"/.test(AUTO_PS1) &&
  /If fso\.FileExists\(https\) Then/.test(AUTO_PS1));
check("已生成的 vbs 与模板一致(也拉起 https,不只 server)",
  /https = root & "\\core\\bridge_https\.js"/.test(AUTO_VBS) &&
  /If fso\.FileExists\(https\) Then/.test(AUTO_VBS) &&
  /server = root & "\\core\\bridge_server\.js"/.test(AUTO_VBS),
  "模板改了不重生成 vbs = 线上跑的还是旧自启");
check("vbs 保持纯 ASCII(非 ASCII 会被 WSH 误读)",
  !/[^\x00-\x7F]/.test(AUTO_VBS));

console.log("  RESULT: PASS " + pass + " / FAIL " + fail);
process.exit(fail === 0 ? 0 : 1);