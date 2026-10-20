"use strict";
// core/sync_data.js —— btipc07:health / gamenames / quickchat 三接口的载荷实现【纯函数】
//
// 为什么不能把 HTTP 那三个 handler 原样搬过来:
//   BTIPC 下行实测只有 ~12.6 B/s(docs/btipc-v1.md §9:一轮 = 16B,真机 0.79s/帧),
//   而 config/quickchat.json 38988B、config/gamenames.json 9542B —— 全量同步要
//   13~50 分钟,物理不可行。所以三接口一律两段式:
//     ① 握手:客户端报自己的指纹 → 桥回 same / mode(常态 same = 1 帧级开销);
//     ② 仅当指纹不同才取数:桥按 off/lim 切片下发,gzip+base64
//        (quickchat 原 51984B → 5086B,gamenames 8052B → 5988B,见 tests/btipc07_sync.test.js);
//     ③ 桥能读到客户端那一版兜底(mod/…/*_fallback.js)时走 delta —— 只传增删改
//        (游戏更新往往只动几条 → 几百字节 → 1~2 片 ≈ 1 分钟),读不到才退全量。
//   客户端 MAX_ACTIVE_REQUESTS = 1(单槽),片间必须让位给翻译队列,否则同步会把翻译卡死。
//
// 协议边界:core/btipc/* 冻结 —— TRQ 信封白名单只有 op=config|test(btipc/transport.js),
//   新语义一律走 op=config 的 JSON body 的 "get" 字段(桥端 bridge_server.js runBtipcGet
//   解释),信封层 / 帧格式 / 状态机零改动。
const zlib = require("zlib");
// 注意:本模块刻意不 require ./quickchat.js —— quickchat → game_names 是既有依赖,
// 若这里再反向依赖 quickchat 就成环(game_names → sync_data → quickchat → game_names),
// Node 会把先到的 module.exports 换成新对象,环上后到的拿到空引用。
// 因此 fnv1a32 / fingerprintTemplates 在此内联一份同源实现,行为一致性由
// tests/btipc07_sync.test.js 与 core/quickchat.js 对拍。
// (分隔符用 String.fromCharCode(0) 而不是字面 NUL 转义:build.ps1 的源码扫描会把
//  控制字符当脏数据拦掉,两者生成的字符串完全相同。)

// 同源提示(非工具标记;行为一致性由 tests/btipc07_sync.test.js 与 core/quickchat.js 对拍):
// 这份 fnv1a32 / fingerprintTemplates 与 core/quickchat.js 里的逐字同源 —— 改一处必查另一处。
// [quickchat.js] fnv1a32 / fingerprintTemplates
function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function fingerprintTemplates(list) {
  const arr = Array.isArray(list) ? list : [];
  if (arr.length === 0) return null;
  const first = String(arr[0]);
  const last = String(arr[arr.length - 1]);
  const joined = arr.length + "|" + first + "|" + last + "|" + fnv1a32(arr.join(String.fromCharCode(0)));
  return "fnv1a-" + fnv1a32(joined);
}

// gamenames.json 里的元字段(非游戏名),算指纹/做 delta 都要排除
const META_KEYS = { english: true, schinese: true };

// 分片默认值。下行 0.79s/帧 + 每请求约 3.5s 固定开销(首发延迟 + 桥 tail 轮询),
// 90B 片 = 13 帧 ≈ 10.3s:低于游戏侧出站 15s 排队丢弃线,同步期间玩家发消息不会被吞。
const DEFAULT_LIM = 90;
const MAX_LIM = 200; // 上限:读死线 50s,200B 片 = 24 帧 ≈ 19s + 竞态 15s 仍 < 50s

// 先拼后哈希(同 fingerprintTemplates 的三段结构),防"只改中间条目"漏判
function fingerprintOf(joined) {
  return "fnv1a-" + fnv1a32(joined);
}

// ---------- gamenames ----------
function namesSorted(map) {
  const out = {};
  const keys = Object.keys(map || {}).filter((k) => !META_KEYS[k]).sort();
  for (const k of keys) out[k] = String(map[k] == null ? "" : map[k]);
  return out;
}

function namesCount(map) {
  return Object.keys(namesSorted(map)).length;
}

function namesFingerprint(map) {
  const s = namesSorted(map);
  const keys = Object.keys(s);
  if (keys.length === 0) return null;
  const text = keys.map((k) => k + "\t" + s[k]).join("\n");
  return fingerprintOf(keys.length + "|" + keys[0] + "|" + keys[keys.length - 1] + "|" + fnv1a32(text));
}

