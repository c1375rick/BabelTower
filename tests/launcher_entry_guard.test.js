// 回归护栏:启动入口「引用缺失脚本」自检(2026-10-03 反馈第 3 条)。
// 半解压/误删时,`.bat` 直接把控制权交给不存在的 ps1 → PowerShell 报一串红字、
// 窗口一闪而过,玩家看到的等价于"点了没反应",反馈里说成"重启按钮引用缺失脚本"。
// 约定:凡是被调用的脚本(调用前)都必须先 `if not exist "%~dp0<路径>"` 明确报因并退出,
// 且被引用的文件必须真实存在于仓库(打包是 core/ 递归 + 单文件白名单,存在即进包)。
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  [" + extra + "]" : "")); }
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

const BATS = [
  "StartDeadlock.bat",
  "run-bridge.bat",
  "restart_bridge.bat",
  "BabelTower-维护菜单.bat",
];

// 每个 bat 实际【调用】的文件(注释/日志文案里提到的不算,否则 logs\bridge.log 之类会误报)
function invokedRefs(src) {
  const out = [];
  let m;
  const patterns = [
    /-File\s+"%~dp0([^"]+)"/gi,      // powershell -File "%~dp0scripts\x.ps1"
    /cmd \/c\s+([A-Za-z0-9_\-\.]+\.bat)/gi, // start "" cmd /c run-bridge.bat
    /"%NODE_EXE%"\s+"([^"]+)"/gi,     // "%NODE_EXE%" "core\bridge_server.js"
  ];
  patterns.forEach(re => {
    while ((m = re.exec(src))) out.push(m[1]);
  });
  return Array.from(new Set(out));
}

for (const bat of BATS) {
  let src = "";
  try { src = read(bat); }
  catch (e) { check(bat + " 存在", false, String(e && e.message)); continue; }

  // 入口脚本必须是纯 ASCII:cmd 在不同 codepage 下遇到 CJK 会乱码甚至吞行。
  // 唯一例外是双语菜单总入口:文件存 UTF-8 无 BOM 且首行 chcp 65001,
  // 缺 chcp 会整屏乱码 —— 故豁免 ASCII 的同时钉死 chcp 行。
  if (bat === "BabelTower-维护菜单.bat") {
    const raw = fs.readFileSync(path.join(ROOT, bat));
    check(bat + " 无 BOM(bat 开头多 EF BB BF 会打印成乱码)",
      !(raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF));
    check(bat + " 首部切 UTF-8 代码页(否则中文菜单乱码)",
      /chcp 65001/.test(src));
  } else {
    check(bat + " 保持纯 ASCII", !/[^\x00-\x7F]/.test(src));
  }

  const refs = invokedRefs(src);
  check(bat + " 确实调用了脚本(否则本护栏无意义)", refs.length > 0, JSON.stringify(refs));

  refs.forEach(ref => {
    const guard = new RegExp('if\\s+not\\s+exist\\s+"%~dp0' + esc(ref) + '"', "i");
    check(bat + " 调用前自检 " + ref, guard.test(src));
    check(bat + " 引用的 " + ref + " 在仓库里真实存在",
      fs.existsSync(path.join(ROOT, ref)));
  });
}

// cmd 的坑:if (...) 块里的 echo 文本再写裸括号,cmd 会在那个 ) 处提前收块,
// 剩下的 `, then ...` 被当成命令 → 报「此时不应有 then」窗口直接退(2026-10-03 实测踩到)。
function guardBlock(src) {
  const i = src.search(/if\s+not\s+exist\s+"%~dp0/i);
  if (i < 0) return null;
  const start = src.indexOf("(", i);
  if (start < 0) return null;
  let depth = 0;
  for (let k = start; k < src.length; k++) {
    if (src[k] === "(") depth++;
    else if (src[k] === ")") {
      depth--;
      if (depth === 0) return src.slice(start, k + 1);
    }
  }
  return null;
}
for (const bat of BATS) {
  const raw = fs.readFileSync(path.join(ROOT, bat));
  // 2026-10-16 实测:换行是 LF 的 bat 会被 cmd 劈行、后半截当命令逐段执行。
  check(bat + " 用 CRLF 换行(不用 LF)",
    !/[^\r]\n/.test(raw.toString("latin1")));
  const src = read(bat);
  const blk = guardBlock(src);
  check(bat + " 自检块可被 cmd 正确配对", !!blk);
  check(bat + " 自检块内 echo 不含裸括号(否则 cmd 报「此时不应有 then」)",
    !!blk && !/echo[^\r\n]*[()]/.test(blk), blk && blk.split(/\r?\n/).filter(l => /[()]/.test(l)).join(" | "));
}

// 文案要求:报因要能看懂,且明确指路(重新解压完整包)
const missingMsgs = BATS.filter(b => /if\s+not\s+exist\s+"%~dp0/i.test(read(b)));
check("所有入口的缺失提示都指路「re-extract the FULL release zip」",
  missingMsgs.every(b => /Re-extract the FULL release zip/i.test(read(b))),
  JSON.stringify(missingMsgs));
check("缺失提示会 pause 后才退出(窗口不闪退)",
  missingMsgs.every(b => {
    const s = read(b);
    const i = s.search(/if\s+not\s+exist\s+"%~dp0/i);
    return /pause/i.test(s.slice(i, i + 800));
  }));

// StartDeadlock 是文件头约定的纯 ASCII,再单独断言一次(上面那条对它也成立)
check("StartDeadlock.bat 纯 ASCII(文件头约定)", !/[^\x00-\x7F]/.test(read("StartDeadlock.bat")));

console.log("\nRESULT: PASS " + pass + " / FAIL " + fail);
process.exit(fail ? 1 : 0);
