// 诊断③:逐行求值 bridgePage 字符串数组元素 → 重建页面文本 → node --check。
// 每行形如 `"...",` ——去尾逗号后 eval 单行(字符串字面量求值,正确处理 \' 等转义)。
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const file = path.join(__dirname, "..", "core", "bridge_server.js");
const t = fs.readFileSync(file, "utf8");
const d = t.indexOf("function bridgePage");
const seg = t.slice(d, d + 20000);
// 数组范围:return [ 到 ].join("")
const startM = /return\s*\[\r?\n/.exec(seg);
if (!startM) { console.error("return [ not found"); process.exit(1); }
const startIdx = startM.index + startM[0].length;
const endIdx = seg.indexOf('].join("")', startIdx);
const body = seg.slice(startIdx, endIdx);
const lines = body.split(/\r?\n/).filter((l) => l.trim() !== "");
const values = [];
let badLine = -1;
for (let i = 0; i < lines.length; i++) {
  const src = lines[i].trim().replace(/,$/, "");
  try {
    values.push(eval(src));
  } catch (e) {
    badLine = i;
    console.error("L" + (i + 1) + " 求值失败: " + String(e.message).slice(0, 100) + "\n  原行: " + lines[i].slice(0, 120));
    break;
  }
}
if (badLine >= 0) process.exit(1);
const html = values.join("\r\n");
const sm = /<script>([\s\S]*?)<\/script>/.exec(html);
if (!sm) { console.error("页面无 script 块"); process.exit(1); }
const js = sm[1];
const dump = path.join(__dirname, "..", "logs", "bridge_page_dump.js");
fs.writeFileSync(dump, js, "utf8");
console.log("页面文本 " + html.length + " 字符,JS " + js.length + " 字符(共 " + values.length + " 行全数求值成功)");
const chk = spawnSync(process.execPath, ["--check", dump], { encoding: "utf8" });
console.log("页面 JS 语法: " + (chk.status === 0 ? "OK" : "FAIL\n" + (chk.stderr || chk.stdout || "").slice(0, 400)));
if (chk.status !== 0) {
  const m = /:(\d+)\r?\n/.exec(chk.stderr || "");
  if (m) {
    const ln = parseInt(m[1], 10);
    const jlines = js.split(/\r?\n/);
    for (let k = Math.max(0, ln - 4); k < Math.min(jlines.length, ln + 3); k++) {
      console.log((k + 1 === ln ? ">> " : "   ") + (k + 1) + ": " + jlines[k]);
    }
  }
}
