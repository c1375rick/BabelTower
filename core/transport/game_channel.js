"use strict";
// GameChannel(P1,2026-10-11):桥业务与 BTIPC 协议层之间的接口隔离壳。
// 职责:持有窗口表 + 提供桥用到的 9 种操作,**全部零逻辑转发**;
// bridge_server 从此只见本文件,不见 core/btipc/* —— 将来切换协议实现只改壳内,业务零改。
// 边界(解冻清单):壳只许转发;不承载业务逻辑;不绕改冻结模块行为;
// 发现 btipc 内部缺陷 → 记独立问题 + 申请解冻,禁止"顺手修在壳里"。
const btipc = require("../btipc/index.js");

class GameChannel {
  constructor() {
    this.table = new btipc.window.WindowTable();
  }

  // ---- 行入口(REQ/TRQ/CAN 解析 + §14.1 逐项校验)----
  parseGameLine(line) {
    return btipc.transport.parseGameLine(line);
  }

  // ---- TRQ 信封(t=/op= 键解析;键外首行裸文本透传)----
  parseTrqEnvelope(payload) {
    return btipc.transport.parseTrqEnvelope(payload);
  }

  // ---- 下行 /btipc/dl(每面板一位;内部用本通道的窗口表)----
  serveDL(q) {
    return btipc.transport.serveDL(this.table, q);
  }

  // ---- 帧编码(行头 + payload + CRC)----
  encode(id, payload) {
    return btipc.framer.encode(id, payload);
  }

  // ---- 窗口状态机(§6)----
  acceptReq(win, id, payload) {
    return this.table.acceptReq(win, id, payload);
  }

  setFrames(win, frames) {
    return this.table.setFrames(win, frames);
  }

  cancel(win) {
    return this.table.cancel(win);
  }

  gc() {
    return this.table.gc();
  }

  size() {
    return this.table.size();
  }
}

module.exports = { GameChannel };
