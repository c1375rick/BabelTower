const { execSync } = require("child_process");
function gh(p) { return JSON.parse(execSync('gh api "' + p + '"', { encoding: "utf8", maxBuffer: 20e6 })); }
const cmp = gh("repos/civo7/QOLLOCK/compare/main...fix/https-fragment-storage");
console.log("=== 分支对比: main...fix/https-fragment-storage ===");
console.log("领先提交: " + cmp.total_commits);
(cmp.commits || []).slice().reverse().forEach(c => {
  console.log("  " + c.commit.committer.date.slice(0,16) + "  " + c.sha.slice(0,8) + "  " + c.commit.message.split("\n")[0]);
});
console.log("=== 改动文件 ===");
(cmp.files || []).forEach(f => console.log("  " + f.filename + " (+" + f.additions + "/-" + f.deletions + ")"));