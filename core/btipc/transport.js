"use strict";
// BTIPC v1 传输层(规格:docs/btipc-v1.md §3.1 位编码 / §4 轮次 / §6 桥端状态机 / §14 Security)
// - parseGameLine:console.log tail 的 REQ/CAN 行解析 + §14.1 逐项校验,不过 = 静默 drop
// - serveDL:/btipc/dl 每面板一位 —— 位=1 → 200(调用方生成 PNG),位=0 → 404
// 纯逻辑、零 HTTP/PNG 依赖,便于离线测试(tests/btipc/simulator.test.js)。
const { crc16 } = require("./crc16.js");
const { busyFrame } = require("./framer.js");

const LINE_MAX = 1000; // §14.1:J1 实测行上限
const REQ_MAX_PAYLOAD = 680; // §9:整行(引擎前缀 ≈24 + [LCT] + 行头 48 + b64 908)≤1000(J1);68 帧 ≤ seq7 上限
const WIN_RE = /^[0-9a-f]{6}$/;
const ID_RE = /^[0-9a-f]{4}$/;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
// REQ = 回声 conformance(实现顺序③/⑤);TRQ = 翻译请求(实现顺序⑥)。
// 两者行长相等(均为 3 字符命令词),因此 TRQ 不额外占用 §9 J1 的 1000 字节行预算。
const REQ_RE = /^(REQ|TRQ) w=([0-9a-f]{6}) id=([0-9a-f]{4}) len=(\d{1,4}) crc=([0-9a-fA-F]{4}) b64=(\S*)$/;
const CAN_RE = /^CAN w=([0-9a-f]{6})$/;

/**
 * 解析游戏 console.log 行(-condebug 尾随,行内含引擎前缀,自 [LCT] 起截取)。
 * @param {string} raw
 * @returns {{ok:true, cmd:"REQ"|"TRQ"|"CAN", win:string, id?:number, len?:number, payload?:Buffer, translate?:boolean}
 *          |{ok:false, skip:true}
 *          |{ok:false, reason:string}}
 *   cmd:"REQ" = 回声 conformance;cmd:"TRQ" = 翻译(translate:true,⑥);
 *   skip:true  = 普通 [LCT] 行(非 BTIPC),调用方直接忽略;
 *   其余 !ok   = BTIPC 形状但非法 → 静默 drop,调用方只记一行 WARN(§14.1)。
 */
function parseGameLine(raw) {
  if (typeof raw !== "string") return { ok: false, skip: true, reason: "type" };
  const line = raw.replace(/\r+$/, "");
  const at = line.indexOf("[LCT] ");
  if (at === -1) return { ok: false, skip: true, reason: "no_lct" };
  const seg = line.slice(at + 6); // "[LCT] " 之后
  if (seg.indexOf("BTIPC ") !== 0) return { ok: false, skip: true, reason: "not_btipc" };
  if (line.length > LINE_MAX) return { ok: false, reason: "line_too_long" };
  const rest = seg.slice(6); // "BTIPC " 之后

  if (rest.indexOf("REQ ") === 0 || rest.indexOf("TRQ ") === 0) {
    const m = REQ_RE.exec(rest);
    if (!m) return { ok: false, reason: "req_format" };
    const verb = m[1]; // REQ(回声) | TRQ(翻译)
    const win = m[2];
    const id = m[3];
    const len = Number(m[4]);
    const crcHex = m[5];
    const b64 = m[6];
    if (!WIN_RE.test(win) || !ID_RE.test(id)) return { ok: false, reason: "id_format" };
    if (len > REQ_MAX_PAYLOAD) return { ok: false, reason: "req_len" };
    if (b64.length % 4 !== 0 || !B64_RE.test(b64)) return { ok: false, reason: "b64_format" };
    const payload = Buffer.from(b64, "base64");
    if (payload.toString("base64") !== b64) return { ok: false, reason: "b64_norm" }; // 严格 base64
    if (payload.length !== len) return { ok: false, reason: "len_mismatch" };
    if (crc16(payload) !== parseInt(crcHex, 16)) return { ok: false, reason: "crc_mismatch" };
    // 翻译失败时上层需要区分「空结果」与「失败」:translate=true 告知调用方空 END 帧代表失败。
    return {
      ok: true, cmd: verb === "TRQ" ? "TRQ" : "REQ", win: win,
      id: parseInt(id, 16), len: len, payload: payload,
      translate: verb === "TRQ",
    };
  }

  if (rest.indexOf("CAN ") === 0) {
    const m = CAN_RE.exec(rest);
    if (!m) return { ok: false, reason: "can_format" };
    return { ok: true, cmd: "CAN", win: m[1] };
  }

  return { ok: false, reason: "unknown_cmd" };
}

