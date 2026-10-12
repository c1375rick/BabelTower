// B6 原子写护栏:core/config.js 的配置落盘必须走「临时文件 + fsync + rename」原子路径
// (2026-10-12)。半截 config.json = 用户 API Key/偏好整段丢失(load 回退默认值等同丢配置)。
//
// 违反任一即红:
//   ① 源码钉:save() 与 load() 首次自动生成两处必须经 writeFileAtomic,禁止直写 configPath;
//   ② 实现钉:writeFileAtomic 必须 tmp 写入 + fsync + rename,且保留 rename 失败降级直写的兜底;
//   ③ 功能(沙箱,不碰真实 config.json):新建/覆盖原子路径可用、无 .tmp 残留、
//      rename 失败时保存仍成功(底线)、stale .tmp 被自然收走。
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "core", "config.js"), "utf8");

test("B6-① 源码钉:两处落盘走 writeFileAtomic,零直写 configPath", () => {
  const direct = SRC.match(/writeFileSync\(\s*configPath\(\)/g) || [];
  assert.strictEqual(direct.length, 0,
    "存在直写 configPath() 的 writeFileSync(非原子),实为 " + direct.length + " 处");
  const atomic = SRC.match(/writeFileAtomic\(\s*configPath\(\)/g) || [];
  assert.strictEqual(atomic.length, 2,
    "writeFileAtomic(configPath()) 应为 2 处(save + load 首次生成),实为 " + atomic.length);
});

test("B6-② 实现钉:tmp + fsync + rename,且留降级直写兜底", () => {
  const m = SRC.match(/function writeFileAtomic\(file, data\) \{[\s\S]*?\n\}/);
  assert.ok(m, "缺 writeFileAtomic 定义");
  const body = m[0];
  assert.ok(/openSync\(tmp, "w"\)/.test(body), "缺 tmp 打开");
  assert.ok(/fsyncSync\(fd\)/.test(body), "缺 fsync(rename 前不落盘则断电可空文件)");
  assert.ok(/renameSync\(tmp, file\)/.test(body), "缺 rename 覆盖(原子提交点)");
  assert.ok(/writeFileSync\(file, data, "utf8"\)/.test(body),
    "缺 rename 失败降级直写兜底(目标被占用时保住保存成功)");
  assert.ok(/unlinkSync\(tmp\)/.test(body), "失败路径缺 tmp 清理");
});

test("B6-③ 沙箱功能:新建/覆盖原子路径,无 .tmp 残留", () => {
  const waf = require(path.join(ROOT, "core", "config.js")).writeFileAtomic;
  assert.strictEqual(typeof waf, "function", "writeFileAtomic 未导出(测试钩子)");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-b6-"));
  try {
    const f = path.join(dir, "config.json");
    const payload = JSON.stringify({ a: 1 }, null, 2);
    waf(f, payload);
    assert.strictEqual(fs.readFileSync(f, "utf8"), payload, "新建内容不符");
    assert.ok(!fs.existsSync(f + ".tmp"), "成功后残留 .tmp");

    const payload2 = JSON.stringify({ a: 2, b: "覆盖" }, null, 2);
    waf(f, payload2);
    assert.strictEqual(fs.readFileSync(f, "utf8"), payload2, "覆盖内容不符(同卷 rename 应原子替换)");
    assert.ok(!fs.existsSync(f + ".tmp"), "覆盖后残留 .tmp");

    // stale tmp 收走:预埋垃圾 tmp,保存后主文件是新内容且 tmp 消失
    fs.writeFileSync(f + ".tmp", "GARBAGE", "utf8");
    waf(f, payload);
    assert.strictEqual(fs.readFileSync(f, "utf8"), payload, "stale tmp 场景主文件内容不符");
    assert.ok(!fs.existsSync(f + ".tmp"), "stale .tmp 未被收走");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("B6-③b 降级底线:rename 失败(EPERM 类)时保存仍成功", () => {
  const waf = require(path.join(ROOT, "core", "config.js")).writeFileAtomic;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-b6f-"));
  const origRename = fs.renameSync;
  try {
    const f = path.join(dir, "config.json");
    fs.renameSync = () => { const e = new Error("EPERM: operation not permitted"); e.code = "EPERM"; throw e; };
    const payload = JSON.stringify({ k: "用户Key" }, null, 2);
    waf(f, payload);
    assert.strictEqual(fs.readFileSync(f, "utf8"), payload,
      "rename 失败后降级直写必须保住保存成功(内容正确)");
    assert.ok(!fs.existsSync(f + ".tmp"), "降级路径残留 .tmp");
  } finally {
    fs.renameSync = origRename;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
