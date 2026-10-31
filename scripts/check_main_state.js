// 核查主文件当前状态:各修复是否在位、handleChatSubmit 锚点、LCTBTIPC 块
const fs = require("fs");
const path = require("path");
const t = fs.readFileSync(path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js"), "utf8");
console.log("const BTIPC 声明: " + t.includes("const BTIPC = LCTBTIPC.BTIPC;"));
console.log("LCTBTIPC 块(afterRealMs): " + t.includes("const afterRealMs = LCTBTIPC.afterRealMs;"));
console.log("convar 优先: " + t.includes("convar 优先"));
console.log("陈旧差分防护: " + t.includes("stale delta discarded"));
console.log("clearDirtyForPaths: " + t.includes("function clearDirtyForPaths"));
console.log("面板兜底: " + t.includes("主文件引用的面板全局函数在此兜底"));
console.log("字段名修复: " + t.includes('targetLanguage: job.kind === "outgoing"'));
console.log("hash dispatch 日志: " + t.includes('log("hash dispatch: ctx="'));
console.log("noop 提示: " + t.includes("与输入语言相同,未翻译"));
console.log("扫描修复: " + t.includes("\\p{L}/u"));
console.log("boot probe: " + t.includes("boot probe: loadUiConfig"));
const i = t.indexOf("handleChatSubmit");
if (i >= 0) {
  const lineNo = t.slice(0, i).split("\n").length;
  console.log("handleChatSubmit 首现: L" + lineNo + " : " + t.split("\n")[lineNo - 1].trim().slice(0, 90));
} else {
  console.log("handleChatSubmit: 未找到!");
}
