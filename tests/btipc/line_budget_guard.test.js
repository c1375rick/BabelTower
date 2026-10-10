// 回归护栏:J1 的 1000 字符行预算必须按【真实引擎前缀】核算(2026-10-09 审计)。
//
// 背景:frame.test.js / translate.test.js 里的最坏行用的前缀是
//   "[PanoramaScript] [LCT] BTIPC " = 29 字符
// 而 console.log(-condebug) 实际写的整行是
//   "10/09 22:00:04 [PanoramaScript] [LCT] BTIPC REQ ..." = 引擎前缀 32 + "[LCT] " 6 = 38
// 即测试少算 15 字符。两侧都不越 1000,但【真实余量只有 6 字符】而非测试报告的 21:
//   真实最坏 680B payload = 32 + 6 + 6 + 42 + 908 = 994 / 1000
//   payload 提到 685B 就变 1002 → parseGameLine 返 line_too_long → 静默 drop →
//   客户端白等 30s REQ_TIMEOUT 才回落原文。而旧测试在 685B 时仍是 979、照样绿。
//
// 本文件把「按真实前缀算，REQ_MAX_PAYLOAD 必须装得下」钉成不变量。
// 改 REQ_MAX_PAYLOAD 或改行格式前先看这里。
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { parseGameLine, REQ_MAX_PAYLOAD, LINE_MAX } =
  require("../../core/btipc/transport.js");
const { crc16 } = require("../../core/btipc/crc16.js");

// 实测自 console.log(2026-10-09,1216 行 [LCT],前缀长度 min=max=32):
//   "10/09 22:00:04 [PanoramaScript] "  = 15(日期/时间)+ 17(通道)
const ENGINE_PREFIX = "01/01 00:00:00 [PanoramaScript] ";
assert.strictEqual(ENGINE_PREFIX.length, 32, "引擎前缀长度自检");

// 从游戏侧原样拼一条上行行(照抄 lingua_chat.js:4215 的 log() 输出形状)
function realUpLine(verb, payload, win, id) {
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  const crc = ("0000" + crc16(bytes).toString(16)).slice(-4);
  return ENGINE_PREFIX + "[LCT] BTIPC " + verb +
    " w=" + win + " id=" + id + " len=" + bytes.length +
    " crc=" + crc + " b64=" + bytes.toString("base64");
}

// 最坏 payload:纯汉 = 3B/字 → 向下取整到 3 的倍数，正好打满 REQ_MAX_PAYLOAD
function worstPayload() {
  const n = Math.floor(REQ_MAX_PAYLOAD / 3) * 3;
  return Buffer.from("汉".repeat(n / 3), "utf8");
}

test("真实前缀下最坏 REQ 行仍 ≤ LINE_MAX，且余量被显式算出来", () => {
  const worst = worstPayload();
  const line = realUpLine("REQ", worst, "f3a1c2", "00c8");
  assert.ok(line.length <= LINE_MAX,
    "最坏行 " + line.length + " > " + LINE_MAX);
  const margin = LINE_MAX - line.length;
  // 余量 >= 6:引擎前缀每多 1 字符就吃 1，低于 6 说明行预算已接近悬崖
  assert.ok(margin >= 6,
    "真实余量已掉到 " + margin + " 字符(应 >= 6)。若引擎前缀变长或 REQ_MAX_PAYLOAD 变大，先确认整行仍 <= " + LINE_MAX);
  assert.ok(parseGameLine(line).ok, "最坏行必须可解析");
});

test("真实前缀下最坏 TRQ 行仍 ≤ LINE_MAX，且与 REQ 逐字节等长", () => {
  const worst = worstPayload();
  const req = realUpLine("REQ", worst, "f3a1c2", "00c8");
  const trq = realUpLine("TRQ", worst, "f3a1c2", "00c8");
  assert.strictEqual(trq.length, req.length, "REQ/TRQ 等长(命令词同为 3 字符)");
  assert.ok(trq.length <= LINE_MAX, "最坏 TRQ 行 " + trq.length + " > " + LINE_MAX);
  const p = parseGameLine(trq);
  assert.ok(p.ok, "最坏 TRQ 行必须可解析");
  assert.strictEqual(p.cmd, "TRQ");
  assert.strictEqual(p.translate, true);
});

test("REQ_MAX_PAYLOAD 不得超过真实前缀下的可装上限", () => {
  // 反推:整行 = ENGINE_PREFIX(32) + "[LCT] BTIPC "(12) + 行头(42) + b64(payload)
  // b64 长度 = ceil(payload/3)*4，且必须是 4 的倍数(严格 base64)
  const FIXED = ENGINE_PREFIX.length + "[LCT] BTIPC ".length +
    "REQ w=000000 id=0000 len=999 crc=0000 b64=".length;
  assert.strictEqual(FIXED, 86, "固定段长度自检(86 = 32 引擎前缀 + 12 \"[LCT] BTIPC \" + 42 行头)");
  let maxFit = 0;
  for (let n = REQ_MAX_PAYLOAD; n <= REQ_MAX_PAYLOAD + 64; n++) {
    const b64 = Math.ceil(n / 3) * 4;
    if (FIXED + b64 <= LINE_MAX) maxFit = n; else break;
  }
  assert.ok(maxFit >= REQ_MAX_PAYLOAD,
    "REQ_MAX_PAYLOAD=" + REQ_MAX_PAYLOAD + " 在真实前缀下装不下(可装上限 " + maxFit + ")");
});

test("console.log 若存在，则实测引擎前缀不得超过护栏采用的长度", () => {
  const candidates = [
    "F:/SteamLibrary/steamapps/common/Deadlock/game/citadel/console.log",
    "C:/Program Files (x86)/Steam/steamapps/common/Deadlock/game/citadel/console.log",
  ];
  const found = candidates.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!found) return; // 游戏未安装/未跑过 → 跳过，不作为失败
  const txt = fs.readFileSync(found, "utf8");
  const idx = txt.indexOf("[LCT] BTIPC ");
  if (idx === -1) return; // 还没跑过 BTIPC 上行 → 跳过
  const lines = txt.split(/\r?\n/).filter(l => l.indexOf("[LCT] BTIPC ") !== -1);
  const maxPrefix = Math.max.apply(null, lines.map(l => l.indexOf("[LCT] BTIPC ")));
  assert.ok(maxPrefix <= ENGINE_PREFIX.length,
    "实测引擎前缀 " + maxPrefix + " 字符 > 护栏采用的 " + ENGINE_PREFIX.length +
    ",真实最坏行会越过 " + LINE_MAX + ",需重算 REQ_MAX_PAYLOAD");
});
