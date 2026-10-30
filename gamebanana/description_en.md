# Babel Tower — Real-time Chat Translator for Deadlock

Teammates' messages translated in ~1 second, shown right below the original. Translate your own messages before sending, too. Bing works out of the box with no key; Microsoft / OpenAI-compatible / DeepL / Google supported, with automatic fallback if the main provider fails.

**1.2.4**: fixes the Oct-29 game update breaking the https bridge (page JS blocked + title events cut). Certificates are now issued by a **local CA chain** (397-day leaf, auto-renewed by the launcher — after the first trust, fully restart Steam, tray included); the bridge panel now uses the engine's `CitadelHTMLPanel` (QOL-style) and title events arrive via panel-bound handlers; the probe settles **event-driven** (instant ALIVE at boot); the fast hash channel is fully wired with drift self-healing. If chat translation ever dies after a game update, run `scripts\gen_bridge_cert.ps1 -Status` first.

## Install

1. Extract anywhere, double-click `StartDeadlock.bat` (auto-issues/renews the certificate and starts the bridge). On the **first** run — or after trusting a new certificate — **fully restart Steam afterwards (tray icon too)**: the trust store is cached by the Steam host process, restarting the game alone is not enough.
2. Drag `pak01_dir.vpk` into Deadlock Mod Manager (or copy to `game\citadel\addons\`)
3. In game, open chat, type `/tr` — your browser opens the **web settings page** (10 UI languages,
   follows the game language by default); hit "Test" then "Save" — **the game picks it up within a
   second, no restart needed**.

The bridge auto-starts with Windows and stays resident; update / diagnose / uninstall live in the same menu. Requires Windows 10/11 + Deadlock (Steam); add `-condebug` to the game's launch options once.

GPL-3.0, source on GitHub (c1375rick/BabelTower), not affiliated with Valve. Built with AI coding assistance, reviewed and tested by the author.
