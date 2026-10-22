// 离线测试:出站 TLS 主机名校验护栏(core/tls_guard.js)+ 接线
// 跑法: node tests/tls_guard.test.js
//
// 背景:Node.js 2026-10-21 安全公告的三条 TLS 主机名校验绕过
//   (CVE-2026-105483 全角数字 IP / CVE-2026-106069 宽松解析成 IP /
//    CVE-2026-106072 非规范 IPv4 让 DNS SAN 给 IP 端点背书)。
// 运行时升级(26.12.1)是真正的修复;本护栏是第二道:把"出站只连规范 ASCII 主机名"
// 写成代码,不再依赖"URL 解析器恰好会规范化"这种隐式兜底,并在可疑主机名上**明确失败**。
"use strict";
const fs = require("fs");
const path = require("path");
const tls = require("tls");
const guard = require("../core/tls_guard.js");

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS |", label); }
  else { fail++; console.log("  FAIL |", label); }
}

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ---------- ① 可疑主机名必须被拒(fail closed)----------
console.log("--- rejectReason:可疑主机名 ---");
ok(!!guard.rejectReason(""), "空主机名被拒");
ok(!!guard.rejectReason("\uFF10\uFF19\uFF12.168.0.1"), "全角数字 IP 被拒(CVE-2026-105483 面)");
ok(!!guard.rejectReason("example\u3002com"), "U+3002 点号被拒(解析器/校验器切分不一致)");
ok(!!guard.rejectReason("example\uFF0Ecom"), "U+FF0E 点号被拒");
ok(!!guard.rejectReason("example\uFF61com"), "U+FF61 点号被拒");
ok(!!guard.rejectReason("127.1"), "非规范 IPv4(127.1)被拒(CVE-2026-106072 面)");
ok(!!guard.rejectReason("0177.0.0.1"), "非规范 IPv4(前导零)被拒");
ok(!!guard.rejectReason("1.2.3.4.5"), "五段 IPv4 被拒");
ok(!!guard.rejectReason("999.1.1.1"), "越界 IPv4 被拒");
ok(!!guard.rejectReason("0x7f.1"), "十六进制 IPv4 被拒");

// ---------- ② 正常主机名放行(且仍走 Node 默认校验)----------
console.log("--- rejectReason:正常主机名放行 ---");
ok(guard.rejectReason("api.openai.com") === null, "普通域名放行");
ok(guard.rejectReason("api-free.deepl.com") === null, "deepl 域名放行");
ok(guard.rejectReason("edge.microsoft.com") === null, "bing 域名放行");
ok(guard.rejectReason("translation.googleapis.com") === null, "google 域名放行");
ok(guard.rejectReason("api.cognitive.microsofttranslator.com") === null, "microsoft 域名放行");
ok(guard.rejectReason("api.github.com") === null, "github 域名放行");
ok(guard.rejectReason("127.0.0.1") === null, "规范 IPv4 放行(自建端点常见)");
ok(guard.rejectReason("192.168.1.10") === null, "规范内网 IPv4 放行");

// ---------- ③ 放行时必须仍然做真正的证书校验 ----------
console.log("--- checkServerIdentity:放行路径仍校验证书 ---");
const wrongCert = { subject: { CN: "evil.test" }, subjectaltname: "DNS:evil.test" };
const r1 = guard.checkServerIdentity("api.openai.com", wrongCert);
ok(r1 instanceof Error, "证书与主机名不匹配 -> 拒绝(不是被护栏放行后就不管了)");
const r2 = guard.checkServerIdentity("\uFF10\uFF19\uFF12.168.0.1", wrongCert);
ok(r2 instanceof Error && /本地护栏/.test(r2.message), "可疑主机名 -> 护栏自己拒(消息里带原因)");
ok(/全角数字|非 ASCII/.test(r2.message), "拒绝原因可读");
const goodCert = { subject: { CN: "api.openai.com" }, subjectaltname: "DNS:api.openai.com" };
ok(guard.checkServerIdentity("api.openai.com", goodCert) === undefined, "证书匹配 -> 放行(undefined)");

// ---------- ④ 接线:所有出站 TLS 都必须带护栏 ----------
console.log("--- 接线:出站 TLS 全部带 checkServerIdentity ---");
const providers = ["bing.js", "microsoft.js", "deepl.js", "google.js", "openai.js"];
for (const f of providers) {
  const src = read("core/providers/" + f);
  ok(/require\("\.\.\/tls_guard"\)/.test(src), f + " 引入了 tls_guard");
  ok(/checkServerIdentity: tlsGuard\.checkServerIdentity/.test(src), f + " 的出站请求带了 checkServerIdentity");
}
const bridge = read("core/bridge_server.js");
ok(/require\("\.\/tls_guard\.js"\)/.test(bridge), "桥引入了 tls_guard");
ok(/checkServerIdentity: tlsGuard\.checkServerIdentity/.test(bridge), "桥的出站(版本检查)带了 checkServerIdentity");
ok(/"\.\/tls_guard\.js"/.test(bridge), "tls_guard 进入桥的模块完整性自检清单");

// ---------- ⑤ 出包闸:随包 Node 版本下限 ----------
console.log("--- 出包闸:随包 Node 不得低于安全下限 ---");
const pkg = read("scripts/package_release.ps1");
ok(/\$MIN_NODE = "\d+\.\d+\.\d+"/.test(pkg), "package_release 声明了 Node 版本下限");
ok(/\[version\]\$nodeVer -lt \[version\]\$MIN_NODE/.test(pkg), "打包时比较随包 Node 版本并拒绝出包");
ok(/tls_guard\.js/.test(pkg), "tls_guard.js 进入随包必需文件清单");

console.log("RESULT: PASS " + pass + " / FAIL " + fail);
process.exit(fail > 0 ? 1 : 0);
