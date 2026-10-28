// tests/concat_panorama.test.js —— scripts/concat_panorama.js(拼接器 / 跨文件契约检查器)
//
// 为什么要有这些用例:
//   拼接器是"未来主文件增量模块化"的安全网,它自己错了比没有更贵 ——
//   误报重名 → 没人敢拼;漏报 → 拼接后同一作用域重复声明,游戏里直接 SyntaxError。
//   所以用例分两层:
//     ① 合成夹具:顺序/横幅、真重名、IIFE 内同名(不该报)、const 前向引用、函数体内引用;
//     ② 真机冒烟:当前 4 个运行时文件(i18n → btipc → 主 → panel)零重名、零前向引用,
//        产物过 node --check。这一层是"拼接形态语义等价"的现状钉。
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "concat_panorama.js");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "concat-panorama-"));

test.after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
});

let seq = 0;
function makeCase(files) {
  const dir = path.join(tmpRoot, "case" + (++seq));
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const [name, body] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, body, "utf8");
    written.push(p);
  }
  return { dir, files: written };
}

function runCli(args) {
  const r = spawnSync(process.execPath, [CLI].concat(args), { cwd: ROOT, encoding: "utf8" });
  return {
    status: r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    all: (r.stdout || "") + (r.stderr || ""),
  };
}

// ① 顺序 + 横幅
test("① 两文件拼接:横幅齐全、顺序与 --files 一致、文件间空一行", () => {
  const c = makeCase({
    "a.js": "const AAA = 1;\n",
    "b.js": "const BBB = 2;\n",
  });
  const out = path.join(c.dir, "out.js");
  const r = runCli(["--files", ...c.files, "--out", out]);
  assert.strictEqual(r.status, 0, "拼接应成功: " + r.all);

  const bundle = fs.readFileSync(out, "utf8");
  assert.match(bundle, /\[\s*1\/2\]\s+a\.js\s*\(行数 1\)/, "缺 [1/2] a.js 横幅:\n" + bundle);
  assert.match(bundle, /\[\s*2\/2\]\s+b\.js\s*\(行数 1\)/, "缺 [2/2] b.js 横幅:\n" + bundle);
  assert.ok(bundle.indexOf("const AAA = 1;") < bundle.indexOf("const BBB = 2;"),
    "顺序错了:AAA 应在 BBB 之前");
  assert.match(bundle, /const AAA = 1;\n\n\/\/ ═/, "文件之间必须空一行");
});

// ② 真重名(裸文件,深度 0)
test("② 顶层重名:退出码 2,报告两处 文件:行号", () => {
  const c = makeCase({
    "a.js": "const DUP = 1;\n",
    "b.js": "const DUP = 2;\n",
  });
  const r = runCli(["--files", ...c.files, "--check-only"]);
  assert.strictEqual(r.status, 2, "重名必须非零退出(2): " + r.all);
  assert.match(r.all, /重名冲突/);
  assert.match(r.all, /a\.js:1\b/, "报告缺 a.js 行号:\n" + r.all);
  assert.match(r.all, /b\.js:1\b/, "报告缺 b.js 行号:\n" + r.all);
});

// ③ IIFE 内同名:各自函数作用域,不该报
test("③ IIFE 内同名不误报(深度跟踪正确)", () => {
  const c = makeCase({
    "a.js": "(function () {\n  const DUP = 1;\n  return DUP;\n})();\n",
    "b.js": "(function () {\n  const DUP = 2;\n  return DUP;\n})();\n",
  });
  const r = runCli(["--files", ...c.files, "--check-only"]);
  assert.strictEqual(r.status, 0, "IIFE 内同名不是冲突: " + r.all);
  assert.ok(!/重名冲突/.test(r.all), "不该报重名:\n" + r.all);
});

