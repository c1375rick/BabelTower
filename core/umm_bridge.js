"use strict";
// UMM (Universal Mod Manager) 集成参考实现 —— core 侧纯函数。
// 客户端 mod/panorama/scripts/lingua_chat.js 内标注 @sync umm-manifest / umm-apply / umm-bus
// 的代码块是本文件的手工同步副本(客户端依赖 Panorama 全局,无法 require)。
// 行为对账由 tests/umm_integration.test.js 执行:副本漂移当场爆红,不再依赖"改一处必查另一处"的自觉。
//
// 协议文档: https://xaohs.github.io/universal-mod-manager/authors/integration/
// 通道: ClientUI_FireOutput(引擎声明,跨 Panorama 上下文的唯一通道,字符串载荷)。
// 消息: {umm:1,t:"hello"} / {umm:1,t:"register",id,name,settings,values} / {umm:1,t:"set",id,key,value}
//
// 设计要点(与客户端副本一致,勿单方面改动):
// - values 随 manifest 上报当前值:LCT 有自己的持久化(convar+面板属性),
//   未装 UMM 时 boot 绝不能跑"apply 默认值"循环(会把用户配置打回出厂)。
// - API Key 不进 UMM:通道是明文 JSON 广播,所有 mod 都能听到。
// - set 载荷不可信:通道广播可被任意 mod 伪造,逐键做类型/枚举/范围校验。

const UMM_CHANNEL = "ClientUI_FireOutput";
const UMM_PROTOCOL = 1;
const UMM_ID = "babeltower";
const UMM_NAME = "Babel Tower";

// @sync 与客户端 umm-manifest 块逐字对齐(JSON.stringify 相等是测试断言)
const UMM_SETTINGS = [
  { type: "group", label: "Translation" },
  { id: "enabled", type: "toggle", label: "Enabled", default: true },
  {
    id: "provider", type: "select", label: "Provider", default: "bing",
    options: [
      { value: "bing", label: "Bing (free)" },
      { value: "microsoft", label: "Microsoft (Azure)" },
      { value: "openai", label: "OpenAI-compatible" },
      { value: "deepl", label: "DeepL" },
      { value: "google", label: "Google" },
    ],
  },
  {
    id: "targetLanguage", type: "select", label: "Target Language", default: "zh-Hans",
    options: [
      { value: "zh-Hans", label: "简体中文" },
      { value: "zh-Hant", label: "繁體中文" },
      { value: "en", label: "English" },
      { value: "ja", label: "日本語" },
      { value: "ko", label: "한국어" },
      { value: "fr", label: "Français" },
      { value: "de", label: "Deutsch" },
      { value: "es", label: "Español" },
    ],
  },
  {
    id: "displayMode", type: "select", label: "Display Mode", default: "bilingual",
    options: [
      { value: "bilingual", label: "Bilingual" },
      { value: "translation_only", label: "Translation only" },
    ],
  },
  { type: "group", label: "Behaviour" },
  {
    id: "outgoing", type: "select", label: "Outgoing Translation", default: "off",
    options: [
      { value: "off", label: "Off (send original)" },
      { value: "translation", label: "Translation only" },
      { value: "bilingual", label: "Bilingual (original | translation)" },
    ],
  },
  {
    id: "outgoingTarget", type: "select", label: "Outgoing Target Language", default: "en",
    options: [
      { value: "en", label: "English" },
      { value: "zh-Hans", label: "简体中文" },
      { value: "zh-Hant", label: "繁體中文" },
      { value: "ja", label: "日本語" },
      { value: "ko", label: "한국어" },
    ],
  },
  { id: "force", type: "toggle", label: "Force translate (skip language detection)", default: false },
  { id: "timeoutMs", type: "slider", label: "Timeout", min: 5000, max: 30000, step: 1000, default: 15000, unit: "ms" },
  { type: "group", label: "Misc" },
  { id: "translateOwn", type: "toggle", label: "Translate own messages", default: true },
  { id: "chatLog", type: "toggle", label: "Chat log (save by match ID)", default: true },
];

const UMM_MANAGED_KEYS = {
  enabled: true, provider: true, targetLanguage: true, displayMode: true,
  outgoing: true, outgoingTarget: true, force: true, timeoutMs: true,
  translateOwn: true, chatLog: true,
};

const UMM_ENUM_KEYS = { provider: 1, targetLanguage: 1, displayMode: 1, outgoing: 1, outgoingTarget: 1 };

// 这些键在桥端同时存在两种形态: 扁平(cfg.defaults.* / cfg.timeoutMs)与 ui 子对象(cfg.ui.*)。
// /tr 面板保存时两种形态同时发(collectPanelConfig);UMM 补丁必须镜像同样的双形态 ——
// 否则只写扁平形态时,面板打开时 GET 回来的 cfg.ui.* 会把改动覆盖回去
// (2026-09-25 实锢: UMM 改目标语言后 /tr 面板显示不变,翻译语言也不变)。
const UMM_UI_MIRROR_KEYS = {
  enabled: 1, provider: 1, displayMode: 1, outgoing: 1,
  outgoingTarget: 1, targetLanguage: 1, force: 1, timeoutMs: 1,
};

function optionValues(key) {
  for (let i = 0; i < UMM_SETTINGS.length; i += 1) {
    const s = UMM_SETTINGS[i];
    if (s && s.id === key && s.options) return s.options.map((o) => o.value);
  }
  return [];
}

