// Contributor: Thirt927 (https://github.com/Thirt927/BabelTower), merged 2026-08-13 under GPL-3.0
// Babel Tower - Deadlock 聊天翻译 Panorama 脚本
// ------------------------------------------------------------------
// 独立实现(不复制任何现有 mod 代码),技术路线与 DLCT 一致:
//   扫描聊天行 -> 去重 -> 隐藏 HTML 面板桥接本地 Core -> 原文下方追加译文
// 约定:
//   - 严格 IIFE, UPPER_SNAKE_CASE 常量, camelCase 函数
//   - 所有 volatile 调用 try/catch 包裹
//   - 不假设浏览器 DOM API(fetch/setInterval/URLSearchParams 等不可用)
//   - $.Schedule 单位为秒
// 注意:
//   - 本脚本覆盖聊天布局后,TextEntry 提交由 LCTOnChatSubmit 接管,
//     命令/发送前翻译处理后,再派发 CitadelChatInputSubmitted 事件触发原版发送。
(() => {
  "use strict";

  const LOG_PREFIX = "[LCT]";
  const VERSION = "1.0.0-beta.2";

  // ---- 原版聊天结构 ID(当前 Deadlock 版本稳定)----
  const CHAT_ROOT_ID = "Chat";
  const CHAT_MESSAGES_ID = "ChatMessages";
  const MESSAGE_SOURCE_ID = "MessageSource";
  const MESSAGE_CONTENTS_ID = "MessageContents";
  const MESSAGE_BODY_CLASS = "MessageBody";
  const CHAT_INPUT_ID = "ChatInput";
  const CHAT_TARGET_LABEL_ID = "ChatTargetLabel";
  const SENDER_NAME_CLASS = "SenderName";
  const CHANNEL_NAME_CLASS = "ChannelName";
  // 自己的消息标记:引擎渲染本地玩家消息时,行内会放一个 class="SenderLocalClient" 的面板
  // (原版 snippet ChatMessageSender_LocalClient;注意是 class 不是 id,必须用 findClass 匹配)
  const LOCAL_CLIENT_ID = "SenderLocalClient";

  // ---- HUD 顶栏聊天结构(citadel_hud_top_bar_chat.vxml,与 QoL 类 HUD mod 兼容:不改布局只扫描)----
  const HUD_CHAT_CLASS = "CitadelHudTopBarChat"; // 面板类型(Team1Chat/Team2Chat 两个实例);type 不是 class,遍历不到,仅作兕底
  const HUD_CHAT_IDS = ["Team1Chat", "Team2Chat"]; // 布局写死的固定 id(主查找路径)
  const HUD_MESSAGES_ID = "Messages"; // 顶栏气泡容器
  const HUD_BUBBLE_CLASS = "ChatBubble"; // 气泡(区分 HUD 行与左下聊天行)
  const HUD_TEXT_ID = "MessageText"; // 气泡内文本 Label
  const TRANS_LABEL_HUD_CLASS = "LCTTranslationHud";
  const TRANS_LABEL_LOBBY_CLASS = "LCTTranslationLobby";

  // ---- 大厅聊天结构(hudchat.vxml:ChatLinesPanel 容器,行=ChatLineContainer)----
  const CHAT_LINES_PANEL_ID = "ChatLinesPanel";
  const LOBBY_ROW_CLASS = "ChatLineContainer";
  const LOBBY_LINE_CLASS = "ChatLine";
  const LOBBY_PERSONA_CLASS = "ChatPersona";
  const LOBBY_PREFIX_CLASS = "ChatLinePrefix";

  // ---- LinguaChat 自身 ID / class ----
  const SETTINGS_BUTTON_ID = "LCTSettingsButton";
  const SETTINGS_PANEL_ID = "LCTSettingsPanel";
  const SETTINGS_VISIBLE_CLASS = "LCTVisible";
  const STATUS_LABEL_ID = "LCTStatusLabel";
  const TRANS_LABEL_CLASS = "LCTTranslation";
  const TRANS_ERROR_CLASS = "LCTTranslationError";
  const BRIDGE_PANEL_ID = "LCTBridgePanel";
  const BRIDGE_PANEL_CLASS = "LCTBridgePanel";

  // ---- 轮询节奏 ----
  const FAST_POLL_SECONDS = 0.2;
  const SLOW_POLL_SECONDS = 0.8;
  const BOOTSTRAP_TAIL_SCAN_LIMIT = 24; // 首次只扫末尾,避免翻历史
  const LOW_LATENCY_TAIL_SCAN_LIMIT = 6; // 每次额外扫末尾,保证低延迟
  const HUD_OVERLAY_LIMIT = 10; // HUD 译文浮层上限(超过则清理最旧,防内存泄漏)
  const TITLE_POLL_SECONDS = 0.1;
  const BRIDGE_ALIVE_SECONDS = 1.5;
  // ���P:health ��1%��d�pM�e�(MS�nb� DOM ��糧�)
  const BRIDGE_OFFLINE_GRACE_SECONDS = 25; // 桥页面存活标记的等待上限
  // 离线宽限:health 连续失败超过此秒数才把桥标红(避免打开设置面板时 DOM 抖动误报离线)
  const RETRY_LIMIT = 2; // 每条消息最多尝试次数(含首次)
  const RETRY_DELAY_SECONDS = 0.4;
  const OUTGOING_TIMEOUT_MS = 20000; // 出站翻译超时:超过则按原文发送,避免卡住重复按键。8s 覆盖 DeepSeek 等 API 服务商正常延迟(1-6s)及 Bing 冷启动;计时从任务开始处理算起(见 dispatchJob)
  const CACHE_LIMIT = 300;
  const SEEN_LIMIT = 500;
  const PLAYER_INFO_SCAN_LIMIT = 24; // Players.GetPlayerInfo 扫描上限(含自己)
  const LOG_DEDUP_WINDOW_MS = 15000; // HUD/未填充条目与完整条目的日志去重窗口
  const LOG_DEDUP_LIMIT = 128; // recentLogs 去重缓存上限
  const PENDING_LOG_TIMEOUT_MS = 6000; // 未填充完整条目的挂起等待窗口(超时才兜底落盘)
  const MAX_ACTIVE_REQUESTS = 1; // 传输层单槽(HTML 面板+title 轮询),并发>1 会产生 supersede 竞争,保持串行
  const UNKNOWN_NAME = "<unknown>";

  // ---- 本地桥 ----
  const BRIDGE_HOST = "localhost"; // 用 localhost 而非 127.0.0.1:当前 Deadlock 版本 HTML 面板(SetURL)对 http://127.0.0.1 本地回环拦截,仅放行 localhost
  const BRIDGE_PORT = 8791; // 与 core/config.json 保持一致
  const TITLE_PREFIX = "LCT";
  const TITLE_ALIVE = "lct-alive";
  const BRIDGE_STATUS_LABEL_ID = "LCTBridgeStatusLabel";
  const BRIDGE_HINT_LABEL_ID = "LCTBridgeHintLabel";
  const BRIDGE_DOT_ID = "LCTBridgeDot";
  const OUTGOING_FAIL_TIP_ID = "LCTOutgoingFailTip";
  const DMM_HINT = "若通过 DMM(Deadlock Mod Manager)安装,仅有翻译面板,需另装本地桥:下载 GitHub 完整包运行 StartDeadlock.bat";

  // ---- 英雄/物品名保护(翻译前占位,翻译后还原) ----
  // 默认用下面硬编码的兜底名单;启动 healthCheck 成功后会从桥 /api/v1/gamenames
  // 拉取全量名单(285 条,随游戏更新自动刷新)覆盖这里的兜底值,消除双源漂移。
  // 注意:兜底名单全小写;桥侧 gamenames.json key 是原始大小写,匹配时 case-insensitive。
  // 按长度降序排列,避免短名误匹配长名的子串(如 "geist" 误匹配 "lady geist")
  let PROTECT_NAMES = [
    // 多词物品(长优先)
    "spirit shredder bullets", "bullet resist shredder", "armor piercing rounds",
    "ballistic enchantment", "escalating resilience", "intensifying magazine",
    "mystic vulnerability", "radiant regeneration", "mystic regeneration",
    "high-velocity rounds", "enchanter's emblem", "restorative locket",
    "weakening headshot", "superior cooldown", "superior duration",
    "duration extender", "boundless spirit", "spiritual overflow",
    "cursed relic", "fury trance", "monster rounds", "improved spirit",
    "metal skin", "close quarters", "rapid recharge", "glass cannon",
    "divine barrier", "diviner's kevlar", "swift striker", "vampiric burst",
    "bullet lifesteal", "spirit lifesteal", "spirit resilience",
    "spirit shielding", "spirit shredder", "spirit snatch", "spirit strike",
    "spirit burn", "spirit rend", "spirit sap", "torment pulse",
    "reactive barrier", "tesla bullets", "kinetic dash", "bullet resilience",
    "rapid rounds", "burst fire", "extra spirit", "sharpshooter",
    // 英雄名(多词优先)
    "lady geist", "mo krill",
    // 单词英雄 + 单词物品
    "abrams", "bebop", "calico", "dynamo", "geist", "haze",
    "inferno", "paradox", "pocket", "shiv", "viscous", "warden",
    "wraith", "yamato", "seven", "ricochet",
  ];
  const PROTECT_RE = new RegExp(
    "\\b(?:" + PROTECT_NAMES.map(n => n.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')).join("|") + ")\\b",
    "gi"
  );  let PROTECT_TO_ZH = {
    "abrams": "亚伯兰", "bebop": "比波普", "calico": "卡厉可",
    "dynamo": "奇能", "geist": "盖斯特夫人", "haze": "岚梦",
    "inferno": "炽焱", "lady geist": "盖斯特夫人", "mo krill": "莫克双雄",
    "paradox": "悖论", "pocket": "口袋", "seven": "柒",
    "shiv": "希弗", "viscous": "魔液", "warden": "沃督",
    "wraith": "灵魅", "yamato": "大和",
    "divine barrier": "神圣屏障", "diviner's kevlar": "金刚宝衫",
    "bullet resilience": "子弹坚甲", "bullet lifesteal": "子弹回复",
    "bullet resist shredder": "粉碎护甲", "kinetic dash": "动能冲刺",
    "tesla bullets": "特斯拉弹", "ricochet": "跳弹射击",
    "torment pulse": "痛苦脉冲", "reactive barrier": "应急屏障",
    "swift striker": "迅捷突击", "vampiric burst": "疗愈爆发",
    "spirit burn": "元灵燃烧", "spirit lifesteal": "元灵吸收",
    "spirit resilience": "元灵护体", "spirit rend": "元灵撕裂",
    "spirit sap": "元灵衰竭", "spirit shielding": "元灵防护",
    "spirit shredder bullets": "碎灵子弹", "spirit snatch": "元灵收割",
    "spirit strike": "大伤元气", "spiritual overflow": "元灵漫溢",
    "cursed relic": "天谴圣物", "fury trance": "怒意之潮",
    "monster rounds": "猎怪弹", "improved spirit": "灵力高涨",
    "metal skin": "铜皮铁骨", "close quarters": "近身决斗",
    "rapid recharge": "火速充能", "glass cannon": "脆皮输出",
    "sharpshooter": "弹无虚发", "armor piercing rounds": "穿甲弹",
    "ballistic enchantment": "弹道附魔", "escalating resilience": "层层防御",
    "intensifying magazine": "火力渐升", "mystic vulnerability": "秘术脆弱",
    "radiant regeneration": "容光焕发", "high-velocity rounds": "高速弹",
    "mystic regeneration": "秘术愈疗", "cooldown reduction": "冷却缩减",
    "crippling headshot": "头弹破防", "enchanter's emblem": "附魔师纹章",
    "hexsealed knuckles": "咒印铁拳", "quicksilver reload": "魔力装填",
    "restorative locket": "疗愈护符", "weakening headshot": "头弹弱防",
    "superior cooldown": "超速冷却", "superior duration": "余威久久",
    "extra spirit": "灵力扩增", "duration extender": "余威回荡",
    "rapid rounds": "快手连发", "burst fire": "健步疾射",
    "boundless spirit": "灵力无边", "spirit shredder": "碎灵子弹",
  };
  // 兜底副本:获取桥名单失败时用它们回退(见 rebuildGameNames)
  const PROTECT_TO_ZH_FALLBACK = PROTECT_TO_ZH;
  const PROTECT_NAMES_FALLBACK = PROTECT_NAMES;

  // 由英文名数组(原始大小写)重建占位正则:按长度降序,避免子串误匹配
  function buildProtectRe(names) {
    const sorted = names.slice().sort((a, b) => b.length - a.length);
    const escaped = sorted.map(n => String(n).replace(/[.*+?^${}()|[\]\]/g, '\$&'));
    return new RegExp("\\b(?:" + escaped.join("|") + ")\\b", "gi");
  }
  let PROTECT_RE = buildProtectRe(PROTECT_NAMES);

  /** 用桥侧 gamenames.json({ 英文原名->中文译名 })重建保护名单与映射;
   *  case-insensitive 匹配(桥 key 原始大小写,兜底名单全小写)。*/
  function rebuildGameNames(map) {
    if (!map || typeof map !== "object") return false;
    const names = [];
    const toZh = {};
    for (const en of Object.keys(map)) {
      const zh = map[en];
      if (!en || !zh) continue;
      const key = String(en).toLowerCase();
      names.push(en);
      toZh[key] = zh;
    }
    if (names.length === 0) return false;
    PROTECT_NAMES = names;
    PROTECT_TO_ZH = toZh;
    PROTECT_RE = buildProtectRe(PROTECT_NAMES);
    log("game names synced from bridge: " + names.length + " entries");
    return true;
  }

  /** 占位替换:lookup = {匹配文本 -> 目标译名};返回 { text, nameMap } */
  function replaceGameNames(text, lookup) {
    if (!text || typeof text !== "string") return { text: text, nameMap: null };
    try {
      const nameMap = [];
      const replaced = text.replace(PROTECT_RE, function (match) {
        const idx = nameMap.length;
        nameMap.push(lookup ? (lookup[match.toLowerCase()] || match) : match);
        return "LCTPH" + idx;
      });
      return nameMap.length > 0 ? { text: replaced, nameMap: nameMap } : { text: text, nameMap: null };
    } catch (e) {
      log("replaceGameNames error: " + (e && e.message ? e.message : String(e)));
      return { text: text, nameMap: null };
    }
  }
  /** 还原占位符([[G_i]] 格式,兼容 API 可能插入的空格/大小写变化) */
  function restoreGameNames(text, nameMap) {
    if (!text || !nameMap) return text;
    for (let i = 0; i < nameMap.length; i++) {
      // 精确匹配优先
      text = text.replace("LCTPH" + i, nameMap[i]);
      // 兜底:API可能加空格(如 "[[ G0 ]]")
      const fallback = new RegExp("\\[\\[\\s*G" + i + "\\s*\\]\\]", "gi");
      text = text.replace(fallback, nameMap[i]);
    }
    return text;
  }

  // ---- 语言启发式 ----
  const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;

  // ---- 状态 ----
  const State = {
    chat: null,
    messages: null,
    input: null,
    targetLabel: null,
    scannedCount: 0,
    hudMessages: [], // HUD 顶栏聊天 Messages 容器列表(Team1Chat/Team2Chat)
    hudScanned: [], // 每个 HUD 容器已扫描的行数
    hudOverlayCount: 0, // 活跃 HUD 译文浮层数量(防内存泄漏跟踪)
    hudOverlays: [], // HUD 译文浮层面板列表(按创建顺序,用于清理最旧)
    lobbyMessages: null, // 大厅聊天容器(ChatLinesPanel,hudchat)
    lobbyScanned: 0, // 大厅容器已扫描行数
    hudLogged: false,
    bootLogged: false,
    cfgSynced: false, // 启动时是否已从桥同步过配置(healthCheck 补触发用)
    cfgSyncing: false, // 配置同步是否进行中(防 healthCheck 重复触发叠加)
    gamenamesLoaded: false, // 启动后是否已从桥拉取过游戏名保护名单(healthCheck 补触发用)
    gamenamesLoading: false, // 名单拉取是否进行中(防 healthCheck 重复触发叠加)
    seen: new Set(), // 消息签名去重
    cache: new Map(), // 签名 -> { translation }
    queue: [], // 待翻译任务
    activeRequests: 0,
    requestSeq: 0,
    outgoingPending: null, // 发送翻译中的文本(去重:同文本重复按 Enter 忽略)
    panel: null, // 隐藏 HTML 桥面板(在 chat.xml 中用 <HTML> 标签声明)
    panelLogged: false,
    panelDead: false, // BUGFIX 0.1.3:面板导航失败标记,下次强制重新查找
    eventsRegistered: false,
    pending: null, // 统一在途桥请求 { id, onResult, deadline, sawAlive }
    bridgeUp: false,
    panelWarned: false,
    cfg: null, // 游戏侧 UI 配置
    bridgeUp: false, // 桥在线标记(health 探测维护)
    bridgeOfflineSince: 0,
    canHttp: null, // 直连通道(AsyncWebRequest)可用性,启动后探测一次;null=未探测
    logBuffer: [], // 聊天日志缓冲(批量推送到桥)
    logFlushing: false,
    matchId: null, // 当前比赛 ID(缓存)
    nickInfoCache: null, // 昵称 -> { hero, heroId, steamid }(Players API 匹配缓存)
    recentLogs: new Map(), // 最近完整日志文本(去重 HUD 重复/未填充条目)
    recentQuickTexts: new Map(), // 快捷短语/Ping 文本 -> 过期时间,用于跳过 HUD 顶栏的重复气泡
    pendingLogs: {}, // 挂起的未填充完整日志:文本\x00isOwn -> { entry, t }
    updateNotified: false, // 版本更新提示是否已显示(只显示一次)
  };

  // ================= 工具函数 =================

  function nowMs() {
    return Date.now ? Date.now() : 0;
  }

  function isValid(panel) {
    return !!(panel && (!panel.IsValid || panel.IsValid()));
  }

  function safeText(panel) {
    try {
      return String((panel && panel.text) || "").replace(/\s+/g, " ").trim();
    } catch (e) {
      return "";
    }
  }

  function childCount(panel) {
    if (!isValid(panel) || typeof panel.GetChildCount !== "function") return 0;
    try {
      return panel.GetChildCount() || 0;
    } catch (e) {
      return 0;
    }
  }

  function childAt(panel, index) {
    if (!isValid(panel) || typeof panel.GetChild !== "function") return null;
    try {
      return panel.GetChild(index);
    } catch (e) {
      return null;
    }
  }

  function hasClass(panel, className) {
    if (!isValid(panel) || typeof panel.BHasClass !== "function") return false;
    try {
      return panel.BHasClass(className);
    } catch (e) {
      return false;
    }
  }

  function findChild(root, id) {
    if (!isValid(root) || typeof root.FindChildTraverse !== "function") return null;
    try {
      const found = root.FindChildTraverse(id);
      return isValid(found) ? found : null;
    } catch (e) {
      return null;
    }
  }

  function findClass(root, className) {
    if (!isValid(root)) return null;
    if (typeof root.FindChildrenWithClassTraverse === "function") {
      try {
        const matches = root.FindChildrenWithClassTraverse(className);
        if (matches && matches.length) {
          for (let i = 0; i < matches.length; i += 1) {
            if (isValid(matches[i])) return matches[i];
          }
        }
      } catch (e) {}
    }
    if (hasClass(root, className)) return root;
    const count = childCount(root);
    for (let i = 0; i < count; i += 1) {
      const found = findClass(childAt(root, i), className);
      if (found) return found;
    }
    return null;
  }

  function getRoot() {
    let root = $.GetContextPanel();
    while (root && root.GetParent && root.GetParent()) root = root.GetParent();
    return root;
  }

  // 收集面板下所有 Label 文本(处理 Text/Ping 等不同 contents 结构)
  function collectTextInto(panel, out) {
    if (!isValid(panel)) return;
    const text = safeText(panel);
    if (text) out.push(text);
    const count = childCount(panel);
    for (let i = 0; i < count; i += 1) {
      collectTextInto(childAt(panel, i), out);
    }
  }

  function collectText(panel) {
    const out = [];
    collectTextInto(panel, out);
    return out.join(" ").replace(/\s+/g, " ").trim();
  }

  // 尽力从聊天行读取英雄名(行内 SenderHeroImage/HeroImage 面板;大厅行用 HeroIcon,失败返回空串)
  // 比旧版多扫一层子面板与常见属性名(游戏行内数据可能挂在任意子节点)
  function readHeroFromRow(row) {
    try {
      const panels = [row];
      const count = childCount(row);
      for (let i = 0; i < count && i < 12; i += 1) panels.push(childAt(row, i));
      for (const p of panels) {
        if (!isValid(p)) continue;
        for (const attr of ["hero", "hero_name", "heroName", "heroname", "character", "character_name"]) {
          try {
            const v = p.GetAttributeString ? p.GetAttributeString(attr, "") : "";
            if (v) return String(v);
          } catch (e) {}
        }
        if (hasClass(p, "HeroIcon") || hasClass(p, "SenderHeroImage")) {
          for (const attr of ["hero", "hero_name", "heroName", "heroname", "heroid"]) {
            try {
              const v = p.GetAttributeString ? p.GetAttributeString(attr, "") : "";
              if (v) return String(v);
            } catch (e) {}
          }
          try { if (p.hero) return String(p.hero); } catch (e) {}
        }
        if (p.FindChildInLayoutFile) {
          try {
            const img = p.FindChildInLayoutFile("#HeroImage") || p.FindChildInLayoutFile("#SenderHeroImage");
            if (img) {
              for (const attr of ["hero", "hero_name", "heroName", "heroname"]) {
                try {
                  const v = img.GetAttributeString ? img.GetAttributeString(attr, "") : "";
                  if (v) return String(v);
                } catch (e) {}
              }
              try { if (img.hero) return String(img.hero); } catch (e) {}
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return "";
  }

  // 尽力从聊天行读取英雄数字 ID(行面板属性,失败返回空串)
  function readHeroIdFromRow(row) {
    try {
      const panels = [row];
      const count = childCount(row);
      for (let i = 0; i < count && i < 12; i += 1) panels.push(childAt(row, i));
      for (const p of panels) {
        if (!isValid(p)) continue;
        for (const attr of ["heroid", "hero_id", "selectedHeroId", "selected_hero_id"]) {
          try {
            if (p.GetAttributeInt) {
              const v = p.GetAttributeInt(attr, -1);
              if (v > 0) return String(v);
            }
          } catch (e) {}
          try {
            const v = p.GetAttributeString ? p.GetAttributeString(attr, "") : "";
            if (v && v !== "0") return String(v);
          } catch (e) {}
        }
      }
    } catch (e) {}
    return "";
  }

  // 尽力从聊天行读取 steamid(行面板属性,拿不到返回空串)
  function readSteamIdFromRow(row) {
    try {
      const attrs = [
        "steamid", "steam_id", "steamId", "m_iSteamID", "xuid",
        "playerid", "player_id", "data-player-id", "accountid", "account_id",
        "owner", "playerId",
      ];
      const panels = [row];
      const count = childCount(row);
      for (let i = 0; i < count && i < 8; i += 1) panels.push(childAt(row, i));
      for (const p of panels) {
        if (!isValid(p)) continue;
        for (const attr of attrs) {
          try {
            const v = p.GetAttributeString ? p.GetAttributeString(attr, "") : "";
            if (v) return String(v);
          } catch (e) {}
        }
      }
    } catch (e) {}
    return "";
  }

  // 十进制字符串相加(SteamID64 = 76561197960265728 + accountid,超出双精度安全范围)
  function padZeros(s, len) {
    let out = String(s || "");
    while (out.length < len) out = "0" + out;
    return out;
  }

  function addDecimalStrings(a, b) {
    const maxLen = Math.max(String(a).length, String(b).length);
    const ra = padZeros(a, maxLen);
    const rb = padZeros(b, maxLen);
    let carry = 0;
    let out = "";
    for (let i = maxLen - 1; i >= 0; i -= 1) {
      const d = ra.charCodeAt(i) - 48 + rb.charCodeAt(i) - 48 + carry;
      out = String(d % 10) + out;
      carry = d >= 10 ? 1 : 0;
    }
    if (carry) out = "1" + out;
    return out;
  }

  // 32 位 Steam 账号 ID -> 64 位 SteamID(常见账号:universe=1,type=1,instance=1)
  function accountIdToSteamId(accountId) {
    const digits = String(accountId || "").replace(/\D/g, "");
    if (!digits) return "";
    return addDecimalStrings("76561197960265728", digits);
  }

  // 规范化昵称(用于与 Players API 对比)
  function normName(name) {
    return String(name || "").trim().toLowerCase();
  }

  // 把 Players.GetPlayerInfo 单条结果并入 info({ hero, heroId, steamid };多字段兼容)
  function applyPlayerInfo(info, pi) {
    try {
      if (!info.hero) {
        const h =
          (pi && (pi.hero || pi.hero_name || pi.heroName || pi.selected_hero || pi.character || pi.character_name)) ||
          "";
        if (h) info.hero = String(h);
      }
      if (!info.heroId) {
        let hid = -1;
        if (pi && pi.hero_id !== undefined && pi.hero_id !== null) hid = pi.hero_id;
        else if (pi && pi.heroid !== undefined && pi.heroid !== null) hid = pi.heroid;
        else if (pi && pi.selectedHeroId !== undefined && pi.selectedHeroId !== null) hid = pi.selectedHeroId;
        if (hid !== -1) info.heroId = String(hid);
      }
      if (!info.steamid) {
        const s =
          (pi && (pi.steam_id || pi.steamid || pi.steamId || pi.m_iSteamID || pi.xuid || pi.playerId)) ||
          "";
        if (s) {
          info.steamid = String(s);
        } else {
          const acc = (pi && (pi.account_id || pi.accountid)) || "";
          if (acc) info.steamid = accountIdToSteamId(acc);
        }
      }
    } catch (e) {}
  }

  // 用昵称匹配 Players API 拿玩家信息(英雄/英雄ID/SteamID;尽力,结果按昵称缓存)
  function playerInfoForNick(nick) {
    const key = normName(nick);
    if (!key || key === UNKNOWN_NAME) return null;
    State.nickInfoCache = State.nickInfoCache || {};
    if (State.nickInfoCache[key]) return State.nickInfoCache[key];
    try {
      if (typeof Players === "undefined" || !Players.GetPlayerInfo) return null;
      const info = { hero: "", heroId: "", steamid: "" };
      // 本地玩家优先(自己发言的昵称/英雄/SteamID 一定拿得到)
      try {
        const li = Players.GetLocalPlayer ? Players.GetLocalPlayer() : -1;
        if (li >= 0) {
          const lp = Players.GetPlayerInfo(li);
          if (lp && normName(lp.name) === key) applyPlayerInfo(info, lp);
        }
      } catch (e) {}
      // 扫描全场玩家(昵称大小写不敏感)
      for (let i = 0; i < PLAYER_INFO_SCAN_LIMIT && !(info.hero && info.steamid); i += 1) {
        let pi = null;
        try { pi = Players.GetPlayerInfo(i); } catch (e) { break; }
        if (!pi) continue;
        if (normName(pi.name) === key) applyPlayerInfo(info, pi);
      }
      // 独立 API 兜底(部分版本只有 GetPlayerName/GetPlayerSteamID)
      if (!info.steamid) {
        try {
          if (typeof Players.GetPlayerSteamID === "function") {
            for (let i = 0; i < PLAYER_INFO_SCAN_LIMIT; i += 1) {
              let pn = "";
              try { pn = Players.GetPlayerName ? Players.GetPlayerName(i) : ""; } catch (e) {}
              if (normName(pn) === key) {
                info.steamid = String(Players.GetPlayerSteamID(i) || "");
                break;
              }
            }
          }
        } catch (e) {}
      }
      if (info.hero || info.heroId || info.steamid) {
        State.nickInfoCache[key] = info;
        return info;
      }
    } catch (e) {}
    return null;
  }

  // 本地玩家昵称(自己的 HUD 消息补 sender 用;失败返回空串)
  function localPlayerName() {
    try {
      if (typeof Players !== "undefined" && Players.GetLocalPlayer && Players.GetPlayerInfo) {
        const li = Players.GetLocalPlayer();
        if (li >= 0) {
          const lp = Players.GetPlayerInfo(li);
          if (lp && lp.name) return String(lp.name);
        }
      }
    } catch (e) {}
    return "";
  }

  // 用昵称匹配 Players API 补 steamid(尽力;Deadlock 玩家面板通常带 steam_id)
  function resolveSteamId(record) {
    if (record.steamid) return String(record.steamid);
    const nick = String(record.sender || "").trim();
    if (!nick || nick === UNKNOWN_NAME) return "";
    const info = playerInfoForNick(nick);
    return (info && info.steamid) ? info.steamid : "";
  }

  // 用昵称匹配 Players API 补英雄名(行内读不到时兜底;失败返回空串)
  function resolveHero(record) {
    const hero = String(record.hero || "").trim();
    if (hero) return hero;
    const nick = String(record.sender || "").trim();
    if (!nick || nick === UNKNOWN_NAME) return "";
    const info = playerInfoForNick(nick);
    return (info && info.hero) ? info.hero : "";
  }

  // 用昵称匹配 Players API 补英雄数字 ID(失败返回空串)
  function resolveHeroId(record) {
    const hid = String(record.heroId || "").trim();
    if (hid) return hid;
    const nick = String(record.sender || "").trim();
    if (!nick || nick === UNKNOWN_NAME) return "";
    const info = playerInfoForNick(nick);
    return (info && info.heroId) ? info.heroId : "";
  }

  // 尽力获取当前比赛 ID(Deadlock Panorama 无统一文档,多候选探测;失败用时间戳)
  // 多候选探测当前比赛 ID(每次调用都执行;Deadlock Panorama API 版本差异大,
  // 常见命名/返回格式都试一遍。拿不到返回空串,由 getMatchId 兜底 session_)
  function probeMatchId() {
    let id = "";
    const clean = function (v) {
      const s = String(v || "").trim();
      return (s && !/^0+$/.test(s)) ? s : "";
    };
    try {
      if (typeof GameStateAPI !== "undefined") {
        // 常见无参 API 名(大小写变体;返回 string 或 { match_id|matchId|id })
        const fns = ["GetMatchID", "GetMatchId", "GetLiveMatchID", "GetLiveMatchId", "GetMatchInfo"];
        for (const fn of fns) {
          try {
            if (typeof GameStateAPI[fn] === "function") {
              const v = GameStateAPI[fn]();
              if (v && typeof v === "object") id = clean(v.match_id || v.matchId || v.matchid || v.id);
              else id = clean(v);
              if (id) return id;
            }
          } catch (e) {}
        }
        // GetGameInfo / GetServerInfo:遍历键,取含 match/game_id/server 的字符串字段
        for (const fn of ["GetGameInfo", "GetServerInfo"]) {
          try {
            if (typeof GameStateAPI[fn] === "function") {
              const info = GameStateAPI[fn]();
              if (info && typeof info === "object") {
                id = clean(info.match_id || info.matchId || info.matchid);
                if (id) return id;
                try {
                  for (const k of Object.keys(info)) {
                    const v = info[k];
                    if (v && typeof v !== "object" && /match|game_id|server/i.test(k)) {
                      id = clean(v);
                      if (id) return id;
                    }
                  }
                } catch (e) {}
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    // Game / GameUI 命名空间(Deadlock 特有;与 Dota 的 GameStateAPI 并存)
    for (const ns of [typeof Game !== "undefined" ? Game : null, typeof GameUI !== "undefined" ? GameUI : null]) {
      if (!ns) continue;
      for (const fn of ["GetMatchID", "GetMatchId"]) {
        try {
          if (typeof ns[fn] === "function") {
            const v = ns[fn]();
            if (v && typeof v === "object") id = clean(v.match_id || v.matchId || v.matchid || v.id);
            else id = clean(v);
            if (id) return id;
          }
        } catch (e) {}
      }
    }
    // GameInterfaceAPI 设置键(多候选)
    try {
      if (typeof GameInterfaceAPI !== "undefined" && GameInterfaceAPI.GetSettingString) {
        const keys = ["matchid", "match_id", "MatchID", "matchId", "citadel_match_id", "CitadelMatchID", "live_match_id"];
        for (const key of keys) {
          try {
            const v = GameInterfaceAPI.GetSettingString(key, "");
            if (v) {
              id = clean(v);
              if (id) return id;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return "";
  }

  // 一次性诊断:探测失败时把可用 API 方法名列到控制台,便于在未知游戏版本上定位正确的比赛 ID API
  let matchIdDiagLogged = false;
  function logMatchIdDiagnostics() {
    if (matchIdDiagLogged) return;
    matchIdDiagLogged = true;
    try {
      const names = [];
      const scan = function (ns, prefix) {
        if (!ns) return;
        try {
          for (const k of Object.keys(ns)) {
            if (typeof ns[k] === "function" && /match|game|server|map/i.test(k)) names.push(prefix + k);
          }
        } catch (e) {}
      };
      scan(typeof GameStateAPI !== "undefined" ? GameStateAPI : null, "GameStateAPI.");
      scan(typeof GameInterfaceAPI !== "undefined" ? GameInterfaceAPI : null, "GameInterfaceAPI.");
      scan(typeof Game !== "undefined" ? Game : null, "Game.");
      scan(typeof GameUI !== "undefined" ? GameUI : null, "GameUI.");
      log("matchId diagnostic: " + (names.length ? names.join(" | ") : "(no match-related API found)"));
    } catch (e) {}
  }

  function getMatchId() {
    // 已缓存真实比赛 ID:直接返回(不进比赛时一直是 session_ 兜底)
    if (State.matchId && State.matchId.indexOf("session_") !== 0) return State.matchId;
    // 每次重新探测:大厅/组队阶段通常拿不到,进入比赛后一旦拿到真实 ID 就切换文件名
    const id = probeMatchId();
    if (id) {
      State.matchId = id;
      return id;
    }
    if (!State.matchId) {
      State.matchId = "session_" + String(Math.floor(nowMs() / 1000));
      logMatchIdDiagnostics();
    }
    return State.matchId;
  }

  function log(msg) {
    try {
      $.Msg(LOG_PREFIX + " " + msg);
    } catch (e) {}
  }

  // djb2 哈希:用于生成稳定的译文 Label id(滚动回收后重建用)
  function hashString(str) {
    let h = 5381;
    const s = String(str || "");
    for (let i = 0; i < s.length; i += 1) {
      h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
  }

  // ================= 配置(游戏侧 UI 偏好) =================

  const UI_DEFAULTS = {
    enabled: true,
    provider: "bing", // 默认公共免费服务商;microsoft 需填 Azure Key
    displayMode: "bilingual", // bilingual | translation_only
    outgoing: "off", // off | translation | bilingual
    outgoingTarget: "en",
    targetLanguage: "zh-Hans",
    force: false,
    timeoutMs: 15000,
    chatLog: true, // 聊天日志开关(按比赛 ID 存本地)
    translateOwn: true, // 自己的发言也翻译(默认开)
    uiLang: "zh", // 界面语言:zh=中文, en=English
  };

  // ---- 多语言支持 ----
  const STRINGS = {
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
    btnSave: { zh: "保存", en: "Save" },
    btnTest: { zh: "测试", en: "Test" },
    btnHint: { zh: "选项点击选择 · 改完点保存 · ESC 关闭", en: "Click to select \u00b7 Save when done \u00b7 ESC to close" },
    bridgeUp: { zh: "运行中", en: "Running" },
    bridgeDown: { zh: "未运行", en: "Not running" },
    bridgePort: { zh: "端口", en: "port" },
    bridgeStatusPrefix: { zh: "桥状态: ", en: "Bridge: " },
    bridgeOnline: { zh: "桥在线", en: "Bridge online" },
    bridgeOffline: { zh: "桥离线,翻译不可用", en: "Bridge offline, translation unavailable" },
    bridgeDmmHint: { zh: "若通过 DMM(Deadlock Mod Manager)安装,仅有翻译面板,需另装本地桥:下载 GitHub 完整包运行 StartDeadlock.bat", en: "Installed via DMM? You need the full bridge: download from GitHub and run StartDeadlock.bat" },
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

  function t(key) {
    const lang = (State.cfg && State.cfg.uiLang) || "zh";
    const entry = STRINGS[key];
    if (!entry) return key;
    return entry[lang] || entry.zh || key;
  }

  // 选项表(驱动选择控件)
  const PROVIDER_OPTIONS = [
    { value: "bing", key: "optBing" },
    { value: "microsoft", key: "optMicrosoft" },
    { value: "openai", key: "optOpenai" },
    { value: "deepl", key: "optDeepl" },
    { value: "google", key: "optGoogle" },
  ];
  const LANGUAGE_OPTIONS = [
    { value: "zh-Hans", key: "optLangZhHans" },
    { value: "zh-Hant", key: "optLangZhHant" },
    { value: "en", key: "optLangEn" },
    { value: "ja", key: "optLangJa" },
    { value: "ko", key: "optLangKo" },
    { value: "fr", key: "optLangFr" },
    { value: "de", key: "optLangDe" },
    { value: "es", key: "optLangEs" },
    { value: "custom", key: "optLangCustom" },
  ];
  const DISPLAY_MODES = [
    { value: "bilingual", key: "optBilingual" },
    { value: "translation_only", key: "optTranslationOnly" },
  ];
  const OUTGOING_MODES = [
    { value: "off", key: "optOutOff" },
    { value: "translation", key: "optOutTranslation" },
    { value: "bilingual", key: "optOutBilingual" },
  ];
  const UI_LANG_OPTIONS = [
    { value: "zh", key: "optUILangZh" },
    { value: "en", key: "optUILangEn" },
  ];

  const UI_CONVAR = "lct_ui";

  function loadUiConfig() {
    const cfg = Object.assign({}, UI_DEFAULTS);
    let raw = "";
    try {
      if (typeof Convars !== "undefined" && Convars.GetStr) raw = Convars.GetStr(UI_CONVAR, "");
    } catch (e) {}
    if (!raw) {
      try {
        raw = $.GetContextPanel().GetAttributeString(UI_CONVAR, "");
      } catch (e) {}
    }
    if (raw) {
      try {
        Object.assign(cfg, JSON.parse(raw));
      } catch (e) {}
    }
    return cfg;
  }

  function saveUiConfig() {
    try {
      const json = JSON.stringify(State.cfg);
      $.GetContextPanel().SetAttributeString(UI_CONVAR, json);
    } catch (e) {}
    try {
      if (typeof Convars !== "undefined") {
        if (Convars.RegisterConVar) Convars.RegisterConVar(UI_CONVAR, "{}", 0, "LinguaChat UI settings");
        if (Convars.SetValue) Convars.SetValue(UI_CONVAR, json);
      }
    } catch (e) {}
  }

  // ================= 消息读取与过滤 =================

  function readMessageRow(row) {
    // 大厅聊天行(hudchat:ChatLineContainer 直挂 ChatLinesPanel,无 MessageSource/MessageContents)
    if (hasClass(row, LOBBY_ROW_CLASS)) {
      const lineLabel = findClass(row, LOBBY_LINE_CLASS);
      const text = safeText(lineLabel) || collectText(row);
      if (!text) return null;
      const sender = safeText(findClass(row, LOBBY_PERSONA_CLASS)) || UNKNOWN_NAME;
      const prefix = safeText(findClass(row, LOBBY_PREFIX_CLASS));
      const isOwn = hasClass(row, "IsSelf") || !!findClass(row, LOCAL_CLIENT_ID);
      return {
        sender: sender,
        channel: prefix || "lobby",
        text: text,
        isOwn: isOwn,
        hero: readHeroFromRow(row),
        heroId: readHeroIdFromRow(row),
        steamid: readSteamIdFromRow(row),
        lobby: true,
        quick: !!findChild(row, "PingLabel"), // 大厅行的 Ping/快捷短语本地化,跳过翻译
      };
    }
    // HUD 顶栏行:无 MessageSource,文本在 MessageText(气泡内),sender 未知
    const isHudRow = hasClass(row, "ChatMessage") && !!findClass(row, HUD_BUBBLE_CLASS);
    if (isHudRow) {
      const textLabel = findChild(row, HUD_TEXT_ID);
      const text = safeText(textLabel) || collectText(row);
      if (!text) return null;
      const isOwn = hasClass(row, "IsSelf") || !!findClass(row, LOCAL_CLIENT_ID);
      return { sender: UNKNOWN_NAME, channel: "hud", text: text, isOwn: isOwn, hud: true,
        quick: hasClass(row, "Ping") || !!findChild(row, "PingLabel") };
    }
    const source = findChild(row, MESSAGE_SOURCE_ID);
    const contents = findChild(row, MESSAGE_CONTENTS_ID);
    const sender =
      safeText(findClass(source, SENDER_NAME_CLASS)) ||
      safeText(findClass(row, SENDER_NAME_CLASS)) ||
      UNKNOWN_NAME;
    const channel =
      safeText(findClass(source, CHANNEL_NAME_CLASS)) ||
      safeText(findClass(row, CHANNEL_NAME_CLASS));
    const text = collectText(contents);
    if (!text) return null;
    const isOwn = hasClass(row, "IsSelf") || !!findClass(row, LOCAL_CLIENT_ID);
    const quick = hasClass(contents, "Ping") || !!findChild(contents, "PingLabel");
    return {
      sender: sender,
      channel: channel,
      text: text,
      isOwn: isOwn,
      quick: quick,
      hero: readHeroFromRow(row),
      heroId: readHeroIdFromRow(row),
      steamid: readSteamIdFromRow(row),
    };
  }

  function makeSignature(record) {
    return [record.channel || "", record.sender || "", record.text || ""].join("\x00");
  }

  function isTargetLanguageText(text) {
    const t = String(State.cfg.targetLanguage || "zh-Hans").toLowerCase();
    if (t.indexOf("zh") === 0) {
      // 只有纯中文才跳过。中英混合消息仍需翻译,否则英文部分会原样留下。
      return CJK_RE.test(text) && !/[A-Za-z]/.test(String(text || ""));
    }
    return false;
  }

  // 主语言子标签是否相同(如 zh-Hans 与 zh-CN 视为同语言)
  function sameLanguage(a, b) {
    const pa = String(a || "").toLowerCase().split("-")[0];
    const pb = String(b || "").toLowerCase().split("-")[0];
    return !!pa && pa === pb;
  }

  function shouldSkip(record) {
    const text = record.text;
    if (!text || text.length < 2) return true;
    if (record.quick) return true; // 游戏原生快捷短语/Ping 已由游戏本地化,不调用翻译接口
    if (record.hud && isRecentQuickText(text)) return true; // 跳过同一快捷短语在 HUD 顶栏的重复气泡
    if (text.charAt(0) === "/") return true; // 指令消息
    if (/^[\d\s\W_]+$/.test(text)) return true; // 纯数字/符号
    if (record.isOwn && State.cfg.translateOwn === false) return true; // 可配置:默认翻译自己的消息
    if (!State.cfg.force && isTargetLanguageText(text)) return true; // 已为目标语言
    return false;
  }

  // 原生快捷短语/Ping 文本去重:游戏已本地化,且在 HUD 顶栏会以气泡形式短暂重复出现,
  // 记录近期文本避免重复调用翻译接口(5 秒窗口)。
  function rememberQuickText(text) {
    const now = nowMs();
    State.recentQuickTexts.set(String(text || ""), now + 5000);
    for (const [value, expiresAt] of State.recentQuickTexts) {
      if (expiresAt <= now) State.recentQuickTexts.delete(value);
    }
  }

  function isRecentQuickText(text) {
    const value = String(text || "");
    const expiresAt = State.recentQuickTexts.get(value) || 0;
    if (expiresAt > nowMs()) return true;
    if (expiresAt) State.recentQuickTexts.delete(value);
    return false;
  }

  // ================= 译文注入 =================

  function isHudRow(row) {
    return hasClass(row, "ChatMessage") && !!findClass(row, HUD_BUBBLE_CLASS);
  }

  function isLobbyRow(row) {
    return hasClass(row, LOBBY_ROW_CLASS);
  }

  // 大厅行(flow-children:right 气泡)无法直接追加"下方"译文:
  // 首次遇到时把行内容包进 LCTLobbyWrap(横向),行自身改纵向流,译文挂在 wrap 下方。
  // 若运行时无 SetParent(极少见),放弃重构,译文内联显示(仍可见)。
  function ensureLobbyLayout(row) {
    if (row.__lctLobbyWrapped) {
      // 行可能被游戏回收复用:wrap 若已被清掉,需要重建
      if (findClass(row, "LCTLobbyWrap")) return true;
      row.__lctLobbyWrapped = false;
    }
    if (findClass(row, "LCTLobbyWrap")) {
      row.__lctLobbyWrapped = true;
      return true;
    }
    try {
      const wrap = $.CreatePanel("Panel", row, "LCTLobbyWrap" + nowMs());
      wrap.AddClass("LCTLobbyWrap");
      let guard = 0;
      while (childCount(row) > 1 && guard < 24) {
        const child = childAt(row, 0);
        if (!isValid(child) || child === wrap) break;
        if (typeof child.SetParent !== "function") break;
        try {
          child.SetParent(wrap);
        } catch (e) {
          break;
        }
        guard += 1;
      }
      if (childCount(row) > 1) {
        // 移动失败:回滚,保持原行布局
        try { wrap.DeleteAsync(0); } catch (e) {}
        return false;
      }
      try {
        row.style.flowChildren = "down";
      } catch (e) {}
      row.__lctLobbyWrapped = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  // 大厅行译文挂载点:行本身(wrap 之后作为第二个子面板,纵向显示)
  function lobbyLabelHost(row) {
    ensureLobbyLayout(row);
    return row;
  }

  function transLabelId(sig) {
    return "LCTTrans" + hashString(sig);
  }

  function getTransLabel(row, sig) {
    // 深遍历找译文标签(HUD 行挂在 MessageContents 下,普通行挂在 MessageBody 下,统一从行根找)
    return findChild(row, transLabelId(sig));
  }

  // HUD 行译文挂载点:MessageContents(ChatBubble 正下方)。
  // 理由:游戏 CSS 确认 MessageContents 是 flow-children:down,译文位置确定在气泡下方;
  // 直接挂 ChatBubble 会进横向流(气泡+头像+译文并排),译文被挤到气泡右侧外部看不清。
  function hudLabelHost(row) {
    const contents = findChild(row, MESSAGE_CONTENTS_ID);
    if (contents) return contents;
    return findClass(row, HUD_BUBBLE_CLASS) || row;
  }

  // 译文样式全部由 CSS 类控制(普通行 .LCTTranslation / HUD .LCTTranslationHud / 大厅 .LCTTranslationLobby,
  // 错误态 .LCTTranslationError 叠加)。不再用内联样式覆盖——内联优先级高于类,
  // 会把 HUD(10px/220px/右对齐)和大厅(4px/380px)的差异化样式冲掉(2026-08-15 移除)。

// HUD 顶栏聊天是 Valve 内置布局(citadel_hud_top_bar_chat),不会 include lingua_chat.vcss_c,
// 注入的译文 label 即使套 .LCTTranslationHud 类也取不到深蓝底 -> 运行时退化成透明底白字。
// 兜底:对 HUD 译文直接写内联样式(深蓝底白字),不受 CSS 作用域限制。
// 普通行/大厅仍用 class,这里只对 hud 行内联,不破坏它们的差异化样式。
function applyHudInlineStyle(label) {
  try {
    // 与 .LCTTranslation(普通对话框行内译文)逐属性一致,统一 HUD 顶栏气泡外观
    label.style.backgroundColor = "rgba(20, 52, 96, 0.95)";
    label.style.color = "#ffffff";
    label.style.fontSize = "17px";
    label.style.fontStyle = "normal";
    label.style.fontWeight = "600";
    label.style.border = "1px solid rgba(120, 180, 255, 0.55)";
    label.style.borderRadius = "4px";
    label.style.padding = "3px 8px";
    label.style.marginTop = "3px";
    label.style.marginLeft = "58px";
    label.style.maxWidth = "290px";
    label.style.whiteSpace = "normal";
    label.style.width = "fit-children";
    label.style.textShadow = "0px 1px 2px rgba(0, 0, 0, 0.6)";
  } catch (e) {}
}

// 通用内联样式(= .LCTTranslation 普通聊天译文),供测试浮层等需要"和普通聊天栏完全一致"的场合使用。
// 与 applyHudInlineStyle 区别:这里不假设 HUD 小气泡容器,max-width/margin 与普通聊天一致。
function applyUniversalInlineStyle(label) {
  try {
    label.style.backgroundColor = "rgba(20, 52, 96, 0.95)";
    label.style.color = "#ffffff";
    label.style.fontSize = "17px";
    label.style.fontStyle = "normal";
    label.style.fontWeight = "600";
    label.style.border = "1px solid rgba(120, 180, 255, 0.55)";
    label.style.borderRadius = "4px";
    label.style.padding = "3px 8px";
    label.style.marginTop = "3px";
    label.style.marginLeft = "58px";
    label.style.maxWidth = "290px";
    label.style.width = "fit-children";
    label.style.textShadow = "0px 1px 2px rgba(0, 0, 0, 0.6)";
    label.style.whiteSpace = "normal";
  } catch (e) {}
}

function injectTranslation(row, sig, text) {
    if (!isValid(row)) return;
    const hud = isHudRow(row);
    const lobby = isLobbyRow(row);
    // HUD 行:译文 label 挂到 MessageContents(ChatBubble 正下方);大厅行:行内容下方;普通行:MessageBody 下
    const body = hud ? hudLabelHost(row) : (lobby ? lobbyLabelHost(row) : (findClass(row, MESSAGE_BODY_CLASS) || row));
    let label = getTransLabel(row, sig);
    if (!isValid(label)) {
      try {
        label = $.CreatePanel("Label", body, transLabelId(sig));
        label.AddClass(hud ? TRANS_LABEL_HUD_CLASS : (lobby ? TRANS_LABEL_LOBBY_CLASS : TRANS_LABEL_CLASS));
        if (hud) applyHudInlineStyle(label);
      } catch (e) {
        return;
      }
    } else {
      try {
        label.RemoveClass(TRANS_ERROR_CLASS);
      } catch (e) {}
    }
    try {
      label.text = String(text);
    } catch (e) {}
    // 只显示译文模式:隐藏原文(快捷对话/Ping 行保留气泡,避免消息"消失")
    // HUD 顶栏行/大厅行不折叠:气泡本身短暂显示,折叠会连译文一起隐藏
    if (!hud && !lobby && State.cfg.displayMode === "translation_only") {
      const contents = findChild(row, MESSAGE_CONTENTS_ID);
      if (contents) {
        let isPing = false;
        try {
          isPing = hasClass(contents, "Ping") || !!findChild(contents, "PingLabel");
        } catch (e) {}
        if (!isPing) {
          try {
            contents.style.visibility = "collapse";
          } catch (e) {}
        }
      }
    }
  }

  function injectError(row, sig, message) {
    if (!isValid(row)) return;
    const hud = isHudRow(row);
    const lobby = isLobbyRow(row);
    const body = hud ? hudLabelHost(row) : (lobby ? lobbyLabelHost(row) : (findClass(row, MESSAGE_BODY_CLASS) || row));
    let label = getTransLabel(row, sig);
    if (!isValid(label)) {
      try {
        label = $.CreatePanel("Label", body, transLabelId(sig));
        label.AddClass(hud ? TRANS_LABEL_HUD_CLASS : (lobby ? TRANS_LABEL_LOBBY_CLASS : TRANS_LABEL_CLASS));
        if (hud) applyHudInlineStyle(label);
      } catch (e) {
        return;
      }
    }
    try {
      label.AddClass(TRANS_ERROR_CLASS);
      label.text = "⚠ 翻译失败: " + String(message || "未知错误").slice(0, 120);
    } catch (e) {}
    // 翻译失败游戏内可见:桥状态圆点闪烁黄色,提醒玩家当前翻译不工作
    flashBridgeFail();
  }

  // 滚动回收重建:已翻译过的行重新出现时,从缓存恢复译文
  function restoreFromCache(row, sig) {
    const cached = State.cache.get(sig);
    if (!cached) return false;
    if (getTransLabel(row, sig)) return true;
    injectTranslation(row, sig, cached.translation);
    return true;
  }

  // ================= 翻译队列与桥接 =================

  function targetLanguage() {
    // 面板里选的目标语言优先;选了自定义则用自定义输入框的值
    let lang = State.cfg.targetLanguage || "zh-Hans";
    if (lang === "custom") {
      lang = fieldValue("LCTTargetLangCustom") || "zh-Hans";
    }
    return lang;
  }

  // 发送目标语言(处理自定义)
  function resolveOutgoingTarget() {
    let lang = State.cfg.outgoingTarget || "en";
    if (lang === "custom") {
      lang = fieldValue("LCTOutgoingTargetCustom") || "en";
    }
    return lang;
  }

  function enqueue(row, sig, record) {
    State.queue.push({ kind: "chat", row: row, sig: sig, record: record, attempts: 0, nameMap: record._nameMap || null });
    pumpQueue();
  }

  function enqueueOutgoing(text, done) {
    // 超时兜底:翻译超过 OUTGOING_TIMEOUT_MS 未返回,按原文发送,避免用户等待/重复按键。
    // 计时放在 dispatchJob(任务真正开始处理时),排队等待不计入——
    // 否则连续快速发 3 条时,第 3 条还在排队就已超时,直接发原文。
    // (done 只允许触发一次:正常返回或超时,谁先到谁生效)
    let settled = false;
    const once = function (translated, detected) {
      if (settled) return;
      settled = true;
      done(translated, detected);
    };
    // 翻译前占位替换:保护英雄/物品名不被翻译API意译
    const _ng = replaceGameNames(text, null); // outgoing:保留英文原名不翻译
    const sendText = _ng.nameMap ? _ng.text : text;
    State.queue.push({ kind: "outgoing", row: null, sig: null, record: { text: sendText }, attempts: 0, done: once, enqueuedAt: nowMs(), nameMap: _ng.nameMap || null, originalText: text });
    pumpQueue();
  }

  function enqueueBridge(op, data, done) {
    State.queue.push({ kind: "bridge", op: op, data: data, row: null, sig: null, attempts: 0, done: done });
    pumpQueue();
  }

  function pumpQueue() {
    while (State.queue.length > 0 && State.activeRequests < MAX_ACTIVE_REQUESTS) {
      const job = State.queue.shift();
      State.activeRequests += 1;
      dispatchJob(job);
    }
  }

  function buildBridgeUrl(job) {
    const id = "r" + (++State.requestSeq).toString(36);
    job.id = id;
    if (job.kind === "bridge") {
      return (
        "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT +
        "/bridge?id=" + id +
        "&op=" + job.op +
        "&d=" + job.data
      );
    }
    const text = encodeURIComponent(job.record.text);
    const source = encodeURIComponent("auto");
    const target = encodeURIComponent(job.kind === "outgoing" ? resolveOutgoingTarget() : targetLanguage());
    const tm = job.kind === "outgoing" ? OUTGOING_TIMEOUT_MS : (State.cfg.timeoutMs || 15000);
    return (
      "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT +
      "/bridge?id=" + id +
      "&op=translate&text=" + text +
      "&source=" + source +
      "&target=" + target +
      "&timeoutMs=" + tm
    );
  }

  // HTML 桥面板:必须在 chat.xml 里用 <HTML id="LCTBridgePanel"> 声明,
  // 这里只做查找;运行时 $.CreatePanel("HTML",...) 不会得到可用的 HTML 面板。
  function ensurePanel() {
    if (!State.panelDead && isValid(State.panel) && typeof State.panel.SetURL === "function") return State.panel;
    // BUGFIX 0.1.3:面板曾失效(导航失败标记),强制重新查找,避免缓存死面板
    State.panel = null;
    State.panelDead = false;
    const root = getRoot();
    if (!root) return null;
    State.panel = findChild(root, BRIDGE_PANEL_ID);
    if (isValid(State.panel)) {
      if (!State.panelLogged) {
        State.panelLogged = true;
        log("bridge panel found; SetURL=" + (typeof State.panel.SetURL === "function" ? "yes" : "NO") + ", title=" + typeof State.panel.title);
      }
      if (typeof State.panel.SetURL !== "function") return null;
      return State.panel;
    }
    if (!State.panelLogged) {
      State.panelLogged = true;
      log("bridge panel NOT found (id=" + BRIDGE_PANEL_ID + "); check chat.xml");
    }
    return null;
  }

  // 直连桥(GET /api/v1/*,经 $.AsyncWebRequest)。
  // 背景:HTML 面板方案在连续导航时会失效(第一条成功,后续 SetURL 导航可能不触发
  // title 更新,导致"几条消息后翻译失效/测试卡住/发送前翻译不可用")。
  // $.AsyncWebRequest 是引擎级 HTTP API(chat_translator 版本验证可用),每条请求独立,无导航竞争。
  function buildApiUrl(job) {
    const base = "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/api/v1/";
    if (job.kind === "bridge") {
      // data 已由 bridgePost 做过 encodeURIComponent,这里不能再次编码,
      // 否则服务端 URLSearchParams 只解码一次,JSON.parse 会失败(日志/配置保存丢失)
      return base + job.op + "?d=" + (job.data || "{}");
    }
    const text = encodeURIComponent(job.record.text);
    const target = encodeURIComponent(job.kind === "outgoing" ? resolveOutgoingTarget() : targetLanguage());
    // provider 不传:由桥按 config.json 的 provider 执行(设置面板保存或手改 config.json 均生效,
    // 避免游戏侧 State.cfg.provider 与桥不同步导致 OpenAI/DeepSeek 配置不生效)
    // 显式传 timeoutMs:出站翻译用 OUTGOING_TIMEOUT_MS(长文本/DeepSeek 需要更久),
    // 普通翻译用用户配置,避免桥端先于游戏侧放弃(否则首次长文本会"发原文,二次才发译文")
    const tm = job.kind === "outgoing" ? OUTGOING_TIMEOUT_MS : (State.cfg.timeoutMs || 12000);
    return base + "translate?text=" + text + "&source=auto&target=" + target + "&timeoutMs=" + tm;
  }

  // 引擎级 HTTP GET 封装(超时兜底,settled 防双触发)
  function httpGetJson(url, cb, timeoutMs) {
    let settled = false;
    const done = function (payload) {
      if (settled) return;
      settled = true;
      try { cb(payload || { ok: false, error: "bad_response" }); } catch (e) {}
    };
    try {
      if (typeof $.AsyncWebRequest !== "function") {
        done({ ok: false, error: "no_asyncwebrequest" });
        return;
      }
    } catch (e) {
      done({ ok: false, error: "no_asyncwebrequest" });
      return;
    }
    let timer = null;
    try {
      timer = setTimeout(function () {
        done({ ok: false, error: "http_timeout" });
      }, timeoutMs || 10000);
    } catch (e) {
      timer = null;
    }
    if (!timer) {
      // Panorama 无 setTimeout 时用 $.Schedule 兜底(秒级;settled 保证单次)
      try {
        $.Schedule(Math.max(1, Math.round((timeoutMs || 10000) / 1000)), function () {
          done({ ok: false, error: "http_timeout" });
        });
      } catch (e) {}
    }
    const parseBody = function (body) {
      if (timer) { try { clearTimeout(timer); } catch (e) {} }
      try {
        if (typeof body === "string" && body) { done(JSON.parse(body)); return; }
      } catch (e) {}
      done({ ok: false, error: "bad_response" });
    };
    // 真实引擎 API(chat_translator 同款):$.AsyncWebRequest(url, {type:"GET", timeout}) 返回 Promise<string>
    try {
      const promise = $.AsyncWebRequest(url, { type: "GET", timeout: timeoutMs || 10000 });
      if (promise && typeof promise.then === "function") {
        promise.then(
          function (body) { parseBody(body); },
          function (err) {
            if (timer) { try { clearTimeout(timer); } catch (e) {} }
            done({ ok: false, error: (err && err.message) ? String(err.message) : "request_failed" });
          }
        );
        return;
      }
    } catch (e) {}
    // 兜底:SendRequest 回调风格(仅模拟测试/旧引擎)
    try {
      let req = null;
      try { req = $.AsyncWebRequest(url); } catch (e) {}
      if (req && typeof req.SendRequest === "function") {
        req.SendRequest(function (status, body) {
          if (timer) { try { clearTimeout(timer); } catch (e) {} }
          try {
            if (typeof body === "string" && body) { done(JSON.parse(body)); return; }
          } catch (e) {}
          done({ ok: false, error: "bad_response_" + String(status) });
        });
        return;
      }
    } catch (e) {}
    if (timer) { try { clearTimeout(timer); } catch (e) {} }
    done({ ok: false, error: "http_exception" });
  }

  // 统一桥响应处理(直连通道与 HTML 面板 fallback 共用)
  function handleBridgePayload(job, payload) {
    if (job.kind === "outgoing") {
      // 已超时:done+finishJob 已由超时回调完成,这里直接退出
      if (job._timedOut) return;
      if (job._timeout) { try { clearTimeout(job._timeout); } catch (e) {} job._timeout = null; }
      if (payload && payload.ok && payload.translation) {
        // 还原占位符(英雄/物品名)
        const translation = job.nameMap ? restoreGameNames(payload.translation, job.nameMap) : payload.translation;
        job.done(translation, payload.detectedLanguage || null);
        finishJob();
      } else {
        job.attempts += 1;
        if (job.attempts < 2) {
          State.queue.unshift(job);
          $.Schedule(0.6, pumpQueue);
          finishJob();
          log("outgoing retry (1): " + String(job.record.text || "").slice(0, 40));
        } else {
          job.done(null, null);
          finishJob();
        }
      }
    } else if (job.kind === "bridge") {
      job.done(payload || { ok: false, error: "bad_bridge_payload" });
      finishJob();
    } else if (payload.ok) {
      handleResult(job, payload);
    } else {
      failJob(job, payload.error || "unknown_error");
    }
  }

  // ---- 传输通道探测 ----
  // 当前 Deadlock 版本已移除 $.AsyncWebRequest(函数仍存在,但调用即同步抛
  // "AsyncWebRequest has been removed"),只用 typeof 检查会误判可用,导致每次
  // 请求都失败、桥永远显示离线。启动后实际调用一次探测:
  //   - 同步抛异常   -> 不可用,回退 HTML 面板通道(SetURL + document.title 轮询)
  //   - 返回 Promise -> 可用,走直连 GET(引擎内置翻译器同款用法)
  function detectAsyncWebRequest() {
    if (State.canHttp !== null) return State.canHttp;
    let ok = false;
    try {
      if (typeof $.AsyncWebRequest === "function") {
        const probe = $.AsyncWebRequest(
          "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/api/v1/health",
          { type: "GET", timeout: 3000 }
        );
        ok = !!(probe && typeof probe.then === "function");
        if (ok) {
          // 吞掉探测结果(桥未启动时 Promise 会 reject,避免未处理 rejection)
          try { probe.then(function () {}, function () {}); } catch (e) {}
        }
      }
    } catch (e) {
      ok = false;
    }
    State.canHttp = ok;
    log("bridge transport: AsyncWebRequest " + (ok ? "available (direct)" : "removed/unavailable, using HTML panel channel"));
    return ok;
  }

  // 直连通道的传输层错误(引擎移除 API / 同步异常):换成 HTML 面板通道重试才有意义;
  // 桥未启动/超时等业务性失败不算,继续走直连即可。
  function isTransportError(err) {
    const s = String(err || "");
    return s === "http_exception" || s === "no_asyncwebrequest" || s.indexOf("removed") !== -1;
  }

  // HTML 面板通道:SetURL 导航 /bridge 页面,轮询 document.title 读回
  // (AsyncWebRequest 被移除的游戏版本唯一可用通道;DLCT 同款机制)
  function dispatchViaPanel(job) {
    const panel = ensurePanel();
    if (!isValid(panel) || typeof panel.SetURL !== "function") {
      if (job.kind === "outgoing") {
        job.done(null, null);
        finishJob();
      } else if (job.kind === "bridge") {
        job.done({ ok: false, error: "bridge_panel_unavailable" });
        finishJob();
      } else {
        failJob(job, "bridge_panel_unavailable");
      }
      return;
    }
    ensureBridgeEvents();
    // 出站翻译超时计时从此刻(开始处理)算起;排队等待不计入
    if (job.kind === "outgoing") {
      // Panorama 无标准 setTimeout(8/6 崩溃根因),用 $.Schedule(单位秒);done 有 once 保护,超时与结果谁先到谁生效
      job._timeout = $.Schedule(OUTGOING_TIMEOUT_MS / 1000, function () {
        // BUGFIX 0.1.3:超时必须同时释放队列槽位+清 pending,否则槽位卡到 15s 超时,
        // 期间所有翻译请求排队堵死 = 用户看到的"发中文卡死,之后全失效"。
        job._timedOut = true;
        if (State.pending && State.pending.id === job.id) {
          State.pending = null;
          State.polling = false; // pollTitle 下次调度时发现无 pending 自然停止
        }
        job.done(null, null);
        finishJob();
      });
    }
    const url = buildBridgeUrl(job);
    setPending(job.id, function (payload) {
      handleBridgePayload(job, payload);
    }, job.kind === "outgoing" ? OUTGOING_TIMEOUT_MS : (State.cfg.timeoutMs || 15000));
    try {
      panel.SetURL(url);
    } catch (e) {
      State.pending = null;
      log("SetURL failed: " + (e && e.message ? e.message : String(e)));
      if (job.kind === "outgoing") {
        job._timeout = null;
        job.done(null, null);
        finishJob();
      } else if (job.kind === "bridge") {
        job.done({ ok: false, error: "bridge_load_failed" });
        finishJob();
      } else {
        failJob(job, "bridge_load_failed");
      }
    }
  }

  function dispatchJob(job) {
    const canHttp = detectAsyncWebRequest();
    const panel = canHttp ? null : ensurePanel();
    if (!panel && !canHttp) {
      // 出站/桥任务不重试:通道不可用立即回传失败(出站则发原文),避免拖延用户发消息
      if (job.kind === "outgoing") {
        job.done(null, null);
        finishJob();
      } else if (job.kind === "bridge") {
        job.done({ ok: false, error: "bridge_panel_unavailable" });
        finishJob();
      } else {
        failJob(job, "bridge_panel_unavailable");
      }
      return;
    }
    ensureBridgeEvents();
    // 出站翻译排队超过 15s 未轮到(队列被其他请求占满)直接发原文,避免输入卡死
    if (job.kind === "outgoing" && job.enqueuedAt && nowMs() - job.enqueuedAt > 15000) {
      job.done(null, null);
      finishJob();
      log("outgoing dropped: queued too long, sending original");
      return;
    }
    // 出站翻译超时计时从此刻(开始处理)算起;排队等待不计入
    if (job.kind === "outgoing") {
      let scheduled = false;
      try {
        job._timeout = setTimeout(function () {
          if (!job._timedOut) {
            job._timedOut = true;
            job.done(null, null);
            finishJob();
          }
        }, OUTGOING_TIMEOUT_MS);
        scheduled = true;
      } catch (e) {}
      if (!scheduled) {
        // Panorama 无 setTimeout 时用 $.Schedule 兑底(秒级;_timedOut 保证单次)
        try {
          $.Schedule(Math.max(1, Math.round(OUTGOING_TIMEOUT_MS / 1000)), function () {
            if (!job._timedOut) {
              job._timedOut = true;
              job.done(null, null);
              finishJob();
            }
          });
        } catch (e) {}
      }
    }
    // 优先:AsyncWebRequest 直连本地桥(可用时最快;每条请求独立,无导航竞争)
    if (canHttp) {
      const apiUrl = buildApiUrl(job);
      const panelForFallback = panel;
      httpGetJson(apiUrl, function (payload) {
        if (job.kind === "outgoing" && job._timedOut) return;
        // 直连传输失败(引擎移除 AsyncWebRequest 等):切换到 HTML 面板通道重试
        if (payload && !payload.ok && isTransportError(payload.error) && State.canHttp) {
          State.canHttp = false;
          log("direct transport failed (" + payload.error + "); switching to HTML panel channel");
          if (isValid(panelForFallback)) {
            dispatchViaPanel(job);
            return;
          }
        }
        handleBridgePayload(job, payload);
      }, job.kind === "outgoing" ? OUTGOING_TIMEOUT_MS : (State.cfg.timeoutMs || 12000));
      return;
    }
    // fallback:HTML 面板导航(AsyncWebRequest 被移除的版本走这里)
    dispatchViaPanel(job);
  }

  // ================= 统一桥请求状态机 =================
  // 同一时刻只有一个在途请求(聊天翻译串行 + 面板操作互斥)。
  // 读回双通道:
  //   1. HTML 面板事件(HTMLChangedTitle 等,主通道,DLCT 同款机制)
  //   2. panel.title 轮询(兜底)

  const BRIDGE_EVENT_CANDIDATES = [
    "HTMLContentLoaded", "HTMLLoadPage", "HTMLStartRequest", "HTMLFinishRequest",
    "HTMLURLChanged", "HTMLChangedTitle", "HTMLTitle",
  ];

  function setPending(id, onResult, timeoutMs) {
    if (State.pending) {
      const old = State.pending;
      State.pending = null;
      try {
        old.onResult({ ok: false, error: "superseded" });
      } catch (e) {}
    }
    State.pending = {
      id: id,
      onResult: onResult,
      deadline: nowMs() + (timeoutMs || 15000),
      startedAt: nowMs(), // BUGFIX 0.1.3:记录发起时刻,用于导航失败快速判定
      sawAlive: false,
    };
    startTitlePolling();
  }

  function extractEventText(arg) {
    if (arg == null) return "";
    try {
      if (typeof arg === "string") return arg;
    } catch (e) {}
    try {
      if (typeof arg.title === "string") return arg.title;
    } catch (e) {}
    try {
      if (typeof arg.url === "string") return arg.url;
    } catch (e) {}
    try {
      if (typeof arg.src === "string") return arg.src;
    } catch (e) {}
    try {
      if (typeof arg.text === "string") return arg.text;
    } catch (e) {}
    try {
      if (typeof arg.GetAttributeString === "function") {
        return String(
          arg.GetAttributeString("title", "") ||
          arg.GetAttributeString("url", "") ||
          arg.GetAttributeString("src", "") ||
          ""
        );
      }
    } catch (e) {}
    return "";
  }

  function tryResolveFromText(text) {
    const pending = State.pending;
    if (!pending) return false;
    const marker = TITLE_PREFIX + pending.id;
    const hay = String(text || "");
    const idx = hay.indexOf(marker);
    if (idx === -1) return false;
    let payload = null;
    try {
      payload = JSON.parse(hay.slice(idx + marker.length));
    } catch (e) {}
    if (!payload) return false;
    State.pending = null;
    pending.onResult(payload);
    return true;
  }

  function onBridgeEvent(a, b, c, d) {
    if (tryResolveFromText(extractEventText(a))) return;
    if (tryResolveFromText(extractEventText(b))) return;
    if (tryResolveFromText(extractEventText(c))) return;
    if (tryResolveFromText(extractEventText(d))) return;
    // 页面加载完成标记
    const t = String(extractEventText(a) || extractEventText(b) || "");
    if (t === TITLE_ALIVE) {
      markBridgeUp();
      if (State.pending) State.pending.sawAlive = true;
    }
  }

  function ensureBridgeEvents() {
    if (State.eventsRegistered) return;
    State.eventsRegistered = true;
    for (let i = 0; i < BRIDGE_EVENT_CANDIDATES.length; i += 1) {
      try {
        $.RegisterForUnhandledEvent(BRIDGE_EVENT_CANDIDATES[i], onBridgeEvent);
      } catch (e) {}
    }
    log("bridge events registered");
  }

  function markBridgeUp() {
    if (!State.bridgeUp) {
      State.bridgeUp = true;
      log("bridge online");
    }
    updateBridgeStatusUI();
    updateBridgeDot();
  }

  // 桥状态圆点:绿=在线 / 红=离线(无失败时)
  function updateBridgeDot() {
    const root = getRoot();
    const dot = root ? findChild(root, BRIDGE_DOT_ID) : null;
    if (!dot) return;
    try {
      if (State.bridgeUp) {
        dot.RemoveClass("LCTBridgeFail");
        dot.AddClass("LCTBridgeUp");
      } else {
        dot.RemoveClass("LCTBridgeUp");
        dot.RemoveClass("LCTBridgeFail");
      }
    } catch (e) {}
  }

  // 翻译失败闪烁:黄点提示(桥在线时短暂显示后恢复绿色)
  function flashBridgeFail() {
    const root = getRoot();
    const dot = root ? findChild(root, BRIDGE_DOT_ID) : null;
    if (!dot) return;
    try {
      dot.RemoveClass("LCTBridgeUp");
      dot.AddClass("LCTBridgeFail");
    } catch (e) {}
    // 3.5s 后恢复(仅当桥仍在线时恢复绿;离线保持红/黄由 updateBridgeDot 决定)
    $.Schedule(3.5, function () {
      if (State.bridgeUp) {
        try {
          dot.RemoveClass("LCTBridgeFail");
          dot.AddClass("LCTBridgeUp");
        } catch (e) {}
      }
    });
  }

  // 出站翻译失败:输入框旁红色提示条(短暂显示,提醒"已发送原文")
  function showOutgoingFailTip() {
    const root = getRoot();
    const tip = root ? findChild(root, OUTGOING_FAIL_TIP_ID) : null;
    if (!tip) return;
    try {
      tip.text = "⚠ 翻译失败,已发送原文";
      tip.style.visibility = "visible";
    } catch (e) {}
    $.Schedule(4.0, function () {
      try {
        tip.text = "";
        tip.style.visibility = "collapse";
      } catch (e) {}
    });
    flashBridgeFail();
  }

  // 设置面板本地桥状态行:运行中/未运行 + DMM 用户引导 + 更新提示
  function updateBridgeStatusUI() {
    const root = getRoot();
    const label = root ? findChild(root, BRIDGE_STATUS_LABEL_ID) : null;
    if (!label) return;
    try {
      var statusText = State.bridgeUp ? (t("bridgeUp") + " (" + t("bridgePort") + " 8791)") : t("bridgeDown");
      // 有更新提示时追加到状态文本
      if (State.updateMsg) statusText += "\n" + State.updateMsg;
      label.text = statusText;
      if (State.bridgeUp) {
        label.RemoveClass("LCTBridgeDown");
        label.AddClass("LCTBridgeUp");
      } else {
        label.RemoveClass("LCTBridgeUp");
        label.AddClass("LCTBridgeDown");
      }
    } catch (e) {}
    const hint = root ? findChild(root, BRIDGE_HINT_LABEL_ID) : null;
    if (hint) {
      try {
        hint.text = State.bridgeUp ? "" : t("bridgeDmmHint");
      } catch (e) {}
    }
  }

  // boot 时桥缺失检测:DMM 用户装完只有面板,桥连不上 => 面板明确提示
  function checkBridgeMissing() {
    if (State.bridgeUp) return;
    if (!State.panelWarned) warnBridgeOffline();
    updateBridgeStatusUI();
    // 30s 后仍未在线,再提示一次(用户可能正在启动桥)
    $.Schedule(30.0, function () {
      if (!State.bridgeUp) updateBridgeStatusUI();
    });
  }

  function startTitlePolling() {
    if (State.polling) return;
    State.polling = true;
    $.Schedule(TITLE_POLL_SECONDS, pollTitle);
  }

  function readBridgeTitle() {
    const panel = State.panel;
    if (!isValid(panel)) return null;
    // 主通道:页面 document.title;备选:属性 / GetTitle()
    try {
      if (typeof panel.title === "string" && panel.title) return panel.title;
    } catch (e) {}
    try {
      const attr = panel.GetAttributeString ? panel.GetAttributeString("title", "") : "";
      if (attr) return attr;
    } catch (e) {}
    try {
      if (typeof panel.GetTitle === "function") {
        const t = panel.GetTitle();
        if (t) return String(t);
      }
    } catch (e) {}
    return null;
  }

  function pollTitle() {
    State.polling = false;
    const pending = State.pending;
    if (!pending) return;
    const title = readBridgeTitle();
    if (title === TITLE_ALIVE) {
      markBridgeUp();
      pending.sawAlive = true;
    } else if (title && title.indexOf(TITLE_PREFIX + pending.id) === 0) {
      // 轮询通道命中:标题 = 前缀 + id + JSON
      let payload = null;
      try {
        payload = JSON.parse(title.slice((TITLE_PREFIX + pending.id).length));
      } catch (e) {}
      State.pending = null;
      pending.onResult(payload || { ok: false, error: "bad_bridge_payload" });
      return;
    }
    // 导航失败快速判定:BUGFIX 0.1.3
    // 页面 JS 加载后立即置 document.title='lct-alive',正常 <2s 内必到。
    // 若 BRIDGE_ALIVE_SECONDS 内连 alive 都没出现 => 面板导航失败(被游戏回收/UI 重建),
    // 立即失败并标记面板死亡,下次 ensurePanel 重新查找,而不是傻等 15s 超时。
    if (!pending.sawAlive && nowMs() - pending.startedAt > BRIDGE_ALIVE_SECONDS * 1000) {
      State.pending = null;
      State.panelDead = true;
      log("bridge nav failed: panel dead (no lct-alive within " + BRIDGE_ALIVE_SECONDS + "s)");
      pending.onResult({ ok: false, error: "bridge_nav_failed" });
      return;
    }
    // 超时处理
    if (nowMs() >= pending.deadline) {
      State.pending = null;
      if (!State.bridgeUp && !pending.sawAlive) {
        warnBridgeOffline();
        pending.onResult({ ok: false, error: "bridge_offline" });
      } else {
        pending.onResult({ ok: false, error: "timeout" });
      }
      return;
    }
    $.Schedule(TITLE_POLL_SECONDS, pollTitle);
  }

  function warnBridgeOffline() {
    if (State.panelWarned) return;
    State.panelWarned = true;
    log("bridge offline: 请先启动 core/bridge_server.js(或 StartDeadlock.bat)");
    setStatus(t("bridgeOffline"));
    updateBridgeStatusUI();
    updateBridgeDot();
  }

  function handleResult(job, payload) {
    if (payload.ok && payload.translation) {
      // 还原占位符(英雄/物品名)
      const translation = job.nameMap ? restoreGameNames(payload.translation, job.nameMap) : payload.translation;
      State.cache.set(job.sig, { translation: translation });
      trimCache();
      // 行可能已被回收复用:只有行仍持有同一条消息时才注入,避免旧译文贴到新消息
      if (isValid(job.row) && job.row.__lctSig === job.sig) {
        injectTranslation(job.row, job.sig, translation);
        log("translated [" + (job.record.channel || "chat") + "] " + job.record.sender + ": " + translation.slice(0, 60));
      } else {
        // 诊断:翻译成功但行已失效(游戏可能在 2 秒内清理了顶栏消息行)
        log("translated skipped: row=" + (isValid(job.row) ? "valid" : "GONE") + " sig=" + ((job.row && job.row.__lctSig === job.sig) ? "match" : "MISMATCH") + " text=" + String(job.record.text || "").slice(0, 30));
        // HUD 测试行被游戏清理后,重建一条译文显示行(验证通路;真实消息行生命周期更长不受影响)
        tryRecreateHudTranslation(job, translation);
      }
      finishJob();
    } else {
      failJob(job, payload.error || "unknown_error");
    }
  }

  // HUD 顶栏行被游戏快速清理(外来构造行无内部状态)时,在顶栏 chat 根面板下挂独立译文浮层
  // (不挂在 #Messages 下、不带 ChatMessage 类,避开游戏消息清理器),显示 5 秒后自删。
  function tryRecreateHudTranslation(job, translation) {
    try {
      if (job.record.channel !== "hud") return;
      resolveHudMessages();
      if (State.hudMessages.length === 0) return;
      const container = State.hudMessages[0]; // #Messages
      if (!isValid(container)) return;
      // 浮层挂在 Messages 的父级(CitadelHudTopBarChat 根)下,而非 Messages 内
      const parent = container.GetParent ? container.GetParent() : null;
      // 防护:parent 面板可能也被游戏清理,创建前必须校验有效性,否则 CreatePanel 会闪退
      if (!isValid(parent)) return;
      // 防护:避免同一条译文重复创建多个浮层(相同 sig 已存在则跳过)
      const existing = findChild(parent, "LCTOverlay-" + job.sig);
      if (isValid(existing)) {
        // 已存在:仅刷新文本,不重复创建
        const lbl = findClass(existing, TRANS_LABEL_CLASS);
        try { if (isValid(lbl)) lbl.text = String(translation || ""); } catch (e) {}
        log("HUD test: overlay already exists for sig, refreshed text");
        return;
      }
      const overlayId = "LCTOverlay-" + job.sig;
      const overlay = $.CreatePanel("Panel", parent, overlayId);
      overlay.AddClass("LCTTransOverlay");
      overlay.__lctSig = job.sig;
      overlay.__lctBorn = nowMs();
      const label = $.CreatePanel("Label", overlay, "");
      // 测试浮层用与普通聊天译文完全一致的样式(便于肉眼核对样式是否生效),
      // 不再套 HUD 专属内联(避免 '蓝底但和普通聊天栏不一样' 的差异)。
      label.AddClass(TRANS_LABEL_CLASS);
      applyUniversalInlineStyle(label);
      label.text = String(translation || "");
      // 记录到活跃浮层列表(按创建顺序),用于计数与清理最旧
      State.hudOverlays.push(overlay);
      State.hudOverlayCount = State.hudOverlays.length;
      log("HUD test: recreated translation overlay (original row was cleaned up)");
      // 超过上限:先清理最旧的浮层(防内存泄漏)
      while (State.hudOverlays.length > HUD_OVERLAY_LIMIT) {
        const old = State.hudOverlays.shift();
        try { if (isValid(old)) old.DeleteAsync(100); } catch (e) {}
      }
      State.hudOverlayCount = State.hudOverlays.length;
      // 5 秒后自删(译文浮层仅用于测试验证通路,不长期占用)
      // 用 DeleteAsync(100) 而非 DeleteAsync(0):给一帧缓冲,避免某些时序下立即删除导致闪退
      $.Schedule(5.0, function () {
        try {
          if (isValid(overlay)) overlay.DeleteAsync(100);
        } catch (e) {}
        // 从活跃列表移除(若仍在)
        try {
          const idx = State.hudOverlays.indexOf(overlay);
          if (idx >= 0) State.hudOverlays.splice(idx, 1);
          State.hudOverlayCount = State.hudOverlays.length;
        } catch (e) {}
      });
    } catch (e) {
      log("HUD test: recreate failed: " + (e && e.message ? e.message : String(e)));
    }
  }

  // 失败/重试:统一由 failJob 释放活动槽(finishJob),避免队列卡死
  function failJob(job, error) {
    job.attempts += 1;
    if (job.attempts < RETRY_LIMIT) {
      State.queue.unshift(job);
      $.Schedule(RETRY_DELAY_SECONDS, pumpQueue);
      log("retry (" + job.attempts + "): " + String(error).slice(0, 80));
    } else {
      // 失败后允许同一文本在新行上重试(旧行已注入错误;seen 去重不应永久吞掉重试)
      if (job.kind === "chat" && job.sig) {
        try { State.seen.delete(job.sig); } catch (e) {}
      }
      if (isValid(job.row) && job.row.__lctSig === job.sig) {
        injectError(job.row, job.sig, String(error || "unknown_error").slice(0, 120));
      }
      log("failed: " + String(error).slice(0, 80));
    }
    finishJob();
  }

  function finishJob() {
    State.activeRequests = Math.max(0, State.activeRequests - 1);
    pumpQueue();
  }

  function trimCache() {
    while (State.cache.size > CACHE_LIMIT) {
      const firstKey = State.cache.keys().next().value;
      if (firstKey === undefined) break;
      State.cache.delete(firstKey);
    }
  }

  // ---- 聊天日志(按比赛 ID 划分,经桥写入本地 logs/chat/) ----

  // 最近完整日志去重缓存:文本 -> { t, isOwn }(剔除 HUD 重复行与挂起条目的重复记录)
  function pruneRecentLogs() {
    if (!State.recentLogs || State.recentLogs.size === 0) return;
    const cutoff = nowMs() - LOG_DEDUP_WINDOW_MS;
    const keys = [];
    const it = State.recentLogs.keys();
    let k = it.next();
    while (!k.done) {
      keys.push(k.value);
      k = it.next();
    }
    for (let i = 0; i < keys.length; i += 1) {
      const rec = State.recentLogs.get(keys[i]);
      if (!rec || rec.t < cutoff) State.recentLogs.delete(keys[i]);
    }
  }

  function recentLogHit(text, isOwn) {
    pruneRecentLogs();
    const t = String(text || "").trim();
    if (!t) return false;
    const rec = State.recentLogs.get(t);
    if (!rec) return false;
    if (rec.isOwn !== !!isOwn) return false;
    return nowMs() - rec.t <= LOG_DEDUP_WINDOW_MS;
  }

  function rememberRecentLog(text, isOwn) {
    pruneRecentLogs();
    const t = String(text || "").trim();
    if (!t) return;
    State.recentLogs.set(t, { t: nowMs(), isOwn: !!isOwn });
    if (State.recentLogs.size > LOG_DEDUP_LIMIT) {
      const firstKey = State.recentLogs.keys().next().value;
      if (firstKey !== undefined) State.recentLogs.delete(firstKey);
    }
  }

  // 挂起条目键:同文本+是否自己视为同一消息(等待字段补全期间合并)
  function pendingKey(text, isOwn) {
    return String(text || "").trim() + "\x00" + (isOwn ? "1" : "0");
  }

  function buildLogEntry(record) {
    return {
      t: new Date().toISOString(),
      sender: String(record.sender || ""),
      hero: resolveHero(record),
      heroId: resolveHeroId(record),
      steamid: resolveSteamId(record),
      channel: String(record.channel || ""),
      isOwn: !!record.isOwn,
      text: String(record.text || "").slice(0, 2000),
    };
  }

  // 挂起一条字段未填充完整的记录:等完整版到达后丢弃,或超时后兜底落盘(不丢消息)
  // 重复扫描同一行时不刷新首次挂起时间,避免持续重扫导致永不落盘
  function deferLog(record) {
    const entry = buildLogEntry(record);
    const key = pendingKey(entry.text, entry.isOwn);
    const existing = State.pendingLogs[key];
    if (existing) existing.entry = entry;
    else State.pendingLogs[key] = { entry: entry, t: nowMs() };
  }

  function dropPending(text, isOwn) {
    const key = pendingKey(text, isOwn);
    if (State.pendingLogs[key]) delete State.pendingLogs[key];
  }

  // 挂起超过等待窗口的记录兜底落盘(此时通常已无完整版,宁留 <unknown> 不漏消息)
  // 兜底条目不写入 recentLogs:HUD 去重只针对"已有完整普通记录"的重复行,
  // 避免把 HUD-only 快速指令的不同次触发误去重
  function flushPendingLogs() {
    const cutoff = nowMs() - PENDING_LOG_TIMEOUT_MS;
    for (const key of Object.keys(State.pendingLogs)) {
      const item = State.pendingLogs[key];
      if (item && item.t <= cutoff) {
        State.logBuffer.push(item.entry);
        delete State.pendingLogs[key];
      }
    }
  }

  function pushEntry(entry) {
    State.logBuffer.push(entry);
    rememberRecentLog(entry.text, entry.isOwn);
    if (State.logBuffer.length >= 30) flushChatLog();
    else if (!State.logFlushing) {
      State.logFlushing = true;
      $.Schedule(1.0, flushChatLog);
    }
  }

  function pushChatLog(record) {
    if (State.cfg && State.cfg.chatLog === false) return;
    const text = String(record.text || "").slice(0, 2000);
    if (!text) return;
    const sender = String(record.sender || "").trim();
    const channel = String(record.channel || "");

    // HUD 顶栏行是左下聊天行的重复展示:
    // - 同文本最近已有完整记录 -> 跳过,避免 <unknown>/hud 重复条目
    // - 已挂起同文本 -> 跳过(等完整版或超时兜底)
    // - 否则挂起等待补全,避免与晚到的完整普通行重复
    if (record.hud) {
      if (recentLogHit(text, record.isOwn)) return;
      if (State.pendingLogs[pendingKey(text, record.isOwn)]) return;
      // 自己的 HUD 消息:补本地玩家昵称,让英雄/SteamID 能按昵称解析
      // (仅 isOwn 时补;他人消息补本地昵称会造成错误归属)
      if (record.isOwn && (!sender || sender === UNKNOWN_NAME)) {
        const ownName = localPlayerName();
        if (ownName) record = Object.assign({}, record, { sender: ownName });
      }
      deferLog(record);
      return;
    }

    // 普通行尚未填充完整(sender/频道都为空):挂起等字段就绪
    // (完整版到达会清掉挂起条目;超时由 flushPendingLogs 兜底落盘,避免丢消息)
    if ((!sender || sender === UNKNOWN_NAME) && !channel) {
      deferLog(record);
      return;
    }

    // 完整记录:先清掉同文本的挂起条目(避免 <unknown> 与完整版重复),再落盘
    dropPending(text, record.isOwn);
    pushEntry(buildLogEntry(record));
  }

  function flushChatLog() {
    State.logFlushing = false;
    flushPendingLogs(); // 超时的挂起条目先兜底进缓冲,一并发送
    const lines = State.logBuffer.splice(0, 50);
    if (!lines.length) return;
    bridgePost("log", { matchId: getMatchId(), lines: lines }, function (res) {
      if (res && !res.ok) {
        // 失败重放一次,避免丢日志;仍失败则丢弃(不阻塞翻译)
        if (lines.length && !State.logBuffer.__retried) {
          State.logBuffer.__retried = true;
          State.logBuffer.unshift.apply(State.logBuffer, lines.slice(0, 20));
          $.Schedule(5.0, flushChatLog);
        }
      }
    });
  }

  // ---- 桥健康探测(定时 ping,断线后状态栏提示 + 恢复后自动清错) ----
  // 注意:health 与翻译共用串行队列;队列忙时跳过本次 ping,避免 health 阻塞发消息/测试
    function healthCheck() {
    if (State.queue.length > 0 || State.pending) return;
    // long offline + panel-only channel -> reset to re-probe direct (works if game supports AsyncWebRequest)
    if (State.bridgeOfflineSince && (nowMs() - State.bridgeOfflineSince) > BRIDGE_OFFLINE_GRACE_SECONDS * 1000 && State.canHttp === false) {
      State.canHttp = null;
      log("bridge channel: reset to re-probe direct (was panel-only)");
    }
    bridgePost("health", {}, function (res) {
      if (res && res.ok) {
        if (!State.bridgeUp) log("bridge online (health)");
        State.bridgeUp = true;
        State.bridgeOfflineSince = 0;
        setBridgeStatus(t("bridgeOnline") + " \u00b7 " + (res.provider || State.cfg.provider || "bing"));
        // 版本更新提示:health 响应带 updateInfo 时在状态栏显示一次
        if (res.updateInfo && res.updateInfo.hasUpdate && !State.updateNotified) {
          State.updateNotified = true;
          const info = res.updateInfo;
          State.updateMsg = t("updateAvailable") + info.latestVersion + " \u00b7 " + t("updateHint");
          log("info", "update available: " + info.currentVersion + " -> " + info.latestVersion + " (" + info.releaseUrl + ")");
          updateBridgeStatusUI();
        }
        if (!State.cfgSynced && !State.cfgSyncing) {
          State.cfgSyncing = true;
          syncBridgeConfig(function () { State.cfgSyncing = false; });
        }
        // 首次上线:从桥拉取游戏名保护名单(全量,消除硬编码兜底名单漂移)
        if (!State.gamenamesLoaded && !State.gamenamesLoading) {
          State.gamenamesLoading = true;
          syncGameNames(function () { State.gamenamesLoading = false; });
        }
      } else {
        // offline grace: only mark red after BRIDGE_OFFLINE_GRACE_SECONDS of continuous failure,
        // absorbing the few-second LCTBridgePanel-unreachable blip when opening settings / switching UI
        if (!State.bridgeOfflineSince) {
          State.bridgeOfflineSince = nowMs();
          log("bridge offline (health): grace started");
        } else if (nowMs() - State.bridgeOfflineSince > BRIDGE_OFFLINE_GRACE_SECONDS * 1000) {
          State.bridgeUp = false;
          setStatus(t("bridgeOffline"));
          setBridgeStatus(t("bridgeOffline"));
        }
      }
    });
  }


  function setBridgeStatus(text) {
    const label = findChild(getRoot(), "LCTBridgeStatus");
    if (label) {
      try {
        label.text = t("bridgeStatusPrefix") + String(text || "");
      } catch (e) {}
    }
  }

  // ================= 聊天扫描 =================

  function resolveChatMessages() {
    const root = getRoot();
    if (!root) return null;
    if (!isValid(State.chat)) State.chat = findChild(root, CHAT_ROOT_ID);
    const chat = State.chat;
    const messages = findChild(chat, CHAT_MESSAGES_ID) || findChild(root, CHAT_MESSAGES_ID);
    if (isValid(messages) && messages !== State.messages) {
      State.messages = messages;
      State.scannedCount = 0;
    }
    if (isValid(State.messages) && !State.bootLogged) {
      State.bootLogged = true;
      log("loaded v" + VERSION + "; watching ChatMessages");
    }
    return isValid(State.messages) ? State.messages : null;
  }

  // 回收复用清理:聊天行被游戏复用时,清除本 mod 残留(旧译文标签 + 原文折叠样式)
  function resetRowModState(row) {
    try {
      const contents = findChild(row, MESSAGE_CONTENTS_ID);
      if (contents && contents.style) {
        contents.style.visibility = "visible";
      }
    } catch (e) {}
    // 收集译文标签所在容器(普通行:MessageBody;HUD 行:MessageContents)
    const containers = [];
    const body = findClass(row, MESSAGE_BODY_CLASS);
    if (isValid(body)) containers.push(body);
    const contents = findChild(row, MESSAGE_CONTENTS_ID);
    if (isValid(contents)) containers.push(contents);
    const bubble = findClass(row, HUD_BUBBLE_CLASS);
    if (isValid(bubble)) containers.push(bubble);
    containers.push(row);
    for (const container of containers) {
      if (!isValid(container)) continue;
      const count = childCount(container);
      for (let i = count - 1; i >= 0; i -= 1) {
        const child = childAt(container, i);
        if (!isValid(child)) continue;
        if (!hasClass(child, TRANS_LABEL_CLASS) && !hasClass(child, TRANS_LABEL_HUD_CLASS) && !hasClass(child, TRANS_LABEL_LOBBY_CLASS)) continue;
        try {
          child.DeleteAsync(0);
        } catch (e) {
          try {
            child.RemoveAndDeleteChildren();
          } catch (e2) {}
        }
      }
    }
  }

  function processRow(row) {
    if (!isValid(row)) return false;
    const record = readMessageRow(row);
    if (!record) return false;
    if (record.quick) rememberQuickText(record.text);
    const skipTranslation = shouldSkip(record);
    // 翻译前占位替换:保护英雄/物品名不被翻译API意译
    const _ng = replaceGameNames(record.text, PROTECT_TO_ZH);
    if (_ng.nameMap) { record.text = _ng.text; record._nameMap = _ng.nameMap; }
    const sig = makeSignature(record);

    // 已处理过的行:若签名变化说明被回收复用,重置处理状态
    const prevSig = row.__lctSig;
    if (row.__lctProcessed && prevSig === sig) {
      // 尝试从缓存恢复译文(聊天滚动回收场景)
      if (!skipTranslation && State.cache.has(sig)) restoreFromCache(row, sig);
      return false;
    }
    if (prevSig !== sig) {
      row.__lctProcessed = false;
      resetRowModState(row);
    }
    row.__lctSig = sig;
    row.__lctProcessed = true;

    if (State.seen.has(sig)) {
      if (!skipTranslation && State.cache.has(sig)) restoreFromCache(row, sig);
      // 测试行:相同文本也强制重新翻译(seen 去重会吞掉重复测试)
      if (row.__lctTestForce) {
        State.seen.delete(sig);
        row.__lctTestForce = false;
      } else {
        return false;
      }
    }
    State.seen.add(sig);
    while (State.seen.size > SEEN_LIMIT) {
      const first = State.seen.values().next().value;
      if (first === undefined) break;
      State.seen.delete(first);
    }

    // 聊天日志采集(所有新消息都记,不随 shouldSkip 过滤——指令/自己的消息也要留档)
    pushChatLog(record);

    if (skipTranslation) return false;
    if (State.cache.has(sig)) {
      injectTranslation(row, sig, State.cache.get(sig).translation);
      return false;
    }
    enqueue(row, sig, record);
    return true;
  }

  function processRange(messages, start, end) {
    let touched = false;
    for (let i = Math.max(0, start); i < end; i += 1) {
      try {
        if (processRow(childAt(messages, i))) touched = true;
      } catch (e) {
        log("processRow error: " + (e && e.message ? e.message : String(e)));
      }
    }
    return touched;
  }

  function scanChatMessagesOnce() {
    const messages = resolveChatMessages();
    if (!messages) {
      State.messages = null;
      State.scannedCount = 0;
      return false;
    }
    const count = childCount(messages);
    if (count < State.scannedCount) State.scannedCount = 0; // 聊天清空/重建
    let touched = false;
    if (State.scannedCount === 0 && count > BOOTSTRAP_TAIL_SCAN_LIMIT) {
      touched = processRange(messages, count - BOOTSTRAP_TAIL_SCAN_LIMIT, count) || touched;
    } else {
      touched = processRange(messages, State.scannedCount, count) || touched;
    }
    State.scannedCount = count;
    // 低延迟:每次额外扫末尾几条(发送者名/内容可能延迟填充)
    touched = processRange(messages, Math.max(0, count - LOW_LATENCY_TAIL_SCAN_LIMIT), count) || touched;
    return touched;
  }

  // ================= 大厅聊天扫描(hudchat.vxml) =================
  // 大厅/组队聊天容器:ChatLinesPanel(旧版 hudchat 结构;当前版本若无此面板则静默跳过)
  function resolveLobbyMessages() {
    const root = getRoot();
    if (!root) return null;
    if (!isValid(State.lobbyMessages)) {
      State.lobbyMessages = findChild(root, CHAT_LINES_PANEL_ID);
      if (isValid(State.lobbyMessages)) {
        State.lobbyScanned = 0;
        log("watching lobby chat (ChatLinesPanel)");
      }
    }
    return isValid(State.lobbyMessages) ? State.lobbyMessages : null;
  }

  function scanLobbyOnce() {
    const messages = resolveLobbyMessages();
    if (!messages) return false;
    const count = childCount(messages);
    if (count < State.lobbyScanned) State.lobbyScanned = 0; // 清空/重建
    let touched = false;
    if (State.lobbyScanned === 0 && count > BOOTSTRAP_TAIL_SCAN_LIMIT) {
      touched = processRange(messages, count - BOOTSTRAP_TAIL_SCAN_LIMIT, count) || touched;
    } else {
      touched = processRange(messages, State.lobbyScanned, count) || touched;
    }
    State.lobbyScanned = count;
    touched = processRange(messages, Math.max(0, count - LOW_LATENCY_TAIL_SCAN_LIMIT), count) || touched;
    return touched;
  }

  // ================= HUD 顶栏聊天扫描(citadel_hud_top_bar_chat) =================

  // 解析 HUD 顶栏聊天的 Messages 容器(Team1Chat/Team2Chat 两个实例)
  // 注意:CitadelHudTopBarChat 是面板 type 不是 class,FindChildrenWithClassTraverse 找不到,
  // 必须用布局里写死的 id(Team1Chat/Team2Chat)查找,class 遍历仅作兜底。
  function resolveHudMessages() {
    const root = getRoot();
    if (!root) return;
    const found = [];
    const seen = new Set(); // 用 Set 去重(对象 key 会转 [object Object] 导致误判)
    const tryAdd = (chat) => {
      if (!isValid(chat) || seen.has(chat)) return;
      const messages = findChild(chat, HUD_MESSAGES_ID);
      if (isValid(messages)) { seen.add(chat); found.push(messages); }
    };
    // 主路径:固定 id(游戏布局写死)
    for (const id of HUD_CHAT_IDS) {
      tryAdd(findChild(root, id));
    }
    // 兜底:class 遍历(万一游戏改了 id)
    const chats = root.FindChildrenWithClassTraverse
      ? (() => { try { return root.FindChildrenWithClassTraverse(HUD_CHAT_CLASS) || []; } catch (e) { return []; } })()
      : [];
    for (const chat of chats) tryAdd(chat);
    // 面板树变化时重建列表(游戏可能动态增删顶栏聊天实例)
    let changed = found.length !== State.hudMessages.length;
    if (!changed) {
      for (let i = 0; i < found.length; i += 1) {
        if (found[i] !== State.hudMessages[i]) { changed = true; break; }
      }
    }
    if (changed) {
      State.hudMessages = found;
      State.hudScanned = found.map(() => 0);
      // 每次面板树变化都打印(菜单 0 个 -> 进局 2 个,日志能明确看到发现时机)
      log("watching HUD top bar chat (" + found.length + ")");
    }
    // 首轮 resolve 若 0 个:打印诊断(根面板 id/class),仅一次避免刷屏
    if (found.length === 0 && !State.hudLogged) {
      State.hudLogged = true;
      let cls = "?";
      try { if (root.GetPanelClassList) cls = root.GetPanelClassList().join(","); } catch (e) {}
      log("HUD chat not found yet: root=" + (root.id || "?") + " classes=[" + cls + "] (retrying each poll)");
    }
  }

  function scanHudTopBarOnce() {
    resolveHudMessages();
    let touched = false;
    for (let i = 0; i < State.hudMessages.length; i += 1) {
      try {
        const messages = State.hudMessages[i];
        if (!isValid(messages)) continue;
        const count = childCount(messages);
        if (count < State.hudScanned[i]) State.hudScanned[i] = 0;
        const start = State.hudScanned[i];
        touched = processRange(messages, start, count) || touched;
        // 低延迟:每次额外扫末尾几条
        touched = processRange(messages, Math.max(0, count - LOW_LATENCY_TAIL_SCAN_LIMIT), count) || touched;
        State.hudScanned[i] = count;
      } catch (e) {
        // 单行/单容器扫描异常不应中断整个 HUD 扫描(防止个别面板异常导致顶栏翻译全部停摆)
        log("scanHudTopBarOnce: container " + i + " error: " + (e && e.message ? e.message : String(e)));
      }
    }
    return touched;
  }

  function scanChatMessages() {
    // 注意:两个扫描都必须执行,不能用 || 短路——
    // 左下角聊天有活动时 scanChatMessagesOnce() 返回 true 会跳过 HUD 扫描
    const touchedChat = scanChatMessagesOnce();
    const touchedHud = scanHudTopBarOnce();
    const touchedLobby = scanLobbyOnce();
    const touched = touchedChat || touchedHud || touchedLobby;
    const hasWork = touched || State.queue.length > 0 || State.pending;
    $.Schedule(hasWork ? FAST_POLL_SECONDS : SLOW_POLL_SECONDS, scanChatMessages);
  }

  // !lcttest 测试命令:向 HUD 顶栏聊天注入一条构造消息(与真实行同构),
  // 走正常扫描+翻译流程。无队友/无 bot 时验证 HUD 通路的唯一手段。
  function injectHudTestMessage(text) {
    try {
      resolveHudMessages();
      if (State.hudMessages.length === 0) {
        log("HUD test: no HUD chat container found yet (in-match?)");
        return;
      }
      const container = State.hudMessages[0]; // Team1Chat 的 Messages
      const row = $.CreatePanel("Panel", container, "LCTTestRow" + nowMs());
      row.AddClass("ChatMessage");
      const contents = $.CreatePanel("Panel", row, "MessageContents");
      const bubble = $.CreatePanel("Panel", contents, "");
      bubble.AddClass("ChatBubble");
      const tc = $.CreatePanel("Panel", bubble, "");
      tc.AddClass("TextContainer");
      const textPanel = $.CreatePanel("Label", tc, "MessageText");
      textPanel.text = String(text);
      row.__lctTestForce = true; // 每次测试都强制重新翻译(不被 seen 去重吞掉)
      log("HUD test: injected '" + String(text).slice(0, 40) + "' into HUD chat (" + State.hudMessages.length + " containers)");
      // 关键:行可能被游戏 1 秒内清理,立即同步扫描一次抢在清理前发出翻译请求
      try { scanHudTopBarOnce(); } catch (e) { log("HUD test: immediate scan failed: " + (e && e.message ? e.message : String(e))); }
      // 诊断:1s/3s 后检查行是否存活、可见性、是否已注入译文(定位行被删/隐藏/翻译时序问题)
      const checkRow = row;
      $.Schedule(1.0, function () {
        if (!isValid(checkRow)) { log("HUD test: row GONE at 1s"); return; }
        let vis = "?";
        try { vis = String(checkRow.style.visibility); } catch (e) {}
        let expired = false;
        try { expired = checkRow.BHasClass("Expired"); } catch (e) {}
        const hasLabel = findClass(checkRow, TRANS_LABEL_HUD_CLASS);
        log("HUD test: row alive@1s vis=" + vis + " expired=" + expired + " label=" + (hasLabel ? "yes" : "no"));
      });
      $.Schedule(3.0, function () {
        if (!isValid(checkRow)) { log("HUD test: row GONE at 3s"); return; }
        let vis = "?";
        try { vis = String(checkRow.style.visibility); } catch (e) {}
        const hasLabel = findClass(checkRow, TRANS_LABEL_HUD_CLASS);
        log("HUD test: row alive@3s vis=" + vis + " label=" + (hasLabel ? "yes" : "no"));
      });
    } catch (e) {
      log("HUD test failed: " + (e && e.message ? e.message : String(e)));
    }
  }

  // ================= 发送接管(命令 / 发送前翻译) =================

  // 触发原版发送:派发 CitadelChatInputSubmitted 事件,必须传入输入面板参数
  // (DLCT/poker 同款机制;传 null 原版处理器不会发送)
  function submitEventName() {
    try {
      if (findChild(getRoot(), CHAT_LINES_PANEL_ID)) return "CitadelChatTextSubmitted";
    } catch (e) {}
    return "CitadelChatInputSubmitted";
  }

  function triggerStockSubmit(input) {
    try {
      if (!input || !input.text) input = State.input || findChild(getRoot(), CHAT_INPUT_ID);
      if (!input) return;
      $.DispatchEvent(submitEventName(), input);
    } catch (e) {
      log("submit dispatch failed: " + (e && e.message ? e.message : String(e)));
    }
  }

  function clearInput() {
    try {
      const input = State.input || findChild(getRoot(), CHAT_INPUT_ID);
      if (input) input.text = "";
    } catch (e) {}
  }

  // 统一提交处理;带防重(函数调用 + 事件监听双通道可能同时触发)
  function handleChatSubmit(input) {
    const now = nowMs();
    if (State.lastSubmitAt && now - State.lastSubmitAt < 150) return;
    State.lastSubmitAt = now;

    if (!input || typeof input.text !== "string") {
      input = State.input || findChild(getRoot(), CHAT_INPUT_ID);
    }
    if (!input) return;
    State.input = input;

    const raw = safeText(input);
    const trimmed = String(raw).trim();
    if (!trimmed) return;

    // /tr 命令:打开设置面板,不发送
    if (trimmed === "/tr" || trimmed.indexOf("/tr ") === 0) {
      clearInput();
      openSettingsPanel();
      return;
    }

    // !lcttest 测试命令:向 HUD 顶栏聊天注入一条英文消息(不真实发送)
    // 用途:无队友/无 bot 时验证 HUD 扫描+翻译通路;进训练场即可测
    if (trimmed === "!lcttest" || trimmed.indexOf("!lcttest ") === 0) {
      const testText = trimmed.length > 9 ? trimmed.slice(9).trim() : "hello can you push mid";
      injectHudTestMessage(testText);
      clearInput();
      return;
    }

    // 发送前翻译(off=发原文 / translation=仅译文 / bilingual=原文|译文)
    // 若检测到消息已是目标语言(sameLanguage),则按原文发送,不做无用翻译
    const outgoingMode = State.cfg.outgoing || "off";
    if (State.cfg.enabled && outgoingMode !== "off" && trimmed.charAt(0) !== "/") {
      const outTarget = resolveOutgoingTarget();
      // 防重复发送:同一文本翻译中,重复按 Enter 直接忽略(避免队列积压发多条)
      // 不同文本则排队(前一文本的翻译结果已提交,不冲突)
      if (State.outgoingPending === trimmed) {
        log("outgoing dedupe: same text pending, ignored: " + trimmed.slice(0, 40));
        return;
      }
      State.outgoingPending = trimmed;
      // 立即清空输入框:视觉反馈"已发送",不再误以为没发出去而重复按键
      clearInput();
      translateOutgoing(trimmed, function (translated, detected) {
        State.outgoingPending = null;
        let send = trimmed;
        if (translated && translated !== trimmed && !sameLanguage(detected, outTarget)) {
          const trText = String(translated).trim();
          if (outgoingMode === "translation") send = trText;
          else if (outgoingMode === "bilingual") send = trimmed + " | " + trText;
          // 超长消息保护:游戏聊天发送有长度上限,拼接过长会被截断/失败;
          // 优先保留原文,译文超限部分截断加省略号
          const MAX_SEND_CHARS = 400;
          if (send.length > MAX_SEND_CHARS) {
            if (outgoingMode === "bilingual") {
              const budget = Math.max(0, MAX_SEND_CHARS - trimmed.length - 3);
              send = trimmed + " | " + (trText.length > budget ? trText.slice(0, budget) + "…" : trText);
            } else {
              send = send.slice(0, MAX_SEND_CHARS) + "…";
            }
          }
          setStatus("已发送译文: " + String(send).slice(0, 40));
        } else if (!translated) {
          // 翻译不可用/超时:按原文发送,但必须留日志+游戏内提示,否则用户看到原文会以为服务商坏了
          log("outgoing: translation unavailable (timeout/error), sending original");
          showOutgoingFailTip();
          setStatus("翻译不可用,已按原文发送");
        } else if (translated === trimmed || sameLanguage(detected, outTarget)) {
          // 目标语言与原文相同(en->en 等):不发无用译文
          log("outgoing: no-op (detected=" + (detected || "unknown") + " == target), sending original");
          setStatus("原文已是目标语言,按原文发送");
        }
        log("outgoing mode=" + outgoingMode + " detected=" + (detected || "-") + " -> " + send.slice(0, 80));
        // 覆盖前先捕获当前输入框内容:若用户已输入新消息,不能丢失
        const cur = safeText(input);
        try {
          input.text = send;
        } catch (e) {}
        triggerStockSubmit(input);
        if (cur !== "" && cur !== trimmed) {
          // 用户已输入新内容:恢复它,让用户自行提交
          try {
            input.text = cur;
          } catch (e) {}
        } else {
          clearInput();
        }
      });
      return;
    }

    // 常规发送:确保文本就位后触发原版发送(与 DLCT commitChatText 行为一致)
    try {
      input.text = trimmed;
    } catch (e) {}
    triggerStockSubmit(input);
    clearInput();
  }

  function translateOutgoing(text, done) {
    // 直连通道(canHttp)可用时不需要 HTML 面板;即便面板不可用也应走直连翻译。
    // 仅当直连不可用且面板也不可用时,才按原文发送。
    const canHttp = detectAsyncWebRequest();
    const panel = canHttp ? null : ensurePanel();
    if (!canHttp && !panel) {
      setStatus("桥未连接,已按原文发送");
      done(null, null);
      return;
    }
    ensureBridgeEvents();
    enqueueOutgoing(text, done);
  }

  // ================= 设置面板 =================

  function setStatus(text) {
    const label = findChild(getRoot(), STATUS_LABEL_ID);
    if (label) {
      try {
        label.text = text || "";
      } catch (e) {}
    }
  }

  function openSettingsPanel() {
    const panel = findChild(getRoot(), SETTINGS_PANEL_ID);
    if (!panel) return;
    try {
      panel.AddClass(SETTINGS_VISIBLE_CLASS);
    } catch (e) {}
    try {
      if (typeof panel.SetHasClass === "function") panel.SetHasClass(SETTINGS_VISIBLE_CLASS, true);
    } catch (e) {}
    syncPanelFromConfig();
    // 立即用上次已知的 Key 状态回填占位符(避免每次打开先闪空;异步拉取后会再确认)
    if ((State.cfg._providerKeys || {})[State.cfg.provider || "bing"]) {
      setFieldText("LCTApiKey", "********");
      credFieldSnap.apiKey = "********";
    }
    // 从桥拉取已保存配置:回填 UI 偏好(游戏重启后恢复) + apiKey 占位符
    bridgePost("config", {}, function (res) {
      if (res && res.ok && res.config) {
        const c = res.config;
        if (c.ui) {
          let changed = false;
          if (typeof c.ui.displayMode === "string") { State.cfg.displayMode = c.ui.displayMode; changed = true; }
          if (typeof c.ui.outgoing === "string") { State.cfg.outgoing = c.ui.outgoing; changed = true; }
          if (typeof c.ui.outgoingTarget === "string") { State.cfg.outgoingTarget = c.ui.outgoingTarget; changed = true; }
          if (typeof c.ui.targetLanguage === "string") { State.cfg.targetLanguage = c.ui.targetLanguage; changed = true; }
          if (typeof c.ui.enabled === "boolean") { State.cfg.enabled = c.ui.enabled; changed = true; }
          if (typeof c.ui.force === "boolean") { State.cfg.force = c.ui.force; changed = true; }
          if (typeof c.ui.provider === "string") { State.cfg.provider = c.ui.provider; changed = true; }
          if (typeof c.ui.timeoutMs === "number") { State.cfg.timeoutMs = c.ui.timeoutMs; changed = true; }
          if (changed) {
            syncPanelFromConfig();
            saveUiConfig();
          }
        }
        // 记录各服务商是否已配置 Key(供 collectPanelConfig 防误清空)
        State.cfg._providerKeys = {
          microsoft: !!(c.microsoft && c.microsoft.hasApiKey),
          openai: !!(c.openai && c.openai.hasApiKey),
          deepl: !!(c.deepl && c.deepl.hasApiKey),
          google: !!(c.google && c.google.hasApiKey),
        };
        // apiKey 占位符必须在 syncPanelFromConfig 之后设置(否则会被其清空)
        if (c.microsoft && c.microsoft.hasApiKey) { setFieldText("LCTApiKey", "********"); credFieldSnap.apiKey = "********"; }
        if (c.openai && c.openai.hasApiKey) { setFieldText("LCTApiKey", "********"); credFieldSnap.apiKey = "********"; }
        if (c.deepl && c.deepl.hasApiKey) { setFieldText("LCTApiKey", "********"); credFieldSnap.apiKey = "********"; }
        if (c.google && c.google.hasApiKey) { setFieldText("LCTApiKey", "********"); credFieldSnap.apiKey = "********"; }
        // 回填已保存的 Microsoft 区域(region 非机密,直接明文回显),否则每次打开都是空
        if (c.microsoft && c.microsoft.region) {
          setFieldText("LCTRegion", String(c.microsoft.region));
          credFieldSnap.region = String(c.microsoft.region);
        }
        if (c.openai && c.openai.baseUrl) setFieldText("LCTOpenaiBaseUrl", c.openai.baseUrl);
        if (c.openai && c.openai.model) setFieldText("LCTOpenaiModel", c.openai.model);
        if (c.deepl && c.deepl.endpoint) setFieldText("LCTDeeplEndpoint", c.deepl.endpoint);
        if (Array.isArray(c.fallbackProviders)) {
          const fbStr = c.fallbackProviders.join(",");
          setFieldText("LCTFallback", fbStr);
          credFieldSnap.fallback = fbStr;
        }
        if (c.chatLog && typeof c.chatLog.enabled === "boolean") {
          State.cfg.chatLog = c.chatLog.enabled;
          setToggleText("LCTChatLog", State.cfg.chatLog);
        }
        if (typeof c.translateOwn === "boolean") {
          State.cfg.translateOwn = c.translateOwn;
          setToggleText("LCTTranslateOwn", State.cfg.translateOwn);
        }
      }
    });
    // 聚焦面板本身(与 DLCT 一致:优先控件,失败则面板;面板持焦后 Tab/Enter 可用)
    try {
      const first = findChild(panel, "LCTEnabled");
      if (first && first.SetFocus) first.SetFocus();
      else if (panel.SetFocus) panel.SetFocus();
    } catch (e) {}
  }

  function closeSettingsPanel() {
    const panel = findChild(getRoot(), SETTINGS_PANEL_ID);
    if (panel) {
      try {
        panel.RemoveClass(SETTINGS_VISIBLE_CLASS);
      } catch (e) {}
    }
    // 注意:不要在这里 SetFocus(root)!!
    // root 是 HUD 根面板, SetFocus 后键盘焦点被 UI 层吃掉, 游戏收不到按键
    // (V3 实测: 鼠标恢复了但键盘死掉 —— 就是这行 root.SetFocus() 干的)
    // 正确做法: 焦点已在 LCTEntryBlur 里通过 CitadelChatInputBlur+DropInputFocus 还给引擎
  }

  function LCTToggleSettings() {
    const panel = findChild(getRoot(), SETTINGS_PANEL_ID);
    if (panel && hasClass(panel, SETTINGS_VISIBLE_CLASS)) closeSettingsPanel();
    else openSettingsPanel();
  }

  function LCTCloseSettings() {
    log("close clicked");
    closeSettingsPanel();
  }

  // TextEntry 失焦恢复:释放输入焦点 + 走原版 ChatInput 路径退出引擎文本输入模式
  // 修复 Deadlock FPS 引擎对 TextEntry 焦点隐藏鼠标/锁键盘的问题
  // 关键(从原版聊天发送链路 poker_chat_debug.js 确认):
  //   引擎的键盘模式由 CitadelChat 面板体系(ChatInput)控制。
  //   发送后恢复 = $.DispatchEvent("CitadelChatInputBlur", ChatInput) + DropInputFocus(ChatInput)
  // V4 失败原因:把 CitadelChatInputBlur 派发到了我们自己的 entry(非 ChatInput) → 引擎不认识,静默忽略
  // entry 由 XML onblur="LCTEntryBlur(this)" 显式传入 = 触发事件的 TextEntry 面板
  function LCTEntryBlur(entry) {
    // 1) 释放我们 TextEntry 的输入焦点 → 鼠标恢复
    if (entry) {
      try { $.DispatchEvent("DropInputFocus", entry); } catch (e) {}
    }
    // 2) 走原版 ChatInput 失焦路径:对原版 ChatInput 面板派发引擎事件 → 键盘回游戏
    const chatInput = State.input || findChild(getRoot(), CHAT_INPUT_ID);
    if (chatInput) {
      try { $.DispatchEvent("CitadelChatInputBlur", chatInput); } catch (e) {}
      try { $.DispatchEvent("DropInputFocus", chatInput); } catch (e) {}
    }
    // 注意: 不要 SetFocus 到 settings panel —— 那会把键盘焦点留在 UI, 游戏收不到按键
  }

  // TextEntry 按键处理:ESC 强制关闭面板+释放焦点(焦点在输入框时面板 oncancel 不触发)
  // entry 由 XML onkeydown="LCTEntryKey(event, this)" 显式传入 = 触发事件的 TextEntry 面板
  function LCTEntryKey(e, entry) {
    const k = e && (e.key || e.KeyCode);
    const esc = (k === "Escape" || k === "esc" || k === 27);
    if (esc) {
      log("entry esc: closing settings");
      LCTEntryBlur(entry);   // 先释放焦点(entry = 真实 TextEntry, DropInputFocus 才有效)
      closeSettingsPanel();  // 再关面板(内部会把焦点还给根)
    }
    return false;
  }

  function fieldValue(id) {
    const panel = findChild(getRoot(), SETTINGS_PANEL_ID);
    const field = panel ? findChild(panel, id) : null;
    return field ? safeText(field) : "";
  }

  function setFieldText(id, text) {
    const panel = findChild(getRoot(), SETTINGS_PANEL_ID);
    const field = panel ? findChild(panel, id) : null;
    if (field) {
      try {
        field.text = text;
      } catch (e) {}
    }
  }

  // 凭据字段快照:记录面板当前展示的 apiKey/region 文本。
  // 保存时对比快照判断“用户真的改过”还是“字段只是被清空/占位”,避免误传空值覆盖已存配置。
  let credFieldSnap = { apiKey: "", region: "", fallback: "" };

  function syncPanelFromConfig() {
    setFieldText("LCTApiKey", "");
    setFieldText("LCTRegion", "");
    setFieldText("LCTOpenaiBaseUrl", "");
    setFieldText("LCTOpenaiModel", "");
    setFieldText("LCTDeeplEndpoint", "");
    setFieldText("LCTTargetLangCustom", "");
    setFieldText("LCTOutgoingTargetCustom", "");
    setFieldText("LCTTimeout", String(State.cfg.timeoutMs || 15000));
    setSelectText("LCTProviderSelect", labelFor(PROVIDER_OPTIONS, State.cfg.provider || "bing"));
    syncProviderRows();
    setSelectText("LCTTargetLangSelect", labelFor(LANGUAGE_OPTIONS, State.cfg.targetLanguage || "zh-Hans"));
    setSelectText("LCTDisplayModeSelect", labelFor(DISPLAY_MODES, State.cfg.displayMode || "bilingual"));
    setSelectText("LCTOutgoingSelect", labelFor(OUTGOING_MODES, State.cfg.outgoing || "off"));
    setSelectText("LCTOutgoingTargetSelect", labelFor(LANGUAGE_OPTIONS, State.cfg.outgoingTarget || "en"));
    setSelectText("LCTUILangSelect", labelFor(UI_LANG_OPTIONS, State.cfg.uiLang || "zh"));
    setToggleText("LCTEnabled", !!State.cfg.enabled);
    setToggleText("LCTForce", !!State.cfg.force);
    setToggleText("LCTTranslateOwn", State.cfg.translateOwn !== false);
    setToggleText("LCTChatLog", State.cfg.chatLog !== false);
    syncCustomInputs();
    closeSelectMenus();
    setStatus("");
    credFieldSnap = { apiKey: "", region: "", fallback: fieldValue("LCTFallback") }; // 字段被重置/保留,同步快照
    // 已知该服务商有 Key 时立即恢复占位符,避免中途切选项把占位符抹成空白
    if ((State.cfg._providerKeys || {})[State.cfg.provider || "bing"]) {
      setFieldText("LCTApiKey", "********");
      credFieldSnap.apiKey = "********";
    }
    updateBridgeStatusUI(); // 打开设置面板时刷新桥状态行
  }

  function setSelectText(buttonId, text) {
    const panel = findChild(getRoot(), SETTINGS_PANEL_ID);
    const btn = panel ? findChild(panel, buttonId) : null;
    const label = btn ? findChild(btn, buttonId + "Label") : null;
    if (label) {
      try {
        label.text = text;
      } catch (e) {}
    }
  }

  function labelFor(options, value) {
    for (let i = 0; i < options.length; i += 1) {
      if (options[i].value === value) return t(options[i].key);
    }
    return String(value || "");
  }

  function cycleValue(options, current) {
    for (let i = 0; i < options.length; i += 1) {
      if (options[i].value === current) return options[(i + 1) % options.length].value;
    }
    return options[0].value;
  }

  const SELECT_MENU_IDS = [
    "LCTProviderMenu",
    "LCTTargetLangMenu",
    "LCTDisplayModeMenu",
    "LCTOutgoingMenu",
    "LCTOutgoingTargetMenu",
    "LCTUILangMenu",
  ];

  function closeSelectMenus() {
    const root = getRoot();
    for (let i = 0; i < SELECT_MENU_IDS.length; i += 1) {
      const m = findChild(root, SELECT_MENU_IDS[i]);
      if (m) {
        try {
          m.RemoveClass(SETTINGS_VISIBLE_CLASS);
        } catch (e) {}
      }
    }
  }

  // 自定义语言输入框显隐
  function syncCustomInputs() {
    const root = getRoot();
    const t = findChild(root, "LCTTargetLangCustom");
    const o = findChild(root, "LCTOutgoingTargetCustom");
    if (t) {
      try {
        if (State.cfg.targetLanguage === "custom") t.AddClass(SETTINGS_VISIBLE_CLASS);
        else t.RemoveClass(SETTINGS_VISIBLE_CLASS);
      } catch (e) {}
    }
    if (o) {
      try {
        if (State.cfg.outgoingTarget === "custom") o.AddClass(SETTINGS_VISIBLE_CLASS);
        else o.RemoveClass(SETTINGS_VISIBLE_CLASS);
      } catch (e) {}
    }
  }

  // API Key / 区域行显隐已按用户意见移除(行显隐机制不稳定,且非必需)

  function setToggleText(id, on) {
    const panel = findChild(getRoot(), SETTINGS_PANEL_ID);
    const toggle = panel ? findChild(panel, id) : null;
    if (!toggle) return;
    const label = findChild(toggle, id + "Label") || toggle;
    try {
      const lang = (State.cfg && State.cfg.uiLang) || "zh";
      label.text = on ? (lang === "en" ? "ON" : "\u662f") : (lang === "en" ? "OFF" : "\u5426");
    } catch (e) {}
  }

  function LCTOnToggle(which) {
    if (which === "enabled") {
      State.cfg.enabled = !State.cfg.enabled;
      setToggleText("LCTEnabled", State.cfg.enabled);
    } else if (which === "force") {
      State.cfg.force = !State.cfg.force;
      setToggleText("LCTForce", State.cfg.force);
    } else if (which === "chatLog") {
      State.cfg.chatLog = State.cfg.chatLog === false;
      setToggleText("LCTChatLog", State.cfg.chatLog);
      setStatus(State.cfg.chatLog ? t("msgLogOn") : t("msgLogOff"));
    } else if (which === "translateOwn") {
      State.cfg.translateOwn = State.cfg.translateOwn === false;
      setToggleText("LCTTranslateOwn", State.cfg.translateOwn);
      setStatus(State.cfg.translateOwn ? t("msgTranslateOwnOn") : t("msgTranslateOwnOff"));
    }
    saveUiConfig();
    log("toggle: " + which);
  }

  // 循环切换(服务商/显示模式/发送模式)
  // 根据当前服务商显示/隐藏对应的配置行与标签提示
  function syncProviderRows() {
    const p = State.cfg.provider || "bing";
    const setRow = function (id, show) {
      const row = findChild(getRoot(), id);
      if (!row) return;
      try {
        row.style.visibility = show ? "visible" : "collapse";
      } catch (e) {}
    };
    setRow("LCTRowApiKey", p === "microsoft" || p === "openai" || p === "deepl" || p === "google");
    setRow("LCTRowRegion", p === "microsoft");
    setRow("LCTRowOpenaiBase", p === "openai");
    setRow("LCTRowOpenaiModel", p === "openai");
    setRow("LCTRowDeeplEndpoint", p === "deepl");
    let hint = "";
    if (p === "bing") hint = t("hintBing");
    else if (p === "microsoft") hint = t("hintMicrosoft");
    else if (p === "openai") hint = t("hintOpenai");
    else if (p === "deepl") hint = t("hintDeepl");
    else if (p === "google") hint = t("hintGoogle");
    setStatus(hint);
  }

  function LCTPickProvider(value) {
    State.cfg.provider = value;
    syncPanelFromConfig();
    saveUiConfig();
    closeSelectMenus();
    log("pickProvider: " + value);
  }

  function LCTCycle(which) {
    closeSelectMenus();
    if (which === "provider") {
      State.cfg.provider = cycleValue(PROVIDER_OPTIONS, State.cfg.provider || "bing");
      setSelectText("LCTProviderSelect", labelFor(PROVIDER_OPTIONS, State.cfg.provider));
    } else if (which === "displayMode") {
      State.cfg.displayMode = cycleValue(DISPLAY_MODES, State.cfg.displayMode || "bilingual");
      setSelectText("LCTDisplayModeSelect", labelFor(DISPLAY_MODES, State.cfg.displayMode));
    } else if (which === "outgoing") {
      State.cfg.outgoing = cycleValue(OUTGOING_MODES, State.cfg.outgoing || "off");
      setSelectText("LCTOutgoingSelect", labelFor(OUTGOING_MODES, State.cfg.outgoing));
    }
    saveUiConfig();
    log("cycle: " + which + " -> " + State.cfg[which]);
  }

  // 下拉菜单开关(目标语言/发送目标语言)
  function LCTToggleMenu(field) {
    const menuId =
      field === "uiLang" ? "LCTUILangMenu" :
      field === "targetLanguage" ? "LCTTargetLangMenu" :
      field === "outgoingTarget" ? "LCTOutgoingTargetMenu" :
      field === "provider" ? "LCTProviderMenu" :
      field === "displayMode" ? "LCTDisplayModeMenu" :
      field === "outgoing" ? "LCTOutgoingMenu" : "";
    if (!menuId) return;
    const menu = findChild(getRoot(), menuId);
    if (!menu) return;
    const isOpen = hasClass(menu, SETTINGS_VISIBLE_CLASS);
    closeSelectMenus();
    if (!isOpen) {
      try {
        menu.AddClass(SETTINGS_VISIBLE_CLASS);
      } catch (e) {}
    }
    log("menu: " + field + (isOpen ? " close" : " open"));
  }

  // 菜单选项选择
  function LCTPickLang(field, value) {
    closeSelectMenus();
    if (field === "targetLanguage") {
      State.cfg.targetLanguage = value;
      setSelectText("LCTTargetLangSelect", labelFor(LANGUAGE_OPTIONS, value));
    } else {
      State.cfg.outgoingTarget = value;
      setSelectText("LCTOutgoingTargetSelect", labelFor(LANGUAGE_OPTIONS, value));
    }
    syncCustomInputs();
    saveUiConfig();
    closeSelectMenus();
    log("pickLang: " + field + " -> " + value);
    if (value === "custom") {
      const customId = field === "targetLanguage" ? "LCTTargetLangCustom" : "LCTOutgoingTargetCustom";
      const custom = findChild(getRoot(), customId);
      if (custom && custom.SetFocus) {
        try {
          custom.SetFocus();
        } catch (e) {}
      }
    }
  }

  function LCTPickOption(field, value) {
    if (field === "displayMode") State.cfg.displayMode = value;
    else if (field === "outgoing") State.cfg.outgoing = value;
    else return;
    syncPanelFromConfig();
    saveUiConfig();
    closeSelectMenus();
    log("pickOption: " + field + " -> " + value);
  }

  function collectPanelConfig() {
    const customTarget = fieldValue("LCTTargetLangCustom");
    const targetLang = State.cfg.targetLanguage === "custom"
      ? (customTarget || "zh-Hans")
      : (State.cfg.targetLanguage || "zh-Hans");
    const customOut = fieldValue("LCTOutgoingTargetCustom");
    const outgoingTarget = State.cfg.outgoingTarget === "custom"
      ? (customOut || "en")
      : (State.cfg.outgoingTarget || "en");
    const prov = State.cfg.provider || "bing";
    const apiKeyField = fieldValue("LCTApiKey");
    // 面板字段为空但该服务商已有 Key:发保留标记,避免误清空(修复 /tr 重复打开后 Key 丢失)
    const apiKeyValue = (!apiKeyField && (State.cfg._providerKeys || {})[prov]) ? "********" : apiKeyField;
    // 仅当用户真的改动了回退列表输入时才回传;未动过/异步回填前 = 不带该字段,桥端保留原值
    const fbField = String(fieldValue("LCTFallback") || "");
    if (fbField !== credFieldSnap.fallback) {
      out.fallbackProviders = fbField.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    }
    // region 只有在用户真的改动了输入时才回传(对比快照);
    // 清空输入 = 显式请求清除(clearRegion),未动过 = 完全不带该字段,桥端保留原值
    const regionField = fieldValue("LCTRegion");
    const out = {
      provider: prov,
      apiKey: apiKeyValue,
      openaiBaseUrl: fieldValue("LCTOpenaiBaseUrl"),
      openaiModel: fieldValue("LCTOpenaiModel"),
      deeplEndpoint: fieldValue("LCTDeeplEndpoint"),
      targetLanguage: targetLang,
      sourceLanguage: "auto",
      displayMode: State.cfg.displayMode || "bilingual",
      outgoing: State.cfg.outgoing || "off",
      outgoingTarget: outgoingTarget,
      enabled: !!State.cfg.enabled,
      force: !!State.cfg.force,
      timeoutMs: Number(fieldValue("LCTTimeout")) || 15000,
      chatLog: State.cfg.chatLog !== false,
      translateOwn: State.cfg.translateOwn !== false,
      ui: {
        enabled: !!State.cfg.enabled,
        provider: State.cfg.provider || "bing",
        displayMode: State.cfg.displayMode || "bilingual",
        outgoing: State.cfg.outgoing || "off",
        outgoingTarget: outgoingTarget,
        targetLanguage: targetLang,
        force: !!State.cfg.force,
        timeoutMs: Number(fieldValue("LCTTimeout")) || 15000,
      },
    };
    // 仅当用户真的改动了区域输入时才回传;清空输入 = 显式清除
    if (regionField !== credFieldSnap.region) {
      if (regionField === "") out.clearRegion = true;
      else out.region = regionField;
    }
    return out;
  }

  function bridgePost(op, payload, done) {
    const data = encodeURIComponent(JSON.stringify(payload || {}));
    // 直连通道可用时不要求 HTML 面板存在(hudchat 未加载时测试/保存也能用)
    const canHttp = detectAsyncWebRequest();
    const panel = canHttp ? null : ensurePanel();
    if (!canHttp && !panel) {
      done({ ok: false, error: "bridge_panel_unavailable" });
      return;
    }
    ensureBridgeEvents();
    enqueueBridge(op, data, done);
  }

  function LCTSave() {
    log("save clicked");
    closeSelectMenus();
    const p = collectPanelConfig();
    bridgePost("config", { config: p }, function (res) {
      if (res && res.ok) {
        State.cfg.provider = p.provider || State.cfg.provider;
        State.cfg.targetLanguage = p.targetLanguage;
        State.cfg.displayMode = p.displayMode;
        State.cfg.outgoing = p.outgoing;
        State.cfg.outgoingTarget = p.outgoingTarget;
        State.cfg.enabled = p.enabled;
        State.cfg.force = p.force;
        State.cfg.timeoutMs = p.timeoutMs;
        State.cfg.chatLog = p.chatLog !== false;
        State.cfg.translateOwn = p.translateOwn !== false;
        // 保存成功:同步 Key 状态(新填 Key / 保留占位符都视为已有 Key)
        if (State.cfg._providerKeys) {
          State.cfg._providerKeys[p.provider || "bing"] = !!(p.apiKey && p.apiKey !== "");
        }
        syncProviderRows();
        saveUiConfig();
        setStatus(t("msgSavedWith") + (p.provider || "bing") + ")");
        log("settings saved");
      } else {
        setStatus(t("msgSaveFail") + ": " + ((res && res.error) || "unknown"));
      }
    });
  }

  function LCTTest() {
    log("test clicked");
    setStatus(t("msgTesting") + Math.round((State.cfg.timeoutMs || 15000) / 1000) + t("msgTestSec"));
    bridgePost("test", {}, function (res) {
      if (res && res.ok) setStatus(t("msgTestOk") + (res.translation || ""));
      else setStatus(t("msgTestFail") + ": " + ((res && res.error) || "unknown") + " (bridge/Key/network)");
    });
  }

  // ---- 多语言:应用当前 UI 语言到面板所有静态文本 ----
  function applyUILang() {
    const root = getRoot();
    if (!root) return;
    const panel = findChild(root, SETTINGS_PANEL_ID);
    const find = function (id) { return panel ? findChild(panel, id) : findChild(root, id); };
    // 面板标题
    var lbl = find("LCTPanelTitle"); if (lbl) try { lbl.text = t("panelTitle"); } catch (e) {}
    // 设置行标签
    var ROW_MAP = {
      "LCTRowLabelBridgeStatus": "rowBridgeStatus", "LCTRowLabelEnabled": "rowEnabled",
      "LCTRowLabelProvider": "rowProvider", "LCTRowLabelApiKey": "rowApiKey",
      "LCTRowLabelRegion": "rowRegion", "LCTRowLabelOpenaiBase": "rowOpenaiBase",
      "LCTRowLabelOpenaiModel": "rowOpenaiModel", "LCTRowLabelDeeplEndpoint": "rowDeeplEndpoint",
      "LCTRowLabelFallback": "rowFallback", "LCTRowLabelTargetLang": "rowTargetLang",
      "LCTRowLabelDisplayMode": "rowDisplayMode", "LCTRowLabelOutgoing": "rowOutgoing",
      "LCTRowLabelOutgoingTarget": "rowOutgoingTarget", "LCTRowLabelTimeout": "rowTimeout",
      "LCTRowLabelForce": "rowForce", "LCTRowLabelTranslateOwn": "rowTranslateOwn",
      "LCTRowLabelChatLog": "rowChatLog", "LCTRowLabelUILang": "rowUILang",
    };
    for (var id in ROW_MAP) { lbl = find(id); if (lbl) try { lbl.text = t(ROW_MAP[id]); } catch (e) {}
    }
    // 菜单选项文本
    var MENU_MAP = {
      "LCTMenuBing": "optBing", "LCTMenuMicrosoft": "optMicrosoft",
      "LCTMenuOpenai": "optOpenai", "LCTMenuDeepl": "optDeepl", "LCTMenuGoogle": "optGoogle",
      "LCTMenuLangZhHans": "optLangZhHans", "LCTMenuLangZhHant": "optLangZhHant",
      "LCTMenuLangEn": "optLangEn", "LCTMenuLangJa": "optLangJa",
      "LCTMenuLangKo": "optLangKo", "LCTMenuLangFr": "optLangFr",
      "LCTMenuLangDe": "optLangDe", "LCTMenuLangEs": "optLangEs",
      "LCTMenuLangCustom": "optLangCustom",
      "LCTMenuOutLangZhHans": "optLangZhHans", "LCTMenuOutLangZhHant": "optLangZhHant",
      "LCTMenuOutLangEn": "optLangEn", "LCTMenuOutLangJa": "optLangJa",
      "LCTMenuOutLangKo": "optLangKo", "LCTMenuOutLangFr": "optLangFr",
      "LCTMenuOutLangDe": "optLangDe", "LCTMenuOutLangEs": "optLangEs",
      "LCTMenuOutLangCustom": "optLangCustom",
      "LCTMenuBilingual": "optBilingual", "LCTMenuTranslationOnly": "optTranslationOnly",
      "LCTMenuOutOff": "optOutOff", "LCTMenuOutTranslation": "optOutTranslation",
      "LCTMenuOutBilingual": "optOutBilingual",
      "LCTMenuUILangZh": "optUILangZh", "LCTMenuUILangEn": "optUILangEn",
    };
    for (var mid in MENU_MAP) { lbl = find(mid); if (lbl) try { lbl.text = t(MENU_MAP[mid]); } catch (e) {}
    }
    // 按钮文本
    lbl = find("LCTSaveBtnLabel"); if (lbl) try { lbl.text = t("btnSave"); } catch (e) {}
    lbl = find("LCTTestBtnLabel"); if (lbl) try { lbl.text = t("btnTest"); } catch (e) {}
    lbl = find("LCTKeyHint"); if (lbl) try { lbl.text = t("btnHint"); } catch (e) {}
    // 同步选择控件当前值的显示文本
    setSelectText("LCTProviderSelect", labelFor(PROVIDER_OPTIONS, State.cfg.provider || "bing"));
    setSelectText("LCTTargetLangSelect", labelFor(LANGUAGE_OPTIONS, State.cfg.targetLanguage || "zh-Hans"));
    setSelectText("LCTDisplayModeSelect", labelFor(DISPLAY_MODES, State.cfg.displayMode || "bilingual"));
    setSelectText("LCTOutgoingSelect", labelFor(OUTGOING_MODES, State.cfg.outgoing || "off"));
    setSelectText("LCTOutgoingTargetSelect", labelFor(LANGUAGE_OPTIONS, State.cfg.outgoingTarget || "en"));
    setSelectText("LCTUILangSelect", labelFor(UI_LANG_OPTIONS, State.cfg.uiLang || "zh"));
    // 同步开关文本
    setToggleText("LCTEnabled", !!State.cfg.enabled);
    setToggleText("LCTForce", !!State.cfg.force);
    setToggleText("LCTTranslateOwn", State.cfg.translateOwn !== false);
    setToggleText("LCTChatLog", State.cfg.chatLog !== false);
    // 同步桥状态
    updateBridgeStatusUI();
  }

  function LCTPickUILang(value) {
    State.cfg.uiLang = value;
    saveUiConfig();
    applyUILang();
    closeSelectMenus();
    log("pickUILang: " + value);
  }

  // ================= 启动 =================

  function syncBridgeConfig(callback) {
    // BUGFIX 0.1.3:boot 时主动从桥拉取已保存配置,同步进 State.cfg,
    // 否则游戏重启后 outgoing 等偏好回落到 UI_DEFAULTS(发送前翻译默认关)。
    // boot 时 UI 树可能尚未构建,面板找不到会立即失败 -> 延迟重试。
    // BUGFIX 0.1.3 (again):不能依赖 State.bridgeUp 决定是否重试——
    // bridgeUp 为 true 时一次拉取失败会静默放弃,translateOwn 永远不同步。
    // 改为:只要没同步成功就持续重试(最多 30 次/60 秒),成功后置 State.cfgSynced。
    let attempts = 0;
    const MAX_SYNC_ATTEMPTS = 30;
    const trySync = function () {
      attempts += 1;
      bridgePost("config", {}, function (res) {
        if (res && res.ok && res.config) {
          const c = res.config;
          let changed = false;
          // ui 子对象(面板偏好)
          const ui = c.ui || {};
          if (typeof ui.displayMode === "string") { State.cfg.displayMode = ui.displayMode; changed = true; }
          if (typeof ui.outgoing === "string") { State.cfg.outgoing = ui.outgoing; changed = true; }
          if (typeof ui.outgoingTarget === "string") { State.cfg.outgoingTarget = ui.outgoingTarget; changed = true; }
          if (typeof ui.targetLanguage === "string") { State.cfg.targetLanguage = ui.targetLanguage; changed = true; }
          if (typeof ui.enabled === "boolean") { State.cfg.enabled = ui.enabled; changed = true; }
          if (typeof ui.force === "boolean") { State.cfg.force = ui.force; changed = true; }
          if (typeof ui.provider === "string") { State.cfg.provider = ui.provider; changed = true; }
          if (typeof ui.timeoutMs === "number") { State.cfg.timeoutMs = ui.timeoutMs; changed = true; }
          // 顶层开关(chatLog/translateOwn 不在 ui 子对象里,BUGFIX:游戏重启后
          // 若不回填,State.cfg 回落到 DEFAULTS(translateOwn:true),导致"关掉还翻译")
          if (typeof c.translateOwn === "boolean") { State.cfg.translateOwn = c.translateOwn; changed = true; }
          if (c.chatLog && typeof c.chatLog === "object") {
            if (typeof c.chatLog.enabled === "boolean") { State.cfg.chatLog = c.chatLog.enabled; changed = true; }
          }
          if (changed) {
            saveUiConfig();
            log("boot: config synced from bridge (outgoing=" + State.cfg.outgoing + ", translateOwn=" + State.cfg.translateOwn + ")");
          }
          State.cfgSynced = true;
          if (callback) callback();
        } else if (attempts < MAX_SYNC_ATTEMPTS) {
          // 拉取失败(桥未就绪/网络抖动/面板未构建):无条件重试,不再依赖 bridgeUp
          $.Schedule(2.0, trySync);
        } else {
          if (callback) callback();
        }
      });
    };
    trySync();
  }

  // 从桥拉取游戏名保护名单(/api/v1/gamenames)。
  // 成功则用全量名单(原始大小写)覆盖硬编码兜底 PROTECT_NAMES / PROTECT_TO_ZH 并重建正则;
  // 失败则保留现有兜底名单(不覆盖),并有限重试。
  function syncGameNames(callback) {
    let attempts = 0;
    const MAX_ATTEMPTS = 10;
    const trySync = function () {
      attempts += 1;
      const url = "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/api/v1/gamenames";
      httpGetJson(url, function (res) {
        if (res && res.ok && res.names && typeof res.names === "object" && Object.keys(res.names).length > 0) {
          // 桥名单含一个 "english" -> "schinese" 元字段,过滤掉(非游戏名)
          const map = {};
          for (const en of Object.keys(res.names)) {
            if (en === "english" || en === "schinese") continue;
            map[en] = res.names[en];
          }
          if (rebuildGameNames(map)) {
            State.gamenamesLoaded = true;
            if (callback) callback();
            return;
          }
        }
        // 失败/名单为空:未成功则不覆盖兜底;有限重试
        if (!State.gamenamesLoaded && attempts < MAX_ATTEMPTS) {
          $.Schedule(3.0, trySync);
        } else {
          if (callback) callback();
        }
      }, 10000);
    };
    trySync();
  }

  function boot() {
    State.cfg = loadUiConfig();
    applyUILang(); // 初始化界面语言
    ensureBridgeEvents(); // 尽早注册 HTML 面板事件(读回主通道)
    syncBridgeConfig(); // BUGFIX 0.1.3:启动即同步桥配置,发送前翻译不再需要先开一次设置面板
    applyUILang(); // 初始化界面语言(配置同步后应用)
    updateBridgeDot(); // 初始状态:桥未上线前显示红点
    // DMM 用户引导:启动后 12s 桥仍未在线 => 面板显示未运行 + 安装指引
    $.Schedule(12.0, checkBridgeMissing);
    $.Schedule(SLOW_POLL_SECONDS, scanChatMessages);
    // 桥健康探测(每 5 秒;与翻译请求共用串行队列,量极小不影响翻译)
    $.Schedule(2.0, function healthLoop() {
      healthCheck();
      $.Schedule(5.0, healthLoop);
    });
    // 日志缓冲兜底冲刷(每 8 秒;确保不丢最后一小批)
    $.Schedule(8.0, function logLoop() {
      flushChatLog();
      $.Schedule(8.0, logLoop);
    });
  }

  // 导出给 XML 布局调用的全局函数
  // 教训:每个导出必须独立 try/catch——曾有虚构事件注册抛异常被吞,
  // 导致后续导出全部跳过(按钮点击报 is not defined)。
  function exportGlobal(name, fn) {
    try {
      globalThis[name] = fn;
    } catch (e) {
      log("export failed: " + name + " - " + (e && e.message ? e.message : String(e)));
    }
  }
  exportGlobal("LCTOnChatSubmit", function () {
    handleChatSubmit(findChild(getRoot(), CHAT_INPUT_ID));
  });
  exportGlobal("LCTToggleSettings", LCTToggleSettings);
  exportGlobal("LCTCloseSettings", LCTCloseSettings);
  exportGlobal("LCTEntryBlur", LCTEntryBlur);
  exportGlobal("LCTEntryKey", LCTEntryKey);
  exportGlobal("LCTOnToggle", LCTOnToggle);
  exportGlobal("LCTCycle", LCTCycle);
  exportGlobal("LCTToggleMenu", LCTToggleMenu);
  exportGlobal("LCTPickLang", LCTPickLang);
  exportGlobal("LCTPickProvider", LCTPickProvider);
  exportGlobal("LCTPickUILang", LCTPickUILang);
  exportGlobal("LCTPickOption", LCTPickOption);
  exportGlobal("LCTSave", LCTSave);
  exportGlobal("LCTTest", LCTTest);
  // 测试/调试钩子(simtest 直接调用;游戏内无副作用)
  exportGlobal("showOutgoingFailTip", showOutgoingFailTip);
  exportGlobal("markBridgeUp", markBridgeUp);

  boot();
})();
