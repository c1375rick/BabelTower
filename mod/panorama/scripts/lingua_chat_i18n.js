// Babel Tower - UI 文案/选项表数据文件(2026-10-28 任务①E:从 lingua_chat.js 外置)
// ------------------------------------------------------------------
// 用途:设置面板的多语言文案表(LCT_I18N_STRINGS)+ 选择控件选项表
//   (PROVIDER_OPTIONS / LANGUAGE_OPTIONS / DISPLAY_MODES / OUTGOING_MODES /
//    UI_LANG_OPTIONS)+ UI convar 名(UI_CONVAR)。
// 数据文件,由主文件消费 —— 纯数据、零逻辑:不碰 DOM、不碰桥、不注册事件。
// 装载顺序契约:必须在 lingua_chat.vjs_c **之前**加载(chat.xml/hudchat.xml 中位于
//   lingua_chat_btipc.vjs_c 之后、主脚本之前)。主文件在 IIFE 顶部把全局读成局部
//   const 别名(STRINGS / FIELD_OPTIONS / PROVIDER_OPTIONS / ... / UI_CONVAR),
//   所以主文件内的引用点与游戏内行为零改动。
// 共享机制:Panorama 无模块系统(const/function 是 script 隔离的),本文件用
//   **无声明赋值**把数据挂到全局(与 lingua_chat_*_fallback.vjs_c 同法):
//     LCT_I18N_STRINGS  —— 文案表:key -> { zh, en }
//     LCT_FIELD_OPTIONS —— 选项表打包:{ PROVIDER_OPTIONS, LANGUAGE_OPTIONS,
//                            DISPLAY_MODES, OUTGOING_MODES, UI_LANG_OPTIONS, UI_CONVAR }
//   外置会破坏双向对账。
LCT_I18N_STRINGS = {
  panelTitle: { zh: "Babel Tower 设置", en: "Babel Tower Settings" },
  rowBridgeStatus: { zh: "本地桥状态", en: "Bridge Status" },
  rowEnabled: { zh: "启用翻译", en: "Translation" },
  rowProvider: { zh: "服务商(点击选择)", en: "Provider (click to select)" },
  rowApiKey: { zh: "API Key", en: "API Key" },
  rowRegion: { zh: "区域(可选,Microsoft)", en: "Region (optional, Microsoft)" },
  rowOpenaiBase: { zh: "OpenAI 兼容 Base URL", en: "OpenAI-compatible Base URL" },
  rowOpenaiModel: { zh: "模型名(如 gpt-4o-mini / llama3)", en: "Model (e.g. gpt-4o-mini / llama3)" },
  rowDeeplEndpoint: { zh: "DeepL 端点(free/pro)", en: "DeepL endpoint (free/pro)" },
  rowFallback: { zh: "服务商失败自动回退(逗号分隔,如 microsoft,openai;仅使用已填 Key 的)", en: "Auto-fallback on failure (comma-separated, e.g. microsoft,openai)" },
  rowTargetLang: { zh: "目标语言(点击选择)", en: "Target Language (click to select)" },
  rowDisplayMode: { zh: "显示模式(点击选择)", en: "Display Mode (click to select)" },
  rowOutgoing: { zh: "发送前翻译(点击选择)", en: "Outgoing Translation (click to select)" },
  rowOutgoingTarget: { zh: "发送目标语言(点击选择)", en: "Outgoing Target Language (click to select)" },
  rowTimeout: { zh: "超时(ms)", en: "Timeout (ms)" },
  rowForce: { zh: "强制翻译(跳过语言判断)", en: "Force translate (skip language detection)" },
  rowTranslateOwn: { zh: "翻译自己的消息", en: "Translate own messages" },
  rowChatLog: { zh: "聊天日志(按比赛 ID 保存到 logs/chat)", en: "Chat log (save by match ID to logs/chat)" },
  rowUILang: { zh: "界面语言", en: "UI Language" },
  optBing: { zh: "bing(免 Key)", en: "bing (free, no key)" },
  optMicrosoft: { zh: "microsoft(Azure Key)", en: "microsoft (Azure Key)" },
  optOpenai: { zh: "OpenAI 兼容(自定义)", en: "OpenAI-compatible (custom)" },
  optDeepl: { zh: "DeepL(需 Key)", en: "DeepL (key required)" },
  optGoogle: { zh: "Google Cloud(需 Key)", en: "Google Cloud (key required)" },
  optLangZhHans: { zh: "简体中文 (zh-Hans)", en: "简体中文 (zh-Hans)" },
  optLangZhHant: { zh: "繁體中文 (zh-Hant)", en: "繁體中文 (zh-Hant)" },
  optLangEn: { zh: "English 英语 (en)", en: "English (en)" },
  optLangJa: { zh: "日本語 日语 (ja)", en: "日本語 (ja)" },
  optLangKo: { zh: "한국어 韩语 (ko)", en: "한국어 (ko)" },
  optLangFr: { zh: "Français 法语 (fr)", en: "Français (fr)" },
  optLangDe: { zh: "Deutsch 德语 (de)", en: "Deutsch (de)" },
  optLangEs: { zh: "Español 西语 (es)", en: "Español (es)" },
  optLangCustom: { zh: "自定义(手输语言代码)", en: "Custom (enter language code)" },
  optBilingual: { zh: "双语(原文+译文)", en: "Bilingual (original + translation)" },
  optTranslationOnly: { zh: "仅译文", en: "Translation only" },
  optOutOff: { zh: "关(发原文)", en: "Off (send original)" },
  optOutTranslation: { zh: "仅译文", en: "Translation only" },
  optOutBilingual: { zh: "双语(原文 | 译文)", en: "Bilingual (original | translation)" },
  optUILangZh: { zh: "中文", en: "中文 (Chinese)" },
  optUILangEn: { zh: "English(英语)", en: "English" },
  optUILangAuto: { zh: "自动(跟随游戏)", en: "Auto (follow game)" },
  btnSave: { zh: "保存", en: "Save" },
  btnTest: { zh: "测试", en: "Test" },
  btnHint: { zh: "选项点击选择 · 改完点保存 · 设置推荐用桌面网页(/tr 打开)· 点右下角 X 关闭", en: "Click to select \u00b7 Save when done \u00b7 Desktop page recommended (type /tr) \u00b7 Click X to close" },
  bridgeUp: { zh: "运行中", en: "Running" },
  bridgeDown: { zh: "未运行", en: "Not running" },
  bridgePort: { zh: "端口", en: "port" },
  bridgeStatusPrefix: { zh: "桥状态: ", en: "Bridge: " },
  bridgeOnline: { zh: "桥在线", en: "Bridge online" },
  bridgeOffline: { zh: "桥离线,翻译不可用", en: "Bridge offline, translation unavailable" },
  bridgeDmmHint: { zh: "仅装了翻译面板(DMM 或手动 vpk),还需本地桥:下载 GitHub 完整包并运行 StartDeadlock.bat", en: "Only the panel is installed (DMM or manual vpk); the local bridge is also required: download the full package from GitHub and run StartDeadlock.bat" },
  errBridgeNotRunning: { zh: "桥未运行:请在 BabelTower 目录运行 StartDeadlock.bat(仅装 vpk 不够)", en: "Bridge not running: run StartDeadlock.bat in the BabelTower folder (the vpk alone is not enough)" },
  errBridgeNav: { zh: "翻译面板不可用;若持续出现,请运行 StartDeadlock.bat 启动桥", en: "Panel unavailable; if this persists, run StartDeadlock.bat to start the bridge" },
  errTimeout: { zh: "翻译超时", en: "Translation timed out" },
  hintBing: { zh: "免 Key 公共接口,可能有隐形限流;失败可配置自动回退", en: "Free public API, may have hidden rate limits; configure auto-fallback on failure" },
  hintMicrosoft: { zh: "Azure Translator Key(可留空则跳过该服务商)", en: "Azure Translator Key (leave empty to skip)" },
  hintOpenai: { zh: "OpenAI 兼容端点:DeepSeek 填 https://api.deepseek.com + deepseek-chat;Ollama/LM Studio/OneAPI 亦可", en: "OpenAI-compatible endpoint: for DeepSeek use https://api.deepseek.com + deepseek-chat; also Ollama/LM Studio/OneAPI" },
  hintDeepl: { zh: "DeepL API Key(free/pro 端点可选)", en: "DeepL API Key (free/pro endpoint available)" },
  hintGoogle: { zh: "Google Cloud Translation API Key", en: "Google Cloud Translation API Key" },
  msgSaveOk: { zh: "已保存", en: "Saved" },
  msgSaveFail: { zh: "保存失败", en: "Save failed" },
  msgTesting: { zh: "测试中...最长约 ", en: "Testing... up to ~" },
  msgTestSec: { zh: " 秒,请稍候", en: " seconds, please wait" },
  msgTestOk: { zh: "测试成功: ", en: "Test passed: " },
  msgTestFail: { zh: "测试失败", en: "Test failed" },
  msgSavedWith: { zh: "已保存(服务商 ", en: "Saved (provider: " },
  msgLogOn: { zh: "聊天日志已开启(按比赛 ID 存 logs/chat)", en: "Chat log enabled (saves by match ID)" },
  msgLogOff: { zh: "聊天日志已关闭", en: "Chat log disabled" },
  msgTranslateOwnOn: { zh: "翻译自己的消息已开启", en: "Translate own messages enabled" },
  msgTranslateOwnOff: { zh: "翻译自己的消息已关闭", en: "Translate own messages disabled" },
  updateAvailable: { zh: "  BabelTower 有新版本 ", en: "  BabelTower update available: " },
  updateHint: { zh: "请到 GitHub 或 GameBanana 更新", en: "Please update via GitHub or GameBanana" },
};

