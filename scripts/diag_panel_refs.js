// 诊断:游戏内设置面板的全部引用面(删除范围评估)
const fs = require("fs");
const path = require("path");
function walk(d, o) {
  o = o || [];
  let es = [];
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return o; }
  for (const e of es) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, o);
    else if (/\.(js|xml|vxml|md|bat|ps1)$/i.test(e.name)) o.push(p);
  }
  return o;
}
const files = walk("mod").concat(walk("tests")).concat(walk("scripts"));
const pats = /LCTSettingsPanel|LCTOpenSettings|LCTCloseSettings|LCTToggleSettings|openSettingsPanel|lingua_chat_panel|tr panel|LCTSave\b|LCTTest\b|collectPanelConfig|LCTSettingsHeader|LCTSettingsFooter|LCTRowApiKey/;
const seen = {};
for (const f of files) {
  const rel = f.replace(/\\/g, "/");
  if (/node_modules/.test(rel)) continue;
  let t = "";
  try { t = fs.readFileSync(f, "utf8"); } catch (e) { continue; }
  const lines = t.split(/\r?\n/);
  lines.forEach((l, i) => {
    if (pats.test(l)) {
      if (!seen[rel]) seen[rel] = [];
      if (seen[rel].length < 8) seen[rel].push("L" + (i + 1) + ": " + l.trim().slice(0, 100));
    }
  });
}
for (const k of Object.keys(seen)) {
  console.log("== " + k + " (" + seen[k].length + " 处)");
  seen[k].forEach((x) => console.log("   " + x));
}
