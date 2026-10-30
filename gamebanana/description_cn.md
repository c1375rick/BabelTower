# Babel Tower —— Deadlock 游戏内实时翻译

队友的消息约 1 秒内译好，直接显示在原消息下方。也可以在发送前把自己的话翻成英文。默认 Bing 无 Key 开箱即用；另支持微软 / OpenAI 兼容 / DeepL / Google，主通道故障自动切换。

**1.2.4**：修复 10-29 游戏更新导致的 https 桥全断（页面 JS 被拦 + 标题事件被砍）。证书改**本地 CA 链签发**（397 天叶子，启动器自动续期——首次信任后需完全重启 Steam，托盘也退）；桥面板改用引擎原生 `CitadelHTMLPanel`（QOL 同款），标题事件走面板绑定；探针**事件驱动结算**（开机秒级 ALIVE）；hash 快通道接线补全 + 常驻漂移自愈。游戏更新后再遇翻译失联，先跑 `scripts\gen_bridge_cert.ps1 -Status`。

## 安装

1. 解压到任意目录，双击 `StartDeadlock.bat`（自动签发/续期证书并启动桥）。**首次**运行——或信任了新证书之后——**需完全退出并重启 Steam（托盘也退）**：信任库由 Steam 宿主进程缓存，只重启游戏不生效。
2. 把 `pak01_dir.vpk` 拖进 Deadlock Mod Manager（或拷到 `game\citadel\addons\`）
3. 进游戏打开聊天输入 `/tr` —— 浏览器自动打开**网页设置页**（10 种界面语言，默认跟随游戏语言），
   点"测试翻译"再"保存"，**游戏内 1 秒内生效，无需重启**。

桥开机自启并常驻后台；更新 / 诊断 / 卸载都在同一个维护菜单里。Windows 10/11 + Deadlock（Steam）；游戏启动项加一次 `-condebug`。

GPL-3.0，源码在 GitHub（c1375rick/BabelTower），与 Valve 无关。项目使用 AI 辅助编码，经作者审核与测试后发布。
