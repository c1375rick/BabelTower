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
  const VERSION = "1.2.2-6726-btipc12"; // btipc12 (2026-10-28):https 探针独立槽+判死后自动重探;quick 判定收紧(文本硬校验);outgoing 队列饿死兜底;BTIPC 传输层拆出独立文件 // 1.2.2 (2026-10-21) 内容:① 配置同步走**差分**(只传增删改,不传全量):复用
  //   gamenames/quickchat 的两段式(握手报本地指纹 → same 或只传变更字段);桥侧保留最近 16 版配置历史当差分
  //   基线(按客户端指纹查)。慢通道实测:没变 = 1 帧 ≈0.65s、改一个字段 = 120B ≈12 帧 ≈7.8s(旧路是全量
  //   392B = 40 帧 ≈26s,再加 20s 轮询)。→ 构建标 btipc11(BTIPС 请求语义变了,与 1.2.1 的 btipc10 线区分)
  // 1.2.1 (2026-10-20) 内容: ① 设置面板搬到**本地网页**(core/web/ui.html,桥 8791;/tr 用系统默认浏览器打开,
  //   /tr panel 保留游戏内旧面板作调试兜底):10 种界面语言(默认跟随游戏界面语言)+ 右上角可覆盖;服务商表单/
  //   游戏内行为卡片/通道健康卡/高级 JSON;② 配置下发从"只开机读一次"改成**推送**:网页保存 → 桥叫醒游戏长轮询
  //   → 游戏 <1 秒生效(三个引擎行为见 docs/btipc-https-v1.md §9);③ "启用翻译"改为**总开关**;BTIPC op=config

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
  const FAST_POLL_SECONDS = 0.4;
  const SLOW_POLL_SECONDS = 1.0;
  const BOOTSTRAP_TAIL_SCAN_LIMIT = 24; // 首次只扫末尾,避免翻历史
  const LOW_LATENCY_TAIL_SCAN_LIMIT = 6; // 每次额外扫末尾,保证低延迟(6726 气泡先建文本后填,burst>窗口时靠观察表兕底)
  const PENDING_FILL_TTL_MS = 5000; // 6726:空行观察窗 TTL(气泡先建、文本延迟填充;超时移除防空行永久占用)
  const HUD_OVERLAY_LIMIT = 10; // HUD 译文浮层上限(超过则清理最旧,防内存泄漏)
  const TITLE_POLL_SECONDS = 0.3;
  const BRIDGE_ALIVE_SECONDS = 3.0; // nav 存活窗口:开局 3s 内 CEF 忙(本地化重建/材质加载),1.5s 误杀率 ~6%
  // 面板通道判死:6726 起 SetURL 导航整条失效(每次 nav 都是 src="" 从不加载)。
  // 连续 N 次"页面从未开始加载"才判死通道,并进入冷却期:期间不再尝试导航(免得每 15s 打一条
  // `bridge nav failed: panel dead` 死链日志)。冷却到点自动复探,游戏改版修好可自愈。
  const PANEL_NAV_DEAD_STREAK = 3; // 连续几次"页面从未加载"才判死(加载慢不算,避免误杀偶发抖动)
  const PANEL_NAV_COOLDOWN_MS = 600000; // 判死后冷却 10 分钟再复探
  const CANHTTP_REPROBE_MS = 600000; // 离线复探直连通道(AsyncWebRequest)的最小间隔:
  // API 移除是游戏版本静态事实,不加限流会 复位→重探→再复位 每 5s 刷一条
  // `bridge channel: reset to re-probe direct (was panel-only)`
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
  // HOST 时机线:2026-08-25 版拦截 http://127.0.0.1 仅放行 localhost → 改用 localhost;
  // 2026-09-30 游戏更新(6726)后反向:拦截 localhost,SetURL 到 http://localhost 被静默忽略
  // (诊断证实 panel.title 恒空、src="",页面从未加载),而 127.0.0.1 正常(DeadlockLingua 1.0.1 验证)。
  // 改回 127.0.0.1;桥已双栈监听(127.0.0.1+::1),两种解析都能命中。
  const BRIDGE_HOST = "127.0.0.1";
  const BRIDGE_PORT = 8791; // 与 core/config.json 保持一致

  // ---- https 面板通道(2026-10-15):主路,但**有则用、无则退 BTIPC** ----
  // 【路线来源/事实/逐项对账】详见 docs/btipc-https-v1.md §2(来源与零代码重叠)、§4(通道选择)。
  // ① 这条回程(隐藏 HTML 面板 SetURL → /bridge + document.title 轮询)是**我们自己的**设计,早于 BTIPC
  //    就写在 docs/architecture.md §4.2 的通道③(当时定位是"回退");本段只是把它提到"主路"并加探针。
  // ② "给面板一个受信任的本机 https"(自签证书 + CurrentUser\Root + 完全重启 Steam)这个**方案本身**
  //    来自一款 GPL-3.0 同类实现,我们此前没有;证书 SAN 布局同款(§2.5 零代码重叠)。
  // 事实:面板只接受证书有效的 https(http://127.0.0.1/localhost 在 LoadPage 前就被引擎拒);
  //   桥侧 core/bridge_https.js 独立进程做 TLS 终结(证书出问题绝不能连带 BTIPC 一起死);
  //   首次需 -Trust 并**完全退出并重启 Steam**(信任库由 Steam 宿主缓存,只重启游戏不生效)。
  // 值得当主路:面板在**桥这一侧**同源 fetch 完把结果一次写进 document.title,下行只剩一个 RTT;
  //   BTIPC 位泵则是 FIRST_SHOT(1200ms)+帧数×tClose(600ms) —— 短句 3.0s、38 帧 24.4s。
  // 绝不拿掉 BTIPC(证书未信任/Steam 没重启的用户那条通道必然是死的,必须零摩擦留在 BTIPC):
  //   失败路径只有一条 —— 原样把 job 交回 BTIPC 重做,且**不消耗 job.attempts**(不是翻译失败)。
  const HTTPS_PANEL_ENABLED = true; // 总开关;现场排障时置 false 即刻全量退回 BTIPC
  const HTTPS_PANEL_HOST = "localhost"; // 证书 SAN 含 DNS:localhost 与 IP:127.0.0.1
  const HTTPS_PANEL_PORT = 8792; // 与 core/bridge_https.js 的默认端口一致
  const HTTPS_PANEL_PROBE_SECONDS = 6.0; // 探针窗口:nav 后等 title 变响应的最长时间(含一次 retryNavOnce)
  const HTTPS_PANEL_DEAD_STREAK = 3; // 会话内连续几次通道级失败才永久退 BTIPC(偶发抖动不误杀)
  const HTTPS_PANEL_REPROBE_MS = 300000; // 判死后每隔 5 分钟后台重探一次;成功即整场恢复 https(不再等重启)
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
  let PROTECT_TO_ZH = {
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
  
  // ---- 游戏名占位保护(EN/ZH 两通道共用同一套参数化实现) ----
  // 占位符 LCTPH<i> / LCTZHPH<i> 与桥侧 core/name_protect.js、游戏内 vpk fallback 同一约定,不可改
  // 从 PROTECT_TO_ZH 反转构建 { 中文译名 -> 英文原名 }
  let ZH_TO_EN = {};

  // 名单 → 正则体:按长度降序(避免短名误匹配长名子串),再逐项转义
  function protectAlt(names, escapeRe) {
    return names.slice().sort((a, b) => b.length - a.length)
      .map(n => String(n).replace(escapeRe, '\\$&')).join("|");
  }

  const NAME_SCHEMES = {
    // EN:词边界 + 大小写不敏感。还原走单趟带编号捕获组,容忍空格/大小写变化:
    // 不按 i 升序 replace,故 "LCTPH1" 不会吃掉 "LCTPH10" 的首两位;未知编号原样保留。
    en: {
      prefix: "LCTPH", label: "replaceGameNames", re: null,
      build: names => new RegExp("\\b(?:" + protectAlt(names, /[.*+?^${}()|[\\]\\]/g) + ")\\b", "gi"),
      lookupKey: m => m.toLowerCase(),
      restore: (text, mapArr) => String(text).replace(/LCTPH\s*(\d{1,3})/gi, (m, num) => {
        const idx = parseInt(num, 10);
        return (idx >= 0 && idx < mapArr.length) ? (mapArr[idx] || m) : m;
      }),
    },
    // ZH:中文名无词边界,长度降序纯子串匹配;还原沿用历史 split/join 语义
    zh: {
      prefix: "LCTZHPH", label: "replaceChineseGameNames", re: null,
      build: names => (names && names.length ? new RegExp("(?:" + protectAlt(names, /[-\/\\^$*+?.()|[\]{}]/g) + ")", "g") : null),
      lookupKey: m => m,
      restore: (text, mapArr) => {
        for (let i = 0; i < mapArr.length; i++) text = text.split("LCTZHPH" + i).join(mapArr[i]);
        return text;
      },
    },
  };

  /** 按方案占位替换:lookup = {匹配文本 -> 目标译名};返回 { text, mapArr } */
  function replaceNamesByScheme(text, scheme, lookup) {
    if (!text || typeof text !== "string" || !scheme.re) return { text: text, mapArr: null };
    try {
      const mapArr = [];
      const replaced = text.replace(scheme.re, function (match) {
        const idx = mapArr.length;
        mapArr.push(lookup ? (lookup[scheme.lookupKey(match)] || match) : match);
        return scheme.prefix + idx;
      });
      return mapArr.length > 0 ? { text: replaced, mapArr: mapArr } : { text: text, mapArr: null };
    } catch (e) {
      log(scheme.label + " error: " + (e && e.message ? e.message : String(e)));
      return { text: text, mapArr: null };
    }
  }

  /** 按方案还原占位符 */
  function restoreNamesByScheme(text, scheme, mapArr) {
    if (!text || !mapArr) return text;
    return scheme.restore(text, mapArr);
  }

  /** 英文名占位:lookup = {小写英文名 -> 中文译名};返回 { text, nameMap, originalText } */
  function replaceGameNames(text, lookup) {
    const r = replaceNamesByScheme(text, NAME_SCHEMES.en, lookup);
    return { text: r.text, nameMap: r.mapArr, originalText: text };
  }
  function restoreGameNames(text, nameMap) {
    return restoreNamesByScheme(text, NAME_SCHEMES.en, nameMap);
  }
  /** 中文名占位:lookup = {中文名 -> 英文原名};返回 { text, zhNameMap } */
  function replaceChineseGameNames(text, lookup) {
    const r = replaceNamesByScheme(text, NAME_SCHEMES.zh, lookup);
    return { text: r.text, zhNameMap: r.mapArr };
  }
  function restoreChineseGameNames(text, zhNameMap) {
    return restoreNamesByScheme(text, NAME_SCHEMES.zh, zhNameMap);
  }

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
    NAME_SCHEMES.en.re = NAME_SCHEMES.en.build(PROTECT_NAMES);
    // 重建中文名反向表
    ZH_TO_EN = {};
    for (const en of Object.keys(toZh)) {
      const zh = toZh[en];
      if (zh) ZH_TO_EN[zh] = en;
    }
    NAME_SCHEMES.zh.re = NAME_SCHEMES.zh.build(Object.keys(ZH_TO_EN));
    log("game names synced from bridge: " + names.length + " entries");
    return true;
  }
  NAME_SCHEMES.en.re = NAME_SCHEMES.en.build(PROTECT_NAMES);

  // ---- 语言启发式 ----
  const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;

  // ---- 状态 ----
  const State = {
    ummRegistered: false, // UMM 设置清单已广播(防重复注册)
    ummEchoUntil: 0, // 吸收窗截止时间:此前的 set 是 UMM 存档回放,整体忽略(桥配置为唯一持久真值)
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
    cfgSyncStarted: false, // 2026-10-16:配置同步启动门(boot 与 onBridgeAlive 共用 once,等探针先定论)
    cfgSyncWaitTries: 0, // 2026-10-16:等探针定论的轮询次数(8 次约 8s 无定论则走老路,不无限等)
    cfgDirty: null, // 2026-10-16:用户脏标记 {provider:true...},同步落地/_mask 回填时跳过这些键
    cfgMask: null, // btipc11:桥侧"游戏可见配置"的当前副本(差分施加的基准;_mask 会被保存动作清空,这份不清)
    gamenamesLoaded: false, // 启动后是否已从桥拉取过游戏名保护名单(healthCheck 补触发用)
    gamenamesLoading: false, // 名单拉取是否进行中(防 healthCheck 重复触发叠加)
    quickchatLoading: false, // 语料同步是否进行中(同上)
    quickchatTries: 0, // btipc07:本会话语料同步已尝试次数(SYNC_MAX_TRIES 封顶)
    gamenamesTries: 0, // btipc07:本会话名单同步已尝试次数(同上)
    gamenamesMap: null, // btipc07:当前名单副本(delta 增量的施加基准)
    healthDetailFetched: false, // provider/updateInfo 明细是否已补过(回声不带这些字段)
    gamenamesFp: null, // btipc07:当前名单指纹(默认 = 打包内烘焙值,握手上报它)
    seen: new Set(), // 消息签名去重
    pendingFill: new Map(), // 6726 延迟填充观察表:rowPanel -> 过期时间戳(空行文本后补,补齐后自动出表)
    cache: new Map(), // textKey(归一化文本+目标语言) -> { translation, fragment }
    inflight: new Map(), // textKey -> 在途合并组 { key, rows, settled }:同文本只发一次桥请求,结果扇出所有同文行
    queue: [], // 待翻译任务
    activeRequests: 0,
    requestSeq: 0,
    outgoingPending: null, // 发送翻译中的文本(去重:同文本重复按 Enter 忽略)
    panel: null, // 隐藏 HTML 桥面板(在 chat.xml 中用 <HTML> 标签声明)
    panelLogged: false,
    panelDead: false, // BUGFIX 0.1.3:面板导航失败标记,下次强制重新查找
    navDeadStreak: 0, // 连续"页面从未加载"的导航失败计数(够 PANEL_NAV_DEAD_STREAK 次才判死通道)
    navDeadUntil: 0, // 面板通道判死冷却截止(nowMs());期间 dispatchViaPanel 快速失败,不导航
    navDeadLogged: false, // 本次会话是否已打过一条导航死链细节日志(此后只打"进入冷却"摘要)
    // ---- https 面板通道(2026-10-15)----
    httpsPanelOk: null, // null=尚未探测;true=本会话走 https 面板;false=退回 BTIPC
    httpsPanelStreak: 0, // 通道级失败连击(够 HTTPS_PANEL_DEAD_STREAK 次就永久退 BTIPC)
    httpsPanelDemotedLogged: false, // 本次会话是否已打过"退 BTIPC"那条日志(避免每请求刷屏)
    httpsPanelHardDead: false, // true=运行时连击硬判死(疑似证书级故障):不自动重探;探测偶发失败不受此限
    probePending: null, // 探针独立槽(不占 State.pending 单槽):探针与翻译/BTIPC 位泵并行等引擎 I/O
    probeLastAt: 0, // 上次探测发起时间(nowMs()),判死后按 HTTPS_PANEL_REPROBE_MS 节流重探
    eventsRegistered: false,
    pending: null, // 统一在途桥请求 { id, onResult, deadline, sawAlive }
    bridgeUp: false,
    panelWarned: false,
    cfg: null, // 游戏侧 UI 配置
    bridgeUp: false, // 桥在线标记(health 探测维护)
    bridgeOfflineSince: 0,
    diagTitleCount: 0, // DIAG-6726:标题轮询诊断计数
    panelActivated: false, // EXP-6726b:面板已置可见/激活标记
    canHttp: null, // 直连通道(AsyncWebRequest)可用性,启动后探测一次;null=未探测
    canHttpLastProbe: 0, // 最近一次直连通道探测时间(nowMs()),给离线复探限流用
    btipcLastStormAt: 0, // 最近一次 STORM enter 时间(nowMs())——回声失败的拥塞豁免判据(2026-10-12)
    logBuffer: [], // 聊天日志缓冲(批量推送到桥)
    logFlushing: false,
    matchId: null, // 当前比赛 ID(缓存)
    nickInfoCache: null, // 昵称 -> { hero, heroId, steamid }(Players API 匹配缓存)
    recentLogs: new Map(), // 最近完整日志文本(去重 HUD 重复/未填充条目)
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
    // fallback: 仅检查 root 自身(不递归子树,避免性能陷阱)
    if (hasClass(root, className)) return root;
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

  // 游戏侧界面语言:/ui 设置页据此决定默认显示语言(优先 mod 设置,退引擎语言)。
  function gameUiLang() {
    const l = (State.cfg && State.cfg.uiLang) || "";
    if (l === "zh" || l === "en") return l;
    try {
      const s = String(typeof $.Language === "function" ? $.Language() : "").toLowerCase();
      if (s) return s.indexOf("chinese") !== -1 ? "zh" : "en";
    } catch (e) {}
    return "zh";
  }

  // trOpenSummary:/tr 拉网页时附在 UI_OPEN 后面的状态摘要,只进日志,不参与判定;绝不含 Key。
  function trOpenSummary() {
    const c = State.cfg || {};
    const u = c.ui || {};
    const ch = State.httpsPanelOk === true ? "https-panel"
      : (State.httpsPanelOk === false ? "btipc" : "probing");
    return "url=http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/ui" +
      " ch=" + ch + " provider=" + (u.provider || c.provider || "?") +
      " target=" + (u.targetLanguage || c.targetLanguage || "?") +
      " ui=" + (u.enabled === false ? "off" : "on") + " outgoing=" + (u.outgoing || "off");
  }

  // F6 修复(2026-10-10 游戏内实测):当前 Panorama 无 clearTimeout/setTimeout 全局
  // (ctprobe 实测 typeof 均 undefined),$.Schedule 句柄的官方取消器是 $.CancelScheduled
  // (diag-globals 枚举证实存在)。取消失败的后果:旧通道 outgoing 20s 超时回调晚到 →
  // 双 finishJob → 槽位超发(MAX_ACTIVE_REQUESTS=1 被击穿)。
  function cancelSched(h) {
    if (!h) return;
    try {
      if (typeof $.CancelScheduled === "function") $.CancelScheduled(h);
    } catch (e) {}
    try { clearTimeout(h); } catch (e2) {} // 双保险:若某版本以 clearTimeout 实现
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

  // expErr:错误消息格式化 —— P4a 从实验探针区分家移入(settle/boot 路径引用留核心;探针经 LCTNS 别名导入)
  function expErr(e) {
    return e && e.message ? e.message : String(e);
  }
  // expCall:实验探针晚绑定派发(2026-10-12 P4a)—— 探针区已拆至 lingua_chat_exp.vjs_c,
  // 经 chat.xml/hudchat.xml 顺序装载;探针文件缺失或内部异常时降级为无操作,聊天主流程不受影响。
  function expCall(name, a, b) {
    var f = globalThis.LCTNS && globalThis.LCTNS[name];
    if (typeof f !== "function") return undefined;
    try { return f(a, b); } catch (e) { log("exp " + name + " THREW " + expErr(e)); return undefined; }
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

  // ================= UMM (Universal Mod Manager) 设置联动 =================
  // 文档: https://xaohs.github.io/universal-mod-manager/authors/integration/
  // 机制: ClientUI_FireOutput 是唯一跨 Panorama 上下文通道(引擎事件,字符串载荷);
  //       UMM 不在时无人应答,本 mod 行为不变(见 values 上报设计,注释在下方)。
  // @sync-begin umm-manifest (tests/umm_integration.test.js 从此提取;同步副本 core/umm_bridge.js)
  const UMM_CHANNEL = "ClientUI_FireOutput";
  const UMM_PROTOCOL = 1;
  const UMM_ID = "babeltower";
  const UMM_NAME = "Babel Tower";
  // 设置清单: 镜像 /tr 面板的纯偏好项。API Key 故意不进 UMM ——
  // 通道是明文 JSON 广播(所有 mod 都能听到),机密不跨上下文传输。
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

  // UMM 可控键白名单(设置消息逐键过滤,防未知 key 污染 State.cfg)
  const UMM_MANAGED_KEYS = {
    enabled: true, provider: true, targetLanguage: true, displayMode: true,
    outgoing: true, outgoingTarget: true, force: true, timeoutMs: true,
    translateOwn: true, chatLog: true,
  };

  // 从清单提取当前值(boot 注册时随 manifest 上报;文档值优先级:
  // UMM 会话已存值 > 我们上报的 values > 清单声明默认值。
  // 关键设计: LCT 有自己的持久化(convar+面板属性),未装 UMM 时 boot 绝不能跑
  // "apply 默认值"循环 —— 否则每次启动都会把用户已保存的配置打回出厂。
  // 所以 UMM 缺席路径是"什么都不做",UMM 在场时用 values 收编当前值作为起点)
  function ummCurrentValues() {
    const values = {};
    const c = State.cfg || UI_DEFAULTS;
    for (const key in UMM_MANAGED_KEYS) {
      if (typeof c[key] !== "undefined") values[key] = c[key];
    }
    return values;
  }

  // ---- UMM 标签本地化(同步副本 core/umm_bridge.js localizeUmmManifest + UMM_I18N_ZH;
  // ---- 测试对账 tests/umm_integration.test.js。放在 manifest 块后、announce 前) ----
  // @sync-begin umm-i18n (tests/umm_integration.test.js 从此提取)
  function localizeUmmManifest(list, lang) {
    if (lang !== "zh") return list;
    const t = {
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
    return list.map(function (s) {
      if (s.type === "group") {
        return { type: "group", label: t.groups[s.label] || s.label };
      }
      const out = {};
      for (const k in s) out[k] = s[k];
      if (t.settings[s.id]) out.label = t.settings[s.id];
      if (Array.isArray(s.options) && t.options[s.id]) {
        out.options = s.options.map(function (o) {
          return t.options[s.id][o.value] ? { value: o.value, label: t.options[s.id][o.value] } : o;
        });
      }
      return out;
    });
  }
  // @sync-end umm-i18n

  function ummAnnounce() {
    try {
      // 标签随界面语言: 中文界面下 UMM 设置窗口显示中文(core/umm_bridge.js localizeUmmManifest 同规则,
      // 测试对账 tests/umm_integration.test.js);存储按 id 不按 label,切语言不丢设置。
      const lang = (State.cfg && State.cfg.uiLang) || "zh";
      const manifest = localizeUmmManifest(UMM_SETTINGS, lang);
      // announce 后 UMM 会把它存档值逐键 set 回来(协议既定行为,每次 announce 都重放)。
      // 吸收窗: 这批 set 整体忽略 —— 桥配置(/tr 保存)是唯一持久真值;
      // 若放行回放,UMM 存档会在每次打开 UMM 面板(hello)时压回 /tr 的改动,
      // 表现为"只履行 UMM 设置,不履行 /tr 设置"(2026-09-25 用户实测)。
      // UMM 里的真实改动发生在窗口外(人工操作远慢于回放扫荡),照常应用。
      State.ummEchoUntil = nowMs() + 1500;
      $.DispatchEvent(UMM_CHANNEL, JSON.stringify({
        umm: UMM_PROTOCOL,
        t: "register",
        id: UMM_ID,
        name: (lang === "zh") ? "巴别塔" : UMM_NAME,
        settings: manifest,
        values: ummCurrentValues(),
      }));
    } catch (e) {}
  }
  // @sync-end umm-manifest

  // UMM set -> 单键应用。返回是否命中(供测试与告警判别)。
  // 副作用: 改 State.cfg + saveUiConfig() + 桥端部分推送(applyMaskedUpdate 合并语义,单键安全)。
  // @sync-begin umm-apply (tests/umm_integration.test.js 从此提取;同步副本 core/umm_bridge.js applyUmmSettingCore)
  function applyUmmSetting(key, value) {
    if (!UMM_MANAGED_KEYS[key]) return false;
    if (typeof value === "undefined") return false;
    // 吸收窗: UMM 每次 announce 后的存档回放扫荡,整体忽略 ——
    // 不改状态/不落盘/不推桥。桥配置(/tr 面板保存)是唯一持久真值,
    // 否则 UMM 存档会在每次 hello 时压回 /tr 改动(2026-09-25 实锢"只履行 UMM 设置")。
    // UMM 的真实改动在窗口外到达(人工操作远慢于回放),不受影响。
    if (nowMs() < (State.ummEchoUntil || 0)) return true;
    if (!State.cfg) State.cfg = Object.assign({}, UI_DEFAULTS);
    // 逐键类型白名单校验(通道广播可被任意 mod 伪造,set 载荷不可信)
    if (key === "timeoutMs") {
      const n = Number(value);
      if (!isFinite(n) || n < 1000 || n > 60000) return false;
      State.cfg.timeoutMs = Math.floor(n);
    } else if (key === "force" || key === "enabled" || key === "translateOwn" || key === "chatLog") {
      State.cfg[key] = !!value;
    } else {
      const allowed = { provider: 1, targetLanguage: 1, displayMode: 1, outgoing: 1, outgoingTarget: 1 };
      if (typeof value !== "string" || !allowed[key]) return false;
      // 枚举值必须在清单 options 里(防野值把面板/桥推入未定义态)
      let known = false;
      for (let i = 0; i < UMM_SETTINGS.length; i += 1) {
        const s = UMM_SETTINGS[i];
        if (s && s.id === key && s.options) {
          for (let j = 0; j < s.options.length; j += 1) {
            if (s.options[j].value === value) { known = true; break; }
          }
          break;
        }
      }
      if (!known) return false;
      State.cfg[key] = value;
    }
    saveUiConfig();
    // 桥端持久化(桥离线时静默失败,下次 boot syncBridgeConfig 会以桥配置为准回填;
    // UMM 改动重进游戏仍在 —— State.cfg 自身持久化兜底了 UI 层)。
    // 双形态镜像(与 collectPanelConfig 同构): 这些键在桥端同时存在扁平与 cfg.ui.* 两种形态,
    // 只发扁平会被面板打开时的 GET(c.ui.* 优先)覆盖回去 ——
    // 2026-09-25 实锢: UMM 改目标语言后 /tr 面板与翻译语言都不变。
    const patch = {};
    if (key === "chatLog") patch.chatLog = !!value;
    else if (key === "translateOwn") patch.translateOwn = !!value;
    else if (key === "timeoutMs") patch.timeoutMs = State.cfg.timeoutMs;
    else if (key === "enabled") patch.enabled = State.cfg.enabled;
    else if (key === "force") patch.force = State.cfg.force;
    else patch[key] = value;
    if (key !== "chatLog" && key !== "translateOwn") {
      patch.ui = {};
      patch.ui[key] = patch[key];
    }
    bridgePost("config", { config: patch }, function () {});
    return true;
  }
  // @sync-end umm-apply

  // @sync-begin umm-bus (tests/umm_integration.test.js 从此提取;同步副本 core/umm_bridge.js)
  function onUmmBus(payload) {
    // 廉价预检: 通道上还有其它 mod 的广播,非 UMM 流量不进 JSON.parse
    if (typeof payload !== "string" || payload.indexOf('"umm"') === -1) return;
    let msg = null;
    try { msg = JSON.parse(payload); } catch (e) { return; }
    if (!msg || msg.umm !== UMM_PROTOCOL) return;
    if (msg.t === "hello") {
      // UMM 晚于本 mod 启动时广播 hello 请求重报;幂等(重复 register 由 UMM 合并)
      ummAnnounce();
    } else if (msg.t === "set" && msg.id === UMM_ID) {
      if (!applyUmmSetting(msg.key, msg.value)) {
        log("umm: rejected set key=" + String(msg.key));
      }
    }
  }
  // @sync-end umm-bus

  function registerUmmSettings() {
    if (State.ummRegistered) return;
    State.ummRegistered = true;
    try {
      $.RegisterForUnhandledEvent(UMM_CHANNEL, onUmmBus);
    } catch (e) {
      log("umm: event registration failed: " + (e && e.message ? e.message : String(e)));
    }
    // 只注册 + 广播,不套默认值(理由见 ummCurrentValues 注释)
    ummAnnounce();
    log("umm: settings announced");
  }

  // ================= 消息读取与过滤 =================

  function readMessageRow(row) {
    // 注:曾有"面板缓存"(__lctCached/__lctCachedSig 守卫)在此跳过 DOM 读取。
    // 2026-09-17 移除:守卫两端都是 mod 自管值,游戏回收复用行(改 DOM 内容)时两者均不变 →
    // 永远命中旧缓存 record → sig 永不变化 → resetRowModState 永不触发 → 行冻结在旧译文+折叠态
    // (simtest test2 实锤;9-15 该缓存已咬过一次 record.text 改写)。DOM 每扫必读,扫描范围本就有界。
    // 大厅聊天行(hudchat:ChatLineContainer 直挂 ChatLinesPanel,无 MessageSource/MessageContents)
    if (hasClass(row, LOBBY_ROW_CLASS)) {
      const lineLabel = findClass(row, LOBBY_LINE_CLASS);
      const text = safeText(lineLabel) || collectText(row);
      if (!text) return null;
      const sender = safeText(findClass(row, LOBBY_PERSONA_CLASS)) || UNKNOWN_NAME;
      const prefix = safeText(findClass(row, LOBBY_PREFIX_CLASS));
      const isOwn = hasClass(row, "IsSelf") || !!findClass(row, LOCAL_CLIENT_ID);
      const result = {
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
      return result;
    }
    // HUD 顶栏行:无 MessageSource,文本在 MessageText(气泡内),sender 未知
    const isHudRow = hasClass(row, "ChatMessage") && !!findClass(row, HUD_BUBBLE_CLASS);
    if (isHudRow) {
      const textLabel = findChild(row, HUD_TEXT_ID);
      const text = safeText(textLabel) || collectText(row);
      if (!text) return null;
      const isOwn = hasClass(row, "IsSelf") || !!findClass(row, LOCAL_CLIENT_ID);
      // HUD 顶栏轮盘行的结构标记是 PingStyleIcon(+SubjectIcon/CooldownTimer/ResponseHeroes),
      // 不带 Ping class/PingLabel(2026-10-02 exp6738 实车 dump 实锤)——
      // 漏掉它会让 HUD 侧快捷语音 100% 退化为模板匹配,游戏改名即翻车(26 红的病因面)
      const result = { sender: UNKNOWN_NAME, channel: "hud", text: text, isOwn: isOwn, hud: true,
        quick: hasClass(row, "Ping") || !!findChild(row, "PingLabel") || !!findChild(row, "PingStyleIcon") };
      return result;
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
    const result = {
      sender: sender,
      channel: channel,
      text: text,
      isOwn: isOwn,
      quick: quick,
      hero: readHeroFromRow(row),
      heroId: readHeroIdFromRow(row),
      steamid: readSteamIdFromRow(row),
    };
    return result;
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

  // ================= 快捷语音模板匹配(2026-09-17 重构,免正则) =================
  // 快捷语音/轮盘消息网络上传输的是本地化 key+参数,每个客户端用自己的游戏语言渲染(中文玩家看到
  // "我看到 McGinnis",英文玩家看到 "I see McGinnis")—— 官方本地化层就是翻译本身,mod 再翻一遍
  // 都只是劣质重复译文。
  // 旧方案(已废弃的屎山):桥生成 253 条巨型正则 + 客户端硬编码兜底正则 —— 参数转义/量词(叠标点
  // 漏网)/双语覆盖/新模板跟随,每个维度都是漏网面。
  // 新方案:模板 = token 序列(param | fixed);匹配 = 归一化(去空白/小写)后 token 走查:fixed 逐字
  // 命中;param 消费 ≥1 字符且只允许【已知游戏名(英/中)】或【不含 CJK 的短 latin 连串】(防 CJK
  // 通配误杀真人消息);尾部标点先剥(兼容 HUD 叠标点)。语料:桥同步 + 自动生成的
  // lingua_chat_quickchat_fallback.js;参数约束表:lingua_chat_gamenames_fallback.js。
  // 结构化识别(Ping class/PingLabel)仍在 shouldSkip 先行,这里只兜"以 Text 形态渲染的轮盘消息"。
  if (typeof LCT_QUICKCHAT_FALLBACK_TEMPLATES === "undefined") {
    $.Msg("[LCT] quickchat fallback templates missing!");
  }
  if (typeof LCT_GAMENAMES_FALLBACK === "undefined") {
    $.Msg("[LCT] gamenames fallback missing!");
  }
  let QUICKCHAT_TEMPLATES = (typeof LCT_QUICKCHAT_FALLBACK_TEMPLATES !== "undefined" && LCT_QUICKCHAT_FALLBACK_TEMPLATES)
    ? LCT_QUICKCHAT_FALLBACK_TEMPLATES.slice() : [];
  let quickchatSynced = false;

  // @sync-begin core/quickchat_match.js —— 本块(归一化/名表/走查/匹配缓存)与 core 参考实现保持行为同步,
  // tests/client_copy_sync.test.js 逐用例对账;改任何一侧必须同步另一侧并重跑该测试。
  // 归一化:小写 + 去所有空白(游戏渲染空格不稳定,"小 心"/"小心！X 有Y")
  function __qcNorm(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, "");
  }

  let QC_NAME_SORTED = null; // 长度降序归一化名表(惰性构建)
  function __qcBuildNames() {
    const src = (typeof LCT_GAMENAMES_FALLBACK !== "undefined" && LCT_GAMENAMES_FALLBACK) ? LCT_GAMENAMES_FALLBACK : [];
    QC_NAME_SORTED = [];
    for (let i = 0; i < src.length; i++) QC_NAME_SORTED.push(__qcNorm(src[i]));
    QC_NAME_SORTED.sort(function (a, b) { return b.length - a.length; });
  }
  function __qcNameLenAt(msg, pos) {
    if (QC_NAME_SORTED === null) __qcBuildNames();
    for (let i = 0; i < QC_NAME_SORTED.length; i++) {
      if (msg.startsWith(QC_NAME_SORTED[i], pos)) return QC_NAME_SORTED[i].length;
    }
    return 0;
  }
  function __qcHasCJK(s) {
    return /[\u3400-\u4dbf\u4e00-\u9fff]/.test(s);
  }

  // 模板 token 化: [{p:true}] | [{p:false, v:归一化固定段}]
  function __qcTplTokens(tpl) {
    const parts = String(tpl || "").split(/(\{[sd]:[a-zA-Z0-9_]+\})/);
    const tokens = [];
    for (let i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      if (/^\{[sd]:[a-zA-Z0-9_]+\}$/.test(parts[i])) tokens.push({ p: true });
      else {
        const v = __qcNorm(parts[i]);
        if (v) tokens.push({ p: false, v: v });
      }
    }
    return tokens;
  }

  // 匹配缓存(2026-09-17 评审):同一条文本在 HUD 顶栏与左下聊天栏各渲染一行,shouldSkip 各调一次
  // matchesQuickTemplate——token 走查(双语全量模板)每通道各做一遍。缓存按【走查自身归一化形式】
  // 记忆结果(非 makeTextKey:不依赖目标语言,且剥尾后 "Venator不见了"/"Venator不见了！！！" 同键),
  // 双通道 skip 判定同源;上限 500 防长会话膨胀(缓存只省走查,清空不影响正确性)。
  // 语料整体替换(桥同步)时必须清空——见 adoptQuickChatTemplates。
  let QC_MATCH_CACHE = new Map();
  const QC_MATCH_CACHE_LIMIT = 500;

  function matchesQuickTemplate(text) {
    const msg0 = String(text || "").trim();
    if (!msg0 || QUICKCHAT_TEMPLATES.length === 0) return false;
    const msg = __qcNorm(msg0.replace(/[\s!！?？.。…⋯~〜]+$/g, "")); // 剥尾部标点(叠标点兼容)后归一化
    if (!msg) return false;
    const cached = QC_MATCH_CACHE.get(msg);
    if (cached !== undefined) return cached; // 双通道同文本:第二通道直接命中,不再走查

    for (let ti = 0; ti < QUICKCHAT_TEMPLATES.length; ti++) {
      const tokens = __qcTplTokens(QUICKCHAT_TEMPLATES[ti]);
      if (tokens.length === 0) continue;
      if (tokens.length === 1 && !tokens[0].p) {
        if (msg === tokens[0].v) return true; // 纯固定模板:整句相等
        continue;
      }
      // token 走查(param 在下一 fixed 锚点处停靠)
      let pos = 0;
      let ok = true;
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (!tok.p) {
          if (!msg.startsWith(tok.v, pos)) { ok = false; break; }
          pos += tok.v.length;
        } else {
          const rest = msg.length - pos;
          const isLast = i === tokens.length - 1;
          if (isLast) {
            if (rest < 1) { ok = false; break; }
            // 末尾 param:已知游戏名 或 整段 latin 连串(防任意 CJK 通配误杀)
            if (__qcNameLenAt(msg, pos) > 0 || !__qcHasCJK(msg.slice(pos))) {
              pos = msg.length;
            } else { ok = false; break; }
          } else {
            // 中间 param:在下一 fixed 锚点处停靠(从 pos+1 起,保证 ≥1 字符)
            const nextFixed = tokens[i + 1].p ? null : tokens[i + 1].v;
            if (!nextFixed) { ok = false; break; } // 连续 param(结构键,生成侧已剔除)
            let found = -1;
            let search = pos + 1;
            while (true) {
              const idx = msg.indexOf(nextFixed, search);
              if (idx < 0) { ok = false; break; }
              // 参数段 = msg[pos..idx):已知名字 或 不含 CJK 的短 latin 连串(≤24;
              // norm 粘接后 latin 段无法与固定段分开,如 "restorativelocket"+"isoncooldownfor")
              const segLen = idx - pos;
              const segVal = msg.slice(pos, idx);
              const latinRun = segLen >= 1 && segLen <= 24 && !__qcHasCJK(segVal);
              if (segLen >= 1 && (__qcNameLenAt(msg, pos) === segLen || latinRun)) {
                found = idx;
                break;
              }
              search = idx + 1; // 该锚点不合适,继续找下一处
            }
            if (!ok || found < 0) { ok = false; break; }
            pos = found;
          }
        }
      }
      if (!ok) continue;
      if (pos !== msg.length) continue; // 必须恰好走完整条消息
      if (QC_MATCH_CACHE.size >= QC_MATCH_CACHE_LIMIT) QC_MATCH_CACHE.clear();
      QC_MATCH_CACHE.set(msg, true);
      return true;
    }
    if (QC_MATCH_CACHE.size >= QC_MATCH_CACHE_LIMIT) QC_MATCH_CACHE.clear();
    QC_MATCH_CACHE.set(msg, false);
    return false;
  }

  function isQuickChatTemplate(text) {
    return matchesQuickTemplate(text);
  }
  // @sync-end core/quickchat_match.js

  // 从桥拉取快捷语音模板(/api/v1/quickchat,v3 原始模板数组)。
  // 握手裁决(内容指纹;与 core/quickchat_sync.js evaluateQuickChatSync 同源,改一处必查另一处):
  //   ① 桥不可达/响应无效 → 保留兜底,告警一次(离线是常态,不刷屏);
  //   ② 桥指纹 === 兑底指纹 → 采纳(标记 synced);
  //   ③ 指纹缺失(旧桥/旧兑底)或不一致 → 重拉一次确认(防瞬时/截断响应误判);
  //   ④ 重拉后仍不一致 → 采纳桥语料(桥从本机游戏文件实时生成,是更新的一方) + 告警一次(兑底过期)。
  // 语料采纳后必须清空匹配缓存,否则旧判定残留(模板已换、判定还是旧的)。
  const QC_SYNC_STATE = { reloadTried: false, warnedOffline: false, warnedMismatch: false };
  // 兑底指纹:生成器写入 lingua_chat_quickchat_fallback.js 的全局(旧兑底文件无 → null,握手按指纹缺失路径走)
  // 客户端不重算指纹(无 FNV 代码):兑底指纹由生成器写入全局变量,桥侧指纹来自响应,这里只做比对。
  // (曾有的 count 字段已删:裁决只看指纹,count 从未被读——死字段)
  const QC_LOCAL_META = {
    fingerprint: (typeof LCT_QUICKCHAT_FALLBACK_FINGERPRINT === "string") ? LCT_QUICKCHAT_FALLBACK_FINGERPRINT : null,
  };

  function adoptQuickChatTemplates(templates, note) {
    QUICKCHAT_TEMPLATES = templates;
    quickchatSynced = true;
    QC_MATCH_CACHE.clear(); // 语料换了,旧匹配结果全部作废
    log("quickchat templates " + note + ": " + templates.length);
  }

  // @sync core/quickchat_sync.js —— evaluateQuickChatSync 客户端同步副本(客户端无法 require,同 matchesQuickTemplate 先例;tests/client_copy_sync.test.js 对账)
  function evaluateQuickChatSync(res, local, st) {
    const s = {
      reloadTried: !!(st && st.reloadTried),
      warnedOffline: !!(st && st.warnedOffline),
      warnedMismatch: !!(st && st.warnedMismatch),
    };
    const out = { adopt: null, synced: false, reload: false, warn: null, state: s };
    const valid = res && res.ok && Array.isArray(res.templates) && res.templates.length > 0;
    if (!valid) {
      if (!s.warnedOffline) {
        out.warn = "quickchat: 桥不可达/响应无效,保留兑底语料";
        s.warnedOffline = true;
      }
      return out;
    }
    const fpSame = !!(res.fingerprint && local && local.fingerprint && res.fingerprint === local.fingerprint);
    if (fpSame) {
      out.adopt = res.templates;
      out.synced = true;
      return out;
    }
    if (!s.reloadTried) {
      s.reloadTried = true;
      out.reload = true;
      return out;
    }
    out.adopt = res.templates;
    out.synced = true;
    if (!s.warnedMismatch) {
      out.warn = "quickchat: 桥侧语料与兑底指纹不一致,已采用桥侧语料(兑底过期:重跑 node core/quickchat.js 并重编 VPK)";
      s.warnedMismatch = true;
    }
    return out;
  }

  // btipc07:语料同步改走两段式(op=config 的 get=quickchat)——
  //   ① 握手只报兜底指纹,桥回 same=1 就一条数据都不传(常态:打包内烘焙值与桥同源);
  //   ② 不同才按 off/lim 分片拉,收齐(done)才解析,天然免疫截断 → 不再需要
  //      evaluateQuickChatSync 里"重拉一次确认"的那条路径(见下方 reloadTried 注释)。
  function syncQuickChat(callback) {
    if (State.quickchatTries >= SYNC_MAX_TRIES) { if (callback) callback(); return; }
    State.quickchatTries = (State.quickchatTries || 0) + 1;
    syncViaBtipc(
      "quickchat",
      QC_LOCAL_META.fingerprint,
      function (res) {
        // 指纹一致 = 内容逐字相同,标记 synced 即可(无需 adopt,缓存本就是同一份语料)
        quickchatSynced = true;
        // 同上:零传输成功必须留痕,否则验收时无从判断握手真的走了 same 分支
        log("quickchat sync: fingerprint match, no transfer (" +
          ((res && res.count) || QUICKCHAT_TEMPLATES.length) + " templates)");
        return true;
      },
      function (text) {
        let data = null;
        try { data = JSON.parse(text); } catch (e) { data = null; }
        if (!data || typeof data !== "object") return false;
        if (data.delta) {
          // 增量:按增删改就地施加(目标是绝对值,重复施加幂等)
          const removed = data.removed || [];
          let list = QUICKCHAT_TEMPLATES.map(String).filter(function (t) { return removed.indexOf(t) < 0; });
          const added = data.added || [];
          for (let i = 0; i < added.length; i++) {
            const a = String(added[i]);
            if (list.indexOf(a) < 0) list.push(a);
          }
          if (!list.length) return false;
          if (data.fingerprint) QC_LOCAL_META.fingerprint = data.fingerprint;
          adoptQuickChatTemplates(list, "delta applied from bridge");
          return true;
        }
        if (!Array.isArray(data.templates) || !data.templates.length) return false;
        // 分片协议已保证收齐,不再走"重拉一次"那条分支 → 直接按首次即终局裁决
        QC_SYNC_STATE.reloadTried = true;
        const verdict = evaluateQuickChatSync(data, QC_LOCAL_META, QC_SYNC_STATE);
        if (!verdict.adopt) return false;
        adoptQuickChatTemplates(verdict.adopt, verdict.synced ? "synced from bridge" : "synced from bridge (fingerprint mismatch, fallback stale)");
        if (data.fingerprint) QC_LOCAL_META.fingerprint = data.fingerprint;
        if (verdict.warn) log("WARN: " + verdict.warn);
        return true;
      },
      function () { if (callback) callback(); }
    );
  }

  // 剥掉中文+标点/数字/空格后剩下的拉丁字母 = 消息里真正非中文的部分
  // (游戏专名如 McGinnis 也留在残余里,由占位/还原链路负责中文化)
  function leftoverEnglish(text) {
    let s = String(text || "");
    s = s.replace(/[\u3400-\u4dbf\u4e00-\u9fff]+/g, " ");
    s = s.replace(/[\d\s\W_]+/g, " ");
    return s.trim();
  }

  // 混合消息(中文+少量英文,典型:开启"英文英雄名"后的快捷语音渲染结果,如 "我看到 McGinnis")
  // 返回需送去翻译的非中文片段;纯中文返回空串;纯英文返回 null(整句照旧翻译)。
  function mixedFragment(text) {
    const s = String(text || "");
    if (!CJK_RE.test(s)) return null; // 没有中文 → 整句翻译
    return leftoverEnglish(s);
  }

  // 拼装混合消息的最终显示文本: 中文部分原样保留, 译文替换非中文片段.
  // 恰好一段英文 → 原位替换 (常见: 快捷语音 "我看到 McGinnis"); 多段英文 (罕见) → 中文连排+译文.
  function assembleMixedTranslation(originalText, fragmentTranslation) {
    const frag = String(fragmentTranslation || "").trim();
    const orig = String(originalText || "");
    if (!frag) return orig;
    const segs = orig.split(/([\u3400-\u4dbf\u4e00-\u9fff]+)/); // 捕获组: 偶数下标=非中文段, 奇数=中文段
    let latinCount = 0;
    let lastLatin = -1;
    for (let i = 0; i < segs.length; i += 2) {
      if (segs[i] && /[A-Za-z]/.test(segs[i])) { latinCount += 1; lastLatin = i; }
    }
    if (latinCount === 1) {
      segs[lastLatin] = " " + frag + " ";
      return segs.join("").replace(/\s+/g, " ").trim();
    }
    let chinese = "";
    for (let i = 1; i < segs.length; i += 2) chinese += segs[i];
    return (chinese + " " + frag).replace(/\s+/g, " ").trim();
  }

  function shouldSkip(record) {
    const text = record.text;
    if (!text || text.length < 2) return true;
    // 总开关:关掉后**收发都不翻译**(2026-10-20 实测:网页把"启用翻译"关掉后,
    // 收到的消息照样被翻译 —— 这个开关历来只管发送前翻译,面板上的标签却是"启用翻译",
    // 语义对不上,用户以为没生效)。只认显式 false(缺省按开)。
    if (State.cfg.enabled === false) return true;
    if (record.quick) {
      // 游戏原生快捷短语/Ping 已由游戏本地化,不调用翻译接口。
      // 2026-10-28 起收紧:DOM 标记(Ping/PingLabel/PingStyleIcon)不再单独定生死——当日游戏更新后
      // 实测聊天框行与 HUD 行全部误命中 Ping 标记(手打英文长句 "u have 7k on me…" 也标 quick),
      // 全场零翻译。改为:仅当文本命中轮盘模板库(参数填空已支持)或已为目标语言才跳过。
      const textLocalized = isQuickChatTemplate(text) || (!State.cfg.force && isTargetLanguageText(text));
      if (textLocalized) return true;
      // 标记存疑(既非已知轮盘语料、也不是目标语言)→ 落到下面的正常判定,照常翻译
    }
    if (isQuickChatTemplate(text)) return true; // 本地化模板白名单:快捷语音渲染结果(含参数填空),精确命中即跳过
    if (text.charAt(0) === "/") return true; // 指令消息
    if (/^[\d\s\W_]+$/.test(text)) return true; // 纯数字/符号
    if (record.isOwn && State.cfg.translateOwn === false) return true; // 可配置:默认翻译自己的消息
    if (!State.cfg.force && isTargetLanguageText(text)) return true; // 已为目标语言
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

function injectTranslation(row, sig, text, fragment) {
    if (!isValid(row)) return;
    const hud = isHudRow(row);
    const lobby = isLobbyRow(row);
    // 混合消息(只翻译了片段):原文含中文部分,必须保持可见
    const isMixed = fragment !== null && fragment !== undefined;
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
    // 只显示译文模式:隐藏原文。混合消息不折叠(原文含未翻译的中文部分,折叠会让内容消失)
    // HUD 顶栏行/大厅行不折叠:气泡本身短暂显示,折叠会连译文一起隐藏
    if (!isMixed && !hud && !lobby && State.cfg.displayMode === "translation_only") {
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

  // 滚动回收重建:已翻译过的行重新出现时,从缓存恢复译文(缓存按 textKey 归一化键存取)
  function restoreFromCache(row, sig, textKey) {
    const cached = State.cache.get(textKey);
    if (!cached) return false;
    if (getTransLabel(row, sig)) return true;
    injectTranslation(row, sig, cached.translation, cached.fragment);
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

  // 归一化文本键:同一句话(顶栏 HUD 行与左下聊天行两处渲染)共享同一翻译任务与缓存。
  // key = 占位替换后的请求文本(_transText 或整句)+ 目标语言;同原文 → 同占位串 → 必然同键。
  // sig(channel+sender+text)保留不动,继续负责行级去重与回收复用判定。
  function makeTextKey(record) {
    return String(record._transText || record.text || "") + "\x00" + targetLanguage();
  }

  function enqueue(row, sig, record, mixedFrag) {
    // 混合消息:任务里的 record 用浅拷贝,只把待译片段当作 text(完整原文挂在 mixedFullText)
    const jobRecord = mixedFrag === null
      ? record
      : Object.assign({}, record, { text: record._transText || record.text });
    const job = {
      kind: "chat", row: row, sig: sig, record: jobRecord, attempts: 0,
      nameMap: record._nameMap || null, zhNameMap: record._zhNameMap || null,
      mixedFullText: mixedFrag === null ? null : (record.text || null),
    };
    // in-flight 合并:同 textKey 只发一次桥请求,结果回来扇出注入所有同文行
    // (两行常在同一轮询周期被扫到,此处把合并窗口提前到入队那一刻;跨轮询窗口由 textKey 缓存兜住)
    const textKey = makeTextKey(record);
    const existing = State.inflight.get(textKey);
    if (existing) {
      existing.rows.push({ row: row, sig: sig });
      return;
    }
    const group = { key: textKey, rows: [{ row: row, sig: sig }], settled: false };
    State.inflight.set(textKey, group);
    job.group = group;
    State.queue.push(job);
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
    let sendText = _ng.nameMap ? _ng.text : text;
    // 双向:出站也保护中文游戏名(中文玩家→英文玩家场景)
    let outgoingZhNameMap = null;
    const _outTgt = resolveOutgoingTarget();
    if (!_outTgt.toLowerCase().startsWith("zh")) {
      const _zg = replaceChineseGameNames(sendText, ZH_TO_EN);
      if (_zg.zhNameMap) { sendText = _zg.text; outgoingZhNameMap = _zg.zhNameMap; }
    }
    State.queue.push({ kind: "outgoing", row: null, sig: null, record: { text: sendText }, attempts: 0, done: once, enqueuedAt: nowMs(), nameMap: _ng.nameMap || null, zhNameMap: outgoingZhNameMap, originalText: text });
    // 队列等待死线(2026-10-28):排队超 15s 仍未派发(如单槽被长占用)直接按原文发送。
    // 旧检查点在 dispatchJob 开头——排着队永远轮不到 dispatch,检查形同虚设(10-28 上午 gg 全灭的成因之一)。
    const queuedJob = State.queue[State.queue.length - 1];
    const queueDeadline = nowMs() + 15000;
    const queueWatch = function () {
      const idx = State.queue.indexOf(queuedJob);
      if (idx === -1) return; // 已被派发或移除,dispatchJob 的超时接手
      if (nowMs() < queueDeadline) { try { $.Schedule(1.0, queueWatch); } catch (eQ) {} return; }
      const i2 = State.queue.indexOf(queuedJob);
      if (i2 !== -1) { State.queue.splice(i2, 1); log("outgoing: queued >15s (slot starved), sending original"); once(null, null); }
    };
    try { $.Schedule(1.0, queueWatch); } catch (eQ) {}
    pumpQueue();
  }

  function enqueueBridge(op, data, done, isRead) {
    // read:btipc07 的 get 请求应答可能比分片还大(全量语料),必须走 50s 读死线
    // 而不是写死线 8s,否则首发起跑竞态一烧就超时(同 op=config 读的老坑)。
    // _cfgPoll:配置监听轮询 —— 失败不计入 https 通道判死(见 demoteToBtipc)。
    // 标记走 State.cfgPollNext 而不是加形参:bridgePost/enqueueBridge 的签名被
    // lc_btipc07_guard 钉死(信封折叠语义),不能改形状。
    State.queue.push({
      kind: "bridge", op: op, data: data, row: null, sig: null, attempts: 0,
      done: done, read: !!isRead, _cfgPoll: !!State.cfgPollNext
    });
    State.cfgPollNext = false;
    pumpQueue();
  }

  function pumpQueue() {
    while (State.queue.length > 0 && State.activeRequests < MAX_ACTIVE_REQUESTS) {
      const job = State.queue.shift();
      State.activeRequests += 1;
      // 2026-10-04 实车:pumpQueue:1928 抛过一次 —— 错误消息为空、栈里没有
      // dispatchJob 帧(= 抛在调用点本身)。此刻槽位已 +1,而 dispatchJob 自己的收尾
      // (finishJob / failJob,内含「减槽 + 重泵」)一次都没跑到。MAX_ACTIVE_REQUESTS=1
      // 是单槽 → 槽位永久占死 → while 条件永假 → 出站队列从此不再派发任何任务。
      // 实证:11:26:25 抛一次,此后 bridge.log 再无 op=config / op=translate /
      // target=(只剩 echo——走 btipcSend 不经本队列——GC、IMG-HIT);console.log 里
      // `loaded v` 只出现 1 次 → 脚本没重载过、State 没重建,槽位一直没还回来。
      // 铁律:dispatchJob 的任何同步异常都必须在这里补记账,绝不允许泄漏槽位。
      let _threw = null;
      try {
        dispatchJob(job);
      } catch (e) {
        _threw = e;
      }
      if (_threw) {
        State.activeRequests = Math.max(0, State.activeRequests - 1);
        const _err = String((_threw && (_threw.message || _threw.name)) || _threw || "unknown").slice(0, 200);
        job.attempts = (job.attempts || 0) + 1;
        log("dispatchJob threw: " + _err + " kind=" + job.kind +
            (job.op ? " op=" + job.op : "") + " attempts=" + job.attempts);
        if (job.attempts < RETRY_LIMIT) {
          // 重投用延迟泵,不原地自旋(原因见下方 btipc05c 注释)
          State.queue.unshift(job);
          $.Schedule(RETRY_DELAY_SECONDS, pumpQueue);
        } else {
          // 结算后丢弃:出站按原文发(绝不吞用户消息),桥回 {ok:false},chat 放开去重
          log("dropping job after " + job.attempts + " dispatch throws: kind=" + job.kind +
              (job.op ? " op=" + job.op : ""));
          try {
            if (job.kind === "outgoing") {
              job.done(null, null);
            } else if (job.kind === "bridge" && typeof job.done === "function") {
              job.done({ ok: false, error: "dispatch_threw:" + _err.slice(0, 80) });
            } else if (job.kind === "chat" && job.sig) {
              try { State.seen.delete(job.sig); } catch (e2) {}
              // 与 doneFail 同因:只放开 seen 不够,inflight 僵尸组会让同文本永远不再翻译
              if (job.group && !job.group.settled) {
                try { deliverError(job.group, "dispatch_threw"); }
                catch (e5) {
                  try { job.group.settled = true; } catch (e6) {}
                  try { if (State.inflight.get(job.group.key) === job.group) State.inflight.delete(job.group.key); } catch (e7) {}
                }
              }
            }
          } catch (e3) {
            log("settlement threw: " + String((e3 && (e3.message || e3)) || e3).slice(0, 120));
          }
        }
        break;
      }
      // btipc05c:dispatchJob 若走了「让位重投」(job 已 unshift 回队首、activeRequests
      // 已减回),必须立刻退出循环 —— 否则 while 会把同一个 job 再 shift 出来原地自旋,
      // 把重投次数在 <1ms 内打满并挂上等量的 $.Schedule(0.5) 延迟泵(注释 L2310 说的
      // 「原地自旋把次数打满」就是它)。实车 btipc05b 一局刷出 requeue 洪水
      // (单秒 74 行 × 多次爆发)→ console.log 涌塞 → 桥 tail 追不上(回声 REQ 迟
      // 7~24s 才被处理)→ 8s 回声死线内收不到 → CRC 风暴 + bridge offline;
      // 同指标在 btipc05 上一局为 0。
      if (job._btipcDeferred) {
        job._btipcDeferred = false;
        break;
      }
    }
  }

  // 面板导航基址:https 面板通道被探针判活后用 https,否则维持 http(旧面板兜底路径原样保留)。
  // 走 localhost 而非 127.0.0.1 是因为证书 SAN 两条都有,但 localhost 正是引擎自带的
  // 受信主机名口径(引擎自己的 WebKit 对 localhost 另有处理),少一个变量。
  // forceHttp=true 用于"https 不可用而 BTIPC 又恰好接不下"的那次兜底 —— 那时宁可慢,
  // 也不能把原文直接发出去。
  function panelBaseUrl(forceHttp) {
    if (!forceHttp && State.httpsPanelOk === true) {
      return "https://" + HTTPS_PANEL_HOST + ":" + HTTPS_PANEL_PORT;
    }
    return "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT;
  }

  function buildBridgeUrl(job, forceHttp) {
    const id = "r" + (++State.requestSeq).toString(36);
    job.id = id;
    const base = panelBaseUrl(forceHttp);
    if (job.kind === "bridge") {
      return (
        base +
        "/bridge?id=" + id +
        "&op=" + job.op +
        "&lang=" + gameUiLang() +
        "&d=" + job.data
      );
    }
    const text = encodeURIComponent(job.record.text);
    const source = encodeURIComponent("auto");
    const target = encodeURIComponent(job.kind === "outgoing" ? resolveOutgoingTarget() : targetLanguage());
    const tm = job.kind === "outgoing" ? OUTGOING_TIMEOUT_MS : (State.cfg.timeoutMs || 15000);
    return (
      base +
      "/bridge?id=" + id +
      "&op=translate&text=" + text +
      "&source=" + source +
      "&target=" + target +
      "&lang=" + gameUiLang() +
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
      if (job._timeout) { cancelSched(job._timeout); job._timeout = null; }
      if (payload && payload.ok && payload.translation) {
        // 还原占位符(英雄/物品名)
        let translation = job.nameMap ? restoreGameNames(payload.translation, job.nameMap) : payload.translation;
      // 双向:还原中文名占位符
      if (job.zhNameMap) translation = restoreChineseGameNames(translation, job.zhNameMap);
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
    State.canHttpLastProbe = nowMs();
    log("bridge transport: AsyncWebRequest " + (ok ? "available (direct)" : "removed/unavailable, using HTML panel channel"));
    return ok;
  }

  // 直连通道的传输层错误(引擎移除 API / 同步异常):换成 HTML 面板通道重试才有意义;
  // 桥未启动/超时等业务性失败不算,继续走直连即可。
  function isTransportError(err) {
    const s = String(err || "");
    return s === "http_exception" || s === "no_asyncwebrequest" || s.indexOf("removed") !== -1;
  }

  // 面板通道是否处于"判死冷却"中:冷却内 dispatchViaPanel 直接走 !panel 分支快速失败,
  // 既不再 SetURL 导航,也不再打 `bridge nav failed` 死链日志(此前每 15s 一条刷屏)。
  function panelNavSuppressed() {
    return State.navDeadUntil > nowMs();
  }

  // ===== https 面板通道:失败分类、降级交接、开机探针(2026-10-15)=====
  // 通道级失败分两类,这个区分决定了"该不该重做",是本段代码的全部要点:
  //   硬失败(通道压根没通)—— 页面从未加载(SetURL 被引擎拒:证书未受信 / Steam 没重启)、面板找不到、
  //     导航抛异常、桥离线。请求**从未到达桥**,把 job 原样交回 BTIPC 重做零风险,且不消耗
  //     job.attempts(它不是翻译失败)。
  //   软失败(通道通了但这次没成)—— bridge_timeout / timeout / bad_bridge_payload。页面 alive 且
  //     fetch 已发出,只是慢或解析不了;重做等于把用户已等了 OUTGOING_TIMEOUT_MS 的出站请求再拖
  //     3~27s(BTIPC 位泵),所以**不重做**:交回 handleBridgePayload 按既有语义结算(出站发原文)。
  const PANEL_HARD_FAIL = {
    bridge_nav_failed: 1,
    bridge_offline: 1,
    bridge_load_failed: 1,
    bridge_panel_unavailable: 1,
  };
  // 钩子统一入口:把 try/catch 与日志挡在调用方的热路径之外。
  // 为什么必须这样:dispatchViaPanel 的「!panel 快速失败」分支有一条护栏
  // (lc_panel_nav_guard「冷却内快速失败不打日志」)断言该分支内零 log —— 那条分支
  // 每 15s 就可能走一次,里面任何 log 都会变成死链刷屏。钩子里已经要打日志,
  // 所以不能让调用点出现 log 字样。
  function handOff(hooks, payload) {
    if (!hooks || typeof hooks.onHardFail !== "function") return false;
    try {
      return hooks.onHardFail(payload) === true;
    } catch (e) {
      log("https panel fallback threw: " + expErr(e));
      return false;
    }
  }

  function isPanelHardFail(payload) {
    if (!payload || payload.ok) return false;
    return PANEL_HARD_FAIL[String(payload.error || "")] === 1;
  }

  // 这条 job 是否归 https 面板通道管。
  // 只接管两条翻译路径(outgoing/chat)—— 它们才是延迟的来源;config/test/log 三个 op
  // 留在原路(BTIPC 已稳定可用),不拿它们的可用性去冒险。
  function httpsPanelTakes(job) {
    if (!HTTPS_PANEL_ENABLED) return false;
    if (State.httpsPanelOk !== true) return false;
    if (State.probePending) return false; // 探针在途:面板单客户,新 job 这一条走 BTIPC(下次自动回 https)
    if (job.kind === "outgoing" || job.kind === "chat") return true;
    // 2026-10-15 起 op=save/test/log/读 全接进本通道,根因同一:大载荷 vs 位泵 10B/帧(保存 600B≈38s>8s 死线必炸)。
    // 通道判死时全部原样交回 BTIPC。
    if (job.kind === "bridge") return true;
    return false;
  }

  // https 面板通道失败 → 把 job 原样交回 BTIPC。返回 true = 已被接走(调用方不要再结算)。
  // 交接前必须先撤掉面板路径挂的出站超时句柄,否则它稍后触发会二次 job.done/finishJob,
  // 把 MAX_ACTIVE_REQUESTS=1 的槽位超发(这正是 0.1.3 那个"发中文卡死"事故的同款机制)。
  function demoteToBtipc(job) {
    try {
      if (job._timeout) { cancelSched(job._timeout); job._timeout = null; }
      // 已超时的出站 job 不再交接:用户已经等到了兜底时刻,再拖 3~27s 是净损失。
      if (job._timedOut) return false;
    } catch (e) {
      log("https panel demote: timer cleanup threw " + expErr(e));
    }
    // 配置轮询的失败不算通道病(频率是翻译百倍,一次抖动不该降级整个会话):这轮直接失败,不交接 BTIPC。
    if (job && job._cfgPoll) {
      log("cfg watch: poll failed on https panel, skipping this round");
      return false;
    }
    State.httpsPanelStreak += 1;
    if (State.httpsPanelStreak < HTTPS_PANEL_DEAD_STREAK) {
      log("https panel: hard fail #" + State.httpsPanelStreak + "/" + HTTPS_PANEL_DEAD_STREAK +
        ", handing this job back to BTIPC");
      return handToBtipc(job);
    }
    // 连击到线:本会话退 BTIPC。打上硬判死标记(重探是白撞);游戏内只告警一次。
    State.httpsPanelOk = false;
    State.httpsPanelHardDead = true;
    if (!State.httpsPanelDemotedLogged) {
      State.httpsPanelDemotedLogged = true;
      log("https panel: dead (" + State.httpsPanelStreak + " consecutive hard fails) — " +
        "falling back to BTIPC for the rest of this session. If this repeats every session, run " +
        "scripts\\gen_bridge_cert.ps1 -Trust and FULLY restart Steam (restarting the game alone is not enough).");
    }
    return handToBtipc(job);
  }

  // 交给 BTIPC。outgoingViaBtipc 返回 false 表示 BTIPC 也接不了(busy/too_long/目标语言不安全),
  // 那就退回**http** 旧面板通道(与 6726 以来同款兜底):宁可慢,也不能把原文直接发出去。
  // 注意 attempts 在两段之间已先退回,这里失败不再额外扣。
  function handToBtipc(job) {
    let taken = false;
    try {
      taken = outgoingViaBtipc(job);
    } catch (e) {
      log("https panel demote: outgoingViaBtipc threw " + expErr(e));
      taken = false;
    }
    if (taken) return true;
    // BTIPC 明确接不了(busy/too_long/目标语言不安全)。attempts 不动 —— job 是从队列
    // 刚取出来的(attempts=0),后面交给 handleBridgePayload 按原语义重试。
    try {
      log("https panel demote: BTIPC declined (busy/too_long) — retrying on the http panel channel");
      dispatchViaPanel(job, null, true);
      return true;
    } catch (e2) {
      log("https panel demote: http panel retry threw " + expErr(e2));
      return false;
    }
  }

  // 探针(独立槽):与 State.pending 并行,等的是不同引擎 I/O(CEF nav vs BTIPC 帧传递),无争用。
  function settleProbe(ok, err) {
    const probe = State.probePending;
    State.probePending = null;
    State.httpsPanelStreak = 0;
    State.httpsPanelOk = ok;
    if (ok) {
      State.httpsPanelHardDead = false;
      log("https panel: ALIVE (https://" + HTTPS_PANEL_HOST + ":" + HTTPS_PANEL_PORT +
        ") — translations now take one RTT instead of the BTIPC bit pump");
    } else {
      State.probeLastAt = nowMs();
      log("https panel: not usable (" + err + ") — on BTIPC; auto re-probe every " +
        Math.round(HTTPS_PANEL_REPROBE_MS / 60000) + "min, success restores https without restart");
    }
  }

  function startHttpsProbe() {
    if (!HTTPS_PANEL_ENABLED || State.probePending) return;
    const panel = ensurePanel();
    if (!isValid(panel) || typeof panel.SetURL !== "function") {
      State.httpsPanelOk = false;
      State.probeLastAt = nowMs();
      log("https panel: no usable HTML panel declared in chat.xml — staying on BTIPC");
      return;
    }
    ensureBridgeEvents();
    // 顺序要紧:probePending 先落再启动轮询,否则 pollTitle 撞空槽提前停摆。
    State.probePending = { sawAlive: false, navRetried: false, startedAt: nowMs(), navUrl: null };
    startTitlePolling();
    try { panel.visible = true; } catch (e) {}
    const probeUrl = "https://" + HTTPS_PANEL_HOST + ":" + HTTPS_PANEL_PORT +
      "/bridge?op=health&id=probe&lang=" + gameUiLang();
    State.probePending.navUrl = probeUrl;
    try {
      panel.SetURL(probeUrl);
      log("https panel: probing " + probeUrl);
    } catch (e) {
      settleProbe(false, "seturl_threw(" + expErr(e) + ")");
    }
  }

  // 开机首探 + 判死后重探统一入口(主循环每拍调用,按状态节流)
  function maybeProbeHttpsPanel() {
    if (!HTTPS_PANEL_ENABLED || State.probePending) return;
    if (State.pending || State.httpsPanelOk === true) return; // 互斥:探针只占空闲面板;通道健康则无事
    if (State.httpsPanelHardDead) return; // 运行时连击硬判死(证书级故障嫌疑):重探是白撞,保持 BTIPC
    if (State.httpsPanelOk === false && nowMs() - State.probeLastAt < HTTPS_PANEL_REPROBE_MS) return;
    State.probeLastAt = nowMs();
    startHttpsProbe();
  }

  // HTML 面板通道:SetURL 导航 /bridge 页面,轮询 document.title 读回
  // (AsyncWebRequest 被移除的游戏版本唯一可用通道;DLCT 同款机制)
  // hooks 可选: { onHardFail(payload) -> true } 表示"这条我接走了,别再结算"。
  // https 面板通道用它把通道级失败交回 BTIPC;不传就是 6726 以来的原样行为。
  function dispatchViaPanel(job, hooks, forceHttp) {
    // 冷却期(navDeadUntil)是 **http 面板通道**的判死结论,只该压制 http 导航。
  // https 面板通道必须绕开它:引擎先过证书校验、再谈加载,两者判死条件互不相干;
  // 而 config/test/log 这三个 op 至今仍走 http 面板,它们在当前 build 上必然连撞
  // src="" 而把 http 通道打进冷却 —— 若不绕开,一次 http 判死就会顺手把**能用的**
  // https 通道一起压掉 10 分钟,而且症状极隐蔽(日志里只有 http 的死链记录)。
  const navSuppressedFor = (hooks) => (hooks && hooks.httpsChannel ? false : panelNavSuppressed());
  const panel = navSuppressedFor(hooks) ? null : ensurePanel();
    if (!isValid(panel) || typeof panel.SetURL !== "function") {
      // 通道压根不可用:若上层(https 面板通道)声明要接管这种失败,交出去走 BTIPC。
      // 注意这里只能调 handOff:内联的 try/catch 或日志字样都会破坏上面那条护栏
      // (它是按源码文本扫这个分支的,注释里写出来也算数)。
      if (handOff(hooks, { ok: false, error: "bridge_panel_unavailable" })) return;
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
    // EXP-6726b:疑似新引擎不为“不可见/非激活”面板加载网页(诊断 act=0 且页面从未加载)。
    // 导航前把面板置为可见 + 尝试激活;首次成功后保持(不反复切换)。
    try { panel.visible = true; } catch (e) {}
    try { panel.style.opacity = "1"; } catch (e) {}
    if (!State.panelActivated) {
      State.panelActivated = true;
      try { if (typeof panel.Activate === "function") panel.Activate(); } catch (e) {}
      try { if (typeof panel.SetFocus === "function") panel.SetFocus(); } catch (e) {}
      try { panel.RemoveClass("LCTBridgePanel"); panel.AddClass("LCTBridgePanelActive"); } catch (e) {}
      log("diag-activate: panel made visible/active before nav");
      // EXP-6726d/e/f:引擎无异步 HTTP API(AsyncWebRequest 已移除),通道只能是"隐藏面板+title 回程";
      //   Image 面板探针保留作通道旁证(桥日志 IMG-HIT = 通道活)。证据:docs/btipc-https-v1.md
      try {
        const imgUrl = "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/test.png?id=f" + (State.imgProbeCount = (State.imgProbeCount || 0) + 1);
        let imgPanel = null;
        try { imgPanel = findChild(getRoot(), "LCTImgProbe"); } catch (eI0) {}
        if (!isValid(imgPanel)) { try { imgPanel = $.CreatePanel("Image", getRoot(), "LCTImgProbe"); } catch (eI1) {} }
        if (isValid(imgPanel) && typeof imgPanel.SetImage === "function") {
          try { imgPanel.SetImage(imgUrl); } catch (eI3) {}
        }
      } catch (eI) {}
      // EXP-6726h 尺寸回读探针已下线:结论是"不可见面板不参与布局,尺寸信道不通",
      // 与本 mod 的通道设计无关(通道走 HTML 面板 + document.title),留着只刷 30 行日志
      // 且会在左上角闪一个 133x77 黑块。
    }
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
    const url = buildBridgeUrl(job, forceHttp);
    setPending(job.id, function (payload) {
      // 通道级失败(证书未受信/面板死/桥离线)→ 交回 BTIPC 重做,不消耗 attempts。
      // 软失败(bridge_timeout/timeout)不交接:请求已经到桥,重做只是把等待翻倍。
      if (isPanelHardFail(payload) && handOff(hooks, payload)) return;
      handleBridgePayload(job, payload);
    }, job.kind === "outgoing" ? OUTGOING_TIMEOUT_MS : (State.cfg.timeoutMs || 15000));
    // 记住本次导航的 URL:偶发"引擎没加载页面"时要能原地重试一次
    // (见 pollTitle 的 navRetried 分支 —— 重试 1.5s 比降级 BTIPC 的 6.6s 便宜得多)
    try { if (State.pending) State.pending.navUrl = url; } catch (eNU) {}
    // DIAG-6726:记录每次导航目标(去 query 串,避免刷长文本),确认请求确实发出
    State.diagNavCount = (State.diagNavCount || 0) + 1;
    if (State.diagNavCount <= 5 || State.diagNavCount % 20 === 0) {
      // d= 是整份请求 JSON(设置面板保存时含 API Key)。这里按值打码,
      // 不留"靠截断长度保安全"的余量 —— 余量会被字段顺序/服务商名长度的变化吃掉。
      var navQ = String(url.split("?")[1] || "");
      // **必须按参数边界找 d=**(?d= 或 &d=),不能 indexOf("d=") —— 那会命中 "id=" 里的
      // 那个 d=(2026-10-15 实车踩过:日志里出现 "id=<redacted 2B>&op=config&d=%...",
      // id 的值被打码了、真正的 d= 反而没打上,只是碰巧被下面 30 字符截断挡住)。
      // 同一个坑我在 redactUrl 里已经修过一次并写了注释,这里又写了一遍 ——
      // **教训写进注释不等于用上了,复制粘贴自己的代码也要重读一遍。**
      var navM = navQ.match(/[?&]d=/);
      if (navM) {
        var navStart = navM.index + navM[0].length;
        var navCut = navQ.indexOf("&", navStart);
        var navEnd = navCut === -1 ? navQ.length : navCut;
        navQ = navQ.slice(0, navM.index + 1) + "d=<redacted " + (navEnd - navStart) + "B>" +
          (navCut === -1 ? "" : navQ.slice(navCut));
      }
      log("diag-nav #" + State.diagNavCount + " -> " + String(url.split("?")[0] || "") +
        " (q=" + navQ.slice(0, 30) + "...)");
    }
    try {
      panel.SetURL(url);
    } catch (e) {
      State.pending = null;
      log("SetURL failed: " + (e && e.message ? e.message : String(e)));
      if (handOff(hooks, { ok: false, error: "bridge_load_failed" })) return;
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

  // ===== ⑥ 上层整合:出站翻译走 BTIPC(规格 docs/btipc-v1.md §7/§8;checklist §14)=====
  // btipc04 扩展:入站 chat 同路复用 —— chat 发裸文本(桥回退出站外的默认 target=zh-Hans),
  // 出站发信封。函数名保留 outgoing(调用方/日志前缀按 kind 区分:outgoing btipc / chat btipc)。
  // 信封(上层约定,行/帧/窗口协议零改动):payload 首行 "t=<target>;tm=<ms>" + "\n" + 原文。
  // 目标语言必须随请求走:桥 config 的 defaults.targetLanguage 是入站目标(zh-Hans),
  // 出站 outgoingTarget 默认 en,不带就会译反方向。
  // 返回 true = 本 job 由 BTIPC 接管(结算在回调内闭环);false = 回落旧通道(直连/HTML 面板)。
  // 失败语义对齐旧通道(spec §8 + 既有 attempts 策略):响应型失败(桥收到请求但翻译失败,空 END 帧
  // → translate_error)走 handleBridgePayload 重试 ≤1 次;传输型失败(timeout/crc_dead/bridge_down)
  // 按原文发送不重试;busy/too_long/目标语言不安全 → 回落旧通道。

  // ---- 写(以及 log 批)的死线:按上行载荷算,不按固定值 ----
  // 2026-10-15 教训(用户实机「OpenAI 的 API 老是保存不上」):原来写死 8000 是按"写应答 1 帧"定的,
  // **只量了应答,没量请求本身**。位泵耗时几乎全在上行:每帧有效载荷 10B、tClose=600ms、首发起跑
  // 1200ms → 带 Key 的保存载荷 ≈600B = 60 帧 ≈ 37.2s,8s 死线必然 REQ_TIMEOUT → 面板显示「保存失败」。
  // 实测帧耗时吻合(47B=4.2s … 406B=26.1s,误差<0.5%)。所以:按帧数算"物理下限",再叠加余量给 CRC
  // 重试与 STORM 罚时(实测约 +15~20%);小载荷保留 8000 地板(快速失败对小请求仍成立)。
  // 推导与逐条实测见 docs/btipc-v1.md §8。
  function btipcWriteDeadlineMs(payloadBytes) {
    const bytes = Number(payloadBytes) || 0;
    const frames = Math.max(1, Math.ceil(bytes / 10));
    const physical = BTIPC_FIRST_SHOT_DELAY_MS + frames * BTIPC_T_CLOSE_MS;
    return Math.max(8000, Math.round(physical * 1.2));
  }

  function outgoingViaBtipc(job) {
    let tag = "btipc";
    try {
      if (!BTIPC) return false;
      const text = String((job.record && job.record.text) || "");
      // btipc04:入站 chat 也走 BTIPC —— 裸文本(不带信封)→ 桥回退 config 默认
      // target(入站 zh-Hans),不依赖游戏侧从 9/30 起就同步不到的 State.cfg;
      // 出站仍带 t= 信封(target 必须随请求走,否则桥按默认译反方向)。
      const isChat = job.kind === "chat";
      // btipc05:设置面板「保存/测试」+ 开机读配置(op=config/test)同路迁移 ——
      // 旧通道 6726 后必死,这三个操作是用户唯一能直接感知的「面板坏了」。
      const isOp = job.kind === "bridge" && (job.op === "config" || job.op === "test" || job.op === "log");
      tag = isOp ? job.op + " btipc" : (isChat ? "chat btipc" : "outgoing btipc");
      if (BTIPC.busy()) {
        // 旧通道 6726 后已死,忙时不立刻回落:短等重投(≤6 次 ×0.5s / 12s 死线;
        // btipcFinish 的 deadman 必清忙态)。释放槽位但不同步重泵(finishJob 会同步
        // pumpQueue → 原地自旋把次数打满,必须走 $.Schedule 延迟泵)。等不动才回落。
        if (!job._btipcSince) job._btipcSince = nowMs();
        const since = job.enqueuedAt || job._btipcSince;
        const waited = job._btipcWaits || 0;
        // btipc05b:op 不再 12s 就放弃 —— 队头若是一次 24s 的配置读,12s 放弃会
        // 掉进必死旧通道(panel_channel_unavailable 假失败)。op 等满读死线+2s 缓冲;
        // chat/outgoing 维持 12s/6 次(兜底语义不变)。
        // btipc05d:读死线 35s→50s,忙等窗同步 37s→52s(否则 op 等到 37s 就掉旧通道,
        // 前面 50s 白等);52s ÷ 0.5s 泵 = 104 次,与 busyMs 同时到顶,先到者停。
        const busyWaits = isOp ? 104 : 6;
        const busyMs = isOp ? 52000 : 12000;
        if (waited < busyWaits && nowMs() - since < busyMs) {
          job._btipcWaits = waited + 1;
          // btipc05c:让位时置 _btipcDeferred —— pumpQueue 见到就 break,不再原地
          // 自旋重 shift 同一个 job(见 pumpQueue 处注释)。0.5s 延迟泵从此真正生效,
          // op 才是「等 37s」而不是「1ms 内空转打满 74 次」。
          job._btipcDeferred = true;
          State.queue.unshift(job);
          State.activeRequests = Math.max(0, State.activeRequests - 1);
          $.Schedule(0.5, pumpQueue);
          // 只记首行 + 每 10 次:一次 op 最多 8 行,避免把 console.log 刷成洪水
          if (waited === 0 || (waited + 1) % 10 === 0) {
            log(tag + ": busy, requeue wait #" + (waited + 1) + "/" + busyWaits);
          }
          return true;
        }
        return false;
      }
      let payload;
      let timeoutMs;
      if (isOp) {
        // 载荷 = 旧通道同款 JSON(decode job.data);test 带 tm 让桥端 provider 死线先到,
        // config 瞬时完成不带。桥端响应恒为 JSON → .then 解析后走 handleBridgePayload
        // 的 bridge 分支(与旧通道逐字段同形:ok/config/translation/error)。
        const raw = decodeURIComponent(String(job.data || "{}"));
        if (job.op === "test") {
          payload = "op=test;tm=" + Math.max(4000, (State.cfg.timeoutMs || 15000) - 4000) + "\n" + raw;
          timeoutMs = Math.max(State.cfg.timeoutMs || 15000, 15000);
        } else if (job.op === "log") {
          // P2(2026-10-11):聊天日志迁 BTIPC —— 冻结信封白名单不含 log,首行 op=log 由桥侧
          // 识别(bridge matchChatLogTrq)。载荷由 flushChatLog 按 600B 切批,必不顶 680B
          // 行预算(顶了会落死旧通道)。批与保存同量级 → 死线同样按载荷算(原写死 8000,
          // 与 config 写同一个错:只量了应答没量上行,600B/60 帧实测 ≈37s vs 8s 死线)。
          payload = "op=log\n" + raw;
          timeoutMs = btipcWriteDeadlineMs(btipcUtf8Bytes(payload).length);
        } else {
          // btipc05b:读/写死线分离。读应答 maskCompact ≈400B=40 帧 × 真机 600ms/帧 ≈24s ——
          // 原 8s 必超时(实车 config FAIL 34 连败的根因);写应答已瘦到 {ok:true}(9B/1帧≈3s)维持快速失败。
          // btipc05c:此 `else` 曾被误删 → op=config 整块跳过、payload 停在 undefined →
          // btipcUtf8Bytes(undefined).length 必炸(实车 dispatch THREW ×23),且 op=test 会被
          // 随后的 config 赋值覆盖成 "op=config\n{}"(测试按钮发错载荷)。别删这个 else。
          // btipc05d:35s → 50s。35s 实测约 1/3 概率超时(首发起跑竞态白烧 5~6 轮 ×2.5s STORM
          // 罚时 + 中途 CRC 重试);50s 覆盖「竞态 15s + 38 帧 23s + 2 次 STORM 5s」≈43s 的最坏情形。
          // 2026-10-15:写死线从固定 8000 改为**按载荷算**(见 btipcWriteDeadlineMs)。
          // 原来写死 8s 是按"写应答 1 帧"定的,没算上行请求本身要 61 帧 —— 带 Key 的
          // 保存必然 REQ_TIMEOUT。现在 600B 载荷 → 约 45s,与读的 50s 同量级。
          const isRead = !!job.read || String(raw).trim() === "{}";
          payload = "op=config\n" + raw;
          timeoutMs = isRead ? 50000 : btipcWriteDeadlineMs(btipcUtf8Bytes(payload).length);
        }
      } else if (isChat) {
        payload = text;
        timeoutMs = State.cfg.timeoutMs || 15000;
      } else {
        const target = resolveOutgoingTarget();
        // 信封要求目标语言为安全字符集([A-Za-z0-9-],1..16):自定义目标语言含其它字符时
        // 回落旧通道(URL 编码无此限制),不让桥端信封解析失败回退成错误方向。
        const SAFE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-";
        let safe = target.length >= 1 && target.length <= 16;
        for (let i = 0; safe && i < target.length; i += 1) {
          if (SAFE.indexOf(target.charAt(i)) < 0) safe = false;
        }
        if (!safe) {
          log(tag + ": target unsafe (" + String(target).slice(0, 20) + "), fallback old transport");
          return false;
        }
        // tm = 桥端 provider 死线,比游戏侧 20s 死线小 4s:桥先给结论(成功帧或空 END 帧),
        // 客户端才收得到,而不是双方同时放弃。
        payload = "t=" + target + ";tm=" + (OUTGOING_TIMEOUT_MS - 4000) + "\n" + text;
        timeoutMs = OUTGOING_TIMEOUT_MS;
      }
      const payloadLen = btipcUtf8Bytes(payload).length;
      if (payloadLen > BTIPC_REQ_MAX_PAYLOAD) {
        // spec §8 too_long 本该按原文发送;旧通道无 680B 上限 → 回落更优,且 J1 行预算不破
        log(tag + ": too_long " + payloadLen + "B, fallback old transport");
        return false;
      }
      let settled = false;
      // op 任务失败必须交 {ok:false,error}(旧通道语义,状态栏能显示具体错误);
      // outgoing 仍 done(null,null) → 发原文(job.done 有 once 防重)。
      // chat 没有 done 回调(job.done 为 undefined,调用只会被 try/catch 静默吞掉)——
      // 必须就地结算 group,否则 State.inflight 留下 settled=false 的僵尸组:
      // 同文本的新行会永远合并进僵尸组、seen 也不释放,桥恢复后该文本整个会话不再翻译
      // (审查 2026-10-10;旧通道此路径走 handleBridgePayload→failJob→deliverError,BTCPIC 化时漏掉)。
      const doneFail = function (errCode) {
        if (isOp) { try { job.done({ ok: false, error: errCode }); } catch (e) {} }
        else if (job.kind === "chat") {
          if (job.group && !job.group.settled) {
            // 可观测性(游戏内实测 2026-10-10):结算点必须留痕,否则 E2E 无法区分
            // "走了 deliverError" 与 "静默吞掉"(修复前的样子)
            log(tag + ": settle chat group err=" + String(errCode || "btipc_fail") +
                " text=" + String((job.record && job.record.text) || "").slice(0, 40));
            try { deliverError(job.group, String(errCode || "btipc_fail")); }
            catch (e) {
              // deliverError 自身异常也要保证不留僵尸组(settled/inflight 二态必须收敛)
              try { job.group.settled = true; } catch (e2) {}
              try { if (State.inflight.get(job.group.key) === job.group) State.inflight.delete(job.group.key); } catch (e3) {}
              try { State.seen.delete(job.sig); } catch (e4) {}
            }
          } else {
            // group 已被别的路径结算(如 settle_threw 兜底):只放开行级去重
            try { State.seen.delete(job.sig); } catch (e) {}
          }
        }
        else { try { job.done(null, null); } catch (e) {} }
      };
      const settleOriginal = function (why, errCode) {
        if (settled || job._timedOut) return;
        settled = true;
        log(tag + ": " + why);
        doneFail(errCode || "btipc_fail");
        finishJob();
      };
      const win = BTIPC.newWindowId();
      const t0 = nowMs();
      BTIPC.request({ windowId: win, text: payload, translate: true, timeoutMs: timeoutMs })
        .then(function (got) {
          if (settled || job._timedOut) return;
          settled = true;
          try {
            if (isOp) {
              let res = null;
              try { res = JSON.parse(String(got == null ? "" : got)); } catch (e2) { res = null; }
              if (!res || typeof res.ok !== "boolean") res = { ok: false, error: "bad_op_response" };
              log(tag + ": ok win=" + win + " dt=" + (nowMs() - t0) + "ms ok=" + res.ok);
              handleBridgePayload(job, res);
            } else {
              log(tag + ": ok win=" + win + " dt=" + (nowMs() - t0) + "ms out=" + String(got).length + "ch");
              handleBridgePayload(job, { ok: true, translation: got, detectedLanguage: null });
            }
          } catch (e) {
            log(tag + ": settle THREW " + expErr(e));
            doneFail("settle_threw");
            finishJob();
          }
        })
        .catch(function (err) {
          if (settled || job._timedOut) return;
          const kind = (err && err.kind) || "unknown";
          if (kind === "translate_error") {
            // 响应型失败 → 走旧的响应型失败语义(attempts ≤1 重试,内部含 requeue/finishJob)
            settled = true;
            try {
              handleBridgePayload(job, { ok: false, error: "btipc_translate_error" });
            } catch (e) {
              settled = false;
              settleOriginal("retry enqueue THREW " + expErr(e));
            }
            return;
          }
          settleOriginal("FAIL kind=" + kind + " msg=" + ((err && err.message) || "") +
              " dt=" + (nowMs() - t0) + "ms -> " + (isOp ? "respond error" : "send original"), kind);
        });
      // 队列活性死线:BTIPC 自身死线 +2s 兜底。BTIPC 若因引擎异常永不确定,
      // 这里强制结算(settled/_timedOut 置位后,迟到的 then/catch 直接忽略)。
      // 同样走 afterRealMs:它比 BTIPC 死线更长,若沿用单发 $.Schedule 而长延时早触发,
      // 就会抢在 BTIPC 死线之前把请求打死 —— 等于把缺陷 A 换个地方复发。
      try {
        afterRealMs(timeoutMs + 2000, function () {
          settled = true;
          job._timedOut = true;
          log(tag + ": deadman fired (win=" + win + "), " + (isOp ? "respond timeout" : "send original"));
          doneFail("timeout");
          finishJob();
        }, function () { return !(settled || job._timedOut); });
      } catch (e) {}
      return true;
    } catch (e) {
      // 连 request 都没发出去:绝不让异常卡住单槽队列。
      // (catch 在 try 块外,isOp/doneFail 不可见 —— 就地判定,语义与 doneFail 一致)
      log(tag + ": dispatch THREW " + expErr(e));
      if (job.kind === "bridge" && (job.op === "config" || job.op === "test" || job.op === "log")) {
        try { job.done({ ok: false, error: "dispatch_threw" }); } catch (e2) {}
      } else {
        try { job.done(null, null); } catch (e2) {}
      }
      finishJob();
      return true;
    }
  }

  function dispatchJob(job) {
    // 出站翻译排队超过 15s 未轮到(队列被其他请求占满)直接发原文,避免输入卡死。
    // (提到通道选择之前,结论不变:旧通道不可用时同样 done(null,null) 发原文,只多一行日志)
    if (job.kind === "outgoing" && job.enqueuedAt && nowMs() - job.enqueuedAt > 15000) {
      job.done(null, null);
      finishJob();
      log("outgoing dropped: queued too long, sending original");
      return;
    }
    // ---- https 面板通道优先(2026-10-15):一个 RTT 拿整条结果;失败由 demoteToBtipc 原样交回 BTIPC ----
    if (httpsPanelTakes(job)) {
      dispatchViaPanel(job, {
        httpsChannel: true, // 绕开 http 面板通道的判死冷却(见 navSuppressedFor 注释)
        onHardFail: function () { return demoteToBtipc(job); },
      });
      return;
    }

    // ⑥ 上层整合:出站翻译 + 入站 chat(btipc04)+ 保存/测试/读配置 op(btipc05)
    // 优先走 BTIPC;接不了(too_long/目标语言不安全/久等仍未空)回落旧通道
    // (6726 后已死 → 翻译兜底原文,op 兜底 {ok:false,error})
    const viaBtipc =
      job.kind === "outgoing" || job.kind === "chat" ||
      (job.kind === "bridge" && (job.op === "config" || job.op === "test" || job.op === "log"));
    if (viaBtipc && outgoingViaBtipc(job)) return;

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

  // 配置推送的唤醒包:"LCTW{指纹,…}" —— 桥叫醒长轮询时由页面写进标题。
  // 必须经**事件**通道拿(panel.title 属性是陈旧的,见 onBridgeEvent 注释)。
  function onWatchPayload(raw) {
    const s = String(raw || "").trim();
    let rev = "";
    if (s.charAt(0) === "{") {
      let j = null;
      try { j = JSON.parse(s); } catch (e) {}
      if (j && typeof j.rev === "string") rev = j.rev;
    } else { rev = s; }
    if (rev && rev !== State.cfgRev) {
      // btipc11:这里**不能**先把 State.cfgRev 改成新指纹 —— 那样差分就没基准了
      // (桥以为客户端已是最新 → 回 same → 配置永远落不下来)。指纹由差分同步落地后再更新。
      log("cfg watch(push): config changed (rev=" + rev + "), re-syncing");
      try {
        syncConfigDelta(function (ok) {
          log("cfg watch(push): " + (ok ? "applied (outgoing=" + State.cfg.outgoing + ")" : "sync failed"));
        });
      } catch (e) { log("cfg watch(push) THREW " + expErr(e)); }
    }
    State.watchArmed = false; // 收到唤醒 → 重新挂一次长轮询
  }

  function onBridgeEvent(a, b, c, d) {
    // ① 配置推送(2026-10-20):面板标题是经**事件**送达的,panel.title 属性读到的是陈旧值
    //    (整个请求应答通道就是这么工作的;2026-10-20 实测:读属性永远读不到推送包,
    //    长轮询每 1.5s 被重挂一次)。这里把两种标题分开认:
    //      "LCTW…"   = 桥叫醒了长轮询(配置变了)
    //      "lct-watch" = 长轮询页面已起来、正在等
    const _wt = [extractEventText(a), extractEventText(b), extractEventText(c), extractEventText(d)];
    for (let _i = 0; _i < _wt.length; _i++) {
      const _w = String(_wt[_i] || "");
      if (_w.indexOf("LCTW") === 0) { onWatchPayload(_w.slice(4)); break; }
      if (_w === "lct-watch") { State.watchAliveAt = nowMs(); }
    }
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

  // ---- 诊断（DIAG-6726）：面板状态快照，用于区分“页面没加载”与“加载了但标题读不到”
  function navDiagSnapshot(verbose) {
    const panel = State.panel;
    if (!isValid(panel)) return "panel=invalid";
    let bits = [];
    try { bits.push("title(" + typeof panel.title + ")=" + JSON.stringify(String(panel.title || "").slice(0, 40))); } catch (e) { bits.push("title=throw"); }
    try { bits.push("act=" + (panel.IsActive ? "1" : "0")); } catch (e) {}
    try { bits.push("loadFail=" + String(panel.loadfailure)); } catch (e) {}
    try { bits.push("src=" + JSON.stringify(String(panel.src || panel.url || "").slice(0, 60))); } catch (e) {}
    if (verbose) {
      try { bits.push("SetURL=" + (typeof panel.SetURL === "function" ? "yes" : "no")); } catch (e) {}
      try { bits.push("ready=" + String(panel.BReadyForDisplay())); } catch (e) { bits.push("ready=throw"); }
    }
    return bits.length ? bits.join(" ") : "panel=valid(no-detail)";
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

  // ---- 诊断(DIAG-6726):2026-09-30 游戏更新(6726 版)后面板导航全失败,
  // 需区分 A) 页面真没加载(panel.title 恒空) B) 页面加载了但标题变化读不到(title 一直 'lct-bridge')。
  // 每 20 次轮询采样一次 panel.title/属性/有效性,避免刷屏。
  function diagTitlePoll() {
    State.diagTitleCount += 1;
    if (State.diagTitleCount % 20 !== 1) return;
    const panel = State.panel;
    const bits = ["#" + State.diagTitleCount, "valid=" + (isValid(panel) ? "1" : "0"), "dead=" + (State.panelDead ? "1" : "0")];
    if (isValid(panel)) {
      let tType = "unknown";
      let tVal = "";
      try { tType = typeof panel.title; if (tType === "string") tVal = panel.title; } catch (e) { tType = "throw"; }
      bits.push("title(" + tType + ")=" + JSON.stringify(String(tVal || "").slice(0, 40)));
      try {
        const attr = panel.GetAttributeString ? panel.GetAttributeString("title", "") : "";
        bits.push("attr=" + JSON.stringify(String(attr || "").slice(0, 40)));
      } catch (e) {}
      try { bits.push("src=" + JSON.stringify(String(panel.src || panel.url || "").slice(0, 60))); } catch (e) {}
      try { bits.push("act=" + (panel.IsActive ? "1" : "0")); } catch (e) {}
      try { bits.push("loadFail=" + String(panel.loadfailure)); } catch (e) {}
    }
    log("diag-title " + bits.join(" "));
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

  // 偶发"引擎压根没加载页面"(src="")时原地重试一次(成本≈1 窗口,直降 BTIPC 更贵)。true=已重试、继续等。
  function retryNavOnce(pending) {
    if (pending.navRetried || !pending.navUrl) return false;
    if (State.probePending && pending !== State.probePending) return false; // 探针在途:不重试,防踩掉 probe 的 nav
    pending.navRetried = true;
    pending.startedAt = nowMs();
    try {
      const p = ensurePanel();
      if (!isValid(p) || typeof p.SetURL !== "function") return false;
      p.SetURL(pending.navUrl);
      if (!State.navRetryLogged) {
        State.navRetryLogged = true;
        log("bridge nav: no alive in " + BRIDGE_ALIVE_SECONDS + "s, retrying nav once");
      }
      return true;
    } catch (e) { return false; }
  }

  function pollTitle() {
    State.polling = false;
    const pending = State.pending;
    const probe = State.probePending; // 与 pending 互斥:探针只在 pending 空时发起,期间新 job 被 httpsPanelTakes 挡到 BTIPC
    if (!pending && !probe) return;
    diagTitlePoll();
    const title = readBridgeTitle();
    if (title === TITLE_ALIVE) {
      markBridgeUp();
      if (pending) pending.sawAlive = true;
      if (probe) probe.sawAlive = true;
      // 导航真的成功过 => 面板通道可用,清掉判死计数与冷却
      State.navDeadStreak = 0;
      State.navDeadUntil = 0;
    } else if (title && title.indexOf(TITLE_PREFIX) === 0) {
      // 按 id 路由:探针 id 固定 "probe",翻译 job 的 id 动态(rXX)
      let payload = null;
      if (probe && title.indexOf(TITLE_PREFIX + "probe") === 0) {
        try { payload = JSON.parse(title.slice((TITLE_PREFIX + "probe").length)); } catch (e) {}
        settleProbe(!!(payload && payload.ok), String((payload && payload.error) || "no_reply"));
        return;
      }
      if (pending && title.indexOf(TITLE_PREFIX + pending.id) === 0) {
        try { payload = JSON.parse(title.slice((TITLE_PREFIX + pending.id).length)); } catch (e) {}
        State.pending = null;
        pending.onResult(payload || { ok: false, error: "bad_bridge_payload" });
        return;
      }
    }
    if (probe) {
      // 探针 nav 失败(3s 无 alive)原地重试一次;仍败则判本会话暂不可用(等下轮自动重探,不再一次性锁死)
      if (!probe.sawAlive && nowMs() - probe.startedAt > BRIDGE_ALIVE_SECONDS * 1000) {
        if (retryNavOnce(probe)) return;
        State.panelDead = true;
        settleProbe(false, "bridge_nav_failed");
        return;
      }
      if (nowMs() - probe.startedAt > HTTPS_PANEL_PROBE_SECONDS * 1000) {
        settleProbe(false, probe.sawAlive ? "no_reply" : "probe_timeout");
        return;
      }
      $.Schedule(TITLE_POLL_SECONDS, pollTitle);
      return;
    }
    // 导航失败快速判定(BUGFIX 0.1.3):3s 内连 alive 都没出现 => 导航失败,立即结算而非傻等 15s 超时。
    if (!pending.sawAlive && nowMs() - pending.startedAt > BRIDGE_ALIVE_SECONDS * 1000) {
      if (retryNavOnce(pending)) return; // 偶发导航失败:原地重试一次再判死(见 retryNavOnce)
      State.pending = null;
      State.panelDead = true;
      const snap = navDiagSnapshot();
      // 硬死签名:src 为空 = 引擎压根没开始加载页面;只有这种才累计判死(有 src 只重置,防偶发抖动误杀)。
      if (snap.indexOf('src=""') !== -1) State.navDeadStreak += 1;
      else State.navDeadStreak = 0;
      if (State.navDeadStreak >= PANEL_NAV_DEAD_STREAK) {
        State.navDeadStreak = 0;
        State.navDeadUntil = nowMs() + PANEL_NAV_COOLDOWN_MS;
        log("bridge nav: panel channel dead in this game build (SetURL never loads) | suppress nav " +
          Math.round(PANEL_NAV_COOLDOWN_MS / 60000) + "min, auto re-probe after | " + snap);
      } else if (!State.navDeadLogged) {
        // 细节日志全程只打一次,之后进冷却只打上面那条摘要 => 死链日志从每 15s 一条降到约 10 分钟一条
        State.navDeadLogged = true;
        log("bridge nav failed: panel dead (no lct-alive within " + BRIDGE_ALIVE_SECONDS + "s) | " + snap);
      }
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
    log("diag-panel " + navDiagSnapshot(true));
    setStatus(t("bridgeOffline"));
    updateBridgeStatusUI();
    updateBridgeDot();
  }

  function handleResult(job, payload) {
    if (payload.ok && payload.translation) {
      // 还原占位符(英雄/物品名)
      let translation = job.nameMap ? restoreGameNames(payload.translation, job.nameMap) : payload.translation;
      // 双向:还原中文名占位符
      if (job.zhNameMap) translation = restoreChineseGameNames(translation, job.zhNameMap);
      // 混合消息:译文只包含非中文片段,拼装回完整文本(中文原样保留)
      let fragment = null;
      if (job.mixedFullText) {
        fragment = translation;
        translation = assembleMixedTranslation(job.mixedFullText, translation);
      }
      log("translated [" + (job.record.channel || "chat") + "] " + job.record.sender + ": " + translation.slice(0, 60));
      // 行可能已被回收复用:注入前逐行校验 sig,避免旧译文贴到新消息(见 deliverResult)
      deliverResult(job.group, translation, fragment);
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
        try {
          if (isValid(old)) {
            old.visible = false;
            old.style.visibility = "collapse";
          }
        } catch (e) {}
      }
      State.hudOverlayCount = State.hudOverlays.length;
      // 5 秒后隐藏并移除(DeleteAsync 在某些 Panorama 版本不可靠,改用 visible=false)
      $.Schedule(5.0, function () {
        try {
          if (isValid(overlay)) {
            overlay.visible = false;
            overlay.style.visibility = "collapse";
          }
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

  // 结果扇出:同 textKey 的所有行(顶栏 HUD + 左下聊天)注入同一份译文,保证两处显示一致。
  // 行已被游戏回收/复用(sig 不匹配)时不注入;HUD 行走浮层兜底(行生命周期短于翻译延迟的老问题)。
  function deliverResult(group, translation, fragment) {
    if (!group) return;
    if (!group.settled) {
      State.cache.set(group.key, { translation: translation, fragment: fragment });
      trimCache();
    }
    group.settled = true;
    if (State.inflight.get(group.key) === group) State.inflight.delete(group.key);
    for (const entry of group.rows) {
      if (isValid(entry.row) && entry.row.__lctSig === entry.sig) {
        injectTranslation(entry.row, entry.sig, translation, fragment);
      } else {
        // 诊断:某行已失效(游戏可能在 2 秒内清理了顶栏消息行)
        log("deliver skipped: row=" + (isValid(entry.row) ? "valid" : "GONE") + " sig=" + ((entry.row && entry.row.__lctSig === entry.sig) ? "match" : "MISMATCH"));
        // HUD 测试行被游戏清理后,重建一条译文显示行(验证通路;真实消息行生命周期更长不受影响)
        tryRecreateHudTranslation({ record: { channel: "hud" }, sig: entry.sig }, translation);
      }
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
      if (job.group) {
        deliverError(job.group, String(error || "unknown_error").slice(0, 120));
      } else {
        // 失败后允许同一文本在新行上重试(旧行已注入错误;seen 去重不应永久吞掉重试)
        if (job.kind === "chat" && job.sig) {
          try { State.seen.delete(job.sig); } catch (e) {}
        }
        if (isValid(job.row) && job.row.__lctSig === job.sig) {
          injectError(job.row, job.sig, String(error || "unknown_error").slice(0, 120));
        }
      }
      log("failed: " + String(error).slice(0, 80));
    }
    finishJob();
  }

  // 失败扇出:整组同文行注入错误并释放 seen,允许后续新行重试
  function deliverError(group, message) {
    if (!group) return;
    group.settled = true;
    if (State.inflight.get(group.key) === group) State.inflight.delete(group.key);
    for (const entry of group.rows) {
      try { State.seen.delete(entry.sig); } catch (e) {}
      if (isValid(entry.row) && entry.row.__lctSig === entry.sig) {
        injectError(entry.row, entry.sig, message);
      }
    }
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

  // P2(2026-10-11):BTIPC TRQ 载荷上限 680B(spec §9 行预算)—— 旧面板通道无上限,50 条
  // 一批可能超限(超限会落死通道,日志照丢)。按 UTF-8 字节切批:信封体 + 全部行 ≤600B;
  // 剩余留在缓冲,本批发出成功后 1s 继续排空(慢滴灌,不与翻译抢队列)。
  const LOG_BATCH_MAX_BYTES = 600;
  function flushChatLog() {
    State.logFlushing = false;
    flushPendingLogs(); // 超时的挂起条目先兜底进缓冲,一并发送
    const lines = [];
    const overhead = btipcUtf8Bytes(JSON.stringify({ matchId: getMatchId(), lines: [] })).length;
    let bytes = overhead;
    while (State.logBuffer.length && lines.length < 50) {
      const one = State.logBuffer[0];
      let oneBytes = btipcUtf8Bytes(JSON.stringify(one)).length + 1; // + ","
      let entry = one;
      if (bytes + oneBytes > LOG_BATCH_MAX_BYTES && lines.length === 0) {
        // 单条即超批(超长消息):截断 text 到 300 字符仍超才丢(旧通道单条上限本就 2000 字符)
        entry = Object.assign({}, one, { text: String(one.text || "").slice(0, 300) });
        oneBytes = btipcUtf8Bytes(JSON.stringify(entry)).length + 1;
        if (overhead + oneBytes > LOG_BATCH_MAX_BYTES) {
          State.logBuffer.shift();
          log("chat log: entry too large, dropped");
          continue;
        }
      } else if (bytes + oneBytes > LOG_BATCH_MAX_BYTES) {
        break; // 填满本批,剩余等下一批
      }
      State.logBuffer.shift();
      lines.push(entry);
      bytes += oneBytes;
    }
    if (!lines.length) return;
    bridgePost("log", { matchId: getMatchId(), lines: lines }, function (res) {
      if (res && res.ok && State.logBuffer.length) {
        // P2:缓冲还有剩余 → 1s 后继续排空(每批独立走队列,不阻塞翻译)
        State.logFlushing = true;
        $.Schedule(1.0, flushChatLog);
      } else if (res && !res.ok) {
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

  // btipc07:上线判定从 healthCheck 的 HTTP 回调里抽出来,BTIPC 回声成功即视为在线。
  // 老毛病:回声成功只 update btipcLastOk 就 return —— 状态栏永远停在初始值,
  // 而 gamenames / quickchat / cfgSynced 三个触发器挂在必死的 bridgePost("health") 上,
  // 一次都没执行过(名称保护一直停在硬编码 100 条,语料从不跟游戏更新)。
  function onBridgeAlive(src) {
    if (!State.bridgeUp) log("bridge online (" + src + ")");
    State.bridgeUp = true;
    State.bridgeOfflineSince = 0;
    setBridgeStatus(t("bridgeOnline") + " \u00b7 " + (State.cfg.provider || "bing"));
    if (!State.cfgSynced && !State.cfgSyncing) {
      // 启动门共用 once(boot 的等探针分支与这里互斥,不会起第二个循环)
      startCfgSync();
    }
    // 首次上线:名称保护全量名单 + 快捷语音语料(两段式握手,指纹相同则一条数据都不传)
    // 2026-10-16:分项 try/catch —— 00:22 实车 syncViaBtipc 同步抛,一次抛就把
    // 同一 onBridgeAlive 里后面的触发器全带走,且 loading 标志卡死导致本会话不再试。
    if (!State.gamenamesLoaded && !State.gamenamesLoading) {
      State.gamenamesLoading = true;
      try { syncGameNames(function () { State.gamenamesLoading = false; }); }
      catch (eG) { State.gamenamesLoading = false; log("onBridgeAlive gamenames THREW " + expErr(eG)); }
    }
    if (!quickchatSynced && !State.quickchatLoading) {
      State.quickchatLoading = true;
      try { syncQuickChat(function () { State.quickchatLoading = false; }); }
      catch (eQ) { State.quickchatLoading = false; log("onBridgeAlive quickchat THREW " + expErr(eQ)); }
    }
    // provider / 版本更新提示:回声只证明桥活着,带不了这些字段 —— 每会话补一次
    // (先置位防重入;失败则复位,下一轮 healthCheck 再补)
    if (!State.healthDetailFetched) {
      State.healthDetailFetched = true;
      try {
        bridgePost("health", {}, function (res) {
        if (!res || !res.ok) { State.healthDetailFetched = false; return; }
        if (res.provider) setBridgeStatus(t("bridgeOnline") + " \u00b7 " + res.provider);
        if (res.updateInfo && res.updateInfo.hasUpdate && !State.updateNotified) {
          State.updateNotified = true;
          const info = res.updateInfo;
          State.updateMsg = t("updateAvailable") + info.latestVersion + " \u00b7 " + t("updateHint");
          log("info", "update available: " + info.currentVersion + " -> " + info.latestVersion + " (" + info.releaseUrl + ")");
          updateBridgeStatusUI();
        }
        });
      } catch (eH) {
        State.healthDetailFetched = false;
        log("onBridgeAlive health detail THREW " + expErr(eH));
      }
    }
  }

  // 判红前给一段宽限:开设置面板 / 切 UI 时的几秒瞬断不算掉线
  function onBridgeDown() {
    if (!State.bridgeOfflineSince) {
      State.bridgeOfflineSince = nowMs();
      log("bridge offline (health): grace started");
    } else if (nowMs() - State.bridgeOfflineSince > BRIDGE_OFFLINE_GRACE_SECONDS * 1000) {
      State.bridgeUp = false;
      setStatus(t("bridgeOffline"));
      setBridgeStatus(t("bridgeOffline"));
    }
  }

    function healthCheck() {
    if (State.queue.length > 0 || State.pending) return;
    // btipc04:BTIPC 健康新鲜期(45s 内有成功)用 REQ 回声(15s/次)替代必死的 nav health;
    // 6726(DIAG-6726)后 SetURL 导航全灭 —— nav 只在 BTIPC 也哑掉(>45s 无成功)时兜底判红,
    // 否则每 5s 打一次必死的 nav 只会刷屏 + 堵串行队列。回声走 REQ(translate=false),桥端现成。
    if (BTIPC) {
      const nowH = nowMs();
      const freshH = State.btipcLastOk && nowH - State.btipcLastOk <= 45000;
      if (!BTIPC.busy()) {
        const echoDue = !State.btipcLastEcho || nowH - State.btipcLastEcho >= 15000;
        if (echoDue) {
          State.btipcLastEcho = nowH;
          BTIPC.request({ windowId: BTIPC.newWindowId(), text: "health", translate: false, timeoutMs: 8000 })
            .then(function () { onBridgeAlive("btipc echo"); })
            .catch(function (err) {
              const kind = (err && err.kind) || "unknown";
              // 2026-10-12 transport 加固:对局 console.log 洪峰下 128 位组装丢位 -> 连败进风暴,
              // 回声 1 帧卡在风暴里 8s 死线先到(实证 17:09:36 连败 -> STORM -> 17:09:42 TIMEOUT,
              // 桥侧 REQ 32/32 全收到、翻译全成功 —— 拥塞不是掉线)。风暴窗内的 timeout/crc_dead
              // 降为拥塞日志不判 down,免去 grace 级联(canHttp 复位 -> 死通道 nav 重探测刷屏);
              // 真掉线(无近期风暴)路径不变。8s 死线不拉长:早释放单槽让排队翻译先走。
              if ((kind === "timeout" || kind === "crc_dead") &&
                  State.btipcLastStormAt && nowMs() - State.btipcLastStormAt <= BTIPC_ECHO_STORM_WINDOW_MS) {
                log("btipc health echo FAIL kind=" + kind + " during congestion (recent storm), not treated as down");
                return;
              }
              log("btipc health echo FAIL kind=" + kind);
              onBridgeDown();
            });
          return;
        }
      }
      // 传输在途(同步分片 / op 读)说明桥正在回帧,不能判死;新鲜期同理
      if (freshH || State.btipcActive) return;
      onBridgeDown();
      return;
    }
    // long offline + panel-only channel -> reset to re-probe direct (works if game supports AsyncWebRequest)
    // 限流:复位会立刻被下一次 detectAsyncWebRequest 打回 false,不加间隔就会每 5s 刷一条复位日志。
    if (State.bridgeOfflineSince && (nowMs() - State.bridgeOfflineSince) > BRIDGE_OFFLINE_GRACE_SECONDS * 1000 && State.canHttp === false &&
      nowMs() - State.canHttpLastProbe >= CANHTTP_REPROBE_MS) {
      State.canHttp = null;
      log("bridge channel: reset to re-probe direct (was panel-only)");
    }
    // 兜底分支:BTIPC 不可用时才落到这里(6726 后该通道已死,留着只为不改变语义)。
    // btipc07 之后 health 也是 op=config 的 get=,走 BTIPC;上下线判定统一在上面两个函数里。
    bridgePost("health", {}, function (res) {
      if (res && res.ok) onBridgeAlive("legacy health");
      else onBridgeDown();
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
    if (!record) {
      // 6726 新行为:气泡先创建、文本延迟填充(用户肉眼可见)。空行在此返回 null,
      // 若只靠水位线+尾部补扫,burst 超 3 条后填充的文本会永久漏译 → 登记观察表,文本到达后由补扫处理
      if (!row.__lctWatched) {
        row.__lctWatched = true;
        try { State.pendingFill.set(row, nowMs() + PENDING_FILL_TTL_MS); } catch (e) {}
      }
      return false;
    }
    if (row.__lctWatched) {
      row.__lctWatched = false;
      try { State.pendingFill.delete(row); } catch (e) {}
    }
    const skipTranslation = shouldSkip(record);
    // 混合消息(中文+少量英文,典型:英文英雄名设置下的快捷语音渲染如 "我看到 McGinnis"):
    // 只把非中文片段送去翻译,中文部分原样保留。record.text 保持完整原文(签名稳定)。
    const mixedFrag = skipTranslation ? null : mixedFragment(record.text);
    const translatingText = mixedFrag === null ? record.text : mixedFrag;
    // 翻译前占位替换:保护英雄/物品名不被翻译API意译
    const _ng = replaceGameNames(translatingText, PROTECT_TO_ZH);
    if (mixedFrag === null) {
      // 原有路径:整句翻译,占位替换直接写回 record.text(替换幂等,重扫签名不变)
      if (_ng.nameMap) { record.text = _ng.text; record._nameMap = _ng.nameMap; }
      // 双向:中文游戏名→英文占位(目标语言非中文时,保护中文名不被翻译API意译)
      const _tgt = targetLanguage();
      if (!_tgt.toLowerCase().startsWith("zh")) {
        const _zg = replaceChineseGameNames(record.text, ZH_TO_EN);
        if (_zg.zhNameMap) { record.text = _zg.text; record._zhNameMap = _zg.zhNameMap; }
      }
    } else {
      // 混合路径:不改 record.text(改动缓存 record 会让签名漂移,重扫时被当成新消息)
      if (_ng.nameMap) record._nameMap = _ng.nameMap;
      record._transText = _ng.text; // 占位替换后的待译片段
    }
    const sig = makeSignature(record);

    // 已处理过的行:若签名变化说明被回收复用,重置处理状态
    const prevSig = row.__lctSig;
    if (row.__lctProcessed && prevSig === sig) {
      // 尝试从缓存恢复译文(聊天滚动回收场景)
      if (!skipTranslation) restoreFromCache(row, sig, makeTextKey(record));
      return false;
    }
    if (prevSig !== sig) {
      row.__lctProcessed = false;
      resetRowModState(row);
    }
    row.__lctSig = sig;
    row.__lctProcessed = true;

    if (State.seen.has(sig)) {
      if (!skipTranslation) restoreFromCache(row, sig, makeTextKey(record));
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
    const textKey = makeTextKey(record);
    if (State.cache.has(textKey)) {
      const cached = State.cache.get(textKey);
      injectTranslation(row, sig, cached.translation, cached.fragment);
      return false;
    }
    enqueue(row, sig, record, mixedFrag);
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

  // 6726 延迟填充观察表:每轮复扫登记的空行;文本到达 → processRow 正常走全管线;
  // 行失效(回收/销毁)或超时 → 出表。空行不会污染 seen/processed(在签名逻辑之前拦截),表内循环无泄漏
  function processPendingFill() {
    if (State.pendingFill.size === 0) return false;
    const now = nowMs();
    let touched = false;
    const dead = [];
    State.pendingFill.forEach(function (expireAt, row) {
      if (!isValid(row) || now > expireAt) { dead.push(row); return; }
      try {
        if (processRow(row)) touched = true;
        if (!row.__lctWatched) dead.push(row); // 文本已到达并被处理,出表
      } catch (e) { dead.push(row); }
    });
    for (let i = 0; i < dead.length; i += 1) State.pendingFill.delete(dead[i]);
    return touched;
  }

  // ================= 常驻轻量打字指示器观察(exp6738 结论,被动采集)=================
  // 9/30 更新:打字/发送中 = 聊天行 MessageContents 内的 TypingAnim(TypingDot1~3),
  // 快捷语音不产生此行。已知 id 直查(不扫全树),只在状态翻转时打一行 ——
  // 任何人任何时候打字(大厅/对局)都会自然留证,与消息行日志按时间戳对账,
  // 不需要专门找"真人打字的对局"。已证实自己的打字 3 周期全中;待采:他人打字样本(广播侧)。
  function watchTypingIndicator() {
    const root = getRoot();
    if (!root) return;
    let where = "";
    try {
      if (findChild(resolveChatMessages(), "TypingAnim")) where = "chat";
      if (!where) {
        resolveHudMessages();
        for (let i = 0; i < State.hudMessages.length; i += 1) {
          if (findChild(State.hudMessages[i], "TypingAnim")) { where = "hud" + i; break; }
        }
      }
      if (!where && findChild(resolveLobbyMessages(), "TypingAnim")) where = "lobby";
    } catch (e) {}
    const O = State.typingLog || (State.typingLog = { on: false, t0: 0, where: "" });
    const on = !!where;
    if (on === O.on) return;
    const now = nowMs();
    O.on = on;
    if (on) {
      O.t0 = now;
      O.where = where;
      log("typing: ON " + where);
    } else {
      log("typing: OFF " + O.where + " life=" + (now - O.t0) + "ms");
    }
  }

  function scanChatMessages() {
    // 注意:两个扫描都必须执行,不能用 || 短路——
    // 左下角聊天有活动时 scanChatMessagesOnce() 返回 true 会跳过 HUD 扫描
    try { watchTypingIndicator(); } catch (e) {}
    const touchedChat = scanChatMessagesOnce();
    const touchedHud = scanHudTopBarOnce();
    const touchedLobby = scanLobbyOnce();
    const touchedFill = processPendingFill();
    const touched = touchedChat || touchedHud || touchedLobby || touchedFill;
    maybeProbeHttpsPanel(); // https 探针:开机首探 + 判死后节流重探(独立槽,与本循环的翻译调度并行)
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

  // ---- BTIPC 传输层(2026-10-28 拆至 lingua_chat_btipc.js,此处别名解构保持调用点不变) ----
  // 依赖经 LCTBTIPC.init({...}) 在 boot() 首行注入;此处只做引用绑定,不含实现。
  const afterRealMs = LCTBTIPC.afterRealMs;
  const btipcFinish = LCTBTIPC.btipcFinish;
  const btipcUtf8Bytes = LCTBTIPC.btipcUtf8Bytes;
  const BTIPC = LCTBTIPC.BTIPC;
  const runBtipcEcho = LCTBTIPC.runBtipcEcho;
  const runBtipcTranslate = LCTBTIPC.runBtipcTranslate;
  // 传输层的节拍常量:主文件的写死线/行预算/回声拥塞豁免窗引用同一定义
  const BTIPC_T_CLOSE_MS = LCTBTIPC.BTIPC_T_CLOSE_MS;
  const BTIPC_FIRST_SHOT_DELAY_MS = LCTBTIPC.BTIPC_FIRST_SHOT_DELAY_MS;
  const BTIPC_REQ_MAX_PAYLOAD = LCTBTIPC.BTIPC_REQ_MAX_PAYLOAD;
  const BTIPC_ECHO_STORM_WINDOW_MS = LCTBTIPC.BTIPC_ECHO_STORM_WINDOW_MS;

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

    // EXP6734-C: C-5 两段 Enter 判定钩子(第1下拦截改写不发送;第2下放行走正常发送)
    if (State.c5 && expCall("exp6734cSubmitHook", input, trimmed)) return;

    if (!trimmed) return;

    // /tr:设置已经搬到桌面浏览器(2026-10-19)。两条路彻底分开(用户 2026-10-19 澄清):
    //   /tr        通知桥用系统默认浏览器打开 http://127.0.0.1:<port>/ui(附一行状态摘要进日志),
    //              不开发送链路
    //   /tr ui     同上(等价别名)
    //   /tr panel  只开旧面板(调试/兜底),不发 UI_OPEN、不拉网页
    if (trimmed === "/tr" || trimmed.indexOf("/tr ") === 0) {
      clearInput();
      const trArg = trimmed.slice(3).trim();
      if (trArg === "panel") openSettingsPanel();
      else log("UI_OPEN " + trOpenSummary());
      return;
    }

    // /bt6734e: 多值符号判别实验(6734-E),不发送
    if (trimmed === "/bt6734e") {
      clearInput();
      expCall("runExp6734E");
      return;
    }

    // /bt6734d [n|win]: Bridge→Panorama 下行吞吐基准(6734-D),不发送
    //   无参 = 全矩阵 D1~D6(16/32/64/96/128/256 面板 × 20 轮);数字 = 单配置;win = 窗口组 W1~W5
    if (trimmed === "/bt6734d" || trimmed.indexOf("/bt6734d ") === 0) {
      const dArg = trimmed.slice(8).trim();
      clearInput();
      expCall("runExp6734D", dArg);
      return;
    }

    // /bt6734b: 真实对局延迟测试(6734-B),不发送
    if (trimmed === "/bt6734b") {
      clearInput();
      expCall("runExp6734B");
      return;
    }

    // /bt6734c: 输入框控制实验(6734-C),不发送;布防后两段手动 Enter 判定
    if (trimmed === "/bt6734c") {
      expCall("runExp6734C", input, trimmed);
      return;
    }

    // !lcttest 测试命令:向 HUD 顶栏聊天注入一条英文消息(不真实发送)
    // 用途:无队友/无 bot 时验证 HUD 扫描+翻译通路;进训练场即可测
    // /bt6736 [n] [text]: BTIPC v1 回声 conformance(§12.4),不发送;默认 1×"Hello BTIPC",数字=连发次数
    if (trimmed === "/bt6736" || trimmed.indexOf("/bt6736 ") === 0) {
      const echoArg = trimmed.slice(8);
      clearInput();
      runBtipcEcho(echoArg);
      return;
    }

    // /bt6737 [text]: BTIPC v1 翻译链 smoke(⑥)—— TRQ → BUSY → 译文;不发送
    if (trimmed === "/bt6737" || trimmed.indexOf("/bt6737 ") === 0) {
      const trArg = trimmed.slice(8).trim();
      clearInput();
      runBtipcTranslate(trArg || "hello can you push mid");
      return;
    }

    // /bt6738 [stop]: 三点「正在发送」广播指示器 + 聊天行结构取证(9/30 机制),不发送
    //   无参 = toggle;stop = 明确停止。日志前缀 exp6738:
    if (trimmed === "/bt6738" || trimmed.indexOf("/bt6738 ") === 0) {
      const p6738Arg = trimmed.slice(7).trim();
      clearInput();
      expCall("runExp6738", p6738Arg);
      return;
    }

    if (trimmed === "!lcttest" || trimmed.indexOf("!lcttest ") === 0) {
      const testText = trimmed.length > 9 ? trimmed.slice(9).trim() : "hello can you push mid";
      injectHudTestMessage(testText);
      clearInput();
      return;
    }

    // 发送前翻译(off=发原文 / translation=仅译文 / bilingual=原文|译文)
    // 按配置的发送前翻译模式处理
    const outgoingMode = State.cfg.outgoing || "off";
    if (State.cfg.enabled && outgoingMode !== "off" && trimmed.charAt(0) !== "/" && !State.c5) {
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
        if (translated && translated !== trimmed) {
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
        } else if (translated === trimmed) {
          // 翻译结果与原文相同(如 API 未做实质翻译):按原文发送
          log("outgoing: no-op (translation === original), sending original");
          setStatus("翻译结果与原文相同,按原文发送");
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
    // ⑥ 上层整合:BTIPC 可用时同样不依赖面板/直连(自建 Image 面板 + console.log 出站)。
    // 仅当两条旧通道都不可用且 BTIPC 也接不了(探针占线)时,才按原文发送。
    const canHttp = detectAsyncWebRequest();
    const panel = canHttp ? null : ensurePanel();
    const btipcReady = !!BTIPC && !BTIPC.busy();
    if (!canHttp && !panel && !btipcReady) {
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
    // btipc05b:开机读到的 mask(存 State.cfg._mask)直接秒开面板 —— 现场读应答
    // ≈400B=40 帧 × 真机 600ms/帧 ≈24s,开面板当场读会占死 BTIPC 槽一整拍
    // (期间点保存要排队,超 12s 还会掉死通道)。只有开机时桥不在(没同步到)
    // 才走现场慢读兜底。
    if (State.cfg._mask) {
      applyConfigToPanel(State.cfg._mask);
    } else {
      // 从桥拉取已保存配置:回填 UI 偏好(游戏重启后恢复) + apiKey 占位符
      bridgePost("config", {}, function (res) {
        if (res && res.ok && res.config) {
          State.cfg._mask = res.config;
          applyConfigToPanel(res.config);
        }
      });
    }
    // mask → 面板回填块(开机秒开与异步回填共用;函数声明提升,先用后声明合法)
    function applyConfigToPanel(c) {
      if (!c) return;
        if (c.ui) {
          let changed = false;
          const dirty = State.cfgDirty || {}; // 2026-10-16:开面板回填同样不得拍掉未存的 picks
          if (typeof c.ui.displayMode === "string" && !dirty.displayMode) { State.cfg.displayMode = c.ui.displayMode; changed = true; }
          if (typeof c.ui.outgoing === "string" && !dirty.outgoing) { State.cfg.outgoing = c.ui.outgoing; changed = true; }
          if (typeof c.ui.outgoingTarget === "string" && !dirty.outgoingTarget) { State.cfg.outgoingTarget = c.ui.outgoingTarget; changed = true; }
          if (typeof c.ui.targetLanguage === "string" && !dirty.targetLanguage) { State.cfg.targetLanguage = c.ui.targetLanguage; changed = true; }
          if (typeof c.ui.enabled === "boolean" && !dirty.enabled) { State.cfg.enabled = c.ui.enabled; changed = true; }
          if (typeof c.ui.force === "boolean" && !dirty.force) { State.cfg.force = c.ui.force; changed = true; }
          if (typeof c.ui.provider === "string" && !dirty.provider) { State.cfg.provider = c.ui.provider; changed = true; }
          if (typeof c.ui.timeoutMs === "number" && !dirty.timeoutMs) { State.cfg.timeoutMs = c.ui.timeoutMs; changed = true; }
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
          if (!((State.cfgDirty || {}).chatLog)) State.cfg.chatLog = c.chatLog.enabled;
          setToggleText("LCTChatLog", State.cfg.chatLog);
        }
        if (typeof c.translateOwn === "boolean") {
          if (!((State.cfgDirty || {}).translateOwn)) State.cfg.translateOwn = c.translateOwn;
          setToggleText("LCTTranslateOwn", State.cfg.translateOwn);
        }
    }
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
    const kc = e && (e.KeyCode !== undefined ? e.KeyCode : e.keyCode);
    const esc = (k === "Escape" || k === "esc" || k === 27 || kc === 27);
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
    markCfgDirty(which);
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
    markCfgDirty("provider");
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
    markCfgDirty(which);
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
    markCfgDirty(field);
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
    markCfgDirty(field);
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
    // 仅当用户真的改动了回退列表输入时才回传;未动过/异步回填前 = 不带该字段,桥端保留原值。
    // (btipc05 bugfix:此块曾位于 const out 声明之前 —— 一旦改过回退列表就触发 TDZ
    //  ReferenceError,collectPanelConfig 抛死,保存按钮静默无反应。)
    const fbField = String(fieldValue("LCTFallback") || "");
    if (fbField !== credFieldSnap.fallback) {
      out.fallbackProviders = fbField.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    }
    // 仅当用户真的改动了区域输入时才回传;清空输入 = 显式清除
    if (regionField !== credFieldSnap.region) {
      if (regionField === "") out.clearRegion = true;
      else out.region = regionField;
    }
    return out;
  }

  // btipc07:health / gamenames / quickchat 三接口迁 BTIPC。TRQ 信封白名单冻结
  // (core/btipc/transport.js 只认 op=config|test),所以新语义一律塞进 op=config 的
  // JSON body 的 "get" 字段,由桥端 runBtipcGet 解释 —— 信封/帧/状态机零改动,
  // 上层(healthCheck / syncGameNames / syncQuickChat)的调用方式也完全不变。
  // configsync(btipc11):配置差分同步。op 名与 op=config 的**写**语义分开 ——
  // 桥端 op=config 分支按 get 优先解释 body,写与 get 不能共用一个 op 名。
  const BTIPC_GET_OPS = { health: 1, gamenames: 1, quickchat: 1, configsync: 1 };

  function bridgePost(op, payload, done) {
    const isGet = !!BTIPC_GET_OPS[op];
    const body = isGet ? Object.assign({ get: op }, payload || {}) : (payload || {});
    const data = encodeURIComponent(JSON.stringify(body));
    // 直连通道可用时不要求 HTML 面板存在(hudchat 未加载时测试/保存也能用)
    const canHttp = detectAsyncWebRequest();
    const panel = canHttp ? null : ensurePanel();
    if (!canHttp && !panel) {
      done({ ok: false, error: "bridge_panel_unavailable" });
      return;
    }
    ensureBridgeEvents();
    enqueueBridge(isGet ? "config" : op, data, done, isGet);
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
        // 2026-10-16:意图已落盘 —— 脏标记清零;启动期旧 _mask 作废(下次开面板走
        // https 快读,不再吃冷冻值,否则重开面板显示回旧值)
        State.cfgDirty = {};
        State.cfg._mask = null;
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

  // ================= 2026-10-16:配置同步启动门 + 用户脏标记 =================
  // 启动门:boot 等探针定论(通常 2-4s)再同步,避免 t=0 直发必走 BTIPC 位泵(25s+);8s 无定论走老路。
  function startCfgSync() {
    if (State.cfgSyncStarted) return;
    State.cfgSyncStarted = true;
    syncBridgeConfig();
  }
  function waitProbeForSync() {
    if (State.cfgSyncStarted || State.cfgSynced) { State.cfgSyncStarted = true; return; }
    if (State.httpsPanelOk !== null) { startCfgSync(); return; }
    State.cfgSyncWaitTries = (State.cfgSyncWaitTries || 0) + 1;
    if (State.cfgSyncWaitTries >= 8) { startCfgSync(); return; }
    try { $.Schedule(1.0, waitProbeForSync); } catch (e) { startCfgSync(); }
  }
  // 用户脏标记:启动同步落地 / 面板 _mask 回填不得拍掉用户在窗口内改过的值
  // (23:35 与 00:48 两次实车:pick openai → sync 落地 → 被迫重选)。
  // LCTSave 成功清零(意图已落盘);重启后 loadUiConfig 全新,无脏。
  function markCfgDirty(key) {
    if (!State.cfgDirty) State.cfgDirty = {};
    State.cfgDirty[key] = true;
  }

  // 把桥回给的游戏侧配置落地到 State.cfg。开机同步与运行时"配置变更"监听共用这一段
  // (两处口径必须一致)。dirty 键 = 用户在面板里改过还没保存的值,不能被桥回填拍掉。
  function applyBridgeConfig(c, tag) {
    let changed = false;
    const ui = c.ui || {};
    const dirty = State.cfgDirty || {};
    if (typeof ui.displayMode === "string" && !dirty.displayMode) { State.cfg.displayMode = ui.displayMode; changed = true; }
    if (typeof ui.outgoing === "string" && !dirty.outgoing) { State.cfg.outgoing = ui.outgoing; changed = true; }
    if (typeof ui.outgoingTarget === "string" && !dirty.outgoingTarget) { State.cfg.outgoingTarget = ui.outgoingTarget; changed = true; }
    if (typeof ui.targetLanguage === "string" && !dirty.targetLanguage) { State.cfg.targetLanguage = ui.targetLanguage; changed = true; }
    if (typeof ui.enabled === "boolean" && !dirty.enabled) { State.cfg.enabled = ui.enabled; changed = true; }
    if (typeof ui.force === "boolean" && !dirty.force) { State.cfg.force = ui.force; changed = true; }
    if (typeof ui.provider === "string" && !dirty.provider) { State.cfg.provider = ui.provider; changed = true; }
    if (typeof ui.timeoutMs === "number" && !dirty.timeoutMs) { State.cfg.timeoutMs = ui.timeoutMs; changed = true; }
    // 顶层开关(chatLog/translateOwn 不在 ui 子对象里,BUGFIX:游戏重启后
    // 若不回填,State.cfg 回落到 DEFAULTS(translateOwn:true),导致"关掉还翻译")
    if (typeof c.translateOwn === "boolean" && !dirty.translateOwn) { State.cfg.translateOwn = c.translateOwn; changed = true; }
    if (c.chatLog && typeof c.chatLog === "object") {
      if (typeof c.chatLog.enabled === "boolean" && !dirty.chatLog) { State.cfg.chatLog = c.chatLog.enabled; changed = true; }
    }
    if (changed) {
      saveUiConfig();
      log((tag || "config") + ": synced from bridge (outgoing=" + State.cfg.outgoing +
        ", translateOwn=" + State.cfg.translateOwn + ")");
    }
    // btipc05b:留全量 mask 给面板秒开(openSettingsPanel 直接消费,免 24s 现场读)
    State.cfg._mask = c;
    // btipc11:差分同步的基准(与 _mask 分开:_mask 会被面板保存清空,这份不能清 —— 清了差分就没基准)。
    State.cfgMask = c;
    return changed;
  }

  // ================= 配置差分同步(btipc11)=================
  // 与 gamenames/quickchat 同一套两段式(桥端 core/sync_data.js):握手报本地指纹 → same(1 帧)或只传
  // **变了的字段**(set=绝对值/unset=删除,典型 1~3 个 ≈100B)。差分基准 = State.cfgMask(与指纹同版),
  // 桥侧按客户端指纹查自己的版本历史算差分。
  // 为什么值得:全量 maskCompact ≈400B=40 帧≈26s(BTIPС 下行 10B/帧),慢通道上"网页改了游戏不认"要等 20s 轮询 + 26s 全量 ≈46s;差分后 ≈1 帧(没变)或 6 帧(变了)。
  function cfgPathApply(obj, path, value) {
    const ps = String(path).split(".");
    let cur = obj;
    for (let i = 0; i < ps.length - 1; i++) {
      if (!cur[ps[i]] || typeof cur[ps[i]] !== "object") cur[ps[i]] = {};
      cur = cur[ps[i]];
    }
    if (value === undefined) delete cur[ps[ps.length - 1]];
    else cur[ps[ps.length - 1]] = value;
  }
  function applyConfigPayload(text, res) {
    let d = null;
    try { d = JSON.parse(text); } catch (e) { d = null; }
    if (!d || typeof d !== "object") { log("cfg sync: payload not JSON"); return false; }
    let mask = null;
    if (d.delta) {
      mask = JSON.parse(JSON.stringify(State.cfgMask || {}));
      const set = d.set || {};
      for (const p of Object.keys(set)) cfgPathApply(mask, p, set[p]);
      for (const p of (d.unset || [])) cfgPathApply(mask, p, undefined);
    } else if (d.config && typeof d.config === "object") { mask = d.config; }
    else { log("cfg sync: bad payload"); return false; }
    applyBridgeConfig(mask, "cfg-watch");
    State.cfgMask = mask; // 基准 = 合并结果(下一轮差分的起点)
    if (typeof d.fingerprint === "string" && d.fingerprint) State.cfgRev = d.fingerprint;
    log("cfg sync applied: " + (d.delta ? "delta" : "full") + " (rev=" + State.cfgRev + ")");
    return true;
  }
  function syncConfigDelta(onDone) {
    syncViaBtipc("configsync", State.cfgRev || "",
      function () { log("cfg sync: fingerprint match, no transfer"); return true; },
      applyConfigPayload,
      function (ok) { if (onDone) onDone(ok); });
  }

  // ================= 运行时配置监听(2026-10-19, 2026-10-28 简化为慢兜底) =================
  // 网页保存只落 config.json,游戏侧只在开机读一次 → "网页改了游戏不认"。
  // 主力是配置推送(startConfigPush:https 面板长轮询,网页保存后 ~0.3s 生效);
  // 这里的轮询只是 https 面板判死/推送挂不上时的兜底:固定 60s 差分对账,
  // 不做快慢切换、不做退避、不做传输忙跳过(60s 一次,不值得优化)。
  // 轮询失败不计入 https 判死;整段 try/catch —— 任何异常都不许让监听链断掉。
  // 2026-10-20 实踩:压缩行数时把常量声明粘到注释行尾 → 常量没声明 → ReferenceError 被
  // catch 吞掉 → 监听静默死掉、网页改配置游戏永不生效。故:常量独占一行 + 启动即打日志。
  const CFG_WATCH_FALLBACK_S = 60;
  function startCfgWatch() {
    if (State.cfgWatchStarted) return;
    State.cfgWatchStarted = true;
    const tick = function () {
      let done = false;
      const again = function () {
        if (done) return;
        done = true;
        try { $.Schedule(CFG_WATCH_FALLBACK_S, tick); } catch (eS) { log("cfg watch: schedule THREW " + expErr(eS)); }
      };
      try {
        State.cfgPollNext = true; // 兜底轮询失败不计入 https 判死(见 demoteToBtipc)
        // btipc11:轮询走差分同步 —— 没变时握手 1 帧就回,变了才取差分片。
        try {
          syncConfigDelta(function (ok) {
            if (!ok) log("cfg watch: poll failed (fallback, next in " + CFG_WATCH_FALLBACK_S + "s)");
            again();
          });
        } catch (eP) { log("cfg watch: poll THREW " + expErr(eP)); again(); }
      } catch (e) {
        log("cfg watch: tick THREW " + expErr(e));
        again();
      }
    };
    try {
      $.Schedule(CFG_WATCH_FALLBACK_S, tick);
      log("cfg watch: started (fallback=" + CFG_WATCH_FALLBACK_S + "s, push is primary)");
    } catch (e) { log("cfg watch: start THREW " + expErr(e)); }
    startConfigPush();
  }

  // ================= 配置变更推送(2026-10-20) =================
  // 流程就是"桥向游戏发信号 → 游戏再读配置":
  //   游戏把一个长轮询挂在桥上(/bridge?op=watch),网页一保存,桥立刻叫醒 → 游戏
  //   几百毫秒内知道"变了",再自己去读配置(不走 title 通道,避开 512 字符上限)。
  // 长轮询只能挂**请求面板**:2026-10-20 实测,第二个 HTML 面板的 title 引擎不暴露
  // (Activate() 也不行)→ 观察面板这条路是死的。
  // 因此挂长轮询只在**传输空闲**时做:单槽语义下,长轮询占着面板,翻译请求一来就被顶掉
  // (顶掉的是长轮询,不影响翻译);空闲判定与 SetURL 在同一段同步代码里,不会插到请求中间。
  function armConfigWatch() {
    // 空闲判定(State.pending/activeRequests/queue 都空)—— 与下面 SetURL 之间不跨事件循环
    if (State.pending || State.activeRequests > 0 || (State.queue && State.queue.length > 0)) return false;
    const panel = ensurePanel();
    if (!isValid(panel) || typeof panel.SetURL !== "function") return false;
    const seq = (State.watchSeq = (State.watchSeq || 0) + 1).toString(36);
    const url = panelBaseUrl(false) + "/bridge?op=watch&id=w" + seq +
      "&rev=" + encodeURIComponent(State.cfgRev || "") + "&lang=" + gameUiLang();
    try { panel.SetURL(url); } catch (e) { return false; }
    State.watchArmedAt = nowMs();
    State.watchArmed = true;
    return true;
  }

  // 长轮询的挂/收状态机:
  //   挂:armConfigWatch(只在传输空闲时,判定与 SetURL 同一段同步代码)
  //   活:页面起来会经**事件**报 "lct-watch"(onBridgeEvent 里记 State.watchAliveAt)
  //   醒:桥叫醒时页面写 "LCTW{…}" → onWatchPayload 处理并把 watchArmed 清掉 → 重新挂
  // 不用读 panel.title:那个属性是陈旧的(2026-10-20 实测)。
  function configWatchTick() {
    try {
      if (!State.watchArmed) {
        if (armConfigWatch() && !State.cfgPushLogged) {
          State.cfgPushLogged = true;
          log("cfg watch(push): armed (请求面板长轮询,网页保存后 ~0.3s 生效)");
        }
      } else if (nowMs() - (State.watchAliveAt || State.watchArmedAt || 0) > 3000) {
        State.watchArmed = false; // 页面没起来 → 重挂
      } else if (nowMs() - (State.watchArmedAt || 0) > 22000) {
        State.watchArmed = false; // 长轮询超时(桥 20s 回,页面不写标题)→ 重挂
      }
    } catch (e) {}
    try { $.Schedule(0.15, configWatchTick); } catch (e) {}
  }

  function startConfigPush() {
    if (State.cfgPushStarted) return;
    State.cfgPushStarted = true;
    if (State.httpsPanelOk !== true) return; // 没有 https 通道就没有推送(退回轮询)
    // **不要在这里直接 arm**:startCfgWatch 是在开机同步的回调里被调的,那一刻出站槽位
    // 还没还(activeRequests 仍为 1)→ 空闲判定必然失败 → 推送永远挂不上(2026-10-20 实测:
    // 日志里连 "cfg watch(push): armed" 都没有,一直靠 15s 轮询兜底,实测延迟 12~25s)。
    // 交给下面的 tick 去挂:它在传输空闲的那一瞬挂上,挂上之后就与槽位无关了。
    try { $.Schedule(0.15, configWatchTick); } catch (e) {}
  }

  function syncBridgeConfig(callback) {
    // BUGFIX 0.1.3:boot 时主动从桥拉取已保存配置,同步进 State.cfg,
    // 否则游戏重启后 outgoing 等偏好回落到 UI_DEFAULTS(发送前翻译默认关)。
    // boot 时 UI 树可能尚未构建,面板找不到会立即失败 -> 延迟重试。
    // BUGFIX 0.1.3 (again):不能依赖 State.bridgeUp 决定是否重试——bridgeUp 为 true 时
    // 一次拉取失败会静默放弃,translateOwn 永远不同步。改为:没同步成功就持续重试(≤30 次/60 秒)。
    // btipc07 防重入(2026-10-04 07:00 实车):boot() 与 onBridgeAlive() 都会调它,而 cfgSyncing 以前
    // 只在 onBridgeAlive 里置位 —— 当晚 config 被并行拉 3 次(07:00:02 超时 / 07:00:33 一次 25.6s /
    // 07:00:59 一次 28.4s),单槽队列白占 85s,把 gamenames/quickchat 握手挤到 07:01:27 才开始。
    // 改为:cfgSyncing 由本函数自管,已在途时直接把 callback 挂到等待列(不新开循环)。
    if (State.cfgSyncing) {
      if (callback) {
        if (!State.cfgSyncWaiters) State.cfgSyncWaiters = [];
        State.cfgSyncWaiters.push(callback);
      }
      return;
    }
    State.cfgSyncing = true;
    let attempts = 0;
    const MAX_SYNC_ATTEMPTS = 30;
    const finish = function () {
      State.cfgSyncing = false;
      if (callback) callback();
      const ws = State.cfgSyncWaiters || [];
      State.cfgSyncWaiters = [];
      for (let i = 0; i < ws.length; i++) ws[i]();
    };
    const trySync = function () {
      attempts += 1;
      // 2026-10-16:issued 同步抛(面板未建好等)不能把 cfgSyncing 卡死 —
      // 卡死则本会话再无同步。抛了按重试走,不静默放弃。
      try {
        bridgePost("config", {}, function (res) {
        if (res && res.ok && res.config) {
          const c = res.config;
          applyBridgeConfig(c, State.cfgSynced ? "cfg-watch" : "boot");
          if (typeof res.rev === "string") State.cfgRev = res.rev;
          State.cfgSynced = true;
          startCfgWatch();
          finish();
        } else if (attempts < MAX_SYNC_ATTEMPTS) {
          // 拉取失败(桥未就绪/网络抖动/面板未构建):无条件重试,不再依赖 bridgeUp
          $.Schedule(2.0, trySync);
        } else {
          finish();
        }
        });
      } catch (eSync) {
        log("boot: config sync THREW " + expErr(eSync));
        if (attempts < MAX_SYNC_ATTEMPTS) { try { $.Schedule(2.0, trySync); } catch (eS) { finish(); } }
        else finish();
      }
    };
    trySync();
  }

  // ================= btipc07:数据同步两段式(health/gamenames/quickchat) =================
  // 下行只有 ~12.6 B/s(docs/btipc-v1.md §9:16B/帧 × 0.79s/帧),9.5KB/39KB 全量同步
  // 物理不可行(14~46 分钟),所以:
  //   ① 握手只报指纹 —— 桥相同就回 same=1,一条数据都不传(常态:打包内烘焙值与桥同源);
  //   ② 不同才分片,片长按【字节】限(90B ≈ 8 帧 ≈ 7s + 3.5s 固定开销 ≈ 11s/片),
  //      低于出站 15s 丢弃线;片间等队列空再拉,翻译优先(单槽队列,不让位会卡死翻译);
  //   ③ 桥能读到客户端那版兜底时给的是 delta(增删改),通常 1~2 片 ≈ 半分钟。
  const SYNC_LIM_BYTES = 90;
  const SYNC_MAX_CHUNKS = 400; // 护栏:90B × 400 = 36KB,够两份语料全量还有余量
  const SYNC_MAX_TRIES = 3; // 每会话最多重试次数(避免桥一直回错时每 15s 刷一条失败日志)

  /**
   * 两段式取数。
   * @param {string}   op        bridgePost 的 op 名(gamenames / quickchat)
   * @param {string}   localFp   本地指纹(握手第一发)
   * @param {function} onSame    指纹一致时调用(标记 synced),返回是否算成功
   * @param {function} onApply   收到完整载荷时调用 (text, res) -> bool
   * @param {function} callback  (ok) 收尾
   */
  function syncViaBtipc(op, localFp, onSame, onApply, callback) {
    const fail = function (why) {
      log(op + " sync failed: " + why);
      if (callback) callback(false);
    };
    const pull = function (off, acc, chunks, exp) {
      if (chunks > SYNC_MAX_CHUNKS) { fail("budget exceeded at " + chunks + " chunks"); return; }
      // fp 恒为【客户端本地指纹】(握手与分片一致,桥才能每次算出同一份载荷);
      // exp 是握手时桥回的指纹,用于让桥发现"拉到一半配置被重建"。
      const body = { fp: localFp || "" };
      if (off !== null) { body.off = off; body.lim = SYNC_LIM_BYTES; if (exp) body.exp = exp; }
      bridgePost(op, body, function (res) {
        if (!res || !res.ok) { fail((res && res.error) || "bridge_error"); return; }
        if (res.same) { if (callback) callback(onSame(res) !== false); return; }
        if (off === null) {
          // 握手回包:拿到桥侧指纹后才开拉
          if (!res.fingerprint) { fail("bad_handshake"); return; }
          pull(0, "", 1, res.fingerprint);
          return;
        }
        if (typeof res.part !== "string") { fail("bad_chunk"); return; }
        const next = acc + res.part;
        const nextOff = (Number(res.off) || 0) + res.part.length;
        if (res.done) {
          if (!next) { fail("empty_payload"); return; }
          if (callback) callback(onApply(next, res) !== false);
          return;
        }
        // 让位:队列里还有活就等它做完(翻译优先),再拉下一片
        const again = function () {
          if (State.queue.length > 0 || State.activeRequests > 0) { $.Schedule(1.0, again); return; }
          pull(nextOff, next, chunks + 1, exp);
        };
        $.Schedule(0.3, again);
      });
    };
    pull(null, "", 0, null);
  }

  // 应用名单载荷:delta 就地增删改,全量整体替换。重建失败保留旧名单(不覆盖)。
  function applyNamesPayload(text, res) {
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    if (!data || typeof data !== "object") { log("gamenames sync: payload not JSON"); return false; }
    let map = null;
    if (data.delta) {
      const base = State.gamenamesMap && typeof State.gamenamesMap === "object" ? State.gamenamesMap : {};
      map = {};
      for (const k of Object.keys(base)) map[k] = base[k];
      const add = data.added || {};
      for (const k of Object.keys(add)) map[k] = add[k];
      const chg = data.changed || {};
      for (const k of Object.keys(chg)) map[k] = chg[k];
      for (const k of (data.removed || [])) delete map[k];
    } else if (data.names && typeof data.names === "object") {
      map = {};
      for (const k of Object.keys(data.names)) {
        if (k === "english" || k === "schinese") continue; // 元字段,非游戏名
        map[k] = data.names[k];
      }
    }
    if (!map || Object.keys(map).length === 0) { log("gamenames sync: empty payload"); return false; }
    if (!rebuildGameNames(map)) return false;
    State.gamenamesMap = map;
    State.gamenamesFp = data.fingerprint || res.fingerprint || State.gamenamesFp;
    log("gamenames sync applied: " + Object.keys(map).length + " entries via " + (data.delta ? "delta" : "full"));
    return true;
  }

  // btipc07:启动即装打包内烘焙的全量配对名单。相对硬编码 100 条的好处:
  //   ① 覆盖面翻倍(292 条,来自本机游戏本地化,随 mod 一起发布);
  //   ② 随文件烘焙了指纹 LCT_GAMENAMES_PAIRS_FP —— 桥端握手能 1 帧判定"要不要传",
  //      否则硬编码那 100 条根本没有指纹,每局都会被判不一致、白传一次名单。
  function initBakedGameNames() {
    try {
      if (typeof LCT_GAMENAMES_PAIRS === "undefined" || !LCT_GAMENAMES_PAIRS) return;
      const baked = LCT_GAMENAMES_PAIRS;
      if (!rebuildGameNames(baked)) return;
      State.gamenamesMap = baked;
      if (typeof LCT_GAMENAMES_PAIRS_FP === "string" && LCT_GAMENAMES_PAIRS_FP) {
        State.gamenamesFp = LCT_GAMENAMES_PAIRS_FP;
      }
      log("game names: baked pairs loaded (" + Object.keys(baked).length + ", fp=" + State.gamenamesFp + ")");
    } catch (e) {
      log("game names: baked pairs init THREW " + expErr(e));
    }
  }

  // 从桥拉取游戏名保护名单(op=config 的 get=gamenames)。
  // 成功则用全量名单(原始大小写)覆盖硬编码兜底 PROTECT_NAMES / PROTECT_TO_ZH 并重建正则;
  // 失败则保留现有名单(不覆盖),有限重试。
  function syncGameNames(callback) {
    if (State.gamenamesTries >= SYNC_MAX_TRIES) { if (callback) callback(); return; }
    State.gamenamesTries = (State.gamenamesTries || 0) + 1;
    syncViaBtipc(
      "gamenames",
      State.gamenamesFp,
      function (res) {
        // 常态路径:打包烘焙值与桥同源,一条数据都不传。这条日志是验收唯一可见的证据
        // (2026-10-04 07:00 实车发现:此处以前静默,只能靠桥端 out=110B 反推)。
        log("gamenames sync: fingerprint match, no transfer (" +
          ((res && res.count) || (State.gamenamesMap && Object.keys(State.gamenamesMap).length) || "?") + " entries)");
        return true;
      },
      applyNamesPayload,
      function (ok) {
        if (ok) State.gamenamesLoaded = true;
        if (callback) callback();
      }
    );
  }

  function boot() {
    try { LCTBTIPC.init({ State: State, log: log, expErr: expErr, nowMs: nowMs, findChild: findChild, getRoot: getRoot, isValid: isValid, BRIDGE_HOST: BRIDGE_HOST, BRIDGE_PORT: BRIDGE_PORT, markBridgeUp: markBridgeUp, setBridgeStatus: setBridgeStatus, t: t }); } catch (eI) {}
    State.cfg = loadUiConfig();
    applyUILang(); // 初始化界面语言
    ensureBridgeEvents(); // 尽早注册 HTML 面板事件(读回主通道)
    registerUmmSettings(); // UMM 设置联动(UMM 不在时为无害空操作,见 ummCurrentValues 注释)
    initBakedGameNames(); // btipc07:先装打包内烘焙的全量配对名单(292 条,硬编码只有 100 条)
    // 2026-10-16:启动同步等探针定论后再发(见 startCfgSync/waitProbeForSync),t=0 直发必走慢通道。
    applyUILang(); // 初始化界面语言(配置同步后应用)
    updateBridgeDot(); // 初始状态:桥未上线前显示红点
    // https 面板通道探针(2026-10-15 立项,2026-10-28 改独立槽):与翻译单槽并行,不再让路重试;
    // 判死后由主循环按 HTTPS_PANEL_REPROBE_MS 自动重探(见 maybeProbeHttpsPanel)。
    try { $.Schedule(1.2, maybeProbeHttpsPanel); } catch (eP) {}
    try { $.Schedule(2.0, waitProbeForSync); } catch (eW) { startCfgSync(); }
    // EXP6734-B/C/D/E: 手动触发(进对局后聊天输入 /bt6734b | /bt6734c | /bt6734d | /bt6734e);6734-A 已采完不自动跑
    // DMM 用户引导:启动后 12s 桥仍未在线 => 面板显示未运行 + 安装指引
    $.Schedule(12.0, checkBridgeMissing);
    $.Schedule(SLOW_POLL_SECONDS, scanChatMessages);
    // 桥健康探测(每 5 秒;与翻译请求共用串行队列,量极小不影响翻译)
    $.Schedule(2.0, function healthLoop() {
      healthCheck();
      $.Schedule(5.0, healthLoop);
    });
    // clearTimeout 语义探针(一次性,审查 F6 游戏内实测):$.Schedule 返回的句柄能否被
    // clearTimeout 取消,决定旧面板通道 outgoing 超时(handleBridgePayload 里
    // clearTimeout(job._timeout),句柄来自 $.Schedule)是否会晚到双结算 finishJob
    // → 槽位超发(MAX_ACTIVE_REQUESTS=1 被击穿)。每次启动 1 行日志,两种结果互斥:
    //   FIRED     = clearTimeout 对 $.Schedule 无效(风险实锤)
    //   CANCELLED = 可取消(风险排除)
    try {
      let _ctFired = false;
      const _ctH = $.Schedule(1.5, function () {
        _ctFired = true;
        log("ctprobe: FIRED (clearTimeout 不能取消 $.Schedule) typeof setTimeout=" +
            typeof setTimeout + " clearTimeout=" + typeof clearTimeout);
      });
      try { clearTimeout(_ctH); } catch (e) { log("ctprobe: clearTimeout THREW " + expErr(e)); }
      $.Schedule(3.5, function () {
        if (!_ctFired) log("ctprobe: CANCELLED (clearTimeout 可取消 $.Schedule) typeof setTimeout=" +
            typeof setTimeout + " clearTimeout=" + typeof clearTimeout);
      });
    } catch (e) { log("ctprobe: setup THREW " + expErr(e)); }
    // v2(F6 修复采用的取消器):CancelScheduled 语义验证。1.6s 本该触发,先取消;
    // 3.6s 时报结果 —— CANCELLED = 修复可用;FIRED = 该 API 无效,需回退方案。
    try {
      let _v2Fired = false;
      const _ctH2 = $.Schedule(1.6, function () {
        _v2Fired = true;
        log("ctprobe2: FIRED (CancelScheduled 无效!)");
      });
      if (typeof $.CancelScheduled === "function") { $.CancelScheduled(_ctH2); }
      else { log("ctprobe2: CancelScheduled 不存在(修复无效,需回退方案)"); }
      $.Schedule(3.6, function () {
        if (!_v2Fired) log("ctprobe2: CANCELLED (CancelScheduled 生效,F6 修复可用)");
      });
    } catch (e) { log("ctprobe2: THREW " + expErr(e)); }
    // 日志缓冲兜底冲刷(每 8 秒;确保不丢最后一小批)
    $.Schedule(8.0, function logLoop() {
      flushChatLog();
      $.Schedule(8.0, logLoop);
    });
  }

  // ---- P4a 分区:向探针文件 lingua_chat_exp.vjs_c 发布核心顶层绑定(2026-10-12)----
  // 名单与探针文件头的别名导入由同一份计算生成、逐项对账,tests/lc_p4_partition.test.js 钉死。
  globalThis.LCTNS = globalThis.LCTNS || {};
  LCTNS.BRIDGE_HOST = BRIDGE_HOST;
  LCTNS.BRIDGE_PORT = BRIDGE_PORT;
  LCTNS.BTIPC = BTIPC;
  LCTNS.CHAT_INPUT_ID = CHAT_INPUT_ID;
  LCTNS.LOCAL_CLIENT_ID = LOCAL_CLIENT_ID;
  LCTNS.State = State;
  LCTNS.VERSION = VERSION;
  LCTNS.boot = boot;
  LCTNS.childAt = childAt;
  LCTNS.childCount = childCount;
  LCTNS.clearInput = clearInput;
  LCTNS.collectText = collectText;
  LCTNS.expErr = expErr;
  LCTNS.findChild = findChild;
  LCTNS.findClass = findClass;
  LCTNS.getRoot = getRoot;
  LCTNS.hasClass = hasClass;
  LCTNS.isValid = isValid;
  LCTNS.log = log;
  LCTNS.nowMs = nowMs;
  LCTNS.readMessageRow = readMessageRow;
  LCTNS.resolveChatMessages = resolveChatMessages;
  LCTNS.resolveHudMessages = resolveHudMessages;
  LCTNS.resolveLobbyMessages = resolveLobbyMessages;
  LCTNS.safeText = safeText;
  LCTNS.t = t;
  LCTNS.triggerStockSubmit = triggerStockSubmit;

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