/**
 * GET /btipc/dl?w&r&p&t — 每面板一位(§3.1)。状态机逐步对齐 §6:
 *   1. w 格式错/窗口不存在 → 404        2. frames 未就绪 → 固定 BUSY 帧(与 r 无关)
 *   3. frameStartRound=null → 以 r 锚定   4. idx = r - frameStartRound 现算(零状态幂等)
 *   5. tLast 刷新;END 帧首次被服务 → 记 endServedAt(GC 计时)
 * @param {import("./window.js").WindowTable} table
 * @param {{w:string,r:string,p:string,t?:string}} q URL 参数(均为字符串)
 * @returns {{status:200|404, bit?:0|1, win?:string, idx?:number, busy?:boolean}}
 */
function serveDL(table, q) {
  const miss = { status: 404 };
  const w = q.w == null ? "" : String(q.w);
  if (!WIN_RE.test(w)) return miss;
  const rStr = q.r == null ? "" : String(q.r);
  const pStr = q.p == null ? "" : String(q.p);
  if (!/^\d{1,9}$/.test(rStr) || !/^\d{1,3}$/.test(pStr)) return miss;
  const rN = Number(rStr);
  const pN = Number(pStr);
  if (pN > 127) return miss;

  const tr = table.get(w);
  if (!tr) return miss; // §6.1 未知窗口(REQ 未达/已 GC)
  tr.tLast = table.now(); // §6.5

  let frame;
  let idx = -1;
  let busy = false;
  if (!tr.frames || tr.frames.length === 0) {
    frame = busyFrame(tr.id); // §6.2 固定 BUSY(CRC 字节位照常服务)
    busy = true;
  } else {
    if (tr.frameStartRound === null) tr.frameStartRound = rN; // §6.3 锚定
    if (rN < tr.frameStartRound) return miss; // 防御:轮号不会回退,正常不可达
    idx = rN - tr.frameStartRound; // §4.0 现算,不存 nextFrameIdx
    frame = idx < tr.frames.length ? tr.frames[idx] : tr.frames[tr.frames.length - 1]; // §6.4 兜底末帧
    if (idx >= tr.frames.length - 1 && tr.endServedAt === null) {
      tr.endServedAt = table.now(); // §6:END 首次被服务 → +END_GC_MS(45s)GC,必须 > 客户端最坏重试跨度(见 window.js)
    }
  }

  const bit = (frame[pN >> 3] >> (pN & 7)) & 1; // §3.1 LSB first
  return { status: bit ? 200 : 404, bit: bit, win: w, idx: idx, busy: busy };
}

// ---------- TRQ payload 信封(⑥ 上层整合,checklist §14)----------
// 出站翻译必须把目标语言随请求带到桥端:桥 config 的 defaults.targetLanguage 是入站目标
// (zh-Hans),出站 outgoingTarget 默认 en —— 不随请求走就会译反方向。
// 格式(上层约定:payload 对传输层仍是不透明字节,行/帧/窗口协议零改动):
//   t=<target>[;tm=<ms>]\n<原文>
// btipc05 增补 op 键(设置面板「保存/测试」+ 开机读配置迁移;旧通道 6726 后已死):
//   op=<config|test>[;tm=<ms>]\n<载荷>
//   - op=config:载荷 JSON(读 = {}、写 = {"config":{...}}),响应 JSON(含 maskCompact config)
//   - op=test  :载荷 JSON({} = 桥端默认 hello/zh-Hans),响应 JSON(translation / error)
// 键白名单之外的首行(未知 op、未知键、不安全字符集)→ 整条按裸文本一字不差透传
// (裸文本:/bt6737 冒烟、scripts/btipc_trq_e2e.js、老客户端 → 桥回退 config 默认,向后兼容)。
const TRQ_ENV_HEAD_RE =
  /^(?:op=(?:config|test)|t=[A-Za-z0-9-]{1,16})(?:;(?:op=(?:config|test)|t=[A-Za-z0-9-]{1,16}|tm=\d{1,7}))*$/;

function parseTrqEnvelope(raw) {
  const text = String(raw == null ? "" : raw);
  const bare = { text: text, target: undefined, timeoutMs: undefined, op: undefined };
  const nl = text.indexOf("\n");
  if (nl < 0) return bare; // 没有换行就不算信封(首行像信封头也不算)
  const head = text.slice(0, nl);
  if (!TRQ_ENV_HEAD_RE.test(head)) return bare;
  let op, target, timeoutMs;
  const segs = head.split(";");
  for (let i = 0; i < segs.length; i += 1) {
    const s = segs[i];
    if (s.indexOf("op=") === 0) op = s.slice(3);
    else if (s.indexOf("t=") === 0) target = s.slice(2);
    else if (s.indexOf("tm=") === 0) timeoutMs = parseInt(s.slice(3), 10);
  }
  return { text: text.slice(nl + 1), target: target, timeoutMs: timeoutMs, op: op };
}

module.exports = { parseGameLine, serveDL, parseTrqEnvelope, LINE_MAX, REQ_MAX_PAYLOAD };
