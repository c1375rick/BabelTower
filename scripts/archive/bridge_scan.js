// Survey bridge.log: list every log tag, every distinct BTIPC op, and every
// line that looks like message/translation traffic. Answers "what kinds of
// lines exist at all" before we go hunting for one specific thing.
// Usage: node scripts/bridge_scan.js [keyword-regex] [outfile]
const fs = require("fs");

const kw = process.argv[2] || "translate|\\bmsg\\b|chat|say|message|op=[a-z]+";
const out = process.argv[3] || "logs/bridge_scan.txt";
const re = new RegExp(kw, "i");

const lines = fs.readFileSync("logs/bridge.log", "utf8").split(/\r?\n/);

const tags = {};
const ops = {};
const matched = [];

for (const l of lines) {
  if (!l.trim()) continue;
  const t = l.match(/\] \[([a-zA-Z0-9_.:-]+)\]/);
  const tag = t ? t[1] : (l.includes("[game]") ? "game" : "(no-tag)");
  tags[tag] = (tags[tag] || 0) + 1;

  for (const m of l.matchAll(/op=([A-Za-z0-9_]+)/g)) {
    ops[m[1]] = (ops[m[1]] || 0) + 1;
  }
  if (re.test(l)) matched.push(l);
}

const sortDesc = (o) =>
  Object.entries(o).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => k + "=" + v).join("  ");

fs.writeFileSync(out, [
  "### total lines = " + lines.length,
  "### tags: " + sortDesc(tags),
  "### ops:  " + sortDesc(ops),
  "### matched /" + kw + "/ = " + matched.length,
  "",
  matched.slice(-400).join("\n"),
].join("\n"));

console.log("tags: " + sortDesc(tags));
console.log("ops:  " + sortDesc(ops));
console.log("matched=" + matched.length);
