// 回归护栏:2026-10-03 玩家反馈的两个「装了完全没反应/没现场」级问题。
//   ① 桥漏查 D 盘游戏日志 —— console.log 候选写死 F:\SteamLibrary 与
//      C:\Program Files (x86)\Steam 两条,Steam 库在 D:/E:/G: 或自定义路径的用户
//      永远 fs.existsSync 不到 → tail 起不来 → console.log 成了【唯一】上行通路全断。
//   ② 日志目录不会自动创建 —— 发布包与 git clone 都没有 logs/(.gitignore 排除),
//      log() 直接 appendFileSync 被 ENOENT 静默吞掉 → 桥跑得起来但 logs\bridge.log
//      从不存在,而 restart_bridge.ps1 / run-bridge.bat / 排障文档全在让用户发这个文件。
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  [" + extra + "]" : "")); }
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
function slash(s) { return String(s).replace(/\\/g, "/"); }

// ---- 1. steam_paths:注册表 + libraryfolders.vdf 全库发现 ----
let sp = null;
try {
  sp = require(path.join(ROOT, "core", "steam_paths.js"));
  check("core/steam_paths.js 可加载", true);
} catch (e) {
  check("core/steam_paths.js 可加载", false, String(e && e.message));
}

if (sp) {
  check("导出 gameRoots/gameFileCandidates/libraryPathsFromVdf/uniq",
    ["gameRoots", "gameFileCandidates", "libraryPathsFromVdf", "uniq"]
      .every(k => typeof sp[k] === "function"));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lct-vdf-"));
  try {
    const lib = path.join(tmp, "SteamLib");
    fs.mkdirSync(lib, { recursive: true });
    const esc = lib.replace(/\\/g, "\\\\");

    // 新格式(2019+):条目是嵌套对象,值挂在 "path" 上
    const pNew = path.join(tmp, "new.vdf");
    fs.writeFileSync(pNew, '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"' + esc +
      '"\n\t\t"contentstatsid"\t\t"123456"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"' + esc +
      '\\Steam2"\n\t}\n}\n', "utf8");
    fs.mkdirSync(path.join(lib, "Steam2"), { recursive: true });
    const gotNew = sp.libraryPathsFromVdf(pNew).map(slash);
    check("新格式 vdf 解析出全部库", gotNew.indexOf(slash(lib)) >= 0, JSON.stringify(gotNew));
    check("新格式解析出第二个库(多盘符场景)", gotNew.some(p => /Steam2$/.test(p)), JSON.stringify(gotNew));
    check("纯数字 id 不被当成路径", !gotNew.some(p => /123456/.test(p)));

    // 老格式(<2019):库直接写成 `"2" "D:\\SteamLibrary"`
    const pOld = path.join(tmp, "old.vdf");
    fs.writeFileSync(pOld, '"LibraryFolders"\n{\n\t"1"\t\t"' + esc +
      '"\n\t"2"\t\t"D:\\\\NotInstalledLib"\n}\n', "utf8");
    const gotOld = sp.libraryPathsFromVdf(pOld).map(slash);
    check("老格式 vdf 解析出库", gotOld.indexOf(slash(lib)) >= 0, JSON.stringify(gotOld));
    check("不存在的库路径被过滤掉", !gotOld.some(p => /NotInstalledLib/.test(p)), JSON.stringify(gotOld));

    // 显式配置必须排在自动发现之前(旧安装目录残留时不能挤掉新装)
    const head = ["X:/explicit/console.log"];
    const cands = sp.gameFileCandidates("Deadlock", "game/citadel/console.log", head);
    check("显式路径排在自动发现之前", cands.length > 0 && slash(cands[0]) === "X:/explicit/console.log",
      JSON.stringify(cands.slice(0, 2)));
    check("自动发现的候选落在 <库>/steamapps/common/Deadlock 下",
      cands.slice(1).every(p => /steamapps\/common\/Deadlock\/game\/citadel\/console\.log$/.test(slash(p))),
      JSON.stringify(cands));
    check("候选去重大小写/斜杠不敏感",
      sp.uniq(["F:/SteamLibrary", "f:\\steamlibrary", "F:/SteamLibrary/"]).length === 1);
  } catch (e) {
    check("vdf 解析行为测试跑通", false, String(e && e.message));
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }

  // 本机行为:装了 Deadlock 的机器必须能通过注册表/vdf 找到它(这是本条反馈的核心)
  try {
    const roots = sp.gameRoots("Deadlock").map(slash);
    check("本机 Deadlock 安装目录可被发现", roots.some(r => fs.existsSync(r)),
      JSON.stringify(roots));
  } catch (e) {
    check("本机 Deadlock 安装目录可被发现", false, String(e && e.message));
  }
}

