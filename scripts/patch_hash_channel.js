// 一次性补丁:https 面板通道升级为 QOL 式 hash 命令通道(页面常驻)。
// 动机:nav 偶发失败(~6%,10-29 全天实车)+ title 容量 + watch 被顶掉——
// 全部源于"每次请求都 SetURL 导航 → 页面重载"。QOL 4.0.5 实证:
// SetURL(同base#fragment) 只触发 hashchange 不重导航 → 页面常驻,零导航。
// 注意:bridgePage 页面 JS 是字符串数组,插入行必须带尾逗号。
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

// ---------- ① 桥侧 bridgePage ----------
{
  const file = path.join(ROOT, "core", "bridge_server.js");
  let t = fs.readFileSync(file, "utf8");
  if (t.includes("LCTQ:")) { console.log("bridge: already patched"); }
  else {
    const anchor = '"try{document.title=\'lct-alive\';}catch(e){}",';
    if (!t.includes(anchor)) { console.error("bridge anchor missing"); process.exit(1); }
    // out 支持显式响应 id(hash 请求的 id 每次不同)
    const oldOut = "\"function out(p){var s='LCT'+id+JSON.stringify(p);\",";
    const newOut = "\"function out(p,outId){var s='LCT'+(outId||id)+JSON.stringify(p);\",";
    if (!t.includes(oldOut)) { console.error("out anchor missing"); process.exit(1); }
    t = t.replace(oldOut, newOut);
    // onHash 定义 + boot 服务模式分支(插入在 lct-alive 写入点之前;全部带尾逗号)
    const insert = [
      '"function onHash(){",',
      '"var h=location.hash.slice(1);if(h.indexOf(\'LCTQ:\')!==0)return;",',
      '"var msg;try{msg=JSON.parse(decodeURIComponent(h.slice(5)));}catch(e){return;}",',
      '"if(!msg||!msg.q||msg.q===lastH)return;lastH=msg.q;",',
      '"if(typeof msg.id!==\'string\')return;",',
      '"var op=String(msg.op||\'\').replace(/[^a-z]/g,\'\');",',
      '"var req=msg.d||{};",',
      '"var path=\'/api/v1/\'+(op===\'translate\'?\'translate\':op);",',
      '"fetch(path,{method:\'POST\',headers:{\'Content-Type\':\'application/json\'},body:JSON.stringify(req)})",',
      '".then(function(r){return r.json();})",',
      '".then(function(j){out(j,msg.id);})",',
      '".catch(function(e){out({ok:false,error:String(e)},msg.id);});",',
      '"};",',
      '"if(q.get(\'boot\')===\'1\'){",',
      '"try{document.title=\'lct-alive\';}catch(e){}",',
      '"window.addEventListener(\'hashchange\',onHash);",',
      '"return;",',
      '"}",',
    ].join("\r\n");
    t = t.replace(anchor, insert + "\r\n" + anchor, 1);
    fs.writeFileSync(file, t, "utf8");
    console.log("bridge patched, size=" + t.length);
  }
}

// ---------- ② 游戏侧 lingua_chat.js ----------
{
  const file = path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat.js");
  let t = fs.readFileSync(file, "utf8");
  if (t.includes("hashReady")) { console.log("game: already patched"); }
  else {
    // State 字段
    const stAnchor = "    probeLastAt: 0, // 上次探测发起时间(nowMs()),判死后按 HTTPS_PANEL_REPROBE_MS 节流重探";
    if (!t.includes(stAnchor)) { console.error("state anchor missing"); process.exit(1); }
    const stIns = [
      "    hashReady: false, // hash 命令通道已握手(探针 ALIVE 后置位):SetURL 只变 fragment,页面常驻零导航",
      "    hashSeq: 0, // hash 请求计数",
      "    hashBase: \"\", // hash 通道 base(init 页面 URL 含 query;hash 请求必须与它前缀完全一致才不触发整页导航)",
    ].join("\r\n");
    t = t.replace(stAnchor, stAnchor + "\r\n" + stIns);
    // settleProbe(true) → hashReady + hashBase
    const spAnchor = "    if (ok) {\r\n      State.httpsPanelHardDead = false;";
    if (!t.includes(spAnchor)) { console.error("settleProbe anchor missing"); process.exit(1); }
    t = t.replace(spAnchor, spAnchor + "\r\n      State.hashReady = true;\r\n      State.hashBase = (State.probePending && State.probePending.navUrl) || State.hashBase;");
    // dispatchViaPanel:nav 前分流
    const navAnchor = "    const url = buildBridgeUrl(job, forceHttp);";
    if (!t.includes(navAnchor)) { console.error("nav anchor missing"); process.exit(1); }
    const hashBranch = [
      "    // hash 命令通道(2026-10-29,QOL 4.0.5 实证架构):页面常驻,SetURL 只变 fragment",
      "    // (同 base#frag = 同文档导航,hashchange 不重载)——nav 偶发失败/watch 顶掉/",
      "    // 页面重载族问题从架构上消失。异常自动回退下方 nav 模式(现有代码全保留)。",
      "    if (hooks && hooks.httpsChannel && State.hashReady && !forceHttp) {",
      "      const payload = {",
      "        q: \"h\" + (++State.hashSeq) + \"_\" + nowMs(),",
      "        id: job.id,",
      "        op: job.kind === \"bridge\" ? job.op : \"translate\",",
      "        d: job.kind === \"bridge\" ? (function () { try { return JSON.parse(job.data || \"{}\"); } catch (eD) { return {}; } })() :",
      "           { text: (job.record && job.record.text) || \"\", source: \"auto\",",
      "             target: job.kind === \"outgoing\" ? resolveOutgoingTarget() : targetLanguage(),",
      "             timeoutMs: job.kind === \"outgoing\" ? OUTGOING_TIMEOUT_MS : (State.cfg.timeoutMs || 15000) },",
      "      };",
      "      setPending(job.id, function (payload2) {",
      "        if (isPanelHardFail(payload2) && handOff(hooks, payload2)) return;",
      "        handleBridgePayload(job, payload2);",
      "      }, job.kind === \"outgoing\" ? OUTGOING_TIMEOUT_MS : (State.cfg.timeoutMs || 15000));",
      "      try {",
      "        panel.SetURL(State.hashBase + \"#LCTQ:\" + encodeURIComponent(JSON.stringify(payload)));",
      "      } catch (eH) {",
      "        State.pending = null;",
      "        State.hashReady = false; // hash 通道异常 → 回退 nav 模式(下一请求起生效)",
      "        log(\"hash channel SetURL THREW, fallback to nav: \" + expErr(eH));",
      "      }",
      "      if (State.hashReady) {",
      "        try { if (State.pending) State.pending.navUrl = null; } catch (eNU) {}",
      "        return; // 响应经 pollTitle 现有解析(LCT+id+JSON 格式不变)",
      "      }",
      "    }",
    ].join("\r\n");
    t = t.replace(navAnchor, hashBranch + "\r\n" + navAnchor, 1);
    // 面板死 → hashReady=false(nav 模式接管)
    const pdAnchor = "      State.pending = null;\r\n      State.panelDead = true;\r\n      const snap = navDiagSnapshot();";
    if (t.includes(pdAnchor)) {
      t = t.replace(pdAnchor, "      State.pending = null;\r\n      State.panelDead = true;\r\n      State.hashReady = false; // 面板死 → hash 通道随面板失效,nav 模式接管\r\n      const snap = navDiagSnapshot();");
    }
    fs.writeFileSync(file, t, "utf8");
    console.log("game patched, size=" + t.length);
  }
}
console.log("done");
