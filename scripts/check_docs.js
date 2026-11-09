#!/usr/bin/env node
/**
 * docs 一致性检查(零依赖,可进 CI / 发版前跑)
 *
 * 检查项:
 *   1. 每篇 docs/*.md(README.md 除外)前 15 行内必须有 "> **状态**" 元数据块
 *   2. 相对 .md 链接必须存在(忽略 http/https 与纯锚点)
 *   3. 每篇文档必须出现在 docs/README.md 的索引里
 *
 * 用法: node scripts/check_docs.js [--quiet]
 * 退出码: 0 = 全过; 1 = 有问题
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const INDEX = "README.md";
const quiet = process.argv.includes("--quiet");

const failures = [];
const warnings = [];

function fail(file, msg) {
  failures.push(`${path.relative(ROOT, file)}: ${msg}`);
}
function warn(file, msg) {
  warnings.push(`${path.relative(ROOT, file)}: ${msg}`);
}

if (!fs.existsSync(DOCS)) {
  console.error("docs/ not found:", DOCS);
  process.exit(1);
}

const files = fs.readdirSync(DOCS).filter((f) => f.endsWith(".md")).sort();
const indexText = fs.readFileSync(path.join(DOCS, INDEX), "utf8");

// ---- 1 + 3: 元数据块 与 索引收录 ----
for (const name of files) {
  const full = path.join(DOCS, name);
  const text = fs.readFileSync(full, "utf8");
  const head = text.split(/\r?\n/).slice(0, 15).join("\n");

  if (name !== INDEX && !/>\s*\*\*状态\*\*/.test(head)) {
    fail(full, 'H1 后缺少元数据块("> **状态**:…")');
  }

  if (name !== INDEX && !indexText.includes(name)) {
    fail(full, `未出现在 docs/${INDEX} 索引中`);
  }
}

// ---- 2: 相对 md 链接 ----
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;
for (const name of files) {
  const full = path.join(DOCS, name);
  const text = fs.readFileSync(full, "utf8");
  let m;
  while ((m = LINK_RE.exec(text)) !== null) {
    let target = m[1];
    if (/^(https?:|mailto:|#)/i.test(target)) continue;
    target = target.split("#")[0];
    if (!target || !/\.md$/i.test(target)) continue;

    const resolved = path.resolve(path.dirname(full), target);
    if (!fs.existsSync(resolved)) {
      fail(full, `死链: ${m[1]}`);
    }
  }
}

// ---- 输出 ----
if (!quiet) {
  console.log(`docs: ${files.length} 篇(含索引)`);
  if (warnings.length) {
    console.log(`\n警告 ${warnings.length}:`);
    warnings.forEach((w) => console.log("  ! " + w));
  }
}
if (failures.length) {
  console.log(`\n失败 ${failures.length}:`);
  failures.forEach((f) => console.log("  x " + f));
  process.exit(1);
}
console.log(`\nOK: ${files.length} 篇文档,元数据/索引/链接全部一致。`);
