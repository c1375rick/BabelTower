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
  const VERSION = "1.0.10-6726-btipc07d"; // 1.0.10 (2026-10-10) 发布 GitHub(tag v1.0.10) + GameBanana(前版 1.0.9 于 2026-10-09 发布 tag v1.0.9);升版时须同步 tests/lc_btipc_guard.test.js 的正则;1.0.10 内容:B1 安全修复(删 GET ?d= 写通道→410 + 跨站守卫三闸 + ACAO 10 处收敛,桥侧活体 5/5 验证)+ F6($.Schedule 取消改走 $.CancelScheduled/cancelSched 助手 + ctprobe-v2,修 clearTimeout 实测无效→双 finishJob 槽位超发)+ P0-2 doneFail/pumpQueue 双结算修复(settle 留痕,游戏内 E2E 实证)+ 统一测试入口 tests/run-tests.js(显式清单 24 项,决策 node:test)+ docs/compatibility.md 基线存档与冻结清单;前版 1.0.9 内容:/tr 面板 660x600->580x520 + 关闭按钮从标题栏移到底部 footer(顶部被原版 HUD 遮挡点不到)+ 5 处文档口径改「点右下角 X 关闭」+ 7 项脚本缺陷修复;前版 1.0.8 内容:btipc07(health/quickchat/gamenames 迁 BTIPC + 292 条名称保护动态同步)+ 崩溃修复(TargetHeroImage)+ 缺陷 A(dispatchJob 同步异常补记账,修单槽泄漏导致出站队列永久停摆);承 btipc05d 实车首验收口:op=config 读死线 35s→50s + op 忙等窗 37s→52s —— 05c 实车首验已验通(THREW 23→0、requeue 洪水 666→0、开机读 DONE frames=38 bytes=375、boot: config synced、回声 DONE frames=1 每 15s 稳定),但成功那读 total=30229ms 而另一次正好卡在 35025ms、帧只到 seq=22/38:首发起跑竞态(r=1 全404/混BUSY)白烧 5~6 轮 ×2.5s STORM 罚时 + 中途 CRC 重试,35s 余量仅 4.8s,约 1/3 概率超时白等再重试;50s 覆盖最坏 ≈43s。承 btipc05c:① 恢复被误删的 `} else {`(05b 里 op=config 掉进 if(test) → payload undefined → dispatch THREW ×23,test 被覆盖成 op=config)+ ② pumpQueue _btipcDeferred break(消 while 原地自旋刷 requeue 洪水 → 桥 tail 迟 7~24s → 回声超时 → CRC 风暴);承 btipc05b:读写死线分离 + 写应答瘦身 + 面板开读用开机 mask;承 btipc05:BTIPC v1 + ⑥上层整合(出站 TRQ/入站 chat/保存测试读配置 op/健应回声);前版 btipc04

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
  const BRIDGE_ALIVE_SECONDS = 1.5;
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
  let PROTECT_RE = new RegExp(
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
  
  // ---- 中文游戏名保护(双向翻译:中文名→英文占位→翻译→还原) ----
  // 从 PROTECT_TO_ZH 反转构建 { 中文译名 -> 英文原名 }
  let ZH_TO_EN = {};
  let ZH_PROTECT_RE = null;
  
  function buildZhProtectRe(zhNames) {
    if (!zhNames || zhNames.length === 0) return null;
    // 按长度降序,避免短名误匹配长名子串
    const sorted = zhNames.slice().sort((a, b) => b.length - a.length);
    const escaped = sorted.map(n => n.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
    return new RegExp("(?:" + escaped.join("|") + ")", "g");
  }
  
  /** 占位替换中文游戏名:lookup = {中文名 -> 英文原名};返回 { text, zhNameMap } */
  function replaceChineseGameNames(text, lookup) {
    if (!text || typeof text !== "string" || !ZH_PROTECT_RE) return { text: text, zhNameMap: null };
    try {
      const zhNameMap = [];
      const replaced = text.replace(ZH_PROTECT_RE, function (match) {
        const idx = zhNameMap.length;
        zhNameMap.push(lookup ? (lookup[match] || match) : match);
        return "LCTZHPH" + idx;
      });
      return zhNameMap.length > 0 ? { text: replaced, zhNameMap: zhNameMap } : { text: text, zhNameMap: null };
    } catch (e) {
      log("replaceChineseGameNames error: " + (e && e.message ? e.message : String(e)));
      return { text: text, zhNameMap: null };
    }
  }
  
  /** 还原中文名占位符 */
  function restoreChineseGameNames(text, zhNameMap) {
    if (!text || !zhNameMap) return text;
    for (let i = 0; i < zhNameMap.length; i++) {
      text = text.split("LCTZHPH" + i).join(zhNameMap[i]);
    }
    return text;
  }

  // 由英文名数组(原始大小写)重建占位正则:按长度降序,避免子串误匹配
  function buildProtectRe(names) {
    const sorted = names.slice().sort((a, b) => b.length - a.length);
    const escaped = sorted.map(n => String(n).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'));
    return new RegExp("\\b(?:" + escaped.join("|") + ")\\b", "gi");
  }
  PROTECT_RE = buildProtectRe(PROTECT_NAMES);

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
    // 重建中文名反向表
    ZH_TO_EN = {};
    for (const en of Object.keys(toZh)) {
      const zh = toZh[en];
      if (zh) ZH_TO_EN[zh] = en;
    }
    ZH_PROTECT_RE = buildZhProtectRe(Object.keys(ZH_TO_EN));
    log("game names synced from bridge: " + names.length + " entries");
    return true;
  }

  /** 占位替换:lookup = {匹配文本 -> 目标译名};返回 { text, nameMap, originalText } */
  function replaceGameNames(text, lookup) {
    if (!text || typeof text !== "string") return { text: text, nameMap: null, originalText: text };
    const originalText = text;
    try {
      const nameMap = [];
      const replaced = text.replace(PROTECT_RE, function (match) {
        const idx = nameMap.length;
        nameMap.push(lookup ? (lookup[match.toLowerCase()] || match) : match);
        return "LCTPH" + idx;
      });
      return nameMap.length > 0 ? { text: replaced, nameMap: nameMap, originalText: originalText } : { text: text, nameMap: null, originalText: originalText };
    } catch (e) {
      log("replaceGameNames error: " + (e && e.message ? e.message : String(e)));
      return { text: text, nameMap: null, originalText: originalText };
    }
  }
  /** 还原占位符(LCTPHi 格式;与桥侧 name_protect.restore 同一套规则)
   *  2026-09-17 重写,修复两个历史 bug:
   *  ① 前缀碰撞:旧实现按 i 升序 replace("LCTPH"+i),LCTPH1 是 LCTPH10 的前缀,
   *     ≥10 个受保护名时两位编号被个位编号吃掉一位("LCTPH10"→"乙0");
   *  ② 死兜底:旧 fallback 匹配 [[G_i]] 格式,与实际产出的 LCTPHi 从未对齐(死代码),
   *     API 啃坏 token 时占位原文直接泄漏到玩家屏幕。
   *  改为带编号捕获组的单趟全局替换,容忍空格/大小写变化。 */
  function restoreGameNames(text, nameMap) {
    if (!text || !nameMap) return text;
    return String(text).replace(/LCTPH\s*(\d{1,3})/gi, function (m, num) {
      const idx = parseInt(num, 10);
      if (!(idx >= 0 && idx < nameMap.length)) return m; // 未知编号:原样保留
      return nameMap[idx] || m;
    });
  }

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
    btnHint: { zh: "选项点击选择 · 改完点保存 · 点右下角 X 关闭", en: "Click to select \u00b7 Save when done \u00b7 Click X to close" },
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

  // ===== 诊断探针(2026-09-17 快捷消息不显示排查,临时;确认根因后移除) =====
  // 背景:用户报告部分快捷消息语音正常但聊天栏+HUD都不渲染,且当局 mod 零记录。
  // 假设:消息行根本没被创建进 DOM(语音走游戏音频层,不经过 Panorama 渲染)。
  // 探针1:quick 行被读到时打一行日志(去重);探针2:boot 后每 15s 打容器行数(变化时)。
  // 判读:日志有 quick row 且当局有 chatlog → 渲染在,问题在显示;无 quick row + rows=0 → 行未创建(布局层断)
  const diagSet = new Set();

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
  // 快捷语音/轮盘消息网络上传输的是本地化 key+参数,每个客户端用自己的游戏语言渲染
  // (中文玩家看到 "我看到 McGinnis",英文玩家看到 "I see McGinnis")——
  // 官方本地化层就是翻译本身,mod 再翻一遍都只是劣质重复译文。
  //
  // 旧方案(已废弃的屎山):桥生成 253 条巨型正则 + 客户端硬编码兑底正则。
  //   参数转义/量词(叠标点漏网 "Venator不见了！！！")/双语覆盖/新模板跟随,每个维度都是漏网面。
  // 新方案:模板 = token 序列(param | fixed)。匹配 = 归一化(去空白/小写)后 token 走查:
  //   fixed 必须逐字命中;param 消费 ≥1 字符且只允许【已知游戏名(英/中)】或【不含 CJK 的短 latin 连串】
  //   ——防任意 CJK 通配误杀真人消息("他也不见了")。尾部标点先剥(兼容 HUD 叠标点渲染)。
  //   语料:桥同步(/api/v1/quickchat,游戏更新自动跟随);兑底 lingua_chat_quickchat_fallback.js(自动生成)。
  //   参数约束表:lingua_chat_gamenames_fallback.js(英雄/物品/能力名,自动生成)。
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
    if (record.quick) {
      // 游戏原生快捷短语/Ping 已由游戏本地化,不调用翻译接口。
      // 但 DOM 标记的可信度分容器:
      //   · 聊天/大厅行 → PingLabel 是专用标记,直接可信(16/26 红 fixture 基线原样不动);
      //   · HUD 顶栏行 → 统一模板:10-02 exp6738 dump 实锤 PingStyleIcon(+SubjectIcon/
      //     CooldownTimer/ResponseHeroes)是常驻槽位,打字消息同样命中 → 标记不可信,
      //     必须由文本侧再确认"已本地化"才跳过。否则 HUD 气泡 100% 拿不到译文 ——
      //     不止 L3408 直接 return,连 L3378/L3389 的缓存恢复也被 !skipTranslation 拦住,
      //     缓存里有译文也注入不进去。
      //     10-03 实车:hi/gg/防守分路/FOR THE KING RAAAAH 全部 `diag: quick row hud=1` 后
      //     无下文,当天 `translated [hud]` = 0;而 !lcttest ok(无 ping 标记的构造行)
      //     全链路走通 → 管线无问题,是判定过宽。
      const textLocalized = isQuickChatTemplate(text) || (!State.cfg.force && isTargetLanguageText(text));
      if (!record.hud || textLocalized) return true;
      // HUD 行 + 标记存疑(既非已知轮盘语料、也不是目标语言)→ 落到下面的正常判定
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
    pumpQueue();
  }

  function enqueueBridge(op, data, done, isRead) {
    // read:btipc07 的 get 请求应答可能比分片还大(全量语料),必须走 50s 读死线
    // 而不是写死线 8s,否则首发起跑竞态一烧就超时(同 op=config 读的老坑)。
    State.queue.push({ kind: "bridge", op: op, data: data, row: null, sig: null, attempts: 0, done: done, read: !!isRead });
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

  // HTML 面板通道:SetURL 导航 /bridge 页面,轮询 document.title 读回
  // (AsyncWebRequest 被移除的游戏版本唯一可用通道;DLCT 同款机制)
  function dispatchViaPanel(job) {
    const panel = panelNavSuppressed() ? null : ensurePanel();
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
      // 枚举面板可用方法(一次性,看 6726 是否有新导航 API);分两段避免单行过长
      try {
        const names = [];
        for (const k in panel) {
          try { names.push(k + ":" + typeof panel[k]); } catch (e2) {}
        }
        log("diag-panel-props: " + names.slice(0, 70).join(", "));
        log("diag-panel-props2: " + names.slice(70, 160).join(", "));
        log("diag-panel-props3: " + names.slice(160).join(", "));
      } catch (e) {}
      // EXP-6726d-1:枚举全局 $,找 6726 可能新增的 HTTP API(AsyncWebRequest 替代品)
      try {
        const g = [];
        try { for (const k in $) { g.push(k + ":" + typeof $[k]); } } catch (e0) {}
        if (!g.length && typeof Object.getOwnPropertyNames === "function") {
          const ks = Object.getOwnPropertyNames($);
          for (let i = 0; i < ks.length; i += 1) { try { g.push(ks[i] + ":" + typeof $[ks[i]]); } catch (e1) {} }
        }
        log("diag-globals: " + g.slice(0, 100).join(", "));
        log("diag-globals2: " + g.slice(100, 200).join(", "));
        log("diag-globals3: " + g.slice(200).join(", "));
      } catch (e) { log("diag-globals failed: " + (e && e.message ? e.message : String(e))); }
      // EXP-6726d-2:ready-events 实验 — 新引擎可能要求面板 ready 后才接受外部导航;
      // ready 回调触发后立即 SetURL(/bridge?id=r0,health),桥日志若出现该请求 = 导航恢复
      try {
        if (typeof panel.RegisterForReadyEvents === "function") {
          panel.RegisterForReadyEvents(function () {
            let rd = "throw";
            try { rd = String(panel.BReadyForDisplay()); } catch (e) {}
            log("diag-ready: ready event fired; BReadyForDisplay=" + rd);
            try { panel.SetReadyForDisplay(true); } catch (e) {}
            try {
              panel.SetURL("http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/bridge?id=r0&op=health&d=%7B%7D");
              log("diag-ready: SetURL after ready sent (watch bridge log for id=r0)");
            } catch (e2) {
              log("diag-ready: SetURL after ready threw: " + (e2 && e2.message ? e2.message : String(e2)));
            }
          });
          log("diag-ready: RegisterForReadyEvents registered");
        } else {
          log("diag-ready: RegisterForReadyEvents unavailable");
        }
      } catch (e) { log("diag-ready failed: " + (e && e.message ? e.message : String(e))); }
      // EXP-6726e:AsyncWebRequest 函数仍在全局 $ 里但探测失败 — 逐变体记录返回值/异常找真相
      try {
        const AWR = $.AsyncWebRequest;
        try { log("diag-awr: length=" + AWR.length + " name=" + (AWR.name || "?")); } catch (eA) {}
        try {
          const r1 = $.AsyncWebRequest("http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/api/v1/health", { type: "GET", timeout: 3000 });
          log("diag-awr v1: typeof=" + typeof r1 + " ctor=" + (r1 && r1.constructor ? r1.constructor.name : "-") + " str=" + String(r1).slice(0, 80));
          if (r1 && typeof r1.then === "function") {
            r1.then(function (v) { log("diag-awr v1 resolved: " + String(v).slice(0, 100)); }, function (er) { log("diag-awr v1 rejected: " + String(er).slice(0, 120)); });
          }
        } catch (e1) { log("diag-awr v1 threw: " + (e1 && e1.message ? e1.message : String(e1))); }
        try {
          const r2 = $.AsyncWebRequest("http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/api/v1/health");
          log("diag-awr v2: typeof=" + typeof r2 + " str=" + String(r2).slice(0, 80));
        } catch (e2) { log("diag-awr v2 threw: " + (e2 && e2.message ? e2.message : String(e2))); }
        try {
          const r3 = $.AsyncWebRequest("http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/api/v1/health", { type: "GET", success: function (v) { log("diag-awr v3 success: " + String(v).slice(0, 80)); }, error: function (er) { log("diag-awr v3 error: " + String(er).slice(0, 80)); } });
          log("diag-awr v3: typeof=" + typeof r3);
        } catch (e3) { log("diag-awr v3 threw: " + (e3 && e3.message ? e3.message : String(e3))); }
        try {
          const r4 = $.AsyncWebRequest("https://httpbin.org/get", { type: "GET", timeout: 5000 });
          if (r4 && typeof r4.then === "function") {
            r4.then(function (v) { log("diag-awr v4 resolved: " + String(v).slice(0, 100)); }, function (er) { log("diag-awr v4 rejected: " + String(er).slice(0, 120)); });
          } else { log("diag-awr v4: typeof=" + typeof r4); }
        } catch (e4) { log("diag-awr v4 threw: " + (e4 && e4.message ? e4.message : String(e4))); }
      } catch (e0) { log("diag-awr failed: " + (e0 && e0.message ? e0.message : String(e0))); }
      // EXP-6726f:Image 面板远程加载探针 — JS 侧最后的网络 I/O 残留路径。
      // 动态建 Image 面板 SetImage(桥 /test.png?id=f1),桥日志出现 IMG-HIT 即通道活;
      // 同时给 HTML 桥面板也发一次(它若连图都不加载 = 网络栈彻底禁用)
      try {
        const imgUrl = "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/test.png?id=f" + (State.imgProbeCount = (State.imgProbeCount || 0) + 1);
        let imgPanel = null;
        try { imgPanel = findChild(getRoot(), "LCTImgProbe"); } catch (eI0) {}
        if (!isValid(imgPanel)) {
          try { imgPanel = $.CreatePanel("Image", getRoot(), "LCTImgProbe"); } catch (eI1) {}
          if (isValid(imgPanel)) { try { imgPanel.visible = false; imgPanel.style.width = "2px"; imgPanel.style.height = "2px"; } catch (eI2) {} }
        }
        if (isValid(imgPanel) && typeof imgPanel.SetImage === "function") {
          try { imgPanel.SetImage(imgUrl); log("diag-img: SetImage sent -> " + imgUrl); } catch (eI3) { log("diag-img: SetImage threw: " + (eI3 && eI3.message ? eI3.message : String(eI3))); }
        } else { log("diag-img: Image panel unavailable" + (imgPanel ? " (no SetImage)" : "")); }
        try {
          const hp = ensurePanel();
          if (isValid(hp) && typeof hp.SetImage === "function") { hp.SetImage(imgUrl); log("diag-img: html-panel SetImage sent"); }
        } catch (eI4) {}
      } catch (eI) { log("diag-img failed: " + (eI && eI.message ? eI.message : String(eI))); }
      // EXP-6726g→h:尺寸回读探针。g 结论:visible=false 时布局恒 0(不可见面板不参与布局);
      // h 修正:面板完全可见 + 零尺寸样式,读 6 个布局指标。若仍 0 = 引擎不用固有尺寸布局,尺寸信道不通
      try {
        let dimPanel = findChild(getRoot(), "LCTDimProbe");
        if (!isValid(dimPanel)) {
          try { dimPanel = $.CreatePanel("Image", getRoot(), "LCTDimProbe"); } catch (eD1) {}
          // h:不做任何隐藏/样式处理 — 可见、无 width/height,左上角短暂出现 133x77 黑块可接受(探针)
        }
        if (isValid(dimPanel)) {
          State.dimPoll = (State.dimPoll || 0) + 1;
          const myPoll = State.dimPoll;
          try { dimPanel.SetImage("http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/dim.png?id=h" + myPoll); } catch (eD3) {}
          log("diag-dim: SetImage sent (poll #" + myPoll + ", visible panel)");
          let samples = 0;
          const readDim = function () {
            if (myPoll !== State.dimPoll) return;
            samples += 1;
            try {
              const parts = [
                "aw=" + dimPanel.actuallayoutwidth,
                "ah=" + dimPanel.actuallayoutheight,
                "cw=" + dimPanel.contentwidth,
                "ch=" + dimPanel.contentheight,
                "dw=" + dimPanel.desiredlayoutwidth,
                "dh=" + dimPanel.desiredlayoutheight,
              ];
              log("diag-dim #" + samples + ": " + parts.join(" ") + " (target 133x77)");
            } catch (eD5) { log("diag-dim #" + samples + ": read threw"); }
            if (samples <= 30) {
              try { $.Schedule(0.2, readDim); } catch (eD6) {}
            } else {
              log("diag-dim: done (30 samples)");
              try { dimPanel.visible = false; } catch (eD7) {}
            }
          };
          try { $.Schedule(0.2, readDim); } catch (eD7) { log("diag-dim: Schedule unavailable"); }
        } else {
          log("diag-dim: panel unavailable");
        }
      } catch (eD) { log("diag-dim failed: " + (eD && eD.message ? eD.message : String(eD))); }
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
    const url = buildBridgeUrl(job);
    setPending(job.id, function (payload) {
      handleBridgePayload(job, payload);
    }, job.kind === "outgoing" ? OUTGOING_TIMEOUT_MS : (State.cfg.timeoutMs || 15000));
    // DIAG-6726:记录每次导航目标(去 query 串,避免刷长文本),确认请求确实发出
    State.diagNavCount = (State.diagNavCount || 0) + 1;
    if (State.diagNavCount <= 5 || State.diagNavCount % 20 === 0) {
      log("diag-nav #" + State.diagNavCount + " -> " + String(url.split("?")[0] || "") + " (q=" + String(url.split("?")[1] || "").slice(0, 30) + "...)");
    }
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

  // ===== ⑥ 上层整合:出站翻译走 BTIPC(规格 docs/btipc-v1.md §7/§8;checklist §14)=====
  // btipc04 扩展:入站 chat 同路复用 —— chat 发裸文本(桥回退出站外的默认 target=zh-Hans),
  // 出站发信封。函数名保留 outgoing(调用方/日志前缀按 kind 区分:outgoing btipc / chat btipc)。
  // 信封(上层约定,行/帧/窗口协议零改动):payload 首行 "t=<target>;tm=<ms>" + "\n" + 原文。
  // 目标语言必须随请求走:桥 config 的 defaults.targetLanguage 是入站目标(zh-Hans),
  // 出站 outgoingTarget 默认 en,不带就会译反方向。
  // 返回 true = 本 job 由 BTIPC 接管(结算在回调内闭环);false = 回落旧通道(直连/HTML 面板)。
  // 失败语义对齐旧通道(spec §8 + 既有 attempts 策略):响应型失败(桥收到请求但翻译失败,
  // 空 END 帧 → translate_error)走 handleBridgePayload 重试 ≤1 次;传输型失败
  // (timeout/crc_dead/bridge_down)按原文发送不重试;busy/too_long/目标语言不安全 → 回落旧通道。
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
      const isOp = job.kind === "bridge" && (job.op === "config" || job.op === "test");
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
        } else {
          // btipc05b:读/写死线分离。读应答 maskCompact ≈400B=40 帧 × 真机 600ms/帧
          // ≈24s —— 原 8s 必超时(实车 config FAIL 34 连败的根因);写应答已瘦到
          // {ok:true}(9B/1帧≈3s)维持 8s 快速失败。
          // btipc05c:此 `else` 曾被误删 → op=config 整块跳过、payload 停在 undefined
          // → L2369 btipcUtf8Bytes(undefined).length 必炸(实车 dispatch THREW ×23),
          // 且 op=test 会被随后的 config 赋值覆盖成 "op=config\n{}"(测试按钮发错载荷)。
          // btipc05d:35s → 50s。05c 实车首验:成功那读 total=30229ms,而另一次
          // 正好卡在 35025ms、帧只到 seq=22/38 —— 首发起跑竞态(r=1 全 404/混 BUSY)
          // 会白烧 5~6 轮 ×2.5s(STORM 罚时),再叠加中途 CRC 重试,35s 余量仅 4.8s,
          // 实测约 1/3 概率超时 → 白等 35s 再重试。50s 覆盖「竞态 15s + 38 帧 23s +
          // 中途 2 次 STORM 5s」≈43s 的最坏情形。写仍 8s(1 帧,无帧竞态问题)。
          const isRead = !!job.read || String(raw).trim() === "{}";
          payload = "op=config\n" + raw;
          timeoutMs = isRead ? 50000 : 8000;
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
      if (job.kind === "bridge" && (job.op === "config" || job.op === "test")) {
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
    // ⑥ 上层整合:出站翻译 + 入站 chat(btipc04)+ 保存/测试/读配置 op(btipc05)
    // 优先走 BTIPC;接不了(too_long/目标语言不安全/久等仍未空)回落旧通道
    // (6726 后已死 → 翻译兜底原文,op 兜底 {ok:false,error})
    const viaBtipc =
      job.kind === "outgoing" || job.kind === "chat" ||
      (job.kind === "bridge" && (job.op === "config" || job.op === "test"));
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

  function pollTitle() {
    State.polling = false;
    const pending = State.pending;
    if (!pending) return;
    diagTitlePoll();
    const title = readBridgeTitle();
    if (title === TITLE_ALIVE) {
      markBridgeUp();
      pending.sawAlive = true;
      // 导航真的成功过 => 面板通道可用,清掉判死计数与冷却
      State.navDeadStreak = 0;
      State.navDeadUntil = 0;
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
      const snap = navDiagSnapshot();
      // 硬死签名:src 为空 = 引擎压根没开始加载页面(6726 起 SetURL 导航整条失效)。
      // 只有这种才累计判死;页面已加载但没来得及置 alive(有 src)只重置计数,
      // 免得把偶发抖动误判成通道死而长期禁用。
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
      // cfgSyncing 由 syncBridgeConfig 自管(防重入:boot 已在途时这里直接返回,不会起第二个循环)
      syncBridgeConfig();
    }
    // 首次上线:名称保护全量名单 + 快捷语音语料(两段式握手,指纹相同则一条数据都不传)
    if (!State.gamenamesLoaded && !State.gamenamesLoading) {
      State.gamenamesLoading = true;
      syncGameNames(function () { State.gamenamesLoading = false; });
    }
    if (!quickchatSynced && !State.quickchatLoading) {
      State.quickchatLoading = true;
      syncQuickChat(function () { State.quickchatLoading = false; });
    }
    // provider / 版本更新提示:回声只证明桥活着,带不了这些字段 —— 每会话补一次
    // (先置位防重入;失败则复位,下一轮 healthCheck 再补)
    if (!State.healthDetailFetched) {
      State.healthDetailFetched = true;
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
              log("btipc health echo FAIL kind=" + ((err && err.kind) || "unknown"));
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
    // 诊断探针1:读到的 quick 行(去重防刷屏,上限 200 条重置)
    if (record.quick) {
      const dkey = (record.hud ? "H\x00" : "C\x00") + (record.text || "");
      if (!diagSet.has(dkey)) {
        if (diagSet.size > 200) diagSet.clear();
        diagSet.add(dkey);
        log("diag: quick row hud=" + (record.hud ? 1 : 0) + " text=" + String(record.text || "").slice(0, 60));
      }
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
        // 诊断探针3:HUD 容器行数心跳(变化时才打;count=0 持续 → HUD 行未创建)
        if (!State._diagHudRows) State._diagHudRows = [];
        if (count !== State._diagHudRows[i]) {
          State._diagHudRows[i] = count;
          log("diag: HUD[" + i + "] rows=" + count);
        }
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
  // ============ BTIPC v1 客户端(规格 docs/btipc-v1.md;实现顺序④)=============
  // 固定窗口收包:128 个隐藏 Image 面板轮询 /btipc/dl,位=1→200(火焰)/位=0→404;
  // 每轮 16 字节帧 → 内联 CRC16 校验 → 按 seq 拼装。无 ACK:r 前进即确认,同 r 重投即重传(§4.0)。
  // API(§7 冻结 Promise 形):BTIPC.request({windowId, text, timeoutMs}) → Promise<文本>。
  // 当前回声模式(桥端③已就);⑥接翻译链后调用方不变。Panorama 无模块系统,crc16/decode 内联(§3.2 逐字节一致)。
  const BTIPC_PANEL_PREFIX = "BTIPCD"; // 0..127;与 BTBIT*/BTD*/BTE* 探针严格隔离
  const BTIPC_PANELS = 128;
  const BTIPC_FRAME_BYTES = 16;
  const BTIPC_PAYLOAD_MAX = 10;
  const BTIPC_T_CLOSE_MS = 600; // §9 常态收口(新 build bit dt P99.9 ≈ 522ms)
  const BTIPC_STORM_TCLOSE_MS = 2500; // §9 风暴收口
  const BTIPC_STORM_TRIGGER = 2; // 连续 CRC fail 轮数 → 风暴(§4.1)
  const BTIPC_STORM_ROUNDS = 4; // 风暴持续轮数
  const BTIPC_BUSY_BACKOFF_MS = 500; // BUSY 退避
  const BTIPC_T_HARD_MS = 12000; // 轮级强制闭合兜底(§4)
  const BTIPC_REQ_TIMEOUT_MS = 30000; // 消息级死线(§9)
  const BTIPC_CRC_DEAD = 8; // 同帧累计 fail 上限(§7)
  const BTIPC_REQ_MAX_PAYLOAD = 680; // §9:整行(引擎前缀+[LCT]+行头+b64 908)≤1000(J1);68 帧 ≤ seq7 上限
  const BTIPC_FIRST_SHOT_DELAY_MS = 1200; // 首拍延迟:桥 tail 轮询 1000ms,防首批全 404 误触风暴
  // 死线轮询步长。死线改由 Date.now() 锚定(见 BTIPC.request 内 pollDeadline):
  // $.Schedule(N) 的 N 秒在加载窗口内会早于 Date.now() 的 N 秒触发,拿它当死线不可信。
  // 0.25s → 到点最多晚 0.25s 结算;单会话同时只有 1 个在途请求,4 次/秒空转可忽略。
  const BTIPC_DEADLINE_POLL_SEC = 0.25;

  // Date.now() 锚定的延迟结算 —— 所有「到点必须结算」的定时器走这里,不要直接
  // $.Schedule(大 N)。实测(2026-10-04 07:23):config 首读 msg=REQ_TIMEOUT 50000ms
  // 却 dt=20278ms,即 50s 的死线 21 秒就触发;窗口正好是加载进对局(Spawn Server /
  // ss_loading -> ss_active、53.5% 帧 >17.5ms),加载结束后的第二次 25.6s 走满才成功
  // —— 不是固定上限,是长延时的 $.Schedule 早于 Date.now()(同窗口 1.2s/2s/8s 的
  // 短调度都准)。Date.now() 与 console 时间戳互相印证(21s ≈ 20.278s),错的是
  // $.Schedule。早醒只重排、到点才调 fn;alive 返回假即停轮询(等价旧守卫,但不再
  // 空转)。轮询用 0.25s:到点最多晚 0.25s,单会话同时只有 1 个在途请求,开销可忽略。
  function afterRealMs(delayMs, fn, alive) {
    const at = nowMs() + delayMs;
    const tick = function () {
      if (alive && !alive()) return;
      if (nowMs() >= at) { fn(); return; }
      $.Schedule(BTIPC_DEADLINE_POLL_SEC, tick);
    };
    $.Schedule(BTIPC_DEADLINE_POLL_SEC, tick);
  }

  // ---- 内联 CRC-16/CCITT-FALSE(与 core/btipc/crc16.js 逐字节一致) ----
  function btipcCrc16(bytes) {
    let crc = 0xffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc ^= (bytes[i] & 0xff) << 8;
      for (let b = 0; b < 8; b += 1) {
        crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) : crc << 1;
        crc &= 0xffff;
      }
    }
    return crc;
  }

  // ---- 16 字节帧解码(§3.2):CRC 不过直接拒,绝不返回半可信数据 ----
  function btipcDecodeFrame(b) {
    if (!b || b.length !== BTIPC_FRAME_BYTES) return { ok: false, reason: "size" };
    const input = [];
    for (let i = 0; i < 4; i += 1) input.push(b[i]);
    for (let i = 6; i < 16; i += 1) input.push(b[i]); // CRC 覆盖 B0..B3 + B6..B15(固定 14B,含填充)
    const calc = btipcCrc16(input);
    const got = ((b[4] & 0xff) << 8) | (b[5] & 0xff);
    if (calc !== got) return { ok: false, reason: "crc" };
    const valid = (b[3] & 0x80) !== 0;
    const len = b[3] & 0x7f;
    if (len > BTIPC_PAYLOAD_MAX) return { ok: false, reason: "format" };
    if (!valid && (b[0] !== 0 || b[3] !== 0)) return { ok: false, reason: "format" }; // BUSY 固定帧
    const payload = [];
    for (let i = 0; i < len; i += 1) payload.push(b[6 + i]);
    return {
      ok: true, valid: valid, seq: b[0] & 0x7f, end: (b[0] & 0x80) !== 0,
      id: ((b[1] & 0xff) << 8) | (b[2] & 0xff), len: len, payload: payload,
    };
  }

  // ---- UTF-8 字节 → 字符串(引擎无 TextDecoder) ----
  function btipcUtf8Decode(bytes) {
    let out = "";
    let i = 0;
    while (i < bytes.length) {
      const c = bytes[i];
      let cp = 0, extra = 0;
      if (c < 0x80) { cp = c; extra = 0; }
      else if ((c & 0xe0) === 0xc0) { cp = c & 0x1f; extra = 1; }
      else if ((c & 0xf0) === 0xe0) { cp = c & 0x0f; extra = 2; }
      else if ((c & 0xf8) === 0xf0) { cp = c & 0x07; extra = 3; }
      else { out += "\ufffd"; i += 1; continue; }
      let cont = true;
      for (let k = 1; k <= extra; k += 1) {
        const cc = bytes[i + k];
        if (cc === undefined || (cc & 0xc0) !== 0x80) { cont = false; break; }
        cp = (cp << 6) | (cc & 0x3f);
      }
      if (!cont) { out += "\ufffd"; i += 1; continue; }
      i += extra + 1;
      if (cp > 0x10ffff) { out += "\ufffd"; continue; }
      if (cp < 0x10000) out += String.fromCharCode(cp);
      else {
        const v = cp - 0x10000;
        out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
      }
    }
    return out;
  }

  // ---- UTF-8 字符串 → 字节(REQ payload;代理对按码点展开) ----
  function btipcUtf8Bytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i += 1) {
      let cp = str.charCodeAt(i);
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
        const lo = str.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) { cp = 0x10000 + (((cp - 0xd800) << 10) | (lo - 0xdc00)); i += 1; }
      }
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return out;
  }

  // ---- 字节 → base64(引擎无 btoa;REQ 行用) ----
  function btipcBase64(bytes) {
    const tbl = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      out += tbl[b0 >> 2];
      out += tbl[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
      out += b1 === undefined ? "=" : tbl[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
      out += b2 === undefined ? "=" : tbl[b2 & 63];
    }
    return out;
  }

  // ---- 面板池(128 个隐藏 2×2,复用;创建不全时下次调用重建) ----
  function btipcPanels() {
    if (State.btipcPanels && State.btipcPanels.length === BTIPC_PANELS) return State.btipcPanels;
    const arr = [];
    for (let i = 0; i < BTIPC_PANELS; i += 1) {
      const pid = BTIPC_PANEL_PREFIX + i;
      let p = null;
      try { p = findChild(getRoot(), pid); } catch (e) {}
      if (!isValid(p)) {
        try { p = $.CreatePanel("Image", getRoot(), pid); } catch (e) {}
        if (isValid(p)) {
          try { p.visible = false; p.style.width = "2px"; p.style.height = "2px"; } catch (e) {}
        }
      }
      if (isValid(p)) arr.push(p);
    }
    State.btipcPanels = arr;
    return arr;
  }

  // ---- ImageLoaded 每会话注册一次;只认 BTIPCD* 前缀(探针 BTD*/BTBIT*/BTE* 互不干扰) ----
  function btipcEnsureHandler() {
    if (State.btipcHandlerOn) return;
    State.btipcHandlerOn = true;
    try {
      $.RegisterForUnhandledEvent("ImageLoaded", function (panel) {
        const st = State.btipcActive;
        if (!st || !st.roundOpen) return;
        let pid = "";
        try { pid = panel ? String(panel.id) : ""; } catch (e) {}
        if (pid.slice(0, 6) !== BTIPC_PANEL_PREFIX) return;
        const p = parseInt(pid.slice(6), 10);
        if (isNaN(p) || p < 0 || p >= BTIPC_PANELS) return;
        st.fire[p] = 1; // 同轮同面板重复 fire 幂等;上一轮迟到的 straggler 只能撞 CRC 重试(§1)
      });
    } catch (e) { log("btipc: ImageLoaded handler THREW " + expErr(e)); }
  }

  // ---- SHOT:一轮 128 发(§4);URL 对 (w,r,p) 唯一,t = 窗口号-请求号兼缓存击穿 ----
  function btipcShot(st) {
    if (State.btipcActive !== st) return;
    const panels = btipcPanels();
    if (panels.length < BTIPC_PANELS) {
      btipcFinish(st, false, { kind: "bridge_down", message: "panels " + panels.length + "/" + BTIPC_PANELS });
      return;
    }
    st.fire = {};
    st.roundOpen = true;
    st.roundNo += 1;
    st.shotAt = nowMs();
    const urlBase = "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/btipc/dl?w=" + st.win + "&r=" + st.r;
    // t = 窗口号-请求号-轮次。必须含 roundNo:否则同 r 重投的 128 个 URL 逐字节相同,
    // SetImage 撞同一 URL 可能不再触发 ImageLoaded → fire 永远为空 → 重试复现同一次失败(§4 要求 URL 唯一)。
    const tTag = "&t=" + st.win + "-" + st.idHex + "-" + st.roundNo;
    for (let i = 0; i < BTIPC_PANELS; i += 1) {
      try { panels[i].SetImage(urlBase + "&p=" + i + tTag); } catch (e) {}
    }
    const tClose = st.stormRounds > 0 ? BTIPC_STORM_TCLOSE_MS : BTIPC_T_CLOSE_MS;
    const myR = st.r;
    const myNo = st.roundNo;
    try {
      $.Schedule(tClose / 1000, function () { btipcClose(st, myR, myNo); });
      $.Schedule(BTIPC_T_HARD_MS / 1000, function () { btipcClose(st, myR, myNo); }); // T_HARD 兜底(守卫保证只生效一次)
    } catch (e) {
      btipcFinish(st, false, { kind: "bridge_down", message: "schedule THREW " + expErr(e) });
    }
  }

  // ---- 闭合判定(§4.0 判定表写死) ----
  function btipcClose(st, myR, myNo) {
    if (State.btipcActive !== st) return;
    if (!st.roundOpen || st.r !== myR || st.roundNo !== myNo) return; // 已被更早的闭合推进
    st.roundOpen = false;

    // 128 bit → 16 字节(§3.1 LSB first)
    const bytes = [];
    for (let i = 0; i < BTIPC_FRAME_BYTES; i += 1) bytes.push(0);
    for (let p = 0; p < BTIPC_PANELS; p += 1) {
      if (st.fire[p]) bytes[p >> 3] |= 1 << (p & 7);
    }
    const dt = nowMs() - st.shotAt;
    let d = btipcDecodeFrame(bytes);
    if (d.ok && d.id !== st.id) d = { ok: false, reason: "id_mismatch got=" + d.id }; // 防缓存串窗

    if (!d.ok) {
      st.frameFails += 1;
      st.consecutiveFails += 1;
      log("BTIPC: r=" + st.r + " seq=-1 len=-1 dt=" + dt + " RETRY crc=" + d.reason +
          " frameFails=" + st.frameFails + " consec=" + st.consecutiveFails);
      if (st.frameFails > BTIPC_CRC_DEAD) {
        btipcFinish(st, false, { kind: "crc_dead", message: "CRC fail " + st.frameFails + "x > " + BTIPC_CRC_DEAD });
        return;
      }
      let entered = false;
      if (st.consecutiveFails >= BTIPC_STORM_TRIGGER && st.stormRounds <= 0) {
        st.stormRounds = BTIPC_STORM_ROUNDS;
        entered = true;
        log("BTIPC: STORM enter consec=" + st.consecutiveFails + " tClose=" + BTIPC_STORM_TCLOSE_MS + " rounds=" + BTIPC_STORM_ROUNDS);
      }
      const stormNow = st.stormRounds > 0;
      if (stormNow && !entered) st.stormRounds -= 1; // 进入当轮不减,保证宽收口正好 4 轮
      // 同 r 重投(§4.0);风暴期轮间 1s 冷却
      try {
        $.Schedule(stormNow ? 1.0 : 0.1, function () { btipcShot(st); });
      } catch (e) { btipcFinish(st, false, { kind: "bridge_down", message: "schedule THREW " + expErr(e) }); }
      return;
    }

    // ---- CRC ok ----
    st.frameFails = 0;
    st.consecutiveFails = 0;
    if (st.stormRounds > 0) { st.stormRounds = 0; log("BTIPC: STORM exit"); }

    if (!d.valid) {
      // BUSY 固定帧(§3.2):退避后**同 r 重poll**,不 r++。
      // BUSY = “本 window 的 DATA 尚未就绪”,不是新 frame;翻译等待期靠这个反复轮询。
      // 此时桥端尚未 setFrames,不会锚定 frameStartRound,待首个 DATA poll 才锚定。
      log("BTIPC: r=" + st.r + " seq=-1 len=-1 dt=" + dt + " BUSY");
      try {
        $.Schedule(BTIPC_BUSY_BACKOFF_MS / 1000, function () {
          if (State.btipcActive !== st) return;
          btipcShot(st);
        });
      } catch (e) { btipcFinish(st, false, { kind: "bridge_down", message: "schedule THREW " + expErr(e) }); }
      return;
    }

    // 数据帧:按 seq 入账(重复幂等),END 验收 0..max 连续
    if (!st.parts[d.seq]) st.parts[d.seq] = d.payload;
    log("BTIPC: r=" + st.r + " seq=" + d.seq + " len=" + d.len + " dt=" + dt + (d.end ? " END" : " OK"));
    if (!d.end) { st.r += 1; btipcShot(st); return; }

    let maxSeq = -1;
    for (const k in st.parts) { const n = parseInt(k, 10); if (!isNaN(n) && n > maxSeq) maxSeq = n; }
    const concat = [];
    let gap = -1;
    for (let i = 0; i <= maxSeq; i += 1) {
      const pl = st.parts[i];
      if (!pl) { gap = i; break; }
      for (let j = 0; j < pl.length; j += 1) concat.push(pl[j]);
    }
    if (gap >= 0) {
      // 正常流不可能(帧序到达、CRC fail 不推进);真到 = 状态被打破,诚实拒绝
      log("BTIPC: r=" + st.r + " GAP missing=" + gap + " → crc_dead");
      btipcFinish(st, false, { kind: "crc_dead", message: "gap at seq " + gap });
      return;
    }
    const got = btipcUtf8Decode(concat);
    log("BTIPC: DONE win=" + st.win + " id=" + st.idHex + " frames=" + (maxSeq + 1) +
        " bytes=" + concat.length + " total=" + (nowMs() - st.tReq) + "ms");
    // 翻译模式下空串 = 桥端翻译失败(协议零改动:失败编为空 END 帧)。
    // 回声模式不做此判定 —— "" 是合法回声。传输层已 DONE,这里只把语义错误上报给上层。
    if (st.translate && got === "") {
      btipcFinish(st, false, { kind: "translate_error", message: "bridge returned empty translation" });
      return;
    }
    btipcFinish(st, true, got);
  }

  function btipcFinish(st, ok, value) {
    if (State.btipcActive !== st) return;
    State.btipcActive = null;
    st.roundOpen = false;
    if (ok) {
      // btipc04:任何 BTIPC 成功(翻译/健应回声)= 桥在线实证 → 状态栏置绿
      // (6726 后 nav health 永远失败,老逻辑只会显示未连通)。
      State.btipcLastOk = nowMs();
      State.bridgeOfflineSince = 0;
      if (!State.bridgeUp) {
        markBridgeUp();
        try { setBridgeStatus(t("bridgeOnline") + " \u00b7 " + (State.cfg.provider || "bing")); } catch (e) {}
      }
      try { st.resolve(value); } catch (e) { log("btipc: resolve THREW " + expErr(e)); }
    }
    else { try { st.reject(value); } catch (e) { log("btipc: reject THREW " + expErr(e)); } }
  }

  // ---- API(§7 冻结 Promise 形)----
  const BTIPC = {
    busy: function () { return !!State.btipcActive; },
    newWindowId: function () { return ("000000" + (nowMs() & 0xffffff).toString(16)).slice(-6); },
    cancel: function () {
      const st = State.btipcActive;
      if (!st) return;
      try { log("BTIPC CAN w=" + st.win); } catch (e) {}
      btipcFinish(st, false, { kind: "cancelled", message: "cancel() called" });
    },
    request: function (opts) {
      opts = opts || {};
      return new Promise(function (resolve, reject) {
        try {
          const text = String(opts.text == null ? "" : opts.text);
          const bytes = btipcUtf8Bytes(text);
          const win = String(opts.windowId == null ? "" : opts.windowId);
          if (!/^[0-9a-f]{6}$/.test(win)) {
            reject({ kind: "bad_args", message: "windowId 需 6 位小写 hex(BTIPC.newWindowId())" });
            return;
          }
          if (bytes.length > BTIPC_REQ_MAX_PAYLOAD) {
            reject({ kind: "too_long", message: "payload " + bytes.length + "B > " + BTIPC_REQ_MAX_PAYLOAD + "B" });
            return;
          }
          if (State.btipcActive) {
            reject({ kind: "busy", message: "已有在途传输 win=" + State.btipcActive.win });
            return;
          }
          const timeoutMs = typeof opts.timeoutMs === "number" && opts.timeoutMs > 0 ? opts.timeoutMs : BTIPC_REQ_TIMEOUT_MS;
          // translate=false → REQ(回声 conformance);true → TRQ(⑥ 翻译,空 END 帧 = 失败)
          const translate = opts.translate === true;
          const id = Math.floor(Math.random() * 65536);
          const idHex = ("0000" + id.toString(16)).slice(-4);
          const crcHex = ("0000" + btipcCrc16(bytes).toString(16)).slice(-4);
          const b64 = btipcBase64(bytes);
          const st = {
            win: win, id: id, idHex: idHex, text: text, timeoutMs: timeoutMs, translate: translate,
            r: 1, roundNo: 0, fire: {}, roundOpen: false, shotAt: 0,
            frameFails: 0, consecutiveFails: 0, stormRounds: 0,
            parts: {}, tReq: nowMs(), resolve: resolve, reject: reject,
          };
          State.btipcActive = st;
          // REQ/TRQ 行(§5):桥端 tail 自 [LCT] 起解析,行头 54 + b64 后 ≤1000(J1)
          // REQ 与 TRQ 命令词等长,故 translate 不额外占用行预算。
          log("BTIPC " + (translate ? "TRQ" : "REQ") + " w=" + win + " id=" + idHex +
              " len=" + bytes.length + " crc=" + crcHex + " b64=" + b64);
          btipcEnsureHandler();
          try {
            // 缺陷 A 修:死线走 Date.now() 锚定的 afterRealMs。单发 $.Schedule(timeoutMs/1000)
            // 在长延时上会早触发(实测 50s 死线 21s 就到),把本该成功的 config 读打死 ——
            // 详见 afterRealMs 的注释。alive 覆盖旧的 State.btipcActive !== st 守卫。
            afterRealMs(timeoutMs, function () {
              log("BTIPC: REQ_TIMEOUT win=" + st.win + " after " + timeoutMs + "ms");
              btipcFinish(st, false, { kind: "timeout", message: "REQ_TIMEOUT " + timeoutMs + "ms" });
            }, function () { return State.btipcActive === st; });
            $.Schedule(BTIPC_FIRST_SHOT_DELAY_MS / 1000, function () {
              if (State.btipcActive !== st) return;
              btipcShot(st);
            });
          } catch (e) {
            btipcFinish(st, false, { kind: "bridge_down", message: "schedule THREW " + expErr(e) });
          }
        } catch (e) {
          reject({ kind: "bad_args", message: expErr(e) });
        }
      });
    },
  };

  // /bt6736 [n] [text]: BTIPC 回声 conformance(§12.4)—— 桥回声模式,回显必须与发送逐字节一致
  function runBtipcEcho(arg) {
    if (State.bitRunning || State.dRunning || State.eRunning || State.c5) {
      log("btipc6736: 探针在途,refuse(防两套 ImageLoaded 互相污染)");
      return;
    }
    if (BTIPC.busy()) { log("btipc6736: BTIPC busy,先等当前传输结束"); return; }
    let count = 1;
    let text = "Hello BTIPC";
    const m = /^(\d+)(?:\s+([\s\S]+))?$/.exec(String(arg || "").trim());
    if (m) {
      count = Math.max(1, Math.min(100, parseInt(m[1], 10)));
      if (m[2]) text = m[2];
    } else if (String(arg || "").trim()) {
      text = String(arg).trim();
    }
    log("btipc6736: START n=" + count + " text=" + JSON.stringify(text));
    let done = 0;
    let failed = 0;
    const runOne = function () {
      if (done >= count) {
        log("btipc6736: ALL DONE n=" + count + " ok=" + (count - failed) + " fail=" + failed);
        return;
      }
      done += 1;
      const win = BTIPC.newWindowId();
      const t0 = nowMs();
      BTIPC.request({ windowId: win, text: text }).then(function (got) {
        const match = got === text;
        if (!match) failed += 1;
        log("btipc6736: RUN " + done + "/" + count + " win=" + win +
            (match ? " ECHO_OK" : " ECHO_MISMATCH") + " dt=" + (nowMs() - t0) +
            " got=" + JSON.stringify(String(got).slice(0, 60)));
        try { $.Schedule(0.3, runOne); } catch (e) { log("btipc6736: schedule THREW " + expErr(e)); }
      }).catch(function (err) {
        failed += 1;
        log("btipc6736: RUN " + done + "/" + count + " win=" + win + " FAIL kind=" + (err && err.kind) +
            " msg=" + (err && err.message) + " dt=" + (nowMs() - t0));
        try { $.Schedule(1.0, runOne); } catch (e) { log("btipc6736: schedule THREW " + expErr(e)); }
      });
    };
    runOne();
  }

  // /bt6737 [text]: BTIPC 翻译 smoke(⑥)—— 验证 TRQ→BUSY→译文全链。
  // 翻译层只见 BTIPC.request() 的 Promise,不见 panel/CRC/round/frameFails。
  function runBtipcTranslate(arg) {
    if (State.bitRunning || State.dRunning || State.eRunning || State.c5) {
      log("btipc6737: 探针在途,refuse(防两套 ImageLoaded 互相污染)");
      return;
    }
    if (BTIPC.busy()) { log("btipc6737: BTIPC busy,先等当前传输结束"); return; }
    const text = String(arg || "");
    const win = BTIPC.newWindowId();
    const t0 = nowMs();
    log("btipc6737: START text=" + JSON.stringify(text.slice(0, 60)));
    BTIPC.request({ windowId: win, text: text, translate: true }).then(function (got) {
      log("btipc6737: OK win=" + win + " dt=" + (nowMs() - t0) + "ms got=" + JSON.stringify(String(got).slice(0, 80)));
    }).catch(function (err) {
      log("btipc6737: FAIL win=" + win + " kind=" + (err && err.kind) +
          " msg=" + (err && err.message) + " dt=" + (nowMs() - t0) + "ms");
    });
  }

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
    if (State.c5 && exp6734cSubmitHook(input, trimmed)) return;

    if (!trimmed) return;

    // /tr 命令:打开设置面板,不发送
    if (trimmed === "/tr" || trimmed.indexOf("/tr ") === 0) {
      clearInput();
      openSettingsPanel();
      return;
    }

    // /bt6734e: 多值符号判别实验(6734-E),不发送
    if (trimmed === "/bt6734e") {
      clearInput();
      runExp6734E();
      return;
    }

    // /bt6734d [n|win]: Bridge→Panorama 下行吞吐基准(6734-D),不发送
    //   无参 = 全矩阵 D1~D6(16/32/64/96/128/256 面板 × 20 轮);数字 = 单配置;win = 窗口组 W1~W5
    if (trimmed === "/bt6734d" || trimmed.indexOf("/bt6734d ") === 0) {
      const dArg = trimmed.slice(8).trim();
      clearInput();
      runExp6734D(dArg);
      return;
    }

    // /bt6734b: 真实对局延迟测试(6734-B),不发送
    if (trimmed === "/bt6734b") {
      clearInput();
      runExp6734B();
      return;
    }

    // /bt6734c: 输入框控制实验(6734-C),不发送;布防后两段手动 Enter 判定
    if (trimmed === "/bt6734c") {
      runExp6734C(input, trimmed);
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
      runExp6738(p6738Arg);
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
  const BTIPC_GET_OPS = { health: 1, gamenames: 1, quickchat: 1 };

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
    //
    // btipc07 防重入(2026-10-04 07:00 实车):boot() 和 onBridgeAlive() 都会调它,
    // 而 cfgSyncing 以前只在 onBridgeAlive 里置位 —— 当晚 config 被并行拉了 3 次
    // (07:00:02 超时 / 07:00:33 一次 25.6s / 07:00:59 一次 28.4s),单槽队列白占 85s,
    // 把 gamenames/quickchat 握手从 07:00:33 挤到 07:01:27 才开始。
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
          // btipc05b:留全量 mask 给面板秒开(openSettingsPanel 直接消费,免 24s 现场读)
          State.cfg._mask = c;
          State.cfgSynced = true;
          finish();
        } else if (attempts < MAX_SYNC_ATTEMPTS) {
          // 拉取失败(桥未就绪/网络抖动/面板未构建):无条件重试,不再依赖 bridgeUp
          $.Schedule(2.0, trySync);
        } else {
          finish();
        }
      });
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

  // ============= EXP6727: Panorama IPC 检查表探针(检查表: 新建 文本文档.txt A~E/I) =============
  // 运行时机: boot 后 5s,每会话一次。结果双路上报:
  //   ① $.Msg -> 游戏 console.log -> 桥 tail(logs/bridge.log 中 [game] 行)
  //   ② Image SetImage(/probe?d=..) 信标 -> 桥日志 PROBE 行(同时验证出站通道)
  // 两项都到 = 出站链路双向冗余可用;后续回填 docs/ipc-checklist-6726.md 状态列。
  function expSendBeacon(data) {
    try {
      State.expSeq = (State.expSeq || 0) + 1;
      const idx = State.expSeq % 3; // 3 个面板轮换,避免连续改 src 互相取消加载
      const id = "LCTBeacon" + idx;
      let p = null;
      try { p = findChild(getRoot(), id); } catch (e0) {}
      if (!isValid(p)) {
        try { p = $.CreatePanel("Image", getRoot(), id); } catch (e1) {}
        if (isValid(p)) { try { p.visible = false; p.style.width = "2px"; p.style.height = "2px"; } catch (e2) {} }
      }
      if (!isValid(p) || typeof p.SetImage !== "function") return;
      const url = "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe?seq=" + State.expSeq +
        "&d=" + encodeURIComponent(String(data || "").slice(0, 3500));
      p.SetImage(url);
    } catch (e) {}
  }

  function expPump() {
    if (State.expPumping) return;
    if (!State.expQueue || !State.expQueue.length) return;
    State.expPumping = true;
    const msg = State.expQueue.shift();
    expSendBeacon(msg);
    // 0.2s 间隔: 信标自身也是一次高频出站小考(连续 10+ 条不丢)
    try {
      $.Schedule(0.2, function () { State.expPumping = false; expPump(); });
    } catch (e) { State.expPumping = false; }
  }

  function dlog(msg) {
    log("exp6727: " + msg);
    try {
      if (!State.expQueue) State.expQueue = [];
      if (State.expQueue.length < 400) State.expQueue.push(String(msg));
      expPump();
    } catch (e) {}
  }

  // 长枚举结果分片(每片 ~500 字符,避免单行过长被引擎截断)
  function expChunk(prefix, s) {
    const size = 500;
    for (let i = 0; i < s.length; i += size) {
      dlog(prefix + "#" + (i / size) + ": " + s.slice(i, i + size));
    }
    if (!s.length) dlog(prefix + "#0: <empty>");
  }

  // 从 GameInterfaceAPI 或全局找函数(返回 {o,f},调用时用 f.apply(o) 保 this 绑定)
  function expFindFn(name) {
    try {
      if (typeof GameInterfaceAPI !== "undefined" && GameInterfaceAPI && typeof GameInterfaceAPI[name] === "function") {
        return { o: GameInterfaceAPI, f: GameInterfaceAPI[name] };
      }
    } catch (e) {}
    try {
      if (typeof globalThis[name] === "function") return { o: globalThis, f: globalThis[name] };
    } catch (e) {}
    return null;
  }

  function expErr(e) {
    return e && e.message ? e.message : String(e);
  }

  function runExp6727() {
    if (State.exp6727Done) return;
    State.exp6727Done = true;
    const ts = String(nowMs()).slice(-6);
    dlog("start v" + VERSION + " ts=" + ts);

    // ===== A. Panorama -> Engine 基础接口 =====
    let gia = null;
    try { gia = (typeof GameInterfaceAPI !== "undefined") ? GameInterfaceAPI : null; } catch (e) {}
    dlog("A1 typeof GameInterfaceAPI=" + (typeof GameInterfaceAPI));
    if (gia) {
      const keys = [];
      try {
        for (const k in gia) { try { keys.push(k + ":" + typeof gia[k]); } catch (e2) {} }
      } catch (e) {}
      expChunk("A1 gia keys", keys.join(","));
    }
    // A2: ConsoleCommand 执行无害命令(echo,输出进 console.log 供桥 tail 验证)
    const cmd = expFindFn("ConsoleCommand");
    if (cmd) {
      try {
        const r = cmd.f.apply(cmd.o, ["echo BT_CMD_OK_" + ts]);
        dlog("A2 ConsoleCommand(echo) returned " + String(r));
      } catch (e) { dlog("A2 ConsoleCommand threw: " + expErr(e)); }
    } else {
      dlog("A2 ConsoleCommand missing");
    }
    // A3/A4: 设置写入-回读 roundtrip(A6: 读回值再 echo 出去 = 设置->桥)
    const setS = expFindFn("SetSettingString");
    const getS = expFindFn("GetSettingString");
    dlog("A3/A4 GetSettingString=" + !!getS + " SetSettingString=" + !!setS);
    if (setS && getS) {
      const wv = "BT_SET_" + ts;
      let wr = "n/a";
      try { wr = String(setS.f.apply(setS.o, ["lct_probe", wv])); } catch (e) { wr = "threw: " + expErr(e); }
      let rv = "n/a";
      try { rv = String(getS.f.apply(getS.o, ["lct_probe", ""])); }
      catch (e1) { try { rv = String(getS.f.apply(getS.o, ["lct_probe"])); } catch (e2) { rv = "threw: " + expErr(e2); } }
      dlog("A4 set(lct_probe," + wv + ") ret=" + wr);
      dlog("A3 readback=" + rv + " match=" + (rv === wv));
      if (cmd) {
        try { cmd.f.apply(cmd.o, ["echo BT_A6 " + rv]); dlog("A6 echo of readback sent (watch bridge)"); }
        catch (e) { dlog("A6 echo threw: " + expErr(e)); }
      }
    }
    // A5: 命令行参数查询
    const hclp = expFindFn("HasCommandLineParm");
    if (hclp) {
      try {
        const b = hclp.f.apply(hclp.o, ["-novid"]);
        dlog("A5 HasCommandLineParm(-novid)=" + String(b) + " typeof=" + typeof b);
      } catch (e) { dlog("A5 threw: " + expErr(e)); }
    } else { dlog("A5 HasCommandLineParm missing"); }
    const gclp = expFindFn("GetCommandLineParm");
    dlog("A5 GetCommandLineParm present=" + !!gclp);

    // ===== I0. 全局面枚举(找现成 C++ -> Panorama 入口) =====
    try {
      const g = [];
      try { for (const k in globalThis) { try { g.push(k + ":" + typeof globalThis[k]); } catch (e2) {} } } catch (e) {}
      expChunk("I0 globals", g.join(","));
    } catch (e) { dlog("I0 globals failed: " + expErr(e)); }

    // ===== B. Console/Log 通道(桥 tail 自动验收: BT_ 前缀行) =====
    // B4 长度: 100/500/1000 字符,看 console.log 是否截断
    function rawMsg(m) { try { $.Msg(m); } catch (e) {} }
    function rep(ch, n) { return new Array(n + 1).join(ch); }
    rawMsg("BT_LEN100 " + rep("x", 91));   // 总长 100
    rawMsg("BT_LEN500 " + rep("x", 491));   // 总长 500
    rawMsg("BT_LEN1000 " + rep("x", 990));  // 总长 1000
    dlog("B4 len100/500/1000 sent");
    // B5 高频: 连发 10 条(不加间隔,测引擎/文件层丢包)
    for (let i = 1; i <= 10; i += 1) rawMsg("BT_BURST " + i + "/10 ts=" + ts);
    dlog("B5 burst x10 sent");
    // B6 特殊字符: 中文/日文/emoji/JSON/引号/竖线 + 原生换行(两行,第二行无标记 -> 验证桥 tail 续行)
    let uni = "";
    try {
      uni = JSON.stringify({ zh: "中文测试", ja: "日本語", emoji: "\ud83d\ude00", quote: "he said \"hi\"", pipe: "a|b|c" });
    } catch (e) { uni = "{\"err\":\"" + expErr(e) + "\"}"; }
    rawMsg("BT_UNI " + uni);
    rawMsg("BT_NL part1 ts=" + ts + "\npart2-continuation ts=" + ts);
    dlog("B6 unicode/json/newline sent");

    // ===== C. Clipboard =====
    try {
      const clipHits = [];
      const roots = [["gia", gia], ["$", $], ["global", globalThis]];
      for (const rr of roots) {
        try {
          for (const k in rr[1]) {
            if (String(k).toLowerCase().indexOf("clip") !== -1) clipHits.push(rr[0] + "." + k + ":" + typeof rr[1][k]);
          }
        } catch (e) {}
      }
      dlog("C1 clip APIs: " + (clipHits.length ? clipHits.join(",") : "NONE"));
      // 找到写/读口就实际交换一次
      const clipNames = ["SetClipboardText", "ClipboardCopy", "CopyToClipboard", "ClipboardSet", "GetClipboardText", "ClipboardGet", "ReadClipboard", "PasteFromClipboard"];
      let clipW = null;
      let clipR = null;
      for (const n of clipNames) {
        const fn = expFindFn(n);
        if (!fn) continue;
        if (!clipW && n.toLowerCase().indexOf("set") !== -1) clipW = { fn: fn, name: n };
        if (!clipR && (n.toLowerCase().indexOf("get") !== -1 || n.toLowerCase().indexOf("read") !== -1)) clipR = { fn: fn, name: n };
      }
      if (clipW) {
        const cv = "BT_CLIP_" + ts;
        try {
          const rr2 = clipW.fn.f.apply(clipW.fn.o, [cv]);
          dlog("C2 " + clipW.name + "(\"" + cv + "\") returned " + String(rr2) + " (check Windows clipboard)");
        } catch (e) { dlog("C2 " + clipW.name + " threw: " + expErr(e)); }
      } else { dlog("C2 no write API found (C1 list)"); }
      if (clipR) {
        try {
          const rv2 = clipR.fn.f.apply(clipR.fn.o, []);
          dlog("C3 " + clipR.name + "() read = " + String(rv2).slice(0, 120));
        } catch (e) { dlog("C3 " + clipR.name + " threw: " + expErr(e)); }
      } else { dlog("C3 no read API found (C1 list)"); }
    } catch (e) { dlog("C section failed: " + expErr(e)); }

    // ===== D. CitadelHTMLPanel =====
    let hp = null;
    try { hp = $.CreatePanel("CitadelHTMLPanel", getRoot(), "LCTHtmlProbe"); }
    catch (e) { dlog("D1 CreatePanel threw: " + expErr(e)); }
    dlog("D1 CitadelHTMLPanel created=" + !!hp);
    if (hp) {
      try {
        const pn = [];
        try { for (const k in hp) { try { pn.push(k + ":" + typeof hp[k]); } catch (e2) {} } } catch (e) {}
        expChunk("D2/D3 props", pn.join(","));
      } catch (e) { dlog("D2/D3 enumerate failed: " + expErr(e)); }
      // D5~D8 重点方法点名
      const watch = ["SetURL", "Navigate", "NavigateToURL", "LoadPage", "Load", "Evaluate", "Execute", "EvalScript", "RunScript", "PostMessage", "SendMessage", "SetReadyForDisplay", "BReadyForDisplay", "SetImage"];
      const present = [];
      const absent = [];
      for (const m of watch) {
        try { if (typeof hp[m] === "function") present.push(m); else absent.push(m); }
        catch (e) { absent.push(m); }
      }
      dlog("D5-D8 present: " + present.join(","));
      dlog("D5-D8 missing: " + absent.join(","));
      // D9/D10 title / location 回读
      try { dlog("D9 title=" + String(hp.title)); } catch (e) { dlog("D9 title threw: " + expErr(e)); }
      try { dlog("D10 location=" + String(hp.location)); } catch (e) { dlog("D10 location threw: " + expErr(e)); }
      // D4: SetURL 是否真的产生请求(桥日志出现 PROBE seq=cit1 即活)
      if (present.indexOf("SetURL") !== -1) {
        try {
          hp.SetURL("http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe?seq=cit1&d=D4-seturl-reached");
          dlog("D4 SetURL sent (watch bridge PROBE seq=cit1)");
        } catch (e) { dlog("D4 SetURL threw: " + expErr(e)); }
      }
      // D12: 若有执行 JS 能力,试无害脚本(回读 title 验证)
      const execName = present.indexOf("Evaluate") !== -1 ? "Evaluate" : (present.indexOf("Execute") !== -1 ? "Execute" : null);
      if (execName) {
        try {
          const er = hp[execName]("document.title='BT_PAGE_'+'JS'");
          dlog("D12 " + execName + "(js) returned " + String(er));
        } catch (e) { dlog("D12 " + execName + " threw: " + expErr(e)); }
      }
      // D11: 页面 -> Panorama 回调面
      const evReg = ["RegisterForReadyEvents", "RegisterForUnhandledEvent", "SetPageEvent", "AddEventListener"];
      for (const en of evReg) {
        try { if (typeof hp[en] === "function") dlog("D11 has " + en); } catch (e) {}
      }
    }

    // ===== E. Panorama 事件总线 =====
    try {
      if (typeof $.RegisterForUnhandledEvent === "function") {
        const h = $.RegisterForUnhandledEvent("LCT_DIAG_EVT", function () {
          dlog("E1 custom event FIRED");
        });
        dlog("E1 RegisterForUnhandledEvent ok, handle=" + String(h));
        const disp = [];
        try {
          for (const k in $) {
            const kl = String(k).toLowerCase();
            if (kl.indexOf("dispatch") !== -1 || kl.indexOf("fire") !== -1 || kl.indexOf("trigger") !== -1) disp.push(k);
          }
        } catch (e) {}
        dlog("E1 dispatch-ish $ fns: " + (disp.length ? disp.join(",") : "NONE"));
        if (disp.length) {
          try { $[disp[0]]("LCT_DIAG_EVT"); dlog("E1 fired via " + disp[0] + " (if no FIRED line, bus is receive-only from C++)"); }
          catch (e) { dlog("E1 fire via " + disp[0] + " threw: " + expErr(e)); }
        }
      } else { dlog("E1 $.RegisterForUnhandledEvent missing"); }
    } catch (e) { dlog("E1 failed: " + expErr(e)); }

    dlog("done (check bridge logs/bridge.log for PROBE/[game] lines)");
  }

  // ============= EXP6728: 入站三连探针(唯一目标 J2: Bridge → Panorama) =============
  // ① CitadelHTMLPanel.RunScriptInPanelContext — 能否执行 JS/有无返回值/完整异常
  // ② Object.getOwnPropertyNames 扫非枚举盲区: globalThis / panorama / $ / GameEvents
  // ③ RegisterForUnhandledEvent 白名单批量探测: VALID/INVALID/THROWS_OTHER + 触发观察
  // 本轮不碰: AsyncWebRequest / SetURL / title / 布局尺寸 / ConsoleCommand(已判死,收益低)
  // 上报同 6727: $.Msg(console.log 尾随) + /probe 信标双路。
  function runExp6728() {
    if (State.exp6728Done) return;
    State.exp6728Done = true;
    const ts = String(nowMs()).slice(-6);
    dlog("exp6728 start v" + VERSION + " ts=" + ts);

    // ---- ① RunScriptInPanelContext(第一优先级) ----
    try {
      let hp8 = null;
      try { hp8 = $.CreatePanel("CitadelHTMLPanel", getRoot(), "LCTHtmlProbe8"); }
      catch (e0) { dlog("28-① create threw: " + expErr(e0)); }
      dlog("28-① CitadelHTMLPanel created=" + !!hp8);
      if (hp8) {
        try {
          dlog("28-① paneltype=" + String(hp8.paneltype) + " type=" + String(hp8.type) + " layoutfile=" + String(hp8.layoutfile));
        } catch (e) {}
        let rs = null;
        try { rs = hp8.RunScriptInPanelContext; } catch (e) { dlog("28-① RSI access threw: " + expErr(e)); }
        dlog("28-① RunScriptInPanelContext typeof=" + typeof rs + " arity=" + (typeof rs === "function" ? rs.length : "-"));
        if (typeof rs === "function") {
          const tries = [
            ["return123", "return 123"],
            ["expr", "1+1"],
            ["console", "console.log('BT_RSTEST_123 ts=" + ts + "')"],
            ["title", "document.title = 'RSTEST_TITLE'"],
          ];
          for (const tt of tries) {
            try {
              const r = hp8.RunScriptInPanelContext(tt[1]);
              dlog("28-① RSI[" + tt[0] + "] returned typeof=" + typeof r + " val=" + String(r).slice(0, 120));
            } catch (e) { dlog("28-① RSI[" + tt[0] + "] THREW: " + expErr(e)); }
          }
          // 变体: 双参(脚本, 回调)
          try {
            const r2 = hp8.RunScriptInPanelContext("1+1", function (v) { dlog("28-① RSI cb: " + String(v)); });
            dlog("28-① RSI(2-arg) returned " + String(r2));
          } catch (e) { dlog("28-① RSI(2-arg) THREW: " + expErr(e)); }
        }
        // 同轮漏网的 Data() 方法顺带点名
        try {
          const df = hp8.Data;
          dlog("28-① Data typeof=" + typeof df + " arity=" + (typeof df === "function" ? df.length : "-"));
          if (typeof df === "function") {
            try { dlog("28-① Data() => " + String(hp8.Data()).slice(0, 120)); }
            catch (e2) { dlog("28-① Data() THREW: " + expErr(e2)); }
          }
        } catch (e) { dlog("28-① Data access THREW: " + expErr(e)); }
      }
    } catch (e) { dlog("28-① section failed: " + expErr(e)); }

    // ---- ② 隐藏全局 API 扫描(for..in 只见可枚举,这里用 getOwnPropertyNames) ----
    const KW28 = ["game", "settin", "command", "clip", "file", "http", "web", "request", "event", "panel", "engine", "console", "nettable", "steam", "route", "exec", "script", "message"];
    function expEnum28(label, obj) {
      if (obj == null) { dlog("28-② " + label + " = null/undefined"); return null; }
      let names = null;
      try { names = Object.getOwnPropertyNames(obj); }
      catch (e) { dlog("28-② " + label + " getOwnPropertyNames THREW: " + expErr(e)); return null; }
      expChunk("28-② " + label + " props", names.join(","));
      const hits = [];
      for (const n of names) {
        const nl = String(n).toLowerCase();
        for (const k of KW28) { if (nl.indexOf(k) !== -1) { hits.push(n); break; } }
      }
      dlog("28-② " + label + " keyword hits: " + (hits.length ? hits.join(",") : "NONE"));
      return hits;
    }
    try {
      dlog("28-② typeof GameInterfaceAPI=" + (typeof GameInterfaceAPI) +
        " GameEvents=" + (typeof GameEvents) +
        " CustomNetTables=" + (typeof CustomNetTables) +
        " panorama=" + (typeof panorama));
      let gn = [];
      try { gn = Object.getOwnPropertyNames(globalThis); }
      catch (e) { dlog("28-② globalThis THREW: " + expErr(e)); }
      expChunk("28-② globalThis props", gn.join(","));
      const ghits = [];
      for (const n of gn) {
        const nl = String(n).toLowerCase();
        for (const k of KW28) { if (nl.indexOf(k) !== -1) { ghits.push(n); break; } }
      }
      dlog("28-② globalThis keyword hits: " + (ghits.length ? ghits.join(",") : "NONE"));
      expEnum28("panorama", typeof panorama !== "undefined" ? panorama : null);
      expEnum28("$", $);
      try { if (typeof GameEvents !== "undefined") expEnum28("GameEvents", GameEvents); } catch (e) {}
      try { if (typeof CustomNetTables !== "undefined") expEnum28("CustomNetTables", CustomNetTables); } catch (e) {}
      // 关键字命中的全局再深挖一层(对象/函数型,最多 6 个防刷屏)
      let deepN = 0;
      for (const n of ghits) {
        if (deepN >= 6) break;
        try {
          const v = globalThis[n];
          if (v && (typeof v === "object" || typeof v === "function")) { expEnum28("deep:" + n, v); deepN += 1; }
        } catch (e) {}
      }
    } catch (e) { dlog("28-② section failed: " + expErr(e)); }

    // ---- ③ 事件白名单批量探测 ----
    try {
      if (typeof $.RegisterForUnhandledEvent !== "function") {
        dlog("28-③ RegisterForUnhandledEvent missing");
      } else {
        State.exp28Fired = State.exp28Fired || {};
        const cands = [
          // 对照组(生产代码已验证可注册)
          "HTMLContentLoaded", "HTMLChangedTitle", "ClientUI_FireOutput",
          // 聊天族
          "ChatMessage", "ChatMsg", "Chat", "PlayerChat", "PlayerChatMessage", "OnChatMessage", "CitadelChatMessage", "HUDChatMessage", "OnPlayerChat", "PlayerSay",
          // 对局状态族
          "GameEvent", "PanelLoaded", "LevelInit", "MatchStart", "MatchEnd", "MatchStateChanged", "OnMatchStateChanged", "GameStateChanged", "OnGameStateChange",
          // 玩家族
          "PlayerConnect", "PlayerDisconnect", "PlayerInfoChanged", "OnPlayerInfoChanged", "OnPlayerSpawn", "OnPlayerDeath",
          // HTML 面板族(对照+扩展)
          "HTMLLoadPage", "HTMLStartRequest", "HTMLFinishRequest", "HTMLURLChanged", "HTMLTitle",
          // 加载族(图片加载若触发事件 = 入站突破口)
          "OnImageLoaded", "ImageLoaded", "ImageLoadComplete", "OnTextureLoaded", "ContentLoaded", "OnPanelLoaded", "OnPanelLoad",
          // 自定义/网络/UI/Steam
          "CustomGameEvent", "OnCustomGameEvent", "FireGameEvent", "OnFireGameEvent", "NetTableChanged", "CustomNetTableChanged", "OnCustomNetTableChanged",
          "ClientUIEvent", "UIEvent", "OnUIEvent", "ResolutionChanged", "OnResolutionChanged", "SteamOverlayChanged", "OnSteamOverlayToggled",
          "EntityKilled", "OnEntityKilled", "OnAbilityCast", "ServerInfo", "OnTimeChanged", "OnLocalPlayerReady"
        ];
        const valid = [];
        const invalid = [];
        const other = [];
        const seen = {};
        for (const name of cands) {
          if (seen[name]) continue;
          seen[name] = true;
          try {
            $.RegisterForUnhandledEvent(name, (function (nm) {
              return function () {
                const cnt = (State.exp28Fired[nm] || 0) + 1;
                State.exp28Fired[nm] = cnt;
                if (cnt <= 3) {
                  let args = "";
                  try {
                    const arr = [];
                    for (let i = 0; i < arguments.length && i < 6; i += 1) {
                      try { arr.push(String(arguments[i]).slice(0, 160)); }
                      catch (e2) { arr.push("<" + typeof arguments[i] + ">"); }
                    }
                    args = arr.join(" | ");
                  } catch (e2) {}
                  dlog("28-③ EVENT FIRED: " + nm + " args(" + arguments.length + ")=" + args.slice(0, 400));
                }
              };
            })(name));
            valid.push(name);
          } catch (e) {
            const m = expErr(e);
            if (m.indexOf("not a valid event type") !== -1) invalid.push(name);
            else other.push(name + "{" + m + "}");
          }
        }
        expChunk("28-③ VALID", valid.join(","));
        dlog("28-③ INVALID count=" + invalid.length + " of " + cands.length);
        expChunk("28-③ THROWS_OTHER", other.join(",") || "NONE");
        // $ 里的派发口(能否自己触发事件做回环验证)
        try {
          const dk = [];
          for (const k of Object.getOwnPropertyNames($)) {
            const kl = String(k).toLowerCase();
            if (kl.indexOf("dispatch") !== -1 || kl.indexOf("fire") !== -1 || kl.indexOf("trigger") !== -1 || kl.indexOf("emit") !== -1) dk.push(k);
          }
          dlog("28-③ $ dispatch-ish: " + (dk.length ? dk.join(",") : "NONE"));
        } catch (e) { dlog("28-③ dispatch scan THREW: " + expErr(e)); }
        // 触发观察: 发一条桥信标(加载桥可控资源), 3s 后汇报哪些事件真的到达
        expSendBeacon("28-E7-trigger ts=" + ts);
        try {
          $.Schedule(3.0, function () {
            const fired = [];
            for (const k in State.exp28Fired) fired.push(k + "x" + State.exp28Fired[k]);
            dlog("28-③ fired after image trigger: " + (fired.length ? fired.join(",") : "NONE"));
            dlog("28-③ done");
          });
        } catch (e) { dlog("28-③ schedule failed: " + expErr(e)); }
      }
    } catch (e) { dlog("28-③ section failed: " + expErr(e)); }
  }

  // ============= EXP6729: 入站四连探针(J2 攻坚) =============
  // ① 事件 args 深挖(HTML*/ImageLoaded 全字段 dump) + 图片 200/404/500/204 状态码差分
  // ② SetURL 变体矩阵(检测器 = HTML* 事件 + 桥 PROBE, 不再只看桥日志)
  // ③ Data() dump / RegisterEventHandler 白名单 / BImageFileExists 文件 oracle
  // ④ RSI 域名探测(我方 context 的 location/document, 为域名对齐铺路)
  function expDumpVal(v) {
    const t = typeof v;
    if (v === null) return "null";
    if (t === "string") return JSON.stringify(String(v).slice(0, 200));
    if (t === "number" || t === "boolean") return String(v);
    if (t === "undefined") return "undefined";
    if (t === "function") return "fn<" + (v.name || "?") + ">";
    try {
      const names = Object.getOwnPropertyNames(v);
      const parts = [];
      for (let i = 0; i < names.length && parts.length < 12; i += 1) {
        let val;
        try { val = v[names[i]]; } catch (e) { parts.push(names[i] + "=<throw>"); continue; }
        const vt = typeof val;
        if (vt === "string") parts.push(names[i] + "=" + JSON.stringify(String(val).slice(0, 140)));
        else if (vt === "number" || vt === "boolean") parts.push(names[i] + "=" + String(val));
        else if (val === null) parts.push(names[i] + "=null");
        else parts.push(names[i] + "<" + vt + ">");
      }
      const more = names.length > 12 ? ",+" + (names.length - 12) : "";
      return "{" + parts.join(",") + more + "}";
    } catch (e) { return "<dump failed: " + expErr(e) + ">"; }
  }

  function expEventHandler29(nm) {
    return function () {
      if (!State.exp29Fired) State.exp29Fired = {};
      const cnt = (State.exp29Fired[nm] = (State.exp29Fired[nm] || 0) + 1);
      if (cnt <= 4) {
        const parts = [];
        for (let i = 0; i < arguments.length && i < 5; i += 1) {
          parts.push("a" + i + "=" + expDumpVal(arguments[i]));
        }
        dlog("29-EV " + nm + "#" + cnt + " (" + arguments.length + "a): " + parts.join(" | ").slice(0, 600));
      }
    };
  }

  function runExp6729() {
    if (State.exp6729Done) return;
    State.exp6729Done = true;
    const ts = String(nowMs()).slice(-6);
    dlog("exp6729 start v" + VERSION + " ts=" + ts);

    // ---- ④ RSI 域名探测: 我方 context 到底是什么 ----
    try {
      dlog("29-④ typeof location=" + (typeof location) + " document=" + (typeof document) + " window=" + (typeof window));
      try { if (typeof location !== "undefined") dlog("29-④ location = " + String(location).slice(0, 300)); } catch (e) { dlog("29-④ location THREW: " + expErr(e)); }
      try { if (typeof document !== "undefined") dlog("29-④ document.URL=" + String(document.URL) + " title=" + String(document.title)); } catch (e) { dlog("29-④ document THREW: " + expErr(e)); }
    } catch (e) { dlog("29-④ section failed: " + expErr(e)); }

    // ---- ① 挂8个 VALID 事件的 dump handler(args 全字段) ----
    try {
      const dumpEvents = ["ImageLoaded", "PanelLoaded", "HTMLLoadPage", "HTMLStartRequest", "HTMLFinishRequest", "HTMLURLChanged", "HTMLTitle", "ClientUI_FireOutput"];
      let okN = 0;
      for (const nm of dumpEvents) {
        try { $.RegisterForUnhandledEvent(nm, expEventHandler29(nm)); okN += 1; }
        catch (e) { dlog("29-① register " + nm + " THREW: " + expErr(e)); }
      }
      dlog("29-① dump handlers registered: " + okN + "/" + dumpEvents.length);
    } catch (e) { dlog("29-① register section failed: " + expErr(e)); }

    // ---- ①' 图片状态码差分: 6 个触发(200/404/200/404/500/204),对照 EV 触发序列 ----
    try {
      let diffPanel = null;
      try { diffPanel = findChild(getRoot(), "LCTDiffProbe"); } catch (e0) {}
      if (!isValid(diffPanel)) {
        try { diffPanel = $.CreatePanel("Image", getRoot(), "LCTDiffProbe"); } catch (e1) {}
        if (isValid(diffPanel)) { try { diffPanel.visible = false; diffPanel.style.width = "2px"; diffPanel.style.height = "2px"; } catch (e2) {} }
      }
      if (isValid(diffPanel) && typeof diffPanel.SetImage === "function") {
        const codes = [200, 404, 200, 404, 500, 204];
        for (let i = 0; i < codes.length; i += 1) {
          const myI = i;
          const code = codes[i];
          try {
            $.Schedule(myI * 0.8, function () {
              dlog("29-① TRIGGER n=" + (myI + 1) + " code=" + code);
              try { diffPanel.SetImage("http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe_img?code=" + code + "&n=" + (myI + 1)); }
              catch (e) { dlog("29-① SetImage THREW: " + expErr(e)); }
            });
          } catch (e) { dlog("29-① schedule THREW: " + expErr(e)); }
        }
        dlog("29-① diff sent 6 triggers (200,404,200,404,500,204), 0.8s apart; compare TRIGGER vs EV ImageLoaded sequence");
      } else {
        dlog("29-① diff panel unavailable");
      }
    } catch (e) { dlog("29-① diff section failed: " + expErr(e)); }

    // ---- ② SetURL 变体矩阵(检测器 = HTML* 事件 + 桥 PROBE) ----
    try {
      let hp9 = null;
      try { hp9 = findChild(getRoot(), "LCTHtmlProbe"); } catch (e0) {}
      if (!isValid(hp9)) {
        try { hp9 = $.CreatePanel("CitadelHTMLPanel", getRoot(), "LCTHtmlProbe"); } catch (e1) {}
      }
      if (isValid(hp9) && typeof hp9.SetURL === "function") {
        const navs = [
          ["blank", "about:blank"],
          ["file-abs", "file:///C:/Windows/win.ini"],
          ["http-local", "http://localhost:8791/probe?seq=nav1&d=seturl-local"],
          ["http-127", "http://127.0.0.1:8791/probe?seq=nav2&d=seturl-127"]
        ];
        for (let i = 0; i < navs.length; i += 1) {
          const myI = i;
          const nav = navs[i];
          try {
            $.Schedule(1.5 + myI * 1.0, function () {
              dlog("29-② NAV[" + nav[0] + "] -> " + nav[1]);
              try { hp9.SetURL(nav[1]); } catch (e) { dlog("29-② SetURL THREW: " + expErr(e)); }
            });
          } catch (e) { dlog("29-② schedule THREW: " + expErr(e)); }
        }
        dlog("29-② nav matrix queued (blank/file-abs/http-local/http-127); watch 29-EV HTML* args + PROBE seq=nav1/nav2");
      } else {
        dlog("29-② panel/SetURL unavailable");
      }
    } catch (e) { dlog("29-② section failed: " + expErr(e)); }

    // ---- ③ Data() dump / RegisterEventHandler / BImageFileExists ----
    try {
      let hpD = null;
      try { hpD = findChild(getRoot(), "LCTHtmlProbe"); } catch (e0) {}
      if (!isValid(hpD)) { try { hpD = $.CreatePanel("CitadelHTMLPanel", getRoot(), "LCTHtmlProbe"); } catch (e1) {} }
      if (isValid(hpD)) {
        try {
          const dv = hpD.Data();
          dlog("29-③ Data() = " + expDumpVal(dv));
        } catch (e) { dlog("29-③ Data() THREW: " + expErr(e)); }
      }
      // RegisterEventHandler: 另一套注册口(与 unhandled 不同),测 arity + 白名单
      try {
        const reh = $.RegisterEventHandler;
        dlog("29-③ RegisterEventHandler typeof=" + typeof reh + " arity=" + (typeof reh === "function" ? reh.length : "-"));
        if (typeof reh === "function") {
          const rehCands = ["ImageLoaded", "HTMLTitle", "ClientUI_FireOutput", "PanelLoaded", "ChatMessage", "LCT_DIAG_EVT"];
          const rehValid = [];
          const rehInvalid = [];
          for (const nm of rehCands) {
            try { reh(nm, expEventHandler29("REH:" + nm)); rehValid.push(nm); }
            catch (e) {
              const m = expErr(e);
              if (m.indexOf("not a valid event type") !== -1) rehInvalid.push(nm);
              else rehInvalid.push(nm + "{" + m.slice(0, 80) + "}");
            }
          }
          dlog("29-③ RegisterEventHandler VALID: " + (rehValid.join(",") || "NONE"));
          dlog("29-③ RegisterEventHandler INVALID: " + (rehInvalid.join(",") || "NONE"));
        }
      } catch (e) { dlog("29-③ RegisterEventHandler section THREW: " + expErr(e)); }
      // BImageFileExists: 文件存在性 oracle(桥可写文件 = 位元入站候选)
      try {
        const bf = $.BImageFileExists;
        dlog("29-③ BImageFileExists typeof=" + typeof bf + " arity=" + (typeof bf === "function" ? bf.length : "-"));
        if (typeof bf === "function") {
          const paths = [
            ["abs-exists", "C:/Windows/win.ini"],
            ["abs-missing", "C:/no_such_bt_file_zz.ini"],
            ["file-abs", "file:///C:/Windows/win.ini"],
            ["game-cfg", "cfg/video.txt"],
            ["game-console-log", "console.log"],
            ["resources", "file://{resources}/panorama/styles/lingua_chat.vcss_c"],
            ["bridge-abs", "F:/BabelTower/logs/bridge.log"]
          ];
          for (const pp of paths) {
            try { dlog("29-③ BIFE[" + pp[0] + "] = " + String(bf(pp[1]))); }
            catch (e) { dlog("29-③ BIFE[" + pp[0] + "] THREW: " + expErr(e)); }
          }
        }
      } catch (e) { dlog("29-③ BIFE section THREW: " + expErr(e)); }
    } catch (e) { dlog("29-③ section failed: " + expErr(e)); }

    // 汇总: 8s 后报事件触发统计(差分结论靠它)
    try {
      $.Schedule(8.0, function () {
        const fired = [];
        if (State.exp29Fired) { for (const k in State.exp29Fired) fired.push(k + "x" + State.exp29Fired[k]); }
        dlog("29-SUM fired: " + (fired.length ? fired.join(",") : "NONE"));
        dlog("29-SUM done");
      });
    } catch (e) { dlog("29-SUM schedule failed: " + expErr(e)); }
  }

  // ============= EXP6730: 严格三测(不扩散) =============
  // ① ImageLoaded 精确差分(身份过滤): 200/204/404/500/connection-refused -> 是否触发 + a1 内容
  // ② RegisterEventHandler arity 猜签名: 1~5 参逐个试,只找参数个数,不猜事件名
  // ③ BImageFileExists 资源对照: 真实 s2r 路径 3 形式 + 材质路径 + 不存在路径
  // 本轮不测: SetURL/file://localhost/AsyncWebRequest/RSI/Data()/GameInterfaceAPI(已判死或已定案)
  function runExp6730() {
    if (State.exp6730Done) return;
    State.exp6730Done = true;
    const ts = String(nowMs()).slice(-6);
    dlog("exp6730 start v" + VERSION + " ts=" + ts);

    // ---- ① ImageLoaded 精确差分 ----
    try {
      let dp = null;
      try { dp = findChild(getRoot(), "LCTDiffProbe"); } catch (e0) {}
      if (!isValid(dp)) {
        try { dp = $.CreatePanel("Image", getRoot(), "LCTDiffProbe"); } catch (e1) {}
        if (isValid(dp)) { try { dp.visible = false; dp.style.width = "2px"; dp.style.height = "2px"; } catch (e2) {} }
      }
      if (!isValid(dp) || typeof dp.SetImage !== "function") {
        dlog("30-① diff panel unavailable");
      } else {
        State.diffPanelId = "LCTDiffProbe";
        State.diffFired = {};
        State.diffA1 = {};
        State.curTrigger = 0;
        State.curCode = "-";
        // 身份过滤: 按 id 匹配(跨 wrapper 稳定),只记录我们自己的面板
        try {
          $.RegisterForUnhandledEvent("ImageLoaded", function (panel, a1) {
            let pid = "";
            try { pid = panel ? String(panel.id) : ""; } catch (e) {}
            if (pid !== State.diffPanelId) return;
            const t = State.curTrigger || 0;
            State.diffFired[t] = (State.diffFired[t] || 0) + 1;
            if (!State.diffA1[t]) {
              try { State.diffA1[t] = expDumpVal(a1); } catch (e) { State.diffA1[t] = "<dump fail>"; }
            }
            dlog("30-① MY_IMAGE_LOADED #" + t + " code=" + State.curCode + " a1=" + State.diffA1[t]);
          });
          dlog("30-① ImageLoaded handler registered (id filter: " + State.diffPanelId + ")");
        } catch (e) { dlog("30-① handler register THREW: " + expErr(e)); }
        // 5 个步骤: 200 / 204 / 404 / 500 / refused(死端口 8799)
        const steps = ["200", "204", "404", "500", "refused"];
        for (let i = 0; i < steps.length; i += 1) {
          const myI = i + 1;
          const code = steps[i];
          try {
            $.Schedule(1.5 + i * 1.5, function () {
              State.curTrigger = myI;
              State.curCode = code;
              dlog("30-① TRIGGER #" + myI + " code=" + code);
              const url = code === "refused"
                ? "http://localhost:8799/refused.png?n=R" + myI
                : "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe_img?code=" + code + "&n=" + myI;
              try { dp.SetImage(url); } catch (e) { dlog("30-① SetImage THREW: " + expErr(e)); }
            });
          } catch (e) { dlog("30-① schedule THREW: " + expErr(e)); }
          // 每步触发 1.3s 后判定(本地请求毫秒级,1.3s 窗口足够)
          try {
            $.Schedule(1.5 + i * 1.5 + 1.3, function () {
              const cnt = State.diffFired[myI] || 0;
              const a1v = State.diffA1[myI] || "-";
              dlog("30-① RESULT[" + code + "] = " + (cnt ? "FIRED x" + cnt : "NO-EVENT") + " a1=" + a1v);
            });
          } catch (e) {}
        }
        dlog("30-① steps queued: 200/204/404/500/refused, 1.5s apart (refused = localhost:8799 dead port)");
      }
    } catch (e) { dlog("30-① section failed: " + expErr(e)); }

    // ---- ② RegisterEventHandler arity(只找参数个数,不猜事件名) ----
    try {
      const reh = $.RegisterEventHandler;
      dlog("30-② RegisterEventHandler typeof=" + typeof reh);
      if (typeof reh === "function") {
        const mk = function (n) {
          const a = ["ImageLoaded"];
          if (n >= 2) a.push(function () {});
          if (n >= 3) a.push({});
          if (n >= 4) a.push(null);
          if (n >= 5) a.push(null);
          return a;
        };
        for (let n = 1; n <= 5; n += 1) {
          try {
            const r = reh.apply($, mk(n));
            dlog("30-② REH n=" + n + " => NO THROW, return=" + String(r) + "  <== CANDIDATE");
          } catch (e) {
            const m = expErr(e);
            const wrongN = m.indexOf("Wrong number") !== -1;
            dlog("30-② REH n=" + n + " => " + (wrongN ? "WrongNumber" : "OTHER: " + m) + "");
          }
        }
        dlog("30-② done (look for n where error stops being WrongNumber)");
      }
    } catch (e) { dlog("30-② section failed: " + expErr(e)); }

    // ---- ③ BImageFileExists 资源对照(最后测,全 false 即封案) ----
    try {
      const bf = $.BImageFileExists;
      if (typeof bf === "function") {
        const cases = [
          ["known-s2r", "s2r://panorama/images/buttons/button_border_fill_psd.vtex"],
          ["known-raw", "panorama/images/buttons/button_border_fill_psd.vtex"],
          ["known-raw-c", "panorama/images/buttons/button_border_fill_psd.vtex_c"],
          ["known-mat-c", "materials/particle/abilities/archer/mc_sparks.vtex_c"],
          ["missing", "panorama/images/buttons/definitely_missing_bt_zz.vtex"],
          ["missing-c", "panorama/images/buttons/definitely_missing_bt_zz.vtex_c"]
        ];
        for (const cc of cases) {
          try { dlog("30-③ BIFE[" + cc[0] + "] = " + String(bf(cc[1]))); }
          catch (e) { dlog("30-③ BIFE[" + cc[0] + "] THREW: " + expErr(e)); }
        }
        dlog("30-③ done (known-* true + missing false => resource-query API; all false => abandoned)");
      } else {
        dlog("30-③ BImageFileExists missing");
      }
    } catch (e) { dlog("30-③ section failed: " + expErr(e)); }

    // 总汇总(差分5步在 1.5+4*1.5+1.3=8.8s 收尾)
    try {
      $.Schedule(10.5, function () {
        const parts = [];
        if (State.diffFired) {
          const labels = ["200", "204", "404", "500", "refused"];
          for (let i = 1; i <= labels.length; i += 1) {
            parts.push(labels[i - 1] + ":" + (State.diffFired[i] ? "FIRED" : "NO"));
          }
        }
        dlog("30-SUM diff = " + (parts.length ? parts.join(" | ") : "n/a"));
        dlog("30-SUM done");
      });
    } catch (e) { dlog("30-SUM schedule failed: " + expErr(e)); }
  }

  // ============= EXP6731: 双实验(判假阴性 + 验3参签名) =============
  // ① ImageLoaded: 可见2px vs 隐藏双面板, 200/404, 不过滤打印真实 panel.id
  //    回答: ImageLoaded 能否观察到我们自己创建的 Image?(可见性/身份两嫌并查)
  // ② RegisterEventHandler 3参实调: ("ImageLoaded", panelObj, fn) 与 ("ImageLoaded", "id", fn)
  function runExp6731() {
    if (State.exp6731Done) return;
    State.exp6731Done = true;
    const ts = String(nowMs()).slice(-6);
    dlog("exp6731 start v" + VERSION + " ts=" + ts);

    // ---- 双面板: 可见 2px + 隐藏 ----
    let vis = null;
    let hid = null;
    try { vis = findChild(getRoot(), "LCTDiffVis"); } catch (e0) {}
    if (!isValid(vis)) {
      try { vis = $.CreatePanel("Image", getRoot(), "LCTDiffVis"); } catch (e) {}
      if (isValid(vis)) {
        try { vis.visible = true; vis.style.width = "2px"; vis.style.height = "2px"; vis.style.x = "0px"; vis.style.y = "0px"; } catch (e) {}
      }
    }
    try { hid = findChild(getRoot(), "LCTDiffHid"); } catch (e0) {}
    if (!isValid(hid)) {
      try { hid = $.CreatePanel("Image", getRoot(), "LCTDiffHid"); } catch (e) {}
      if (isValid(hid)) { try { hid.visible = false; hid.style.width = "2px"; hid.style.height = "2px"; } catch (e) {} }
    }
    dlog("31-① panels: vis=" + !!vis + " hid=" + !!hid);

    // ---- ② RegisterEventHandler 3参实调(先注册, 事件来了能双保险捕获) ----
    try {
      const reh = $.RegisterEventHandler;
      if (typeof reh !== "function") {
        dlog("31-② RegisterEventHandler missing");
      } else {
        const rehFn = function (tag) {
          return function () {
            const parts = [];
            for (let i = 0; i < arguments.length && i < 5; i += 1) parts.push("a" + i + "=" + expDumpVal(arguments[i]));
            dlog("31-② REH EVENT[" + tag + "] (" + arguments.length + "a): " + parts.join(" | ").slice(0, 500));
          };
        };
        // 形态1: (eventName, panelObj, fn)
        if (isValid(vis)) {
          try {
            const r1 = reh("ImageLoaded", vis, rehFn("panelObj"));
            dlog("31-② REH(panelObj) => OK, return=" + String(r1));
          } catch (e) { dlog("31-② REH(panelObj) THREW: " + expErr(e)); }
        }
        // 形态2: (eventName, panelIdString, fn)
        try {
          const r2 = reh("ImageLoaded", "LCTDiffVis", rehFn("idStr"));
          dlog("31-② REH(idStr) => OK, return=" + String(r2));
        } catch (e) { dlog("31-② REH(idStr) THREW: " + expErr(e)); }
        dlog("31-② done (which form did NOT throw?)");
      }
    } catch (e) { dlog("31-② section failed: " + expErr(e)); }

    // ---- ① ImageLoaded 全量观察(不过滤) + 我方面板计数 ----
    try {
      State.diff31 = {};
      State.cur31 = "-";
      State.img31Total = 0;
      State.img31Logged = 0;
      $.RegisterForUnhandledEvent("ImageLoaded", function (panel, a1) {
        State.img31Total += 1;
        let pid = "";
        try { pid = panel ? String(panel.id) : ""; } catch (e) {}
        if (pid === "LCTDiffVis" || pid === "LCTDiffHid") {
          State.diff31[State.cur31] = (State.diff31[State.cur31] || 0) + 1;
          dlog("31-① OURS id=" + pid + " label=" + State.cur31 + " a1=" + expDumpVal(a1));
        } else if (State.img31Logged < 8) {
          State.img31Logged += 1;
          dlog("31-① other#" + State.img31Logged + " id=\"" + pid + "\" total=" + State.img31Total);
        }
      });
      dlog("31-① unfiltered ImageLoaded handler registered");
    } catch (e) { dlog("31-① handler THREW: " + expErr(e)); }

    // ---- 差分: 4 步 (vis-200, vis-404, hid-200, hid-404) ----
    if (isValid(vis) && isValid(hid)) {
      const steps = [
        ["vis-200", vis, 200],
        ["vis-404", vis, 404],
        ["hid-200", hid, 200],
        ["hid-404", hid, 404]
      ];
      for (let i = 0; i < steps.length; i += 1) {
        const st = steps[i];
        const label = st[0];
        const panel = st[1];
        const code = st[2];
        try {
          $.Schedule(1.5 + i * 1.5, function () {
            State.cur31 = label;
            dlog("31-① TRIGGER " + label);
            try { panel.SetImage("http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe_img?code=" + code + "&n=" + label); }
            catch (e) { dlog("31-① SetImage THREW: " + expErr(e)); }
          });
        } catch (e) {}
        try {
          $.Schedule(1.5 + i * 1.5 + 1.1, function () {
            const cnt = State.diff31[label] || 0;
            dlog("31-① RESULT[" + label + "] = " + (cnt ? "FIRED x" + cnt : "NO-EVENT"));
          });
        } catch (e) {}
      }
      dlog("31-① steps queued: vis-200/vis-404/hid-200/hid-404, 1.5s apart");
    } else {
      dlog("31-① panels missing, diff skipped");
    }

    // 汇总(最后一步 1.5+3*1.5+1.1=7.1s; 留余量)
    try {
      $.Schedule(9.0, function () {
        const parts = [];
        const labels = ["vis-200", "vis-404", "hid-200", "hid-404"];
        for (const lb of labels) parts.push(lb + ":" + ((State.diff31 && State.diff31[lb]) ? "FIRED" : "NO"));
        dlog("31-SUM diff = " + parts.join(" | "));
        dlog("31-SUM ImageLoaded total=" + (State.img31Total || 0) + " (other logged " + (State.img31Logged || 0) + ")");
        dlog("31-SUM done");
      });
    } catch (e) {}
  }

  // ============= EXP6732: Bridge→Panorama 最后一公里闭环 =============
  // 规则(6731 教训): ① 每面板只 SetImage 一次,永不覆盖; ② 不轮询判定,handler 自报告; ③ +10s 汇总。
  // 结构: P200/P404/P500/PRefused 四面板各一发; P200/P404 同时挂 Unhandled + RegisterEventHandler 双路回调。
  // 期望: P200 双路 FIRED / P404·P500·PR 双路 NO = 状态码位元通道成立。
  function runExp6732() {
    if (State.exp6732Done) return;
    State.exp6732Done = true;
    const ts = String(nowMs()).slice(-6);
    dlog("exp6732 start v" + VERSION + " ts=" + ts);

    const mk = function (id) {
      let p = null;
      try { p = findChild(getRoot(), id); } catch (e) {}
      if (!isValid(p)) {
        try { p = $.CreatePanel("Image", getRoot(), id); } catch (e) {}
        if (isValid(p)) {
          try { p.visible = true; p.style.width = "2px"; p.style.height = "2px"; p.style.x = "0px"; p.style.y = "0px"; } catch (e) {}
        }
      }
      return p;
    };
    const p200 = mk("LCTP200");
    const p404 = mk("LCTP404");
    const p500 = mk("LCTP500");
    const pr = mk("LCTPR");
    dlog("32 panels: 200=" + !!p200 + " 404=" + !!p404 + " 500=" + !!p500 + " refused=" + !!pr);

    State.diff32 = {};
    State.img32Total = 0;
    State.img32Other = 0;

    // ---- 双路回调之 1: RegisterForUnhandledEvent(全局面) ----
    try {
      $.RegisterForUnhandledEvent("ImageLoaded", function (panel, a1) {
        State.img32Total += 1;
        let pid = "";
        try { pid = panel ? String(panel.id) : ""; } catch (e) {}
        if (pid === "LCTP200" || pid === "LCTP404" || pid === "LCTP500" || pid === "LCTPR") {
          State.diff32[pid] = (State.diff32[pid] || 0) + 1;
          dlog("32-① UNHANDLED FIRED id=" + pid + " t=" + nowMs() + " a1=" + expDumpVal(a1));
        } else if (State.img32Other < 4) {
          State.img32Other += 1;
          dlog("32-① other#" + State.img32Other + " id=\"" + pid + "\" total=" + State.img32Total);
        }
      });
      dlog("32-① unhandled ImageLoaded registered");
    } catch (e) { dlog("32-① unhandled THREW: " + expErr(e)); }

    // ---- 双路回调之 2: RegisterEventHandler(面板绑定, 6731 已验签名) ----
    const rehFn = function (tag) {
      return function () {
        State.diff32["REH:" + tag] = (State.diff32["REH:" + tag] || 0) + 1;
        const parts = [];
        for (let i = 0; i < arguments.length && i < 5; i += 1) parts.push("a" + i + "=" + expDumpVal(arguments[i]));
        dlog("32-② REH FIRED id=" + tag + " t=" + nowMs() + " (" + arguments.length + "a): " + parts.join(" | ").slice(0, 400));
      };
    };
    if (isValid(p200)) {
      try { $.RegisterEventHandler("ImageLoaded", p200, rehFn("LCTP200")); dlog("32-② REH registered on P200"); }
      catch (e) { dlog("32-② REH(P200) THREW: " + expErr(e)); }
    }
    if (isValid(p404)) {
      try { $.RegisterEventHandler("ImageLoaded", p404, rehFn("LCTP404")); dlog("32-② REH registered on P404"); }
      catch (e) { dlog("32-② REH(P404) THREW: " + expErr(e)); }
    }

    // ---- 单发差分: 每面板只 SetImage 一次,永不覆盖; 0.5s 错开 ----
    const shots = [
      ["LCTP200", p200, "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe_img?code=200&n=e32p200"],
      ["LCTP404", p404, "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe_img?code=404&n=e32p404"],
      ["LCTP500", p500, "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe_img?code=500&n=e32p500"],
      ["LCTPR", pr, "http://localhost:8799/refused.png?n=e32pr"]
    ];
    let shotN = 0;
    for (const sh of shots) {
      const label = sh[0];
      const panel = sh[1];
      const url = sh[2];
      if (!isValid(panel)) { dlog("32-① SHOT[" + label + "] panel missing, skipped"); continue; }
      shotN += 1;
      try {
        $.Schedule(1.5 + shotN * 0.5, function () {
          dlog("32-① SHOT[" + label + "] ONE-SHOT t=" + nowMs());
          try { panel.SetImage(url); } catch (e) { dlog("32-① SetImage THREW: " + expErr(e)); }
        });
      } catch (e) { dlog("32-① schedule THREW: " + expErr(e)); }
    }
    dlog("32-① " + shotN + " one-shot panels queued (no retarget ever)");

    // ---- 汇总: +10s, 只报告, 不提前判定 ----
    try {
      $.Schedule(10.0, function () {
        const pids = ["LCTP200", "LCTP404", "LCTP500", "LCTPR"];
        const parts = [];
        for (const pid of pids) parts.push(pid + ":" + ((State.diff32[pid]) ? "FIRED x" + State.diff32[pid] : "NO"));
        dlog("32-SUM unhandled = " + parts.join(" | "));
        const rp = [];
        rp.push("REH:200:" + (State.diff32["REH:LCTP200"] ? "FIRED" : "NO"));
        rp.push("REH:404:" + (State.diff32["REH:LCTP404"] ? "FIRED" : "NO"));
        dlog("32-SUM reh = " + rp.join(" | "));
        dlog("32-SUM other traffic total=" + State.img32Total + " (other logged " + State.img32Other + ")");
        dlog("32-SUM done");
      });
    } catch (e) {}
  }

  // ============= EXP6733: 302 重定向 + Image 面板 URL/src 回读 =============
  // 核心问题只有一个: ImageLoaded 回调里能否读到实际加载的 image URL/src/path?
  //   T1(P33A): 直接 /probe?...&d=BT_ORIG33 —— src 可读性基线
  //   T2(P33B): /redir302?o=BT_ORIG33&f=BT_FINAL33 -> 302 /rdata?f=BT_FINAL33
  //     读到 BT_FINAL33 = 最终 URL 可读 = ⭐文本入站(数量级提升)
  //     只读到 BT_ORIG33 = 跟随了但只暴露原 URL = 无增益
  //     桥无 PROBE-RDATA = 引擎不跟随重定向
  // 面板规则: 单发不覆盖(6731 教训); 双路回调; +11s 汇总。
  function runExp6733() {
    if (State.exp6733Done) return;
    State.exp6733Done = true;
    const ts = String(nowMs()).slice(-6);
    dlog("exp6733 start v" + VERSION + " ts=" + ts);

    const mk = function (id) {
      let p = null;
      try { p = findChild(getRoot(), id); } catch (e) {}
      if (!isValid(p)) {
        try { p = $.CreatePanel("Image", getRoot(), id); } catch (e) {}
        if (isValid(p)) {
          try { p.visible = true; p.style.width = "2px"; p.style.height = "2px"; p.style.x = "0px"; p.style.y = "0px"; } catch (e) {}
        }
      }
      return p;
    };
    const pA = mk("LCTP33A");
    const pB = mk("LCTP33B");
    dlog("33 panels: A(plain)=" + !!pA + " B(redirect)=" + !!pB);

    // ---- 字符串回读: 全属性扫描(URL类) + 加载前后变化 diff + 候选方法/属性 ----
    const snapStrings = function (panel) {
      const m = {};
      try {
        const names = Object.getOwnPropertyNames(panel);
        for (const n of names) {
          try { const v = panel[n]; if (typeof v === "string") m[n] = v; } catch (e) {}
        }
      } catch (e) {}
      return m;
    };
    const readback = function (pid, panel, before) {
      const hits = [];
      const after = snapStrings(panel);
      // 1) 变化检测(加载后新增/改变的字符串属性)
      for (const n in after) {
        const v = after[n];
        if (before[n] !== v) {
          const bv = before[n] === undefined ? "<none>" : before[n];
          hits.push("CHANGED " + n + ": " + String(bv).slice(0, 80) + " -> " + String(v).slice(0, 300));
        }
      }
      // 2) URL 类扫描(无论变没变)
      for (const n in after) {
        const v = after[n];
        const lv = v.toLowerCase();
        if (lv.indexOf("http") !== -1 || v.indexOf("BT_") !== -1 || lv.indexOf(".png") !== -1 || lv.indexOf("rdata") !== -1) {
          if (!hits.some(function (h) { return h.indexOf(n + ":") !== -1; })) hits.push("URLLIKE " + n + "=" + v.slice(0, 300));
        }
      }
      // 3) 候选属性读取 API
      if (typeof panel.GetAttributeString === "function") {
        const attrs = ["src", "image", "imagepath", "url", "texture", "backgroundimage"];
        for (const a of attrs) {
          try { const s = panel.GetAttributeString(a, ""); if (s) hits.push("attr:" + a + "=" + String(s).slice(0, 300)); } catch (e) {}
        }
      }
      // 4) 候选读取方法
      const fns = ["GetImage", "GetImageURL", "GetImagePath", "GetTextureName", "GetUrl"];
      for (const m of fns) {
        if (typeof panel[m] === "function") {
          try { const r = panel[m](); if (r) hits.push("fn:" + m + "()=" + String(r).slice(0, 300)); }
          catch (e) { hits.push("fn:" + m + " THREW:" + expErr(e)); }
        }
      }
      return hits;
    };

    State.base33 = {};
    State.loaded33 = {};
    State.readback33 = {};

    const onLoaded33 = function (via, panel) {
      let pid = "";
      try { pid = panel ? String(panel.id) : ""; } catch (e) {}
      if (pid !== "LCTP33A" && pid !== "LCTP33B") return;
      State.loaded33[pid] = (State.loaded33[pid] || 0) + 1;
      if (State.readback33[pid]) return; // 只回读一次
      try {
        const hits = readback(pid, panel, State.base33[pid] || {});
        State.readback33[pid] = hits.length;
        dlog("33 READBACK[" + pid + "] via " + via + " hits=" + hits.length + ": " + hits.join(" || ").slice(0, 900));
      } catch (e) { dlog("33 READBACK[" + pid + "] THREW: " + expErr(e)); }
    };

    // 双路回调
    try {
      $.RegisterForUnhandledEvent("ImageLoaded", function (panel) { onLoaded33("unhandled", panel); });
      dlog("33 unhandled registered");
    } catch (e) { dlog("33 unhandled THREW: " + expErr(e)); }
    if (isValid(pA)) {
      try { $.RegisterEventHandler("ImageLoaded", pA, function () { onLoaded33("REH", pA); }); dlog("33 REH registered on A"); }
      catch (e) { dlog("33 REH(A) THREW: " + expErr(e)); }
    }
    if (isValid(pB)) {
      try { $.RegisterEventHandler("ImageLoaded", pB, function () { onLoaded33("REH", pB); }); dlog("33 REH registered on B"); }
      catch (e) { dlog("33 REH(B) THREW: " + expErr(e)); }
    }

    // 基线快照(加载前)
    try {
      $.Schedule(1.5, function () {
        if (isValid(pA)) State.base33["LCTP33A"] = snapStrings(pA);
        if (isValid(pB)) State.base33["LCTP33B"] = snapStrings(pB);
        dlog("33 baseline captured (A strings=" + Object.keys(State.base33["LCTP33A"] || {}).length +
          ", B strings=" + Object.keys(State.base33["LCTP33B"] || {}).length + ")");
      });
    } catch (e) {}

    // 单发两枪
    if (isValid(pA)) {
      try {
        $.Schedule(2.0, function () {
          dlog("33 SHOT[T1-plain] LCTP33A t=" + nowMs());
          try { pA.SetImage("http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe?seq=33a&d=BT_ORIG33"); }
          catch (e) { dlog("33 SetImage(A) THREW: " + expErr(e)); }
        });
      } catch (e) {}
    }
    if (isValid(pB)) {
      try {
        $.Schedule(2.5, function () {
          dlog("33 SHOT[T2-redirect] LCTP33B t=" + nowMs());
          try { pB.SetImage("http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/redir302?o=BT_ORIG33&f=BT_FINAL33"); }
          catch (e) { dlog("33 SetImage(B) THREW: " + expErr(e)); }
        });
      } catch (e) {}
    }

    // 汇总
    try {
      $.Schedule(11.0, function () {
        const aL = State.loaded33["LCTP33A"] || 0;
        const bL = State.loaded33["LCTP33B"] || 0;
        dlog("33-SUM T1(plain) loaded=" + aL + " readbackHits=" + (State.readback33["LCTP33A"] !== undefined ? State.readback33["LCTP33A"] : "n/a"));
        dlog("33-SUM T2(redirect) loaded=" + bL + " readbackHits=" + (State.readback33["LCTP33B"] !== undefined ? State.readback33["LCTP33B"] : "n/a"));
        dlog("33-SUM done (check PROBE-REDIR/PROBE-RDATA in bridge log)");
      });
    } catch (e) {}
  }

  // ============= EXP6734-A: Image 面板全方法名枚举(只枚举,零调用) =============
  // 目的: 关死/捡漏 src 回读 —— 找 GetImage/GetURL/GetSource/GetTexture/GetPath/GetFile 类 accessor。
  // 规则: 只 typeof + 名字过滤,绝不调用;命中与全量名单都贴回。
  function runExp6734A() {
    if (State.exp6734ADone) return;
    State.exp6734ADone = true;
    const ts = String(nowMs()).slice(-6);
    dlog("exp6734A start v" + VERSION + " ts=" + ts);

    let p = null;
    try { p = findChild(getRoot(), "LCTP34A"); } catch (e0) {}
    if (!isValid(p)) {
      try { p = $.CreatePanel("Image", getRoot(), "LCTP34A"); } catch (e) {}
      if (isValid(p)) {
        try { p.visible = true; p.style.width = "2px"; p.style.height = "2px"; p.style.x = "0px"; p.style.y = "0px"; } catch (e) {}
      }
    }
    dlog("34-A panel=" + !!p);
    if (!isValid(p)) { dlog("34-A panel missing, abort"); return; }

    const KW = ["image", "url", "src", "texture", "path", "file"];
    const enumFns = function (tag) {
      if (State.enum34Done) return;
      State.enum34Done = true;
      try {
        const seen = {};
        const all = [];
        try {
          const own = Object.getOwnPropertyNames(p);
          for (const n of own) { if (!seen[n]) { seen[n] = 1; all.push(n); } }
        } catch (e) {}
        try {
          for (const n in p) { if (!seen[n]) { seen[n] = 1; all.push(n); } }
        } catch (e) {}
        const fns = [];
        const hits = [];
        for (const n of all) {
          let t = "";
          try { t = typeof p[n]; } catch (e) { continue; }
          if (t !== "function") continue;
          fns.push(n);
          const lo = String(n).toLowerCase();
          for (const k of KW) {
            if (lo.indexOf(k) !== -1) { hits.push(n); break; }
          }
        }
        dlog("34-A[" + tag + "] hits(" + hits.length + "): " + (hits.length ? hits.join(", ") : "EMPTY"));
        dlog("34-A[" + tag + "] total functions: " + fns.length);
        expChunk("34-A[" + tag + "] all fns", fns.join(","));
        dlog("34-A[" + tag + "] done (do NOT call any of these until reviewed)");
      } catch (e) { dlog("34-A enum THREW: " + expErr(e)); }
    };

    // 双路回调(只记 loaded,枚举在 loaded 或 6s 兜底里跑一次)
    try {
      $.RegisterForUnhandledEvent("ImageLoaded", function (panel) {
        let pid = "";
        try { pid = panel ? String(panel.id) : ""; } catch (e) {}
        if (pid !== "LCTP34A") return;
        dlog("34-A LOADED id=" + pid + " t=" + nowMs());
        enumFns("onload");
      });
    } catch (e) { dlog("34-A unhandled THREW: " + expErr(e)); }
    try {
      $.RegisterEventHandler("ImageLoaded", p, function () { dlog("34-A REH LOADED"); enumFns("reh"); });
    } catch (e) { dlog("34-A REH THREW: " + expErr(e)); }

    // 单发一枪
    try {
      $.Schedule(2.0, function () {
        dlog("34-A SHOT t=" + nowMs());
        try { p.SetImage("http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe?seq=34a&d=BT_34A"); }
        catch (e) { dlog("34-A SetImage THREW: " + expErr(e)); }
      });
    } catch (e) {}
    // 兜底: 6s 还没 loaded 也枚举(方法是静态的,不依赖加载)
    try { $.Schedule(8.0, function () { enumFns("fallback"); dlog("34-A fallback check done"); }); } catch (e) {}
  }

  // ============= EXP6734-B: 真实对局 64 面板 × 20 轮延迟测试 =============
  // 手动触发: 进对局(可移动后)聊天输入 /bt6734b。
  // 规格: 64 面板一批 → 全到齐(或 12s 超时)才开下一轮 → 20 轮;
  //       dt 在游戏内用引擎毫秒算(shot→ImageLoaded),不受日志尾随延迟影响;
  //       上报只走 $.Msg → console.log tail(1280 行不走信标,防 0.2s 队列积压)。
  function runExp6734B() {
    if (State.bitRunning) { log("exp6734B: already running, ignore"); return; }
    State.bitRunning = true;
    State.bitRound = 0;
    const N = 64;
    const ROUNDS = 20;
    log("exp6734B: START v" + VERSION + " rounds=" + ROUNDS + " panels=" + N);

    // 64 面板(隐藏;复用防重建)
    const panels = [];
    for (let i = 0; i < N; i += 1) {
      const id = "BTBIT" + i;
      let p = null;
      try { p = findChild(getRoot(), id); } catch (e) {}
      if (!isValid(p)) {
        try { p = $.CreatePanel("Image", getRoot(), id); } catch (e) {}
        if (isValid(p)) { try { p.visible = false; p.style.width = "2px"; p.style.height = "2px"; } catch (e) {} }
      }
      if (isValid(p)) panels.push(p);
    }
    log("exp6734B: panels ready " + panels.length + "/" + N);
    if (panels.length < N) {
      log("exp6734B: ABORT (not enough panels)");
      State.bitRunning = false;
      return;
    }
    State.bitPanels = panels;

    // ImageLoaded 处理(每会话只注册一次,状态全走 State 防闭包陈旧)
    if (!State.bitHandlerOn) {
      State.bitHandlerOn = true;
      try {
        $.RegisterForUnhandledEvent("ImageLoaded", function (panel) {
          let pid = "";
          try { pid = panel ? String(panel.id) : ""; } catch (e) {}
          if (pid.slice(0, 5) !== "BTBIT") return;
          if (!State.bitActive) return;
          if (State.bitIds[pid]) return;
          State.bitIds[pid] = 1;
          const dt = nowMs() - State.bitT0;
          State.bitLoaded += 1;
          if (State.bitMin === null || dt < State.bitMin) State.bitMin = dt;
          if (State.bitMax === null || dt > State.bitMax) State.bitMax = dt;
          log("exp6734B: LOADED id=" + pid + " dt=" + dt);
          if (State.bitLoaded >= State.bitPanels.length) bitFinishRound();
        });
      } catch (e) { log("exp6734B: handler THREW " + expErr(e)); }
    }

    const bitStartRound = function () {
      State.bitRound += 1;
      State.bitActive = true;
      State.bitIds = {};
      State.bitLoaded = 0;
      State.bitMin = null;
      State.bitMax = null;
      State.bitT0 = nowMs();
      log("exp6734B: ROUND=" + State.bitRound + " SHOT t=" + State.bitT0);
      for (let i = 0; i < State.bitPanels.length; i += 1) {
        try {
          State.bitPanels[i].SetImage(
            "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe_bit?id=BTBIT" + i + "&round=" + State.bitRound
          );
        } catch (e) { log("exp6734B: SetImage THREW " + expErr(e)); }
      }
      const myRound = State.bitRound;
      try {
        $.Schedule(12.0, function () {
          if (State.bitRound !== myRound || !State.bitActive) return; // 本轮已正常完成
          log("exp6734B: ROUND=" + myRound + " TIMEOUT loaded=" + State.bitLoaded + "/" + State.bitPanels.length);
          bitFinishRound();
        });
      } catch (e) {}
    };

    function bitFinishRound() {
      if (!State.bitActive) return;
      State.bitActive = false;
      log("exp6734B: ROUND=" + State.bitRound + " DONE loaded=" + State.bitLoaded + "/" + State.bitPanels.length +
        " min=" + State.bitMin + " max=" + State.bitMax + " t0=" + State.bitT0);
      if (State.bitRound >= ROUNDS) {
        log("exp6734B: ALL DONE (" + ROUNDS + " rounds complete)");
        State.bitRunning = false;
      } else {
        try { $.Schedule(1.5, bitStartRound); }
        catch (e) { log("exp6734B: schedule THREW " + expErr(e)); State.bitRunning = false; }
      }
    }

    bitStartRound();
  }

  // ============= EXP6734-C: 聊天输入框 TextEntry 控制 =============
  // C-1 树扫描找 TextEntry(能力探测,不猜名) → C-2 面板枚举 → C-3 只读 → C-4 改 p.text →
  // C-5 两段手动 Enter 判定: 发出的是原文还是改后文(= 发送前翻译"回填 TextEntry"路线判定)
  // 触发: 聊天输兣 /bt6734c;不自动 Enter,第1下拦截改写,第2下才真发送;/ 开头命令可退出布防。
  function exp6734cChunk(prefix, s) {
    const size = 480;
    if (!s.length) { log("exp6734C: " + prefix + "#0 <empty>"); return; }
    for (let i = 0; i < s.length; i += size) log("exp6734C: " + prefix + "#" + (i / size) + ": " + s.slice(i, i + size));
  }

  // C-1: 从根面板递归扫(不猜名),收集一切带 text 属性的面板,探测 TextEntry 特征方法
  function exp6734cScanTree() {
    const root = getRoot();
    const found = [];
    let scanned = 0;
    const TE_PROBES = ["GetMaxChars", "SetMaxChars", "SetSelectedText", "GetSelectedText", "InsertString", "MoveCursorEnd", "SetDisabled"];
    const visit = function (p, depth) {
      if (!isValid(p) || depth > 25 || scanned > 4000) return;
      scanned += 1;
      let hasText = false;
      try { hasText = typeof p.text === "string"; } catch (e) {}
      if (hasText) {
        let id = "", ty = "?", cls = "";
        const hits = [];
        try { id = String(p.id || ""); } catch (e) {}
        try { if (typeof p.type === "string") ty = p.type; } catch (e) {}
        try { if (typeof p.GetPanelClassList === "function") cls = String(p.GetPanelClassList().join(",")); } catch (e) {}
        for (let i = 0; i < TE_PROBES.length; i += 1) {
          try { if (typeof p[TE_PROBES[i]] === "function") hits.push(TE_PROBES[i]); } catch (e) {}
        }
        let cur = "";
        try { cur = String(p.text).slice(0, 40); } catch (e) {}
        found.push({ id: id || "?", ty: ty, cls: cls, hits: hits.join("|") || "-", text: cur });
      }
      const n = childCount(p);
      for (let i = 0; i < n; i += 1) visit(childAt(p, i), depth + 1);
    };
    visit(root, 0);
    log("exp6734C: C1 scan panels=" + scanned + " textCapable=" + found.length);
    for (let i = 0; i < found.length && i < 60; i += 1) {
      const f = found[i];
      log("exp6734C: C1 [" + i + "] id=" + f.id + " type=" + f.ty + " te-hits=" + f.hits + " cls=" + f.cls.slice(0, 70) + " text=" + JSON.stringify(f.text));
    }
    if (found.length > 60) log("exp6734C: C1 ... +" + (found.length - 60) + " more");
    let known = null;
    try { known = findChild(root, CHAT_INPUT_ID); } catch (e) {}
    log("exp6734C: C1 knownId ChatInput found=" + (isValid(known) ? "yes" : "no"));
    return found;
  }

  // C-5 观测: 从第1下 Enter 起,对 chat/lobby/hud 消息容器做基线后增量行分类
  // 分类优先级: 含唯一标记 → SENT=MODIFIED;仅含原文且 IsSelf → SENT=ORIGINAL
  function exp6734cObsStart(st) {
    const containers = function () {
      const out = [];
      try { const m = resolveChatMessages(); if (m) out.push({ k: "chat", p: m }); } catch (e) {}
      try { const l = resolveLobbyMessages(); if (l) out.push({ k: "lobby", p: l }); } catch (e) {}
      try {
        resolveHudMessages();
        for (let i = 0; i < State.hudMessages.length; i += 1) out.push({ k: "hud" + i, p: State.hudMessages[i] });
      } catch (e) {}
      return out;
    };
    const bl = {};
    const cs0 = containers();
    for (let i = 0; i < cs0.length; i += 1) {
      try { bl[cs0[i].k] = childCount(cs0[i].p); } catch (e) { bl[cs0[i].k] = 0; }
    }
    st.hits = st.hits || [];
    st.logged = st.logged || {};
    const ticks = [0.5, 1.2, 2.5, 4.5, 7.5, 11.0];
    let idx = 0;
    const step = function () {
      if (State.c5obs !== st || st.done) return;
      const cs = containers();
      for (let ci = 0; ci < cs.length; ci += 1) {
        const c = cs[ci];
        let n = 0;
        try { n = childCount(c.p); } catch (e) { continue; }
        if (typeof bl[c.k] !== "number") bl[c.k] = n; // 中途新出现的容器: 从当前水位起数
        const start = Math.min(bl[c.k], Math.max(0, n - 3)); // 已知基线 + 永远兼顾末3行
        for (let i = start; i < n; i += 1) {
          const row = childAt(c.p, i);
          let txt = "";
          try { txt = collectText(row); } catch (e) {}
          if (!txt) continue;
          let kind = "";
          if (st.marker && txt.indexOf(st.marker) >= 0) kind = "SENT=MODIFIED";
          else if (st.orig && txt.indexOf(st.orig) >= 0) {
            let own = false;
            try { own = hasClass(row, "IsSelf") || !!findClass(row, LOCAL_CLIENT_ID); } catch (e) {}
            if (own) kind = "SENT=ORIGINAL";
          }
          if (!kind) continue;
          const key = c.k + "#" + i + "#" + txt.slice(0, 20);
          if (st.logged[key]) continue;
          st.logged[key] = true;
          st.hits.push(kind);
          log("exp6734C: C5 row[" + c.k + "#" + i + "] " + kind + " text=" + JSON.stringify(txt.slice(0, 120)));
        }
        bl[c.k] = Math.max(bl[c.k], n); // 水位推进(已扫过的不重扫;末3行由 start 兼顾)
      }
      // 出结论: 双命中,或已发第2下且有命中(再补一拍),或打点用尽
      const hasM = st.hits.indexOf("SENT=MODIFIED") >= 0;
      const hasO = st.hits.indexOf("SENT=ORIGINAL") >= 0;
      const last = idx >= ticks.length - 1;
      if ((hasM && hasO) || (last) || (st.sent2 && (hasM || hasO) && idx >= 3)) {
        st.done = true;
        let verdict = "NOT_SENT";
        if (hasM && hasO) verdict = "BOTH (第1下原生发了原文?第2下又发了改后文,见上方 row 日志)";
        else if (hasM) verdict = "SENT=MODIFIED (改后文被发送 → 回填+发送链路成立)";
        else if (hasO) verdict = "SENT=ORIGINAL (原文被发送 → 引擎不吃 p.text 改写)";
        log("exp6734C: C5-RESULT " + verdict + " sent2=" + !!st.sent2 + " orig=" + JSON.stringify(String(st.orig || "").slice(0, 40)));
        State.c5obs = null;
        return;
      }
      idx += 1;
      if (idx < ticks.length) { try { $.Schedule(ticks[idx], step); } catch (e) {} }
      else {
        st.done = true;
        log("exp6734C: C5-RESULT NOT_SENT (11s 未见新行; sent2=" + !!st.sent2 + ")");
        State.c5obs = null;
      }
    };
    State.c5obs = st;
    try { $.Schedule(ticks[0], step); } catch (e) { log("exp6734C: obs schedule threw " + expErr(e)); }
  }

  // C-5 两段 Enter 拦截: wait=第1下(改写不发送) / send=第2下(与正常路径同语义发送)
  function exp6734cSubmitHook(input, trimmed) {
    try {
      const st = State.c5;
      if (!st) return false;
      if (trimmed.charAt(0) === "/") {
        log("exp6734C: disarm by command " + JSON.stringify(trimmed.slice(0, 40)));
        State.c5 = null;
        return false;
      }
      if (st.phase === "wait") {
        if (!trimmed) return true; // 布防中空回车吞掉
        st.orig = trimmed;
        st.marker = "LCTC" + String(nowMs()).slice(-6) + "M";
        const modified = st.marker + " " + trimmed.slice(0, 60);
        let wOk = false, rb = "";
        try { input.text = modified; wOk = true; } catch (e) { log("exp6734C: C5 write threw " + expErr(e)); }
        try { rb = String(input.text || ""); } catch (e) {}
        log("exp6734C: C3 userText=" + JSON.stringify(trimmed.slice(0, 80)));
        log("exp6734C: C4 rewrite=" + wOk + " readback=" + JSON.stringify(rb.slice(0, 90)) + " match=" + (rb === modified));
        st.phase = "send";
        exp6734cObsStart(st);
        log("exp6734C: C5 phase=send — 输入框已改写,再次按回车才发送(观察原文还是改后文)");
        return true; // 第1下: 不发送
      }
      if (st.phase === "send") {
        if (!trimmed) { log("exp6734C: C5 submit#2 empty, 保持 phase=send"); return true; }
        const isRewritten = trimmed === st.marker + " " + String(st.orig || "").slice(0, 60);
        log("exp6734C: C5 submit#2 raw=" + JSON.stringify(trimmed.slice(0, 90)) + " isRewritten=" + isRewritten);
        try { input.text = trimmed; } catch (e) {}
        triggerStockSubmit(input);
        clearInput();
        st.sent2 = true;
        State.c5 = null; // 布防结束,观测经 State.c5obs 继续
        log("exp6734C: C5 stock submit dispatched (normal-path semantics)");
        return true;
      }
      State.c5 = null;
      return false;
    } catch (e) {
      log("exp6734C: hook error " + expErr(e) + " — disarm");
      State.c5 = null;
      return false; // 出错必放行走正常路径,绝不吞用户消息
    }
  }

  function runExp6734C(input, cmd) {
    log("exp6734C: START v" + VERSION);
    // ---- C-1 树扫描 ----
    exp6734cScanTree();
    // ---- 定位目标输入框(能力扫描优先,回退本 mod XML 已知 id) ----
    const inp = (isValid(input) ? input : null) || State.input || findChild(getRoot(), CHAT_INPUT_ID);
    if (!isValid(inp)) { log("exp6734C: ABORT — no TextEntry(input) found"); return; }
    let inpId = "?";
    try { inpId = String(inp.id || "?"); } catch (e) {}
    // ---- C-2 面板枚举(只读) ----
    let names = [];
    try { names = Object.getOwnPropertyNames(inp); } catch (e) { log("exp6734C: C2 getOwnPropertyNames threw " + expErr(e)); }
    exp6734cChunk("C2 input[" + inpId + "] ownProps", names.join(","));
    // ---- C-3 只读当前内容(此刻应为命令串自身) ----
    let cur = "";
    try { cur = String(inp.text || ""); } catch (e) { log("exp6734C: C3 read threw " + expErr(e)); }
    log("exp6734C: C3 read id=" + inpId + " text=" + JSON.stringify(cur.slice(0, 60)) + " matchCmd=" + (cur.trim() === cmd));
    // ---- C-4 写+读回(写完即清,恢复空白输入框) ----
    const wmark = "LCTW" + String(nowMs()).slice(-6);
    let wOk = false, rb = "";
    try { inp.text = wmark; wOk = true; } catch (e) { log("exp6734C: C4 write threw " + expErr(e)); }
    try { rb = String(inp.text || ""); } catch (e) {}
    log("exp6734C: C4 write=" + wOk + " readback=" + JSON.stringify(rb.slice(0, 60)) + " match=" + (rb === wmark));
    clearInput();
    // ---- 布防 C-5 ----
    const st = { phase: "wait", t0: nowMs(), marker: "", orig: "", sent2: false, done: false };
    State.c5 = st;
    State.c5obs = null;
    try {
      $.Schedule(120.0, function () {
        if (State.c5 === st) {
          log("exp6734C: C5 timeout (120s) disarm phase=" + st.phase);
          State.c5 = null;
        }
      });
    } catch (e) {}
    log("exp6734C: ARMED — 输入测试文本按回车(第1下: 拦截改写不发送),再按回车(第2下: 真正发送);输入 / 开头命令即退出布防");
  }

  // ============= EXP6734-D: Bridge→Panorama 下行吞吐基准 =============
  // 目的: 用实测数据钉死 BTIPC v1 的 MAX_SAFE_PAYLOAD / SAFE_WINDOW / FRAME_TIMEOUT,帧规格不拍脑袋定。
  // 矩阵 D1~D6: 面板数 16/32/64/96/128/256 × 每面板 1 bit × 20 轮;
  // 窗口 W1~W5: 256 bit 帧按窗口 16/32/64/96/128 分批发射 × 10 轮(协议帧 ≠ 一次性发射的面板数)。
  // 触发: 对局内聊天 /bt6734d | /bt6734d <8..512> | /bt6734d win
  // 面板: 自建 Image 前缀 BTD*(与 6734-B 的 BTBIT* 严格隔离,两套 ImageLoaded handler 互不干扰),
  //       隐藏 2×2 复用;URL 带 c=<cfg>@<runTag> 击穿缓存 + 服务端按配置分组。
  // 指标行: LOADED(每 bit dt/seq) / WIN(每窗) / ROUND DONE|TIMEOUT(word/first/last/min/max/lost) / DUP / STALE
  // 分析: node scripts/exp6734d_analyze.js logs/bridge.log
  const EXP6734D_MATRIX = [16, 32, 64, 96, 128, 256];
  const EXP6734D_WINS = [16, 32, 64, 96, 128];

  function runExp6734D(arg) {
    if (State.dRunning) { log("exp6734D: already running, ignore"); return; }
    if (State.bitRunning) { log("exp6734D: 6734-B running, refuse(防两套探针互相污染)"); return; }

    // ---- 计划 ----
    const plan = [];
    if (arg === "win" || arg === "w") {
      for (let i = 0; i < EXP6734D_WINS.length; i += 1) {
        plan.push({ cfg: "256w" + EXP6734D_WINS[i], n: 256, win: EXP6734D_WINS[i], rounds: 10 });
      }
    } else if (arg === "") {
      for (let i = 0; i < EXP6734D_MATRIX.length; i += 1) {
        plan.push({ cfg: String(EXP6734D_MATRIX[i]), n: EXP6734D_MATRIX[i], win: 1, rounds: 20 });
      }
    } else {
      const n = parseInt(arg, 10);
      if (!(n >= 8 && n <= 512)) {
        log("exp6734D: 参数无效 " + JSON.stringify(arg) + " — 用法: /bt6734d | /bt6734d <8..512> | /bt6734d win");
        return;
      }
      plan.push({ cfg: String(n), n: n, win: 1, rounds: 20 });
    }

    // ---- 面板池(前缀 BTD*) ----
    let maxN = 0;
    for (let i = 0; i < plan.length; i += 1) if (plan[i].n > maxN) maxN = plan[i].n;
    const panels = [];
    let created = 0;
    for (let i = 0; i < maxN; i += 1) {
      const pid = "BTD" + i;
      let p = null;
      try { p = findChild(getRoot(), pid); } catch (e) {}
      if (!isValid(p)) {
        try { p = $.CreatePanel("Image", getRoot(), pid); } catch (e) {}
        if (isValid(p)) {
          created += 1;
          try { p.visible = false; p.style.width = "2px"; p.style.height = "2px"; } catch (e) {}
        }
      }
      if (isValid(p)) panels.push(p);
      else log("exp6734D: panel " + pid + " invalid");
    }
    const runTag = String(nowMs()).slice(-6);
    log("exp6734D: START v" + VERSION + " run=" + runTag + " plan=" +
        plan.map(function (c) { return c.cfg; }).join(",") +
        " panels=" + panels.length + "/" + maxN + " (new=" + created + ")");
    if (panels.length < maxN) {
      log("exp6734D: ABORT (面板不足 " + panels.length + "/" + maxN + ")");
      return;
    }

    State.dRunning = true;
    const st = {
      runTag: runTag, plan: plan, panels: panels, ci: 0,
      cfg: "", n: 0, win: 1, rounds: 0, r: 0,
      active: false, t0: 0, ids: {}, loaded: 0, seq: 0,
      first: null, last: null, min: null, max: null,
      winK: 0, winBase: 0, winShots: 0, wLoaded: 0, winT0: 0
    };
    State.d = st;

    const tagOf = function (s) { return "n=" + s.cfg + " r=" + s.r; };
    const winCountOf = function (s) { return Math.ceil(s.n / s.win); };
    const timeoutMsOf = function (s) {
      if (s.win <= 1) return 12000;
      return Math.min(60000, winCountOf(s) * 6000 + 12000);
    };

    // ---- ImageLoaded(每会话注册一次;状态全走 State.d 防闭包陈旧) ----
    if (!State.dHandlerOn) {
      State.dHandlerOn = true;
      try {
        $.RegisterForUnhandledEvent("ImageLoaded", function (panel) {
          let pid = "";
          try { pid = panel ? String(panel.id) : ""; } catch (e) {}
          if (pid.slice(0, 3) !== "BTD") return;
          const s = State.d;
          if (!s || !s.active) return;
          const idx = parseInt(pid.slice(3), 10);
          if (isNaN(idx)) return;
          const dt = nowMs() - s.t0;
          if (idx >= s.winShots) { log("exp6734D: STALE " + tagOf(s) + " i=" + idx + " dt=" + dt); return; }
          if (s.ids[pid]) { log("exp6734D: DUP " + tagOf(s) + " i=" + idx + " dt=" + dt); return; }
          s.ids[pid] = 1;
          s.loaded += 1;
          s.seq += 1;
          if (s.first === null) s.first = dt;
          s.last = dt;
          if (s.min === null || dt < s.min) s.min = dt;
          if (dt > s.max) s.max = dt;
          log("exp6734D: LOADED " + tagOf(s) + " i=" + idx + " dt=" + dt + " seq=" + s.seq);
          if (s.win > 1 && idx >= s.winBase) {
            s.wLoaded += 1;
            if (s.wLoaded >= s.winShots - s.winBase) {
              log("exp6734D: WIN " + tagOf(s) + " k=" + (s.winK + 1) + "/" + winCountOf(s) + " DONE dt=" + (nowMs() - s.winT0));
              dAdvance();
            }
          }
          if (s.loaded >= s.n) dFinishRound();
        });
      } catch (e) { log("exp6734D: handler THREW " + expErr(e)); }
    }

    // ---- 单窗口发射(	win=1 即整轮一批) ----
    const dShotWindow = function (k) {
      const s = State.d;
      if (!s || !s.active) return;
      const from = s.win > 1 ? k * s.win : 0;
      const to = Math.min(s.n, s.win > 1 ? (k + 1) * s.win : s.n);
      s.winK = k;
      s.winBase = from;
      s.winShots = to;
      s.wLoaded = 0;
      s.winT0 = nowMs();
      log("exp6734D: WIN " + tagOf(s) + " k=" + (k + 1) + "/" + winCountOf(s) +
          " SHOT " + from + ".." + (to - 1) + " t=" + s.winT0);
      const urlPrefix = "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe_bit?c=" + s.cfg + "&id=BTD";
      for (let i = from; i < to; i += 1) {
        try {
          s.panels[i].SetImage(urlPrefix + i + "&round=" + s.r);
        } catch (e) { log("exp6734D: SetImage THREW " + expErr(e)); }
      }
      // 窗口停滞推进: 单 bit 永不到不拖死整帧(仅窗口模式;win=1 由轮超时管)
      if (s.win > 1) {
        const myR = s.r, myK = k;
        try {
          $.Schedule(6.0, function () {
            const t = State.d;
            if (!t || !t.active || t.r !== myR || t.winK !== myK) return;
            log("exp6734D: WIN " + tagOf(t) + " k=" + (myK + 1) + "/" + winCountOf(t) +
                " STALL loaded=" + t.wLoaded + "/" + (t.winShots - t.winBase));
            dAdvance();
          });
        } catch (e) {}
      }
    };

    const dAdvance = function () {
      const s = State.d;
      if (!s || !s.active) return;
      if (s.winShots >= s.n) { dFinishRound(); return; }
      dShotWindow(s.winK + 1);
    };

    const dFinishRound = function () {
      const s = State.d;
      if (!s || !s.active) return;
      s.active = false;
      const word = nowMs() - s.t0;
      const lost = s.n - s.loaded;
      const label = lost <= 0 ? "DONE" : "TIMEOUT";
      log("exp6734D: ROUND " + tagOf(s) + " " + label + " loaded=" + s.loaded + "/" + s.n +
          " word=" + word +
          " first=" + (s.first === null ? -1 : s.first) + " last=" + (s.last === null ? -1 : s.last) +
          " min=" + (s.min === null ? -1 : s.min) + " max=" + (s.max === null ? -1 : s.max) +
          " lost=" + lost + " seqs=" + s.seq);
      if (s.r >= s.rounds) {
        log("exp6734D: CFG " + s.cfg + " DONE rounds=" + s.rounds + " idx=" + (s.ci + 1) + "/" + s.plan.length);
        s.ci += 1;
        if (s.ci >= s.plan.length) {
          log("exp6734D: ALL DONE — 全部配置完成;取数: node scripts/exp6734d_analyze.js logs/bridge.log");
          State.dRunning = false;
          State.d = null;
          return;
        }
        const nxt = s.plan[s.ci];
        try { $.Schedule(3.0, function () { dSetupConfig(nxt); }); }
        catch (e) { log("exp6734D: schedule THREW " + expErr(e)); State.dRunning = false; }
        return;
      }
      // 有丢失时多等一会(超时残留加载未落定,防污染下一轮 dt)
      const gap = lost <= 0 ? 0.5 : 3.0;
      try { $.Schedule(gap, dStartRound); }
      catch (e) { log("exp6734D: schedule THREW " + expErr(e)); State.dRunning = false; }
    };

    const dStartRound = function () {
      const s = State.d;
      if (!s) return;
      s.r += 1;
      s.active = true;
      s.ids = {};
      s.loaded = 0;
      s.seq = 0;
      s.first = null; s.last = null; s.min = null; s.max = null;
      s.t0 = nowMs();
      log("exp6734D: ROUND " + tagOf(s) + " SHOT t=" + s.t0);
      dShotWindow(0);
      const myR = s.r;
      try {
        $.Schedule(timeoutMsOf(s), function () {
          const t = State.d;
          if (!t || !t.active || t.r !== myR) return;
          dFinishRound();
        });
      } catch (e) { log("exp6734D: timeout schedule THREW " + expErr(e)); }
    };

    const dSetupConfig = function (cfgObj) {
      const s = State.d;
      if (!s) return;
      s.cfg = cfgObj.cfg + "@" + s.runTag;
      s.n = cfgObj.n;
      s.win = cfgObj.win;
      s.rounds = cfgObj.rounds;
      s.r = 0;
      log("exp6734D: CFG " + s.cfg + " START n=" + s.n + " win=" + s.win +
          " rounds=" + s.rounds + " idx=" + (s.ci + 1) + "/" + s.plan.length);
      dStartRound();
    };

    dSetupConfig(plan[0]);
  }

  // ============= EXP6734-E: 多值符号判别(一个 Image 面板能否 >1 bit) =============
  // 13 状态码 × 20 轮 × 1 面板/符号;面板唯一且每轮 URL 加 round 击穿缓存,同面板不重复 SetImage(6731 铁律)。
  // 服务端:2xx→空PNG;3xx→302 跳 /rdata?f=E<code>(复用 6733 的游戏端 URL 文本上报);4xx/5xx→短 HTML。
  // 预期三值判定: 200/201/204/206→LOADED(fast);301/302/304/307→LOADED(REDIR-LATE,~>800ms);
  // 4xx/5xx→LOADED(HTML)或静默——无论哪种只要**与 2xx 行为可区分**即多值符号成立。
  // 判读: node scripts/exp6734e_analyze.js logs/bridge.log
  const EXP6734E_CODES = [200, 201, 204, 206, 301, 302, 304, 307, 400, 401, 403, 404, 500];

  function runExp6734E() {
    if (State.eRunning) { log("exp6734E: already running, ignore"); return; }
    if (State.dRunning || State.bitRunning) { log("exp6734E: 6734-B/D running, refuse"); return; }

    // 每符号 1 个面板(唯一 id,复用);URL 带 round=击穿缓存,永不覆盖同一面板
    const panels = [];
    for (let i = 0; i < EXP6734E_CODES.length; i += 1) {
      const pid = "BTE" + i;
      let p = null;
      try { p = findChild(getRoot(), pid); } catch (e) {}
      if (!isValid(p)) {
        try { p = $.CreatePanel("Image", getRoot(), pid); } catch (e) {}
        if (isValid(p)) { try { p.visible = false; p.style.width = "2px"; p.style.height = "2px"; } catch (e) {} }
      }
      if (!isValid(p)) { log("exp6734E: ABORT panel " + pid); return; }
      panels.push(p);
    }
    const runTag = String(nowMs()).slice(-6);
    const ROUNDS = 20, GAP = 2.0, TIMEOUT = 12.0;
    log("exp6734E: START v" + VERSION + " run=" + runTag + " codes=" + EXP6734E_CODES.join("/") + " rounds=" + ROUNDS);
    State.eRunning = true;
    const st = { runTag: runTag, r: 0, active: false, t0: 0, seen: {} };
    State.e = st;

    if (!State.eHandlerOn) {
      State.eHandlerOn = true;
      try {
        $.RegisterForUnhandledEvent("ImageLoaded", function (panel) {
          let pid = "";
          try { pid = panel ? String(panel.id) : ""; } catch (e) {}
          if (pid.slice(0, 3) !== "BTE") return;
          const s = State.e;
          if (!s || !s.active) return;
          const idx = parseInt(pid.slice(3), 10);
          if (isNaN(idx) || idx >= EXP6734E_CODES.length) return;
          const code = EXP6734E_CODES[idx];
          if (s.seen[code]) { log("exp6734E: DUP n=" + s.runTag + " r=" + s.r + " code=" + code); return; }
          s.seen[code] = 1;
          const dt = nowMs() - s.t0;
          const speed = dt < 800 ? "FAST" : "LATE";
          log("exp6734E: LOADED n=" + s.runTag + " r=" + s.r + " code=" + code + " dt=" + dt + " " + speed);
        });
      } catch (e) { log("exp6734E: handler THREW " + expErr(e)); }
    }

    const eFinishRound = function () {
      const s = State.e;
      if (!s || !s.active) return;
      s.active = false;
      const missed = [];
      for (let i = 0; i < EXP6734E_CODES.length; i += 1) {
        if (!s.seen[EXP6734E_CODES[i]]) missed.push(EXP6734E_CODES[i]);
      }
      log("exp6734E: ROUND n=" + s.runTag + " r=" + s.r + " END loaded=" + (EXP6734E_CODES.length - missed.length) +
          "/13 missed=" + (missed.length ? missed.join("/") : "-"));
      if (s.r >= ROUNDS) {
        log("exp6734E: ALL DONE — 取数: node scripts/exp6734e_analyze.js logs/bridge.log");
        State.eRunning = false;
        State.e = null;
        return;
      }
      try { $.Schedule(GAP, eStartRound); } catch (e) { log("exp6734E: schedule THREW " + expErr(e)); State.eRunning = false; }
    };

    const eStartRound = function () {
      const s = State.e;
      if (!s) return;
      s.r += 1;
      s.active = true;
      s.seen = {};
      s.t0 = nowMs();
      log("exp6734E: ROUND n=" + s.runTag + " r=" + s.r + " SHOT t=" + s.t0);
      const urlPrefix = "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe_e?id=BTE";
      for (let i = 0; i < EXP6734E_CODES.length; i += 1) {
        try {
          panels[i].SetImage(urlPrefix + i + "&round=" + s.r + "&code=" + EXP6734E_CODES[i] + "&t=" + s.runTag);
        } catch (e) { log("exp6734E: SetImage THREW " + expErr(e)); }
      }
      const myR = s.r;
      try {
        $.Schedule(TIMEOUT, function () {
          const t = State.e;
          if (!t || !t.active || t.r !== myR) return;
          eFinishRound();
        });
      } catch (e) { log("exp6734E: timeout schedule THREW " + expErr(e)); }
    };

    eStartRound();
  }

  function boot() {
    State.cfg = loadUiConfig();
    applyUILang(); // 初始化界面语言
    ensureBridgeEvents(); // 尽早注册 HTML 面板事件(读回主通道)
    registerUmmSettings(); // UMM 设置联动(UMM 不在时为无害空操作,见 ummCurrentValues 注释)
    initBakedGameNames(); // btipc07:先装打包内烘焙的全量配对名单(292 条,硬编码只有 100 条)
    syncBridgeConfig(); // BUGFIX 0.1.3:启动即同步桥配置,发送前翻译不再需要先开一次设置面板
    applyUILang(); // 初始化界面语言(配置同步后应用)
    updateBridgeDot(); // 初始状态:桥未上线前显示红点
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
    // 诊断探针2:容器行数心跳(每 15s,变化时才打;rows=-1 = ChatMessages 容器不存在=布局断)
    $.Schedule(15.0, function diagLoop() {
      try {
        const messages = resolveChatMessages();
        const n = messages ? childCount(messages) : -1;
        if (n !== State._diagRows) {
          State._diagRows = n;
          log("diag: ChatMessages rows=" + n);
        }
      } catch (e) {}
      $.Schedule(15.0, diagLoop);
    });
  }

  // ============= EXP6738: 三点「正在发送」广播指示器 + 聊天行结构取证 =============
  // 背景:9/30 更新后,普通聊天按回车 → 广播给所有人一个「...」三点对话框;快捷语音不走这条路径。
  // 目标:① 抓三点面板的 type/id/class/父链/可见性/尺寸/存活时长(C++ 动态创建,静态资源里查不到)
  //       ② 抓每条新聊天行的 class 列表 + 子树结构 + 本方 quick 判定(看游戏是否给轮盘消息留了类型标记)
  //       ③ 行到达时三点窗口是否活跃(相关性)→ 判定该信号能否当 quickchat_match 第二判据
  // 触发:聊天输入 /bt6738(toggle;/bt6738 stop 明确停);日志前缀 exp6738:
  // 回收:$.Msg → 游戏 console.log → 桥 tail → logs/bridge.log 的 [game] 行
  const P6738_POLL = 0.12;      // 120ms 轮询(三点存活 = 回车到服务器回显,通常 ≥200ms,120ms 足够不漏沿)
  const P6738_MAX_NODES = 6000; // 全树扫描节点上限(HUD 树防炸)
  const P6738_MAX_CAND = 80;    // CAND 日志上限(弱命中可能扫到静态面板,防刷屏;计数不截)
  const P6738_MAX_ROWS = 60;    // 行结构 dump 上限
  // 注意:本正则刻意零反斜杠(LEARNINGS 2026-08-31:resourcecompiler 对 JS 正则反斜杠转义有 bug)
  const P6738_TEXT_RE = /^[.…·•・․]{1,8}$/;                                // "..." "…" "・・・" 等点状文本
  const P6738_ANCHOR_RE = /typ|dots|indicator|queue|deliver|sending|chatstatus|messagestatus|pend/i; // id/class/src 锚定

  function runExp6738(arg) {
    const S = State.p6738 || (State.p6738 = { active: false });
    if (arg === "stop") {
      if (!S.active) { log("exp6738: not running"); return; }
      S.active = false;
      log("exp6738: STOP ticks=" + S.ticks + " cands=" + S.seq + " rows=" + S.rowsLogged);
      return;
    }
    if (S.active) {
      if (arg === "start") { log("exp6738: already running"); return; }
      S.active = false;
      log("exp6738: STOP ticks=" + S.ticks + " cands=" + S.seq + " rows=" + S.rowsLogged);
      return;
    }
    S.active = true;
    S.t0 = nowMs();
    S.ticks = 0;
    S.seq = 0;
    S.rowsLogged = 0;
    S.candCap = false;
    S.rowCap = false;
    S.cands = {};  // sig -> {seq, first, last, open, hit}
    S.rows = {};   // 容器 key -> 上次行数(基线,防把历史行当新行 dump)
    S.dotsOn = false;
    S.lastOn = 0;
    S.lastOff = 0;
    p6738Baseline(S);
    log("exp6738: START poll=" + P6738_POLL + "s; 动作:① 自己打字回车 ② 自己发快捷语音 ③ 等别人打字(关键:广播归因); 完了 /bt6738");
    try { $.Schedule(P6738_POLL, p6738Tick); } catch (e) { log("exp6738: schedule THREW " + expErr(e)); }
  }

  function p6738Containers() {
    const out = [];
    try { const m = resolveChatMessages(); if (m) out.push({ k: "chat", p: m }); } catch (e) {}
    try { const l = resolveLobbyMessages(); if (l) out.push({ k: "lobby", p: l }); } catch (e) {}
    try {
      resolveHudMessages();
      for (let i = 0; i < State.hudMessages.length; i += 1) out.push({ k: "hud" + i, p: State.hudMessages[i] });
    } catch (e) {}
    return out;
  }

  function p6738Baseline(S) {
    const conts = p6738Containers();
    for (let i = 0; i < conts.length; i += 1) {
      if (!isValid(conts[i].p)) continue;
      S.rows[conts[i].k] = childCount(conts[i].p);
    }
  }

  function p6738Tick() {
    const S = State.p6738;
    if (!S || !S.active) return;
    S.ticks += 1;
    try { p6738ScanDots(S); } catch (e) { log("exp6738: dots THREW " + expErr(e)); }
    try { p6738ScanRows(S); } catch (e) { log("exp6738: rows THREW " + expErr(e)); }
    try { $.Schedule(P6738_POLL, p6738Tick); } catch (e) {}
  }

  // 点组判定:面板有 2~6 个子面板,每个子面板文本都是点状字符(三个独立 "." label 的形态)
  function p6738DotGroup(p) {
    const n = childCount(p);
    if (n < 2 || n > 6) return false;
    let combined = "";
    for (let i = 0; i < n; i += 1) {
      const t = safeText(childAt(p, i));
      if (!t || !P6738_TEXT_RE.test(t)) return false;
      combined += t;
    }
    return combined.length >= 2 && combined.length <= 12;
  }

  // 父链:id.class 逐级向上(≤6 级),定位面板在树里的位置
  function p6738Path(p) {
    const parts = [];
    let cur = p;
    for (let i = 0; i < 6 && isValid(cur); i += 1) {
      let id = "", cls = "";
      try { id = String(cur.id || ""); } catch (e) {}
      try { if (cur.GetPanelClassList) cls = String(cur.GetPanelClassList().join(" ").split(" ").join(".")); } catch (e) {}
      parts.push((id || "-") + (cls ? "." + cls : ""));
      try { cur = cur.GetParent ? cur.GetParent() : null; } catch (e) { cur = null; }
    }
    return parts.join(" < ").slice(0, 240);
  }

  // 三点候选命中判定(不猜名,三条路命中任一):
  //   strong(text/dotgroup):文本本身是点状,或子面板全是点 → 直接贡献 dotsOn
  //   weak(anchor):id/class/src 命中锚定词且文本很短 → 需可见 + 对话框尺寸(≤400×400)才贡献
  function p6738Hit(p) {
    const txt = safeText(p);
    if (txt && P6738_TEXT_RE.test(txt)) return { hit: "text:" + txt, strong: true, txt: txt };
    let id = "", cls = "", src = "";
    try { id = String(p.id || ""); } catch (e) {}
    try { if (p.GetPanelClassList) cls = String(p.GetPanelClassList().join(",")); } catch (e) {}
    try { src = String(p.src || ""); } catch (e) {}
    const anchor = P6738_ANCHOR_RE.exec(id + "|" + cls + "|" + src);
    if (anchor && txt.length <= 12) {
      return { hit: "anchor:" + anchor[0], strong: false, txt: txt, id: id, cls: cls, src: src };
    }
    if (p6738DotGroup(p)) return { hit: "dotgroup", strong: true, txt: txt };
    return null;
  }

  function p6738ScanDots(S) {
    const root = getRoot();
    if (!root) return;
    const now = nowMs();
    const found = {};
    let scanned = 0;
    const visit = function (p, depth) {
      if (!isValid(p) || depth > 30 || scanned > P6738_MAX_NODES) return;
      scanned += 1;
      const h = p6738Hit(p);
      if (h) {
        let ty = "?", id = h.id, cls = h.cls;
        try { if (typeof p.type === "string") ty = p.type; } catch (e) {}
        try { if (id === undefined) id = String(p.id || ""); } catch (e) {}
        try { if (cls === undefined && p.GetPanelClassList) cls = String(p.GetPanelClassList().join(",")); } catch (e) {}
        const path = p6738Path(p);
        const sig = ty + "#" + (id || "-") + "[" + (cls || "") + "]@" + path + ":" + h.txt;
        let vis = "?", w = -1, hh = -1;
        try { vis = String(p.visible); } catch (e) {}
        try {
          if (typeof p.GetActualLayoutWidth === "function") { w = p.GetActualLayoutWidth(); hh = p.GetActualLayoutHeight(); }
        } catch (e) {}
        // 弱命中需可见 + 尺寸像对话框,否则只记录不计入 dotsOn(挡静态 Pending 之类)
        const usable = h.strong || (vis === "true" && (w < 0 || w <= 400) && (hh < 0 || hh <= 400));
        const c = S.cands[sig];
        if (!c) {
          S.seq += 1;
          S.cands[sig] = { seq: S.seq, first: now, last: now, open: usable, hit: h.hit };
          if (S.seq <= P6738_MAX_CAND) {
            log("exp6738: CAND#" + S.seq + " " + h.hit + (usable ? "" : " (weak-gated off)") +
              " t=+" + (now - S.t0) + "ms type=" + ty + " vis=" + vis + " wh=" + w + "x" + hh +
              " path=" + path + " txt=" + JSON.stringify(h.txt));
          } else if (!S.candCap) {
            S.candCap = true;
            log("exp6738: CAND cap " + P6738_MAX_CAND + " reached (counting only)");
          }
        } else {
          c.last = now;
          if (usable && !c.open) {
            c.open = true;
            log("exp6738: BACK#" + c.seq + " t=+" + (now - S.t0) + "ms");
          } else if (!usable && c.open) {
            c.open = false;
          }
        }
        found[sig] = 1;
      }
      const n = childCount(p);
      for (let i = 0; i < n; i += 1) visit(childAt(p, i), depth + 1);
    };
    visit(root, 0);
    // 消失/出现结算
    const openSeqs = [];
    for (const sig in S.cands) {
      const c = S.cands[sig];
      if (c.open && !found[sig]) {
        c.open = false;
        if (c.seq <= P6738_MAX_CAND) {
          log("exp6738: GONE#" + c.seq + " life=" + (now - c.first) + "ms sinceSeen=" + (now - c.last) + "ms");
        }
      }
      if (c.open) openSeqs.push(c.seq);
    }
    const on = openSeqs.length > 0;
    if (S.ticks === 1) {
      // 首轮基线:若此刻已有强命中,后面 ON/OFF 时间线都要带这个底噪解读
      log("exp6738: BASELINE open=" + openSeqs.length + " [" + openSeqs.join(",") + "] nodes=" + scanned);
    }
    if (on !== S.dotsOn) {
      S.dotsOn = on;
      if (on) {
        S.lastOn = now;
        if (S.ticks > 1) log("exp6738: DOTS ON t=+" + (now - S.t0) + "ms open=[" + openSeqs.join(",") + "]");
      } else {
        S.lastOff = now;
        if (S.ticks > 1) log("exp6738: DOTS OFF t=+" + (now - S.t0) + "ms 持续=" + (now - S.lastOn) + "ms");
      }
    }
  }

  function p6738ScanRows(S) {
    const conts = p6738Containers();
    for (let ci = 0; ci < conts.length; ci += 1) {
      const key = conts[ci].k, p = conts[ci].p;
      if (!isValid(p)) continue;
      const count = childCount(p);
      if (!(key in S.rows)) { S.rows[key] = count; continue; } // 首见容器:基线,不 dump 历史行
      let start = S.rows[key];
      if (count < start) {
        log("exp6738: RESET " + key + " " + start + "->" + count);
        start = 0; // 容器清空/重建,镜像主扫描逻辑从头算
      }
      for (let i = start; i < count; i += 1) p6738DumpRow(S, childAt(p, i), key, i);
      S.rows[key] = count;
    }
  }

  function p6738DumpRow(S, row, key, idx) {
    if (!isValid(row)) return;
    if (S.rowsLogged >= P6738_MAX_ROWS) {
      if (!S.rowCap) { S.rowCap = true; log("exp6738: row dump cap " + P6738_MAX_ROWS + " reached"); }
      return;
    }
    S.rowsLogged += 1;
    const now = nowMs();
    let cls = "", ty = "?";
    try { if (row.GetPanelClassList) cls = String(row.GetPanelClassList().join(",")); } catch (e) {}
    try { if (typeof row.type === "string") ty = row.type; } catch (e) {}
    const txt = collectText(row).slice(0, 100);
    let rec = null;
    try { rec = readMessageRow(row); } catch (e) {}
    // dots/sinceDotsOn:行到达时三点窗口状态(相关性的核心字段)
    log("exp6738: ROW " + key + "[" + idx + "] quick=" + (rec ? (rec.quick ? 1 : 0) : "?") +
      " own=" + (rec ? (rec.isOwn ? 1 : 0) : "?") +
      " dots=" + (S.dotsOn ? 1 : 0) +
      " sinceDotsOn=" + (S.lastOn ? now - S.lastOn : -1) +
      " t=+" + (now - S.t0) + "ms" +
      " type=" + ty + " cls=[" + cls + "] txt=" + JSON.stringify(txt));
    // 子树 dump(深度≤4,≤32 节点):行上有没有游戏自带的类型标记,一眼可见
    const lines = [];
    const visit = function (p, depth) {
      if (!isValid(p) || depth > 4 || lines.length >= 32) return;
      let id = "", c = "", t = "?";
      try { id = String(p.id || ""); } catch (e) {}
      try { if (p.GetPanelClassList) c = String(p.GetPanelClassList().join(" ").split(" ").join(".")); } catch (e) {}
      try { if (typeof p.type === "string") t = p.type; } catch (e) {}
      const tx = safeText(p).slice(0, 40);
      let wh = "";
      try {
        if (typeof p.GetActualLayoutWidth === "function") wh = " " + p.GetActualLayoutWidth() + "x" + p.GetActualLayoutHeight();
      } catch (e) {}
      lines.push(new Array(depth + 1).join("  ") + t + "#" + (id || "-") + (c ? "." + c : "") + wh + (tx ? " " + JSON.stringify(tx) : ""));
      const n = childCount(p);
      for (let i = 0; i < n; i += 1) visit(childAt(p, i), depth + 1);
    };
    visit(row, 0);
    for (let i = 0; i < lines.length; i += 1) log("exp6738: tree " + lines[i]);
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