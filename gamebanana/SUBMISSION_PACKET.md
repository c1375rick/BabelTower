# Babel Tower v1.0.0 — GameBanana Submission Packet (Deadlock)

> Copy the blocks below into the GameBanana submit form. The description is
> ready to paste as-is. The zip and banner are on your disk.

## FILES TO UPLOAD
- Mod file (required):  F:\BabelTower\dist\BabelTower-1.0.0-win64.zip   (36.9 MB)
- Banner image:         F:\BabelTower\gamebanana\banner_placeholder.png

## EXACT FORM FIELDS
- Game:            Deadlock  (game id 20948)  -> https://gamebanana.com/games/20948
- Submit URL:      https://gamebanana.com/add?gameid=20948   (login required)
- Section/Category: Mods  ->  UI Mods   (if "UI Mods" isn't listed that day, use "Tools & Utilities")
- Mod name:        Babel Tower - Deadlock In-game Chat Translator
- Version:         1.0.0
- Tags:            deadlock ui translation translator chat language chinese english tool utility
- Main download:   upload BabelTower-1.0.0-win64.zip
- Images:          upload banner_placeholder.png (add 2-3 real screenshots later if you have them)
- License:         GPL-3.0
- Homepage / Source: https://github.com/c1375rick/BabelTower
- Tick:            agree to terms

----------------------------------------------------------------------
## DESCRIPTION (copy everything below the line into the Description box)
----------------------------------------------------------------------

Babel Tower - Deadlock In-game Chat Translator

Real-time chat translation for Deadlock. Foreign messages are translated instantly with the result shown right below the original; you can also translate your own messages before sending (translation-only or bilingual).

No registration needed - the default provider is Bing's public free translation API (works in China without a proxy). Microsoft Azure is available as an optional provider.

FEATURES
- Real-time translation of incoming chat, golden text shown below each message
- Outgoing translation: Off / Translation-only / Bilingual (original | translation)
- Settings panel: press Enter, type /tr, or click the "译" button next to the chat input
- All settings are click-to-select (provider, target language, display mode, etc.)
- Local bridge auto-starts with Windows and auto-exits when the game closes
- Smart skips: own messages, commands (/), pure numbers/symbols, and text already in the target language
- Translation cache survives chat scroll recycling

INSTALLATION (3 steps)
1. Extract the zip anywhere (avoid spaces in the path, e.g. D:\BabelTower)
2. Install the mod: drag pak01_dir.vpk into Deadlock Mod Manager, or copy it to game\citadel\addons\ (rename to a free slot like pak25_dir.vpk if a file with that name already exists)
3. Enable the local bridge (choose one):
   - Recommended (permanent): run once
     powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Action Install
     (bridge auto-starts at login, auto-exits when the game closes)
   - Temporary: double-click StartDeadlock.bat before playing

4. In game: open chat (Enter), type /tr, click Test (测试) - it should show "测试成功: 你好", click Save (保存), close with ESC. Done!

No Node.js installation needed - a portable runtime is bundled.

NOTE FOR DMM USERS
Deadlock Mod Manager (DMM) can automatically install and manage in-game mods, but BabelTower's local bridge must be installed and run separately:
- DMM only installs the in-game mod (pak01_dir.vpk); it does not auto-start the local bridge
- The local bridge is the core translation component - without it, the mod does not work
- After installing the mod via DMM, you still need step 3 above to set up the bridge to auto-start at login, or start the bridge manually before each session

SETTINGS
- Provider: bing (free, default) / microsoft (Azure key)
- Target language: 简体中文 / 繁體中文 / English / 日本語 / 한국어 / Français / Deutsch / Español / custom
- Display mode: Bilingual (original + translation) / translation only
- Outgoing translation: Off / translation only / bilingual (original | translation)
- Outgoing target language: same language list

REQUIREMENTS
- Windows 10/11, Deadlock (Steam)
- Internet access to bing.com for the default provider

NOTES
- GPL-3.0 licensed. Source code: https://github.com/c1375rick/BabelTower
- The public Bing interface may occasionally be rate-limited; it retries automatically. Switch to the Microsoft provider if it's unreliable in your region.
- This mod is not affiliated with Valve.

AI-ASSISTED DEVELOPMENT DISCLOSURE
This project was developed with the help of an AI coding assistant (OpenClaw) for code writing/debugging, the simulation test harness, and build/release scripts. All code was reviewed and tested by the author before release; the author takes full responsibility for the project.

----------------------------------------------------------------------
中文说明 (Chinese)
----------------------------------------------------------------------

Babel Tower - Deadlock 聊天翻译 Mod

《Deadlock》游戏内实时聊天翻译：队友的外语消息自动翻译，金色译文显示在原消息下方；也支持发送前把消息翻译成目标语言（仅译文 / 原文|译文 双语）。

无需注册任何账号 —— 默认使用 Bing 公共免费翻译接口（国内直连可用）；可选 Microsoft Azure。

功能
- 入站消息实时翻译，译文以金色粗体显示在原文下方
- 发送前翻译：关 / 仅译文 / 双语（原文 | 译文）三态
- 设置面板：聊天输入 /tr 回车，或点聊天框右侧「译」按钮
- 所有选项均为点击选择（服务商 / 目标语言 / 显示模式 / 发送模式），减少误操作
- 本地桥随 Windows 登录自启，游戏退出自动关闭
- 智能跳过：自己的消息、指令（/ 开头）、纯数字符号、已是目标语言的文本
- 译文缓存：聊天滚动回收后自动重建译文

安装（3 步）
1. 解压压缩包到任意位置（建议路径不带空格，如 D:\BabelTower）
2. 安装游戏内 Mod：把 pak01_dir.vpk 拖入 Deadlock Mod Manager，或复制到 game\citadel\addons\（已有同名文件就改个空闲编号，如 pak25_dir.vpk）
3. 启动本地桥（二选一）：
   - 推荐（一劳永逸）：执行一次
     powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Action Install
     （开机自启桥，游戏退出自动关闭）
   - 临时：每次玩之前双击 StartDeadlock.bat

4. 进游戏：Enter 开聊天 → 输入 /tr → 点测试（应显示“测试成功: 你好”）→ 保存 → ESC 关闭。完成！

无需安装 Node.js —— 压缩包已内置便携版运行时。

DMM 用户说明
Deadlock Mod Manager (DMM) 可以自动安装与管理游戏内 Mod，但 BabelTower 的本地桥（bridge）需要单独安装并运行：
- DMM 只负责安装游戏内 Mod（pak01_dir.vpk），不会自动启动本地桥
- 本地桥是翻译的核心组件，没有桥，Mod 无法工作
- 使用 DMM 安装 Mod 后，仍需按第 3 步手动设置桥的开机自启，或每次玩之前手动启动桥

设置项
- 服务商：bing（免 Key，默认）/ microsoft（Azure Key）
- 目标语言：简体中文 / 繁體中文 / English / 日本語 / 한국어 / Français / Deutsch / Español / 自定义
- 显示模式：双语（原文+译文）/ 仅译文
- 发送前翻译：关 / 仅译文 / 双语（原文 | 译文）
- 发送目标语言：同上语言列表

环境要求
- Windows 10/11 + Deadlock（Steam）
- 默认服务商需要能访问 bing.com 的网络

说明
- GPL-3.0 协议；源代码：https://github.com/c1375rick/BabelTower
- Bing 公共接口偶发限流，会自动重试；你所在地区不稳定时可切换 Microsoft 服务商
- 本 Mod 与 Valve 无关

----------------------------------------------------------------------
## STEP-BY-STEP (manual browser submission)
----------------------------------------------------------------------
1. Open https://gamebanana.com/games/20948 and log in (or register).
2. Click "Submit a Mod" (top-right) or go to https://gamebanana.com/add?gameid=20948
3. Pick Section = Mods, then Category = UI Mods.
4. Mod name: paste "Babel Tower - Deadlock In-game Chat Translator"
5. Version: 1.0.0
6. Tags: paste -> deadlock ui translation translator chat language chinese english tool utility
7. Description: paste everything between the DESCRIPTION markers above.
8. Files: upload F:\BabelTower\dist\BabelTower-1.0.0-win64.zip as the main download.
9. Images: upload F:\BabelTower\gamebanana\banner_placeholder.png (add real screenshots later if available).
10. Add Homepage/Source = https://github.com/c1375rick/BabelTower and License = GPL-3.0.
11. Tick the agreement box, then Submit.
