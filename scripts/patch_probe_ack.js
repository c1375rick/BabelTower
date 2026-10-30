// 一次性补丁:探针响应回执(echo)——页面 JS 收到 health 响应后回执给桥。
// 目的:区分"title 赋值失败"与"响应未到页面"——
//   ack 到达 + 探针失败 = 页面 JS 执行了、响应也收到了、document.title 赋值
//   静默失败(10-29 引擎变化实锤)——给 QOL 社区提供诊断情报。
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

// ---------- ① 桥端点 /api/v1/probe-ack ----------
{
  const file = path.join(ROOT, "core", "bridge_server.js");
  let t = fs.readFileSync(file, "utf8");
  if (t.includes("probe-ack")) { console.log("bridge: already patched"); }
  else {
    const anchor = 'if (p === "/api/v1/health") {';
    if (!t.includes(anchor)) { console.error("anchor missing"); process.exit(1); }
    const ackBranch = [
      'if (p === "/api/v1/probe-ack") {',
      '    // 探针回执(2026-10-30):页面 JS 收到 health 响应后回执——ack 到达即证明',
      '    // 页面执行+响应送达;若同 boot 探针仍失败,则 document.title 赋值静默失败',
      '    // (10-29 引擎变化:title→Panorama 同步被切)。',
      '    const ackId = String(url.searchParams.get("id") || "?");',
      '    const ackOk = url.searchParams.get("ok") === "1";',
      '    log("info", "PROBE-ACK id=" + ackId + " ok=" + (ackOk ? "1" : "0") +',
      '      " (page received response" + (ackOk ? "" : " with error") + ")");',
      '    return sendJson(res, 200, { ok: true });',
      '  }',
      '',
    ].join("\r\n");
    t = t.replace(anchor, ackBranch + anchor, 1);
    fs.writeFileSync(file, t, "utf8");
    console.log("bridge patched, size=" + t.length);
  }
}

// ---------- ② bridgePage 页面 JS:health 响应后回执 ----------
{
  const file = path.join(ROOT, "core", "bridge_server.js");
  let t = fs.readFileSync(file, "utf8");
  if (t.includes("probe-ack")) { console.log("page: already patched"); }
  else {
    // health 单发路径的 .then 里加 ack fetch(op=health 时才发,其他 op 不需要)
    const oldJs = '"if(op===\'health\'){fetchOpts={method:\'GET\'};}"';
    const newJs = [
      '"if(op===\'health\'){fetchOpts={method:\'GET\'};}"',
      '"var ackF=function(j2){fetch(\'/api/v1/probe-ack?id=\'+encodeURIComponent(String(id))+\'&ok=\'+(j2&&j2.ok?\'1\':\'0\')).catch(function(){});}"',
    ].join("\r\n");
    if (!t.includes(oldJs)) { console.error("page anchor ① missing"); process.exit(1); }
    t = t.replace(oldJs, newJs);
    // health 的 then 里调 ackF(在 out 之前——ack 先于 title 写入,顺序无碍但逻辑清晰)
    const oldThen = '".then(function(j){if(done)return;done=true;out(j);})"';
    const newThen = '".then(function(j){if(done)return;done=true;if(op===\'health\'){ackF(j);}out(j);})"';
    if (!t.includes(oldThen)) { console.error("page anchor ② missing"); process.exit(1); }
    t = t.replace(oldThen, newThen);
    fs.writeFileSync(file, t, "utf8");
    console.log("page patched, size=" + t.length);
  }
}
console.log("done");