// 全量载荷:与 HTTP /api/v1/gamenames 同形(多一个 fingerprint),客户端 JSON.parse 后可直接用
function namesFullPayload(map) {
  const s = namesSorted(map);
  const keys = Object.keys(s);
  return JSON.stringify({ ok: true, fingerprint: namesFingerprint(map), count: keys.length, names: s });
}

// delta 载荷:新增 / 删除 / 改译名。目标值是绝对值(不是相对改),所以可重复施加
function namesDeltaPayload(oldMap, newMap, fp) {
  const o = namesSorted(oldMap);
  const n = namesSorted(newMap);
  const added = {};
  const removed = [];
  const changed = {};
  for (const k of Object.keys(n)) {
    if (!Object.prototype.hasOwnProperty.call(o, k)) added[k] = n[k];
    else if (o[k] !== n[k]) changed[k] = n[k];
  }
  for (const k of Object.keys(o)) {
    if (!Object.prototype.hasOwnProperty.call(n, k)) removed.push(k);
  }
  return JSON.stringify({
    ok: true, delta: true, fingerprint: fp, count: Object.keys(n).length,
    added: added, removed: removed, changed: changed,
  });
}

// ---------- quickchat ----------
function quickchatTemplates(data) {
  const d = data || {};
  if (Array.isArray(d.templates)) return d.templates.map(String);
  if (d.templates && typeof d.templates === "object") {
    const out = [];
    for (const k of Object.keys(d.templates)) {
      const arr = d.templates[k];
      if (Array.isArray(arr)) for (const t of arr) out.push(String(t));
    }
    return out;
  }
  if (Array.isArray(d.patterns)) return d.patterns.map(String);
  return [];
}

function quickchatFingerprint(data) {
  return (data && data.fingerprint) || fingerprintTemplates(quickchatTemplates(data));
}

function quickchatFullPayload(data) {
  const tpls = quickchatTemplates(data);
  return JSON.stringify({
    ok: true,
    version: (data && data.version) || 3,
    fingerprint: quickchatFingerprint(data),
    count: tpls.length,
    templates: tpls,
  });
}

function quickchatDeltaPayload(oldList, newList, fp) {
  const o = new Set(oldList.map(String));
  const n = new Set(newList.map(String));
  const added = [];
  const removed = [];
  for (const t of n) if (!o.has(t)) added.push(t);
  for (const t of o) if (!n.has(t)) removed.push(t);
  return JSON.stringify({
    ok: true, delta: true, fingerprint: fp, count: n.size,
    added: added, removed: removed,
  });
}

// ---------- config(游戏可见配置) ----------
// 与 gamenames/quickchat 同一套两段式,但差分的"基线"来源不同:
//   gamenames/quickchat 的基线 = 打包进客户端的 *_fallback.js(桥读它知道客户端手上是哪一版);
//   config 的基线 = **桥侧自己保留的配置版本历史**(按客户端上报的指纹查)——
//     配置是运行时被网页改的,客户端手上那一版的内容桥只能靠历史反推。
// 指纹口径与 configStore.configRev 同源(游戏侧 State.cfgRev 就是它),两边必须同一把尺。
// 体积账:全量 maskCompact ≈400B = 40 帧 ≈ 26s(BTIPС 下行 10B/帧 ×0.65s);
//   差分通常只有 1~3 个字段(≈100B) → 6 帧 ≈ 4s;没变则握手 1 帧 ≈ 0.65s。
function flattenConfig(obj, prefix, out) {
  const res = out || {};
  const p = prefix || "";
  for (const k of Object.keys(obj || {})) {
    const v = obj[k];
    const key = p ? p + "." + k : k;
    // 数组当叶子(整体替换,不逐项差分):fallbackProviders 这类字段改了就整份换
    if (v && typeof v === "object" && !Array.isArray(v)) flattenConfig(v, key, res);
    else res[key] = v;
  }
  return res;
}

function configFullPayload(visible, fp) {
  return JSON.stringify({ ok: true, kind: "config", fingerprint: fp, config: visible });
}

