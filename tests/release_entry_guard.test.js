// 回归护栏:发行包必须自足(2026-10-15)。
//
// 教训来源:https 面板通道做完后发现 `scripts\gen_bridge_cert.ps1` **根本没进发行包**
// —— 下载版用户看得见通道、却永远开不了它(证书没法生成也没法信任),只能退回 3~27s 的
// BTIPC 位泵。这类漏打的症状在用户侧是"功能少了/双击没反应",**没有任何报错能指向
// "打包时漏了"**,发版流水线全绿也发现不了。
//
// 因此钉死两件事:
//   1. 用户会双击或被文档指引的入口,逐个点名进打包清单(新增入口必须同步这里);
//   2. 证书相关的两件套(gen_bridge_cert.ps1 / install_babeltower.ps1 /
//      install-babeltower.bat / core\bridge_https.js)必须在清单里 —— 低延迟通道的
//      唯一拦点是证书,少任何一件等于该通道对下载版用户不存在。
//
// 另外顺带守住两条安装纪律:信任库写入只能用 certutil(非交互进程里
// Import-Certificate 报 "UI is not allowed"),以及"信任后必须完全重启 Steam"
// 这句话必须出现在用户文档里(否则用户只重启游戏,会得出"证书方案无效"的假结论)。
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PKG = fs.readFileSync(path.join(ROOT, "scripts", "package_release.ps1"), "utf8");
const CERT = fs.readFileSync(path.join(ROOT, "scripts", "gen_bridge_cert.ps1"), "utf8");
const INSTALLER = (() => {
  const p = path.join(ROOT, "scripts", "install_babeltower.ps1");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
})();
const GUIDE = fs.readFileSync(path.join(ROOT, "安装使用说明.txt"), "utf8");
const README = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  [" + extra + "]" : "")); }
}

// ---------- 1. 四个用户入口(装/更/卸/检)必须进包 ----------
// 2026-10-16 精简:6 对 bat(装/更/卸/检/自启开关)合成 1 个 BabelTower.bat,
// ps1 原样保留(内容护栏在 §4/§6/§7/§8 照旧逐文件断言)。
for (const f of ["scripts\\gen_bridge_cert.ps1", "scripts\\install_babeltower.ps1",
  "scripts\\update_babeltower.ps1",
  "scripts\\diagnose_babeltower.ps1",
  "scripts\\uninstall_babeltower.ps1", "BabelTower-维护菜单.bat"]) {
  check("打包清单含 " + f, PKG.indexOf(f) !== -1, "漏打 = 下载版用户少一个功能");
}
check("core\\bridge_https.js 进包(core/* 递归)",
  /Copy-Item \(Join-Path \$Root "core\\\*"\)/.test(PKG),
  "TLS 终结进程没进包,桥起了 https 端口也不通");
check("用户入口断言覆盖维护总入口与四个 ps1",
  /requiredUserEntry[\s\S]*?"BabelTower-维护菜单\.bat"/.test(PKG) &&
  /requiredUserEntry[\s\S]*?uninstall_babeltower\.ps1/.test(PKG) &&
  /requiredUserEntry[\s\S]*?update_babeltower\.ps1/.test(PKG) &&
  /requiredUserEntry[\s\S]*?diagnose_babeltower\.ps1/.test(PKG) &&
  /requiredUserEntry[\s\S]*?install_babeltower\.ps1/.test(PKG) &&
  /requiredUserEntry[\s\S]*?gen_bridge_cert\.ps1/.test(PKG) &&
  /requiredUserEntry[\s\S]*?bridge_https\.js/.test(PKG));

// ---------- 2. 既有入口不能被删掉(回归保护) ----------
// 2026-10-16:6 对 bat 合成 BabelTower.bat,自启开关 bater 也并入其菜单,
// 故此处不再点名旧 bat 名(有意为之,见 §1 新名单)。
for (const f of ["restart_bridge.bat", "StartDeadlock.bat", "run-bridge.bat",
  "scripts\\restart_bridge.ps1", "scripts\\bridge_health.ps1", "scripts\\autostart.ps1"]) {
  check("打包清单仍含既有入口 " + f, PKG.indexOf(f) !== -1, "既有入口被误删");
}
check("打包仍做启动冒烟测试(桥起不来不许出包)",
  /启动冒烟测试/.test(PKG) && /冒烟测试失败/.test(PKG));

