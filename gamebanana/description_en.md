# Babel Tower — Real-time Chat Translator for Deadlock

Teammates' messages translated in ~1 second, shown right below the original. Translate your own messages before sending, too. Bing works out of the box with no key; Microsoft / OpenAI-compatible / DeepL / Google supported, with automatic fallback if the main provider fails.

**1.2.5** (pre-requisite update for users): fixes the **reversed outgoing translation direction** in 1.2.4 (Chinese messages were silently sent untranslated) — **1.2.4 users must upgrade**. This release consolidates the foundation: outgoing direction field name, non-Latin language scan (Russian/Korean/Japanese messages were skipped as symbols), config eventual consistency (stale-delta guard + 2s re-sync after discard — web changes apply in-game within seconds), dual-context direction freshness (convar read-through), and a root fix for a latent bug where the convar write never took effect. The in-game settings panel has been removed; all settings live on the web `/tr` page. Certificates and the bridge are unchanged — just replace the vpk and restart the game. Future updates will focus on features and UX, no more foundation changes.

## Install

1. Extract anywhere, double-click `StartDeadlock.bat` (auto-issues/renews the certificate and starts the bridge). On the **first** run — or after trusting a new certificate — **fully restart Steam afterwards (tray icon too)**: the trust store is cached by the Steam host process, restarting the game alone is not enough.
2. Drag `pak01_dir.vpk` into Deadlock Mod Manager (or copy to `game\citadel\addons\`)
3. In game, open chat, type `/tr` — your browser opens the **web settings page** (10 UI languages,
   follows the game language by default); hit "Test" then "Save" — **the game picks it up within a
   second, no restart needed**.

The bridge auto-starts with Windows and stays resident; update / diagnose / uninstall live in the same menu. Requires Windows 10/11 + Deadlock (Steam); add `-condebug` to the game's launch options once.

GPL-3.0, source on GitHub (c1375rick/BabelTower), not affiliated with Valve. Built with AI coding assistance, reviewed and tested by the author.