// 差分载荷:set = 变了的字段(**绝对值**,可重复施加)、unset = 被删掉的字段路径
function configDeltaPayload(oldVisible, newVisible, fp) {
  const o = flattenConfig(oldVisible);
  const n = flattenConfig(newVisible);
  const set = {};
  const removed = [];
  for (const k of Object.keys(n)) {
    if (!Object.prototype.hasOwnProperty.call(o, k) || JSON.stringify(o[k]) !== JSON.stringify(n[k])) set[k] = n[k];
  }
  for (const k of Object.keys(o)) {
    if (!Object.prototype.hasOwnProperty.call(n, k)) removed.push(k);
  }
  // unset 报"整棵子树都没了"的**顶层字段**:游戏侧直接删整个字段,不留空壳
  // (例如 chatLog 整块没了 → unset "chatLog",而不是 "chatLog.enabled" 留下个 {})。
  const unset = [];
  for (const k of removed) {
    const top = k.split(".")[0];
    const topLeaves = Object.keys(o).filter((x) => x.split(".")[0] === top);
    const whole = topLeaves.every((x) => removed.indexOf(x) >= 0);
    const target = whole ? top : k;
    if (unset.indexOf(target) < 0) unset.push(target);
  }
  return JSON.stringify({ ok: true, kind: "config", delta: true, fingerprint: fp, set: set, unset: unset });
}

// ---------- 客户端兜底文件解析 ----------
// 从 mod/panorama/scripts/*_fallback.js 里抽出 "NAME = <JSON字面量>;"。
// 扫描要认得字符串字面量:模板/译名里会出现 ; [ ] { } , 等字符。
function extractAssignment(src, name) {
  const needle = String(name) + " = ";
  const text = String(src || "");
  const at = text.indexOf(needle);
  if (at < 0) return null;
  const start = at + needle.length;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "[" || ch === "{" || ch === "(") depth += 1;
    else if (ch === "]" || ch === "}" || ch === ")") depth -= 1;
    else if (ch === ";" && depth <= 0) {
      try { return JSON.parse(text.slice(start, i).trim()); } catch (e) { return null; }
    }
  }
  return null;
}

// ---------- 编码 ----------
function gzipB64(text) {
  return zlib.gzipSync(Buffer.from(String(text), "utf8"), { level: 9 }).toString("base64");
}

function clampLim(lim) {
  const n = parseInt(lim, 10);
  if (!isFinite(n) || n <= 0) return DEFAULT_LIM;
  return Math.max(1, Math.min(MAX_LIM, n));
}

// 按字符偏移切片(载荷是 base64 → 纯 ASCII,按字符切 = 按字节切,安全)
function slicePart(b64, off, lim) {
  const total = b64.length;
  const L = clampLim(lim);
  let o = parseInt(off, 10);
  if (!isFinite(o) || o < 0) o = 0;
  if (o > total) o = total;
  const part = b64.slice(o, o + L);
  return { off: o, lim: L, total: total, part: part, done: o + part.length >= total };
}

// ---------- 两段式同步会话(桥端 runBtipcGet 的纯逻辑,便于单测) ----------
// 编码结果按 (kind, fingerprint, mode) 缓存:一次分片同步会来几十个请求,
// 每个都要重读配置并重算,不缓存就是几十次重复的全文构造。
const payloadCache = new Map();

function evictPayloadCache() {
  while (payloadCache.size > 8) {
    payloadCache.delete(payloadCache.keys().next().value);
  }
}

/**
 * 构造当前数据的下发文本。
 * @param {string} kind      gamenames | quickchat
 * @param {object} current   桥侧现值(config/gamenames.json 或 config/quickchat.json)
 * @param {object|null} baseline { fingerprint, data } 客户端那一版兜底(mod/…/*_fallback.js)
 * @param {string|null} clientFp 客户端上报的指纹
 * @returns {{fp,count,mode,text}}
 */
function encodeFor(kind, current, baseline, clientFp) {
  if (kind === "config") return encodeConfigFor(current, baseline, clientFp);
  const fp = kind === "gamenames" ? namesFingerprint(current) : quickchatFingerprint(current);
  const count = kind === "gamenames" ? namesCount(current) : quickchatTemplates(current).length;
  const canDelta = !!(baseline && typeof baseline.fingerprint === "string" &&
    clientFp && baseline.fingerprint === clientFp);
  const mode = canDelta ? "delta" : "full";
  const key = kind + "|" + fp + "|" + mode;
  const hit = payloadCache.get(key);
  if (hit) return hit;
  let text;
  if (kind === "gamenames") {
    text = canDelta ? namesDeltaPayload(baseline.data, current, fp) : namesFullPayload(current);
  } else {
    text = canDelta
      ? quickchatDeltaPayload(baseline.data, quickchatTemplates(current), fp)
      : quickchatFullPayload(current);
  }
  const out = { fp: fp, count: count, mode: mode, text: text };
  payloadCache.set(key, out);
  evictPayloadCache();
  return out;
}

