# Babel Tower —— Deadlock 聊天实时翻译

队友外语秒翻成中文（实测 1 秒以内），译文显示在原消息下方；也能在发送前把你的话翻成英文。默认 Bing 免 Key 开箱即用，另支持微软 / OpenAI 兼容 / DeepL / Google，主服务商挂了自动回退。

## 安装

1. 解压到任意目录，双击 `BabelTower-维护菜单.bat` → 选 1（一键装好证书和桥）
2. 把 `pak01_dir.vpk` 拖进 Deadlock Mod Manager（或拷到 `game\citadel\addons\`）
3. 进游戏按回车输入 `/tr` → 浏览器自动打开**网页设置页**(10 种界面语言,默认跟随游戏语言),
   点"测试连接"→"保存",**游戏里 1 秒内生效,不用重启**。

桥开机自启、常驻后台；更新 / 诊断 / 卸载都在同一个维护菜单里。Windows 10/11 + Deadlock（Steam），游戏启动项加一次 `-condebug`。

GPL-3.0，源码见 GitHub（c1375rick/BabelTower），与 Valve 无关。开发中使用 AI 编程助手辅助，作者审查测试后发布。
