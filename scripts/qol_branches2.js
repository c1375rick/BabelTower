const { execSync } = require("child_process");
function gh(p) { return JSON.parse(execSync('gh api "' + p + '"', { encoding: "utf8", maxBuffer: 50e6 })); }
const branches = gh("repos/civo7/QOLLOCK/branches?per_page=100");
const rows = [];
for (const b of branches) {
  try {
    const c = gh("repos/civo7/QOLLOCK/commits/" + b.commit.sha);
    rows.push({ name: b.name, date: c.commit.committer.date, sha: c.sha.slice(0,8), msg: c.commit.message.split("\n")[0].slice(0, 90) });
  } catch (e) { rows.push({ name: b.name, date: "?", sha: "?", msg: "fetch fail" }); }
}
rows.sort((a, b) => (a.date < b.date ? 1 : -1));
console.log("=== 全部分支按日期排序 ===");
rows.forEach(r => {
  const fresh = r.date >= "2026-10-17" ? "★" : " ";
  console.log(fresh + " " + r.date.slice(0,16) + "  " + r.name.padEnd(38) + "  " + r.msg);
});