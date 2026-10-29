// 一次性补丁:探针从独立槽(probePending)回归统一槽(State.pending)。
// 根因(10-29 23:55 实车):onBridgeEvent 收到 lct-alive 时 sawAlive 只写给
// State.pending——探针独立槽的 sawAlive 永远 false → 3s 必触发 nav 重试 →
// 重载页面杀死 fetch 响应 → 竞态恒失败。统一槽让事件/解析/超时全兼容。
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let t = fs.readFileSync(file, "utf8");
if (!t.includes("State.probePending")) { console.log("already unified (no probePending)"); process.exit(0); }

// ① State 字段:删 probePending/probeLastAt 定义
t = t.replace(/    probePending: null, [^\r\n]*\r?\n/, "");
t = t.replace(/    probeLastAt: 0, [^\r\n]*\r?\n/, "");

// ② startHttpsProbe:probePending → 统一 setPending 机制
const oldProbe = [
  "    ensureBridgeEvents();",
  "    // 顺序要紧:probePending 先落再启动轮询,否则 pollTitle 撞空槽提前停摆。",
  "    State.probePending = { sawAlive: false, navRetried: false, startedAt: nowMs(), navUrl: null };",
  "    startTitlePolling();",
].join("\r\n");
const newProbe = [
  "    ensureBridgeEvents();",
  "    // 2026-10-30 统一槽重构:探针回归 State.pending(与 job 同机制)——onBridgeEvent 的",
  "    // sawAlive/tryResolveFromText 结算只认 State.pending,独立槽导致 lct-alive 不被认、",
  "    // 3s 必触发重试、重载页面杀死 fetch 响应、竞态恒失败(10-29 23:55 实车)。",
  "    startTitlePolling();",
].join("\r\n");
if (!t.includes(oldProbe)) { console.error("probe anchor ① missing"); process.exit(1); }
t = t.replace(oldProbe, newProbe);

// ③ startHttpsProbe 的 SetURL catch:probePending → pending
t = t.replace("      settleProbe(false, \"seturl_threw(\" + expErr(e) + \")\");\r\n    }\r\n  }",
  "      settleProbe(false, \"seturl_threw(\" + expErr(e) + \")\");\r\n    }\r\n  }");
// SetURL 成功后的 pending 设置(原 startHttpsProbe 里 probePending.navUrl 之后的 setPending 逻辑)
const spOld = "    State.probePending.navUrl = probeUrl;\r\n    try {\r\n      panel.SetURL(probeUrl);\r\n      log(\"https panel: probing \" + probeUrl);\r\n    } catch (e) {\r\n      settleProbe(false, \"seturl_threw(\" + expErr(e) + \")\");\r\n    }\r\n  }";
const spNew = [
  "    try {",
  "      panel.SetURL(probeUrl);",
  "      log(\"https panel: probing \" + probeUrl);",
  "    } catch (e) {",
  "      settleProbe(false, \"seturl_threw(\" + expErr(e) + \")\");",
  "      return;",
  "    }",
  "    // 统一槽:探针作为 pending 挂载,onBridgeEvent/pollTitle/超时全走通用路径",
  "    setPending(\"probe\", function (payload) {",
  "      settleProbe(!!(payload && payload.ok), String((payload && payload.error) || (payload && payload.ok ? \"ok\" : \"no_reply\")));",
  "    }, HTTPS_PANEL_PROBE_SECONDS * 1000);",
  "    try { if (State.pending) State.pending.navUrl = probeUrl; } catch (eNU) {}",
  "  }",
].join("\r\n");
if (!t.includes(spOld)) { console.error("probe anchor ② missing"); process.exit(1); }
t = t.replace(spOld, spNew);

// ④ pollTitle:删 probe 特殊分支(探针走 pending 通用路径)
const probeBranchRe = /    if \(probe\) \{[\s\S]*?\r?\n    \}\r?\n/;
if (!probeBranchRe.test(t)) { console.error("pollTitle probe branch missing"); process.exit(1); }
t = t.replace(probeBranchRe, "");
// pollTitle 开头的 probe 变量与守卫恢复为 pending-only
t = t.replace(
  "    const pending = State.pending;\r\n    const probe = State.probePending; // 与 pending 互斥:探针只在 pending 空时发起,期间新 job 被 httpsPanelTakes 挡到 BTIPC\r\n    if (!pending && !probe) return;",
  "    const pending = State.pending;\r\n    if (!pending) return;");
// probe 的 sawAlive/title 路由行清理
t = t.replace("      if (pending) pending.sawAlive = true;\r\n      if (probe) probe.sawAlive = true;\r\n", "      if (pending) pending.sawAlive = true;\r\n");
t = t.replace(/      if \(probe && title\.indexOf\(TITLE_PREFIX \+ "probe"\) === 0\) \{[\s\S]*?      \}\r?\n/, "");

// ⑤ retryNavOnce 的 probe 守卫删除(统一后无差异)
t = t.replace("    if (State.probePending && pending !== State.probePending) return false; // 探针在途:不重试,防踩掉 probe 的 nav\r\n", "");

// ⑥ maybeProbeHttpsPanel 的守卫与降级
t = t.replace("    if (!HTTPS_PANEL_ENABLED || State.probePending) return;", "    if (!HTTPS_PANEL_ENABLED) return;");
t = t.replace("    if (State.pending || State.httpsPanelOk === true) return; // 互斥:探针只占空闲面板;通道健康则无事", "    if (State.pending || State.httpsPanelOk === true) return; // 探针=一次 pending 占用,空闲才发起;通道健康则无事");
// 面板死降级里的 probePending 引用清理(若有)
t = t.replace(/      State\.panelDead = true;\r?\n      settleProbe\(false, "bridge_nav_failed"\);\r?\n      return;\r?\n      \}\r?\n      if \(nowMs\(\) - probe\.startedAt[\s\S]*?\r?\n      \}\r?\n      \$\.Schedule\(TITLE_POLL_SECONDS, pollTitle\);\r?\n      return;\r?\n    \}\r?\n/, "");

// ⑦ httpsPanelTakes 的 probePending 守卫删除
t = t.replace("    if (State.probePending) return false; // 探针在途:面板单客户,新 job 这一条走 BTIPC(下次自动回 https)\r\n", "");
// dispatchViaPanel 里的同名守卫(若有)
t = t.replace(/    if \(State\.probePending\) return false;[^\r\n]*\r?\n/g, "");

fs.writeFileSync(file, t, "utf8");
console.log("unified, size=" + t.length);
