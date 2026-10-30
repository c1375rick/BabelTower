const { execSync } = require("child_process");
const fs = require("fs");
const crypto = require("crypto");
const zip = "dist/BabelTower-1.2.4-win64.zip";
const localSha = crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
const notes = [
  "## 1.2.4 - 修复 10-29 游戏更新引发的 https 通道全断",
  "",
  "### 根因与修复",
  "- **证书**:CEF 收紧校验后自签证书页面 JS 不再执行 → 证书改 **CA 链签发**(本地 Root CA + 397 天叶子,SAN 完整)。`StartDeadlock.bat` 每次启动自检续期;**首次信任后需完全退出并重启 Steam(托盘也退)**。",
  "- **标题事件回程**:10-29 后泛用 HTML 面板不再派发 HTMLTitle → 桥面板改 **CitadelHTMLPanel**(QOL 同款) + 面板绑定守卫解耦(boot() 先注册总线不再挡死面板绑定)。",
  "- **探针**:结算改事件驱动(旧路径读陈旧 panel.title 属性,永远超时)→ 开机**秒级 ALIVE**。",
  "- **hash 快通道接线补全**:hashBase 捕获、fragment 导航、作业 id 生成、载荷解码四处断线修复;页面 boot 分支处理初始 #LCTQ(常驻漂移自愈);页面 onHash 未声明变量修复。",
  "- **模拟环境**:真桥+真页面 JS+真游戏脚本离线全链自测(16 项检查,进测试套件 39/39)。首跑即抓出 5 个上述 bug。",
  "",
  "### 升级说明",
  "1. 解压覆盖后,先运行一次 `StartDeadlock.bat`(会自动生成/续期证书并把根 CA 装入当前用户信任库)",
  "2. **完全退出 Steam(托盘也退)再启动** —— 信任库由 Steam 宿主缓存,只重启游戏不生效",
  "3. 查看证书状态:`scripts\\gen_bridge_cert.ps1 -Status`",
  "",
  "**Full Changelog**: https://github.com/c1375rick/BabelTower/compare/v1.2.3...v1.2.4",
].join("\\n");
fs.writeFileSync("dist/release-notes-1.2.4.md", notes, "utf8");
console.log("local sha256: " + localSha);
console.log("notes written");