// ④ const 前向引用(A 引用 B 的 const 才警告;B 引用 A 的合法)
test("④ const 前向引用:后向引用不报,前向引用报警告且退出码仍为 0", () => {
  const back = makeCase({
    "a.js": "const X = 1;\n",
    "b.js": "X + 1;\n",
  });
  const rBack = runCli(["--files", ...back.files, "--check-only"]);
  assert.strictEqual(rBack.status, 0, rBack.all);
  assert.ok(!/前向引用风险/.test(rBack.all), "后向引用(先用后声明)不该警告:\n" + rBack.all);

  const fwd = makeCase({
    "a.js": "X + 1;\n",
    "b.js": "const X = 1;\n",
  });
  const rFwd = runCli(["--files", ...fwd.files, "--check-only"]);
  assert.strictEqual(rFwd.status, 0, "仅警告不阻止拼接: " + rFwd.all);
  assert.match(rFwd.stderr, /前向引用风险/, "应把警告写到 stderr:\n" + rFwd.all);
  assert.match(rFwd.stderr, /X/, "警告要点名 X:\n" + rFwd.all);
  assert.match(rFwd.stderr, /a\.js:1/, "警告要给出引用处行号:\n" + rFwd.all);
  assert.match(rFwd.stderr, /b\.js:1/, "警告要给出 const 声明处行号:\n" + rFwd.all);
});

// ⑤ 函数体内引用后文件 const:调用时才解析,不该警告(含单行函数体)
test("⑤ 函数体内的引用不算前向引用", () => {
  const multi = makeCase({
    "a.js": "function f() {\n  return X;\n}\n",
    "b.js": "const X = 1;\n",
  });
  const r1 = runCli(["--files", ...multi.files, "--check-only"]);
  assert.strictEqual(r1.status, 0, r1.all);
  assert.ok(!/前向引用风险/.test(r1.all), "多行函数体不该警告:\n" + r1.all);

  const oneLine = makeCase({
    "a.js": "function g(){ return X; }\n",
    "b.js": "const X = 1;\n",
  });
  const r2 = runCli(["--files", ...oneLine.files, "--check-only"]);
  assert.strictEqual(r2.status, 0, r2.all);
  assert.ok(!/前向引用风险/.test(r2.all), "单行函数体也不该警告:\n" + r2.all);
});

// ⑥ 真机冒烟:当前 4 个运行时文件(chat.xml / hudchat.xml 的 include 顺序)
test("⑥ 真机四文件:--check-only 通过,拼接产物 node --check 通过", () => {
  const scripts = path.join(ROOT, "mod", "panorama", "scripts");
  // 主文件输入固定取 git HEAD 版本:若工作区主文件被替换成拼接产物(端到端等价性验证的用法),
  // 拿产物重拼会得到符号双重出现的真冲突(检测器行为正确),那不是本用例要验证的场景。
  const headMain = (() => {
    const r = spawnSync("git", ["show", "HEAD:mod/panorama/scripts/lingua_chat.js"],
      { cwd: ROOT, encoding: "utf8", shell: true });
    if (r.status !== 0 || !r.stdout) return null;
    const tmp = path.join(tmpRoot, "lingua_chat.head.js");
    fs.writeFileSync(tmp, r.stdout, "utf8");
    return tmp;
  })();
  const real = [
    "lingua_chat_i18n.js",
    "lingua_chat_btipc.js",
    "lingua_chat.js",
    "lingua_chat_panel.js",
  ].map((f) => path.join(scripts, f));
  if (headMain) real[2] = headMain;

  const r = runCli(["--files", ...real, "--check-only"]);
  assert.strictEqual(r.status, 0, "真机四文件必须零重名: " + r.all);
  assert.match(r.stdout, /重名检测: 0 组/, "重名数应为 0:\n" + r.all);
  assert.match(r.stdout, /前向引用警告: 0 条/, "前向引用应为 0 条:\n" + r.all);

  const out = path.join(tmpRoot, "real-bundle.js");
  const r2 = runCli(["--files", ...real, "--out", out]);
  assert.strictEqual(r2.status, 0, "真机四文件应可拼接: " + r2.all);
  const bundle = fs.readFileSync(out, "utf8");
  for (const f of ["lingua_chat_i18n.js", "lingua_chat_btipc.js", "lingua_chat.js", "lingua_chat_panel.js"]) {
    assert.ok(bundle.includes(f), "产物缺横幅: " + f);
  }
  assert.ok(bundle.split(/\r?\n/).length > 5000, "产物行数可疑(应约 6100 行)");

  const chk = spawnSync(process.execPath, ["--check", out], { cwd: ROOT, encoding: "utf8" });
  assert.strictEqual(chk.status, 0, "拼接产物语法必须通过 node --check: " + (chk.stderr || ""));
});