LCT_FIELD_OPTIONS = {
  // 选项表(驱动选择控件)
  PROVIDER_OPTIONS: [
    { value: "bing", key: "optBing" },
    { value: "microsoft", key: "optMicrosoft" },
    { value: "openai", key: "optOpenai" },
    { value: "deepl", key: "optDeepl" },
    { value: "google", key: "optGoogle" },
  ],
  LANGUAGE_OPTIONS: [
    { value: "zh-Hans", key: "optLangZhHans" },
    { value: "zh-Hant", key: "optLangZhHant" },
    { value: "en", key: "optLangEn" },
    { value: "ja", key: "optLangJa" },
    { value: "ko", key: "optLangKo" },
    { value: "fr", key: "optLangFr" },
    { value: "de", key: "optLangDe" },
    { value: "es", key: "optLangEs" },
    { value: "custom", key: "optLangCustom" },
  ],
  DISPLAY_MODES: [
    { value: "bilingual", key: "optBilingual" },
    { value: "translation_only", key: "optTranslationOnly" },
  ],
  OUTGOING_MODES: [
    { value: "off", key: "optOutOff" },
    { value: "translation", key: "optOutTranslation" },
    { value: "bilingual", key: "optOutBilingual" },
  ],
  UI_LANG_OPTIONS: [
    { value: "auto", key: "optUILangAuto" },
    { value: "zh", key: "optUILangZh" },
    { value: "en", key: "optUILangEn" },
  ],
  UI_CONVAR: "lct_ui",
};
