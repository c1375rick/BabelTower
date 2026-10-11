"use strict";
// tests/btipc/index_surface_guard.test.js —— P1 契约钉(2026-10-11)
// 1) core/btipc/index.js 必须与四个冻结模块**逐项同源**(引用相等,不许克隆/包装改语义);
// 2) GameChannel 壳 = 零逻辑转发:同参同果,行为与直连冻结件逐项等价;
// 3) 源码锁:bridge_server 不得再直连 core/btipc/*;壳只经 ../btipc/index.js 取物,依赖面仅一门。
// 红线:冻结模块(crc16/framer/transport/window)只审不改 —— 本测试只钉接口,不倒逼内部改行为。
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const CORE = path.join(ROOT, "core");
const btipc = require(path.join(CORE, "btipc", "index.js"));
const { GameChannel } = require(path.join(CORE, "transport", "game_channel.js"));
const { crc16 } = require(path.join(CORE, "btipc", "crc16.js"));

const PREFIX = "[PanoramaScript] [LCT] BTIPC ";
function reqLine(verb, text, win = "f3a1c2", id = 0x00c8) {
  const bytes = Buffer.from(text, "utf8");
  const crc = ("0000" + crc16(bytes).toString(16)).slice(-4);
  return PREFIX + verb + " w=" + win + " id=" + ("0000" + id.toString(16)).slice(-4) +
    " len=" + bytes.length + " crc=" + crc + " b64=" + bytes.toString("base64");
}

// ---------- 1) index 同源 ----------
test("index 四命名空间与直连 require 逐项同源(引用相等)", () => {
  const mods = {
    crc16: require(path.join(CORE, "btipc", "crc16.js")),
    framer: require(path.join(CORE, "btipc", "framer.js")),
    transport: require(path.join(CORE, "btipc", "transport.js")),
    window: require(path.join(CORE, "btipc", "window.js")),
  };
  assert.deepStrictEqual(Object.keys(btipc).sort(), ["crc16", "framer", "transport", "window"]);
  for (const k of Object.keys(mods)) {
    assert.strictEqual(btipc[k], mods[k], k + " 必须是同一模块对象");
    assert.deepStrictEqual(Object.keys(btipc[k]).sort(), Object.keys(mods[k]).sort(), k + " 导出面一致");
  }
});

test("桥用到的操作在 index 面上齐全(P1 改造面逐项核对)", () => {
  const need = [
    ["transport", "parseGameLine"],
    ["transport", "parseTrqEnvelope"],
    ["transport", "serveDL"],
    ["framer", "encode"],
    ["window", "WindowTable"],
  ];
  for (const [ns, sym] of need) {
    assert.strictEqual(typeof btipc[ns][sym], "function", ns + "." + sym);
  }
});

// ---------- 2) 壳行为等价(零逻辑转发) ----------
test("GameChannel 与直连冻结件同参同果(行入口三形态 + 信封两形态)", () => {
  const ch = new GameChannel();
  // REQ/TRQ 合法行、CAN 行、普通行(skip)、非法 CRC 行(reason)
  assert.deepStrictEqual(ch.parseGameLine(reqLine("TRQ", "hello can you push mid")),
    btipc.transport.parseGameLine(reqLine("TRQ", "hello can you push mid")));
  assert.deepStrictEqual(ch.parseGameLine(PREFIX + "CAN w=f3a1c2"),
    btipc.transport.parseGameLine(PREFIX + "CAN w=f3a1c2"));
  assert.deepStrictEqual(ch.parseGameLine("plain chat line"),
    btipc.transport.parseGameLine("plain chat line"));
  const bad = reqLine("TRQ", "tampered");
  assert.deepStrictEqual(ch.parseGameLine(bad), btipc.transport.parseGameLine(bad));
  // TRQ 信封:键形 + 裸文本
  assert.deepStrictEqual(ch.parseTrqEnvelope("op=test;tm=9000\n{}"),
    btipc.transport.parseTrqEnvelope("op=test;tm=9000\n{}"));
  assert.deepStrictEqual(ch.parseTrqEnvelope("bare text"),
    btipc.transport.parseTrqEnvelope("bare text"));
});

test("GameChannel 窗口状态机与直连 WindowTable 逐步等价", () => {
  const ch = new GameChannel();
  const ref = new btipc.window.WindowTable();
  assert.strictEqual(ch.size(), ref.size());
  assert.strictEqual(ch.size(), 0);

  // acceptReq:剥时间戳逐字段比(tReq/tLast 是 Date.now,毫秒级不可比)
  const payload = Buffer.from("Hello BTIPC", "utf8");
  const a = ch.acceptReq("f3a1c2", 0x00c8, payload);
  const b = ref.acceptReq("f3a1c2", 0x00c8, payload);
  const strip = (o) => ({ id: o.id, payload: o.payload, frames: o.frames, frameStartRound: o.frameStartRound, endServedAt: o.endServedAt });
  assert.deepStrictEqual(strip(a), strip(b));
  assert.strictEqual(ch.size(), ref.size());

  // setFrames / gc / serveDL / cancel
  const frames = btipc.framer.encode(1, Buffer.from("x", "utf8"));
  assert.strictEqual(ch.setFrames("f3a1c2", frames), ref.setFrames("f3a1c2", frames));
  assert.strictEqual(ch.gc(), ref.gc());
  const q = { w: "f3a1c2", r: "5", p: "0", t: "0" };
  assert.deepStrictEqual(ch.serveDL(q), btipc.transport.serveDL(ref, q));
  assert.deepStrictEqual(ch.serveDL({ w: "000000", r: "1", p: "0" }),
    btipc.transport.serveDL(ref, { w: "000000", r: "1", p: "0" }));
  assert.strictEqual(ch.cancel("f3a1c2"), ref.cancel("f3a1c2"));
  assert.strictEqual(ch.size(), ref.size());
});

test("GameChannel encode 与直连 framer.encode 同参同果(Buffer 与空串两形态)", () => {
  const ch = new GameChannel();
  assert.deepStrictEqual(ch.encode(0x00c8, Buffer.from("hi", "utf8")),
    btipc.framer.encode(0x00c8, Buffer.from("hi", "utf8")));
  assert.deepStrictEqual(ch.encode(0x00c9, ""),
    btipc.framer.encode(0x00c9, ""));
});

// ---------- 3) 源码锁 ----------
test("源码锁:桥不直连 btipc/无旧标识符;壳依赖面仅 index 一门", () => {
  const bridge = fs.readFileSync(path.join(CORE, "bridge_server.js"), "utf8");
  assert.ok(!/require\(["'][^"']*btipc\//.test(bridge), "bridge_server 禁止直连 core/btipc/*(P1 收口)");
  for (const old of ["btipcWin", "btipcXfer", "btipcFramer", "btipcTable"]) {
    assert.ok(bridge.indexOf(old) === -1, "遗留旧标识符: " + old);
  }

  const shellPath = path.join(CORE, "transport", "game_channel.js");
  const shell = fs.readFileSync(shellPath, "utf8");
  assert.ok(!/require\(["'][^"']*btipc\/(crc16|framer|transport|window)\.js["']\)/.test(shell),
    "壳禁止直连冻结模块(只经 index)");
  assert.ok(/require\(["']\.\.\/btipc\/index\.js["']\)/.test(shell), "壳必须经 ../btipc/index.js");
  assert.deepStrictEqual(shell.match(/require\([^)]*\)/g), ['require("../btipc/index.js")'],
    "壳的依赖面必须只有 index 一门");
});