// ---- 2. 桥改用发现结果,老写死路径只留兜底 ----
const bridge = read("core/bridge_server.js");
check("桥引用 steamPaths.gameFileCandidates", /steamPaths\.gameFileCandidates\("Deadlock"/.test(bridge));
check("装包完整性自检把 steam_paths 算作必需模块", /"\.\/steam_paths\.js"/.test(bridge));
check("不再把两条写死路径当唯一候选",
  !/const candidates = \[\];\s*\n\s*if \(cfg\.gameLogPath\) candidates\.push\(cfg\.gameLogPath\);\s*\n\s*candidates\.push\("F:\/SteamLibrary/.test(bridge));
check("写死路径退为兜底(注册表/vdf 读不到时仍可用)", /F:\/SteamLibrary/.test(bridge));
// 2026-10-15:tail 提频到 250ms(降上行 RTT),重扫周期不能再写死 "60 tick"
// —— 否则语义从"每 60s"变成"每 15s"。护栏改为盯住派生式本身 + 把间隔钉死。
check("未找到时每 60s 重扫候选(库是后来才加的)",
  /const TAIL_PROBE_RESCAN_TICKS = Math\.round\(60000 \/ GAME_LOG_TAIL_INTERVAL_MS\)/.test(bridge) &&
  /probeTicks % TAIL_PROBE_RESCAN_TICKS === 0/.test(bridge));
check("console.log tail 间隔钉在 250ms(改间隔必须重跑上行 RTT 基线)",
  /const GAME_LOG_TAIL_INTERVAL_MS = 250;/.test(bridge) &&
  /\}, GAME_LOG_TAIL_INTERVAL_MS\);/.test(bridge) &&
  !/\}, 1000\);/.test(bridge));
check("DEADLOCK_ROOT 环境变量也进候选", /process\.env\.DEADLOCK_ROOT/.test(bridge));

// 构建工具同款问题一并修(否则 /gamenames 在非标准路径下静默为空)
const gn = read("core/game_names.js");
check("game_names 也走 steamPaths 发现", /steamPaths\.gameRoots\("Deadlock"\)/.test(gn));

// ---- 3. 日志目录自动创建 ----
check("log() 写盘前先 ensureLogDir", /ensureLogDir\(file\)/.test(bridge));
check("目录递归创建", /mkdirSync\(dir, \{ recursive: true \}\)/.test(bridge));

// 行为测试:把 ensureLogDir 从源码里抠出来真跑一遍
function extractFn(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return null;
  const start = src.lastIndexOf("function ", i);
  const open = src.indexOf("{", i);
  if (start < 0 || open < 0) return null;
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, k + 1);
    }
  }
  return null;
}
const fnSrc = extractFn(bridge, "function ensureLogDir(file)");
check("ensureLogDir 可从源码抠出", !!fnSrc);
if (fnSrc) {
  try {
    const factory = new Function("fs", "path", "logDirOk",
      fnSrc + "\nreturn { ensure: ensureLogDir, ok: function () { return logDirOk; } };");
    const api = factory(fs, path, false);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lct-log-"));
    try {
      const dir = path.join(tmp, "logs");
      const file = path.join(dir, "bridge.log");
      check("发布包初始状态没有 logs/", !fs.existsSync(dir));
      api.ensure(file);
      check("首次写日志自动补建目录", fs.existsSync(dir));
      check("只探测一次,成功后置位", api.ok() === true);
      fs.rmSync(dir, { recursive: true, force: true });
      api.ensure(file);
      check("置位后不再重复探测(不为每行日志做 existsSync)", !fs.existsSync(dir));
      // 目录被删/换配置的场景:新起一个 logger,补建后真正的写入能落盘
      const api2 = factory(fs, path, false);
      api2.ensure(file);
      fs.writeFileSync(file, "hello\n", "utf8");
      check("补建目录后日志真能落盘", fs.readFileSync(file, "utf8").indexOf("hello") === 0);
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }
  } catch (e) {
    check("ensureLogDir 行为测试跑通", false, String(e && e.message));
  }
}

// ---- 4. 打包脚本不能漏掉新模块(否则用户装上就是「安装不完整」直接退出) ----
const pkg = read("scripts/package_release.ps1");
check("package_release 把 steam_paths.js 列进必需 core 清单", /"steam_paths\.js"/.test(pkg));
const zipsrc = read("scripts/make_release_zip.ps1");
check("make_release_zip 递归打包 core/(新模块自动进包)",
  /Get-ChildItem \(Join-Path \$Root "core"\) -Recurse -File/.test(zipsrc));

console.log("\nRESULT: PASS " + pass + " / FAIL " + fail);
process.exit(fail ? 1 : 0);
