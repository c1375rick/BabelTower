// 一次性补丁:桥面板类型 <HTML> → <CitadelHTMLPanel>(QOL 4.0.5 同款)。
// 依据(2026-10-30 12:07 boot 判别实验):
//   PROBE-ACK ok=1 到达 → 页面 JS 在新证书下正常执行(证书修复生效);
//   页面三写 title(0ms/500ms/750ms)全部未到 Panorama → title→Panorama 派发
//   对泛用 <HTML> 面板被 10-29 更新切断;同一秒 QOL 的 CitadelHTMLPanel
//   title 事件正常到达("Bridge connected and ready")。
// 同时给 ensureBridgeEvents 的面板绑定加注册成功/失败日志(下次 boot 可见)。
const fs = require("fs");
const path = require("path");

// ---- ① chat.xml:面板元素换类型 ----
const xml = path.join(__dirname, "..", "mod", "panorama", "layout", "chat.xml");
let x = fs.readFileSync(xml, "utf8");
if (x.includes("<CitadelHTMLPanel")) {
  console.log("chat.xml already patched");
} else {
  const re = /<HTML\s+id="LCTBridgePanel"[^>]*\/>/;
  if (!re.test(x)) { console.error("chat.xml anchor missing"); process.exit(1); }
  x = x.replace(re, '<CitadelHTMLPanel id="LCTBridgePanel" class="LCTBridgePanel" hittest="false" acceptsfocus="false" />');
  fs.writeFileSync(xml, x, "utf8");
  console.log("chat.xml patched: <HTML> -> <CitadelHTMLPanel>");
}

// ---- ② lingua_chat.js:面板绑定注册诊断日志 ----
const js = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let t = fs.readFileSync(js, "utf8");
if (t.includes("panel-bound HTMLTitle registered")) {
  console.log("lingua_chat.js already patched");
} else {
  // 换行无关锚定:CRLF/LF 都能匹配
  const m = t.match(/\$\.RegisterEventHandler\("HTMLTitle", panel, onBridgeEvent\);(\r?\n\s*\} catch \(eR\) \{\})/);
  if (!m) { console.error("js anchor missing"); process.exit(1); }
  const rep = [
    '$.RegisterEventHandler("HTMLTitle", panel, onBridgeEvent);',
    'log("bridge: panel-bound HTMLTitle registered");',
    "} catch (eR) {",
    'log("bridge: panel-bound HTMLTitle register FAILED: " + expErr(eR));',
    "}",
  ].join("\n");
  t = t.replace(m[0], rep);
  fs.writeFileSync(js, t, "utf8");
  console.log("lingua_chat.js patched: registration diagnostics");
}
