// EXP6739 专用探针服务(2026-10-15)—— 一次性实验脚手架,不进发布面。
//
// 目的:回答"隐藏 HTML 面板的 SetURL 能不能走 https://"。
// 背景:exp6729 的判死矩阵只覆盖了 file:// 与 http://(含 localhost/127.0.0.1),
//       https:// 全家从未测过;而市面上一款同类实现押在 https://localhost +
//       自签证书上(还带 Trust-Local-Https.ps1 往系统信任库塞证书)。
//
// 设计要点:
//   ① 同一进程开两个监听,同一份页面 —— http://localhost:8792 是对照臂,
//      https://localhost:8793 是实验臂。两者差异只有 scheme,没有别的变量。
//   ② 自签证书**故意不进系统信任库**,先测"不受信任时引擎放不放行"。
//      CEF 多数情况下直接放行自签证书;若不放行,这里会留下 tlsClientError 证据。
//   ③ 每个请求都记 ms 精度时间戳 —— "引擎到底有没有发出请求"是最硬的判据,
//      比在面板侧读 src/title 更不易误判。
//   ④ tlsClientError / clientError 必须记:证书被拒时长这样,否则会误判成"面板没加载"。
//
// 跑法:node scripts\probe_https_server.js
// 证书:PROBE_PFX 环境变量或默认临时目录里的 probe_localhost.pfx(密码 probe123)
"use strict";
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const PFX = process.env.PROBE_PFX ||
  "C:\\Users\\kali1\\AppData\\Local\\Temp\\opencode\\probe_localhost.pfx";
const PFX_PASS = process.env.PROBE_PFX_PASS || "probe123";
const HTTP_PORT = Number(process.env.PROBE_HTTP_PORT || 8792);
const HTTPS_PORT = Number(process.env.PROBE_HTTPS_PORT || 8793);
const LOG = path.join(__dirname, "..", "logs", "probe_https.log");

function stamp() {
  const d = new Date();
  return d.toTimeString().slice(0, 8) + "." + String(d.getMilliseconds()).padStart(3, "0");
}
function rec(line) {
  const s = stamp() + " " + line;
  try { fs.appendFileSync(LOG, s + "\n"); } catch (e) {}
  console.log(s);
}

// 页面:首行脚本立刻写 document.title —— 与 6729 判据一致(正常 <2s 内必到 lct-alive)
function page(title) {
  const t = String(title || "lct-alive").replace(/["\\]/g, "");
  return "<!doctype html><html><head><meta charset=\"utf-8\"><title>" + t + "</title></head>" +
    "<body><script>try{document.title=\"" + t + "\";}catch(e){}</script>exp6739-ok</body></html>";
}

function handler(tag) {
  return function (req, res) {
    let q = "";
    try { q = new URL(req.url, "http://probe.invalid").searchParams; } catch (e) {}
    const title = q.get("t") || "lct-alive";
    rec(tag + " HIT " + req.method + " " + String(req.url).slice(0, 160) +
      " | id=" + (q.get("id") || "-") +
      " | host=" + String(req.headers.host || "-") +
      " | ua=" + String(req.headers["user-agent"] || "-").slice(0, 48) +
      " | title=" + title);
    try {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Connection": "close",
      });
      res.end(page(title));
    } catch (e) {
      rec(tag + " WRITE-FAIL " + (e && e.message ? e.message : String(e)));
    }
  };
}

const h = http.createServer(handler("HTTP"));
h.on("error", (e) => rec("HTTP LISTEN-ERROR " + (e && e.code ? e.code : e)));
h.listen(HTTP_PORT, "127.0.0.1", () => rec("LISTEN http://127.0.0.1:" + HTTP_PORT));
h.listen(HTTP_PORT, "::1", () => rec("LISTEN http://[::1]:" + HTTP_PORT));

let tls = null;
try {
  tls = https.createServer(
    { pfx: fs.readFileSync(PFX), passphrase: PFX_PASS, minVersion: "TLSv1.2" },
    handler("HTTPS")
  );
} catch (e) {
  rec("HTTPS CREATE-FAIL " + (e && e.message ? e.message : String(e)));
}

if (tls) {
  // 证书不受信任时 CEF 可能直接掐握手 —— 这是"实验臂失败"的独立证据,必须留痕
  tls.on("tlsClientError", (err, sock) => {
    rec("HTTPS tlsClientError(" + (err && err.code ? err.code : "?") + "): " +
      String(err && err.message ? err.message : err).slice(0, 140));
    try { sock.destroy(); } catch (e) {}
  });
  tls.on("clientError", (err, sock) => {
    rec("HTTPS clientError: " + String(err && err.message ? err.message : err).slice(0, 140));
    try { sock.destroy(); } catch (e) {}
  });
  tls.on("error", (e) => rec("HTTPS LISTEN-ERROR " + (e && e.code ? e.code : e)));
  const onListen = (tag) => () => rec("LISTEN " + tag + "://localhost:" + HTTPS_PORT +
    " (自签未受信任;SAN=localhost/127.0.0.1/::1,EKU=serverAuth)");
  tls.listen(HTTPS_PORT, "127.0.0.1", onListen("https"));
  tls.listen(HTTPS_PORT, "::1", function () {});
}

// 证书指纹见部署说明(PFX 是 PKCS#12,Node 的 X509Certificate 解析不了;指纹从
// Cert:\CurrentUser\My 里 FriendlyName="LCT-probe-6739" 的那张上查)。

rec("READY — 判据:面板侧 src=\"\" = 引擎没开始加载;本文件出现 HIT = 请求真的到了。");
rec("对照臂 A1=http://localhost:" + HTTP_PORT + "/bridge  A2=http://127.0.0.1:" + HTTP_PORT +
    "/bridge  实验臂 B1=https://localhost:" + HTTPS_PORT + "/bridge");