// 配置专用:current = { visible, fp }(visible = maskCompact 的结果,fp = configRev)
// 缓存键要带上基线指纹 —— 差分载荷取决于"客户端手上是哪一版",只按 fp 缓存会串味。
function encodeConfigFor(current, baseline, clientFp) {
  const visible = (current && current.visible) || {};
  const fp = (current && typeof current.fp === "string") ? current.fp : null;
  const count = Object.keys(visible).length;
  const canDelta = !!(baseline && baseline.visible && clientFp && baseline.fingerprint === clientFp);
  const full = configFullPayload(visible, fp);
  let mode = "full";
  let text = full;
  if (canDelta) {
    const d = configDeltaPayload(baseline.visible, visible, fp);
    if (d.length < full.length) { mode = "delta"; text = d; } // 差分更大就回全量(小配置常常如此)
  }
  const key = "config|" + fp + "|" + mode + "|" + (canDelta ? baseline.fingerprint : "-");
  const hit = payloadCache.get(key);
  if (hit) return hit;
  const out = { fp: fp, count: count, mode: mode, text: text };
  payloadCache.set(key, out);
  evictPayloadCache();
  return out;
}

/**
 * 按 JSON 编码后的字节数切片。
 * 为什么要按【JSON 编码后的字节数】而不是字符数:
 *   - 下行按帧计费(10B/帧),字符数算不准(中文 1 字符 = 3 字节);
 *   - 载荷要再包一层 JSON 才上帧,里面的反斜杠/引号会被二次转义(最多翻倍),
 *     只按原文长度算会超预算,真机上表现为读死线超时。
 * cost() 对 end 单调不减 → 二分找最大可用 end。
 */
function sliceByJsonBytes(text, off, maxBytes) {
  const total = String(text).length;
  const budget = clampLim(maxBytes);
  let o = parseInt(off, 10);
  if (!isFinite(o) || o < 0) o = 0;
  if (o > total) o = total;
  if (o >= total) return { off: o, part: "", done: true };
  const cost = (e) => Buffer.byteLength(JSON.stringify(String(text).slice(o, e)), "utf8");
  let lo = o;
  let hi = total;
  if (cost(hi) <= budget) return { off: o, part: String(text).slice(o), done: true };
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (cost(mid) <= budget) lo = mid;
    else hi = mid - 1;
  }
  const end = Math.max(o + 1, lo);
  return { off: o, part: String(text).slice(o, end), done: end >= total };
}

/**
 * op=config + {"get": kind} 的应答(信封层冻结,语义全在 body 里)。
 *
 * 约定(握手与分片必须自洽,否则拉到一半会换内容):
 *   - fp 永远是【客户端本地指纹】,桥用它算 mode(delta/full);分片阶段也必须原样回传,
 *     这样 encodeFor 每次结果都一样(否则第二次请求会退化成 full,和握手给的 total 对不上);
 *   - exp 是握手时桥回的指纹,客户端分片时原样回传 → 桥据此发现"拉到一半配置被重建";
 *   - off 缺省 = 握手;有值 = 取片(0 是合法偏移,所以只能用 undefined/null 判握手)。
 *
 * @param {string} kind
 * @param {object} current  桥侧现值
 * @param {object|null} baseline 客户端那版兜底 {fingerprint, data}
 * @param {string|null} clientFp
 * @param {number|undefined} off
 * @param {number} lim  每片 JSON 编码后的字节预算
 * @param {string|null} expect 握手时桥侧的指纹(分片阶段用于发现配置被重建)
 */
function syncGet(kind, current, baseline, clientFp, off, lim, expect) {
  const enc = encodeFor(kind, current, baseline, clientFp);
  if (off === undefined || off === null) {
    const same = !!(clientFp && clientFp === enc.fp);
    return {
      ok: true, same: same, kind: kind, mode: enc.mode,
      fingerprint: enc.fp, count: enc.count, total: same ? 0 : enc.text.length,
    };
  }
  if (expect && expect !== enc.fp) return { ok: false, error: "fp_changed" };
  const part = sliceByJsonBytes(enc.text, off, lim);
  return { ok: true, same: false, kind: kind, off: part.off, part: part.part, done: part.done };
}

module.exports = {
  META_KEYS, DEFAULT_LIM, MAX_LIM,
  fnv1a32, fingerprintOf, fingerprintTemplates,
  namesSorted, namesCount, namesFingerprint, namesFullPayload, namesDeltaPayload,
  quickchatTemplates, quickchatFingerprint, quickchatFullPayload, quickchatDeltaPayload,
  flattenConfig, configFullPayload, configDeltaPayload,
  extractAssignment, gzipB64, clampLim, slicePart, sliceByJsonBytes,
  encodeFor, syncGet,
};
