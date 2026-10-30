const { execSync } = require("child_process");
function gh(p) { return JSON.parse(execSync('gh api "' + p + '"', { encoding: "utf8", maxBuffer: 50e6 })); }
// 10-28 的 codex/customize-main 是唯一 > 10-17 的分支——看它改了什么(是否碰 CEF/title)
const files = gh("repos/civo7/QOLLOCK/compare/main...codex/customize-main");
console.log("=== codex/customize-main vs main ===");
console.log("ahead=" + files.ahead_by + " behind=" + files.behind_by);
(files.files || []).forEach(f => console.log("  " + f.filename + " (+" + f.additions + "/-" + f.deletions + ")"));
(files.commits || []).forEach(c => console.log("  commit: " + c.commit.message.split("\n")[0]));