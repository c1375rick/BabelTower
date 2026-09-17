// core/quickchat_sync.js — quickchat 语料同步裁决【同源参考实现,纯函数】
//
// 背景(LEARNINGS 2026-09-17 ⑥b/⑦③):/api/v1/quickchat 早已返回 version,但它是手动递增整数,
// 忘 bump 时握手形同虚设。改为内容指纹(见 core/quickchat.js fingerprintTemplates):
// 客户端 syncQuickChat 用本函数裁决"采纳桥语料 / 保留兑底 / 重拉一次",core 侧为实现源,
// 客户端保留同步副本(与 core/quickchat_match.js 同一先例)。
//
// 决策表:
//   ① 桥不可达/响应无效            → 保留兑底,告警一次(offline)
//   ② 桥指纹 === 兑底指纹          → 采纳桥语料(内容相同,采纳只为标记 synced)
//   ③ 指纹缺失或不一致,首次        → 重拉一次(防瞬时/截断响应误判)
//   ④ 重拉后仍不一致               → 采纳桥语料(桥从本机游戏文件实时生成,是更新的一方)
//                                     + 告警一次(mismatch,提示兑底已过期,需重跑生成器+重编 VPK)
"use strict";

/**
 * @param {object|null} res    桥响应 { ok, fingerprint, count, templates }
 * @param {object}      local  兑底元数据 { fingerprint, count }(旧兑底文件无指纹 → fingerprint:null)
 * @param {object}      st     会话状态 { reloadTried, warnedOffline, warnedMismatch }(由调用方持有并回写)
 * @returns {{adopt: Array|null, synced: boolean, reload: boolean, warn: string|null,
 *           state: {reloadTried: boolean, warnedOffline: boolean, warnedMismatch: boolean}}}
 */
function evaluateQuickChatSync(res, local, st) {
  const s = {
    reloadTried: !!(st && st.reloadTried),
    warnedOffline: !!(st && st.warnedOffline),
    warnedMismatch: !!(st && st.warnedMismatch),
  };
  const out = { adopt: null, synced: false, reload: false, warn: null, state: s };

  const valid = res && res.ok && Array.isArray(res.templates) && res.templates.length > 0;
  if (!valid) {
    // 离线是常态(桥未装/未启动),只告警一次,不刷屏
    if (!s.warnedOffline) {
      out.warn = "quickchat: 桥不可达/响应无效,保留兑底语料";
      s.warnedOffline = true;
    }
    return out;
  }

  const fpSame = !!(res.fingerprint && local && local.fingerprint && res.fingerprint === local.fingerprint);
  if (fpSame) {
    out.adopt = res.templates;
    out.synced = true;
    return out;
  }

  // 指纹缺失(旧桥/旧兑底)或不一致:先重拉一次确认,再采纳并告警
  if (!s.reloadTried) {
    s.reloadTried = true;
    out.reload = true;
    return out;
  }
  out.adopt = res.templates;
  out.synced = true;
  if (!s.warnedMismatch) {
    out.warn = "quickchat: 桥侧语料与兑底指纹不一致,已采用桥侧语料(兑底过期:重跑 node core/quickchat.js 并重编 VPK)";
    s.warnedMismatch = true;
  }
  return out;
}

module.exports = { evaluateQuickChatSync };
