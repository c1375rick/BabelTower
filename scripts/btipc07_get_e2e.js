"use strict";
// btipc07 桥级 E2E:真实 tail → 真 HTTP 轮询 /btipc/dl → 组帧解码,验证 op=config + {"get"}。
// 不启动游戏:直接按 §5 行格式往 console.log 尾部写 TRQ,复现游戏侧行为
// (与 scripts/btipc_trq_e2e.js 同一套通道)。
//
// 跑法: node scripts/btipc07_get_e2e.js
//
// 覆盖:
//   ① 握手 same(零传输)—— gamenames / quickchat 打包基线与桥同源时的常态
//   ② 握手 full(指纹不同)+ 取第 1 片 + 分片预算 lim
//   ③ exp 指纹不符 -> fp_changed(拉到一半配置被重建)
//   ④ delta 全程:临时让 config/gamenames.json 与基线分叉,收齐、解析、施加、对指纹
//      (config 文件在 finally 里恢复,另有一份模块级兜底副本)
//   ⑤ get=health / 未知 get / op=config {} 回归(分流不影响原读)
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const { crc16 } = require("../core/btipc/crc16.js");
const { decode, fromBits } = require("../core/btipc/framer.js");
const syncData = require("../core/sync_data.js");

const HOST = "127.0.0.1";
const PORT = 8791;
// 2026-10-15:游戏迁到 C:\SteamLibrary;DEADLOCK_ROOT 优先,兜底写新安装根。
const LOG =
  (process.env.DEADLOCK_ROOT || "C:/SteamLibrary/steamapps/common/Deadlock") +
  "/game/citadel/console.log";
const T_CLOSE_MS = Number(process.env.BT_CLOSE_MS || 600);
const MAX_ROUNDS = Number(process.env.BT_MAX_ROUNDS || 400);

const ROOT = path.join(__dirname, "..");
const GN_PATH = path.join(ROOT, "config", "gamenames.json");
const PAIRS_PATH = path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat_gamenames_pairs_fallback.js");
const QC_PATH = path.join(ROOT, "config", "quickchat.json");
const QCFB_PATH = path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat_quickchat_fallback.js");

// 模块级兜底副本:脚本任何位置崩掉都要能把 config/gamenames.json 还回去
let gnRawBackup = "";
try { gnRawBackup = fs.readFileSync(GN_PATH, "utf8"); } catch (e) { /* ignore */ }

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS | " + label); }
  else { fail++; console.log("  FAIL | " + label); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 信封是 op=<config|test> + \n + 载荷(core/btipc/transport.js §5.1 冻结格式);
// 载荷里的 "get" 字段才是 btipc07 的新语义。
function env(obj) { return "op=config\n" + JSON.stringify(obj); }

function httpGet(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: HOST, port: PORT, path: p }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(8000, () => req.destroy(new Error("timeout")));
  });
}

function trqLine(win, id, text) {
  const bytes = Buffer.from(text, "utf8");
  const crc = ("0000" + crc16(bytes).toString(16)).slice(-4);
  return "BTIPC TRQ w=" + win + " id=" + ("0000" + id.toString(16)).slice(-4) +
    " len=" + bytes.length + " crc=" + crc + " b64=" + bytes.toString("base64");
}

async function pollFrame(win, r) {
  const bits = new Array(128).fill(0);
  await Promise.all(
    Array.from({ length: 128 }, async (_, p) => {
      try {
        const res = await httpGet("/btipc/dl?w=" + win + "&r=" + r + "&p=" + p + "&t=e2e7-" + r + "-" + p);
        if (res.status === 200) bits[p] = 1;
      } catch (e) { /* 404/错误 = 位 0 */ }
    })
  );
  return decode(fromBits(bits));
}

// 一次 TRQ = 一次请求/应答;返回桥回的 JSON 文本
async function trq(label, text, maxRounds) {
  // w= 必须是恰好 6 位十六进制(core/btipc/transport.js WIN_RE 冻结)
  const win = "e2e" + Math.floor(Math.random() * 0xffffff).toString(16).slice(-3);
  const id = Math.floor(Math.random() * 65536);
  fs.appendFileSync(LOG, "\n10/04 03:00:00 [PanoramaScript] [LCT] " + trqLine(win, id, text) + "\n", "utf8");
  const t0 = Date.now();
  const parts = {};
  const cap = maxRounds || MAX_ROUNDS;
  for (let r = 1; r <= cap; r += 1) {
    await sleep(T_CLOSE_MS);
    const d = await pollFrame(win, r);
    if (!d.ok) continue;
    if (d.id !== id) continue;
    if (!d.valid) continue;
    if (!parts[d.seq]) parts[d.seq] = d.payload;
    if (d.end) {
      let max = -1;
      for (const k in parts) { const n = parseInt(k, 10); if (n > max) max = n; }
      const bufs = [];
      for (let i = 0; i <= max; i += 1) bufs.push(parts[i]);
      return { ok: true, out: Buffer.concat(bufs).toString("utf8"), dt: Date.now() - t0, frames: max + 1 };
    }
  }
  return { ok: false, dt: Date.now() - t0 };
}

