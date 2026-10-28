// transport 加固护栏(2026-10-12):回声失败的拥塞豁免 —— 风暴窗内的 timeout/crc_dead
// 不得判掉线;真掉线路径(无近期风暴)保持原样。依据:对局 console.log 洪峰实证
// (bridge.log 2026-10-12 17:03-17:12):回声 1 帧卡在 STORM 里 8s 死线先到
// (17:09:36 连败 -> STORM enter -> 17:09:42 REQ_TIMEOUT),桥侧 REQ 32/32 全收到、
// TRQ 11/11 全成功 —— 拥塞误判为掉线会级联 grace 过期 -> canHttp 复位 ->
// 死通道 nav 重探测刷屏(现场 diag-nav / "panel dead" 实证)。
//
// 违反任一即红:
//   ① 状态钉:State 声明 btipcLastStormAt,且 STORM enter 块盖时间戳;
//   ② 判断钉:回声 catch 内拥塞豁免(kind=timeout/crc_dead + 风暴窗)先于 onBridgeDown,
//      豁免分支 return 不落判红;常量窗须覆盖回声死线(8s);
//   ③ 底线钉:8s 死线不被拉长(早释放单槽给排队翻译),真掉线仍 log + onBridgeDown。
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat.js"), "utf8") +
  // 2026-10-28:STORM 状态机与豁免窗常量随 BTIPC 传输层拆出 —— 读拼接源,断言语义不变
  "\n" + fs.readFileSync(path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat_btipc.js"), "utf8");

test("T1-① 状态钉:btipcLastStormAt 声明 + STORM enter 盖时间戳", () => {
  assert.ok(/btipcLastStormAt:\s*0/.test(SRC), "State 缺 btipcLastStormAt 字段声明");
  const iEnter = SRC.indexOf("if (st.consecutiveFails >= BTIPC_STORM_TRIGGER");
  assert.ok(iEnter !== -1, "缺 STORM enter 判定块");
  const block = SRC.slice(iEnter, iEnter + 400);
  // 2026-10-28 拆分后 STORM enter 块在 lingua_chat_btipc.js,宿主依赖带 D. 前缀(注入的 State/nowMs)
  assert.ok(/(?:D\.)?State\.btipcLastStormAt = (?:D\.)?nowMs\(\)/.test(block),
    "STORM enter 块未盖拥塞时间戳(回声豁免将永远不生效)");
});

test("T1-② 判断钉:拥塞豁免先于 onBridgeDown,豁免分支 return;窗覆盖回声死线", () => {
  const iEcho = SRC.indexOf('text: "health", translate: false, timeoutMs:');
  assert.ok(iEcho !== -1, "缺回声请求点");
  const slice = SRC.slice(iEcho, iEcho + 1800);
  const iGuard = slice.indexOf('kind === "timeout"');
  const iGuard2 = slice.indexOf('kind === "crc_dead"');
  const iDown = slice.indexOf("onBridgeDown()");
  assert.ok(iGuard !== -1, "缺 timeout 拥塞豁免判断");
  assert.ok(iGuard2 !== -1, "缺 crc_dead 拥塞豁免判断(持续风暴同帧累计 fail 超限同理)");
  assert.ok(iDown !== -1, "catch 缺 onBridgeDown 真掉线路径");
  assert.ok(iGuard < iDown, "拥塞豁免必须排在 onBridgeDown 之前");
  assert.ok(/State\.btipcLastStormAt && nowMs\(\) - State\.btipcLastStormAt <= BTIPC_ECHO_STORM_WINDOW_MS/.test(slice),
    "豁免须以 btipcLastStormAt 风暴窗为判据");
  assert.ok(/during congestion \(recent storm\), not treated as down/.test(slice),
    "缺拥塞专用日志(判红豁免须可观测)");
  // 豁免分支体必须在落判红之前 return
  const iRet = slice.slice(0, iDown).lastIndexOf("return;");
  assert.ok(iRet > iGuard, "豁免分支未 return,仍会落 onBridgeDown");
  // 窗常量须 >= 回声死线 8000,否则豁免窗盖不住一次完整回声在途期
  const mWin = SRC.match(/BTIPC_ECHO_STORM_WINDOW_MS = (\d+)/);
  const mEcho = SRC.match(/text: "health", translate: false, timeoutMs: (\d+)/);
  assert.ok(mWin, "缺 BTIPC_ECHO_STORM_WINDOW_MS 常量");
  assert.ok(mEcho, "缺回声 timeoutMs");
  assert.ok(+mWin[1] >= +mEcho[1],
    "豁免窗 " + mWin[1] + " < 回声死线 " + mEcho[1] + ",盖不住在途期");
});

test("T1-③ 底线钉:回声死线仍 8s;真掉线(无近期风暴)仍判红", () => {
  const mEcho = SRC.match(/text: "health", translate: false, timeoutMs: (\d+)/);
  assert.strictEqual(+mEcho[1], 8000,
    "回声死线被改动(8000ms 是单槽占用上限设计值:拉长会让排队翻译更易烧完 12s 预算掉死通道)");
  const iEcho = SRC.indexOf('text: "health", translate: false, timeoutMs:');
  const slice = SRC.slice(iEcho, iEcho + 1800);
  const iPlainLog = slice.indexOf('log("btipc health echo FAIL kind=" + kind);');
  const iDownReal = slice.lastIndexOf("onBridgeDown()");
  assert.ok(iPlainLog !== -1, "真掉线 FAIL 日志丢失(降噪不得吞掉原判红日志)");
  assert.ok(iDownReal > iPlainLog, "onBridgeDown 必须在真掉线日志之后(豁免分支只动早返回,不动原路径)");
});
