const { execSync } = require("child_process");
function gh(p) { return JSON.parse(execSync('gh api "' + p + '"', { encoding: "utf8", maxBuffer: 20e6 })); }
// 分支可能落后于 main(旧分支)——看分支头与它的提交
const br = gh("repos/civo7/QOLLOCK/branches/fix/https-fragment-storage");
console.log("分支头: " + br.commit.sha.slice(0,8) + "  " + br.commit.commit.message.split("\n")[0]);
console.log("分支头日期: " + br.commit.commit.committer.date);
// 分支头的提交详情(改了什么文件)
const cm = gh("repos/civo7/QOLLOCK/commits/" + br.commit.sha);
console.log("=== 该提交的文件 ===");
(cm.files || []).forEach(f => console.log("  " + f.filename + " (+" + f.additions + "/-" + f.deletions + ")"));
console.log("=== 提交全文 ===");
console.log(cm.commit.message);
// 对比 main 的 merge-base
const cmp = gh("repos/civo7/QOLLOCK/compare/main...fix/https-fragment-storage");
console.log("=== compare: ahead=" + cmp.ahead_by + " behind=" + cmp.behind_by + " total=" + cmp.total_commits);
(cmp.commits || []).forEach(c => {
  console.log("  " + c.commit.committer.date.slice(0,16) + "  " + c.sha.slice(0,8) + "  " + c.commit.message.split("\n")[0]);
});