function parse(res, label) {
  if (!res.ok) { ok(false, label + " 有应答(超时)"); return null; }
  let j = null;
  try { j = JSON.parse(res.out); } catch (e) { j = null; }
  ok(!!j, label + " 应答是合法 JSON (" + res.dt + "ms, " + res.frames + " 帧)");
  return j;
}

(async function () {
  console.log("=== btipc07 E2E: op=config + {\"get\"} 走真实 TRQ 通道 ===\n");

  // ---------- 0) 基线数据 ----------
  const gn = JSON.parse(fs.readFileSync(GN_PATH, "utf8"));
  const pairs = syncData.extractAssignment(fs.readFileSync(PAIRS_PATH, "utf8"), "LCT_GAMENAMES_PAIRS");
  const bakedFp = syncData.namesFingerprint(pairs);
  const qc = JSON.parse(fs.readFileSync(QC_PATH, "utf8"));
  const qcFp = syncData.extractAssignment(fs.readFileSync(QCFB_PATH, "utf8"), "LCT_QUICKCHAT_FALLBACK_FINGERPRINT");
  console.log("baked gamenames fp=" + bakedFp + " (" + Object.keys(pairs).length + " 条)  config fp=" + syncData.namesFingerprint(gn));
  console.log("baked quickchat fp=" + qcFp + "  config fp=" + qc.fingerprint + "\n");

  // ---------- ⑤ get=health ----------
  console.log("--- get=health ---");
  let j = parse(await trq("health", env({ get: "health" })), "health");
  if (j) {
    ok(j.ok === true && typeof j.provider === "string" && typeof j.version === "string",
      "health 回 provider + version: provider=" + j.provider + " version=" + j.version);
  }

  // ---------- 未知 get ----------
  console.log("--- 未知 get(不许炸)---");
  j = parse(await trq("bogus", env({ get: "bogus" })), "bogus");
  if (j) ok(j.ok === false && j.error === "unknown_get", "未知 get -> {ok:false, error:unknown_get}");

  // ---------- ① 握手 same(常态零传输)----------
  console.log("--- 握手:基线同源 -> same=true,零传输 ---");
  j = parse(await trq("gn-same", env({ get: "gamenames", fp: bakedFp })), "gamenames");
  if (j) {
    ok(j.ok === true && j.same === true && j.total === 0, "gamenames same=true total=0: " + JSON.stringify(j));
    ok(j.mode === "delta" && j.count === Object.keys(pairs).length, "mode/count 正确: " + j.mode + "/" + j.count);
  }
  j = parse(await trq("qc-same", env({ get: "quickchat", fp: qcFp })), "quickchat");
  if (j) ok(j.ok === true && j.same === true && j.total === 0, "quickchat same=true total=0: " + JSON.stringify(j));

  // ---------- ② 握手 full + 第 1 片 ----------
  console.log("--- 握手:指纹不同 -> full + 取片 ---");
  const FAKE = "fnv1a-deadbeef";
  const hs = parse(await trq("gn-full", env({ get: "gamenames", fp: FAKE })), "gamenames full");
  if (hs) {
    ok(hs.ok === true && hs.same === false && hs.mode === "full" && hs.total > 5000,
      "full 握手: mode=full total=" + hs.total);
    j = parse(await trq("gn-chunk0", env({ get: "gamenames", fp: FAKE, off: 0, lim: 90, exp: hs.fingerprint })), "chunk0");
    if (j) {
      ok(j.ok === true && j.off === 0 && typeof j.part === "string" && j.part.length > 0 && j.done === false,
        "第 1 片: off=" + j.off + " part.len=" + (j.part && j.part.length) + " done=" + j.done);
      const bytes = Buffer.byteLength(JSON.stringify(j.part || ""), "utf8");
      ok(bytes <= 98, "单片 JSON 编码后 " + bytes + "B <= 90B+8B 余量(出站 15s 丢弃线)");
      j = parse(await trq("gn-fpch", env({ get: "gamenames", fp: FAKE, off: 0, lim: 90, exp: "fnv1a-00000000" })), "fp_changed");
      if (j) ok(j.ok === false && j.error === "fp_changed", "exp 与桥侧现值不符 -> fp_changed");
    }
  }

  // ---------- ⑤ op=config {} 回归(分流不能影响原读)----------
  console.log("--- 回归:op=config {} 原读通道 ---");
  j = parse(await trq("cfg", env({}), 400), "config read");
  if (j) ok(j.ok === true && !!j.config, "config 读仍正常(与 get 分流互斥)");

  // ---------- ④ delta 全程 ----------
  console.log("--- delta:临时让 config 与基线分叉,收齐后施加 ---");
  const gnRaw = gnRawBackup;
  const restore = function () {
    if (fs.readFileSync(GN_PATH, "utf8") !== gnRaw) fs.writeFileSync(GN_PATH, gnRaw, "utf8");
  };
  try {
    const mut = JSON.parse(gnRaw);
    mut.__BTIPC07_E2E__ = "E2E 临时条目";
    mut.Abrams = "亚伯兰-E2E";
    fs.writeFileSync(GN_PATH, JSON.stringify(mut, null, 2), "utf8");

    const hsd = parse(await trq("gn-delta", env({ get: "gamenames", fp: bakedFp })), "gamenames delta");
    if (hsd) {
      ok(hsd.ok === true && hsd.same === false && hsd.mode === "delta" && hsd.total < 600,
        "delta 握手: mode=" + hsd.mode + " total=" + hsd.total + "(full 是 " + (hs ? hs.total : "?") + ")");
      let acc = "";
      let off = 0;
      let n = 0;
      let aborted = "";
      for (; n < 12; n++) {
        const c = parse(await trq("gn-dp" + n,
          env({ get: "gamenames", fp: bakedFp, off: off, lim: 90, exp: hsd.fingerprint })), "delta 片 " + n);
        if (!c || typeof c.part !== "string") { aborted = "bad_chunk"; break; }
        acc += c.part;
        off = c.off + c.part.length;
        if (c.done) break;
      }
      ok(!aborted && n < 12 && acc.length === hsd.total,
        "delta 收齐: chunks=" + (n + 1) + " chars=" + acc.length + "/" + hsd.total + (aborted ? " (" + aborted + ")" : ""));
      try {
        const delta = JSON.parse(acc);
        const merged = Object.assign({}, pairs, delta.added, delta.changed);
        for (const k of delta.removed) delete merged[k];
        ok(delta.delta === true && syncData.namesFingerprint(merged) === hsd.fingerprint,
          "施加 delta 后与桥侧指纹一致 -> 游戏侧可直接用");
        ok(merged.Abrams === "亚伯兰-E2E" && !!merged.__BTIPC07_E2E__,
          "新增/改译名都在 delta 里(added=" + (delta.added && Object.keys(delta.added).length) +
          " removed=" + (delta.removed || []).length + ")");
      } catch (e) {
        ok(false, "delta JSON 解析/施加: " + e.message);
      }
    }
  } finally {
    restore();
  }

  // ---------- 恢复校验 ----------
  const after = fs.readFileSync(GN_PATH, "utf8");
  ok(after === gnRaw, "config/gamenames.json 已原样恢复(字节相同)");
  ok(syncData.namesFingerprint(JSON.parse(after)) === syncData.namesFingerprint(gn),
    "恢复后指纹回到 " + syncData.namesFingerprint(gn));

  // ---------- HTTP 侧回归(/api/v1/gamenames 补了 fingerprint)----------
  try {
    const r = await httpGet("/api/v1/gamenames");
    const jj = JSON.parse(r.body);
    ok(typeof jj.fingerprint === "string" && jj.fingerprint === syncData.namesFingerprint(gn),
      "HTTP /api/v1/gamenames 带 fingerprint=" + jj.fingerprint);
  } catch (e) {
    ok(false, "HTTP /api/v1/gamenames: " + e.message);
  }

  console.log("\n=== RESULT: PASS " + pass + " / FAIL " + fail + " ===");
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("E2E crash: " + (e && e.stack));
  try { fs.writeFileSync(GN_PATH, gnRawBackup, "utf8"); } catch (x) { /* ignore */ }
  process.exit(1);
});
