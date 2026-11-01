// Regenerate the POC panorama layouts from the CURRENT mod layouts.
// Keeping the game's original structure is mandatory: chat.xml's Ping snippet must keep
// #TargetHeroImage or the engine hits a FATAL "Unable to find child" (see chat.xml L49-59).
// Only three things change: <scripts> -> poc_boot only; drop lingua_chat.vcss_c;
// panel id/class LCTBridgePanel -> LCTPocPanel; the submit handler goes back to the game's.
// Usage: portable-node\node.exe poc\make_poc_layouts.js
"use strict";
const fs = require("fs");
const path = require("path");

const MOD = path.join(__dirname, "..", "mod", "panorama", "layout");
const OUT = path.join(__dirname, "vpk", "src", "panorama", "layout");

const HEADER = [
  "<!--",
  "  Babel Tower bridgeless POC layout (generated from mod/panorama/layout by poc/make_poc_layouts.js).",
  "  DO NOT EDIT BY HAND. The game-original structure is preserved verbatim; only the script",
  "  include, an unused stylesheet include, the HTML panel id and the submit handler differ.",
  "-->",
].join("\n");

function convert(src) {
  let s = fs.readFileSync(src, "utf8");
  s = s.replace(/<scripts>[\s\S]*?<\/scripts>/,
    '<scripts>\n\t\t<include src="s2r://panorama/scripts/poc_boot.vjs_c" />\n\t</scripts>');
  s = s.replace(/^[^\n]*<include[^>]*lingua_chat\.vcss_c[^>]*\/>[^\n]*\n/m, "");
  s = s.replace(/LCTBridgePanel/g, "LCTPocPanel");
  s = s.replace(/LCTOnChatSubmit\(\);/g, "CitadelChatSubmit();");
  // neutralize mod-only handlers so the POC needs no lingua_chat globals
  s = s.replace(/onactivate="LCTOpenWebSettings\(\);"/g, 'onactivate=""');
  s = s.replace(/(<\?xml[^>]*\?>\s*\n)/, "$1" + HEADER + "\n");
  return s;
}

fs.mkdirSync(OUT, { recursive: true });
for (const name of ["chat.xml", "hudchat.xml"]) {
  const out = convert(path.join(MOD, name));
  fs.writeFileSync(path.join(OUT, name), out, "utf8");
  console.log("[poc] wrote " + path.relative(path.join(__dirname, ".."), path.join(OUT, name)) +
    " (" + out.length + " chars)");
}
