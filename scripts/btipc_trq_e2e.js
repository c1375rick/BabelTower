"use strict";
// ⑥ 桥级 E2E:真实 tail → 真 HTTP 轮询 /btipc/dl → 组帧解码。
// 不启动游戏:直接按 §5 行格式往 console.log 尾部写 TRQ,复现游戏侧行为。
// 跑法: node scripts/btipc_trq_e2e.js
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const { crc16 } = require("../core/btipc/crc16.js");
const { decode, fromBits, FRAME_BYTES } = require("../core/btipc/framer.js");
const { WindowTable } = require("../core/btipc/window.js");

const HOST = "127.0.0.1";
const PORT = 8791;
// 2026-10-15:游戏迁到 C:\SteamLibrary;DEADLOCK_ROOT 优先,兜底写新安装根。
const LOG =
  (process.env.DEADLOCK_ROOT || "C:/SteamLibrary/steamapps/common/Deadlock") +
  "/game/citadel/console.log";
const T_CLOSE_MS = Number(process.env.BT_CLOSE_MS || 600);
const MAX_ROUNDS = 200;

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

// 一轮 = 128 个面板请求并发发出(§3.1 每面板一位)
async function pollFrame(win, r) {
  const bits = new Array(128).fill(0);
  await Promise.all(
    Array.from({ length: 128 }, async (_, p) => {
      try {
        const res = await get("/btipc/dl?w=" + win + "&r=" + r + "&p=" + p + "&t=e2e-" + r + "-" + p);
        if (res.status === 200) bits[p] = 1;
      } catch (e) { /* 404/错误 = 位 0 */ }
    })
  );
  return decode(fromBits(bits));
}

async function runOnce(label, text) {
  const win = "e2e" + Math.floor(Math.random() * 0xffffff).toString(16).slice(-3);
  const id = Math.floor(Math.random() * 65536);
  const line = trqLine(win, id, text);
  fs.appendFileSync(LOG, "\n10/02 10:00:00 [PanoramaScript] [LCT] " + line.text + "\n", "utf8");
  console.log("[" + label + "] TRQ w=" + win + " id=" + ("0000" + id.toString(16)) + " text=" + JSON.stringify(text));

  const t0 = Date.now();
  const parts = {};
  let busyRounds = 0, dataRounds = 0;
  for (let r = 1; r <= MAX_ROUNDS; r += 1) {
    await sleep(T_CLOSE_MS);
    const d = await pollFrame(win, r);
    if (!d.ok) { console.log("  r=" + r + " CRC FAIL reason=" + d.reason); continue; }
    if (d.id !== id) { console.log("  r=" + r + " id_mismatch got=" + d.id); continue; }
    if (!d.valid) { busyRounds += 1; console.log("  r=" + r + " BUSY (t=" + (Date.now() - t0) + "ms)"); continue; }
    dataRounds += 1;
    if (!parts[d.seq]) parts[d.seq] = d.payload;
    console.log("  r=" + r + " seq=" + d.seq + " len=" + d.len + (d.end ? " END" : ""));
    if (d.end) {
      let max = -1;
      for (const k in parts) { const n = parseInt(k, 10); if (n > max) max = n; }
      const bufs = [];
      for (let i = 0; i <= max; i += 1) bufs.push(parts[i]);
      const out = Buffer.concat(bufs).toString("utf8");
      const dt = Date.now() - t0;
      console.log("[" + label + "] DONE busy=" + busyRounds + " dataRounds=" + dataRounds +
        " frames=" + (max + 1) + " out=" + JSON.stringify(out) + " dt=" + dt + "ms");
      return { ok: true, out: out, busy: busyRounds, dt: dt };
    }
  }
  console.log("[" + label + "] TIMEOUT after " + MAX_ROUNDS + " rounds");
  return { ok: false };
}

(async function () {
  console.log("=== ⑥ 桥级 E2E: TRQ → BUSY → 译文(裸文本兼容 + 信封定向)===\n");
  const a = await runOnce("1st", "hello");
  console.log("");
  const b = await runOnce("2nd(cached)", "hello");
  console.log("");
  const c = await runOnce("env-en", "t=en;tm=16000\n你好"); // 信封:出站方向 zh→en(checklist §14)
  console.log("");
  const d = await runOnce("env-zh", "t=zh-Hans;tm=16000\nthank you for the help"); // 信封:入站方向 en→zh
  console.log("\n=== 汇总 ===");
  console.log("1st     : " + (a.ok ? "ok busy=" + a.busy + " dt=" + a.dt + "ms out=" + JSON.stringify(a.out) : "FAIL"));
  console.log("2nd cache: " + (b.ok ? "ok busy=" + b.busy + " dt=" + b.dt + "ms out=" + JSON.stringify(b.out) : "FAIL"));
  console.log("env-en  : " + (c.ok ? "ok busy=" + c.busy + " dt=" + c.dt + "ms out=" + JSON.stringify(c.out) : "FAIL"));
  console.log("env-zh  : " + (d.ok ? "ok busy=" + d.busy + " dt=" + d.dt + "ms out=" + JSON.stringify(d.out) : "FAIL"));
  process.exit(0);
})().catch((e) => { console.error("E2E crash: " + (e && e.stack)); process.exit(1); });
