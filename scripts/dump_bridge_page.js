// 诊断:提取 bridgePage 返回的页面 JS(字符串数组 join 后),node --check 验证语法。
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "core", "bridge_server.js");
const t = fs.readFileSync(file, "utf8");
// 找 bridgePage 函数
const d = t.indexOf("function bridgePage");
if (d < 0) { console.error("bridgePage not found"); process.exit(1); }
// 在 Node 里真实执行 bridgePage,拿返回的 HTML(最可靠)
const mod = { exports: {} };
// 桥文件不能整体 require(会启动服务器)——改为提取 bridgePage 函数源码 + 它依赖的最小闭包
// 简化:正则提取 return [ ... ]; 的字符串数组并 join
const seg = t.slice(d, d + 20000);
const retM = /return\s*\[[\s\S]*?\];/.exec(seg);
if (!retM) { console.error("return array not found"); process.exit(1); }
const arrSrc = retM[0].slice(6).trim();
const arr = eval("[" + arrSrc.slice(1, -2) + "]");
const html = arr.join("");
// 提取 <script> 内容
const sm = /<script>([\s\S]*?)<\/script>/.exec(html);
if (!sm) { console.error("no script in page"); process.exit(1); }
const js = sm[1];
fs.writeFileSync(path.join(__dirname, "..", "logs", "bridge_page_dump.js"), js, "utf8");
console.log("页面 JS 长度: " + js.length);
// 语法检查
const { spawnSync } = require("child_process");
const chk = spawnSync(process.execPath, ["--check", path.join(__dirname, "..", "logs", "bridge_page_dump.js")], { encoding: "utf8" });
console.log("语法: " + (chk.status === 0 ? "OK" : "FAIL\n" + (chk.stderr || "")));
