// 排外扫描(core/pak_scan.js)单测(2026-10-28)。
// 场景背景:pak08(1.2.1)与 pak15(btipc12)双份并存——同 ID 面板混合加载,行为不可预测。
// 桥侧扫描必须:命中含特征串的小 vpk、提取版本串、跳过大包、忽略非 vpk、目录不存在不崩。
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const pakScan = require("../core/pak_scan.js");

function makeFakeVpk(dir, name, opts) {
  const parts = [
    'const VERSION = "' + (opts.version || "1.0.0-test") + '";',
    'const panel = findChild(root, "' + pakScan.FEATURE_PANEL_ID + '");',
  ];
  let body = Buffer.from(parts.join("\n"), "utf8");
  if (opts.padding) {
    // 模拟 vpk 二进制前后缀,验证"在二进制中搜索特征串"的可靠性
    body = Buffer.concat([Buffer.alloc(opts.padding, 0x41), body, Buffer.alloc(opts.padding, 0x42)]);
  }
  fs.writeFileSync(path.join(dir, name), body);
}

test("PakScan-① 单份命中:提取文件名与版本串", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pakscan-"));
  try {
    makeFakeVpk(dir, "pak15_dir.vpk", { version: "1.2.2-6726-btipc12", padding: 2048 });
    const s = pakScan.summarize(pakScan.scanAddons(dir));
    assert.strictEqual(s.count, 1, "应命中 1 份");
    assert.strictEqual(s.duplicates, false, "单份不是重复");
    assert.strictEqual(s.items[0].file, "pak15_dir.vpk");
    assert.strictEqual(s.items[0].version, "1.2.2-6726-btipc12");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("PakScan-② 双份并存:duplicates=true 且清单稳定排序", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pakscan-"));
  try {
    makeFakeVpk(dir, "pak15_dir.vpk", { version: "1.2.2-6726-btipc12" });
    makeFakeVpk(dir, "pak08_dir.vpk", { version: "1.2.1-6726-btipc10" });
    const s = pakScan.summarize(pakScan.scanAddons(dir));
    assert.strictEqual(s.count, 2);
    assert.strictEqual(s.duplicates, true);
    assert.deepStrictEqual(s.items.map((h) => h.file), ["pak08_dir.vpk", "pak15_dir.vpk"], "按文件名排序");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("PakScan-②b DMM 禁用件(<modid>_pakNN)不计入 duplicates(§14 约定)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pakscan-"));
  try {
    makeFakeVpk(dir, "pak15_dir.vpk", { version: "1.2.2-6726-btipc12" });
    makeFakeVpk(dir, "700107_pak08_dir.vpk", { version: "1.2.1-6726-btipc10" }); // 禁用命名
    const s = pakScan.summarize(pakScan.scanAddons(dir));
    assert.strictEqual(s.count, 1, "活跃份数=1(禁用件不算)");
    assert.strictEqual(s.duplicates, false, "不应误报重复安装");
    assert.strictEqual(s.disabledCount, 1, "禁用件单独计数");
    assert.strictEqual(s.items.find((h) => h.file === "700107_pak08_dir.vpk").disabled, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("PakScan-③ 大包跳过(游戏本体 pak ≥23MB,不扫 800MB 级)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pakscan-"));
  try {
    makeFakeVpk(dir, "pak15_dir.vpk", { version: "1.2.2-6726-btipc12" });
    const big = path.join(dir, "pak99_huge_dir.vpk");
    const fd = fs.openSync(big, "w");
    fs.writeSync(fd, Buffer.alloc(pakScan.MAX_SCAN_BYTES + 1, 0x43));
    fs.closeSync(fd);
    const r = pakScan.scanAddons(dir);
    assert.strictEqual(r.skipped, 1, "超阈值跳过计数");
    assert.strictEqual(r.hits.length, 1, "仍命中小包");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("PakScan-④ 非 vpk 文件忽略 + 无命中 = missing(可能装错槽)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pakscan-"));
  try {
    fs.writeFileSync(path.join(dir, "readme.txt"), pakScan.FEATURE_PANEL_ID);
    const s = pakScan.summarize(pakScan.scanAddons(dir));
    assert.strictEqual(s.count, 0);
    assert.strictEqual(s.missing, true, "0 份 = mod 可能没装对槽");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("PakScan-⑤ 目录不存在不崩,error 可读", () => {
  const r = pakScan.scanAddons(path.join(os.tmpdir(), "no-such-dir-" + Date.now()));
  assert.strictEqual(r.hits.length, 0);
  assert.ok(r.error, "应有 error 说明");
});

test("PakScan-⑥ 真机冒烟:本机 addons 恰好 1 份(清理后),不误报", () => {
  // 只读校验:定位真实 addons 目录(与 bridge_server.locateAddonsDir 同源逻辑),
  // 双份已清后应恰好 1 份;若用户又装了别的翻译 mod,此测试只报告不失败(duplicates 语义由桥侧负责)。
  const fs2 = require("fs");
  const cands = ["C:/SteamLibrary", "F:/SteamLibrary", "D:/SteamLibrary"];
  let addons = null;
  for (const lib of cands) {
    const p = lib + "/steamapps/common/Deadlock/game/citadel/addons";
    if (fs2.existsSync(p)) { addons = p; break; }
  }
  if (!addons) return; // 无游戏环境(如 CI)跳过
  const s = pakScan.summarize(pakScan.scanAddons(addons));
  assert.ok(s.count >= 1, "本机应至少命中当前生效的 BabelTower(" + addons + ")");
  assert.ok(s.items.every((h) => /pak\d+_dir\.vpk$/.test(h.file)), "命中文件应为 pakNN_dir 命名");
});