// 纯函数: 校验单键 set 并计算变更(会原地写 cfg)。
// 返回 { accepted, patch }:patch 键型与客户端 bridgePost("config") 载荷一致,
// 且对 UMM_UI_MIRROR_KEYS 内的键同时产出扁平 + ui 子对象双形态(与 collectPanelConfig 同构)。
function applyUmmSettingCore(cfg, key, value) {
  if (!UMM_MANAGED_KEYS[key]) return { accepted: false, patch: null };
  if (typeof value === "undefined") return { accepted: false, patch: null };
  if (!cfg) return { accepted: false, patch: null };
  const patch = {};
  const mirror = {};
  if (key === "timeoutMs") {
    const n = Number(value);
    if (!isFinite(n) || n < 1000 || n > 60000) return { accepted: false, patch: null };
    cfg.timeoutMs = Math.floor(n);
    patch.timeoutMs = cfg.timeoutMs;
  } else if (key === "force" || key === "enabled" || key === "translateOwn" || key === "chatLog") {
    cfg[key] = !!value;
    patch[key] = !!value;
  } else if (UMM_ENUM_KEYS[key]) {
    if (typeof value !== "string") return { accepted: false, patch: null };
    if (optionValues(key).indexOf(value) === -1) return { accepted: false, patch: null };
    cfg[key] = value;
    patch[key] = value;
  } else {
    return { accepted: false, patch: null };
  }
  if (UMM_UI_MIRROR_KEYS[key]) {
    mirror[key] = patch[key];
    patch.ui = mirror;
  }
  return { accepted: true, patch: patch };
}

// 纯函数: 总线消息裁决(与客户端 onUmmBus 对应)。
// 返回 null(忽略) | {kind:"announce"} | {kind:"apply", key, value}
function evaluateUmmBus(payload) {
  // 廉价预检: 通道上还有其它 mod 的广播,非 UMM 流量不进 JSON.parse
  if (typeof payload !== "string" || payload.indexOf('"umm"') === -1) return null;
  let msg = null;
  try { msg = JSON.parse(payload); } catch (e) { return null; }
  if (!msg || msg.umm !== UMM_PROTOCOL) return null;
  if (msg.t === "hello") return { kind: "announce" };
  if (msg.t === "set" && msg.id === UMM_ID) return { kind: "apply", key: msg.key, value: msg.value };
  return null;
}

// manifest 注册时随行上报的当前值(与客户端 ummCurrentValues 对应)。
// 只上报清单内存在的键,缺失键留给 UMM 用声明默认值。
function ummCurrentValuesCore(cfg) {
  const values = {};
  if (!cfg) return values;
  for (const key in UMM_MANAGED_KEYS) {
    if (typeof cfg[key] !== "undefined") values[key] = cfg[key];
  }
  return values;
}

// 标签本地化: UMM 协议的 label 是明文字符串,声明什么显示什么(无内建 i18n)。
// 按 LCT 的 uiLang 在 announce 时做一层替换;存储按 id 不按 label,切语言不丢设置。
// 英文是基准(UMM_SETTINGS 原值),中文映射按 group label / setting id / option value 定位。
const UMM_I18N_ZH = {
  groups: { "Translation": "翻译", "Behaviour": "行为", "Misc": "其他" },
  settings: {
    enabled: "启用翻译",
    provider: "服务商",
    targetLanguage: "目标语言",
    displayMode: "显示模式",
    outgoing: "发送前翻译",
    outgoingTarget: "发送目标语言",
    force: "强制翻译(跳过语言判断)",
    timeoutMs: "超时",
    translateOwn: "翻译自己的消息",
    chatLog: "聊天日志(按比赛 ID 保存)",
  },
  options: {
    provider: { "bing": "Bing(免费)", "microsoft": "Microsoft(Azure)", "openai": "OpenAI 兼容", "deepl": "DeepL", "google": "Google" },
    displayMode: { "bilingual": "双语(原文+译文)", "translation_only": "仅译文" },
    outgoing: { "off": "关(发原文)", "translation": "仅译文", "bilingual": "双语(原文 | 译文)" },
  },
};

// 纯函数: 返回本地化后的 manifest 深拷贝(id/default/value 一律不动,只换展示文本)。
// lang !== "zh" 时原样返回(英文基准无需克隆)。
function localizeUmmManifest(list, lang) {
  if (lang !== "zh") return list;
  const t = UMM_I18N_ZH;
  return list.map((s) => {
    if (s.type === "group") {
      return { type: "group", label: t.groups[s.label] || s.label };
    }
    const out = Object.assign({}, s);
    if (t.settings[s.id]) out.label = t.settings[s.id];
    if (Array.isArray(s.options) && t.options[s.id]) {
      out.options = s.options.map((o) =>
        t.options[s.id][o.value] ? { value: o.value, label: t.options[s.id][o.value] } : o);
    }
    return out;
  });
}

module.exports = {
  UMM_CHANNEL, UMM_PROTOCOL, UMM_ID, UMM_NAME, UMM_SETTINGS, UMM_MANAGED_KEYS,
  UMM_UI_MIRROR_KEYS, UMM_I18N_ZH, localizeUmmManifest,
  applyUmmSettingCore, evaluateUmmBus, ummCurrentValuesCore,
};
