// 存储布局护栏(2026-11-09):按"生命周期"把数据文件归类,防止再次混回 config/。
//
// 背景:此前 config/ 里混了四类生命周期完全不同的东西 —— 用户状态(config.json /
// dictionary.json)、内置静态数据(dictionary.builtin.json)、游戏派生缓存(gamenames.json /
// quickchat.json)、模板(config.example.json),还夹着一个一次性 .bak 垃圾。其中
// quickchat.json 每次桥启动都被重写却入了 git,工作树反复变脏,逼出「停桥 ->
// git checkout -- config/quickchat.json」的铁律。本次把"随包数据 / 游戏派生缓存"
// 统一到 data/,并让 quickchat.json 脱管(gitignore)。
//
// 违反任一即红:
//   ① data/ 下有随包数据(dictionary.builtin.json / gamenames.json);
//   ② config/ 里不再有这三者(不允许再长回来);
//   ③ core 运行时代码从 data/ 读它们(路径钉死,防止"改一处漏一处"的漂移);
//   ④ 发行打包把 data/ 打进包(package_release + make_release_zip);
//   ⑤ quickchat.json 已 gitignore(不再随桥启动变脏)。
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name); }
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

// ---- ① data/ 随包数据存在 ----
check("data/dictionary.builtin.json 存在", exists("data/dictionary.builtin.json"));
check("data/gamenames.json 存在", exists("data/gamenames.json"));

// ---- ② config/ 不再混入随包数据 / 派生缓存 ----
check("config/dictionary.builtin.json 已移出", !exists("config/dictionary.builtin.json"));
check("config/gamenames.json 已移出", !exists("config/gamenames.json"));
check("config/quickchat.json 已移出", !exists("config/quickchat.json"));

// ---- ③ core 运行时从 data/ 读 ----
const dict = read("core/dictionary.js");
const nameProtect = read("core/name_protect.js");
const gameNames = read("core/game_names.js");
const quickchat = read("core/quickchat.js");
const bridge = read("core/bridge_server.js");

check("dictionary.js 从 data/ 读内置词典", /"data",\s*"dictionary\.builtin\.json"/.test(dict));
check("name_protect.js 从 data/ 读 gamenames", /"data",\s*"gamenames\.json"/.test(nameProtect));
check("game_names.js 落盘到 data/", /"data",\s*"gamenames\.json"/.test(gameNames));
check("quickchat.js 落盘到 data/", /"data",\s*"quickchat\.json"/.test(quickchat));
check("bridge_server.js 同步读 data/", /"data",\s*SYNC_KINDS\[kind\]\.cfg/.test(bridge));
check("bridge_server.js /api/v1/gamenames 读 data/", /"data",\s*"gamenames\.json"/.test(bridge));
check("bridge_server.js /api/v1/quickchat 读 data/", /"data",\s*"quickchat\.json"/.test(bridge));

// 防回归:core 里这几个文件不得再出现旧 config/ 路径
const coreBundle = dict + nameProtect + gameNames + quickchat + bridge;
check("core 不再引用 config/gamenames.json", !/"config",\s*"gamenames\.json"/.test(coreBundle));
check("core 不再引用 config/quickchat.json", !/"config",\s*"quickchat\.json"/.test(coreBundle));
check("core 不再引用 config/dictionary.builtin.json", !/"config",\s*"dictionary\.builtin\.json"/.test(coreBundle));

// ---- ④ 打包进包 ----
const pkg = read("scripts/package_release.ps1");
check("package_release 建 data/ 暂存目录", /Join-Path \$Stage "data"/.test(pkg));
check("package_release 复制 data\\dictionary.builtin.json", /"data\\dictionary\.builtin\.json"/.test(pkg));
check("package_release 复制 data\\gamenames.json", /"data\\gamenames\.json"/.test(pkg));
const zip = read("scripts/make_release_zip.ps1");
check("make_release_zip 打包 data\\ 下两个数据文件",
  /"data\\dictionary\.builtin\.json"/.test(zip) && /"data\\gamenames\.json"/.test(zip));

// ---- ⑤ quickchat.json 脱管 ----
check(".gitignore 忽略 data/quickchat.json", /data\/quickchat\.json/.test(read(".gitignore")));

console.log("RESULT: PASS " + pass + " / FAIL " + fail);
process.exit(fail ? 1 : 0);
