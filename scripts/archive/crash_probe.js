// Dump-adjacent log probe: slice bridge.log + console.log around a given time
// and pull out the lines that matter (game console mirror, LCT, fatals, errors).
// Usage: node scripts/crash_probe.js "2026-10-04 11:22:00" logs/crash_tail.txt
const fs = require("fs");

const from = process.argv[2] || "2026-10-04 00:00:00";
const out = process.argv[3] || "logs/crash_tail.txt";

const readLines = (p) => {
  try {
    return fs.readFileSync(p, "utf8").split(/\r?\n/);
  } catch (e) {
    return ["<missing " + p + ": " + e.message + ">"];
  }
};

const bridge = readLines("logs/bridge.log");
// 2026-10-15:游戏迁到 C:\SteamLibrary;DEADLOCK_ROOT 优先,兜底写新安装根。
const cons = readLines(
  (process.env.DEADLOCK_ROOT || "C:/SteamLibrary/steamapps/common/Deadlock") +
    "/game/citadel/console.log"
);

// bridge.log lines are prefixed [YYYY-MM-DD HH:MM:SS]
const idx = bridge.findIndex(
  (l) => l.startsWith("[" + from.slice(0, 10)) && l.slice(12, 20) >= from.slice(11, 19)
);
const tail = idx < 0 ? bridge.slice(-2000) : bridge.slice(idx);

const important = /(FATAL|Unable to find|TargetHero|Plat_Fatal|assert|Assert|SCRIPT ERROR|Panorama.*error|unhandled|Exception|ERROR)/;
const gameLines = tail.filter((l) => l.includes("[game]"));

const parts = [];
parts.push("### probe from=" + from + "  bridge total=" + bridge.length +
           "  matched-region=" + tail.length + "  [game] in region=" + gameLines.length);
parts.push("\n### [game] lines (last 250 of region)");
parts.push(gameLines.slice(-250).join("\n"));
parts.push("\n### [game] lines matching error-ish (whole region)");
parts.push(gameLines.filter((l) => important.test(l)).slice(-80).join("\n"));
parts.push("\n### console.log error-ish (whole file, last 80)");
parts.push(cons.filter((l) => important.test(l)).slice(-80).join("\n"));
parts.push("\n### console.log last 60 lines");
parts.push(cons.slice(-60).join("\n"));

fs.writeFileSync(out, parts.join("\n"));
console.log(
  "region=" + tail.length + " game=" + gameLines.length +
  " errGame=" + gameLines.filter((l) => important.test(l)).length +
  " errCons=" + cons.filter((l) => important.test(l)).length
);