// ---------- 3. 证书工具的纪律不能退化 ----------
check("信任库写入用 certutil(非交互进程里 Import-Certificate 会报 UI is not allowed)",
  /certutil\.exe -user -addstore Root/.test(CERT));
check("撤销信任同样用 certutil",
  /certutil\.exe -user -delstore Root/.test(CERT));
check("证书脚本支持 -Trust / -Untrust / -Status 三态",
  /\[switch\]\$Trust/.test(CERT) && /\[switch\]\$Untrust/.test(CERT) && /\[switch\]\$Status/.test(CERT));
check("SAN 同时含 DNS 与 IP 条目(IP 写成 DNS 名不算)",
  /DNS=localhost&ipaddress=127\.0\.0\.1&ipaddress=::1/.test(CERT));

// ---------- 4. 一键安装器的纪律 ----------
check("一键安装器存在且非空", INSTALLER.length > 2000, "len=" + INSTALLER.length);
// 检查"是否写死开发机路径"必须**先剥注释**:注释里恰恰会提到这些路径作为反例,
// 不剥就会把"这里刻意说明不用 F:\BabelTower"判成"写死了 F:\BabelTower"(自踩过一次)。
const installerCode = INSTALLER.split(/\r?\n/)
  .filter((l) => !/^\s*#/.test(l)).join("\n");
check("安装器用相对路径(发行包里没有开发机路径)",
  /Split-Path -Parent \$PSScriptRoot/.test(installerCode) &&
  installerCode.indexOf("F:\\BabelTower") === -1,
  "写死开发机路径 = 用户包里不可用");
check("安装器信任库改动前要确认(除非 -Yes)", /Read-Host/.test(INSTALLER) && /\[switch\]\$Yes/.test(INSTALLER));
check("安装器不轻信脚本自报,自己复核信任库",
  /CN=BabelTower-localhost/.test(INSTALLER));
check("安装器失败路径自带取证(日志 + 行号)",
  /install_babeltower\.log/.test(INSTALLER) && /ScriptLineNumber/.test(INSTALLER));
check("安装器不因证书失败而阻断(仍走 BTIPC)",
  /翻译仍走 BTIPC/.test(INSTALLER));
check("安装器提供 -Status 只体检模式", /\[switch\]\$Status/.test(INSTALLER));
check("安装器拒绝在游戏运行时替换 vpk",
  /Get-Process -Name deadlock/.test(INSTALLER) && /绝不/.test(INSTALLER));

// ---------- 5. 用户文档必须写清那三件事 ----------
check("安装说明提到维护总入口 BabelTower-维护菜单.bat", GUIDE.indexOf("BabelTower-维护菜单.bat") !== -1);
check("安装说明写明『完全退出并重启 Steam』",
  /完全退出 Steam/.test(GUIDE) && /只重启游戏是不生效的/.test(GUIDE));
check("安装说明写明不做也能用(降级说明)",
  /不做这步也完全能用/.test(GUIDE) || /不做这步也完全能用/.test(GUIDE));
check("安装说明提醒 addons 里只能有一份我们的包",
  /只能有一份/.test(GUIDE));
check("安装说明给出现场验没验上的判据",
  /https panel: ALIVE/.test(GUIDE));
check("安装说明提到更新与检测入口(菜单选 2 / 选 4)",
  /选 2/.test(GUIDE) && /选 4/.test(GUIDE));
check("README 目录树列出证书脚本与一键安装器",
  README.indexOf("gen_bridge_cert.ps1") !== -1 && README.indexOf("install_babeltower.ps1") !== -1);
check("README 指向通道文档", README.indexOf("btipc-https-v1.md") !== -1);

// ---------- 6. 更新脚本的纪律(照社区启动器那套:白名单 + 校验和 + 延后安装 + 回滚) ----------
const UPD = fs.readFileSync(path.join(ROOT, "scripts", "update_babeltower.ps1"), "utf8");
const updCode = UPD.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
check("更新脚本只认官方 Releases 源(不写死别的源)",
  /api\.github\.com\/repos\/\$Repo\/releases\/latest/.test(updCode) &&
  /\$Repo = "c1375rick\/BabelTower"/.test(updCode));
check("资产名白名单严格匹配整包(不做模糊匹配)",
  /\^BabelTower-\\d\+/.test(updCode) && /win64\\\.zip\$/.test(updCode));
check("校验体积(asset.size)", /-ne \[int64\]\$asset\.size/.test(updCode));
check("校验 SHA256(digest)", /Sha256 \$zipPath/.test(updCode) && /digest/.test(updCode));
check("没有 digest 时默认拒绝(校验是这一步的意义)",
  /-not \$AllowNoDigest/.test(updCode) && /AllowNoDigest/.test(updCode));
check("游戏在跑时只下载不安装(延后安装)",
  /Get-Process -Name deadlock/.test(updCode) && /DownloadOnly/.test(updCode));
check("换包前备份、换包后校验 sha、失败回滚",
  /\.bak-upd-/.test(updCode) && /已回滚到旧包/.test(updCode));
check("覆盖安装目录时保留用户数据",
  /config\\config\.json/.test(updCode) && /quickchat\.json/.test(updCode) && /dictionary\.json/.test(updCode));
check("认包靠内容标记而不是文件名",
  /Babel Tower/.test(updCode) && /LCTBridgePanel/.test(updCode));
check("更新脚本设了 TLS 1.2(不设必失败)",
  /SecurityProtocol/.test(updCode));
check("更新脚本用 WebClient 而不是 Invoke-WebRequest 拉大文件",
  /WebClient/.test(updCode) && !/Invoke-WebRequest[^"]*zip/i.test(updCode));

// ---------- 7. 检测脚本:只读 + 脱敏 ----------
const DIA = fs.readFileSync(path.join(ROOT, "scripts", "diagnose_babeltower.ps1"), "utf8");
check("检测脚本声明只读(不改配置/不装/不碰信任库/不停进程)",
  /只读/.test(DIA) && /不改配置/.test(DIA));
check("检测脚本有脱敏出口(统一打码,不是靠记得别打印)",
  /function Redact/.test(DIA) && /REDACTED/.test(DIA));
check("检测脚本从不打印 Key 值(只报有没有)",
  /apiKey/.test(DIA) && /只查有没有/.test(DIA));
check("检测脚本每条结论都带判据",
  /判据/.test(DIA));
check("检测脚本覆盖桥/证书/游戏/mod 四面",
  /api\/v1\/health/.test(DIA) && /CN=BabelTower-localhost/.test(DIA) &&
  /console\.log/.test(DIA) && /LCTBridgePanel/.test(DIA));
check("检测脚本标出残件数量的口径差异(不是 bug)",
  /卸载脚本只删能确认是我们的/.test(DIA));

// ---------- 8. 四份脚本共同的 PowerShell 5.1 地雷 ----------
for (const [name, src] of [["install", INSTALLER], ["uninstall", fs.readFileSync(path.join(ROOT, "scripts", "uninstall_babeltower.ps1"), "utf8")], ["update", UPD], ["diagnose", DIA]]) {
  const code = src.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
  // ① 函数不能写成 $Func(...) 参与表达式(PS 5.1 解析器报"意外的标记(")
  check(name + " 脚本:没有把函数写成 $Func(...) 参与表达式",
    !/-not \$[A-Za-z]+\s*\(/.test(code) && !/if \(\s*\$[A-Za-z]+\s*\(/.test(code));
  // ② 字符串拼接里不许直接夹 [math]:: 表达式(会把左边当数字转换而失败)
  check(name + " 脚本:字符串拼接里不夹 [math]:: 表达式",
    !/"[^"]*"\s*\+\s*\[math\]/.test(code));
  // ③ 顶层临时变量不能与脚本级累加器同名(PowerShell 顶层**没有局部作用域**,
  //     顶层写 $buf 会直接覆盖 $script:Buf —— diagnose 踩过,报告变成一串字节码)
  if (name === "diagnose") {
    check(name + " 脚本:没有裸 $buf 顶层临时变量(会覆盖 $script:Buf)",
      !/(^|[^:A-Za-z])\$buf\b/.test(code), "顶层用 $buf 覆盖报告缓冲 = 报告输出字节码");
  } else {
    check(name + " 脚本:没有 $script:Buf(误抄 diagnose 的累加器名)", !/\$script:Buf/.test(code));
  }
  // ④ 认包/删包必须靠内容标记
  check(name + " 脚本:认包靠内容标记(不靠文件名)", /LCTBridgePanel|Babel Tower/.test(code));
}

console.log("  RESULT: PASS " + pass + " / FAIL " + fail);
process.exit(fail === 0 ? 0 : 1);