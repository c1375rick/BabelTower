// 主文件补丁(行定位版):applyConfigPayload 应用路径清 dirty + helper。
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let lines = fs.readFileSync(f, "utf8").split("\n");
if (lines.join("\n").includes("应用路径清 dirty")) { console.log("already patched"); process.exit(0); }

// ① delta 分支:unset 行之后插 clearDirtyForPaths
const ui = lines.findIndex((l) => l.trim() === "for (const p of (d.unset || [])) cfgPathApply(mask, p, undefined);");
if (ui === -1) { console.error("unset line not found"); process.exit(1); }
const eol = lines[ui].includes("\r") ? "\r\n" : "\n";
const clearLine = "      clearDirtyForPaths(Object.keys(set).concat(d.unset || []));";
const comment1 = "      // 2026-10-31 应用路径清 dirty(发送方向整反实证):桥侧变更是更新的用户意图";
const comment2 = "      // (网页保存);面板未保存的编辑被显式保存覆盖时,不得再拦后续回填。";
lines.splice(ui + 1, 0, comment1, comment2, clearLine);

// ② full 分支:单行 else-if 拆开加 dirty 清理
const fi = lines.findIndex((l) => l.includes("} else if (d.config && typeof d.config === \"object\") { mask = d.config; }"));
if (fi === -1) { console.error("else-if line not found"); process.exit(1); }
lines.splice(fi, 1,
  "    } else if (d.config && typeof d.config === \"object\") {",
  "      mask = d.config;",
  "      // full 载荷 = 桥侧完整权威状态,清全部 dirty(2026-10-31)",
  "      if (State.cfgDirty) for (const k of Object.keys(State.cfgDirty)) delete State.cfgDirty[k];",
  "    }" + (lines[fi].includes("\r") ? "\r" : "")
);

// ③ helper:clearDirtyForPaths(插在 applyConfigPayload 之前)
const ai = lines.findIndex((l) => l.includes("function applyConfigPayload(text, res) {"));
if (ai === -1) { console.error("applyConfigPayload not found"); process.exit(1); }
const helper = [
  "  function clearDirtyForPaths(paths) {",
  "    if (!State.cfgDirty) return;",
  "    for (const p of paths || []) {",
  "      const key = String(p).split(\".\").pop();",
  "      delete State.cfgDirty[key];",
  "    }",
  "  }",
  "",
];
lines.splice(ai, 0, ...helper);

fs.writeFileSync(f, lines.join("\n"), "utf8");
console.log("main patched: delta clear + full clear + helper");
