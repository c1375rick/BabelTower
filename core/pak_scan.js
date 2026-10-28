"use strict";
// 排外扫描:检测 addons 目录里多份 BabelTower(或同类翻译 mod)并存。
//
// 动机(2026-10-28 实测):pak08(1.2.1/btipc10)与 pak15(btipc12)双份并存——
// 同 ID 面板(LCTBridgePanel)混合加载,boot 版本串错乱、行为不可预测(§14"两份同装"翻版)。
// 游戏内 Panorama 沙盒无法枚举 vpk,桥有文件系统访问权 → 检测放桥侧,
// 结果经 /api/v1/health 带给游戏内状态条与 /ui 页面显示。
//
// 方法:vpk 内的 .vjs_c 编译产物是明文转码(非加密),直接对 vpk 做二进制特征搜索即可命中。
// 只扫 ≤10MB 的 vpk:翻译类 mod 全部在 1MB 量级,游戏本体 pak 最小 ~23MB ——
// 阈值安全排除大包(最大单包 862MB,全扫一遍不现实也无必要)。
//
// 只报告不删除:卸载动作留给用户/DMM,自动删文件的风险远大于收益。

const fs = require("fs");
const path = require("path");

// BabelTower 唯一面板 ID:跨版本恒定(0.x 起),改名即破坏向后兼容,可作身份特征。
const FEATURE_PANEL_ID = "LCTBridgePanel";
const MAX_SCAN_BYTES = 10 * 1024 * 1024;
const VERSION_RE = /VERSION\s*=\s*"([^"]{1,80})"/;

// 二进制分块搜索(避免整文件驻留内存的写法留作将来;当前 ≤10MB 直接读,
// 块边界跨切问题因此不存在——整文件载入后 indexOf 无边界盲区)。
function bufferContains(buf, needle) {
  return buf.indexOf(needle) !== -1;
}

function extractVersion(buf) {
  const m = VERSION_RE.exec(buf.toString("latin1"));
  return m ? m[1] : "unknown";
}

// 扫描 addonsDir 下所有 *.vpk,返回命中 BabelTower 特征的清单。
// 结构:{ scanned, skipped, hits: [{ file, version, size, mtimeMs }], error }
function scanAddons(addonsDir) {
  const result = { scanned: 0, skipped: 0, hits: [], error: null };
  let files;
  try {
    files = fs.readdirSync(addonsDir);
  } catch (e) {
    result.error = String((e && e.message) || e);
    return result;
  }
  const needle = Buffer.from(FEATURE_PANEL_ID, "utf8");
  for (const f of files) {
    if (!/\.vpk$/i.test(f)) continue;
    const full = path.join(addonsDir, f);
    let st;
    try {
      st = fs.statSync(full);
    } catch (e) {
      continue;
    }
    if (!st.isFile()) continue;
    if (st.size > MAX_SCAN_BYTES) {
      result.skipped += 1;
      continue;
    }
    let buf;
    try {
      buf = fs.readFileSync(full);
    } catch (e) {
      continue;
    }
    result.scanned += 1;
    if (!bufferContains(buf, needle)) continue;
    result.hits.push({
      file: f,
      version: extractVersion(buf),
      size: st.size,
      mtimeMs: st.mtimeMs,
    });
  }
  // 命中按文件名排序,输出稳定(测试与日志都好对)
  result.hits.sort(function (a, b) { return a.file < b.file ? -1 : a.file > b.file ? 1 : 0; });
  return result;
}

// 语义化:单份=正常;多份=排外告警;0 份=mod 可能没装对槽(桥只读不改)。
function summarize(scan) {
  const n = (scan && scan.hits ? scan.hits.length : 0);
  return {
    count: n,
    duplicates: n > 1,
    missing: n === 0,
    items: (scan && scan.hits) || [],
    error: (scan && scan.error) || null,
  };
}

module.exports = {
  scanAddons: scanAddons,
  summarize: summarize,
  FEATURE_PANEL_ID: FEATURE_PANEL_ID,
  MAX_SCAN_BYTES: MAX_SCAN_BYTES,
};
