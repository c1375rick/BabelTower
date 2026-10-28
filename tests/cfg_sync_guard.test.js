// 离线测试:2026-10-16 配置同步三修护栏(启动门 / onBridgeAlive 加固 / 脏标记)
// 跑法: node tests/cfg_sync_guard.test.js
//
// 实车抓获:
//   ① boot t=0 直发同步只能走 BTIPC 位泵(25s+),窗口内开面板必见 bing;
//      pick → sync 落地拍回旧值(23:35、00:48 两次,用户被迫重选)。
//   ② 00:22 onBridgeAlive 内 syncViaBtipc 同步抛,同函数后续触发器全灭,
//      loading 标志卡死致本会话不再试。
//   ③ _mask 冻在启动时刻,LCTSave 不更新 —— 存完重开面板显示回旧值,
//      再点保存还会把旧值写回桥。
"use strict";
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS |", label); }
  else { fail++; console.log("  FAIL |", label); }
}

const LC = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
// 2026-10-28(任务②C-1):设置面板 UI(pick/toggle/cycle/save …)已拆到 lingua_chat_panel.js。
// 本测试的面板类断言按源码文本匹配,故与主文件拼接后统一读(与 lc_btipc_guard 的跨文件拼读同法);
// 主文件在前,aliveBody 的 indexOf 切片仍只落在主文件段内。
const PANEL = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat_panel.js");
const lc = fs.readFileSync(LC, "utf8") + "\n" + fs.readFileSync(PANEL, "utf8");
const aliveBody = lc.slice(lc.indexOf("function onBridgeAlive(src)"), lc.indexOf("function onBridgeDown()"));

console.log("--- 启动门(等探针定论,once) ---");
ok(/function startCfgSync\(\)/.test(lc), "startCfgSync 已定义");
ok(/State\.cfgSyncStarted = true;\s*\n\s*syncBridgeConfig\(\);/.test(lc), "启动门 once 后才调 syncBridgeConfig");
ok(/function waitProbeForSync\(\)/.test(lc), "waitProbeForSync 已定义");
ok(/State\.httpsPanelOk !== null/.test(lc), "探针定论才放行同步");
ok(/State\.cfgSyncWaitTries >= 8/.test(lc), "探针无定论有上限(走老路,不无限等)");
ok(/\$\.Schedule\(2\.0, waitProbeForSync\)/.test(lc), "boot 排了等探针轮询(不 t=0 直发)");
ok(!/initBakedGameNames\(\);[^\n]*\n\s*syncBridgeConfig\(\);/.test(lc), "boot 不再 t=0 直发 syncBridgeConfig");
ok(/startCfgSync\(\);/.test(aliveBody), "onBridgeAlive 经启动门补触发(不直调)");

console.log("--- onBridgeAlive 加固(分项 try/catch,标志复位) ---");
ok(/catch \(eG\) \{ State\.gamenamesLoading = false;/.test(aliveBody), "gamenames 抛了复位 loading(下次 echo 重试)");
ok(/catch \(eQ\) \{ State\.quickchatLoading = false;/.test(aliveBody), "quickchat 抛了复位 loading");
ok(/catch \(eH\) \{\s*\n\s*State\.healthDetailFetched = false;/.test(aliveBody), "health 明细抛了复位 fetched");
ok(/syncGameNames\(function \(\) \{ State\.gamenamesLoading = false; \}\)/.test(aliveBody), "gamenames 触发仍在");
ok(/syncQuickChat\(function \(\) \{ State\.quickchatLoading = false; \}\)/.test(aliveBody), "quickchat 触发仍在");
ok(/try \{\s*\n\s*bridgePost\("config", \{\}, function \(res\) \{/.test(lc), "trySync issued 加 try(不卡死 cfgSyncing)");
ok(/boot: config sync THREW/.test(lc), "同步抛有日志且按重试走");

console.log("--- 脏标记(窗口内 picks 不被拍回) ---");
ok(/function markCfgDirty\(key\)/.test(lc), "markCfgDirty 已定义");
ok(/function LCTPickProvider\(value\) \{\s*\n\s*State\.cfg\.provider = value;\s*\n\s*markCfgDirty\("provider"\);/.test(lc), "选服务商置脏");
ok(/markCfgDirty\(which\);\s*\n\s*saveUiConfig\(\);\s*\n\s*log\("toggle:/.test(lc), "toggle 置脏");
ok(/markCfgDirty\(which\);\s*\n\s*saveUiConfig\(\);\s*\n\s*log\("cycle:/.test(lc), "cycle 置脏");
ok(/markCfgDirty\(field\);\s*\n\s*saveUiConfig\(\);\s*\n\s*closeSelectMenus\(\);\s*\n\s*log\("pickLang:/.test(lc), "pickLang 置脏");
ok(/markCfgDirty\(field\);\s*\n\s*saveUiConfig\(\);\s*\n\s*closeSelectMenus\(\);\s*\n\s*log\("pickOption:/.test(lc), "pickOption 置脏");
ok((lc.match(/!dirty\.provider/g) || []).length >= 2, "sync 落地与 _mask 回填都跳过脏 provider(两处)");
ok(/!dirty\.translateOwn/.test(lc) && /!dirty\.chatLog/.test(lc), "顶层开关同样跳脏");
ok(/State\.cfgDirty = \{\};/.test(lc), "保存成功清零脏标记");
ok(/State\.cfg\._mask = null;/.test(lc), "保存成功作废旧 _mask(下次开面板快读)");

console.log("RESULT: PASS " + pass + " / FAIL " + fail);
process.exit(fail ? 1 : 0);
