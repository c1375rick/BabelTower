// Babel Tower —— 隐藏 HTML 面板通道的 TLS 终结进程(2026-10-15)
// ------------------------------------------------------------------
// 为什么单独一个进程,而不是在 bridge_server.js 里再开一个 https 监听:
//   ① core/bridge_server.js 有安全护栏(tests/security_boundary_guard.test.js)要求
//      "整个桥只有一处 .listen(),且形如 (PORT, host)",不允许第二个内联绑定。
//   ② 证书缺失/过期/握手失败**绝不能连带 BTIPC 一起死** —— BTIPC 是当前唯一零摩擦
//      可用的下行通道,它的生死不能挂在 TLS 上。独立进程才有这个隔离。
//   ③ 面板页面同源 fetch('/api/v1/…') 由本进程原样转发到 8791,桥的路由/状态零改动。
//
// 证书:scripts\gen_bridge_cert.ps1 生成(CN=localhost,SAN 含 DNS 名 + IP:127.0.0.1/::1,
// EKU=serverAuth)。首次必须 scripts\gen_bridge_cert.ps1 -Trust,并**完全退出重启 Steam**
// (信任库由 Steam 宿主缓存,只重启游戏不生效 —— 2026-10-15 实测踩过)。
//
// 行为约定:
//   * 证书缺失 → 打印可执行提示并以退出码 3 退出(启动器据此跳过,不视为故障)。
//   * 上游 8791 不通 → 502,并在日志留一行;本进程不退出(等桥起来即可自愈)。
//   * 不做任何鉴权:只监听回环地址,且与本机桥同源;它存在的唯一目的是让引擎的
//     证书校验通过,不是对外暴露面。
"use strict";
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const PORT = Number(process.env.BABEL_TOWER_HTTPS_PORT || 8792);
const UP_HOST = process.env.BABEL_TOWER_HTTP_HOST || "127.0.0.1";
const UP_PORT = Number(process.env.BABEL_TOWER_HTTP_PORT || 8791);
const PFX = process.env.BABEL_TOWER_CERT_PFX ||
  path.join(process.env.LOCALAPPDATA || "C:\\Windows", "BabelTower", "cert", "bridge.pfx");
const PFX_PASS = process.env.BABEL_TOWER_CERT_PASS || "btabridge";
const LOG = path.join(__dirname, "..", "logs", "bridge_https.log");

function ensureLogDir(file) {
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (e) {}
}
function log(level, msg) {
  ensureLogDir(LOG);
  const line = "[" + new Date().toISOString().replace("T", " ").slice(0, 19) + "] [" + level + "] " + msg;
  try { fs.appendFileSync(LOG, line + "\n"); } catch (e) {}
  console.log(line);
}

// 逐跳首部不该转发(HTTP/1.1 规定)
const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length"]);

let pfx;
try {
  pfx = fs.readFileSync(PFX);
} catch (e) {
  log("warn", "证书缺失:" + PFX);
  log("warn", "生成并信任:scripts\\gen_bridge_cert.ps1 -Trust,然后**完全退出并重启 Steam**(只重启游戏无效)");
  process.exit(3);
}

function handle(req, res) {
  const headers = {};
  for (const k of Object.keys(req.headers || {})) {
    if (!HOP.has(k.toLowerCase())) headers[k] = req.headers[k];
  }
  headers["x-bt-via"] = "https-panel";
  const up = http.request({
    host: UP_HOST, port: UP_PORT, method: req.method, path: req.url, headers,
  }, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });
  up.on("error", (e) => {
    log("warn", "上游 " + UP_HOST + ":" + UP_PORT + " 不通(" + (e && e.code ? e.code : e.message) + ") → 502");
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "bridge_unreachable" }));
  });
  // 长轮询端点将来会挂住很久,所以不设超时
  req.pipe(up);
}

let thumb = "";
for (const cer of [PFX.replace(/\.pfx$/i, ".cer"), PFX.replace(/bridge\.pfx$/i, "bridge-cert.cer")]) {
  try {
    const der = fs.readFileSync(cer);
    const x = new (require("crypto").X509Certificate)(der);
    thumb = x.subject + " / 到期 " + x.validTo;
    break;
  } catch (e) { /* 试下一个文件名 */ }
}

const TLS_OPTS = { pfx, passphrase: PFX_PASS, minVersion: "TLSv1.2" };
try {
  https.createServer(TLS_OPTS, handle); // 预检:PFX 口令错/证书损坏在这里就抛
} catch (e) {
  log("error", "证书无法加载:" + (e && e.message ? e.message : String(e)));
  log("error", "重新生成:scripts\\gen_bridge_cert.ps1");
  process.exit(3);
}

// 每个回环地址一个独立 server(同一对象 listen 两次在 Windows 上只会成功一个,
// IPv4 那个静默丢失 —— 与 bridge_server.js 的 makeServer 同理)。
let readyCount = 0;
function bind(host) {
  const s = https.createServer(TLS_OPTS, handle);
  s.on("tlsClientError", (err) => {
    // 引擎不信任本机证书时会走到这里 —— 这是"还没运行 -Trust / 没重启 Steam"的信号,
    // 不是故障(证书校验由客户端发起,我们只是被拒绝)。
    log("info", "[" + host + "] TLS 被客户端拒绝(" + (err && err.code ? err.code : "?") +
      ") —— 多数是证书未受信;跑 gen_bridge_cert.ps1 -Trust 后完全重启 Steam");
  });
  s.on("error", (e) => {
    log("warn", "[" + host + "] https server error:" + (e && e.message ? e.message : String(e)));
  });
  s.listen(PORT, host, () => {
    readyCount += 1;
    if (readyCount === 1) {
      log("info", "Babel Tower 面板通道就绪 https://localhost:" + PORT + " → http://" + UP_HOST + ":" + UP_PORT);
      log("info", "证书 " + thumb);
    }
  });
  return s;
}
bind("127.0.0.1");
bind("::1");
