// Babel Tower —— 隐藏 HTML 面板通道的 TLS 终结进程(2026-10-15)
// ------------------------------------------------------------------
// 【路线来源】(详见 docs/btipc-https-v1.md §2)
//   ① 设计面是我们自己的:隐藏 HTML 面板 SetURL → /bridge 页面 + document.title 轮询
//      这条回程,早于 BTIPC 就记在 docs/architecture.md §4.2 的通道③(定位是"②不可用
//      时的回退")。本文件不发明新路线,只给它补一个引擎要求的证书入口。
//   ② "给面板一个受信任的本机 https"这个**方案本身**(自签证书 + 写入
//      CurrentUser\Root + 信任后完全重启 Steam)来自一款 GPL-3.0 同类实现,我们此前
//      没有这个方案;其中"非交互进程写信任库必须用 certutil"是本仓自动化语境下自己
//      撞出来的。逐项对账(含我们更正过的两处表述)见 docs/btipc-https-v1.md §2。
//   ③ 拦点是证书链(`error:-202`)这个定位是本仓实机抓到的,不是抄来的。
//   我们与该实现零代码重叠(审计基线见 docs/btipc-https-v1.md §2.5)。
//
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
function pad2(n) { return (n < 10 ? "0" : "") + n; }
// 本地时间,与 bridge_server.js 的 localTimestamp() 同格式。
// 2026-10-15 修:原来用 toISOString(),那是 **UTC**。本机在 UTC+8,于是
// bridge_https.log 记「14:43:23」而同一时刻 bridge.log 记「22:43:23」——
// 两个本该对着读的日志差 8 小时,当场把"TLS 被拒"这件事错判成 8 小时前的事。
// **两个日志文件的时区必须一致,否则跨文件对时序就是自杀。**
function localTimestamp() {
  const d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
    " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

// 请求 URL 的日志用:把 ?d=<JSON> 的值整段打码。
// 2026-10-15:设置面板的保存走本通道后,载荷(含 API Key)会经 URL 查询串进来。
// 虽然实测"Key 落在第 ~132 个字符,而这里只取 96"看似安全 —— 但那是**算术余量**:
// 字段顺序或服务商名一变短,余量就没了。而本仓有硬规矩「任何日志都不允许包含 apiKey」,
// 且安装包自带"导出诊断"会把日志发出去。所以这里按规矩打码,不靠余量。
function redactUrl(u) {
  const s = String(u == null ? "" : u);
  // 必须按**参数边界**找 d=,不能 indexOf("d=")—— 那会命中 "id=" 里的那个 d=。
  // (2026-10-15 踩过:自测用例直接报 LEAK,眼看一下是看不出来的。)
  const m = s.match(/[?&]d=/);
  if (!m) return s.length > 120 ? s.slice(0, 120) + "…" : s;
  const start = m.index + m[0].length;      // 值开始处
  const cut = s.indexOf("&", start);
  const end = cut === -1 ? s.length : cut;
  // m.index 指到 ? 或 &,切片要 +1 把分隔符带上 —— 否则日志里会印出 "op=configd=<redacted>"
  // 这种畸形串。日志畸形就是坏日志:它要能被当证据读。
  return s.slice(0, m.index + 1) + "d=<redacted " + (end - start) + "B>" +
    (cut === -1 ? "" : s.slice(cut));
}

function log(level, msg) {
  ensureLogDir(LOG);
  const line = "[" + localTimestamp() + "] [" + level + "] " + msg;
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
  // 成功请求也落一行(2026-10-15 补)。此前**只记失败**,于是"这一条到底有没有走 https 进来"
  // 只能回头看 8791 的 REQHDR 反推 —— 而 8791 同时也接 http 面板和 BTIPC,三条路混在一起,
  // 推不出结论。当天就栽在这上面:证书已撤销,游戏却报 ALIVE,到底是"游戏不校验证书"
  // 还是"请求其实没走 https",没有正面证据,只能靠猜。
  log("info", "REQ " + req.method + " " + redactUrl(req.url) + " (经 https 面板通道进来)");
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
