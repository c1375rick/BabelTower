"use strict";
// P2 桥级 E2E:op=log 聊天日志迁 BTIPC(2026-10-11)。
// 不启动游戏:直接按 §5 行格式往 console.log 尾部写 TRQ,复现游戏侧行为,真实桥处理。
// 跑法: node scripts/btipc_op_log_e2e.js   (要求桥在 8791 运行;chatLog.enabled=true)
// 验收:
//   1) 合法日志载荷 → 应答 {"ok":true,"written":1} 且 logs/chat/<matchId>.jsonl 落盘含标记;
//   2) 坏 JSON 体(首行仍为 op=log)→ {"ok:false","error":"bad_json"}(形状闸放行、语义闸拒绝);
//   3) 裸文本 TRQ 不受影响 → 走翻译(向后兼容,老通道语义不回归)。
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const { crc16 } = require("../core/btipc/crc16.js");
const { decode, fromBits } = require("../core/btipc/framer.js");

const HOST = "127.0.0.1";
const PORT = 8791;
const LOG = "F:/SteamLibrary/steamapps/common/Deadlock/game/citadel/console.log";
const T_CLOSE_MS = Number(process.env.BT_CLOSE_MS || 600);
const MAX_ROUNDS = 200;
const MATCH_ID = "e2e-p2-oplog";
const CHAT_FILE = path.join(__dirname, "..", "logs", "chat", MATCH_ID + ".jsonl");

function get(pathAndQuery) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: HOST, port: PORT, path: pathAndQuery }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.setTimeout(5000, () => { req.destroy(new Error("timeout")); });
  });
}

function trqLine(win, id, text) {
  const bytes = Buffer.from(text, "utf8");
  const crc = ("0000" + crc16(bytes).toString(16)).slice(-4);
  return {
    text: "BTIPC TRQ w=" + win + " id=" + ("0000" + id.toString(16)).slice(-4) +
      " len=" + bytes.length + " crc=" + crc + " b64=" + bytes.toString("base64"),
  };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function pollFrame(win, r) {
  const bits = new Array(128).fill(0);
  await Promise.all(
    Array.from({ length: 128 }, async (_, p) => {
      try {
        const res = await get("/btipc/dl?w=" + win + "&r=" + r + "&p=" + p + "&t=e2e-log-" + r + "-" + p);
        if (res.status === 200) bits[p] = 1;
      } catch (e) { /* 404/错误 = 位 0 */ }
    })
  );
  return decode(fromBits(bits));
}

async function runOnce(label, text) {
  const win = "10a" + Math.floor(Math.random() * 0xffffff).toString(16).slice(-3);
  const id = Math.floor(Math.random() * 65536);
  const line = trqLine(win, id, text);
  fs.appendFileSync(LOG, "\n10/11 12:00:00 [PanoramaScript] [LCT] " + line.text + "\n", "utf8");
  console.log("[" + label + "] TRQ w=" + win + " len=" + text.length);

  const parts = {};
  let busyRounds = 0;
  for (let r = 1; r <= MAX_ROUNDS; r += 1) {
    await sleep(T_CLOSE_MS);
    const d = await pollFrame(win, r);
    if (!d.ok || d.id !== id) continue;
    if (!d.valid) { busyRounds += 1; continue; }
    if (!parts[d.seq]) parts[d.seq] = d.payload;
    if (d.end) {
      let max = -1;
      for (const k in parts) { const n = parseInt(k, 10); if (n > max) max = n; }
      const bufs = [];
      for (let i = 0; i <= max; i += 1) bufs.push(parts[i]);
      const out = Buffer.concat(bufs).toString("utf8");
      console.log("[" + label + "] DONE busy=" + busyRounds + " out=" + out);
      return { ok: true, out: out };
    }
  }
  console.log("[" + label + "] TIMEOUT after " + MAX_ROUNDS + " rounds");
  return { ok: false };
}

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS |", label); }
  else { fail++; console.log("  FAIL |", label); }
}

(async function () {
  console.log("=== P2 E2E: op=log → TRQ → {ok,written} + 落盘 ===\n");
  if (fs.existsSync(CHAT_FILE)) fs.unlinkSync(CHAT_FILE);
  const marker = "P2-E2E-OPLOG-" + Date.now();

  // 1) 合法日志载荷(与游戏侧 flushChatLog 同构:op=log\n + JSON{matchId,lines})
  const body = JSON.stringify({
    matchId: MATCH_ID,
    lines: [{ t: new Date().toISOString(), sender: "e2e", channel: "all", isOwn: false, text: marker }],
  });
  const a = await runOnce("log-ok", "op=log\n" + body);
  let parsedA = null;
  try { parsedA = JSON.parse(a.out); } catch (e) {}
  ok(a.ok && parsedA && parsedA.ok === true && parsedA.written === 1, "合法日志载荷 → {ok:true,written:1}");
  ok(fs.existsSync(CHAT_FILE) && fs.readFileSync(CHAT_FILE, "utf8").indexOf(marker) >= 0,
    "logs/chat/" + MATCH_ID + ".jsonl 落盘含标记");

  // 2) 坏 JSON 体(形状闸放行,语义闸拒绝)
  const b = await runOnce("log-badjson", "op=log\n{not-json");
  let parsedB = null;
  try { parsedB = JSON.parse(b.out); } catch (e) {}
  ok(b.ok && parsedB && parsedB.ok === false && parsedB.error === "bad_json",
    "坏 JSON 体 → {ok:false,error:bad_json}(不落盘、不崩桥)");

  // 3) 裸文本 TRQ 不受 op=log 迁移影响(向后兼容;译文内容不作断言,只要非空/非错误 JSON)
  const c = await runOnce("bare-text", "hello");
  let parsedC = null;
  try { parsedC = JSON.parse(c.out); } catch (e) {}
  ok(c.ok && (parsedC === null || parsedC.ok !== false || parsedC.error !== "bad_json"),
    "裸文本 TRQ 仍走翻译(不被 op=log 识别误吞)");

  console.log("\n=== 汇总 ===\n" + pass + " PASS / " + fail + " FAIL");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("E2E crash: " + (e && e.stack)); process.exit(1); });
