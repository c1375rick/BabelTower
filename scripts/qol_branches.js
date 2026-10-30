const { execSync } = require("child_process");
function gh(p) { return JSON.parse(execSync('gh api "' + p + '"', { encoding: "utf8", maxBuffer: 50e6 })); }
// 全部分支(排除 main 和 fix/https-fragment-storage 已查)
const branches = gh("repos/civo7/QOLLOCK/branches?per_page=100");
console.log("分支总数: " + branches.length);
branches.forEach(b => console.log("  " + b.name + "  @" + b.commit.sha.slice(0,8)));