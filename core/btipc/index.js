"use strict";
// BTIPC 统一入口(P1,2026-10-11,解冻边界内批准新增)。
// 只做命名空间转发:四个冻结模块(crc16/framer/transport/window)原样透出 ——
// 不合并、不改名、不包函数,导出语义与旧调用方(require 单模块)逐项一致,
// 由 tests/btipc/index_surface_guard.test.js 钉死。
// 适配红线:发现冻结模块内部缺陷 → 记独立问题 + 提交解冻申请,
// 禁止在本层(或 core/transport 壳内)绕改冻结模块行为。
const crc16 = require("./crc16.js");
const framer = require("./framer.js");
const transport = require("./transport.js");
const windowMod = require("./window.js");

module.exports = {
  crc16: crc16, // { crc16, crc16Hex }
  framer: framer, // { encode, decode, Assembler, FRAME_BYTES, ... }
  transport: transport, // { parseGameLine, serveDL, parseTrqEnvelope, LINE_MAX, REQ_MAX_PAYLOAD }
  window: windowMod, // { WindowTable, WINDOW_TTL_MS, END_GC_MS }
};
