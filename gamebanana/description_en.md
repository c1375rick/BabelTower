# Babel Tower — Real-time Chat Translator for Deadlock

Teammates' messages translated in ~1 second, shown right below the original. Translate your own messages before sending, too. Bing works out of the box with no key; Microsoft / OpenAI-compatible / DeepL / Google supported, with automatic fallback if the main provider fails.

## Install

1. Extract anywhere, double-click `BabelTower-维护菜单.bat` → 1 (sets up certificate + bridge)
2. Drag `pak01_dir.vpk` into Deadlock Mod Manager (or copy to `game\citadel\addons\`)
3. In game, open chat, type `/tr` → your browser opens the **web settings page** (10 UI languages,
   follows the game language by default); hit "Test" then "Save" — **the game picks it up within a
   second, no restart needed**.

The bridge auto-starts with Windows and stays resident; update / diagnose / uninstall live in the same menu. Requires Windows 10/11 + Deadlock (Steam); add `-condebug` to the game's launch options once.

GPL-3.0, source on GitHub (c1375rick/BabelTower), not affiliated with Valve. Built with AI coding assistance, reviewed and tested by the author.
