// 恢复被误删的 LCTBTIPC 解构块(13 行,来自 4fe77a8 的 L4020-4033)
// 插入位置:handleChatSubmit 之前(与 4fe77a8 的原始位置一致)
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let lines = fs.readFileSync(f, "utf8").split("\n");
if (lines.join("\n").includes("const BTIPC = LCTBTIPC.BTIPC;")) { console.log("already restored"); process.exit(0); }

const anchor = lines.findIndex((l) => l.includes("function handleChatSubmit(input) {"));
if (anchor === -1) { console.error("handleChatSubmit not found"); process.exit(1); }
// 向上找它的注释块起点
let start = anchor;
while (start > 0 && lines[start - 1].trim().startsWith("//")) start--;
// start-1 若是空行,块插在空行之后(即 start 位置);直接插在 start(注释块之前)会拆开注释与函数——
// 4fe77a8 的顺序:空行 → 注释(BTIPC 传输层) → 解构 → 空行 → 注释(统一提交) → 函数
// 所以插在 start(注释块之前)
const block = [
  "  // ---- BTIPC 传输层(2026-10-28 拆至 lingua_chat_btipc.js,此处别名解构保持调用点不变) ----",
  "  // 依赖经 LCTBTIPC.init({...}) 在 boot() 首行注入;此处只做引用绑定,不含实现。",
  "  const afterRealMs = LCTBTIPC.afterRealMs;",
  "  const btipcFinish = LCTBTIPC.btipcFinish;",
  "  const btipcUtf8Bytes = LCTBTIPC.btipcUtf8Bytes;",
  "  const BTIPC = LCTBTIPC.BTIPC;",
  "  const runBtipcEcho = LCTBTIPC.runBtipcEcho;",
  "  const runBtipcTranslate = LCTBTIPC.runBtipcTranslate;",
  "  // 传输层的节拍常量:主文件的写死线/行预算/回声拥塞豁免窗引用同一定义",
  "  const BTIPC_T_CLOSE_MS = LCTBTIPC.BTIPC_T_CLOSE_MS;",
  "  const BTIPC_FIRST_SHOT_DELAY_MS = LCTBTIPC.BTIPC_FIRST_SHOT_DELAY_MS;",
  "  const BTIPC_REQ_MAX_PAYLOAD = LCTBTIPC.BTIPC_REQ_MAX_PAYLOAD;",
  "  const BTIPC_ECHO_STORM_WINDOW_MS = LCTBTIPC.BTIPC_ECHO_STORM_WINDOW_MS;",
  ""
];
lines.splice(start, 0, ...block);
fs.writeFileSync(f, lines.join("\n"), "utf8");
console.log("LCTBTIPC 解构块已恢复(插于 L" + (start + 1) + ")");
