"use strict";
// core/tls_guard.js —— 出站 TLS 的主机名校验护栏(2026-10-22)
// ---------------------------------------------------------------------------
// 为什么需要它(不是"运行时升了补丁就完了"):
//   Node.js 2026-10-21 安全公告里三条 high/medium 都是**客户端侧**证书主机名校验的问题:
//     CVE-2026-105483 主机写成**全角数字**的 IP 时,主机名校验被跳过;
//     CVE-2026-106069 主机"宽松解析"成 IP 时,主机名校验被跳过;
//     CVE-2026-106072 **非规范 IPv4** 写法(127.1 / 0177.0.0.1)时,证书里的
//                 **DNS SAN** 也能给 IP 端点背书 → 名字证书可以冒充 IP 端点。
//   运行时升级(26.12.1)是真正的修复;本模块是**第二道护栏**,作用有两个:
//     ① 把"我们的出站只连规范 ASCII 主机名"这条纪律**写进代码**,不依赖
//        "URL 解析器恰好会把畸形主机名规范化"这种隐式兜底;
//     ② 万一将来有人改成传**字符串 host**(https.request({host:"..."})),
//        或者用户拿系统里的旧 Node 跑桥,这里会**明确失败并说清原因**,
//        而不是让一个被绕过的校验静默通过。
//   现状核查(2026-10-22):本仓所有出站请求都用 `new URL(...)` 造 URL,
//   WHATWG URL 解析器会自己把 127.1 → 127.0.0.1、把 U+3002 当 "."、把全角数字直接判为
//   Invalid URL —— 所以这三条 CVE 在我们路径里**本来就不可达**。护栏是把这层依赖显式化。
//
// 用法:https.request(url, { checkServerIdentity: tlsGuard.checkServerIdentity, ... })
//   成功返回 undefined(与 Node 默认一致),失败返回一个 Error。
const tls = require("tls");

// 三个"点号"字符:解析器(URL/dns)把它们当 "." ,证书主机名校验器不当 ——
// 两边对标签切分的理解不一致,通配符证书的深度校验就能被绕过(CVE-2026-48618 同族)。
const UNICODE_DOTS = /[\u3002\uFF0E\uFF61]/;
// 非 ASCII 可打印字符:全角数字(U+FF10-FF19)等变体(CVE-2026-105483 的触发面)。
const NON_ASCII = /[^\x21-\x7e]/;
// 只由数字和点组成 → 看着像 IP 的写法。
const NUMERIC_HOST = /^[0-9.]+$/;
// 十六进制形态的 IP 老写法(inet_aton 家族:0x7f.0.0.1)。
const HEX_HOST = /^0[xX][0-9a-fA-F.]+$/;
// 规范点分十进制 IPv4:每段 0-255 且不允许前导零(0177 / 127.1 这类写法会被拒)。
const CANONICAL_IPV4 = /^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$/;

/**
 * 这个主机名是否**不允许**用于出站 TLS。
 * @param {string} host
 * @returns {string|null} 拒绝原因(null = 放行)
 */
function rejectReason(host) {
  const h = String(host == null ? "" : host);
  if (!h) return "空主机名";
  if (UNICODE_DOTS.test(h)) {
    return "主机名含 Unicode 点号(U+3002/FF0E/FF61):解析器与证书校验器切分标签不一致";
  }
  if (NON_ASCII.test(h)) {
    return "主机名含非 ASCII 字符(全角数字等变体):证书主机名校验不可靠";
  }
  if (NUMERIC_HOST.test(h) && !CANONICAL_IPV4.test(h)) {
    return "主机名是非规范 IPv4 写法(如 127.1 / 0177.0.0.1):证书里的 DNS SAN 可能给 IP 端点背书";
  }
  if (HEX_HOST.test(h)) {
    return "主机名是十六进制形态的 IP(如 0x7f.0.0.1):证书里的 DNS SAN 可能给 IP 端点背书";
  }
  return null;
}

/**
 * 给 https.request / tls.connect 用的 checkServerIdentity 回调。
 * 可疑主机名 → 明确失败(fail closed);其余 → 委托 Node 默认校验。
 */
function checkServerIdentity(host, cert) {
  const why = rejectReason(host);
  if (why) {
    return new Error("TLS 主机名校验被本地护栏拒绝:" + why + "(host=" + host + ")");
  }
  return tls.checkServerIdentity(host, cert);
}

module.exports = { checkServerIdentity, rejectReason };
