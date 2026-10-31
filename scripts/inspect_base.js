// 只读核查:0a29167 基底 blob 的完整性 + 两个评审修复(②convar 优先/③陈旧差分重同步)的落点区域
// 不写任何文件。
const { execSync } = require("child_process");
const COMMIT = process.argv[2] || "0a29167";
const rel = "mod/panorama/scripts/lingua_chat.js";
const base = execSync(`git show ${COMMIT}:${rel}`, { encoding: "utf8", maxBuffer: 50e6 });
const lines = base.split("\n");
console.log("blob 行数: " + lines.length + "  字节: " + Buffer.byteLength(base) + "  CRLF 行数: " + lines.filter((l) => l.endsWith("\r")).length);

const markers = {
  "LCTBTIPC 解构块(const BTIPC)": "const BTIPC = LCTBTIPC.BTIPC;",
  "handleChatSubmit 定义": "function handleChatSubmit(input) {",
  "clearDirtyForPaths": "function clearDirtyForPaths",
  "hash dispatch 日志": 'log("hash dispatch: ctx="',
  "面板兜底": "主文件引用的面板全局函数在此兜底",
  "陈旧差分防护日志": "stale delta discarded",
  "扫描修复 \\p{L}": "\\p{L}/u",
  "UI_CONVAR 常量": "UI_CONVAR",
  "resolveOutgoingTarget": "function resolveOutgoingTarget() {",
  "syncConfigDelta": "function syncConfigDelta(",
  "noop 提示(与输入语言相同)": "与输入语言相同",
  "载荷 targetLanguage 字段": "targetLanguage:",
};
for (const [k, v] of Object.entries(markers)) console.log((base.includes(v) ? "  ✓ " : "  ✗ ") + k);

// 落点 1: resolveOutgoingTarget(② 的替换目标)
let i = lines.findIndex((l) => l.includes("function resolveOutgoingTarget() {"));
console.log("\n--- resolveOutgoingTarget @ L" + (i + 1) + " ---");
for (let k = i - 1; k <= i + 8; k++) console.log("L" + (k + 1) + ": " + JSON.stringify(lines[k]));

// 落点 2: 陈旧差分丢弃(③ 的插入目标)——确认所在函数与 onDone 作用域
let d = lines.findIndex((l) => l.includes("stale delta discarded"));
console.log("\n--- stale discard @ L" + (d + 1) + " ---");
for (let k = d - 8; k <= d + 5; k++) console.log("L" + (k + 1) + ": " + JSON.stringify(lines[k]));
// 该行之前最近的 syncConfigDelta 签名
let s = -1;
for (let k = d; k >= 0; k--) { if (lines[k].includes("function syncConfigDelta(")) { s = k; break; } }
console.log("所属函数签名: L" + (s + 1) + ": " + (s >= 0 ? lines[s].trim() : "未找到!"));

// 落点 3: 出站载荷字段名(确认基底已含修复)
let p = lines.findIndex((l) => l.includes("targetLanguage:"));
console.log("\n--- targetLanguage: 首现 @ L" + (p + 1) + " ---");
for (let k = p - 2; k <= p + 1; k++) console.log("L" + (k + 1) + ": " + JSON.stringify(lines[k]));
