# Babel Tower - Deadlock In-game Chat Translator

Real-time chat translation for Deadlock. Foreign messages are translated instantly with the result shown right below the original; you can also translate your own messages before sending (translation-only or bilingual).

**No registration needed** - the default provider is Bing's public free translation API (works in China without a proxy). Microsoft Azure is available as an optional provider.

## Features

- Real-time translation of incoming chat, golden text shown below each message
- Outgoing translation: Off / Translation-only / Bilingual (original | translation)
- Settings panel: press Enter, type `/tr`, or click the "译" button next to the chat input
- All settings are click-to-select (provider, target language, display mode, etc.)
- Local bridge auto-starts with Windows and auto-exits when the game closes
- Smart skips: own messages, commands (/), pure numbers/symbols, and text already in the target language
- Translation cache survives chat scroll recycling

## Installation (3 steps)

1. Extract the zip anywhere (avoid spaces in the path, e.g. `D:\BabelTower`)
2. Install the mod: drag `pak01_dir.vpk` into **Deadlock Mod Manager**, or copy it to `game\citadel\addons\` (rename to a free slot like `pak25_dir.vpk` if a file with that name already exists)
3. Enable the local bridge (choose one):
   - **Recommended (permanent):** run once
     `powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Action Install`
     (bridge auto-starts at login, auto-exits when the game closes)
   - **Temporary:** double-click `StartDeadlock.bat` before playing

4. In game: open chat (Enter), type `/tr`, click **测试 (Test)** - it should show "测试成功: 你好", click **保存 (Save)**, close with ESC. Done!

> No Node.js installation needed - a portable runtime is bundled.

## ⚠️ Note for DMM Users

**Deadlock Mod Manager (DMM)** can automatically install and manage in-game mods, but BabelTower's **local bridge** must be installed and run separately:

- DMM only installs the in-game mod (`pak01_dir.vpk`); it **does not auto-start the local bridge**
- The local bridge is the core translation component - **without it, the mod does not work**
- After installing the mod via DMM, you still need to follow **step 3** above to set up the bridge to auto-start at login, or start the bridge manually before each session

> In short: DMM installs the in-game mod for you, but the bridge (the translation engine) must be run separately on its own.

## Settings

| Setting | Options |
| --- | --- |
| Provider | bing (free, default) / microsoft (Azure key) |
| Target language | 简体中文 / 繁體中文 / English / 日本語 / 한국어 / Français / Deutsch / Español / custom |
| Display mode | Bilingual (original + translation) / translation only |
| Outgoing translation | Off / translation only / bilingual (original \| translation) |
| Outgoing target language | Same language list |

## Requirements

- Windows 10/11, Deadlock (Steam)
- Internet access to bing.com for the default provider

## Notes

- GPL-3.0 licensed. Source code: https://github.com/c1375rick/BabelTower
- The public Bing interface may occasionally be rate-limited; it retries automatically. Switch to the Microsoft provider if it's unreliable in your region.
- This mod is not affiliated with Valve.

## AI-Assisted Development Disclosure

This project was developed with the help of an AI coding assistant (OpenClaw) for the following work:
- Code writing and debugging, including locating and fixing defects such as chat-row recycling and the serial-queue concurrency issue
- Writing the simulation test harness (`lingua_chat_simtest.js`) used to regression-test the translation feature in an environment without real teammates
- Writing and maintaining the build/release scripts

All code was reviewed and tested by the author before release; the author takes full responsibility for the project's functionality, quality, and compliance.
