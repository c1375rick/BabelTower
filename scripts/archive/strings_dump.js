// Dump printable strings from a compiled Panorama file (.vxml_c / .vcss_c).
// Used to diff our reconstructed layout against the game's current build:
// literal id/attr strings show up here, though note Valve suffix-shares some
// strings ("TargetHeroImage" stores as "TargetHero"+"Image"), so absence of a
// literal is NOT proof the id is missing - cross-check with css_ids.js.
// Usage: node scripts/strings_dump.js <file> [minLen] [outfile]
const fs = require("fs");

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/strings_dump.js <file> [minLen] [outfile]");
  process.exit(2);
}
const minLen = parseInt(process.argv[3] || "5", 10);
const out = process.argv[4] || null;

const buf = fs.readFileSync(file);
const runs = [];
let cur = "";
for (let i = 0; i < buf.length; i += 1) {
  const b = buf[i];
  if (b >= 0x20 && b <= 0x7e) {
    cur += String.fromCharCode(b);
  } else {
    if (cur.length >= minLen) runs.push(cur);
    cur = "";
  }
}
if (cur.length >= minLen) runs.push(cur);

const text = runs.join("\n");
if (out) fs.writeFileSync(out, text);
console.log(file + "  bytes=" + buf.length + "  strings>=" + minLen + "=" + runs.length +
            (out ? "  -> " + out : ""));
