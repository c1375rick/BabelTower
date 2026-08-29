// version_check.js — Babel Tower 版本一致性检查
// 修复/发布前必须运行: node scripts/version_check.js
// 检查: VERSION 文件 / lingua_chat.js 内 VERSION 常量 / 最近 git tag / dist 最新 zip 是否对齐
// 退出码: 0=一致  2=发现问题
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const problems = [];

function readVersionFile() {
  const p = path.join(root, "VERSION");
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8").trim();
}

function readCodeVersion() {
  const p = path.join(root, "mod", "panorama", "scripts", "lingua_chat.js");
  if (!fs.existsSync(p)) return null;
  const src = fs.readFileSync(p, "utf8");
  const m = src.match(/const\s+VERSION\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}

function getLastTag() {
  try {
    const out = execSync('git tag --sort=-creatordate', { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\n").map(s => s.trim()).filter(Boolean)[0] || null;
  } catch { return null; }
}

function getDistZip() {
  const dist = path.join(root, "dist");
  if (!fs.existsSync(dist)) return null;
  const zips = fs.readdirSync(dist).filter(f => /^BabelTower-.*\.zip$/.test(f));
  zips.sort((a, b) => fs.statSync(path.join(dist, b)).mtimeMs - fs.statSync(path.join(dist, a)).mtimeMs);
  return zips[0] || null;
}

const vf = readVersionFile();
const cv = readCodeVersion();
const tag = getLastTag();
const zip = getDistZip();

console.log("== Babel Tower 版本一致性检查 ==");
console.log("VERSION 文件   :", vf ?? "(缺失)");
console.log("代码内 VERSION :", cv ?? "(未找到)");
console.log("最近 git tag   :", tag ?? "(无 tag)");
console.log("dist 最新 zip  :", zip ?? "(无)");

if (!vf) problems.push("VERSION 文件缺失");
if (!cv) problems.push("lingua_chat.js 内 VERSION 常量未找到");
if (vf && cv && vf !== cv) problems.push(`VERSION 文件(${vf}) ≠ 代码常量(${cv})`);
if (vf && tag && !tag.includes(vf) && !/beta/i.test(tag)) {
  // 正式 tag 必须匹配 VERSION；beta tag 允许 v<next>-beta.N（代码比 VERSION 文件新一个 beta 阶段）
  problems.push(`最近 tag(${tag}) 与 VERSION 文件(${vf}) 不匹配`);
}
if (vf && zip && !zip.includes(vf) && !/beta/i.test(zip)) {
  problems.push(`dist 最新 zip(${zip}) 与 VERSION 文件(${vf}) 不匹配`);
}
// 核心检查: 最新 zip 的完整版本号(含 -beta.N) 必须等于 代码内 VERSION 常量
if (zip && cv) {
  const m = zip.match(/BabelTower-(\d+\.\d+\.\d+(?:-beta\.\d+)?)-win64\.zip/);
  if (m) {
    const zipVer = m[1];
    if (zipVer !== cv) {
      problems.push(`最新包 ${zip} 的版本(${zipVer}) ≠ 代码内 VERSION(${cv}) —— 装包后游戏内会显示 v${cv}, 版本自述与包名不符`);
    }
  }
}
if (vf && zip && /beta/i.test(zip) && !/beta/i.test(vf)) {
  // dist 里最新的是 beta 包但 VERSION 文件是正式号：提醒（beta 阶段属正常，但确认是否忘记升 VERSION）
  console.log("");
  console.log("ℹ️  提醒: dist 最新是 beta 包, VERSION 文件仍是正式号。");
  console.log("   若 beta 已发布, 应把 VERSION 文件升到目标版本(如 0.1.3)让代码内常量同步。");
}

console.log("");
if (problems.length === 0) {
  console.log("✅ 版本一致");
  process.exit(0);
} else {
  console.log("❌ 发现问题:");
  problems.forEach(p => console.log("  - " + p));
  process.exit(2);
}
