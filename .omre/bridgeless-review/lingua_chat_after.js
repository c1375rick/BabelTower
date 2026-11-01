// Contributor: Thirt927 (https://github.com/Thirt927/BabelTower), merged 2026-08-13 under GPL-3.0
// Babel Tower - Deadlock 鑱婂ぉ缈昏瘧 Panorama 鑴氭湰
// ------------------------------------------------------------------
// 鐙珛瀹炵幇(涓嶅鍒朵换浣曠幇鏈?mod 浠ｇ爜),鎶€鏈矾绾夸笌 DLCT 涓€鑷?
//   鎵弿鑱婂ぉ琛?-> 鍘婚噸 -> 闅愯棌 HTML 闈㈡澘妗ユ帴鏈湴 Core -> 鍘熸枃涓嬫柟杩藉姞璇戞枃
// 绾﹀畾:
//   - 涓ユ牸 IIFE, UPPER_SNAKE_CASE 甯搁噺, camelCase 鍑芥暟
//   - 鎵€鏈?volatile 璋冪敤 try/catch 鍖呰９
//   - 涓嶅亣璁炬祻瑙堝櫒 DOM API(fetch/setInterval/URLSearchParams 绛変笉鍙敤)
//   - $.Schedule 鍗曚綅涓虹
// 娉ㄦ剰:
//   - 鏈剼鏈鐩栬亰澶╁竷灞€鍚?TextEntry 鎻愪氦鐢?LCTOnChatSubmit 鎺ョ,
//     鍛戒护/鍙戦€佸墠缈昏瘧澶勭悊鍚?鍐嶆淳鍙?CitadelChatInputSubmitted 浜嬩欢瑙﹀彂鍘熺増鍙戦€併€?//   - UI 鏂囨/閫夐」琛ㄦ暟鎹凡澶栫疆鍒?lingua_chat_i18n.vjs_c(鍏堜簬鏈枃浠惰杞?,鏈枃浠跺彧璇诲叏灞€鍒悕銆?(() => {
  "use strict";

  const LOG_PREFIX = "[LCT]";
  // btipc14 (2026-10-31):1.2.5 鐢ㄦ埛鏇存柊鍓嶇疆鏇存柊鈥斺€攈ash 鍑虹珯杞借嵎瀛楁鍚嶄慨澶?  //   (target 鈫?targetLanguage,1.2.4 鐨勫嚭绔欐柟鍚戞暣鍙嶆牴鍥?+ 娓告垙鍐呰缃潰鏉跨Щ闄?  //   (鍙?UI 鍒嗗弶婧?+ UMM 闆嗘垚绉婚櫎銆傚悗缁洿鏂颁笉鍐嶆敼搴曞眰銆?  // btipc13 (2026-10-30):10-29 鏂鍏ㄩ潰淇鈥斺€擟A 閾捐瘉涔?397 澶╁彾+鍚姩鍣ㄨ嚜鎰?銆?  //   妗ラ潰鏉?CitadelHTMLPanel銆侀潰鏉跨粦瀹氬畧鍗В鑰︺€佹帰閽堜簨浠堕┍鍔ㄧ粨绠椼€乭ash 蹇€氶亾
  //   鎺ョ嚎(hashBase 鎹曡幏/SetURL/job.id/d 瑙ｇ爜)+ 椤甸潰 lastH/鍒濆 fragment 鑷剤銆?  const VERSION = "0.1.0-ce"; // community bridgeless edition (pure CEF + hosted page)
  //   gamenames/quickchat 鐨勪袱娈靛紡(鎻℃墜鎶ユ湰鍦版寚绾?鈫?same 鎴栧彧浼犲彉鏇村瓧娈?;妗ヤ晶淇濈暀鏈€杩?16 鐗堥厤缃巻鍙插綋宸垎
  //   鍩虹嚎(鎸夊鎴风鎸囩汗鏌?銆傛參閫氶亾瀹炴祴:娌″彉 = 1 甯?鈮?.65s銆佹敼涓€涓瓧娈?= 120B 鈮?2 甯?鈮?.8s(鏃ц矾鏄叏閲?  //   392B = 40 甯?鈮?6s,鍐嶅姞 20s 杞)銆傗啋 鏋勫缓鏍?btipc11(BTIP小 璇锋眰璇箟鍙樹簡,涓?1.2.1 鐨?btipc10 绾垮尯鍒?
  // 1.2.1 (2026-10-20) 鍐呭: 鈶?璁剧疆闈㈡澘鎼埌**鏈湴缃戦〉**(core/web/ui.html,妗?8791;/tr 鐢ㄧ郴缁熼粯璁ゆ祻瑙堝櫒鎵撳紑,
  //   /tr panel 淇濈暀娓告垙鍐呮棫闈㈡澘浣滆皟璇曞厹搴?:10 绉嶇晫闈㈣瑷€(榛樿璺熼殢娓告垙鐣岄潰璇█)+ 鍙充笂瑙掑彲瑕嗙洊;鏈嶅姟鍟嗚〃鍗?
  //   娓告垙鍐呰涓哄崱鐗?閫氶亾鍋ュ悍鍗?楂樼骇 JSON;鈶?閰嶇疆涓嬪彂浠?鍙紑鏈鸿涓€娆?鏀规垚**鎺ㄩ€?*:缃戦〉淇濆瓨 鈫?妗ュ彨閱掓父鎴忛暱杞
  //   鈫?娓告垙 <1 绉掔敓鏁?涓変釜寮曟搸琛屼负瑙?docs/btipc-https-v1.md 搂9);鈶?"鍚敤缈昏瘧"鏀逛负**鎬诲紑鍏?*;BTIPC op=config

  // ---- 鍘熺増鑱婂ぉ缁撴瀯 ID(褰撳墠 Deadlock 鐗堟湰绋冲畾)----
  const CHAT_ROOT_ID = "Chat";
  const CHAT_MESSAGES_ID = "ChatMessages";
  const MESSAGE_SOURCE_ID = "MessageSource";
  const MESSAGE_CONTENTS_ID = "MessageContents";
  const MESSAGE_BODY_CLASS = "MessageBody";
  const CHAT_INPUT_ID = "ChatInput";
  const CHAT_TARGET_LABEL_ID = "ChatTargetLabel";
  const SENDER_NAME_CLASS = "SenderName";
  const CHANNEL_NAME_CLASS = "ChannelName";
  // 鑷繁鐨勬秷鎭爣璁?寮曟搸娓叉煋鏈湴鐜╁娑堟伅鏃?琛屽唴浼氭斁涓€涓?class="SenderLocalClient" 鐨勯潰鏉?  // (鍘熺増 snippet ChatMessageSender_LocalClient;娉ㄦ剰鏄?class 涓嶆槸 id,蹇呴』鐢?findClass 鍖归厤)
  const LOCAL_CLIENT_ID = "SenderLocalClient";

  // ---- HUD 椤舵爮鑱婂ぉ缁撴瀯(citadel_hud_top_bar_chat.vxml,涓?QoL 绫?HUD mod 鍏煎:涓嶆敼甯冨眬鍙壂鎻?----
  const HUD_CHAT_CLASS = "CitadelHudTopBarChat"; // 闈㈡澘绫诲瀷(Team1Chat/Team2Chat 涓や釜瀹炰緥);type 涓嶆槸 class,閬嶅巻涓嶅埌,浠呬綔鍏曞簳
  const HUD_CHAT_IDS = ["Team1Chat", "Team2Chat"]; // 甯冨眬鍐欐鐨勫浐瀹?id(涓绘煡鎵捐矾寰?
  const HUD_MESSAGES_ID = "Messages"; // 椤舵爮姘旀场瀹瑰櫒
  const HUD_BUBBLE_CLASS = "ChatBubble"; // 姘旀场(鍖哄垎 HUD 琛屼笌宸︿笅鑱婂ぉ琛?
  const HUD_TEXT_ID = "MessageText"; // 姘旀场鍐呮枃鏈?Label
  const TRANS_LABEL_HUD_CLASS = "LCTTranslationHud";
  const TRANS_LABEL_LOBBY_CLASS = "LCTTranslationLobby";

  // ---- 澶у巺鑱婂ぉ缁撴瀯(hudchat.vxml:ChatLinesPanel 瀹瑰櫒,琛?ChatLineContainer)----
  const CHAT_LINES_PANEL_ID = "ChatLinesPanel";
  const LOBBY_ROW_CLASS = "ChatLineContainer";
  const LOBBY_LINE_CLASS = "ChatLine";
  const LOBBY_PERSONA_CLASS = "ChatPersona";
  const LOBBY_PREFIX_CLASS = "ChatLinePrefix";

  // ---- LinguaChat 鑷韩 ID / class ----
  const SETTINGS_BUTTON_ID = "LCTSettingsButton";
  const SETTINGS_PANEL_ID = "LCTSettingsPanel";
  const SETTINGS_VISIBLE_CLASS = "LCTVisible";
  const STATUS_LABEL_ID = "LCTStatusLabel";
  const TRANS_LABEL_CLASS = "LCTTranslation";
  const TRANS_ERROR_CLASS = "LCTTranslationError";
  const BRIDGE_PANEL_ID = "LCTBridgePanel";
  const BRIDGE_PANEL_CLASS = "LCTBridgePanel";

  // ---- 杞鑺傚 ----
  const FAST_POLL_SECONDS = 0.4;
  const SLOW_POLL_SECONDS = 1.0;
  const BOOTSTRAP_TAIL_SCAN_LIMIT = 24; // 棣栨鍙壂鏈熬,閬垮厤缈诲巻鍙?  const LOW_LATENCY_TAIL_SCAN_LIMIT = 6; // 姣忔棰濆鎵湯灏?淇濊瘉浣庡欢杩?6726 姘旀场鍏堝缓鏂囨湰鍚庡～,burst>绐楀彛鏃堕潬瑙傚療琛ㄥ厱搴?
  const PENDING_FILL_TTL_MS = 5000; // 6726:绌鸿瑙傚療绐?TTL(姘旀场鍏堝缓銆佹枃鏈欢杩熷～鍏?瓒呮椂绉婚櫎闃茬┖琛屾案涔呭崰鐢?
  const HUD_OVERLAY_LIMIT = 10; // HUD 璇戞枃娴眰涓婇檺(瓒呰繃鍒欐竻鐞嗘渶鏃?闃插唴瀛樻硠婕?
  const TITLE_POLL_SECONDS = 0.3;
  const BRIDGE_ALIVE_SECONDS = 3.0; // nav 瀛樻椿绐楀彛:寮€灞€ 3s 鍐?CEF 蹇?鏈湴鍖栭噸寤?鏉愯川鍔犺浇),1.5s 璇潃鐜?~6%
  // 闈㈡澘閫氶亾鍒ゆ:6726 璧?SetURL 瀵艰埅鏁存潯澶辨晥(姣忔 nav 閮芥槸 src="" 浠庝笉鍔犺浇)銆?  // 杩炵画 N 娆?椤甸潰浠庢湭寮€濮嬪姞杞?鎵嶅垽姝婚€氶亾,骞惰繘鍏ュ喎鍗存湡:鏈熼棿涓嶅啀灏濊瘯瀵艰埅(鍏嶅緱姣?15s 鎵撲竴鏉?  // `bridge nav failed: panel dead` 姝婚摼鏃ュ織)銆傚喎鍗村埌鐐硅嚜鍔ㄥ鎺?娓告垙鏀圭増淇ソ鍙嚜鎰堛€?  const PANEL_NAV_DEAD_STREAK = 3; // 杩炵画鍑犳"椤甸潰浠庢湭鍔犺浇"鎵嶅垽姝?鍔犺浇鎱笉绠?閬垮厤璇潃鍋跺彂鎶栧姩)
  const PANEL_NAV_COOLDOWN_MS = 600000; // 鍒ゆ鍚庡喎鍗?10 鍒嗛挓鍐嶅鎺?  const CANHTTP_REPROBE_MS = 600000; // 绂荤嚎澶嶆帰鐩磋繛閫氶亾(AsyncWebRequest)鐨勬渶灏忛棿闅?
  // API 绉婚櫎鏄父鎴忕増鏈潤鎬佷簨瀹?涓嶅姞闄愭祦浼?澶嶄綅鈫掗噸鎺⑩啋鍐嶅浣?姣?5s 鍒蜂竴鏉?  // `bridge channel: reset to re-probe direct (was panel-only)`
  // 锟斤拷锟絇:health 锟斤拷1%锟斤拷d锟絧M锟絜锟?MS锟絥b锟?DOM 锟斤拷铳伙拷)
  const BRIDGE_OFFLINE_GRACE_SECONDS = 25; // 妗ラ〉闈㈠瓨娲绘爣璁扮殑绛夊緟涓婇檺
  // 绂荤嚎瀹介檺:health 杩炵画澶辫触瓒呰繃姝ょ鏁版墠鎶婃ˉ鏍囩孩(閬垮厤鎵撳紑璁剧疆闈㈡澘鏃?DOM 鎶栧姩璇姤绂荤嚎)
  const RETRY_LIMIT = 2; // 姣忔潯娑堟伅鏈€澶氬皾璇曟鏁?鍚娆?
  const RETRY_DELAY_SECONDS = 0.4;
  const OUTGOING_TIMEOUT_MS = 20000; // 鍑虹珯缈昏瘧瓒呮椂:瓒呰繃鍒欐寜鍘熸枃鍙戦€?閬垮厤鍗′綇閲嶅鎸夐敭銆?s 瑕嗙洊 DeepSeek 绛?API 鏈嶅姟鍟嗘甯稿欢杩?1-6s)鍙?Bing 鍐峰惎鍔?璁℃椂浠庝换鍔″紑濮嬪鐞嗙畻璧?瑙?dispatchJob)
  const CACHE_LIMIT = 300;
  const SEEN_LIMIT = 500;
  const PLAYER_INFO_SCAN_LIMIT = 24; // Players.GetPlayerInfo 鎵弿涓婇檺(鍚嚜宸?
  const LOG_DEDUP_WINDOW_MS = 15000; // HUD/鏈～鍏呮潯鐩笌瀹屾暣鏉＄洰鐨勬棩蹇楀幓閲嶇獥鍙?  const LOG_DEDUP_LIMIT = 128; // recentLogs 鍘婚噸缂撳瓨涓婇檺
  const PENDING_LOG_TIMEOUT_MS = 6000; // 鏈～鍏呭畬鏁存潯鐩殑鎸傝捣绛夊緟绐楀彛(瓒呮椂鎵嶅厹搴曡惤鐩?
  const MAX_ACTIVE_REQUESTS = 1; // 浼犺緭灞傚崟妲?HTML 闈㈡澘+title 杞),骞跺彂>1 浼氫骇鐢?supersede 绔炰簤,淇濇寔涓茶
  const UNKNOWN_NAME = "<unknown>";

  // ---- 鏈湴妗?----
  // HOST 鏃舵満绾?2026-08-25 鐗堟嫤鎴?http://127.0.0.1 浠呮斁琛?localhost 鈫?鏀圭敤 localhost;
  // 2026-09-30 娓告垙鏇存柊(6726)鍚庡弽鍚?鎷︽埅 localhost,SetURL 鍒?http://localhost 琚潤榛樺拷鐣?  // (璇婃柇璇佸疄 panel.title 鎭掔┖銆乻rc="",椤甸潰浠庢湭鍔犺浇),鑰?127.0.0.1 姝ｅ父(DeadlockLingua 1.0.1 楠岃瘉)銆?  // 鏀瑰洖 127.0.0.1;妗ュ凡鍙屾爤鐩戝惉(127.0.0.1+::1),涓ょ瑙ｆ瀽閮借兘鍛戒腑銆?  const BRIDGE_HOST = "127.0.0.1";
  const BRIDGE_PORT = 8791; // 涓?core/config.json 淇濇寔涓€鑷?
  // ---- https 闈㈡澘閫氶亾(2026-10-15):涓昏矾,浣?*鏈夊垯鐢ㄣ€佹棤鍒欓€€ BTIPC** ----
  // 銆愯矾绾挎潵婧?浜嬪疄/閫愰」瀵硅处銆戣瑙?docs/btipc-https-v1.md 搂2(鏉ユ簮涓庨浂浠ｇ爜閲嶅彔)銆伮?(閫氶亾閫夋嫨)銆?  // 鈶?杩欐潯鍥炵▼(闅愯棌 HTML 闈㈡澘 SetURL 鈫?/bridge + document.title 杞)鏄?*鎴戜滑鑷繁鐨?*璁捐,鏃╀簬 BTIPC
  //    灏卞啓鍦?docs/architecture.md 搂4.2 鐨勯€氶亾鈶?褰撴椂瀹氫綅鏄?鍥為€€");鏈鍙槸鎶婂畠鎻愬埌"涓昏矾"骞跺姞鎺㈤拡銆?  // 鈶?"缁欓潰鏉夸竴涓彈淇′换鐨勬湰鏈?https"(鑷璇佷功 + CurrentUser\Root + 瀹屽叏閲嶅惎 Steam)杩欎釜**鏂规鏈韩**
  //    鏉ヨ嚜涓€娆?GPL-3.0 鍚岀被瀹炵幇,鎴戜滑姝ゅ墠娌℃湁;璇佷功 SAN 甯冨眬鍚屾(搂2.5 闆朵唬鐮侀噸鍙?銆?  // 浜嬪疄:闈㈡澘鍙帴鍙楄瘉涔︽湁鏁堢殑 https(http://127.0.0.1/localhost 鍦?LoadPage 鍓嶅氨琚紩鎿庢嫆);
  //   妗ヤ晶 core/bridge_https.js 鐙珛杩涚▼鍋?TLS 缁堢粨(璇佷功鍑洪棶棰樼粷涓嶈兘杩炲甫 BTIPC 涓€璧锋);
  //   棣栨闇€ -Trust 骞?*瀹屽叏閫€鍑哄苟閲嶅惎 Steam**(淇′换搴撶敱 Steam 瀹夸富缂撳瓨,鍙噸鍚父鎴忎笉鐢熸晥)銆?  // 鍊煎緱褰撲富璺?闈㈡澘鍦?*妗ヨ繖涓€渚?*鍚屾簮 fetch 瀹屾妸缁撴灉涓€娆″啓杩?document.title,涓嬭鍙墿涓€涓?RTT;
  //   BTIPC 浣嶆车鍒欐槸 FIRST_SHOT(1200ms)+甯ф暟脳tClose(600ms) 鈥斺€?鐭彞 3.0s銆?8 甯?24.4s銆?  // 缁濅笉鎷挎帀 BTIPC(璇佷功鏈俊浠?Steam 娌￠噸鍚殑鐢ㄦ埛閭ｆ潯閫氶亾蹇呯劧鏄鐨?蹇呴』闆舵懇鎿︾暀鍦?BTIPC):
  //   澶辫触璺緞鍙湁涓€鏉?鈥斺€?鍘熸牱鎶?job 浜ゅ洖 BTIPC 閲嶅仛,涓?*涓嶆秷鑰?job.attempts**(涓嶆槸缈昏瘧澶辫触)銆?  const HTTPS_PANEL_ENABLED = true; // 鎬诲紑鍏?鐜板満鎺掗殰鏃剁疆 false 鍗冲埢鍏ㄩ噺閫€鍥?BTIPC
  // COMMUNITY 0.1.0:鏃犳ˉ褰㈡€佲€斺€擝TIPC 灞備唬鐮佷繚鐣欎絾涓嶆縺娲?0.2 prune);
  // 缈昏瘧璧?CEF 闈㈡澘鐩磋浇鎵樼椤?GitHub Pages,鍏紑璇佷功,闆舵湰鍦拌繘绋?銆?  const BTIPC_ENABLED = false;
  // 鎵樼椤?Pages):hash 閫氶亾 base 涓庤缃潰鏉垮潎鎸囧悜瀹?POC 鐪熸満宸查獙璇?瑙?poc/RESULTS.md)銆?  const PAGE_URL = "https://c1375rick.github.io/babeltower-community-pages/";
  const HTTPS_PANEL_HOST = "localhost"; // 璇佷功 SAN 鍚?DNS:localhost 涓?IP:127.0.0.1
  const HTTPS_PANEL_PORT = 8792; // 涓?core/bridge_https.js 鐨勯粯璁ょ鍙ｄ竴鑷?  const HTTPS_PANEL_PROBE_SECONDS = 6.0; // 鎺㈤拡绐楀彛:nav 鍚庣瓑 title 鍙樺搷搴旂殑鏈€闀挎椂闂?鍚竴娆?retryNavOnce)
  const HTTPS_PANEL_DEAD_STREAK = 3; // 浼氳瘽鍐呰繛缁嚑娆￠€氶亾绾уけ璐ユ墠姘镐箙閫€ BTIPC(鍋跺彂鎶栧姩涓嶈鏉€)
  const HTTPS_PANEL_REPROBE_MS = 300000; // 鍒ゆ鍚庢瘡闅?5 鍒嗛挓鍚庡彴閲嶆帰涓€娆?鎴愬姛鍗虫暣鍦烘仮澶?https(涓嶅啀绛夐噸鍚?
  const TITLE_PREFIX = "LCT";
  const TITLE_ALIVE = "lct-alive";
  const BRIDGE_STATUS_LABEL_ID = "LCTBridgeStatusLabel";
  const BRIDGE_HINT_LABEL_ID = "LCTBridgeHintLabel";
  const BRIDGE_DOT_ID = "LCTBridgeDot";
  const OUTGOING_FAIL_TIP_ID = "LCTOutgoingFailTip";
  const DMM_HINT = "鑻ラ€氳繃 DMM(Deadlock Mod Manager)瀹夎,浠呮湁缈昏瘧闈㈡澘,闇€鍙﹁鏈湴妗?涓嬭浇 GitHub 瀹屾暣鍖呰繍琛?StartDeadlock.bat";

  // ---- 鑻遍泟/鐗╁搧鍚嶄繚鎶?缈昏瘧鍓嶅崰浣?缈昏瘧鍚庤繕鍘? ----
  // 榛樿鐢ㄤ笅闈㈢‖缂栫爜鐨勫厹搴曞悕鍗?鍚姩 healthCheck 鎴愬姛鍚庝細浠庢ˉ /api/v1/gamenames
  // 鎷夊彇鍏ㄩ噺鍚嶅崟(285 鏉?闅忔父鎴忔洿鏂拌嚜鍔ㄥ埛鏂?瑕嗙洊杩欓噷鐨勫厹搴曞€?娑堥櫎鍙屾簮婕傜Щ銆?  // 娉ㄦ剰:鍏滃簳鍚嶅崟鍏ㄥ皬鍐?妗ヤ晶 gamenames.json key 鏄師濮嬪ぇ灏忓啓,鍖归厤鏃?case-insensitive銆?  // 鎸夐暱搴﹂檷搴忔帓鍒?閬垮厤鐭悕璇尮閰嶉暱鍚嶇殑瀛愪覆(濡?"geist" 璇尮閰?"lady geist")
  let PROTECT_NAMES = [
    // 澶氳瘝鐗╁搧(闀夸紭鍏?
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
    // 鑻遍泟鍚?澶氳瘝浼樺厛)
    "lady geist", "mo krill",
    // 鍗曡瘝鑻遍泟 + 鍗曡瘝鐗╁搧
    "abrams", "bebop", "calico", "dynamo", "geist", "haze",
    "inferno", "paradox", "pocket", "shiv", "viscous", "warden",
    "wraith", "yamato", "seven", "ricochet",
  ];
  let PROTECT_TO_ZH = {
    "abrams": "浜氫集鍏?, "bebop": "姣旀尝鏅?, "calico": "鍗″帀鍙?,
    "dynamo": "濂囪兘", "geist": "鐩栨柉鐗瑰か浜?, "haze": "宀氭ⅵ",
    "inferno": "鐐界劚", "lady geist": "鐩栨柉鐗瑰か浜?, "mo krill": "鑾厠鍙岄泟",
    "paradox": "鎮栬", "pocket": "鍙ｈ", "seven": "鏌?,
    "shiv": "甯屽紬", "viscous": "榄旀恫", "warden": "娌冪潱",
    "wraith": "鐏甸瓍", "yamato": "澶у拰",
    "divine barrier": "绁炲湥灞忛殰", "diviner's kevlar": "閲戝垰瀹濊～",
    "bullet resilience": "瀛愬脊鍧氱敳", "bullet lifesteal": "瀛愬脊鍥炲",
    "bullet resist shredder": "绮夌鎶ょ敳", "kinetic dash": "鍔ㄨ兘鍐插埡",
    "tesla bullets": "鐗规柉鎷夊脊", "ricochet": "璺冲脊灏勫嚮",
    "torment pulse": "鐥涜嫤鑴夊啿", "reactive barrier": "搴旀€ュ睆闅?,
    "swift striker": "杩呮嵎绐佸嚮", "vampiric burst": "鐤楁剤鐖嗗彂",
    "spirit burn": "鍏冪伒鐕冪儳", "spirit lifesteal": "鍏冪伒鍚告敹",
    "spirit resilience": "鍏冪伒鎶や綋", "spirit rend": "鍏冪伒鎾曡",
    "spirit sap": "鍏冪伒琛扮", "spirit shielding": "鍏冪伒闃叉姢",
    "spirit shredder bullets": "纰庣伒瀛愬脊", "spirit snatch": "鍏冪伒鏀跺壊",
    "spirit strike": "澶т激鍏冩皵", "spiritual overflow": "鍏冪伒婕孩",
    "cursed relic": "澶╄按鍦ｇ墿", "fury trance": "鎬掓剰涔嬫疆",
    "monster rounds": "鐚庢€脊", "improved spirit": "鐏靛姏楂樻定",
    "metal skin": "閾滅毊閾侀", "close quarters": "杩戣韩鍐虫枟",
    "rapid recharge": "鐏€熷厖鑳?, "glass cannon": "鑴嗙毊杈撳嚭",
    "sharpshooter": "寮规棤铏氬彂", "armor piercing rounds": "绌跨敳寮?,
    "ballistic enchantment": "寮归亾闄勯瓟", "escalating resilience": "灞傚眰闃插尽",
    "intensifying magazine": "鐏姏娓愬崌", "mystic vulnerability": "绉樻湳鑴嗗急",
    "radiant regeneration": "瀹瑰厜鐒曞彂", "high-velocity rounds": "楂橀€熷脊",
    "mystic regeneration": "绉樻湳鎰堢枟", "cooldown reduction": "鍐峰嵈缂╁噺",
    "crippling headshot": "澶村脊鐮撮槻", "enchanter's emblem": "闄勯瓟甯堢汗绔?,
    "hexsealed knuckles": "鍜掑嵃閾佹嫵", "quicksilver reload": "榄斿姏瑁呭～",
    "restorative locket": "鐤楁剤鎶ょ", "weakening headshot": "澶村脊寮遍槻",
    "superior cooldown": "瓒呴€熷喎鍗?, "superior duration": "浣欏▉涔呬箙",
    "extra spirit": "鐏靛姏鎵╁", "duration extender": "浣欏▉鍥炶崱",
    "rapid rounds": "蹇墜杩炲彂", "burst fire": "鍋ユ鐤惧皠",
    "boundless spirit": "鐏靛姏鏃犺竟", "spirit shredder": "纰庣伒瀛愬脊",
  };
  // 鍏滃簳鍓湰:鑾峰彇妗ュ悕鍗曞け璐ユ椂鐢ㄥ畠浠洖閫€(瑙?rebuildGameNames)
  const PROTECT_TO_ZH_FALLBACK = PROTECT_TO_ZH;
  const PROTECT_NAMES_FALLBACK = PROTECT_NAMES;
  
  // ---- 娓告垙鍚嶅崰浣嶄繚鎶?EN/ZH 涓ら€氶亾鍏辩敤鍚屼竴濂楀弬鏁板寲瀹炵幇) ----
  // 鍗犱綅绗?LCTPH<i> / LCTZHPH<i> 涓庢ˉ渚?core/name_protect.js銆佹父鎴忓唴 vpk fallback 鍚屼竴绾﹀畾,涓嶅彲鏀?  // 浠?PROTECT_TO_ZH 鍙嶈浆鏋勫缓 { 涓枃璇戝悕 -> 鑻辨枃鍘熷悕 }
  let ZH_TO_EN = {};

  // 鍚嶅崟 鈫?姝ｅ垯浣?鎸夐暱搴﹂檷搴?閬垮厤鐭悕璇尮閰嶉暱鍚嶅瓙涓?,鍐嶉€愰」杞箟
  function protectAlt(names, escapeRe) {
    return names.slice().sort((a, b) => b.length - a.length)
      .map(n => String(n).replace(escapeRe, '\\$&')).join("|");
  }

  const NAME_SCHEMES = {
    // EN:璇嶈竟鐣?+ 澶у皬鍐欎笉鏁忔劅銆傝繕鍘熻蛋鍗曡稛甯︾紪鍙锋崟鑾风粍,瀹瑰繊绌烘牸/澶у皬鍐欏彉鍖?
    // 涓嶆寜 i 鍗囧簭 replace,鏁?"LCTPH1" 涓嶄細鍚冩帀 "LCTPH10" 鐨勯涓や綅;鏈煡缂栧彿鍘熸牱淇濈暀銆?    en: {
      prefix: "LCTPH", label: "replaceGameNames", re: null,
      build: names => new RegExp("\\b(?:" + protectAlt(names, /[.*+?^${}()|[\\]\\]/g) + ")\\b", "gi"),
      lookupKey: m => m.toLowerCase(),
      restore: (text, mapArr) => String(text).replace(/LCTPH\s*(\d{1,3})/gi, (m, num) => {
        const idx = parseInt(num, 10);
        return (idx >= 0 && idx < mapArr.length) ? (mapArr[idx] || m) : m;
      }),
    },
    // ZH:涓枃鍚嶆棤璇嶈竟鐣?闀垮害闄嶅簭绾瓙涓插尮閰?杩樺師娌跨敤鍘嗗彶 split/join 璇箟
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

  /** 鎸夋柟妗堝崰浣嶆浛鎹?lookup = {鍖归厤鏂囨湰 -> 鐩爣璇戝悕};杩斿洖 { text, mapArr } */
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

  /** 鎸夋柟妗堣繕鍘熷崰浣嶇 */
  function restoreNamesByScheme(text, scheme, mapArr) {
    if (!text || !mapArr) return text;
    return scheme.restore(text, mapArr);
  }

  /** 鑻辨枃鍚嶅崰浣?lookup = {灏忓啓鑻辨枃鍚?-> 涓枃璇戝悕};杩斿洖 { text, nameMap, originalText } */
  function replaceGameNames(text, lookup) {
    const r = replaceNamesByScheme(text, NAME_SCHEMES.en, lookup);
    return { text: r.text, nameMap: r.mapArr, originalText: text };
  }
  function restoreGameNames(text, nameMap) {
    return restoreNamesByScheme(text, NAME_SCHEMES.en, nameMap);
  }
  /** 涓枃鍚嶅崰浣?lookup = {涓枃鍚?-> 鑻辨枃鍘熷悕};杩斿洖 { text, zhNameMap } */
  function replaceChineseGameNames(text, lookup) {
    const r = replaceNamesByScheme(text, NAME_SCHEMES.zh, lookup);
    return { text: r.text, zhNameMap: r.mapArr };
  }
  function restoreChineseGameNames(text, zhNameMap) {
    return restoreNamesByScheme(text, NAME_SCHEMES.zh, zhNameMap);
  }

  /** 鐢ㄦˉ渚?gamenames.json({ 鑻辨枃鍘熷悕->涓枃璇戝悕 })閲嶅缓淇濇姢鍚嶅崟涓庢槧灏?
   *  case-insensitive 鍖归厤(妗?key 鍘熷澶у皬鍐?鍏滃簳鍚嶅崟鍏ㄥ皬鍐?銆?/
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
    // 閲嶅缓涓枃鍚嶅弽鍚戣〃
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

  // ---- 璇█鍚彂寮?----
  const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;

  // ---- 鐘舵€?----
  const State = {
    chat: null,
    messages: null,
    input: null,
    targetLabel: null,
    scannedCount: 0,
    hudMessages: [], // HUD 椤舵爮鑱婂ぉ Messages 瀹瑰櫒鍒楄〃(Team1Chat/Team2Chat)
    hudScanned: [], // 姣忎釜 HUD 瀹瑰櫒宸叉壂鎻忕殑琛屾暟
    hudOverlayCount: 0, // 娲昏穬 HUD 璇戞枃娴眰鏁伴噺(闃插唴瀛樻硠婕忚窡韪?
    hudOverlays: [], // HUD 璇戞枃娴眰闈㈡澘鍒楄〃(鎸夊垱寤洪『搴?鐢ㄤ簬娓呯悊鏈€鏃?
    lobbyMessages: null, // 澶у巺鑱婂ぉ瀹瑰櫒(ChatLinesPanel,hudchat)
    lobbyScanned: 0, // 澶у巺瀹瑰櫒宸叉壂鎻忚鏁?    hudLogged: false,
    bootLogged: false,
    cfgSynced: false, // 鍚姩鏃舵槸鍚﹀凡浠庢ˉ鍚屾杩囬厤缃?healthCheck 琛ヨЕ鍙戠敤)
    cfgSyncing: false, // 閰嶇疆鍚屾鏄惁杩涜涓?闃?healthCheck 閲嶅瑙﹀彂鍙犲姞)
    cfgSyncStarted: false, // 2026-10-16:閰嶇疆鍚屾鍚姩闂?boot 涓?onBridgeAlive 鍏辩敤 once,绛夋帰閽堝厛瀹氳)
    cfgSyncWaitTries: 0, // 2026-10-16:绛夋帰閽堝畾璁虹殑杞娆℃暟(8 娆＄害 8s 鏃犲畾璁哄垯璧拌€佽矾,涓嶆棤闄愮瓑)
    cfgDirty: null, // 2026-10-16:鐢ㄦ埛鑴忔爣璁?{provider:true...},鍚屾钀藉湴/_mask 鍥炲～鏃惰烦杩囪繖浜涢敭
    cfgMask: null, // btipc11:妗ヤ晶"娓告垙鍙閰嶇疆"鐨勫綋鍓嶅壇鏈?宸垎鏂藉姞鐨勫熀鍑?_mask 浼氳淇濆瓨鍔ㄤ綔娓呯┖,杩欎唤涓嶆竻)
    gamenamesLoaded: false, // 鍚姩鍚庢槸鍚﹀凡浠庢ˉ鎷夊彇杩囨父鎴忓悕淇濇姢鍚嶅崟(healthCheck 琛ヨЕ鍙戠敤)
    gamenamesLoading: false, // 鍚嶅崟鎷夊彇鏄惁杩涜涓?闃?healthCheck 閲嶅瑙﹀彂鍙犲姞)
    quickchatLoading: false, // 璇枡鍚屾鏄惁杩涜涓?鍚屼笂)
    quickchatTries: 0, // btipc07:鏈細璇濊鏂欏悓姝ュ凡灏濊瘯娆℃暟(SYNC_MAX_TRIES 灏侀《)
    gamenamesTries: 0, // btipc07:鏈細璇濆悕鍗曞悓姝ュ凡灏濊瘯娆℃暟(鍚屼笂)
    gamenamesMap: null, // btipc07:褰撳墠鍚嶅崟鍓湰(delta 澧為噺鐨勬柦鍔犲熀鍑?
    healthDetailFetched: false, // provider/updateInfo 鏄庣粏鏄惁宸茶ˉ杩?鍥炲０涓嶅甫杩欎簺瀛楁)
    gamenamesFp: null, // btipc07:褰撳墠鍚嶅崟鎸囩汗(榛樿 = 鎵撳寘鍐呯儤鐒欏€?鎻℃墜涓婃姤瀹?
    seen: new Set(), // 娑堟伅绛惧悕鍘婚噸
    pendingFill: new Map(), // 6726 寤惰繜濉厖瑙傚療琛?rowPanel -> 杩囨湡鏃堕棿鎴?绌鸿鏂囨湰鍚庤ˉ,琛ラ綈鍚庤嚜鍔ㄥ嚭琛?
    cache: new Map(), // textKey(褰掍竴鍖栨枃鏈?鐩爣璇█) -> { translation, fragment }
    inflight: new Map(), // textKey -> 鍦ㄩ€斿悎骞剁粍 { key, rows, settled }:鍚屾枃鏈彧鍙戜竴娆℃ˉ璇锋眰,缁撴灉鎵囧嚭鎵€鏈夊悓鏂囪
    queue: [], // 寰呯炕璇戜换鍔?    activeRequests: 0,
    requestSeq: 0,
    outgoingPending: null, // 鍙戦€佺炕璇戜腑鐨勬枃鏈?鍘婚噸:鍚屾枃鏈噸澶嶆寜 Enter 蹇界暐)
    panel: null, // 闅愯棌 HTML 妗ラ潰鏉?鍦?chat.xml 涓敤 <HTML> 鏍囩澹版槑)
    panelLogged: false,
    panelDead: false, // BUGFIX 0.1.3:闈㈡澘瀵艰埅澶辫触鏍囪,涓嬫寮哄埗閲嶆柊鏌ユ壘
    navDeadStreak: 0, // 杩炵画"椤甸潰浠庢湭鍔犺浇"鐨勫鑸け璐ヨ鏁?澶?PANEL_NAV_DEAD_STREAK 娆℃墠鍒ゆ閫氶亾)
    navDeadUntil: 0, // 闈㈡澘閫氶亾鍒ゆ鍐峰嵈鎴(nowMs());鏈熼棿 dispatchViaPanel 蹇€熷け璐?涓嶅鑸?    navDeadLogged: false, // 鏈浼氳瘽鏄惁宸叉墦杩囦竴鏉″鑸閾剧粏鑺傛棩蹇?姝ゅ悗鍙墦"杩涘叆鍐峰嵈"鎽樿)
    // ---- https 闈㈡澘閫氶亾(2026-10-15)----
    httpsPanelOk: null, // null=灏氭湭鎺㈡祴;true=鏈細璇濊蛋 https 闈㈡澘;false=閫€鍥?BTIPC
    httpsPanelStreak: 0, // 閫氶亾绾уけ璐ヨ繛鍑?澶?HTTPS_PANEL_DEAD_STREAK 娆″氨姘镐箙閫€ BTIPC)
    httpsPanelDemotedLogged: false, // 鏈浼氳瘽鏄惁宸叉墦杩?閫€ BTIPC"閭ｆ潯鏃ュ織(閬垮厤姣忚姹傚埛灞?
    httpsPanelHardDead: false, // true=杩愯鏃惰繛鍑荤‖鍒ゆ(鐤戜技璇佷功绾ф晠闅?:涓嶈嚜鍔ㄩ噸鎺?鎺㈡祴鍋跺彂澶辫触涓嶅彈姝ら檺
    dupWarned: false, // 鎺掑鍛婅鍙墦涓€娆?妗ヤ晶 addons 鎵弿鍙戠幇澶氫唤鍚湰闈㈡澘鐨?vpk 鏃?
    sysLang: null, // Windows 绯荤粺 UI 璇█(妗?health 涓嬪彂,濡?"en"/"zh"):鐣岄潰璇█ auto 妯″紡鐨勫厹搴?    hashReady: false, // hash 鍛戒护閫氶亾宸叉彙鎵?鎺㈤拡 ALIVE 鍚庣疆浣?:SetURL 鍙彉 fragment,椤甸潰甯搁┗闆跺鑸?    probeLastAt: 0, // 涓婃鎺㈤拡鍙戣捣鏃堕棿(閲嶆帰鑺傛祦鐢?鎺㈤拡宸插洖褰掔粺涓€妲?姝ゅ瓧娈典粎璁拌妭娴佹椂鍒?
    hashSeq: 0, // hash 璇锋眰璁℃暟
    hashBase: "", // hash 閫氶亾 base(init 椤甸潰 URL 鍚?query;hash 璇锋眰蹇呴』涓庡畠鍓嶇紑瀹屽叏涓€鑷存墠涓嶈Е鍙戞暣椤靛鑸?
    eventsRegistered: false,
    pending: null, // 缁熶竴鍦ㄩ€旀ˉ璇锋眰 { id, onResult, deadline, sawAlive }
    bridgeUp: false,
    panelWarned: false,
    cfg: null, // 娓告垙渚?UI 閰嶇疆
    bridgeUp: false, // 妗ュ湪绾挎爣璁?health 鎺㈡祴缁存姢)
    bridgeOfflineSince: 0,
    diagTitleCount: 0, // DIAG-6726:鏍囬杞璇婃柇璁℃暟
    panelActivated: false, // EXP-6726b:闈㈡澘宸茬疆鍙/婵€娲绘爣璁?    canHttp: null, // 鐩磋繛閫氶亾(AsyncWebRequest)鍙敤鎬?鍚姩鍚庢帰娴嬩竴娆?null=鏈帰娴?    canHttpLastProbe: 0, // 鏈€杩戜竴娆＄洿杩為€氶亾鎺㈡祴鏃堕棿(nowMs()),缁欑绾垮鎺㈤檺娴佺敤
    btipcLastStormAt: 0, // 鏈€杩戜竴娆?STORM enter 鏃堕棿(nowMs())鈥斺€斿洖澹板け璐ョ殑鎷ュ璞佸厤鍒ゆ嵁(2026-10-12)
    logBuffer: [], // 鑱婂ぉ鏃ュ織缂撳啿(鎵归噺鎺ㄩ€佸埌妗?
    logFlushing: false,
    matchId: null, // 褰撳墠姣旇禌 ID(缂撳瓨)
    nickInfoCache: null, // 鏄电О -> { hero, heroId, steamid }(Players API 鍖归厤缂撳瓨)
    recentLogs: new Map(), // 鏈€杩戝畬鏁存棩蹇楁枃鏈?鍘婚噸 HUD 閲嶅/鏈～鍏呮潯鐩?
    pendingLogs: {}, // 鎸傝捣鐨勬湭濉厖瀹屾暣鏃ュ織:鏂囨湰\x00isOwn -> { entry, t }
    updateNotified: false, // 鐗堟湰鏇存柊鎻愮ず鏄惁宸叉樉绀?鍙樉绀轰竴娆?
  };

  // ================= 宸ュ叿鍑芥暟 =================

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
    // fallback: 浠呮鏌?root 鑷韩(涓嶉€掑綊瀛愭爲,閬垮厤鎬ц兘闄烽槺)
    if (hasClass(root, className)) return root;
    return null;
  }

  function getRoot() {
    let root = $.GetContextPanel();
    while (root && root.GetParent && root.GetParent()) root = root.GetParent();
    return root;
  }

  // 鏀堕泦闈㈡澘涓嬫墍鏈?Label 鏂囨湰(澶勭悊 Text/Ping 绛変笉鍚?contents 缁撴瀯)
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

  // 灏藉姏浠庤亰澶╄璇诲彇鑻遍泟鍚?琛屽唴 SenderHeroImage/HeroImage 闈㈡澘;澶у巺琛岀敤 HeroIcon,澶辫触杩斿洖绌轰覆)
  // 姣旀棫鐗堝鎵竴灞傚瓙闈㈡澘涓庡父瑙佸睘鎬у悕(娓告垙琛屽唴鏁版嵁鍙兘鎸傚湪浠绘剰瀛愯妭鐐?
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

  // 灏藉姏浠庤亰澶╄璇诲彇鑻遍泟鏁板瓧 ID(琛岄潰鏉垮睘鎬?澶辫触杩斿洖绌轰覆)
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

  // 灏藉姏浠庤亰澶╄璇诲彇 steamid(琛岄潰鏉垮睘鎬?鎷夸笉鍒拌繑鍥炵┖涓?
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

  // 鍗佽繘鍒跺瓧绗︿覆鐩稿姞(SteamID64 = 76561197960265728 + accountid,瓒呭嚭鍙岀簿搴﹀畨鍏ㄨ寖鍥?
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

  // 32 浣?Steam 璐﹀彿 ID -> 64 浣?SteamID(甯歌璐﹀彿:universe=1,type=1,instance=1)
  function accountIdToSteamId(accountId) {
    const digits = String(accountId || "").replace(/\D/g, "");
    if (!digits) return "";
    return addDecimalStrings("76561197960265728", digits);
  }

  // 瑙勮寖鍖栨樀绉?鐢ㄤ簬涓?Players API 瀵规瘮)
  function normName(name) {
    return String(name || "").trim().toLowerCase();
  }

  // 鎶?Players.GetPlayerInfo 鍗曟潯缁撴灉骞跺叆 info({ hero, heroId, steamid };澶氬瓧娈靛吋瀹?
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

  // 鐢ㄦ樀绉板尮閰?Players API 鎷跨帺瀹朵俊鎭?鑻遍泟/鑻遍泟ID/SteamID;灏藉姏,缁撴灉鎸夋樀绉扮紦瀛?
  function playerInfoForNick(nick) {
    const key = normName(nick);
    if (!key || key === UNKNOWN_NAME) return null;
    State.nickInfoCache = State.nickInfoCache || {};
    if (State.nickInfoCache[key]) return State.nickInfoCache[key];
    try {
      if (typeof Players === "undefined" || !Players.GetPlayerInfo) return null;
      const info = { hero: "", heroId: "", steamid: "" };
      // 鏈湴鐜╁浼樺厛(鑷繁鍙戣█鐨勬樀绉?鑻遍泟/SteamID 涓€瀹氭嬁寰楀埌)
      try {
        const li = Players.GetLocalPlayer ? Players.GetLocalPlayer() : -1;
        if (li >= 0) {
          const lp = Players.GetPlayerInfo(li);
          if (lp && normName(lp.name) === key) applyPlayerInfo(info, lp);
        }
      } catch (e) {}
      // 鎵弿鍏ㄥ満鐜╁(鏄电О澶у皬鍐欎笉鏁忔劅)
      for (let i = 0; i < PLAYER_INFO_SCAN_LIMIT && !(info.hero && info.steamid); i += 1) {
        let pi = null;
        try { pi = Players.GetPlayerInfo(i); } catch (e) { break; }
        if (!pi) continue;
        if (normName(pi.name) === key) applyPlayerInfo(info, pi);
      }
      // 鐙珛 API 鍏滃簳(閮ㄥ垎鐗堟湰鍙湁 GetPlayerName/GetPlayerSteamID)
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

  // 鏈湴鐜╁鏄电О(鑷繁鐨?HUD 娑堟伅琛?sender 鐢?澶辫触杩斿洖绌轰覆)
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

  // 鐢ㄦ樀绉板尮閰?Players API 琛?steamid(灏藉姏;Deadlock 鐜╁闈㈡澘閫氬父甯?steam_id)
  function resolveSteamId(record) {
    if (record.steamid) return String(record.steamid);
    const nick = String(record.sender || "").trim();
    if (!nick || nick === UNKNOWN_NAME) return "";
    const info = playerInfoForNick(nick);
    return (info && info.steamid) ? info.steamid : "";
  }

  // 鐢ㄦ樀绉板尮閰?Players API 琛ヨ嫳闆勫悕(琛屽唴璇讳笉鍒版椂鍏滃簳;澶辫触杩斿洖绌轰覆)
  function resolveHero(record) {
    const hero = String(record.hero || "").trim();
    if (hero) return hero;
    const nick = String(record.sender || "").trim();
    if (!nick || nick === UNKNOWN_NAME) return "";
    const info = playerInfoForNick(nick);
    return (info && info.hero) ? info.hero : "";
  }

  // 鐢ㄦ樀绉板尮閰?Players API 琛ヨ嫳闆勬暟瀛?ID(澶辫触杩斿洖绌轰覆)
  function resolveHeroId(record) {
    const hid = String(record.heroId || "").trim();
    if (hid) return hid;
    const nick = String(record.sender || "").trim();
    if (!nick || nick === UNKNOWN_NAME) return "";
    const info = playerInfoForNick(nick);
    return (info && info.heroId) ? info.heroId : "";
  }

  // 灏藉姏鑾峰彇褰撳墠姣旇禌 ID(Deadlock Panorama 鏃犵粺涓€鏂囨。,澶氬€欓€夋帰娴?澶辫触鐢ㄦ椂闂存埑)
  // 澶氬€欓€夋帰娴嬪綋鍓嶆瘮璧?ID(姣忔璋冪敤閮芥墽琛?Deadlock Panorama API 鐗堟湰宸紓澶?
  // 甯歌鍛藉悕/杩斿洖鏍煎紡閮借瘯涓€閬嶃€傛嬁涓嶅埌杩斿洖绌轰覆,鐢?getMatchId 鍏滃簳 session_)
  function probeMatchId() {
    let id = "";
    const clean = function (v) {
      const s = String(v || "").trim();
      return (s && !/^0+$/.test(s)) ? s : "";
    };
    try {
      if (typeof GameStateAPI !== "undefined") {
        // 甯歌鏃犲弬 API 鍚?澶у皬鍐欏彉浣?杩斿洖 string 鎴?{ match_id|matchId|id })
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
        // GetGameInfo / GetServerInfo:閬嶅巻閿?鍙栧惈 match/game_id/server 鐨勫瓧绗︿覆瀛楁
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
    // Game / GameUI 鍛藉悕绌洪棿(Deadlock 鐗规湁;涓?Dota 鐨?GameStateAPI 骞跺瓨)
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
    // GameInterfaceAPI 璁剧疆閿?澶氬€欓€?
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

  // 涓€娆℃€ц瘖鏂?鎺㈡祴澶辫触鏃舵妸鍙敤 API 鏂规硶鍚嶅垪鍒版帶鍒跺彴,渚夸簬鍦ㄦ湭鐭ユ父鎴忕増鏈笂瀹氫綅姝ｇ‘鐨勬瘮璧?ID API
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
    // 宸茬紦瀛樼湡瀹炴瘮璧?ID:鐩存帴杩斿洖(涓嶈繘姣旇禌鏃朵竴鐩存槸 session_ 鍏滃簳)
    if (State.matchId && State.matchId.indexOf("session_") !== 0) return State.matchId;
    // 姣忔閲嶆柊鎺㈡祴:澶у巺/缁勯槦闃舵閫氬父鎷夸笉鍒?杩涘叆姣旇禌鍚庝竴鏃︽嬁鍒扮湡瀹?ID 灏卞垏鎹㈡枃浠跺悕
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

  // 娓告垙渚х晫闈㈣瑷€:/ui 璁剧疆椤垫嵁姝ゅ喅瀹氶粯璁ゆ樉绀鸿瑷€(浼樺厛 mod 璁剧疆,閫€寮曟搸璇█)銆?  function gameUiLang() {
    // 涓婃姤缁欐ˉ(&lang=)鐨?娓告垙璇█",缃戦〉 auto 妯″紡鎹璺熼殢銆?    // 2026-10-29 淇?涓嶅啀璇?cfg.uiLang(閭ｆ槸 mod 鐣岄潰璇█,鐢ㄦ埛鍦ㄦ父鎴忓唴闈㈡澘閫夎繃灏?    // 浼氭案涔呮薄鏌撲笂鎶?"璺熼殢娓告垙"澶辨晥)鈥斺€旀亽涓哄紩鎿庢帰娴?鎺㈡祴涓嶅埌鏃朵笂鎶ョ┖涓?
    // 妗ュ拷鐣ョ┖鍊煎苟鍥炶惤 Steam 璇█(娉ㄥ唽琛?,鍚庤€呮墠鏄?娓告垙璇█"鐨勬潈濞佹簮銆?    return detectGameLang();
  }

  // $.Language() 鍦?Deadlock 鐨?Panorama 閲屽疄娴嬩笉瀛樺湪(2026-10-29:typeof 妫€鏌ュけ璐?
  // 鏃т唬鐮佷竴鐩磋蛋 catch 鍏滃簳 zh鈥斺€?璺熼殢娓告垙"浠庢湭鐪熸宸ヤ綔杩?銆傛帰娴嬩笉鍒版椂杩斿洖绌轰覆,
  // 鐢辨ˉ渚?Steam 璇█鍏滃簳銆?
  // $.Language() 杩斿洖 Steam 璇█鍚?english/schinese/tchinese/japanese/...)銆?  // 鏄犲皠鍒扮綉椤?LANGS 鏀寔鐨?code;鏈瘑鍒竴寰?en(涓庢棫琛屼负涓€鑷?銆傚彧璇讳笉鏀归厤缃€?  function detectGameLang() {
    try {
      const s = String(typeof $.Language === "function" ? $.Language() : "").toLowerCase();
      if (!s) return ""; // 鎺㈡祴涓嶅埌:涓婃姤绌轰覆,妗ュ拷鐣ュ苟鍥炶惤 Steam 璇█(娉ㄥ唽琛?
      if (s.indexOf("schinese") !== -1 || s.indexOf("zh-hans") !== -1) return "zh-Hans";
      if (s.indexOf("tchinese") !== -1 || s.indexOf("zh-hant") !== -1) return "zh-Hant";
      if (s.indexOf("chinese") !== -1) return "zh-Hans";
      if (s.indexOf("english") !== -1 || s.indexOf("en") === 0) return "en";
      if (s.indexOf("japanese") !== -1) return "ja";
      if (s.indexOf("korean") !== -1) return "ko";
      if (s.indexOf("french") !== -1) return "fr";
      if (s.indexOf("german") !== -1) return "de";
      if (s.indexOf("spanish") !== -1) return "es";
      if (s.indexOf("russian") !== -1) return "ru";
      if (s.indexOf("brazillian") !== -1 || s.indexOf("portuguese") !== -1) return "pt-BR";
      return "";
    } catch (e) {
      return "";
    }
  }

  // 娓告垙鍐?UI 鏂囨璇█(STRINGS 鍙湁 zh/en 涓よ):閰嶇疆鍥哄畾鍊间紭鍏?auto/绌?鈫?  // 璺熼殢鎺㈡祴,鎺㈡祴涓嶅埌(妗ヤ細鐢?Steam 璇█鍏滃簳,娓告垙鍐呮嬁涓嶅埌)鏃舵寜鐢ㄦ埛涓荤兢榛樿涓枃銆?  // 鐣岄潰璇█鍋忓ソ(2026-10-29 缁熶竴璇诲彇):cfg.ui.uiLang(缁忔ˉ鎸佷箙鍖?闈㈡澘閫夌殑)>
  // 鏃ч《灞?cfg.uiLang(鍏煎)> State.sysLang(妗ヤ笅鍙戠殑 Windows 绯荤粺璇█)> ""(鑷姩)銆?  // 鑻辨枃绯荤粺/娓告垙鐢ㄦ埛姝ゅ墠琚粯璁?zh 鍧?GB 鐢ㄦ埛鍙嶉:UMM 閫夐」/闈㈡澘鍏ㄦ槸涓枃鐪嬩笉鎳?銆?  function uiLangPref() {
    const c = State.cfg || {};
    const v = (c.ui && typeof c.ui.uiLang === "string" && c.ui.uiLang) || (typeof c.uiLang === "string" ? c.uiLang : "") || State.sysLang || "";
    return String(v);
  }

  function resolveUiLang() {
    const pref = uiLangPref();
    if (pref === "zh" || pref === "en") return pref;
    const g = detectGameLang();
    if (!g) return (pref === "en" || State.sysLang === "en") ? "en" : "zh";
    return (g === "zh-Hans" || g === "zh") ? "zh" : "en";
  }

  // trOpenSummary:/tr 鎷夌綉椤垫椂闄勫湪 UI_OPEN 鍚庨潰鐨勭姸鎬佹憳瑕?鍙繘鏃ュ織,涓嶅弬涓庡垽瀹?缁濅笉鍚?Key銆?  // ============================================================
  // COMMUNITY 0.1.0:鏃犳ˉ閰嶇疆鍚屾 + 娓告垙鍐呭彲瑙佽缃潰鏉?+ 閰嶇疆鐮佸鍏?  // 鏉冨▉ = 鎵樼椤?localStorage(璺ㄦ父鎴忛噸鍚寔涔?POC 鐪熸満宸查獙璇?;
  // 娓告垙渚?State.cfg/convar 淇濇寔鍙闀滃儚,applyBridgeConfig 鏈哄埗鍘熸牱澶嶇敤銆?  // ============================================================
  function hashCfgSync() {
    // 鎷夊彇椤甸潰閰嶇疆:hash {op:"cfg"} 鈫?椤甸潰鍥?{cfg:{...鎵佸钩}} 鈫?鍖呮垚 {ui:{...}} 鍠?applyBridgeConfig
    if (!State.hashReady || !State.hashBase) return;
    const jobId = "cfg" + (++State.requestSeq).toString(36);
    const payload = { q: "cfg_" + nowMs(), id: jobId, op: "cfg", d: {} };
    setPending(jobId, function (payload2) {
      try {
        if (!payload2 || !payload2.ok || !payload2.cfg) { log("page cfg: no cfg in response"); return; }
        const mask = { ui: payload2.cfg };
        applyBridgeConfig(mask, "page-cfg");
      } catch (eC) { log("page cfg apply failed: " + expErr(eC)); }
    }, 12000);
    try {
      const hp = ensurePanel();
      if (isValid(hp) && typeof hp.SetURL === "function") {
        hp.SetURL(State.hashBase + "#LCTQ:" + encodeURIComponent(JSON.stringify(payload)));
      }
    } catch (e) {}
  }
  function startPageCfgSync() {
    if (State.pageCfgStarted) return;
    State.pageCfgStarted = true;
    hashCfgSync();
    try {
      $.Schedule(30.0, function pageCfgLoop() {
        hashCfgSync();
        $.Schedule(30.0, pageCfgLoop);
      });
    } catch (e) {}
  }
  // 娓告垙鍐呭彲瑙佽缃潰鏉?鍔ㄦ€佸垱寤?CitadelHTMLPanel(鐙珛浜庨殣钘忕炕璇戦潰鏉?浜掍笉骞叉壈)
  function showPagePanel() {
    try {
      let p = findChild(getRoot(), "LCTSettingsPage");
      if (!isValid(p)) {
        p = $.CreatePanel("CitadelHTMLPanel", getRoot(), "LCTSettingsPage");
        p.style.width = "640px";
        p.style.height = "520px";
        p.style.horizontalAlignment = "center";
        p.style.verticalAlignment = "center";
      }
      p.hittest = true;
      p.acceptsfocus = true;
      p.visible = true;
      p.SetURL(PAGE_URL + "#settings");
      try { if (typeof p.Activate === "function") p.Activate(); } catch (eA) {}
      log("settings page opened in-game (click to interact; /tr again to close)");
      return true;
    } catch (e) {
      log("settings panel failed: " + expErr(e) + " 鈥?娴忚鍣ㄦ墦寮€ " + PAGE_URL);
      return false;
    }
  }
  function hidePagePanel() {
    try {
      const p = findChild(getRoot(), "LCTSettingsPage");
      if (isValid(p)) { p.visible = false; p.DeleteAsync(0); }
      return true;
    } catch (e) { return false; }
  }
  function togglePagePanel() {
    const p = findChild(getRoot(), "LCTSettingsPage");
    if (isValid(p) && p.visible) { hidePagePanel(); return; }
    showPagePanel();
  }
  function importCfgCode(code) {
    // 閰嶇疆鐮佸厹搴?娴忚鍣?Pages銆屽鍑洪厤缃爜銆嶁啋 /tr code <base64> 鈫?缁?hash 璁╅〉闈㈠啓鑷繁鐨?localStorage
    if (!code) {
      log("/tr code: empty");
      setStatus("/tr code: 閰嶇疆鐮佷负绌?);
      return;
    }
    const jobId = "cfgc" + (++State.requestSeq).toString(36);
    const payload = { q: "cfgc_" + nowMs(), id: jobId, op: "cfgcode", d: { code: String(code) } };
    setPending(jobId, function (payload2) {
      try {
        if (payload2 && payload2.ok) {
          log("cfg code imported: keys=" + JSON.stringify(payload2.keys || []));
          setStatus("閰嶇疆宸插鍏? " + JSON.stringify(payload2.keys || []));
          hashCfgSync(); // 绔嬪嵆鎷夋柊閰嶇疆
        } else {
          log("cfg code import failed: " + ((payload2 && payload2.error) || "?"));
          setStatus("/tr code: 瀵煎叆澶辫触(妫€鏌ラ厤缃爜)");
        }
      } catch (eC) { log("cfg code settle threw: " + expErr(eC)); }
    }, 12000);
    try {
      const hp = ensurePanel();
      if (isValid(hp) && typeof hp.SetURL === "function") {
        hp.SetURL(State.hashBase + "#LCTQ:" + encodeURIComponent(JSON.stringify(payload)));
      }
    } catch (e) {}
  }

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

  // F6 淇(2026-10-10 娓告垙鍐呭疄娴?:褰撳墠 Panorama 鏃?clearTimeout/setTimeout 鍏ㄥ眬
  // (ctprobe 瀹炴祴 typeof 鍧?undefined),$.Schedule 鍙ユ焺鐨勫畼鏂瑰彇娑堝櫒鏄?$.CancelScheduled
  // (diag-globals 鏋氫妇璇佸疄瀛樺湪)銆傚彇娑堝け璐ョ殑鍚庢灉:鏃ч€氶亾 outgoing 20s 瓒呮椂鍥炶皟鏅氬埌 鈫?  // 鍙?finishJob 鈫?妲戒綅瓒呭彂(MAX_ACTIVE_REQUESTS=1 琚嚮绌?銆?  // 2026-10-31:娓告垙鍐呰缃潰鏉垮凡绉婚櫎(鍙?UI 鍒嗗弶瀵艰嚧鏂瑰悜閿欎贡),榻胯疆鎸夐挳鏀瑰紑缃戦〉銆?  globalThis.LCTOpenWebSettings = function () { log("UI_OPEN " + trOpenSummary()); };
  function cancelSched(h) {
    if (!h) return;
    try {
      if (typeof $.CancelScheduled === "function") $.CancelScheduled(h);
    } catch (e) {}
    try { clearTimeout(h); } catch (e2) {} // 鍙屼繚闄?鑻ユ煇鐗堟湰浠?clearTimeout 瀹炵幇
  }

  // djb2 鍝堝笇:鐢ㄤ簬鐢熸垚绋冲畾鐨勮瘧鏂?Label id(婊氬姩鍥炴敹鍚庨噸寤虹敤)
  function hashString(str) {
    let h = 5381;
    const s = String(str || "");
    for (let i = 0; i < s.length; i += 1) {
      h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
  }

  // expErr:閿欒娑堟伅鏍煎紡鍖?鈥斺€?P4a 浠庡疄楠屾帰閽堝尯鍒嗗绉诲叆(settle/boot 璺緞寮曠敤鐣欐牳蹇?鎺㈤拡缁?LCTNS 鍒悕瀵煎叆)
  function expErr(e) {
    return e && e.message ? e.message : String(e);
  }
  // expCall:瀹為獙鎺㈤拡鏅氱粦瀹氭淳鍙?2026-10-12 P4a)鈥斺€?鎺㈤拡鍖哄凡鎷嗚嚦 lingua_chat_exp.vjs_c,
  // 缁?chat.xml/hudchat.xml 椤哄簭瑁呰浇;鎺㈤拡鏂囦欢缂哄け鎴栧唴閮ㄥ紓甯告椂闄嶇骇涓烘棤鎿嶄綔,鑱婂ぉ涓绘祦绋嬩笉鍙楀奖鍝嶃€?  function expCall(name, a, b) {
    var f = globalThis.LCTNS && globalThis.LCTNS[name];
    if (typeof f !== "function") return undefined;
    try { return f(a, b); } catch (e) { log("exp " + name + " THREW " + expErr(e)); return undefined; }
  }

  // ================= 閰嶇疆(娓告垙渚?UI 鍋忓ソ) =================

  const UI_DEFAULTS = {
    enabled: true,
    provider: "bing", // 榛樿鍏叡鍏嶈垂鏈嶅姟鍟?microsoft 闇€濉?Azure Key
    displayMode: "bilingual", // bilingual | translation_only
    outgoing: "off", // off | translation | bilingual
    outgoingTarget: "en",
    targetLanguage: "zh-Hans",
    force: false,
    timeoutMs: 15000,
    chatLog: true, // 鑱婂ぉ鏃ュ織寮€鍏?鎸夋瘮璧?ID 瀛樻湰鍦?
    translateOwn: true, // 鑷繁鐨勫彂瑷€涔熺炕璇?榛樿寮€)
    uiLang: "zh", // 鐣岄潰璇█:zh=涓枃, en=English
  };

  // ---- 澶氳瑷€鏀寔 ----
  // 鏁版嵁澶栫疆(2026-10-28):鏂囨琛?閫夐」琛ㄥ湪 lingua_chat_i18n.vjs_c 鈥斺€?璇ユ枃浠?*鍏堜簬鏈枃浠惰杞?*
  // (chat.xml/hudchat.xml 椤哄簭:fallback 涓変欢 鈫?btipc 鈫?i18n 鈫?涓昏剼鏈?,鐢ㄦ棤澹版槑璧嬪€兼寕鍏ㄥ眬;
  // 杩欓噷璇绘垚灞€閮ㄥ埆鍚?var,涓绘枃浠跺唴寮曠敤鐐规部鐢ㄥ師鍚嶃€侀浂鏀瑰姩)銆?  var STRINGS = globalThis.LCT_I18N_STRINGS || {};
  var FIELD_OPTIONS = globalThis.LCT_FIELD_OPTIONS || {};
  var PROVIDER_OPTIONS = FIELD_OPTIONS.PROVIDER_OPTIONS || [];
  var LANGUAGE_OPTIONS = FIELD_OPTIONS.LANGUAGE_OPTIONS || [];
  var DISPLAY_MODES = FIELD_OPTIONS.DISPLAY_MODES || [];
  var OUTGOING_MODES = FIELD_OPTIONS.OUTGOING_MODES || [];
  var UI_LANG_OPTIONS = FIELD_OPTIONS.UI_LANG_OPTIONS || [];
  var UI_CONVAR = FIELD_OPTIONS.UI_CONVAR || "lct_ui";

  function t(key) {
    const lang = resolveUiLang();
    const entry = STRINGS[key];
    if (!entry) return key;
    return entry[lang] || entry.zh || key;
  }

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
    // 2026-10-31 璇勫淇(convar_seed 瀹炶瘉):json 鍘熷０鏄庡湪棣栦釜 try 鍧楀唴,绗簩涓?try 鐨?    // SetValue 寮曠敤瀹冨繀鎶?ReferenceError 涓旇绌?catch 鍚炴帀鈥斺€攃onvar 浠庢湭琚啓鍏?瀛橀噺 bug)銆?    // 鍚屾壒鍔犲箓绛?鍊肩浉鍚屼笉鍐?闃?OnConVarChanged 浜嬩欢椋庢毚銆傜函鏈湴鍐欏叆,鏃?dirty/鏃犵綉缁滃壇浣滅敤銆?    let json = "";
    try { json = JSON.stringify(State.cfg); } catch (e) { return; }
    try {
      const panel = $.GetContextPanel();
      if (panel.GetAttributeString) {
        if (panel.GetAttributeString(UI_CONVAR, "") !== json) panel.SetAttributeString(UI_CONVAR, json);
      } else {
        panel.SetAttributeString(UI_CONVAR, json);
      }
    } catch (e) {}
    try {
      if (typeof Convars !== "undefined") {
        if (Convars.RegisterConVar) Convars.RegisterConVar(UI_CONVAR, "{}", 0, "LinguaChat UI settings");
        if (Convars.SetValue) {
          const cur = Convars.GetStr ? Convars.GetStr(UI_CONVAR, "") : "";
          if (cur !== json) Convars.SetValue(UI_CONVAR, json);
        }
      }
    } catch (e) {}
  }

  // ================= 娑堟伅璇诲彇涓庤繃婊?=================

  function readMessageRow(row) {
    // 娉?鏇炬湁"闈㈡澘缂撳瓨"(__lctCached/__lctCachedSig 瀹堝崼)鍦ㄦ璺宠繃 DOM 璇诲彇銆?    // 2026-09-17 绉婚櫎:瀹堝崼涓ょ閮芥槸 mod 鑷鍊?娓告垙鍥炴敹澶嶇敤琛?鏀?DOM 鍐呭)鏃朵袱鑰呭潎涓嶅彉 鈫?    // 姘歌繙鍛戒腑鏃х紦瀛?record 鈫?sig 姘镐笉鍙樺寲 鈫?resetRowModState 姘镐笉瑙﹀彂 鈫?琛屽喕缁撳湪鏃ц瘧鏂?鎶樺彔鎬?    // (simtest test2 瀹為敜;9-15 璇ョ紦瀛樺凡鍜繃涓€娆?record.text 鏀瑰啓)銆侱OM 姣忔壂蹇呰,鎵弿鑼冨洿鏈氨鏈夌晫銆?    // 澶у巺鑱婂ぉ琛?hudchat:ChatLineContainer 鐩存寕 ChatLinesPanel,鏃?MessageSource/MessageContents)
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
        quick: !!findChild(row, "PingLabel"), // 澶у巺琛岀殑 Ping/蹇嵎鐭鏈湴鍖?璺宠繃缈昏瘧
      };
      return result;
    }
    // HUD 椤舵爮琛?鏃?MessageSource,鏂囨湰鍦?MessageText(姘旀场鍐?,sender 鏈煡
    const isHudRow = hasClass(row, "ChatMessage") && !!findClass(row, HUD_BUBBLE_CLASS);
    if (isHudRow) {
      const textLabel = findChild(row, HUD_TEXT_ID);
      const text = safeText(textLabel) || collectText(row);
      if (!text) return null;
      const isOwn = hasClass(row, "IsSelf") || !!findClass(row, LOCAL_CLIENT_ID);
      // HUD 椤舵爮杞洏琛岀殑缁撴瀯鏍囪鏄?PingStyleIcon(+SubjectIcon/CooldownTimer/ResponseHeroes),
      // 涓嶅甫 Ping class/PingLabel(2026-10-02 exp6738 瀹炶溅 dump 瀹為敜)鈥斺€?      // 婕忔帀瀹冧細璁?HUD 渚у揩鎹疯闊?100% 閫€鍖栦负妯℃澘鍖归厤,娓告垙鏀瑰悕鍗崇炕杞?26 绾㈢殑鐥呭洜闈?
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
      // 鍙湁绾腑鏂囨墠璺宠繃銆備腑鑻辨贩鍚堟秷鎭粛闇€缈昏瘧,鍚﹀垯鑻辨枃閮ㄥ垎浼氬師鏍风暀涓嬨€?      return CJK_RE.test(text) && !/[A-Za-z]/.test(String(text || ""));
    }
    return false;
  }

  // ================= 蹇嵎璇煶妯℃澘鍖归厤(2026-09-17 閲嶆瀯,鍏嶆鍒? =================
  // 蹇嵎璇煶/杞洏娑堟伅缃戠粶涓婁紶杈撶殑鏄湰鍦板寲 key+鍙傛暟,姣忎釜瀹㈡埛绔敤鑷繁鐨勬父鎴忚瑷€娓叉煋(涓枃鐜╁鐪嬪埌
  // "鎴戠湅鍒?McGinnis",鑻辨枃鐜╁鐪嬪埌 "I see McGinnis")鈥斺€?瀹樻柟鏈湴鍖栧眰灏辨槸缈昏瘧鏈韩,mod 鍐嶇炕涓€閬?  // 閮藉彧鏄姡璐ㄩ噸澶嶈瘧鏂囥€?  // 鏃ф柟妗?宸插簾寮冪殑灞庡北):妗ョ敓鎴?253 鏉″法鍨嬫鍒?+ 瀹㈡埛绔‖缂栫爜鍏滃簳姝ｅ垯 鈥斺€?鍙傛暟杞箟/閲忚瘝(鍙犳爣鐐?  // 婕忕綉)/鍙岃瑕嗙洊/鏂版ā鏉胯窡闅?姣忎釜缁村害閮芥槸婕忕綉闈€?  // 鏂版柟妗?妯℃澘 = token 搴忓垪(param | fixed);鍖归厤 = 褰掍竴鍖?鍘荤┖鐧?灏忓啓)鍚?token 璧版煡:fixed 閫愬瓧
  // 鍛戒腑;param 娑堣垂 鈮? 瀛楃涓斿彧鍏佽銆愬凡鐭ユ父鎴忓悕(鑻?涓?銆戞垨銆愪笉鍚?CJK 鐨勭煭 latin 杩炰覆銆?闃?CJK
  // 閫氶厤璇潃鐪熶汉娑堟伅);灏鹃儴鏍囩偣鍏堝墺(鍏煎 HUD 鍙犳爣鐐?銆傝鏂?妗ュ悓姝?+ 鑷姩鐢熸垚鐨?  // lingua_chat_quickchat_fallback.js;鍙傛暟绾︽潫琛?lingua_chat_gamenames_fallback.js銆?  // 缁撴瀯鍖栬瘑鍒?Ping class/PingLabel)浠嶅湪 shouldSkip 鍏堣,杩欓噷鍙厹"浠?Text 褰㈡€佹覆鏌撶殑杞洏娑堟伅"銆?  if (typeof LCT_QUICKCHAT_FALLBACK_TEMPLATES === "undefined") {
    $.Msg("[LCT] quickchat fallback templates missing!");
  }
  if (typeof LCT_GAMENAMES_FALLBACK === "undefined") {
    $.Msg("[LCT] gamenames fallback missing!");
  }
  let QUICKCHAT_TEMPLATES = (typeof LCT_QUICKCHAT_FALLBACK_TEMPLATES !== "undefined" && LCT_QUICKCHAT_FALLBACK_TEMPLATES)
    ? LCT_QUICKCHAT_FALLBACK_TEMPLATES.slice() : [];
  let quickchatSynced = false;

  // @sync-begin core/quickchat_match.js 鈥斺€?鏈潡(褰掍竴鍖?鍚嶈〃/璧版煡/鍖归厤缂撳瓨)涓?core 鍙傝€冨疄鐜颁繚鎸佽涓哄悓姝?
  // tests/client_copy_sync.test.js 閫愮敤渚嬪璐?鏀逛换浣曚竴渚у繀椤诲悓姝ュ彟涓€渚у苟閲嶈窇璇ユ祴璇曘€?  // 褰掍竴鍖?灏忓啓 + 鍘绘墍鏈夌┖鐧?娓告垙娓叉煋绌烘牸涓嶇ǔ瀹?"灏?蹇?/"灏忓績锛乆 鏈塝")
  function __qcNorm(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, "");
  }

  let QC_NAME_SORTED = null; // 闀垮害闄嶅簭褰掍竴鍖栧悕琛?鎯版€ф瀯寤?
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

  // 妯℃澘 token 鍖? [{p:true}] | [{p:false, v:褰掍竴鍖栧浐瀹氭}]
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

  // 鍖归厤缂撳瓨(2026-09-17 璇勫):鍚屼竴鏉℃枃鏈湪 HUD 椤舵爮涓庡乏涓嬭亰澶╂爮鍚勬覆鏌撲竴琛?shouldSkip 鍚勮皟涓€娆?  // matchesQuickTemplate鈥斺€攖oken 璧版煡(鍙岃鍏ㄩ噺妯℃澘)姣忛€氶亾鍚勫仛涓€閬嶃€傜紦瀛樻寜銆愯蛋鏌ヨ嚜韬綊涓€鍖栧舰寮忋€?  // 璁板繂缁撴灉(闈?makeTextKey:涓嶄緷璧栫洰鏍囪瑷€,涓斿墺灏惧悗 "Venator涓嶈浜?/"Venator涓嶈浜嗭紒锛侊紒" 鍚岄敭),
  // 鍙岄€氶亾 skip 鍒ゅ畾鍚屾簮;涓婇檺 500 闃查暱浼氳瘽鑶ㄨ儉(缂撳瓨鍙渷璧版煡,娓呯┖涓嶅奖鍝嶆纭€?銆?  // 璇枡鏁翠綋鏇挎崲(妗ュ悓姝?鏃跺繀椤绘竻绌衡€斺€旇 adoptQuickChatTemplates銆?  let QC_MATCH_CACHE = new Map();
  const QC_MATCH_CACHE_LIMIT = 500;

  function matchesQuickTemplate(text) {
    const msg0 = String(text || "").trim();
    if (!msg0 || QUICKCHAT_TEMPLATES.length === 0) return false;
    const msg = __qcNorm(msg0.replace(/[\s!锛?锛?銆傗€︹嫰~銆淽+$/g, "")); // 鍓ュ熬閮ㄦ爣鐐?鍙犳爣鐐瑰吋瀹?鍚庡綊涓€鍖?    if (!msg) return false;
    const cached = QC_MATCH_CACHE.get(msg);
    if (cached !== undefined) return cached; // 鍙岄€氶亾鍚屾枃鏈?绗簩閫氶亾鐩存帴鍛戒腑,涓嶅啀璧版煡

    for (let ti = 0; ti < QUICKCHAT_TEMPLATES.length; ti++) {
      const tokens = __qcTplTokens(QUICKCHAT_TEMPLATES[ti]);
      if (tokens.length === 0) continue;
      if (tokens.length === 1 && !tokens[0].p) {
        if (msg === tokens[0].v) return true; // 绾浐瀹氭ā鏉?鏁村彞鐩哥瓑
        continue;
      }
      // token 璧版煡(param 鍦ㄤ笅涓€ fixed 閿氱偣澶勫仠闈?
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
            // 鏈熬 param:宸茬煡娓告垙鍚?鎴?鏁存 latin 杩炰覆(闃蹭换鎰?CJK 閫氶厤璇潃)
            if (__qcNameLenAt(msg, pos) > 0 || !__qcHasCJK(msg.slice(pos))) {
              pos = msg.length;
            } else { ok = false; break; }
          } else {
            // 涓棿 param:鍦ㄤ笅涓€ fixed 閿氱偣澶勫仠闈?浠?pos+1 璧?淇濊瘉 鈮? 瀛楃)
            const nextFixed = tokens[i + 1].p ? null : tokens[i + 1].v;
            if (!nextFixed) { ok = false; break; } // 杩炵画 param(缁撴瀯閿?鐢熸垚渚у凡鍓旈櫎)
            let found = -1;
            let search = pos + 1;
            while (true) {
              const idx = msg.indexOf(nextFixed, search);
              if (idx < 0) { ok = false; break; }
              // 鍙傛暟娈?= msg[pos..idx):宸茬煡鍚嶅瓧 鎴?涓嶅惈 CJK 鐨勭煭 latin 杩炰覆(鈮?4;
              // norm 绮樻帴鍚?latin 娈垫棤娉曚笌鍥哄畾娈靛垎寮€,濡?"restorativelocket"+"isoncooldownfor")
              const segLen = idx - pos;
              const segVal = msg.slice(pos, idx);
              const latinRun = segLen >= 1 && segLen <= 24 && !__qcHasCJK(segVal);
              if (segLen >= 1 && (__qcNameLenAt(msg, pos) === segLen || latinRun)) {
                found = idx;
                break;
              }
              search = idx + 1; // 璇ラ敋鐐逛笉鍚堥€?缁х画鎵句笅涓€澶?            }
            if (!ok || found < 0) { ok = false; break; }
            pos = found;
          }
        }
      }
      if (!ok) continue;
      if (pos !== msg.length) continue; // 蹇呴』鎭板ソ璧板畬鏁存潯娑堟伅
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

  // 浠庢ˉ鎷夊彇蹇嵎璇煶妯℃澘(/api/v1/quickchat,v3 鍘熷妯℃澘鏁扮粍)銆?  // 鎻℃墜瑁佸喅(鍐呭鎸囩汗;涓?core/quickchat_sync.js evaluateQuickChatSync 鍚屾簮,鏀逛竴澶勫繀鏌ュ彟涓€澶?:
  //   鈶?妗ヤ笉鍙揪/鍝嶅簲鏃犳晥 鈫?淇濈暀鍏滃簳,鍛婅涓€娆?绂荤嚎鏄父鎬?涓嶅埛灞?;
  //   鈶?妗ユ寚绾?=== 鍏戝簳鎸囩汗 鈫?閲囩撼(鏍囪 synced);
  //   鈶?鎸囩汗缂哄け(鏃фˉ/鏃у厬搴?鎴栦笉涓€鑷?鈫?閲嶆媺涓€娆＄‘璁?闃茬灛鏃?鎴柇鍝嶅簲璇垽);
  //   鈶?閲嶆媺鍚庝粛涓嶄竴鑷?鈫?閲囩撼妗ヨ鏂?妗ヤ粠鏈満娓告垙鏂囦欢瀹炴椂鐢熸垚,鏄洿鏂扮殑涓€鏂? + 鍛婅涓€娆?鍏戝簳杩囨湡)銆?  // 璇枡閲囩撼鍚庡繀椤绘竻绌哄尮閰嶇紦瀛?鍚﹀垯鏃у垽瀹氭畫鐣?妯℃澘宸叉崲銆佸垽瀹氳繕鏄棫鐨?銆?  const QC_SYNC_STATE = { reloadTried: false, warnedOffline: false, warnedMismatch: false };
  // 鍏戝簳鎸囩汗:鐢熸垚鍣ㄥ啓鍏?lingua_chat_quickchat_fallback.js 鐨勫叏灞€(鏃у厬搴曟枃浠舵棤 鈫?null,鎻℃墜鎸夋寚绾圭己澶辫矾寰勮蛋)
  // 瀹㈡埛绔笉閲嶇畻鎸囩汗(鏃?FNV 浠ｇ爜):鍏戝簳鎸囩汗鐢辩敓鎴愬櫒鍐欏叆鍏ㄥ眬鍙橀噺,妗ヤ晶鎸囩汗鏉ヨ嚜鍝嶅簲,杩欓噷鍙仛姣斿銆?  // (鏇炬湁鐨?count 瀛楁宸插垹:瑁佸喅鍙湅鎸囩汗,count 浠庢湭琚鈥斺€旀瀛楁)
  const QC_LOCAL_META = {
    fingerprint: (typeof LCT_QUICKCHAT_FALLBACK_FINGERPRINT === "string") ? LCT_QUICKCHAT_FALLBACK_FINGERPRINT : null,
  };

  function adoptQuickChatTemplates(templates, note) {
    QUICKCHAT_TEMPLATES = templates;
    quickchatSynced = true;
    QC_MATCH_CACHE.clear(); // 璇枡鎹簡,鏃у尮閰嶇粨鏋滃叏閮ㄤ綔搴?    log("quickchat templates " + note + ": " + templates.length);
  }

  // @sync core/quickchat_sync.js 鈥斺€?evaluateQuickChatSync 瀹㈡埛绔悓姝ュ壇鏈?瀹㈡埛绔棤娉?require,鍚?matchesQuickTemplate 鍏堜緥;tests/client_copy_sync.test.js 瀵硅处)
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
        out.warn = "quickchat: 妗ヤ笉鍙揪/鍝嶅簲鏃犳晥,淇濈暀鍏戝簳璇枡";
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
      out.warn = "quickchat: 妗ヤ晶璇枡涓庡厬搴曟寚绾逛笉涓€鑷?宸查噰鐢ㄦˉ渚ц鏂?鍏戝簳杩囨湡:閲嶈窇 node core/quickchat.js 骞堕噸缂?VPK)";
      s.warnedMismatch = true;
    }
    return out;
  }

  // btipc07:璇枡鍚屾鏀硅蛋涓ゆ寮?op=config 鐨?get=quickchat)鈥斺€?  //   鈶?鎻℃墜鍙姤鍏滃簳鎸囩汗,妗ュ洖 same=1 灏变竴鏉℃暟鎹兘涓嶄紶(甯告€?鎵撳寘鍐呯儤鐒欏€间笌妗ュ悓婧?;
  //   鈶?涓嶅悓鎵嶆寜 off/lim 鍒嗙墖鎷?鏀堕綈(done)鎵嶈В鏋?澶╃劧鍏嶇柅鎴柇 鈫?涓嶅啀闇€瑕?  //      evaluateQuickChatSync 閲?閲嶆媺涓€娆＄‘璁?鐨勯偅鏉¤矾寰?瑙佷笅鏂?reloadTried 娉ㄩ噴)銆?  function syncQuickChat(callback) {
    if (State.quickchatTries >= SYNC_MAX_TRIES) { if (callback) callback(); return; }
    State.quickchatTries = (State.quickchatTries || 0) + 1;
    syncViaBtipc(
      "quickchat",
      QC_LOCAL_META.fingerprint,
      function (res) {
        // 鎸囩汗涓€鑷?= 鍐呭閫愬瓧鐩稿悓,鏍囪 synced 鍗冲彲(鏃犻渶 adopt,缂撳瓨鏈氨鏄悓涓€浠借鏂?
        quickchatSynced = true;
        // 鍚屼笂:闆朵紶杈撴垚鍔熷繀椤荤暀鐥?鍚﹀垯楠屾敹鏃舵棤浠庡垽鏂彙鎵嬬湡鐨勮蛋浜?same 鍒嗘敮
        log("quickchat sync: fingerprint match, no transfer (" +
          ((res && res.count) || QUICKCHAT_TEMPLATES.length) + " templates)");
        return true;
      },
      function (text) {
        let data = null;
        try { data = JSON.parse(text); } catch (e) { data = null; }
        if (!data || typeof data !== "object") return false;
        if (data.delta) {
          // 澧為噺:鎸夊鍒犳敼灏卞湴鏂藉姞(鐩爣鏄粷瀵瑰€?閲嶅鏂藉姞骞傜瓑)
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
        // 鍒嗙墖鍗忚宸蹭繚璇佹敹榻?涓嶅啀璧?閲嶆媺涓€娆?閭ｆ潯鍒嗘敮 鈫?鐩存帴鎸夐娆″嵆缁堝眬瑁佸喅
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

  // 鍓ユ帀涓枃+鏍囩偣/鏁板瓧/绌烘牸鍚庡墿涓嬬殑鎷変竵瀛楁瘝 = 娑堟伅閲岀湡姝ｉ潪涓枃鐨勯儴鍒?  // (娓告垙涓撳悕濡?McGinnis 涔熺暀鍦ㄦ畫浣欓噷,鐢卞崰浣?杩樺師閾捐矾璐熻矗涓枃鍖?
  function leftoverEnglish(text) {
    let s = String(text || "");
    s = s.replace(/[\u3400-\u4dbf\u4e00-\u9fff]+/g, " ");
    s = s.replace(/[\d\s\W_]+/g, " ");
    return s.trim();
  }

  // 娣峰悎娑堟伅(涓枃+灏戦噺鑻辨枃,鍏稿瀷:寮€鍚?鑻辨枃鑻遍泟鍚?鍚庣殑蹇嵎璇煶娓叉煋缁撴灉,濡?"鎴戠湅鍒?McGinnis")
  // 杩斿洖闇€閫佸幓缈昏瘧鐨勯潪涓枃鐗囨;绾腑鏂囪繑鍥炵┖涓?绾嫳鏂囪繑鍥?null(鏁村彞鐓ф棫缈昏瘧)銆?  function mixedFragment(text) {
    const s = String(text || "");
    if (!CJK_RE.test(s)) return null; // 娌℃湁涓枃 鈫?鏁村彞缈昏瘧
    return leftoverEnglish(s);
  }

  // 鎷艰娣峰悎娑堟伅鐨勬渶缁堟樉绀烘枃鏈? 涓枃閮ㄥ垎鍘熸牱淇濈暀, 璇戞枃鏇挎崲闈炰腑鏂囩墖娈?
  // 鎭板ソ涓€娈佃嫳鏂?鈫?鍘熶綅鏇挎崲 (甯歌: 蹇嵎璇煶 "鎴戠湅鍒?McGinnis"); 澶氭鑻辨枃 (缃曡) 鈫?涓枃杩炴帓+璇戞枃.
  function assembleMixedTranslation(originalText, fragmentTranslation) {
    const frag = String(fragmentTranslation || "").trim();
    const orig = String(originalText || "");
    if (!frag) return orig;
    const segs = orig.split(/([\u3400-\u4dbf\u4e00-\u9fff]+)/); // 鎹曡幏缁? 鍋舵暟涓嬫爣=闈炰腑鏂囨, 濂囨暟=涓枃娈?    let latinCount = 0;
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
    // 鎬诲紑鍏?鍏虫帀鍚?*鏀跺彂閮戒笉缈昏瘧**(2026-10-20 瀹炴祴:缃戦〉鎶?鍚敤缈昏瘧"鍏虫帀鍚?
    // 鏀跺埌鐨勬秷鎭収鏍疯缈昏瘧 鈥斺€?杩欎釜寮€鍏冲巻鏉ュ彧绠″彂閫佸墠缈昏瘧,闈㈡澘涓婄殑鏍囩鍗存槸"鍚敤缈昏瘧",
    // 璇箟瀵逛笉涓?鐢ㄦ埛浠ヤ负娌＄敓鏁?銆傚彧璁ゆ樉寮?false(缂虹渷鎸夊紑)銆?    if (State.cfg.enabled === false) return true;
    if (record.quick) {
      // 娓告垙鍘熺敓蹇嵎鐭/Ping 宸茬敱娓告垙鏈湴鍖?涓嶈皟鐢ㄧ炕璇戞帴鍙ｃ€?      // 2026-10-28 璧锋敹绱?DOM 鏍囪(Ping/PingLabel/PingStyleIcon)涓嶅啀鍗曠嫭瀹氱敓姝烩€斺€斿綋鏃ユ父鎴忔洿鏂板悗
      // 瀹炴祴鑱婂ぉ妗嗚涓?HUD 琛屽叏閮ㄨ鍛戒腑 Ping 鏍囪(鎵嬫墦鑻辨枃闀垮彞 "u have 7k on me鈥? 涔熸爣 quick),
      // 鍏ㄥ満闆剁炕璇戙€傛敼涓?浠呭綋鏂囨湰鍛戒腑杞洏妯℃澘搴?鍙傛暟濉┖宸叉敮鎸?鎴栧凡涓虹洰鏍囪瑷€鎵嶈烦杩囥€?      const textLocalized = isQuickChatTemplate(text) || (!State.cfg.force && isTargetLanguageText(text));
      if (textLocalized) return true;
      // 鏍囪瀛樼枒(鏃㈤潪宸茬煡杞洏璇枡銆佷篃涓嶆槸鐩爣璇█)鈫?钀藉埌涓嬮潰鐨勬甯稿垽瀹?鐓у父缈昏瘧
    }
    if (isQuickChatTemplate(text)) return true; // 鏈湴鍖栨ā鏉跨櫧鍚嶅崟:蹇嵎璇煶娓叉煋缁撴灉(鍚弬鏁板～绌?,绮剧‘鍛戒腑鍗宠烦杩?    if (text.charAt(0) === "/") return true; // 鎸囦护娑堟伅
    if (!/\p{L}/u.test(text)) return true; // 鏃犱换浣?Unicode 瀛楁瘝(绾暟瀛?绗﹀彿/琛ㄦ儏)鈥斺€擻W 浼氭妸瑗块噷灏?闊╂枃褰撶鍙疯烦杩?2026-10-31 淇勮淇)
    if (record.isOwn && State.cfg.translateOwn === false) return true; // 鍙厤缃?榛樿缈昏瘧鑷繁鐨勬秷鎭?    if (!State.cfg.force && isTargetLanguageText(text)) return true; // 宸蹭负鐩爣璇█
    return false;
  }

  // ================= 璇戞枃娉ㄥ叆 =================

  function isHudRow(row) {
    return hasClass(row, "ChatMessage") && !!findClass(row, HUD_BUBBLE_CLASS);
  }

  function isLobbyRow(row) {
    return hasClass(row, LOBBY_ROW_CLASS);
  }

  // 澶у巺琛?flow-children:right 姘旀场)鏃犳硶鐩存帴杩藉姞"涓嬫柟"璇戞枃:
  // 棣栨閬囧埌鏃舵妸琛屽唴瀹瑰寘杩?LCTLobbyWrap(妯悜),琛岃嚜韬敼绾靛悜娴?璇戞枃鎸傚湪 wrap 涓嬫柟銆?  // 鑻ヨ繍琛屾椂鏃?SetParent(鏋佸皯瑙?,鏀惧純閲嶆瀯,璇戞枃鍐呰仈鏄剧ず(浠嶅彲瑙?銆?  function ensureLobbyLayout(row) {
    if (row.__lctLobbyWrapped) {
      // 琛屽彲鑳借娓告垙鍥炴敹澶嶇敤:wrap 鑻ュ凡琚竻鎺?闇€瑕侀噸寤?      if (findClass(row, "LCTLobbyWrap")) return true;
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
        // 绉诲姩澶辫触:鍥炴粴,淇濇寔鍘熻甯冨眬
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

  // 澶у巺琛岃瘧鏂囨寕杞界偣:琛屾湰韬?wrap 涔嬪悗浣滀负绗簩涓瓙闈㈡澘,绾靛悜鏄剧ず)
  function lobbyLabelHost(row) {
    ensureLobbyLayout(row);
    return row;
  }

  function transLabelId(sig) {
    return "LCTTrans" + hashString(sig);
  }

  function getTransLabel(row, sig) {
    // 娣遍亶鍘嗘壘璇戞枃鏍囩(HUD 琛屾寕鍦?MessageContents 涓?鏅€氳鎸傚湪 MessageBody 涓?缁熶竴浠庤鏍规壘)
    return findChild(row, transLabelId(sig));
  }

  // HUD 琛岃瘧鏂囨寕杞界偣:MessageContents(ChatBubble 姝ｄ笅鏂?銆?  // 鐞嗙敱:娓告垙 CSS 纭 MessageContents 鏄?flow-children:down,璇戞枃浣嶇疆纭畾鍦ㄦ皵娉′笅鏂?
  // 鐩存帴鎸?ChatBubble 浼氳繘妯悜娴?姘旀场+澶村儚+璇戞枃骞舵帓),璇戞枃琚尋鍒版皵娉″彸渚у閮ㄧ湅涓嶆竻銆?  function hudLabelHost(row) {
    const contents = findChild(row, MESSAGE_CONTENTS_ID);
    if (contents) return contents;
    return findClass(row, HUD_BUBBLE_CLASS) || row;
  }

  // 璇戞枃鏍峰紡鍏ㄩ儴鐢?CSS 绫绘帶鍒?鏅€氳 .LCTTranslation / HUD .LCTTranslationHud / 澶у巺 .LCTTranslationLobby,
  // 閿欒鎬?.LCTTranslationError 鍙犲姞)銆備笉鍐嶇敤鍐呰仈鏍峰紡瑕嗙洊鈥斺€斿唴鑱斾紭鍏堢骇楂樹簬绫?
  // 浼氭妸 HUD(10px/220px/鍙冲榻?鍜屽ぇ鍘?4px/380px)鐨勫樊寮傚寲鏍峰紡鍐叉帀(2026-08-15 绉婚櫎)銆?
// HUD 椤舵爮鑱婂ぉ鏄?Valve 鍐呯疆甯冨眬(citadel_hud_top_bar_chat),涓嶄細 include lingua_chat.vcss_c,
// 娉ㄥ叆鐨勮瘧鏂?label 鍗充娇濂?.LCTTranslationHud 绫讳篃鍙栦笉鍒版繁钃濆簳 -> 杩愯鏃堕€€鍖栨垚閫忔槑搴曠櫧瀛椼€?// 鍏滃簳:瀵?HUD 璇戞枃鐩存帴鍐欏唴鑱旀牱寮?娣辫摑搴曠櫧瀛?,涓嶅彈 CSS 浣滅敤鍩熼檺鍒躲€?// 鏅€氳/澶у巺浠嶇敤 class,杩欓噷鍙 hud 琛屽唴鑱?涓嶇牬鍧忓畠浠殑宸紓鍖栨牱寮忋€?function applyHudInlineStyle(label) {
  try {
    // 涓?.LCTTranslation(鏅€氬璇濇琛屽唴璇戞枃)閫愬睘鎬т竴鑷?缁熶竴 HUD 椤舵爮姘旀场澶栬
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

// 閫氱敤鍐呰仈鏍峰紡(= .LCTTranslation 鏅€氳亰澶╄瘧鏂?,渚涙祴璇曟诞灞傜瓑闇€瑕?鍜屾櫘閫氳亰澶╂爮瀹屽叏涓€鑷?鐨勫満鍚堜娇鐢ㄣ€?// 涓?applyHudInlineStyle 鍖哄埆:杩欓噷涓嶅亣璁?HUD 灏忔皵娉″鍣?max-width/margin 涓庢櫘閫氳亰澶╀竴鑷淬€?function applyUniversalInlineStyle(label) {
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
    // 娣峰悎娑堟伅(鍙炕璇戜簡鐗囨):鍘熸枃鍚腑鏂囬儴鍒?蹇呴』淇濇寔鍙
    const isMixed = fragment !== null && fragment !== undefined;
    // HUD 琛?璇戞枃 label 鎸傚埌 MessageContents(ChatBubble 姝ｄ笅鏂?;澶у巺琛?琛屽唴瀹逛笅鏂?鏅€氳:MessageBody 涓?    const body = hud ? hudLabelHost(row) : (lobby ? lobbyLabelHost(row) : (findClass(row, MESSAGE_BODY_CLASS) || row));
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
    // 鍙樉绀鸿瘧鏂囨ā寮?闅愯棌鍘熸枃銆傛贩鍚堟秷鎭笉鎶樺彔(鍘熸枃鍚湭缈昏瘧鐨勪腑鏂囬儴鍒?鎶樺彔浼氳鍐呭娑堝け)
    // HUD 椤舵爮琛?澶у巺琛屼笉鎶樺彔:姘旀场鏈韩鐭殏鏄剧ず,鎶樺彔浼氳繛璇戞枃涓€璧烽殣钘?    if (!isMixed && !hud && !lobby && State.cfg.displayMode === "translation_only") {
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
      label.text = "鈿?缈昏瘧澶辫触: " + String(message || "鏈煡閿欒").slice(0, 120);
    } catch (e) {}
    // 缈昏瘧澶辫触娓告垙鍐呭彲瑙?妗ョ姸鎬佸渾鐐归棯鐑侀粍鑹?鎻愰啋鐜╁褰撳墠缈昏瘧涓嶅伐浣?    flashBridgeFail();
  }

  // 婊氬姩鍥炴敹閲嶅缓:宸茬炕璇戣繃鐨勮閲嶆柊鍑虹幇鏃?浠庣紦瀛樻仮澶嶈瘧鏂?缂撳瓨鎸?textKey 褰掍竴鍖栭敭瀛樺彇)
  function restoreFromCache(row, sig, textKey) {
    const cached = State.cache.get(textKey);
    if (!cached) return false;
    if (getTransLabel(row, sig)) return true;
    injectTranslation(row, sig, cached.translation, cached.fragment);
    return true;
  }

  // ================= 缈昏瘧闃熷垪涓庢ˉ鎺?=================

  // 2026-10-31:娓告垙鍐呰缃潰鏉垮凡绉婚櫎鈥斺€斾富鏂囦欢寮曠敤鐨勯潰鏉垮叏灞€鍑芥暟鍦ㄦ鍏滃簳銆?  // 闈㈡澘鍏冪礌涓嶅瓨鍦ㄦ椂鑷劧绌烘搷浣?灏嗘潵闈㈡澘鏂囦欢鎭㈠鍔犺浇,鍏?exportGlobal 鐪熷疄鐜拌鐩栬繖浜涘厹搴曘€?  function fieldValue(id) {
    try {
      const el = findChild(getRoot(), id);
      return el ? safeText(el) : "";
    } catch (e) { return ""; }
  }
  function setSelectText(id, text) {
    try {
      const el = findChild(getRoot(), id);
      if (el) el.text = String(text);
    } catch (e) {}
  }
  function setToggleText(id, val) {
    try {
      const el = findChild(getRoot(), id);
      if (el) el.text = val ? "ON" : "OFF";
    } catch (e) {}
  }
  function closeSelectMenus() {}
  function labelFor(options, value) {
    // 鍏滃簳鐗?闈㈡澘鏂囦欢涓嶅啀鍔犺浇;鏌ヨ〃杩斿洖 key,涓嶅懡涓洖閫€鍘熷€?绛惧悕涓庨潰鏉跨湡瀹炵幇涓€鑷?銆?    try {
      const arr = options || [];
      for (let i = 0; i < arr.length; i += 1) {
        if (arr[i] && arr[i].value === value) return String(arr[i].key || arr[i].value || "");
      }
    } catch (e) {}
    return String(value || "");
  }

  function targetLanguage() {
    // 闈㈡澘閲岄€夌殑鐩爣璇█浼樺厛;閫変簡鑷畾涔夊垯鐢ㄨ嚜瀹氫箟杈撳叆妗嗙殑鍊?    let lang = State.cfg.targetLanguage || "zh-Hans";
    if (lang === "custom") {
      lang = fieldValue("LCTTargetLangCustom") || "zh-Hans";
    }
    return lang;
  }

  // 鍙戦€佺洰鏍囪瑷€(澶勭悊鑷畾涔?
  function resolveOutgoingTarget() {
    // 2026-10-31 璇勫淇(conc-1/conc-5):convar 浼樺厛鈥斺€斿弻涓婁笅鏂囦笅,宸垎搴旂敤鍙戠敓鍦?    // 鎷夊彇鐨勪笂涓嬫枃,鍙︿竴涓婁笅鏂囩殑 State.cfg.outgoingTarget 婊炲悗 60-120s;
    // convar(lct_ui)鏄叏灞€鍏变韩鐨?saveUiConfig 鍦ㄥ樊鍒嗗簲鐢ㄦ椂绔嬪嵆鍐欏叆鈥斺€斿畠鏄敮涓€
    // 鐨勮法涓婁笅鏂囨柊椴滄簮銆傚悓涓婁笅鏂囨椂 convar==State.cfg,椤哄簭鏃犲洖閫€椋庨櫓銆?    try {
      if (typeof Convars !== "undefined" && Convars.GetStr) {
        const raw = Convars.GetStr(UI_CONVAR, "");
        if (raw) {
          const j = JSON.parse(raw);
          if (j && typeof j.outgoingTarget === "string" && j.outgoingTarget) return j.outgoingTarget;
        }
      }
    } catch (e) {}
    let lang = State.cfg.outgoingTarget || "en";
    if (lang === "custom") {
      lang = fieldValue("LCTOutgoingTargetCustom") || "en";
    }
    return lang;
  }

  // 褰掍竴鍖栨枃鏈敭:鍚屼竴鍙ヨ瘽(椤舵爮 HUD 琛屼笌宸︿笅鑱婂ぉ琛屼袱澶勬覆鏌?鍏变韩鍚屼竴缈昏瘧浠诲姟涓庣紦瀛樸€?  // key = 鍗犱綅鏇挎崲鍚庣殑璇锋眰鏂囨湰(_transText 鎴栨暣鍙?+ 鐩爣璇█;鍚屽師鏂?鈫?鍚屽崰浣嶄覆 鈫?蹇呯劧鍚岄敭銆?  // sig(channel+sender+text)淇濈暀涓嶅姩,缁х画璐熻矗琛岀骇鍘婚噸涓庡洖鏀跺鐢ㄥ垽瀹氥€?  function makeTextKey(record) {
    return String(record._transText || record.text || "") + "\x00" + targetLanguage();
  }

  function enqueue(row, sig, record, mixedFrag) {
    // 娣峰悎娑堟伅:浠诲姟閲岀殑 record 鐢ㄦ祬鎷疯礉,鍙妸寰呰瘧鐗囨褰撲綔 text(瀹屾暣鍘熸枃鎸傚湪 mixedFullText)
    const jobRecord = mixedFrag === null
      ? record
      : Object.assign({}, record, { text: record._transText || record.text });
    const job = {
      kind: "chat", row: row, sig: sig, record: jobRecord, attempts: 0,
      nameMap: record._nameMap || null, zhNameMap: record._zhNameMap || null,
      mixedFullText: mixedFrag === null ? null : (record.text || null),
    };
    // in-flight 鍚堝苟:鍚?textKey 鍙彂涓€娆℃ˉ璇锋眰,缁撴灉鍥炴潵鎵囧嚭娉ㄥ叆鎵€鏈夊悓鏂囪
    // (涓よ甯稿湪鍚屼竴杞鍛ㄦ湡琚壂鍒?姝ゅ鎶婂悎骞剁獥鍙ｆ彁鍓嶅埌鍏ラ槦閭ｄ竴鍒?璺ㄨ疆璇㈢獥鍙ｇ敱 textKey 缂撳瓨鍏滀綇)
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
    // 瓒呮椂鍏滃簳:缈昏瘧瓒呰繃 OUTGOING_TIMEOUT_MS 鏈繑鍥?鎸夊師鏂囧彂閫?閬垮厤鐢ㄦ埛绛夊緟/閲嶅鎸夐敭銆?    // 璁℃椂鏀惧湪 dispatchJob(浠诲姟鐪熸寮€濮嬪鐞嗘椂),鎺掗槦绛夊緟涓嶈鍏モ€斺€?    // 鍚﹀垯杩炵画蹇€熷彂 3 鏉℃椂,绗?3 鏉¤繕鍦ㄦ帓闃熷氨宸茶秴鏃?鐩存帴鍙戝師鏂囥€?    // (done 鍙厑璁歌Е鍙戜竴娆?姝ｅ父杩斿洖鎴栬秴鏃?璋佸厛鍒拌皝鐢熸晥)
    let settled = false;
    const once = function (translated, detected) {
      if (settled) return;
      settled = true;
      done(translated, detected);
    };
    // 缈昏瘧鍓嶅崰浣嶆浛鎹?淇濇姢鑻遍泟/鐗╁搧鍚嶄笉琚炕璇慉PI鎰忚瘧
    const _ng = replaceGameNames(text, null); // outgoing:淇濈暀鑻辨枃鍘熷悕涓嶇炕璇?    let sendText = _ng.nameMap ? _ng.text : text;
    // 鍙屽悜:鍑虹珯涔熶繚鎶や腑鏂囨父鎴忓悕(涓枃鐜╁鈫掕嫳鏂囩帺瀹跺満鏅?
    let outgoingZhNameMap = null;
    const _outTgt = resolveOutgoingTarget();
    if (!_outTgt.toLowerCase().startsWith("zh")) {
      const _zg = replaceChineseGameNames(sendText, ZH_TO_EN);
      if (_zg.zhNameMap) { sendText = _zg.text; outgoingZhNameMap = _zg.zhNameMap; }
    }
    State.queue.push({ kind: "outgoing", row: null, sig: null, record: { text: sendText }, attempts: 0, done: once, enqueuedAt: nowMs(), nameMap: _ng.nameMap || null, zhNameMap: outgoingZhNameMap, originalText: text });
    // 闃熷垪绛夊緟姝荤嚎(2026-10-28):鎺掗槦瓒?15s 浠嶆湭娲惧彂(濡傚崟妲借闀垮崰鐢?鐩存帴鎸夊師鏂囧彂閫併€?    // 鏃ф鏌ョ偣鍦?dispatchJob 寮€澶粹€斺€旀帓鐫€闃熸案杩滆疆涓嶅埌 dispatch,妫€鏌ュ舰鍚岃櫄璁?10-28 涓婂崍 gg 鍏ㄧ伃鐨勬垚鍥犱箣涓€)銆?    const queuedJob = State.queue[State.queue.length - 1];
    const queueDeadline = nowMs() + 15000;
    const queueWatch = function () {
      const idx = State.queue.indexOf(queuedJob);
      if (idx === -1) return; // 宸茶娲惧彂鎴栫Щ闄?dispatchJob 鐨勮秴鏃舵帴鎵?      if (nowMs() < queueDeadline) { try { $.Schedule(1.0, queueWatch); } catch (eQ) {} return; }
      const i2 = State.queue.indexOf(queuedJob);
      if (i2 !== -1) { State.queue.splice(i2, 1); log("outgoing: queued >15s (slot starved), sending original"); once(null, null); }
    };
    try { $.Schedule(1.0, queueWatch); } catch (eQ) {}
    pumpQueue();
  }

  function enqueueBridge(op, data, done, isRead) {
    // read:btipc07 鐨?get 璇锋眰搴旂瓟鍙兘姣斿垎鐗囪繕澶?鍏ㄩ噺璇枡),蹇呴』璧?50s 璇绘绾?    // 鑰屼笉鏄啓姝荤嚎 8s,鍚﹀垯棣栧彂璧疯窇绔炴€佷竴鐑у氨瓒呮椂(鍚?op=config 璇荤殑鑰佸潙)銆?    // _cfgPoll:閰嶇疆鐩戝惉杞 鈥斺€?澶辫触涓嶈鍏?https 閫氶亾鍒ゆ(瑙?demoteToBtipc)銆?    // 鏍囪璧?State.cfgPollNext 鑰屼笉鏄姞褰㈠弬:bridgePost/enqueueBridge 鐨勭鍚嶈
    // lc_btipc07_guard 閽夋(淇″皝鎶樺彔璇箟),涓嶈兘鏀瑰舰鐘躲€?    State.queue.push({
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
      // 2026-10-04 瀹炶溅:pumpQueue:1928 鎶涜繃涓€娆?鈥斺€?閿欒娑堟伅涓虹┖銆佹爤閲屾病鏈?      // dispatchJob 甯?= 鎶涘湪璋冪敤鐐规湰韬?銆傛鍒绘Ы浣嶅凡 +1,鑰?dispatchJob 鑷繁鐨勬敹灏?      // (finishJob / failJob,鍐呭惈銆屽噺妲?+ 閲嶆车銆?涓€娆￠兘娌¤窇鍒般€侻AX_ACTIVE_REQUESTS=1
      // 鏄崟妲?鈫?妲戒綅姘镐箙鍗犳 鈫?while 鏉′欢姘稿亣 鈫?鍑虹珯闃熷垪浠庢涓嶅啀娲惧彂浠讳綍浠诲姟銆?      // 瀹炶瘉:11:26:25 鎶涗竴娆?姝ゅ悗 bridge.log 鍐嶆棤 op=config / op=translate /
      // target=(鍙墿 echo鈥斺€旇蛋 btipcSend 涓嶇粡鏈槦鍒椻€斺€擥C銆両MG-HIT);console.log 閲?      // `loaded v` 鍙嚭鐜?1 娆?鈫?鑴氭湰娌￠噸杞借繃銆丼tate 娌￠噸寤?妲戒綅涓€鐩存病杩樺洖鏉ャ€?      // 閾佸緥:dispatchJob 鐨勪换浣曞悓姝ュ紓甯搁兘蹇呴』鍦ㄨ繖閲岃ˉ璁拌处,缁濅笉鍏佽娉勬紡妲戒綅銆?      let _threw = null;
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
          // 閲嶆姇鐢ㄥ欢杩熸车,涓嶅師鍦拌嚜鏃?鍘熷洜瑙佷笅鏂?btipc05c 娉ㄩ噴)
          State.queue.unshift(job);
          $.Schedule(RETRY_DELAY_SECONDS, pumpQueue);
        } else {
          // 缁撶畻鍚庝涪寮?鍑虹珯鎸夊師鏂囧彂(缁濅笉鍚炵敤鎴锋秷鎭?,妗ュ洖 {ok:false},chat 鏀惧紑鍘婚噸
          log("dropping job after " + job.attempts + " dispatch throws: kind=" + job.kind +
              (job.op ? " op=" + job.op : ""));
          try {
            if (job.kind === "outgoing") {
              job.done(null, null);
            } else if (job.kind === "bridge" && typeof job.done === "function") {
              job.done({ ok: false, error: "dispatch_threw:" + _err.slice(0, 80) });
            } else if (job.kind === "chat" && job.sig) {
              try { State.seen.delete(job.sig); } catch (e2) {}
              // 涓?doneFail 鍚屽洜:鍙斁寮€ seen 涓嶅,inflight 鍍靛案缁勪細璁╁悓鏂囨湰姘歌繙涓嶅啀缈昏瘧
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
      // btipc05c:dispatchJob 鑻ヨ蛋浜嗐€岃浣嶉噸鎶曘€?job 宸?unshift 鍥為槦棣栥€乤ctiveRequests
      // 宸插噺鍥?,蹇呴』绔嬪埢閫€鍑哄惊鐜?鈥斺€?鍚﹀垯 while 浼氭妸鍚屼竴涓?job 鍐?shift 鍑烘潵鍘熷湴鑷棆,
      // 鎶婇噸鎶曟鏁板湪 <1ms 鍐呮墦婊″苟鎸備笂绛夐噺鐨?$.Schedule(0.5) 寤惰繜娉?娉ㄩ噴 L2310 璇寸殑
      // 銆屽師鍦拌嚜鏃嬫妸娆℃暟鎵撴弧銆嶅氨鏄畠)銆傚疄杞?btipc05b 涓€灞€鍒峰嚭 requeue 娲按
      // (鍗曠 74 琛?脳 澶氭鐖嗗彂)鈫?console.log 娑屽 鈫?妗?tail 杩戒笉涓?鍥炲０ REQ 杩?      // 7~24s 鎵嶈澶勭悊)鈫?8s 鍥炲０姝荤嚎鍐呮敹涓嶅埌 鈫?CRC 椋庢毚 + bridge offline;
      // 鍚屾寚鏍囧湪 btipc05 涓婁竴灞€涓?0銆?      if (job._btipcDeferred) {
        job._btipcDeferred = false;
        break;
      }
    }
  }

  // 闈㈡澘瀵艰埅鍩哄潃:https 闈㈡澘閫氶亾琚帰閽堝垽娲诲悗鐢?https,鍚﹀垯缁存寔 http(鏃ч潰鏉垮厹搴曡矾寰勫師鏍蜂繚鐣?銆?  // 璧?localhost 鑰岄潪 127.0.0.1 鏄洜涓鸿瘉涔?SAN 涓ゆ潯閮芥湁,浣?localhost 姝ｆ槸寮曟搸鑷甫鐨?  // 鍙椾俊涓绘満鍚嶅彛寰?寮曟搸鑷繁鐨?WebKit 瀵?localhost 鍙︽湁澶勭悊),灏戜竴涓彉閲忋€?  // forceHttp=true 鐢ㄤ簬"https 涓嶅彲鐢ㄨ€?BTIPC 鍙堟伆濂芥帴涓嶄笅"鐨勯偅娆″厹搴?鈥斺€?閭ｆ椂瀹佸彲鎱?
  // 涔熶笉鑳芥妸鍘熸枃鐩存帴鍙戝嚭鍘汇€?  function panelBaseUrl(forceHttp) {
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

  // HTML 妗ラ潰鏉?蹇呴』鍦?chat.xml 閲岀敤 <HTML id="LCTBridgePanel"> 澹版槑,
  // 杩欓噷鍙仛鏌ユ壘;杩愯鏃?$.CreatePanel("HTML",...) 涓嶄細寰楀埌鍙敤鐨?HTML 闈㈡澘銆?  function ensurePanel() {
    if (!State.panelDead && isValid(State.panel) && typeof State.panel.SetURL === "function") return State.panel;
    // BUGFIX 0.1.3:闈㈡澘鏇惧け鏁?瀵艰埅澶辫触鏍囪),寮哄埗閲嶆柊鏌ユ壘,閬垮厤缂撳瓨姝婚潰鏉?    State.panel = null;
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

  // 鐩磋繛妗?GET /api/v1/*,缁?$.AsyncWebRequest)銆?  // 鑳屾櫙:HTML 闈㈡澘鏂规鍦ㄨ繛缁鑸椂浼氬け鏁?绗竴鏉℃垚鍔?鍚庣画 SetURL 瀵艰埅鍙兘涓嶈Е鍙?  // title 鏇存柊,瀵艰嚧"鍑犳潯娑堟伅鍚庣炕璇戝け鏁?娴嬭瘯鍗′綇/鍙戦€佸墠缈昏瘧涓嶅彲鐢?)銆?  // $.AsyncWebRequest 鏄紩鎿庣骇 HTTP API(chat_translator 鐗堟湰楠岃瘉鍙敤),姣忔潯璇锋眰鐙珛,鏃犲鑸珵浜夈€?  function buildApiUrl(job) {
    const base = "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/api/v1/";
    if (job.kind === "bridge") {
      // data 宸茬敱 bridgePost 鍋氳繃 encodeURIComponent,杩欓噷涓嶈兘鍐嶆缂栫爜,
      // 鍚﹀垯鏈嶅姟绔?URLSearchParams 鍙В鐮佷竴娆?JSON.parse 浼氬け璐?鏃ュ織/閰嶇疆淇濆瓨涓㈠け)
      return base + job.op + "?d=" + (job.data || "{}");
    }
    const text = encodeURIComponent(job.record.text);
    const target = encodeURIComponent(job.kind === "outgoing" ? resolveOutgoingTarget() : targetLanguage());
    // provider 涓嶄紶:鐢辨ˉ鎸?config.json 鐨?provider 鎵ц(璁剧疆闈㈡澘淇濆瓨鎴栨墜鏀?config.json 鍧囩敓鏁?
    // 閬垮厤娓告垙渚?State.cfg.provider 涓庢ˉ涓嶅悓姝ュ鑷?OpenAI/DeepSeek 閰嶇疆涓嶇敓鏁?
    // 鏄惧紡浼?timeoutMs:鍑虹珯缈昏瘧鐢?OUTGOING_TIMEOUT_MS(闀挎枃鏈?DeepSeek 闇€瑕佹洿涔?,
    // 鏅€氱炕璇戠敤鐢ㄦ埛閰嶇疆,閬垮厤妗ョ鍏堜簬娓告垙渚ф斁寮?鍚﹀垯棣栨闀挎枃鏈細"鍙戝師鏂?浜屾鎵嶅彂璇戞枃")
    const tm = job.kind === "outgoing" ? OUTGOING_TIMEOUT_MS : (State.cfg.timeoutMs || 12000);
    return base + "translate?text=" + text + "&source=auto&target=" + target + "&timeoutMs=" + tm;
  }

  // 寮曟搸绾?HTTP GET 灏佽(瓒呮椂鍏滃簳,settled 闃插弻瑙﹀彂)
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
      // Panorama 鏃?setTimeout 鏃剁敤 $.Schedule 鍏滃簳(绉掔骇;settled 淇濊瘉鍗曟)
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
    // 鐪熷疄寮曟搸 API(chat_translator 鍚屾):$.AsyncWebRequest(url, {type:"GET", timeout}) 杩斿洖 Promise<string>
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
    // 鍏滃簳:SendRequest 鍥炶皟椋庢牸(浠呮ā鎷熸祴璇?鏃у紩鎿?
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

  // 缁熶竴妗ュ搷搴斿鐞?鐩磋繛閫氶亾涓?HTML 闈㈡澘 fallback 鍏辩敤)
  function handleBridgePayload(job, payload) {
    if (job.kind === "outgoing") {
      // 宸茶秴鏃?done+finishJob 宸茬敱瓒呮椂鍥炶皟瀹屾垚,杩欓噷鐩存帴閫€鍑?      if (job._timedOut) return;
      if (job._timeout) { cancelSched(job._timeout); job._timeout = null; }
      if (payload && payload.ok && payload.translation) {
        // 杩樺師鍗犱綅绗?鑻遍泟/鐗╁搧鍚?
        let translation = job.nameMap ? restoreGameNames(payload.translation, job.nameMap) : payload.translation;
      // 鍙屽悜:杩樺師涓枃鍚嶅崰浣嶇
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

  // ---- 浼犺緭閫氶亾鎺㈡祴 ----
  // 褰撳墠 Deadlock 鐗堟湰宸茬Щ闄?$.AsyncWebRequest(鍑芥暟浠嶅瓨鍦?浣嗚皟鐢ㄥ嵆鍚屾鎶?  // "AsyncWebRequest has been removed"),鍙敤 typeof 妫€鏌ヤ細璇垽鍙敤,瀵艰嚧姣忔
  // 璇锋眰閮藉け璐ャ€佹ˉ姘歌繙鏄剧ず绂荤嚎銆傚惎鍔ㄥ悗瀹為檯璋冪敤涓€娆℃帰娴?
  //   - 鍚屾鎶涘紓甯?  -> 涓嶅彲鐢?鍥為€€ HTML 闈㈡澘閫氶亾(SetURL + document.title 杞)
  //   - 杩斿洖 Promise -> 鍙敤,璧扮洿杩?GET(寮曟搸鍐呯疆缈昏瘧鍣ㄥ悓娆剧敤娉?
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
          // 鍚炴帀鎺㈡祴缁撴灉(妗ユ湭鍚姩鏃?Promise 浼?reject,閬垮厤鏈鐞?rejection)
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

  // 鐩磋繛閫氶亾鐨勪紶杈撳眰閿欒(寮曟搸绉婚櫎 API / 鍚屾寮傚父):鎹㈡垚 HTML 闈㈡澘閫氶亾閲嶈瘯鎵嶆湁鎰忎箟;
  // 妗ユ湭鍚姩/瓒呮椂绛変笟鍔℃€уけ璐ヤ笉绠?缁х画璧扮洿杩炲嵆鍙€?  function isTransportError(err) {
    const s = String(err || "");
    return s === "http_exception" || s === "no_asyncwebrequest" || s.indexOf("removed") !== -1;
  }

  // 闈㈡澘閫氶亾鏄惁澶勪簬"鍒ゆ鍐峰嵈"涓?鍐峰嵈鍐?dispatchViaPanel 鐩存帴璧?!panel 鍒嗘敮蹇€熷け璐?
  // 鏃笉鍐?SetURL 瀵艰埅,涔熶笉鍐嶆墦 `bridge nav failed` 姝婚摼鏃ュ織(姝ゅ墠姣?15s 涓€鏉″埛灞?銆?  function panelNavSuppressed() {
    return State.navDeadUntil > nowMs();
  }

  // ===== https 闈㈡澘閫氶亾:澶辫触鍒嗙被銆侀檷绾т氦鎺ャ€佸紑鏈烘帰閽?2026-10-15)=====
  // 閫氶亾绾уけ璐ュ垎涓ょ被,杩欎釜鍖哄垎鍐冲畾浜?璇ヤ笉璇ラ噸鍋?,鏄湰娈典唬鐮佺殑鍏ㄩ儴瑕佺偣:
  //   纭け璐?閫氶亾鍘嬫牴娌￠€?鈥斺€?椤甸潰浠庢湭鍔犺浇(SetURL 琚紩鎿庢嫆:璇佷功鏈彈淇?/ Steam 娌￠噸鍚?銆侀潰鏉挎壘涓嶅埌銆?  //     瀵艰埅鎶涘紓甯搞€佹ˉ绂荤嚎銆傝姹?*浠庢湭鍒拌揪妗?*,鎶?job 鍘熸牱浜ゅ洖 BTIPC 閲嶅仛闆堕闄?涓斾笉娑堣€?  //     job.attempts(瀹冧笉鏄炕璇戝け璐?銆?  //   杞け璐?閫氶亾閫氫簡浣嗚繖娆℃病鎴?鈥斺€?bridge_timeout / timeout / bad_bridge_payload銆傞〉闈?alive 涓?  //     fetch 宸插彂鍑?鍙槸鎱㈡垨瑙ｆ瀽涓嶄簡;閲嶅仛绛変簬鎶婄敤鎴峰凡绛変簡 OUTGOING_TIMEOUT_MS 鐨勫嚭绔欒姹傚啀鎷?  //     3~27s(BTIPC 浣嶆车),鎵€浠?*涓嶉噸鍋?*:浜ゅ洖 handleBridgePayload 鎸夋棦鏈夎涔夌粨绠?鍑虹珯鍙戝師鏂?銆?  const PANEL_HARD_FAIL = {
    bridge_nav_failed: 1,
    bridge_offline: 1,
    bridge_load_failed: 1,
    bridge_panel_unavailable: 1,
  };
  // 閽╁瓙缁熶竴鍏ュ彛:鎶?try/catch 涓庢棩蹇楁尅鍦ㄨ皟鐢ㄦ柟鐨勭儹璺緞涔嬪銆?  // 涓轰粈涔堝繀椤昏繖鏍?dispatchViaPanel 鐨勩€?panel 蹇€熷け璐ャ€嶅垎鏀湁涓€鏉℃姢鏍?  // (lc_panel_nav_guard銆屽喎鍗村唴蹇€熷け璐ヤ笉鎵撴棩蹇椼€?鏂█璇ュ垎鏀唴闆?log 鈥斺€?閭ｆ潯鍒嗘敮
  // 姣?15s 灏卞彲鑳借蛋涓€娆?閲岄潰浠讳綍 log 閮戒細鍙樻垚姝婚摼鍒峰睆銆傞挬瀛愰噷宸茬粡瑕佹墦鏃ュ織,
  // 鎵€浠ヤ笉鑳借璋冪敤鐐瑰嚭鐜?log 瀛楁牱銆?  function handOff(hooks, payload) {
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

  // 杩欐潯 job 鏄惁褰?https 闈㈡澘閫氶亾绠°€?  // 鍙帴绠′袱鏉＄炕璇戣矾寰?outgoing/chat)鈥斺€?瀹冧滑鎵嶆槸寤惰繜鐨勬潵婧?config/test/log 涓変釜 op
  // 鐣欏湪鍘熻矾(BTIPC 宸茬ǔ瀹氬彲鐢?,涓嶆嬁瀹冧滑鐨勫彲鐢ㄦ€у幓鍐掗櫓銆?  function httpsPanelTakes(job) {
    if (!HTTPS_PANEL_ENABLED) return false;
    if (State.httpsPanelOk !== true) return false;
    if (job.kind === "outgoing" || job.kind === "chat") return true;
    // 2026-10-15 璧?op=save/test/log/璇?鍏ㄦ帴杩涙湰閫氶亾,鏍瑰洜鍚屼竴:澶ц浇鑽?vs 浣嶆车 10B/甯?淇濆瓨 600B鈮?8s>8s 姝荤嚎蹇呯偢)銆?    // 閫氶亾鍒ゆ鏃跺叏閮ㄥ師鏍蜂氦鍥?BTIPC銆?    if (job.kind === "bridge") return true;
    return false;
  }

  // https 闈㈡澘閫氶亾澶辫触 鈫?鎶?job 鍘熸牱浜ゅ洖 BTIPC銆傝繑鍥?true = 宸茶鎺ヨ蛋(璋冪敤鏂逛笉瑕佸啀缁撶畻)銆?  // 浜ゆ帴鍓嶅繀椤诲厛鎾ゆ帀闈㈡澘璺緞鎸傜殑鍑虹珯瓒呮椂鍙ユ焺,鍚﹀垯瀹冪◢鍚庤Е鍙戜細浜屾 job.done/finishJob,
  // 鎶?MAX_ACTIVE_REQUESTS=1 鐨勬Ы浣嶈秴鍙?杩欐鏄?0.1.3 閭ｄ釜"鍙戜腑鏂囧崱姝?浜嬫晠鐨勫悓娆炬満鍒?銆?  function demoteToBtipc(job) {
    if (!BTIPC_ENABLED) {
      log("demote: BTIPC off (community bridgeless) 鈥?hash failed, job settles to original text");
      return false;
    }
    try {
      if (job._timeout) { cancelSched(job._timeout); job._timeout = null; }
      // 宸茶秴鏃剁殑鍑虹珯 job 涓嶅啀浜ゆ帴:鐢ㄦ埛宸茬粡绛夊埌浜嗗厹搴曟椂鍒?鍐嶆嫋 3~27s 鏄噣鎹熷け銆?      if (job._timedOut) return false;
    } catch (e) {
      log("https panel demote: timer cleanup threw " + expErr(e));
    }
    // 閰嶇疆杞鐨勫け璐ヤ笉绠楅€氶亾鐥?棰戠巼鏄炕璇戠櫨鍊?涓€娆℃姈鍔ㄤ笉璇ラ檷绾ф暣涓細璇?:杩欒疆鐩存帴澶辫触,涓嶄氦鎺?BTIPC銆?    if (job && job._cfgPoll) {
      log("cfg watch: poll failed on https panel, skipping this round");
      return false;
    }
    State.httpsPanelStreak += 1;
    if (State.httpsPanelStreak < HTTPS_PANEL_DEAD_STREAK) {
      log("https panel: hard fail #" + State.httpsPanelStreak + "/" + HTTPS_PANEL_DEAD_STREAK +
        ", handing this job back to BTIPC");
      return handToBtipc(job);
    }
    // 杩炲嚮鍒扮嚎:鏈細璇濋€€ BTIPC銆傛墦涓婄‖鍒ゆ鏍囪(閲嶆帰鏄櫧鎾?;娓告垙鍐呭彧鍛婅涓€娆°€?    State.httpsPanelOk = false;
    State.httpsPanelHardDead = true;
    if (!State.httpsPanelDemotedLogged) {
      State.httpsPanelDemotedLogged = true;
      log("https panel: dead (" + State.httpsPanelStreak + " consecutive hard fails) 鈥?" +
        "falling back to BTIPC for the rest of this session. If this repeats every session, run " +
        "scripts\\gen_bridge_cert.ps1 -Trust and FULLY restart Steam (restarting the game alone is not enough).");
    }
    return handToBtipc(job);
  }

  // 浜ょ粰 BTIPC銆俹utgoingViaBtipc 杩斿洖 false 琛ㄧず BTIPC 涔熸帴涓嶄簡(busy/too_long/鐩爣璇█涓嶅畨鍏?,
  // 閭ｅ氨閫€鍥?*http** 鏃ч潰鏉块€氶亾(涓?6726 浠ユ潵鍚屾鍏滃簳):瀹佸彲鎱?涔熶笉鑳芥妸鍘熸枃鐩存帴鍙戝嚭鍘汇€?  // 娉ㄦ剰 attempts 鍦ㄤ袱娈典箣闂村凡鍏堥€€鍥?杩欓噷澶辫触涓嶅啀棰濆鎵ｃ€?  function handToBtipc(job) {
    let taken = false;
    try {
      taken = outgoingViaBtipc(job);
    } catch (e) {
      log("https panel demote: outgoingViaBtipc threw " + expErr(e));
      taken = false;
    }
    if (taken) return true;
    // BTIPC 鏄庣‘鎺ヤ笉浜?busy/too_long/鐩爣璇█涓嶅畨鍏?銆俛ttempts 涓嶅姩 鈥斺€?job 鏄粠闃熷垪
    // 鍒氬彇鍑烘潵鐨?attempts=0),鍚庨潰浜ょ粰 handleBridgePayload 鎸夊師璇箟閲嶈瘯銆?    try {
      log("https panel demote: BTIPC declined (busy/too_long) 鈥?retrying on the http panel channel");
      dispatchViaPanel(job, null, true);
      return true;
    } catch (e2) {
      log("https panel demote: http panel retry threw " + expErr(e2));
      return false;
    }
  }

  // 鎺㈤拡(鐙珛妲?:涓?State.pending 骞惰,绛夌殑鏄笉鍚屽紩鎿?I/O(CEF nav vs BTIPC 甯т紶閫?,鏃犱簤鐢ㄣ€?  function settleProbe(ok, err) {
    State.httpsPanelStreak = 0;
    State.httpsPanelOk = ok;
    if (ok) {
      State.httpsPanelHardDead = false;
      State.hashReady = true;
      State.hashBase = (State.pending && State.pending.navUrl) || State.hashBase;
      log("https panel: ALIVE (https://" + HTTPS_PANEL_HOST + ":" + HTTPS_PANEL_PORT +
        ") 鈥?translations now take one RTT instead of the BTIPC bit pump");
    } else {

      log("https panel: not usable (" + err + ") 鈥?on BTIPC; auto re-probe every " +
        Math.round(HTTPS_PANEL_REPROBE_MS / 60000) + "min, success restores https without restart");
    }
  }

  function startHttpsProbe() {
    if (!HTTPS_PANEL_ENABLED) return;
    const panel = ensurePanel();
    if (!isValid(panel) || typeof panel.SetURL !== "function") {
      State.httpsPanelOk = false;
      State.probeLastAt = nowMs();
      log("https panel: no usable HTML panel declared in chat.xml 鈥?staying on BTIPC");
      return;
    }
    ensureBridgeEvents(panel);
    // 2026-10-30 缁熶竴妲介噸鏋?鎺㈤拡鍥炲綊 State.pending(涓?job 鍚屾満鍒?鈥斺€攐nBridgeEvent 鐨?    // sawAlive/tryResolveFromText 缁撶畻鍙 State.pending,鐙珛妲藉鑷?lct-alive 涓嶈璁ゃ€?    // 3s 蹇呰Е鍙戦噸璇曘€侀噸杞介〉闈㈡潃姝?fetch 鍝嶅簲銆佺珵鎬佹亽澶辫触(10-29 23:55 瀹炶溅)銆?    startTitlePolling();
    // 闈㈡澘婵€娲?2026-10-29 琛?:涓?dispatchViaPanel 鍚屾鈥斺€擡XP-6726b 瀹炶瘉"鏂板紩鎿庝笉涓?    // 涓嶅彲瑙?闈炴縺娲婚潰鏉垮姞杞界綉椤?;10-29 鏇存柊鍚庢洿涓ユ牸,鎺㈤拡缂?Activate 浼氬鑷?    // SetURL 闈欓粯绌烘墦(src=""銆侀〉闈粠鏈紑濮嬪姞杞?,鎺㈤拡鎭?bridge_nav_failed銆?    try { panel.visible = true; } catch (e) {}
    try { panel.style.opacity = "1"; } catch (e) {}
    if (!State.panelActivated) {
      State.panelActivated = true;
      try { if (typeof panel.Activate === "function") panel.Activate(); } catch (e) {}
      try { if (typeof panel.SetFocus === "function") panel.SetFocus(); } catch (e) {}
      try { panel.RemoveClass("LCTBridgePanel"); panel.AddClass("LCTBridgePanelActive"); } catch (e) {}
      log("diag-activate: panel made visible/active before probe");
    }
    const probeUrl = PAGE_URL + "?boot=1&lang=" + gameUiLang(); // COMMUNITY: 鎺㈤拡鍗抽〉闈㈠姞杞?title 鍚?lct-alive 鍗?ALIVE
      "/bridge?op=health&id=probe&boot=1&lang=" + gameUiLang();
    // 2026-10-30 妯℃嫙鐜棣栨祴:hash 閫氶亾 base 鍦ㄦ淳鍙戝鎹曡幏鈥斺€攕ettleProbe 璇?    // State.pending.navUrl 鏃?pending 宸茬疆 null,鍘熸崟鑾疯矾寰勬案杩滄嬁绌轰覆銆?    State.hashBase = probeUrl;
    // 瀵圭収鎺㈤拡(2026-10-29):http 鐨?Image 鍔犺浇涓?https 椤甸潰鍔犺浇璧颁笉鍚屽垽瀹氳矾寰勨€斺€?    // IMG-HIT 鍒版ˉ = CEF 缃戠粶娲?闂鍦?https/璇佷功/title);涓嶆潵 = CEF 瀵瑰鍔犺浇鍏ㄦ(寮曟搸绾?銆?    // 妗ユ棩蹇?IMG-HIT id=p<seq> 鍗充负璇佹嵁銆?    try {
    } catch (eI) {}
    try {
      panel.SetURL(probeUrl);
      log("https panel: probing " + probeUrl);
    } catch (e) {
      settleProbe(false, "seturl_threw(" + expErr(e) + ")");
      return;
    }
    // 缁熶竴妲?鎺㈤拡浣滀负 pending 鎸傝浇,onBridgeEvent/pollTitle/瓒呮椂鍏ㄨ蛋閫氱敤璺緞
    setPending("probe", function (payload) {
      settleProbe(!!(payload && payload.ok), String((payload && payload.error) || (payload && payload.ok ? "ok" : "no_reply")));
    }, HTTPS_PANEL_PROBE_SECONDS * 1000);
    try { if (State.pending) State.pending.navUrl = probeUrl; } catch (eNU) {}
  }

  // 寮€鏈洪鎺?+ 鍒ゆ鍚庨噸鎺㈢粺涓€鍏ュ彛(涓诲惊鐜瘡鎷嶈皟鐢?鎸夌姸鎬佽妭娴?
  function maybeProbeHttpsPanel() {
    if (!HTTPS_PANEL_ENABLED) return;
    if (State.pending || State.httpsPanelOk === true) return; // 鎺㈤拡=涓€娆?pending 鍗犵敤,绌洪棽鎵嶅彂璧?閫氶亾鍋ュ悍鍒欐棤浜?    if (State.httpsPanelHardDead) return; // 杩愯鏃惰繛鍑荤‖鍒ゆ(璇佷功绾ф晠闅滃珜鐤?:閲嶆帰鏄櫧鎾?淇濇寔 BTIPC
    if (State.httpsPanelOk === false && nowMs() - State.probeLastAt < HTTPS_PANEL_REPROBE_MS) return;
    State.probeLastAt = nowMs();
    startHttpsProbe();
  }

  // HTML 闈㈡澘閫氶亾:SetURL 瀵艰埅 /bridge 椤甸潰,杞 document.title 璇诲洖
  // (AsyncWebRequest 琚Щ闄ょ殑娓告垙鐗堟湰鍞竴鍙敤閫氶亾;DLCT 鍚屾鏈哄埗)
  // hooks 鍙€? { onHardFail(payload) -> true } 琛ㄧず"杩欐潯鎴戞帴璧颁簡,鍒啀缁撶畻"銆?  // https 闈㈡澘閫氶亾鐢ㄥ畠鎶婇€氶亾绾уけ璐ヤ氦鍥?BTIPC;涓嶄紶灏辨槸 6726 浠ユ潵鐨勫師鏍疯涓恒€?  function dispatchViaPanel(job, hooks, forceHttp) {
    // 鍐峰嵈鏈?navDeadUntil)鏄?**http 闈㈡澘閫氶亾**鐨勫垽姝荤粨璁?鍙鍘嬪埗 http 瀵艰埅銆?  // https 闈㈡澘閫氶亾蹇呴』缁曞紑瀹?寮曟搸鍏堣繃璇佷功鏍￠獙銆佸啀璋堝姞杞?涓よ€呭垽姝绘潯浠朵簰涓嶇浉骞?
  // 鑰?config/test/log 杩欎笁涓?op 鑷充粖浠嶈蛋 http 闈㈡澘,瀹冧滑鍦ㄥ綋鍓?build 涓婂繀鐒惰繛鎾?  // src="" 鑰屾妸 http 閫氶亾鎵撹繘鍐峰嵈 鈥斺€?鑻ヤ笉缁曞紑,涓€娆?http 鍒ゆ灏变細椤烘墜鎶?*鑳界敤鐨?*
  // https 閫氶亾涓€璧峰帇鎺?10 鍒嗛挓,鑰屼笖鐥囩姸鏋侀殣钄?鏃ュ織閲屽彧鏈?http 鐨勬閾捐褰?銆?  const navSuppressedFor = (hooks) => (hooks && hooks.httpsChannel ? false : panelNavSuppressed());
  const panel = navSuppressedFor(hooks) ? null : ensurePanel();
    if (!isValid(panel) || typeof panel.SetURL !== "function") {
      // 閫氶亾鍘嬫牴涓嶅彲鐢?鑻ヤ笂灞?https 闈㈡澘閫氶亾)澹版槑瑕佹帴绠¤繖绉嶅け璐?浜ゅ嚭鍘昏蛋 BTIPC銆?      // 娉ㄦ剰杩欓噷鍙兘璋?handOff:鍐呰仈鐨?try/catch 鎴栨棩蹇楀瓧鏍烽兘浼氱牬鍧忎笂闈㈤偅鏉℃姢鏍?      // (瀹冩槸鎸夋簮鐮佹枃鏈壂杩欎釜鍒嗘敮鐨?娉ㄩ噴閲屽啓鍑烘潵涔熺畻鏁?銆?      if (handOff(hooks, { ok: false, error: "bridge_panel_unavailable" })) return;
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
    ensureBridgeEvents(panel);
    // EXP-6726b:鐤戜技鏂板紩鎿庝笉涓衡€滀笉鍙/闈炴縺娲烩€濋潰鏉垮姞杞界綉椤?璇婃柇 act=0 涓旈〉闈粠鏈姞杞?銆?    // 瀵艰埅鍓嶆妸闈㈡澘缃负鍙 + 灏濊瘯婵€娲?棣栨鎴愬姛鍚庝繚鎸?涓嶅弽澶嶅垏鎹?銆?    try { panel.visible = true; } catch (e) {}
    try { panel.style.opacity = "1"; } catch (e) {}
    if (!State.panelActivated) {
      State.panelActivated = true;
      try { if (typeof panel.Activate === "function") panel.Activate(); } catch (e) {}
      try { if (typeof panel.SetFocus === "function") panel.SetFocus(); } catch (e) {}
      try { panel.RemoveClass("LCTBridgePanel"); panel.AddClass("LCTBridgePanelActive"); } catch (e) {}
      log("diag-activate: panel made visible/active before nav");
      // EXP-6726d/e/f:寮曟搸鏃犲紓姝?HTTP API(AsyncWebRequest 宸茬Щ闄?,閫氶亾鍙兘鏄?闅愯棌闈㈡澘+title 鍥炵▼";
      //   Image 闈㈡澘鎺㈤拡淇濈暀浣滈€氶亾鏃佽瘉(妗ユ棩蹇?IMG-HIT = 閫氶亾娲?銆傝瘉鎹?docs/btipc-https-v1.md
      try {
        const imgUrl = "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/test.png?id=f" + (State.imgProbeCount = (State.imgProbeCount || 0) + 1);
        let imgPanel = null;
        try { imgPanel = findChild(getRoot(), "LCTImgProbe"); } catch (eI0) {}
        if (!isValid(imgPanel)) { try { imgPanel = $.CreatePanel("Image", getRoot(), "LCTImgProbe"); } catch (eI1) {} }
        if (isValid(imgPanel) && typeof imgPanel.SetImage === "function") {
          try { imgPanel.SetImage(imgUrl); } catch (eI3) {}
        }
      } catch (eI) {}
      // EXP-6726h 灏哄鍥炶鎺㈤拡宸蹭笅绾?缁撹鏄?涓嶅彲瑙侀潰鏉夸笉鍙備笌甯冨眬,灏哄淇￠亾涓嶉€?,
      // 涓庢湰 mod 鐨勯€氶亾璁捐鏃犲叧(閫氶亾璧?HTML 闈㈡澘 + document.title),鐣欑潃鍙埛 30 琛屾棩蹇?      // 涓斾細鍦ㄥ乏涓婅闂竴涓?133x77 榛戝潡銆?    }
    // 鍑虹珯缈昏瘧瓒呮椂璁℃椂浠庢鍒?寮€濮嬪鐞?绠楄捣;鎺掗槦绛夊緟涓嶈鍏?    if (job.kind === "outgoing") {
      // Panorama 鏃犳爣鍑?setTimeout(8/6 宕╂簝鏍瑰洜),鐢?$.Schedule(鍗曚綅绉?;done 鏈?once 淇濇姢,瓒呮椂涓庣粨鏋滆皝鍏堝埌璋佺敓鏁?      job._timeout = $.Schedule(OUTGOING_TIMEOUT_MS / 1000, function () {
        // BUGFIX 0.1.3:瓒呮椂蹇呴』鍚屾椂閲婃斁闃熷垪妲戒綅+娓?pending,鍚﹀垯妲戒綅鍗″埌 15s 瓒呮椂,
        // 鏈熼棿鎵€鏈夌炕璇戣姹傛帓闃熷牭姝?= 鐢ㄦ埛鐪嬪埌鐨?鍙戜腑鏂囧崱姝?涔嬪悗鍏ㄥけ鏁?銆?        job._timedOut = true;
        if (State.pending && State.pending.id === job.id) {
          State.pending = null;
          State.polling = false; // pollTitle 涓嬫璋冨害鏃跺彂鐜版棤 pending 鑷劧鍋滄
        }
        job.done(null, null);
        finishJob();
      });
    }
    // hash 鍛戒护閫氶亾(2026-10-29,QOL 4.0.5 瀹炶瘉鏋舵瀯):椤甸潰甯搁┗,SetURL 鍙彉 fragment
    // (鍚?base#frag = 鍚屾枃妗ｅ鑸?hashchange 涓嶉噸杞?鈥斺€攏av 鍋跺彂澶辫触/watch 椤舵帀/
    // 椤甸潰閲嶈浇鏃忛棶棰樹粠鏋舵瀯涓婃秷澶便€傚紓甯歌嚜鍔ㄥ洖閫€涓嬫柟 nav 妯″紡(鐜版湁浠ｇ爜鍏ㄤ繚鐣?銆?    // 2026-10-30 淇?鏉′欢鍘绘帀 hooks.httpsChannel 瑕佹眰鈥斺€攅nqueueBridge 璺緞鐨?job
    // (config/gamenames/quickchat)涓嶅甫璇ユ爣璁?婕忔帀浼氬鑷村畠浠蛋 nav 閲嶈浇椤甸潰銆?    // 鐮村潖椤甸潰甯搁┗(01:54 瀹炶溅:hash 妯″紡寤虹珛鍚庤 gamenames sync 鐨?nav 鎵撴柇)銆?    if (State.hashReady && State.hashBase && !forceHttp) {
      // 2026-10-30 妯℃嫙鐜棣栨祴:hash 鍒嗘敮鍏堜簬 buildBridgeUrl 鎵ц,job.id 灏氭湭璧嬪€?
      // JSON.stringify 浼氭妸 undefined 鐨?id 涓㈡帀 鈫?椤甸潰闈欓粯鎷掓敹 鈫?浣滀笟蹇呰秴鏃躲€?      if (!job.id) job.id = "r" + (++State.requestSeq).toString(36);
      const payload = {
        q: "h" + (++State.hashSeq) + "_" + nowMs(),
        id: job.id,
        op: job.kind === "bridge" ? job.op : "translate",
        d: job.kind === "bridge" ? (function () { try { return JSON.parse(decodeURIComponent(job.data) || "{}"); } catch (eD) { return {}; } })() :
           { text: (job.record && job.record.text) || "", source: "auto",
             targetLanguage: job.kind === "outgoing" ? resolveOutgoingTarget() : targetLanguage(),
             timeoutMs: job.kind === "outgoing" ? OUTGOING_TIMEOUT_MS : (State.cfg.timeoutMs || 15000) },
      };
      log("hash dispatch: ctx=" + State.ctxId + " flat=" + State.cfg.outgoingTarget +
        " d.targetLanguage=" + ((payload.d && payload.d.targetLanguage) || "-") + " mode=" + (State.cfg.outgoing || "-"));
      setPending(job.id, function (payload2) {
        // hash 瓒呮椂杩炲嚮(2026-10-30):椤甸潰甯搁┗鏃犳柊 lct-alive,3s nav 澶辫触鍒ゅ畾宸茶烦杩?        // (sawAlive 棰勭疆);杩炵画 2 娆¤秴鏃?鈫?hashReady=false 鍥?nav 妯″紡(寮曟搸闄嶇骇淇濋櫓)銆?        // 闄嶇骇銆愰潤榛樸€戔€斺€旀鍥炶皟浣撳湪 lc_panel_nav_guard 鐨勯浂 log 鐑矾寰勬柇瑷€鑼冨洿鍐?
        // 闄嶇骇鍚庢帰閽堢殑 not usable 鏃ュ織澶╃劧鍙,涓嶄涪鍙娴嬫€с€?        if (payload2 && !payload2.ok && (payload2.error === "timeout" || payload2.error === "bridge_timeout")) {
          State.hashFailStreak = (State.hashFailStreak || 0) + 1;
          if (State.hashFailStreak >= 2) {
            State.hashReady = false;
            State.hashFailStreak = 0;
          }
        } else {
          State.hashFailStreak = 0;
        }
        if (isPanelHardFail(payload2) && handOff(hooks, payload2)) return;
        handleBridgePayload(job, payload2);
      }, job.kind === "outgoing" ? OUTGOING_TIMEOUT_MS : (State.cfg.timeoutMs || 15000));
      // 椤甸潰甯搁┗:hash 璇锋眰鍚庢棤鏂?lct-alive,蹇呴』璺宠繃 3s nav 澶辫触鍒ゅ畾(鍝嶅簲鐢?deadline/鍒拌揪缁撶畻)
      try { if (State.pending) State.pending.sawAlive = true; } catch (eSA) {}
      try { if (State.pending) State.pending.navUrl = null; } catch (eNU) {}
      // 2026-10-30 妯℃嫙鐜棣栨祴:姝ゅ垎鏀師鍏堝彧 setPending 涓嶅鑸?椤甸潰姘歌繙鏀朵笉鍒?      // hash,浣滀笟蹇呰秴鏃惰繛鍑婚檷绾?hash 閫氶亾浠庢湭鎺ョ嚎)銆傜湡姝ｆ妸璇锋眰閫佸埌甯搁┗椤甸潰:
      try {
        const hp = ensurePanel();
        if (isValid(hp) && typeof hp.SetURL === "function") {
          hp.SetURL(State.hashBase + "#LCTQ:" + encodeURIComponent(JSON.stringify(payload)));
        }
      } catch (eHU) {}
      return; // 鍝嶅簲缁?pollTitle 鐜版湁瑙ｆ瀽(LCT+id+JSON 鏍煎紡涓嶅彉)
    }
    const url = buildBridgeUrl(job, forceHttp);
    setPending(job.id, function (payload) {
      // 閫氶亾绾уけ璐?璇佷功鏈彈淇?闈㈡澘姝?妗ョ绾?鈫?浜ゅ洖 BTIPC 閲嶅仛,涓嶆秷鑰?attempts銆?      // 杞け璐?bridge_timeout/timeout)涓嶄氦鎺?璇锋眰宸茬粡鍒版ˉ,閲嶅仛鍙槸鎶婄瓑寰呯炕鍊嶃€?      if (isPanelHardFail(payload) && handOff(hooks, payload)) return;
      handleBridgePayload(job, payload);
    }, job.kind === "outgoing" ? OUTGOING_TIMEOUT_MS : (State.cfg.timeoutMs || 15000));
    // 璁颁綇鏈瀵艰埅鐨?URL:鍋跺彂"寮曟搸娌″姞杞介〉闈?鏃惰鑳藉師鍦伴噸璇曚竴娆?    // (瑙?pollTitle 鐨?navRetried 鍒嗘敮 鈥斺€?閲嶈瘯 1.5s 姣旈檷绾?BTIPC 鐨?6.6s 渚垮疁寰楀)
    try { if (State.pending) State.pending.navUrl = url; } catch (eNU) {}
    // DIAG-6726:璁板綍姣忔瀵艰埅鐩爣(鍘?query 涓?閬垮厤鍒烽暱鏂囨湰),纭璇锋眰纭疄鍙戝嚭
    State.diagNavCount = (State.diagNavCount || 0) + 1;
    if (State.diagNavCount <= 5 || State.diagNavCount % 20 === 0) {
      // d= 鏄暣浠借姹?JSON(璁剧疆闈㈡澘淇濆瓨鏃跺惈 API Key)銆傝繖閲屾寜鍊兼墦鐮?
      // 涓嶇暀"闈犳埅鏂暱搴︿繚瀹夊叏"鐨勪綑閲?鈥斺€?浣欓噺浼氳瀛楁椤哄簭/鏈嶅姟鍟嗗悕闀垮害鐨勫彉鍖栧悆鎺夈€?      var navQ = String(url.split("?")[1] || "");
      // **蹇呴』鎸夊弬鏁拌竟鐣屾壘 d=**(?d= 鎴?&d=),涓嶈兘 indexOf("d=") 鈥斺€?閭ｄ細鍛戒腑 "id=" 閲岀殑
      // 閭ｄ釜 d=(2026-10-15 瀹炶溅韪╄繃:鏃ュ織閲屽嚭鐜?"id=<redacted 2B>&op=config&d=%...",
      // id 鐨勫€艰鎵撶爜浜嗐€佺湡姝ｇ殑 d= 鍙嶈€屾病鎵撲笂,鍙槸纰板阀琚笅闈?30 瀛楃鎴柇鎸′綇)銆?      // 鍚屼竴涓潙鎴戝湪 redactUrl 閲屽凡缁忎慨杩囦竴娆″苟鍐欎簡娉ㄩ噴,杩欓噷鍙堝啓浜嗕竴閬?鈥斺€?      // **鏁欒鍐欒繘娉ㄩ噴涓嶇瓑浜庣敤涓婁簡,澶嶅埗绮樿创鑷繁鐨勪唬鐮佷篃瑕侀噸璇讳竴閬嶃€?*
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

  // ===== 鈶?涓婂眰鏁村悎:鍑虹珯缈昏瘧璧?BTIPC(瑙勬牸 docs/btipc-v1.md 搂7/搂8;checklist 搂14)=====
  // btipc04 鎵╁睍:鍏ョ珯 chat 鍚岃矾澶嶇敤 鈥斺€?chat 鍙戣８鏂囨湰(妗ュ洖閫€鍑虹珯澶栫殑榛樿 target=zh-Hans),
  // 鍑虹珯鍙戜俊灏併€傚嚱鏁板悕淇濈暀 outgoing(璋冪敤鏂?鏃ュ織鍓嶇紑鎸?kind 鍖哄垎:outgoing btipc / chat btipc)銆?  // 淇″皝(涓婂眰绾﹀畾,琛?甯?绐楀彛鍗忚闆舵敼鍔?:payload 棣栬 "t=<target>;tm=<ms>" + "\n" + 鍘熸枃銆?  // 鐩爣璇█蹇呴』闅忚姹傝蛋:妗?config 鐨?defaults.targetLanguage 鏄叆绔欑洰鏍?zh-Hans),
  // 鍑虹珯 outgoingTarget 榛樿 en,涓嶅甫灏变細璇戝弽鏂瑰悜銆?  // 杩斿洖 true = 鏈?job 鐢?BTIPC 鎺ョ(缁撶畻鍦ㄥ洖璋冨唴闂幆);false = 鍥炶惤鏃ч€氶亾(鐩磋繛/HTML 闈㈡澘)銆?  // 澶辫触璇箟瀵归綈鏃ч€氶亾(spec 搂8 + 鏃㈡湁 attempts 绛栫暐):鍝嶅簲鍨嬪け璐?妗ユ敹鍒拌姹備絾缈昏瘧澶辫触,绌?END 甯?  // 鈫?translate_error)璧?handleBridgePayload 閲嶈瘯 鈮? 娆?浼犺緭鍨嬪け璐?timeout/crc_dead/bridge_down)
  // 鎸夊師鏂囧彂閫佷笉閲嶈瘯;busy/too_long/鐩爣璇█涓嶅畨鍏?鈫?鍥炶惤鏃ч€氶亾銆?
  // ---- 鍐?浠ュ強 log 鎵?鐨勬绾?鎸変笂琛岃浇鑽风畻,涓嶆寜鍥哄畾鍊?----
  // 2026-10-15 鏁欒(鐢ㄦ埛瀹炴満銆孫penAI 鐨?API 鑰佹槸淇濆瓨涓嶄笂銆?:鍘熸潵鍐欐 8000 鏄寜"鍐欏簲绛?1 甯?瀹氱殑,
  // **鍙噺浜嗗簲绛?娌￠噺璇锋眰鏈韩**銆備綅娉佃€楁椂鍑犱箮鍏ㄥ湪涓婅:姣忓抚鏈夋晥杞借嵎 10B銆乼Close=600ms銆侀鍙戣捣璺?  // 1200ms 鈫?甯?Key 鐨勪繚瀛樿浇鑽?鈮?00B = 60 甯?鈮?37.2s,8s 姝荤嚎蹇呯劧 REQ_TIMEOUT 鈫?闈㈡澘鏄剧ず銆屼繚瀛樺け璐ャ€嶃€?  // 瀹炴祴甯ц€楁椂鍚诲悎(47B=4.2s 鈥?406B=26.1s,璇樊<0.5%)銆傛墍浠?鎸夊抚鏁扮畻"鐗╃悊涓嬮檺",鍐嶅彔鍔犱綑閲忕粰 CRC
  // 閲嶈瘯涓?STORM 缃氭椂(瀹炴祴绾?+15~20%);灏忚浇鑽蜂繚鐣?8000 鍦版澘(蹇€熷け璐ュ灏忚姹備粛鎴愮珛)銆?  // 鎺ㄥ涓庨€愭潯瀹炴祴瑙?docs/btipc-v1.md 搂8銆?  function btipcWriteDeadlineMs(payloadBytes) {
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
      // btipc04:鍏ョ珯 chat 涔熻蛋 BTIPC 鈥斺€?瑁告枃鏈?涓嶅甫淇″皝)鈫?妗ュ洖閫€ config 榛樿
      // target(鍏ョ珯 zh-Hans),涓嶄緷璧栨父鎴忎晶浠?9/30 璧峰氨鍚屾涓嶅埌鐨?State.cfg;
      // 鍑虹珯浠嶅甫 t= 淇″皝(target 蹇呴』闅忚姹傝蛋,鍚﹀垯妗ユ寜榛樿璇戝弽鏂瑰悜)銆?      const isChat = job.kind === "chat";
      // btipc05:璁剧疆闈㈡澘銆屼繚瀛?娴嬭瘯銆? 寮€鏈鸿閰嶇疆(op=config/test)鍚岃矾杩佺Щ 鈥斺€?      // 鏃ч€氶亾 6726 鍚庡繀姝?杩欎笁涓搷浣滄槸鐢ㄦ埛鍞竴鑳界洿鎺ユ劅鐭ョ殑銆岄潰鏉垮潖浜嗐€嶃€?      const isOp = job.kind === "bridge" && (job.op === "config" || job.op === "test" || job.op === "log");
      tag = isOp ? job.op + " btipc" : (isChat ? "chat btipc" : "outgoing btipc");
      if (BTIPC.busy()) {
        // 鏃ч€氶亾 6726 鍚庡凡姝?蹇欐椂涓嶇珛鍒诲洖钀?鐭瓑閲嶆姇(鈮? 娆?脳0.5s / 12s 姝荤嚎;
        // btipcFinish 鐨?deadman 蹇呮竻蹇欐€?銆傞噴鏀炬Ы浣嶄絾涓嶅悓姝ラ噸娉?finishJob 浼氬悓姝?        // pumpQueue 鈫?鍘熷湴鑷棆鎶婃鏁版墦婊?蹇呴』璧?$.Schedule 寤惰繜娉?銆傜瓑涓嶅姩鎵嶅洖钀姐€?        if (!job._btipcSince) job._btipcSince = nowMs();
        const since = job.enqueuedAt || job._btipcSince;
        const waited = job._btipcWaits || 0;
        // btipc05b:op 涓嶅啀 12s 灏辨斁寮?鈥斺€?闃熷ご鑻ユ槸涓€娆?24s 鐨勯厤缃,12s 鏀惧純浼?        // 鎺夎繘蹇呮鏃ч€氶亾(panel_channel_unavailable 鍋囧け璐?銆俹p 绛夋弧璇绘绾?2s 缂撳啿;
        // chat/outgoing 缁存寔 12s/6 娆?鍏滃簳璇箟涓嶅彉)銆?        // btipc05d:璇绘绾?35s鈫?0s,蹇欑瓑绐楀悓姝?37s鈫?2s(鍚﹀垯 op 绛夊埌 37s 灏辨帀鏃ч€氶亾,
        // 鍓嶉潰 50s 鐧界瓑);52s 梅 0.5s 娉?= 104 娆?涓?busyMs 鍚屾椂鍒伴《,鍏堝埌鑰呭仠銆?        const busyWaits = isOp ? 104 : 6;
        const busyMs = isOp ? 52000 : 12000;
        if (waited < busyWaits && nowMs() - since < busyMs) {
          job._btipcWaits = waited + 1;
          // btipc05c:璁╀綅鏃剁疆 _btipcDeferred 鈥斺€?pumpQueue 瑙佸埌灏?break,涓嶅啀鍘熷湴
          // 鑷棆閲?shift 鍚屼竴涓?job(瑙?pumpQueue 澶勬敞閲?銆?.5s 寤惰繜娉典粠姝ょ湡姝ｇ敓鏁?
          // op 鎵嶆槸銆岀瓑 37s銆嶈€屼笉鏄€?ms 鍐呯┖杞墦婊?74 娆°€嶃€?          job._btipcDeferred = true;
          State.queue.unshift(job);
          State.activeRequests = Math.max(0, State.activeRequests - 1);
          $.Schedule(0.5, pumpQueue);
          // 鍙棣栬 + 姣?10 娆?涓€娆?op 鏈€澶?8 琛?閬垮厤鎶?console.log 鍒锋垚娲按
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
        // 杞借嵎 = 鏃ч€氶亾鍚屾 JSON(decode job.data);test 甯?tm 璁╂ˉ绔?provider 姝荤嚎鍏堝埌,
        // config 鐬椂瀹屾垚涓嶅甫銆傛ˉ绔搷搴旀亽涓?JSON 鈫?.then 瑙ｆ瀽鍚庤蛋 handleBridgePayload
        // 鐨?bridge 鍒嗘敮(涓庢棫閫氶亾閫愬瓧娈靛悓褰?ok/config/translation/error)銆?        const raw = decodeURIComponent(String(job.data || "{}"));
        if (job.op === "test") {
          payload = "op=test;tm=" + Math.max(4000, (State.cfg.timeoutMs || 15000) - 4000) + "\n" + raw;
          timeoutMs = Math.max(State.cfg.timeoutMs || 15000, 15000);
        } else if (job.op === "log") {
          // P2(2026-10-11):鑱婂ぉ鏃ュ織杩?BTIPC 鈥斺€?鍐荤粨淇″皝鐧藉悕鍗曚笉鍚?log,棣栬 op=log 鐢辨ˉ渚?          // 璇嗗埆(bridge matchChatLogTrq)銆傝浇鑽风敱 flushChatLog 鎸?600B 鍒囨壒,蹇呬笉椤?680B
          // 琛岄绠?椤朵簡浼氳惤姝绘棫閫氶亾)銆傛壒涓庝繚瀛樺悓閲忕骇 鈫?姝荤嚎鍚屾牱鎸夎浇鑽风畻(鍘熷啓姝?8000,
          // 涓?config 鍐欏悓涓€涓敊:鍙噺浜嗗簲绛旀病閲忎笂琛?600B/60 甯у疄娴?鈮?7s vs 8s 姝荤嚎)銆?          payload = "op=log\n" + raw;
          timeoutMs = btipcWriteDeadlineMs(btipcUtf8Bytes(payload).length);
        } else {
          // btipc05b:璇?鍐欐绾垮垎绂汇€傝搴旂瓟 maskCompact 鈮?00B=40 甯?脳 鐪熸満 600ms/甯?鈮?4s 鈥斺€?          // 鍘?8s 蹇呰秴鏃?瀹炶溅 config FAIL 34 杩炶触鐨勬牴鍥?;鍐欏簲绛斿凡鐦﹀埌 {ok:true}(9B/1甯р増3s)缁存寔蹇€熷け璐ャ€?          // btipc05c:姝?`else` 鏇捐璇垹 鈫?op=config 鏁村潡璺宠繃銆乸ayload 鍋滃湪 undefined 鈫?          // btipcUtf8Bytes(undefined).length 蹇呯偢(瀹炶溅 dispatch THREW 脳23),涓?op=test 浼氳
          // 闅忓悗鐨?config 璧嬪€艰鐩栨垚 "op=config\n{}"(娴嬭瘯鎸夐挳鍙戦敊杞借嵎)銆傚埆鍒犺繖涓?else銆?          // btipc05d:35s 鈫?50s銆?5s 瀹炴祴绾?1/3 姒傜巼瓒呮椂(棣栧彂璧疯窇绔炴€佺櫧鐑?5~6 杞?脳2.5s STORM
          // 缃氭椂 + 涓€?CRC 閲嶈瘯);50s 瑕嗙洊銆岀珵鎬?15s + 38 甯?23s + 2 娆?STORM 5s銆嶁増43s 鐨勬渶鍧忔儏褰€?          // 2026-10-15:鍐欐绾夸粠鍥哄畾 8000 鏀逛负**鎸夎浇鑽风畻**(瑙?btipcWriteDeadlineMs)銆?          // 鍘熸潵鍐欐 8s 鏄寜"鍐欏簲绛?1 甯?瀹氱殑,娌＄畻涓婅璇锋眰鏈韩瑕?61 甯?鈥斺€?甯?Key 鐨?          // 淇濆瓨蹇呯劧 REQ_TIMEOUT銆傜幇鍦?600B 杞借嵎 鈫?绾?45s,涓庤鐨?50s 鍚岄噺绾с€?          const isRead = !!job.read || String(raw).trim() === "{}";
          payload = "op=config\n" + raw;
          timeoutMs = isRead ? 50000 : btipcWriteDeadlineMs(btipcUtf8Bytes(payload).length);
        }
      } else if (isChat) {
        payload = text;
        timeoutMs = State.cfg.timeoutMs || 15000;
      } else {
        const target = resolveOutgoingTarget();
        // 淇″皝瑕佹眰鐩爣璇█涓哄畨鍏ㄥ瓧绗﹂泦([A-Za-z0-9-],1..16):鑷畾涔夌洰鏍囪瑷€鍚叾瀹冨瓧绗︽椂
        // 鍥炶惤鏃ч€氶亾(URL 缂栫爜鏃犳闄愬埗),涓嶈妗ョ淇″皝瑙ｆ瀽澶辫触鍥為€€鎴愰敊璇柟鍚戙€?        const SAFE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-";
        let safe = target.length >= 1 && target.length <= 16;
        for (let i = 0; safe && i < target.length; i += 1) {
          if (SAFE.indexOf(target.charAt(i)) < 0) safe = false;
        }
        if (!safe) {
          log(tag + ": target unsafe (" + String(target).slice(0, 20) + "), fallback old transport");
          return false;
        }
        // tm = 妗ョ provider 姝荤嚎,姣旀父鎴忎晶 20s 姝荤嚎灏?4s:妗ュ厛缁欑粨璁?鎴愬姛甯ф垨绌?END 甯?,
        // 瀹㈡埛绔墠鏀跺緱鍒?鑰屼笉鏄弻鏂瑰悓鏃舵斁寮冦€?        payload = "t=" + target + ";tm=" + (OUTGOING_TIMEOUT_MS - 4000) + "\n" + text;
        timeoutMs = OUTGOING_TIMEOUT_MS;
      }
      const payloadLen = btipcUtf8Bytes(payload).length;
      if (payloadLen > BTIPC_REQ_MAX_PAYLOAD) {
        // spec 搂8 too_long 鏈鎸夊師鏂囧彂閫?鏃ч€氶亾鏃?680B 涓婇檺 鈫?鍥炶惤鏇翠紭,涓?J1 琛岄绠椾笉鐮?        log(tag + ": too_long " + payloadLen + "B, fallback old transport");
        return false;
      }
      let settled = false;
      // op 浠诲姟澶辫触蹇呴』浜?{ok:false,error}(鏃ч€氶亾璇箟,鐘舵€佹爮鑳芥樉绀哄叿浣撻敊璇?;
      // outgoing 浠?done(null,null) 鈫?鍙戝師鏂?job.done 鏈?once 闃查噸)銆?      // chat 娌℃湁 done 鍥炶皟(job.done 涓?undefined,璋冪敤鍙細琚?try/catch 闈欓粯鍚炴帀)鈥斺€?      // 蹇呴』灏卞湴缁撶畻 group,鍚﹀垯 State.inflight 鐣欎笅 settled=false 鐨勫兊灏哥粍:
      // 鍚屾枃鏈殑鏂拌浼氭案杩滃悎骞惰繘鍍靛案缁勩€乻een 涔熶笉閲婃斁,妗ユ仮澶嶅悗璇ユ枃鏈暣涓細璇濅笉鍐嶇炕璇?      // (瀹℃煡 2026-10-10;鏃ч€氶亾姝よ矾寰勮蛋 handleBridgePayload鈫抐ailJob鈫抎eliverError,BTCPIC 鍖栨椂婕忔帀)銆?      const doneFail = function (errCode) {
        if (isOp) { try { job.done({ ok: false, error: errCode }); } catch (e) {} }
        else if (job.kind === "chat") {
          if (job.group && !job.group.settled) {
            // 鍙娴嬫€?娓告垙鍐呭疄娴?2026-10-10):缁撶畻鐐瑰繀椤荤暀鐥?鍚﹀垯 E2E 鏃犳硶鍖哄垎
            // "璧颁簡 deliverError" 涓?"闈欓粯鍚炴帀"(淇鍓嶇殑鏍峰瓙)
            log(tag + ": settle chat group err=" + String(errCode || "btipc_fail") +
                " text=" + String((job.record && job.record.text) || "").slice(0, 40));
            try { deliverError(job.group, String(errCode || "btipc_fail")); }
            catch (e) {
              // deliverError 鑷韩寮傚父涔熻淇濊瘉涓嶇暀鍍靛案缁?settled/inflight 浜屾€佸繀椤绘敹鏁?
              try { job.group.settled = true; } catch (e2) {}
              try { if (State.inflight.get(job.group.key) === job.group) State.inflight.delete(job.group.key); } catch (e3) {}
              try { State.seen.delete(job.sig); } catch (e4) {}
            }
          } else {
            // group 宸茶鍒殑璺緞缁撶畻(濡?settle_threw 鍏滃簳):鍙斁寮€琛岀骇鍘婚噸
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
            // 鍝嶅簲鍨嬪け璐?鈫?璧版棫鐨勫搷搴斿瀷澶辫触璇箟(attempts 鈮? 閲嶈瘯,鍐呴儴鍚?requeue/finishJob)
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
      // 闃熷垪娲绘€ф绾?BTIPC 鑷韩姝荤嚎 +2s 鍏滃簳銆侭TIPC 鑻ュ洜寮曟搸寮傚父姘镐笉纭畾,
      // 杩欓噷寮哄埗缁撶畻(settled/_timedOut 缃綅鍚?杩熷埌鐨?then/catch 鐩存帴蹇界暐)銆?      // 鍚屾牱璧?afterRealMs:瀹冩瘮 BTIPC 姝荤嚎鏇撮暱,鑻ユ部鐢ㄥ崟鍙?$.Schedule 鑰岄暱寤舵椂鏃╄Е鍙?
      // 灏变細鎶㈠湪 BTIPC 姝荤嚎涔嬪墠鎶婅姹傛墦姝?鈥斺€?绛変簬鎶婄己闄?A 鎹釜鍦版柟澶嶅彂銆?      try {
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
      // 杩?request 閮芥病鍙戝嚭鍘?缁濅笉璁╁紓甯稿崱浣忓崟妲介槦鍒椼€?      // (catch 鍦?try 鍧楀,isOp/doneFail 涓嶅彲瑙?鈥斺€?灏卞湴鍒ゅ畾,璇箟涓?doneFail 涓€鑷?
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
    // 鍑虹珯缈昏瘧鎺掗槦瓒呰繃 15s 鏈疆鍒?闃熷垪琚叾浠栬姹傚崰婊?鐩存帴鍙戝師鏂?閬垮厤杈撳叆鍗℃銆?    // (鎻愬埌閫氶亾閫夋嫨涔嬪墠,缁撹涓嶅彉:鏃ч€氶亾涓嶅彲鐢ㄦ椂鍚屾牱 done(null,null) 鍙戝師鏂?鍙涓€琛屾棩蹇?
    if (job.kind === "outgoing" && job.enqueuedAt && nowMs() - job.enqueuedAt > 15000) {
      job.done(null, null);
      finishJob();
      log("outgoing dropped: queued too long, sending original");
      return;
    }
    // ---- https 闈㈡澘閫氶亾浼樺厛(2026-10-15):涓€涓?RTT 鎷挎暣鏉＄粨鏋?澶辫触鐢?demoteToBtipc 鍘熸牱浜ゅ洖 BTIPC ----
    if (httpsPanelTakes(job)) {
      dispatchViaPanel(job, {
        httpsChannel: true, // 缁曞紑 http 闈㈡澘閫氶亾鐨勫垽姝诲喎鍗?瑙?navSuppressedFor 娉ㄩ噴)
        onHardFail: function () { return demoteToBtipc(job); },
      });
      return;
    }

    // 鈶?涓婂眰鏁村悎:鍑虹珯缈昏瘧 + 鍏ョ珯 chat(btipc04)+ 淇濆瓨/娴嬭瘯/璇婚厤缃?op(btipc05)
    // 浼樺厛璧?BTIPC;鎺ヤ笉浜?too_long/鐩爣璇█涓嶅畨鍏?涔呯瓑浠嶆湭绌?鍥炶惤鏃ч€氶亾
    // (6726 鍚庡凡姝?鈫?缈昏瘧鍏滃簳鍘熸枃,op 鍏滃簳 {ok:false,error})
    const viaBtipc =
      job.kind === "outgoing" || job.kind === "chat" ||
      (job.kind === "bridge" && (job.op === "config" || job.op === "test" || job.op === "log"));
    if (viaBtipc && outgoingViaBtipc(job)) return;

    const canHttp = detectAsyncWebRequest();
    const panel = canHttp ? null : ensurePanel();
    if (!panel && !canHttp) {
      // 鍑虹珯/妗ヤ换鍔′笉閲嶈瘯:閫氶亾涓嶅彲鐢ㄧ珛鍗冲洖浼犲け璐?鍑虹珯鍒欏彂鍘熸枃),閬垮厤鎷栧欢鐢ㄦ埛鍙戞秷鎭?      if (job.kind === "outgoing") {
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
    // 鍑虹珯缈昏瘧瓒呮椂璁℃椂浠庢鍒?寮€濮嬪鐞?绠楄捣;鎺掗槦绛夊緟涓嶈鍏?    if (job.kind === "outgoing") {
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
        // Panorama 鏃?setTimeout 鏃剁敤 $.Schedule 鍏戝簳(绉掔骇;_timedOut 淇濊瘉鍗曟)
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
    // 浼樺厛:AsyncWebRequest 鐩磋繛鏈湴妗?鍙敤鏃舵渶蹇?姣忔潯璇锋眰鐙珛,鏃犲鑸珵浜?
    if (canHttp) {
      const apiUrl = buildApiUrl(job);
      const panelForFallback = panel;
      httpGetJson(apiUrl, function (payload) {
        if (job.kind === "outgoing" && job._timedOut) return;
        // 鐩磋繛浼犺緭澶辫触(寮曟搸绉婚櫎 AsyncWebRequest 绛?:鍒囨崲鍒?HTML 闈㈡澘閫氶亾閲嶈瘯
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
    // fallback:HTML 闈㈡澘瀵艰埅(AsyncWebRequest 琚Щ闄ょ殑鐗堟湰璧拌繖閲?
    dispatchViaPanel(job);
  }

  // ================= 缁熶竴妗ヨ姹傜姸鎬佹満 =================
  // 鍚屼竴鏃跺埢鍙湁涓€涓湪閫旇姹?鑱婂ぉ缈昏瘧涓茶 + 闈㈡澘鎿嶄綔浜掓枼)銆?  // 璇诲洖鍙岄€氶亾:
  //   1. HTML 闈㈡澘浜嬩欢(HTMLChangedTitle 绛?涓婚€氶亾,DLCT 鍚屾鏈哄埗)
  //   2. panel.title 杞(鍏滃簳)

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
      startedAt: nowMs(), // BUGFIX 0.1.3:璁板綍鍙戣捣鏃跺埢,鐢ㄤ簬瀵艰埅澶辫触蹇€熷垽瀹?      sawAlive: false,
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

  // 閰嶇疆鎺ㄩ€佺殑鍞ら啋鍖?"LCTW{鎸囩汗,鈥" 鈥斺€?妗ュ彨閱掗暱杞鏃剁敱椤甸潰鍐欒繘鏍囬銆?  // 蹇呴』缁?*浜嬩欢**閫氶亾鎷?panel.title 灞炴€ф槸闄堟棫鐨?瑙?onBridgeEvent 娉ㄩ噴)銆?  function onWatchPayload(raw) {
    const s = String(raw || "").trim();
    let rev = "";
    if (s.charAt(0) === "{") {
      let j = null;
      try { j = JSON.parse(s); } catch (e) {}
      if (j && typeof j.rev === "string") rev = j.rev;
    } else { rev = s; }
    if (rev && rev !== State.cfgRev) {
      // btipc11:杩欓噷**涓嶈兘**鍏堟妸 State.cfgRev 鏀规垚鏂版寚绾?鈥斺€?閭ｆ牱宸垎灏辨病鍩哄噯浜?      // (妗ヤ互涓哄鎴风宸叉槸鏈€鏂?鈫?鍥?same 鈫?閰嶇疆姘歌繙钀戒笉涓嬫潵)銆傛寚绾圭敱宸垎鍚屾钀藉湴鍚庡啀鏇存柊銆?      log("cfg watch(push): config changed (rev=" + rev + "), re-syncing");
      try {
        syncConfigDelta(function (ok) {
          log("cfg watch(push): " + (ok ? "applied (outgoing=" + State.cfg.outgoing + ")" : "sync failed"));
        });
      } catch (e) { log("cfg watch(push) THREW " + expErr(e)); }
    }
    State.watchArmed = false; // 鏀跺埌鍞ら啋 鈫?閲嶆柊鎸備竴娆￠暱杞
  }

  function onBridgeEvent(a, b, c, d) {
    // 鈶?閰嶇疆鎺ㄩ€?2026-10-20):闈㈡澘鏍囬鏄粡**浜嬩欢**閫佽揪鐨?panel.title 灞炴€ц鍒扮殑鏄檲鏃у€?    //    (鏁翠釜璇锋眰搴旂瓟閫氶亾灏辨槸杩欎箞宸ヤ綔鐨?2026-10-20 瀹炴祴:璇诲睘鎬ф案杩滆涓嶅埌鎺ㄩ€佸寘,
    //    闀胯疆璇㈡瘡 1.5s 琚噸鎸備竴娆?銆傝繖閲屾妸涓ょ鏍囬鍒嗗紑璁?
    //      "LCTW鈥?   = 妗ュ彨閱掍簡闀胯疆璇?閰嶇疆鍙樹簡)
    //      "lct-watch" = 闀胯疆璇㈤〉闈㈠凡璧锋潵銆佹鍦ㄧ瓑
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
    // 椤甸潰鍔犺浇瀹屾垚鏍囪
    const t = String(extractEventText(a) || extractEventText(b) || "");
    if (t === TITLE_ALIVE) {
      markBridgeUp();
      if (State.pending) State.pending.sawAlive = true;
      // 2026-10-30 12:40 boot 瀹炶瘉:浜嬩欢宸插埌杈?bridge online 鍗虫湰鍒嗘敮鎵撶殑),浣嗘帰閽?      // 缁撶畻鍙 pollTitle 鐨?panel.GetTitle() 灞炴€ц疆璇⑩€斺€斿睘鎬ч檲鏃ф案杩滆涓嶅埌,6s 蹇?      // 瓒呮椂銆傜粨绠楁敼浜嬩欢椹卞姩:鎺㈤拡 pending 鍦ㄦ墜鍗崇粨绠?涓?job 鐨?tryResolveFromText
      // 鍚屼竴鍝插;pollTitle 鐨勫睘鎬у垎鏀繚鐣欏厹搴?銆?      if (State.pending && State.pending.id === "probe") {
        State.navDeadStreak = 0;
        State.navDeadUntil = 0;
        State.pending = null;
        settleProbe(true, "ok");
      }
    }
  }

  function ensureBridgeEvents(panel) {
    // 鎬荤嚎娉ㄥ唽:涓€娆″嵆鍙?10-29 鍚庢€荤嚎娲惧彂宸叉,淇濈暀鍏滃簳)
    if (!State.eventsRegistered) {
      State.eventsRegistered = true;
      for (let i = 0; i < BRIDGE_EVENT_CANDIDATES.length; i += 1) {
        try {
          $.RegisterForUnhandledEvent(BRIDGE_EVENT_CANDIDATES[i], onBridgeEvent);
        } catch (e) {}
      }
      log("bridge events registered");
    }
    // 闈㈡澘涓撳睘缁戝畾:涓庢€荤嚎瀹堝崼瑙ｈ€?2026-10-30 12:20 boot 瀹炶瘉)鈥斺€攂oot() 鍏堣皟
    // ensureBridgeEvents()(鏃?panel)閿佹 eventsRegistered,鎺㈤拡璺緞甯?panel
    // 鍐嶅埌鏃惰 early-return 鎸℃,QOL 鍚屾缁戝畾浠庢湭娉ㄥ唽銆傜嫭绔嬪畧鍗?+ 鍙ˉ鎸傘€?    if (panel && typeof $.RegisterEventHandler === "function" && !State.panelBound) {
      State.panelBound = true;
      try {
        $.RegisterEventHandler("HTMLTitle", panel, onBridgeEvent);
        log("bridge: panel-bound HTMLTitle registered");
      } catch (eR) {
        log("bridge: panel-bound HTMLTitle register FAILED: " + expErr(eR));
      }
    }
  }

  // ---- 璇婃柇锛圖IAG-6726锛夛細闈㈡澘鐘舵€佸揩鐓э紝鐢ㄤ簬鍖哄垎鈥滈〉闈㈡病鍔犺浇鈥濅笌鈥滃姞杞戒簡浣嗘爣棰樿涓嶅埌鈥?  function navDiagSnapshot(verbose) {
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

  // 妗ョ姸鎬佸渾鐐?缁?鍦ㄧ嚎 / 绾?绂荤嚎(鏃犲け璐ユ椂)
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

  // 缈昏瘧澶辫触闂儊:榛勭偣鎻愮ず(妗ュ湪绾挎椂鐭殏鏄剧ず鍚庢仮澶嶇豢鑹?
  function flashBridgeFail() {
    const root = getRoot();
    const dot = root ? findChild(root, BRIDGE_DOT_ID) : null;
    if (!dot) return;
    try {
      dot.RemoveClass("LCTBridgeUp");
      dot.AddClass("LCTBridgeFail");
    } catch (e) {}
    // 3.5s 鍚庢仮澶?浠呭綋妗ヤ粛鍦ㄧ嚎鏃舵仮澶嶇豢;绂荤嚎淇濇寔绾?榛勭敱 updateBridgeDot 鍐冲畾)
    $.Schedule(3.5, function () {
      if (State.bridgeUp) {
        try {
          dot.RemoveClass("LCTBridgeFail");
          dot.AddClass("LCTBridgeUp");
        } catch (e) {}
      }
    });
  }

  // 鍑虹珯缈昏瘧澶辫触:杈撳叆妗嗘梺绾㈣壊鎻愮ず鏉?鐭殏鏄剧ず,鎻愰啋"宸插彂閫佸師鏂?)
  function showOutgoingFailTip() {
    const root = getRoot();
    const tip = root ? findChild(root, OUTGOING_FAIL_TIP_ID) : null;
    if (!tip) return;
    try {
      tip.text = "鈿?缈昏瘧澶辫触,宸插彂閫佸師鏂?;
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

  // 璁剧疆闈㈡澘鏈湴妗ョ姸鎬佽:杩愯涓?鏈繍琛?+ DMM 鐢ㄦ埛寮曞 + 鏇存柊鎻愮ず
  function updateBridgeStatusUI() {
    const root = getRoot();
    const label = root ? findChild(root, BRIDGE_STATUS_LABEL_ID) : null;
    if (!label) return;
    try {
      var statusText = State.bridgeUp ? (t("bridgeUp") + " (" + t("bridgePort") + " 8791)") : t("bridgeDown");
      // 鏈夋洿鏂版彁绀烘椂杩藉姞鍒扮姸鎬佹枃鏈?      if (State.updateMsg) statusText += "\n" + State.updateMsg;
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

  // boot 鏃舵ˉ缂哄け妫€娴?DMM 鐢ㄦ埛瑁呭畬鍙湁闈㈡澘,妗ヨ繛涓嶄笂 => 闈㈡澘鏄庣‘鎻愮ず
  function checkBridgeMissing() {
    if (State.bridgeUp) return;
    if (!State.panelWarned) warnBridgeOffline();
    updateBridgeStatusUI();
    // 30s 鍚庝粛鏈湪绾?鍐嶆彁绀轰竴娆?鐢ㄦ埛鍙兘姝ｅ湪鍚姩妗?
    $.Schedule(30.0, function () {
      if (!State.bridgeUp) updateBridgeStatusUI();
    });
  }

  function startTitlePolling() {
    if (State.polling) return;
    State.polling = true;
    $.Schedule(TITLE_POLL_SECONDS, pollTitle);
  }

  // ---- 璇婃柇(DIAG-6726):2026-09-30 娓告垙鏇存柊(6726 鐗?鍚庨潰鏉垮鑸叏澶辫触,
  // 闇€鍖哄垎 A) 椤甸潰鐪熸病鍔犺浇(panel.title 鎭掔┖) B) 椤甸潰鍔犺浇浜嗕絾鏍囬鍙樺寲璇讳笉鍒?title 涓€鐩?'lct-bridge')銆?  // 姣?20 娆¤疆璇㈤噰鏍蜂竴娆?panel.title/灞炴€?鏈夋晥鎬?閬垮厤鍒峰睆銆?  function diagTitlePoll() {
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
    // 涓婚€氶亾:椤甸潰 document.title;澶囬€?灞炴€?/ GetTitle()
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

  // 鍋跺彂"寮曟搸鍘嬫牴娌″姞杞介〉闈?(src="")鏃跺師鍦伴噸璇曚竴娆?鎴愭湰鈮? 绐楀彛,鐩撮檷 BTIPC 鏇磋吹)銆倀rue=宸查噸璇曘€佺户缁瓑銆?  function retryNavOnce(pending) {
    if (pending.navRetried || !pending.navUrl) return false;
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
    if (!pending) return;
    diagTitlePoll();
    const title = readBridgeTitle();
    if (title === TITLE_ALIVE) {
      markBridgeUp();
      if (pending) pending.sawAlive = true;
      // 瀵艰埅鐪熺殑鎴愬姛杩?=> 闈㈡澘閫氶亾鍙敤,娓呮帀鍒ゆ璁℃暟涓庡喎鍗?      State.navDeadStreak = 0;
      State.navDeadUntil = 0;
      // 鎺㈤拡(缁熶竴妲?:瑙佸埌 lct-alive 鍗虫彙鎵嬫垚鍔?boot=1 椤甸潰涓嶅彂 health 鍗曞彂),绔嬪嵆缁撶畻
      if (pending && pending.id === "probe") {
        State.pending = null;
        settleProbe(true, "ok");
        return;
      }
    } else if (title && title.indexOf(TITLE_PREFIX) === 0) {
      // 鎸?id 璺敱:缈昏瘧 job 鐨?id 鍔ㄦ€?rXX);鎺㈤拡鍥炲綊缁熶竴妲藉悗 id="probe" 涔熻蛋姝よ矾寰?      let payload = null;
      if (pending && title.indexOf(TITLE_PREFIX + pending.id) === 0) {
        try { payload = JSON.parse(title.slice((TITLE_PREFIX + pending.id).length)); } catch (e) {}
        State.pending = null;
        // 鎺掑鍛婅 + sysLang(2026-10-29):鎺㈤拡缁熶竴妲藉悗,杩欎袱涓秷璐硅窡鍝嶅簲璧?pending 璺緞
        if (payload && payload.sysLang && !State.sysLang) {
          State.sysLang = String(payload.sysLang);
          log("sysLang: " + State.sysLang + " (from bridge; UI lang auto fallback source)");
        }
        if (payload && payload.foreignPaks && payload.foreignPaks.duplicates && !State.dupWarned) {
          State.dupWarned = true;
          const dupList = (payload.foreignPaks.items || []).map(function (h) { return h.file + "(" + h.version + ")"; }).join(", ");
          log("鈿狅笍 鎺掑妫€娴? 妫€娴嬪埌 " + payload.foreignPaks.count + " 浠藉惈鏈潰鏉跨殑 vpk 骞跺瓨: " + dupList +
            " 鈥?璇峰彧淇濈暀涓€浠?鍏朵綑鏀瑰悕鎴栫粡 DMM 鍗歌浇),鍚﹀垯琛屼负涓嶅彲棰勬祴");
          setStatus("鈿狅笍 妫€娴嬪埌閲嶅瀹夎(" + payload.foreignPaks.count + " 浠?,璇锋煡鐪嬫ˉ鏃ュ織");
        }
        pending.onResult(payload || { ok: false, error: "bad_bridge_payload" });
        return;
      }
    }
    // 瀵艰埅澶辫触蹇€熷垽瀹?BUGFIX 0.1.3):3s 鍐呰繛 alive 閮芥病鍑虹幇 => 瀵艰埅澶辫触,绔嬪嵆缁撶畻鑰岄潪鍌荤瓑 15s 瓒呮椂銆?    if (!pending.sawAlive && nowMs() - pending.startedAt > BRIDGE_ALIVE_SECONDS * 1000) {
      if (retryNavOnce(pending)) {
        // 2026-10-29 琛?閲嶈瘯鍚庡悓鏍疯缁疆璇?涓?probe 鍒嗘敮鍚屾淇;瀛橀噺闈犱笅涓€涓?job 鍏ラ槦
        // 閲嶅惎寰幆鑷剤,浣嗘帰閽堟Ы鎸傝捣鏈熼棿涓?restart 鐨勫満鏅笅浼氶潤榛樻柇閾?
        $.Schedule(TITLE_POLL_SECONDS, pollTitle);
        return;
      }
      State.pending = null;
      State.panelDead = true;
      State.hashReady = false; // 闈㈡澘姝?鈫?hash 閫氶亾闅忛潰鏉垮け鏁?nav 妯″紡鎺ョ
      const snap = navDiagSnapshot();
      // 纭绛惧悕:src 涓虹┖ = 寮曟搸鍘嬫牴娌″紑濮嬪姞杞介〉闈?鍙湁杩欑鎵嶇疮璁″垽姝?鏈?src 鍙噸缃?闃插伓鍙戞姈鍔ㄨ鏉€)銆?      if (snap.indexOf('src=""') !== -1) State.navDeadStreak += 1;
      else State.navDeadStreak = 0;
      if (State.navDeadStreak >= PANEL_NAV_DEAD_STREAK) {
        State.navDeadStreak = 0;
        State.navDeadUntil = nowMs() + PANEL_NAV_COOLDOWN_MS;
        log("bridge nav: panel channel dead in this game build (SetURL never loads) | suppress nav " +
          Math.round(PANEL_NAV_COOLDOWN_MS / 60000) + "min, auto re-probe after | " + snap);
      } else if (!State.navDeadLogged) {
        // 缁嗚妭鏃ュ織鍏ㄧ▼鍙墦涓€娆?涔嬪悗杩涘喎鍗村彧鎵撲笂闈㈤偅鏉℃憳瑕?=> 姝婚摼鏃ュ織浠庢瘡 15s 涓€鏉￠檷鍒扮害 10 鍒嗛挓涓€鏉?        State.navDeadLogged = true;
        log("bridge nav failed: panel dead (no lct-alive within " + BRIDGE_ALIVE_SECONDS + "s) | " + snap);
      }
      pending.onResult({ ok: false, error: "bridge_nav_failed" });
      return;
    }
    // 瓒呮椂澶勭悊
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
    log("bridge offline: 璇峰厛鍚姩 core/bridge_server.js(鎴?StartDeadlock.bat)");
    log("diag-panel " + navDiagSnapshot(true));
    setStatus(t("bridgeOffline"));
    updateBridgeStatusUI();
    updateBridgeDot();
  }

  function handleResult(job, payload) {
    if (payload.ok && payload.translation) {
      // 杩樺師鍗犱綅绗?鑻遍泟/鐗╁搧鍚?
      let translation = job.nameMap ? restoreGameNames(payload.translation, job.nameMap) : payload.translation;
      // 鍙屽悜:杩樺師涓枃鍚嶅崰浣嶇
      if (job.zhNameMap) translation = restoreChineseGameNames(translation, job.zhNameMap);
      // 娣峰悎娑堟伅:璇戞枃鍙寘鍚潪涓枃鐗囨,鎷艰鍥炲畬鏁存枃鏈?涓枃鍘熸牱淇濈暀)
      let fragment = null;
      if (job.mixedFullText) {
        fragment = translation;
        translation = assembleMixedTranslation(job.mixedFullText, translation);
      }
      log("translated [" + (job.record.channel || "chat") + "] " + job.record.sender + ": " + translation.slice(0, 60));
      // 琛屽彲鑳藉凡琚洖鏀跺鐢?娉ㄥ叆鍓嶉€愯鏍￠獙 sig,閬垮厤鏃ц瘧鏂囪创鍒版柊娑堟伅(瑙?deliverResult)
      deliverResult(job.group, translation, fragment);
      finishJob();
    } else {
      failJob(job, payload.error || "unknown_error");
    }
  }

  // HUD 椤舵爮琛岃娓告垙蹇€熸竻鐞?澶栨潵鏋勯€犺鏃犲唴閮ㄧ姸鎬?鏃?鍦ㄩ《鏍?chat 鏍归潰鏉夸笅鎸傜嫭绔嬭瘧鏂囨诞灞?  // (涓嶆寕鍦?#Messages 涓嬨€佷笉甯?ChatMessage 绫?閬垮紑娓告垙娑堟伅娓呯悊鍣?,鏄剧ず 5 绉掑悗鑷垹銆?  function tryRecreateHudTranslation(job, translation) {
    try {
      if (job.record.channel !== "hud") return;
      resolveHudMessages();
      if (State.hudMessages.length === 0) return;
      const container = State.hudMessages[0]; // #Messages
      if (!isValid(container)) return;
      // 娴眰鎸傚湪 Messages 鐨勭埗绾?CitadelHudTopBarChat 鏍?涓?鑰岄潪 Messages 鍐?      const parent = container.GetParent ? container.GetParent() : null;
      // 闃叉姢:parent 闈㈡澘鍙兘涔熻娓告垙娓呯悊,鍒涘缓鍓嶅繀椤绘牎楠屾湁鏁堟€?鍚﹀垯 CreatePanel 浼氶棯閫€
      if (!isValid(parent)) return;
      // 闃叉姢:閬垮厤鍚屼竴鏉¤瘧鏂囬噸澶嶅垱寤哄涓诞灞?鐩稿悓 sig 宸插瓨鍦ㄥ垯璺宠繃)
      const existing = findChild(parent, "LCTOverlay-" + job.sig);
      if (isValid(existing)) {
        // 宸插瓨鍦?浠呭埛鏂版枃鏈?涓嶉噸澶嶅垱寤?        const lbl = findClass(existing, TRANS_LABEL_CLASS);
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
      // 娴嬭瘯娴眰鐢ㄤ笌鏅€氳亰澶╄瘧鏂囧畬鍏ㄤ竴鑷寸殑鏍峰紡(渚夸簬鑲夌溂鏍稿鏍峰紡鏄惁鐢熸晥),
      // 涓嶅啀濂?HUD 涓撳睘鍐呰仈(閬垮厤 '钃濆簳浣嗗拰鏅€氳亰澶╂爮涓嶄竴鏍? 鐨勫樊寮?銆?      label.AddClass(TRANS_LABEL_CLASS);
      applyUniversalInlineStyle(label);
      label.text = String(translation || "");
      // 璁板綍鍒版椿璺冩诞灞傚垪琛?鎸夊垱寤洪『搴?,鐢ㄤ簬璁℃暟涓庢竻鐞嗘渶鏃?      State.hudOverlays.push(overlay);
      State.hudOverlayCount = State.hudOverlays.length;
      log("HUD test: recreated translation overlay (original row was cleaned up)");
      // 瓒呰繃涓婇檺:鍏堟竻鐞嗘渶鏃х殑娴眰(闃插唴瀛樻硠婕?
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
      // 5 绉掑悗闅愯棌骞剁Щ闄?DeleteAsync 鍦ㄦ煇浜?Panorama 鐗堟湰涓嶅彲闈?鏀圭敤 visible=false)
      $.Schedule(5.0, function () {
        try {
          if (isValid(overlay)) {
            overlay.visible = false;
            overlay.style.visibility = "collapse";
          }
        } catch (e) {}
        // 浠庢椿璺冨垪琛ㄧЩ闄?鑻ヤ粛鍦?
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

  // 缁撴灉鎵囧嚭:鍚?textKey 鐨勬墍鏈夎(椤舵爮 HUD + 宸︿笅鑱婂ぉ)娉ㄥ叆鍚屼竴浠借瘧鏂?淇濊瘉涓ゅ鏄剧ず涓€鑷淬€?  // 琛屽凡琚父鎴忓洖鏀?澶嶇敤(sig 涓嶅尮閰?鏃朵笉娉ㄥ叆;HUD 琛岃蛋娴眰鍏滃簳(琛岀敓鍛藉懆鏈熺煭浜庣炕璇戝欢杩熺殑鑰侀棶棰?銆?  function deliverResult(group, translation, fragment) {
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
        // 璇婃柇:鏌愯宸插け鏁?娓告垙鍙兘鍦?2 绉掑唴娓呯悊浜嗛《鏍忔秷鎭)
        log("deliver skipped: row=" + (isValid(entry.row) ? "valid" : "GONE") + " sig=" + ((entry.row && entry.row.__lctSig === entry.sig) ? "match" : "MISMATCH"));
        // HUD 娴嬭瘯琛岃娓告垙娓呯悊鍚?閲嶅缓涓€鏉¤瘧鏂囨樉绀鸿(楠岃瘉閫氳矾;鐪熷疄娑堟伅琛岀敓鍛藉懆鏈熸洿闀夸笉鍙楀奖鍝?
        tryRecreateHudTranslation({ record: { channel: "hud" }, sig: entry.sig }, translation);
      }
    }
  }

  // 澶辫触/閲嶈瘯:缁熶竴鐢?failJob 閲婃斁娲诲姩妲?finishJob),閬垮厤闃熷垪鍗℃
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
        // 澶辫触鍚庡厑璁稿悓涓€鏂囨湰鍦ㄦ柊琛屼笂閲嶈瘯(鏃ц宸叉敞鍏ラ敊璇?seen 鍘婚噸涓嶅簲姘镐箙鍚炴帀閲嶈瘯)
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

  // 澶辫触鎵囧嚭:鏁寸粍鍚屾枃琛屾敞鍏ラ敊璇苟閲婃斁 seen,鍏佽鍚庣画鏂拌閲嶈瘯
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

  // ---- 鑱婂ぉ鏃ュ織(鎸夋瘮璧?ID 鍒掑垎,缁忔ˉ鍐欏叆鏈湴 logs/chat/) ----

  // 鏈€杩戝畬鏁存棩蹇楀幓閲嶇紦瀛?鏂囨湰 -> { t, isOwn }(鍓旈櫎 HUD 閲嶅琛屼笌鎸傝捣鏉＄洰鐨勯噸澶嶈褰?
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

  // 鎸傝捣鏉＄洰閿?鍚屾枃鏈?鏄惁鑷繁瑙嗕负鍚屼竴娑堟伅(绛夊緟瀛楁琛ュ叏鏈熼棿鍚堝苟)
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

  // 鎸傝捣涓€鏉″瓧娈垫湭濉厖瀹屾暣鐨勮褰?绛夊畬鏁寸増鍒拌揪鍚庝涪寮?鎴栬秴鏃跺悗鍏滃簳钀界洏(涓嶄涪娑堟伅)
  // 閲嶅鎵弿鍚屼竴琛屾椂涓嶅埛鏂伴娆℃寕璧锋椂闂?閬垮厤鎸佺画閲嶆壂瀵艰嚧姘镐笉钀界洏
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

  // 鎸傝捣瓒呰繃绛夊緟绐楀彛鐨勮褰曞厹搴曡惤鐩?姝ゆ椂閫氬父宸叉棤瀹屾暣鐗?瀹佺暀 <unknown> 涓嶆紡娑堟伅)
  // 鍏滃簳鏉＄洰涓嶅啓鍏?recentLogs:HUD 鍘婚噸鍙拡瀵?宸叉湁瀹屾暣鏅€氳褰?鐨勯噸澶嶈,
  // 閬垮厤鎶?HUD-only 蹇€熸寚浠ょ殑涓嶅悓娆¤Е鍙戣鍘婚噸
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

    // HUD 椤舵爮琛屾槸宸︿笅鑱婂ぉ琛岀殑閲嶅灞曠ず:
    // - 鍚屾枃鏈渶杩戝凡鏈夊畬鏁磋褰?-> 璺宠繃,閬垮厤 <unknown>/hud 閲嶅鏉＄洰
    // - 宸叉寕璧峰悓鏂囨湰 -> 璺宠繃(绛夊畬鏁寸増鎴栬秴鏃跺厹搴?
    // - 鍚﹀垯鎸傝捣绛夊緟琛ュ叏,閬垮厤涓庢櫄鍒扮殑瀹屾暣鏅€氳閲嶅
    if (record.hud) {
      if (recentLogHit(text, record.isOwn)) return;
      if (State.pendingLogs[pendingKey(text, record.isOwn)]) return;
      // 鑷繁鐨?HUD 娑堟伅:琛ユ湰鍦扮帺瀹舵樀绉?璁╄嫳闆?SteamID 鑳芥寜鏄电О瑙ｆ瀽
      // (浠?isOwn 鏃惰ˉ;浠栦汉娑堟伅琛ユ湰鍦版樀绉颁細閫犳垚閿欒褰掑睘)
      if (record.isOwn && (!sender || sender === UNKNOWN_NAME)) {
        const ownName = localPlayerName();
        if (ownName) record = Object.assign({}, record, { sender: ownName });
      }
      deferLog(record);
      return;
    }

    // 鏅€氳灏氭湭濉厖瀹屾暣(sender/棰戦亾閮戒负绌?:鎸傝捣绛夊瓧娈靛氨缁?    // (瀹屾暣鐗堝埌杈句細娓呮帀鎸傝捣鏉＄洰;瓒呮椂鐢?flushPendingLogs 鍏滃簳钀界洏,閬垮厤涓㈡秷鎭?
    if ((!sender || sender === UNKNOWN_NAME) && !channel) {
      deferLog(record);
      return;
    }

    // 瀹屾暣璁板綍:鍏堟竻鎺夊悓鏂囨湰鐨勬寕璧锋潯鐩?閬垮厤 <unknown> 涓庡畬鏁寸増閲嶅),鍐嶈惤鐩?    dropPending(text, record.isOwn);
    pushEntry(buildLogEntry(record));
  }

  // P2(2026-10-11):BTIPC TRQ 杞借嵎涓婇檺 680B(spec 搂9 琛岄绠?鈥斺€?鏃ч潰鏉块€氶亾鏃犱笂闄?50 鏉?  // 涓€鎵瑰彲鑳借秴闄?瓒呴檺浼氳惤姝婚€氶亾,鏃ュ織鐓т涪)銆傛寜 UTF-8 瀛楄妭鍒囨壒:淇″皝浣?+ 鍏ㄩ儴琛?鈮?00B;
  // 鍓╀綑鐣欏湪缂撳啿,鏈壒鍙戝嚭鎴愬姛鍚?1s 缁х画鎺掔┖(鎱㈡淮鐏?涓嶄笌缈昏瘧鎶㈤槦鍒?銆?  const LOG_BATCH_MAX_BYTES = 600;
  function flushChatLog() {
    State.logFlushing = false;
    flushPendingLogs(); // 瓒呮椂鐨勬寕璧锋潯鐩厛鍏滃簳杩涚紦鍐?涓€骞跺彂閫?    const lines = [];
    const overhead = btipcUtf8Bytes(JSON.stringify({ matchId: getMatchId(), lines: [] })).length;
    let bytes = overhead;
    while (State.logBuffer.length && lines.length < 50) {
      const one = State.logBuffer[0];
      let oneBytes = btipcUtf8Bytes(JSON.stringify(one)).length + 1; // + ","
      let entry = one;
      if (bytes + oneBytes > LOG_BATCH_MAX_BYTES && lines.length === 0) {
        // 鍗曟潯鍗宠秴鎵?瓒呴暱娑堟伅):鎴柇 text 鍒?300 瀛楃浠嶈秴鎵嶄涪(鏃ч€氶亾鍗曟潯涓婇檺鏈氨 2000 瀛楃)
        entry = Object.assign({}, one, { text: String(one.text || "").slice(0, 300) });
        oneBytes = btipcUtf8Bytes(JSON.stringify(entry)).length + 1;
        if (overhead + oneBytes > LOG_BATCH_MAX_BYTES) {
          State.logBuffer.shift();
          log("chat log: entry too large, dropped");
          continue;
        }
      } else if (bytes + oneBytes > LOG_BATCH_MAX_BYTES) {
        break; // 濉弧鏈壒,鍓╀綑绛変笅涓€鎵?      }
      State.logBuffer.shift();
      lines.push(entry);
      bytes += oneBytes;
    }
    if (!lines.length) return;
    bridgePost("log", { matchId: getMatchId(), lines: lines }, function (res) {
      if (res && res.ok && State.logBuffer.length) {
        // P2:缂撳啿杩樻湁鍓╀綑 鈫?1s 鍚庣户缁帓绌?姣忔壒鐙珛璧伴槦鍒?涓嶉樆濉炵炕璇?
        State.logFlushing = true;
        $.Schedule(1.0, flushChatLog);
      } else if (res && !res.ok) {
        // 澶辫触閲嶆斁涓€娆?閬垮厤涓㈡棩蹇?浠嶅け璐ュ垯涓㈠純(涓嶉樆濉炵炕璇?
        if (lines.length && !State.logBuffer.__retried) {
          State.logBuffer.__retried = true;
          State.logBuffer.unshift.apply(State.logBuffer, lines.slice(0, 20));
          $.Schedule(5.0, flushChatLog);
        }
      }
    });
  }

  // ---- 妗ュ仴搴锋帰娴?瀹氭椂 ping,鏂嚎鍚庣姸鎬佹爮鎻愮ず + 鎭㈠鍚庤嚜鍔ㄦ竻閿? ----
  // 娉ㄦ剰:health 涓庣炕璇戝叡鐢ㄤ覆琛岄槦鍒?闃熷垪蹇欐椂璺宠繃鏈 ping,閬垮厤 health 闃诲鍙戞秷鎭?娴嬭瘯

  // btipc07:涓婄嚎鍒ゅ畾浠?healthCheck 鐨?HTTP 鍥炶皟閲屾娊鍑烘潵,BTIPC 鍥炲０鎴愬姛鍗宠涓哄湪绾裤€?  // 鑰佹瘺鐥?鍥炲０鎴愬姛鍙?update btipcLastOk 灏?return 鈥斺€?鐘舵€佹爮姘歌繙鍋滃湪鍒濆鍊?
  // 鑰?gamenames / quickchat / cfgSynced 涓変釜瑙﹀彂鍣ㄦ寕鍦ㄥ繀姝荤殑 bridgePost("health") 涓?
  // 涓€娆￠兘娌℃墽琛岃繃(鍚嶇О淇濇姢涓€鐩村仠鍦ㄧ‖缂栫爜 100 鏉?璇枡浠庝笉璺熸父鎴忔洿鏂?銆?  function onBridgeAlive(src) {
    if (!State.bridgeUp) log("bridge online (" + src + ")");
    State.bridgeUp = true;
    State.bridgeOfflineSince = 0;
    setBridgeStatus(t("bridgeOnline") + " \u00b7 " + (State.cfg.provider || "bing"));
    if (!State.cfgSynced && !State.cfgSyncing) {
      // 鍚姩闂ㄥ叡鐢?once(boot 鐨勭瓑鎺㈤拡鍒嗘敮涓庤繖閲屼簰鏂?涓嶄細璧风浜屼釜寰幆)
      startCfgSync();
    }
    // 棣栨涓婄嚎:鍚嶇О淇濇姢鍏ㄩ噺鍚嶅崟 + 蹇嵎璇煶璇枡(涓ゆ寮忔彙鎵?鎸囩汗鐩稿悓鍒欎竴鏉℃暟鎹兘涓嶄紶)
    // 2026-10-16:鍒嗛」 try/catch 鈥斺€?00:22 瀹炶溅 syncViaBtipc 鍚屾鎶?涓€娆℃姏灏辨妸
    // 鍚屼竴 onBridgeAlive 閲屽悗闈㈢殑瑙﹀彂鍣ㄥ叏甯﹁蛋,涓?loading 鏍囧織鍗℃瀵艰嚧鏈細璇濅笉鍐嶈瘯銆?    if (!State.gamenamesLoaded && !State.gamenamesLoading) {
      State.gamenamesLoading = true;
      try { syncGameNames(function () { State.gamenamesLoading = false; }); }
      catch (eG) { State.gamenamesLoading = false; log("onBridgeAlive gamenames THREW " + expErr(eG)); }
    }
    if (!quickchatSynced && !State.quickchatLoading) {
      State.quickchatLoading = true;
      try { syncQuickChat(function () { State.quickchatLoading = false; }); }
      catch (eQ) { State.quickchatLoading = false; log("onBridgeAlive quickchat THREW " + expErr(eQ)); }
    }
    // provider / 鐗堟湰鏇存柊鎻愮ず:鍥炲０鍙瘉鏄庢ˉ娲荤潃,甯︿笉浜嗚繖浜涘瓧娈?鈥斺€?姣忎細璇濊ˉ涓€娆?    // (鍏堢疆浣嶉槻閲嶅叆;澶辫触鍒欏浣?涓嬩竴杞?healthCheck 鍐嶈ˉ)
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

  // 鍒ょ孩鍓嶇粰涓€娈靛闄?寮€璁剧疆闈㈡澘 / 鍒?UI 鏃剁殑鍑犵鐬柇涓嶇畻鎺夌嚎
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
    // btipc04:BTIPC 鍋ュ悍鏂伴矞鏈?45s 鍐呮湁鎴愬姛)鐢?REQ 鍥炲０(15s/娆?鏇夸唬蹇呮鐨?nav health;
    // 6726(DIAG-6726)鍚?SetURL 瀵艰埅鍏ㄧ伃 鈥斺€?nav 鍙湪 BTIPC 涔熷搼鎺?>45s 鏃犳垚鍔?鏃跺厹搴曞垽绾?
    // 鍚﹀垯姣?5s 鎵撲竴娆″繀姝荤殑 nav 鍙細鍒峰睆 + 鍫典覆琛岄槦鍒椼€傚洖澹拌蛋 REQ(translate=false),妗ョ鐜版垚銆?    if (BTIPC_ENABLED && BTIPC) {
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
              // 2026-10-12 transport 鍔犲浐:瀵瑰眬 console.log 娲嘲涓?128 浣嶇粍瑁呬涪浣?-> 杩炶触杩涢鏆?
              // 鍥炲０ 1 甯у崱鍦ㄩ鏆撮噷 8s 姝荤嚎鍏堝埌(瀹炶瘉 17:09:36 杩炶触 -> STORM -> 17:09:42 TIMEOUT,
              // 妗ヤ晶 REQ 32/32 鍏ㄦ敹鍒般€佺炕璇戝叏鎴愬姛 鈥斺€?鎷ュ涓嶆槸鎺夌嚎)銆傞鏆寸獥鍐呯殑 timeout/crc_dead
              // 闄嶄负鎷ュ鏃ュ織涓嶅垽 down,鍏嶅幓 grace 绾ц仈(canHttp 澶嶄綅 -> 姝婚€氶亾 nav 閲嶆帰娴嬪埛灞?;
              // 鐪熸帀绾?鏃犺繎鏈熼鏆?璺緞涓嶅彉銆?s 姝荤嚎涓嶆媺闀?鏃╅噴鏀惧崟妲借鎺掗槦缈昏瘧鍏堣蛋銆?              if ((kind === "timeout" || kind === "crc_dead") &&
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
      // 浼犺緭鍦ㄩ€?鍚屾鍒嗙墖 / op 璇?璇存槑妗ユ鍦ㄥ洖甯?涓嶈兘鍒ゆ;鏂伴矞鏈熷悓鐞?      if (freshH || State.btipcActive) return;
      onBridgeDown();
      return;
    }
    // long offline + panel-only channel -> reset to re-probe direct (works if game supports AsyncWebRequest)
    // 闄愭祦:澶嶄綅浼氱珛鍒昏涓嬩竴娆?detectAsyncWebRequest 鎵撳洖 false,涓嶅姞闂撮殧灏变細姣?5s 鍒蜂竴鏉″浣嶆棩蹇椼€?    if (State.bridgeOfflineSince && (nowMs() - State.bridgeOfflineSince) > BRIDGE_OFFLINE_GRACE_SECONDS * 1000 && State.canHttp === false &&
      nowMs() - State.canHttpLastProbe >= CANHTTP_REPROBE_MS) {
      State.canHttp = null;
      log("bridge channel: reset to re-probe direct (was panel-only)");
    }
    // 鍏滃簳鍒嗘敮:BTIPC 涓嶅彲鐢ㄦ椂鎵嶈惤鍒拌繖閲?6726 鍚庤閫氶亾宸叉,鐣欑潃鍙负涓嶆敼鍙樿涔?銆?    // btipc07 涔嬪悗 health 涔熸槸 op=config 鐨?get=,璧?BTIPC;涓婁笅绾垮垽瀹氱粺涓€鍦ㄤ笂闈袱涓嚱鏁伴噷銆?    bridgePost("health", {}, function (res) {
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

  // ================= 鑱婂ぉ鎵弿 =================

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
      if (!State.ctxId) State.ctxId = Math.random().toString(36).slice(2, 6); log("loaded v" + VERSION + "; watching ChatMessages [ctx=" + State.ctxId + "]");
    }
    return isValid(State.messages) ? State.messages : null;
  }

  // 鍥炴敹澶嶇敤娓呯悊:鑱婂ぉ琛岃娓告垙澶嶇敤鏃?娓呴櫎鏈?mod 娈嬬暀(鏃ц瘧鏂囨爣绛?+ 鍘熸枃鎶樺彔鏍峰紡)
  function resetRowModState(row) {
    try {
      const contents = findChild(row, MESSAGE_CONTENTS_ID);
      if (contents && contents.style) {
        contents.style.visibility = "visible";
      }
    } catch (e) {}
    // 鏀堕泦璇戞枃鏍囩鎵€鍦ㄥ鍣?鏅€氳:MessageBody;HUD 琛?MessageContents)
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
      // 6726 鏂拌涓?姘旀场鍏堝垱寤恒€佹枃鏈欢杩熷～鍏?鐢ㄦ埛鑲夌溂鍙)銆傜┖琛屽湪姝よ繑鍥?null,
      // 鑻ュ彧闈犳按浣嶇嚎+灏鹃儴琛ユ壂,burst 瓒?3 鏉″悗濉厖鐨勬枃鏈細姘镐箙婕忚瘧 鈫?鐧昏瑙傚療琛?鏂囨湰鍒拌揪鍚庣敱琛ユ壂澶勭悊
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
    // 娣峰悎娑堟伅(涓枃+灏戦噺鑻辨枃,鍏稿瀷:鑻辨枃鑻遍泟鍚嶈缃笅鐨勫揩鎹疯闊虫覆鏌撳 "鎴戠湅鍒?McGinnis"):
    // 鍙妸闈炰腑鏂囩墖娈甸€佸幓缈昏瘧,涓枃閮ㄥ垎鍘熸牱淇濈暀銆俽ecord.text 淇濇寔瀹屾暣鍘熸枃(绛惧悕绋冲畾)銆?    const mixedFrag = skipTranslation ? null : mixedFragment(record.text);
    const translatingText = mixedFrag === null ? record.text : mixedFrag;
    // 缈昏瘧鍓嶅崰浣嶆浛鎹?淇濇姢鑻遍泟/鐗╁搧鍚嶄笉琚炕璇慉PI鎰忚瘧
    const _ng = replaceGameNames(translatingText, PROTECT_TO_ZH);
    if (mixedFrag === null) {
      // 鍘熸湁璺緞:鏁村彞缈昏瘧,鍗犱綅鏇挎崲鐩存帴鍐欏洖 record.text(鏇挎崲骞傜瓑,閲嶆壂绛惧悕涓嶅彉)
      if (_ng.nameMap) { record.text = _ng.text; record._nameMap = _ng.nameMap; }
      // 鍙屽悜:涓枃娓告垙鍚嶁啋鑻辨枃鍗犱綅(鐩爣璇█闈炰腑鏂囨椂,淇濇姢涓枃鍚嶄笉琚炕璇慉PI鎰忚瘧)
      const _tgt = targetLanguage();
      if (!_tgt.toLowerCase().startsWith("zh")) {
        const _zg = replaceChineseGameNames(record.text, ZH_TO_EN);
        if (_zg.zhNameMap) { record.text = _zg.text; record._zhNameMap = _zg.zhNameMap; }
      }
    } else {
      // 娣峰悎璺緞:涓嶆敼 record.text(鏀瑰姩缂撳瓨 record 浼氳绛惧悕婕傜Щ,閲嶆壂鏃惰褰撴垚鏂版秷鎭?
      if (_ng.nameMap) record._nameMap = _ng.nameMap;
      record._transText = _ng.text; // 鍗犱綅鏇挎崲鍚庣殑寰呰瘧鐗囨
    }
    const sig = makeSignature(record);

    // 宸插鐞嗚繃鐨勮:鑻ョ鍚嶅彉鍖栬鏄庤鍥炴敹澶嶇敤,閲嶇疆澶勭悊鐘舵€?    const prevSig = row.__lctSig;
    if (row.__lctProcessed && prevSig === sig) {
      // 灏濊瘯浠庣紦瀛樻仮澶嶈瘧鏂?鑱婂ぉ婊氬姩鍥炴敹鍦烘櫙)
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
      // 娴嬭瘯琛?鐩稿悓鏂囨湰涔熷己鍒堕噸鏂扮炕璇?seen 鍘婚噸浼氬悶鎺夐噸澶嶆祴璇?
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

    // 鑱婂ぉ鏃ュ織閲囬泦(鎵€鏈夋柊娑堟伅閮借,涓嶉殢 shouldSkip 杩囨护鈥斺€旀寚浠?鑷繁鐨勬秷鎭篃瑕佺暀妗?
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
    if (count < State.scannedCount) State.scannedCount = 0; // 鑱婂ぉ娓呯┖/閲嶅缓
    let touched = false;
    if (State.scannedCount === 0 && count > BOOTSTRAP_TAIL_SCAN_LIMIT) {
      touched = processRange(messages, count - BOOTSTRAP_TAIL_SCAN_LIMIT, count) || touched;
    } else {
      touched = processRange(messages, State.scannedCount, count) || touched;
    }
    State.scannedCount = count;
    // 浣庡欢杩?姣忔棰濆鎵湯灏惧嚑鏉?鍙戦€佽€呭悕/鍐呭鍙兘寤惰繜濉厖)
    touched = processRange(messages, Math.max(0, count - LOW_LATENCY_TAIL_SCAN_LIMIT), count) || touched;
    return touched;
  }

  // ================= 澶у巺鑱婂ぉ鎵弿(hudchat.vxml) =================
  // 澶у巺/缁勯槦鑱婂ぉ瀹瑰櫒:ChatLinesPanel(鏃х増 hudchat 缁撴瀯;褰撳墠鐗堟湰鑻ユ棤姝ら潰鏉垮垯闈欓粯璺宠繃)
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
    if (count < State.lobbyScanned) State.lobbyScanned = 0; // 娓呯┖/閲嶅缓
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

  // ================= HUD 椤舵爮鑱婂ぉ鎵弿(citadel_hud_top_bar_chat) =================

  // 瑙ｆ瀽 HUD 椤舵爮鑱婂ぉ鐨?Messages 瀹瑰櫒(Team1Chat/Team2Chat 涓や釜瀹炰緥)
  // 娉ㄦ剰:CitadelHudTopBarChat 鏄潰鏉?type 涓嶆槸 class,FindChildrenWithClassTraverse 鎵句笉鍒?
  // 蹇呴』鐢ㄥ竷灞€閲屽啓姝荤殑 id(Team1Chat/Team2Chat)鏌ユ壘,class 閬嶅巻浠呬綔鍏滃簳銆?  function resolveHudMessages() {
    const root = getRoot();
    if (!root) return;
    const found = [];
    const seen = new Set(); // 鐢?Set 鍘婚噸(瀵硅薄 key 浼氳浆 [object Object] 瀵艰嚧璇垽)
    const tryAdd = (chat) => {
      if (!isValid(chat) || seen.has(chat)) return;
      const messages = findChild(chat, HUD_MESSAGES_ID);
      if (isValid(messages)) { seen.add(chat); found.push(messages); }
    };
    // 涓昏矾寰?鍥哄畾 id(娓告垙甯冨眬鍐欐)
    for (const id of HUD_CHAT_IDS) {
      tryAdd(findChild(root, id));
    }
    // 鍏滃簳:class 閬嶅巻(涓囦竴娓告垙鏀逛簡 id)
    const chats = root.FindChildrenWithClassTraverse
      ? (() => { try { return root.FindChildrenWithClassTraverse(HUD_CHAT_CLASS) || []; } catch (e) { return []; } })()
      : [];
    for (const chat of chats) tryAdd(chat);
    // 闈㈡澘鏍戝彉鍖栨椂閲嶅缓鍒楄〃(娓告垙鍙兘鍔ㄦ€佸鍒犻《鏍忚亰澶╁疄渚?
    let changed = found.length !== State.hudMessages.length;
    if (!changed) {
      for (let i = 0; i < found.length; i += 1) {
        if (found[i] !== State.hudMessages[i]) { changed = true; break; }
      }
    }
    if (changed) {
      State.hudMessages = found;
      State.hudScanned = found.map(() => 0);
      // 姣忔闈㈡澘鏍戝彉鍖栭兘鎵撳嵃(鑿滃崟 0 涓?-> 杩涘眬 2 涓?鏃ュ織鑳芥槑纭湅鍒板彂鐜版椂鏈?
      log("watching HUD top bar chat (" + found.length + ")");
    }
    // 棣栬疆 resolve 鑻?0 涓?鎵撳嵃璇婃柇(鏍归潰鏉?id/class),浠呬竴娆￠伩鍏嶅埛灞?    if (found.length === 0 && !State.hudLogged) {
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
        // 浣庡欢杩?姣忔棰濆鎵湯灏惧嚑鏉?        touched = processRange(messages, Math.max(0, count - LOW_LATENCY_TAIL_SCAN_LIMIT), count) || touched;
        State.hudScanned[i] = count;
      } catch (e) {
        // 鍗曡/鍗曞鍣ㄦ壂鎻忓紓甯镐笉搴斾腑鏂暣涓?HUD 鎵弿(闃叉涓埆闈㈡澘寮傚父瀵艰嚧椤舵爮缈昏瘧鍏ㄩ儴鍋滄憜)
        log("scanHudTopBarOnce: container " + i + " error: " + (e && e.message ? e.message : String(e)));
      }
    }
    return touched;
  }

  // 6726 寤惰繜濉厖瑙傚療琛?姣忚疆澶嶆壂鐧昏鐨勭┖琛?鏂囨湰鍒拌揪 鈫?processRow 姝ｅ父璧板叏绠＄嚎;
  // 琛屽け鏁?鍥炴敹/閿€姣?鎴栬秴鏃?鈫?鍑鸿〃銆傜┖琛屼笉浼氭薄鏌?seen/processed(鍦ㄧ鍚嶉€昏緫涔嬪墠鎷︽埅),琛ㄥ唴寰幆鏃犳硠婕?  function processPendingFill() {
    if (State.pendingFill.size === 0) return false;
    const now = nowMs();
    let touched = false;
    const dead = [];
    State.pendingFill.forEach(function (expireAt, row) {
      if (!isValid(row) || now > expireAt) { dead.push(row); return; }
      try {
        if (processRow(row)) touched = true;
        if (!row.__lctWatched) dead.push(row); // 鏂囨湰宸插埌杈惧苟琚鐞?鍑鸿〃
      } catch (e) { dead.push(row); }
    });
    for (let i = 0; i < dead.length; i += 1) State.pendingFill.delete(dead[i]);
    return touched;
  }

  // ================= 甯搁┗杞婚噺鎵撳瓧鎸囩ず鍣ㄨ瀵?exp6738 缁撹,琚姩閲囬泦)=================
  // 9/30 鏇存柊:鎵撳瓧/鍙戦€佷腑 = 鑱婂ぉ琛?MessageContents 鍐呯殑 TypingAnim(TypingDot1~3),
  // 蹇嵎璇煶涓嶄骇鐢熸琛屻€傚凡鐭?id 鐩存煡(涓嶆壂鍏ㄦ爲),鍙湪鐘舵€佺炕杞椂鎵撲竴琛?鈥斺€?  // 浠讳綍浜轰换浣曟椂鍊欐墦瀛?澶у巺/瀵瑰眬)閮戒細鑷劧鐣欒瘉,涓庢秷鎭鏃ュ織鎸夋椂闂存埑瀵硅处,
  // 涓嶉渶瑕佷笓闂ㄦ壘"鐪熶汉鎵撳瓧鐨勫灞€"銆傚凡璇佸疄鑷繁鐨勬墦瀛?3 鍛ㄦ湡鍏ㄤ腑;寰呴噰:浠栦汉鎵撳瓧鏍锋湰(骞挎挱渚?銆?  function watchTypingIndicator() {
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
    // 娉ㄦ剰:涓や釜鎵弿閮藉繀椤绘墽琛?涓嶈兘鐢?|| 鐭矾鈥斺€?    // 宸︿笅瑙掕亰澶╂湁娲诲姩鏃?scanChatMessagesOnce() 杩斿洖 true 浼氳烦杩?HUD 鎵弿
    try { watchTypingIndicator(); } catch (e) {}
    const touchedChat = scanChatMessagesOnce();
    const touchedHud = scanHudTopBarOnce();
    const touchedLobby = scanLobbyOnce();
    const touchedFill = processPendingFill();
    const touched = touchedChat || touchedHud || touchedLobby || touchedFill;
    maybeProbeHttpsPanel(); // https 鎺㈤拡:寮€鏈洪鎺?+ 鍒ゆ鍚庤妭娴侀噸鎺?鐙珛妲?涓庢湰寰幆鐨勭炕璇戣皟搴﹀苟琛?
    const hasWork = touched || State.queue.length > 0 || State.pending;
    $.Schedule(hasWork ? FAST_POLL_SECONDS : SLOW_POLL_SECONDS, scanChatMessages);
  }

  // !lcttest 娴嬭瘯鍛戒护:鍚?HUD 椤舵爮鑱婂ぉ娉ㄥ叆涓€鏉℃瀯閫犳秷鎭?涓庣湡瀹炶鍚屾瀯),
  // 璧版甯告壂鎻?缈昏瘧娴佺▼銆傛棤闃熷弸/鏃?bot 鏃堕獙璇?HUD 閫氳矾鐨勫敮涓€鎵嬫銆?  function injectHudTestMessage(text) {
    try {
      resolveHudMessages();
      if (State.hudMessages.length === 0) {
        log("HUD test: no HUD chat container found yet (in-match?)");
        return;
      }
      const container = State.hudMessages[0]; // Team1Chat 鐨?Messages
      const row = $.CreatePanel("Panel", container, "LCTTestRow" + nowMs());
      row.AddClass("ChatMessage");
      const contents = $.CreatePanel("Panel", row, "MessageContents");
      const bubble = $.CreatePanel("Panel", contents, "");
      bubble.AddClass("ChatBubble");
      const tc = $.CreatePanel("Panel", bubble, "");
      tc.AddClass("TextContainer");
      const textPanel = $.CreatePanel("Label", tc, "MessageText");
      textPanel.text = String(text);
      row.__lctTestForce = true; // 姣忔娴嬭瘯閮藉己鍒堕噸鏂扮炕璇?涓嶈 seen 鍘婚噸鍚炴帀)
      log("HUD test: injected '" + String(text).slice(0, 40) + "' into HUD chat (" + State.hudMessages.length + " containers)");
      // 鍏抽敭:琛屽彲鑳借娓告垙 1 绉掑唴娓呯悊,绔嬪嵆鍚屾鎵弿涓€娆℃姠鍦ㄦ竻鐞嗗墠鍙戝嚭缈昏瘧璇锋眰
      try { scanHudTopBarOnce(); } catch (e) { log("HUD test: immediate scan failed: " + (e && e.message ? e.message : String(e))); }
      // 璇婃柇:1s/3s 鍚庢鏌ヨ鏄惁瀛樻椿銆佸彲瑙佹€с€佹槸鍚﹀凡娉ㄥ叆璇戞枃(瀹氫綅琛岃鍒?闅愯棌/缈昏瘧鏃跺簭闂)
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

  // ================= 鍙戦€佹帴绠?鍛戒护 / 鍙戦€佸墠缈昏瘧) =================

  // 瑙﹀彂鍘熺増鍙戦€?娲惧彂 CitadelChatInputSubmitted 浜嬩欢,蹇呴』浼犲叆杈撳叆闈㈡澘鍙傛暟
  // (DLCT/poker 鍚屾鏈哄埗;浼?null 鍘熺増澶勭悊鍣ㄤ笉浼氬彂閫?
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

  // ---- BTIPC 浼犺緭灞?2026-10-28 鎷嗚嚦 lingua_chat_btipc.js,姝ゅ鍒悕瑙ｆ瀯淇濇寔璋冪敤鐐逛笉鍙? ----
  // 渚濊禆缁?LCTBTIPC.init({...}) 鍦?boot() 棣栬娉ㄥ叆;姝ゅ鍙仛寮曠敤缁戝畾,涓嶅惈瀹炵幇銆?  const afterRealMs = LCTBTIPC.afterRealMs;
  const btipcFinish = LCTBTIPC.btipcFinish;
  const btipcUtf8Bytes = LCTBTIPC.btipcUtf8Bytes;
  const BTIPC = LCTBTIPC.BTIPC;
  const runBtipcEcho = LCTBTIPC.runBtipcEcho;
  const runBtipcTranslate = LCTBTIPC.runBtipcTranslate;
  // 浼犺緭灞傜殑鑺傛媿甯搁噺:涓绘枃浠剁殑鍐欐绾?琛岄绠?鍥炲０鎷ュ璞佸厤绐楀紩鐢ㄥ悓涓€瀹氫箟
  const BTIPC_T_CLOSE_MS = LCTBTIPC.BTIPC_T_CLOSE_MS;
  const BTIPC_FIRST_SHOT_DELAY_MS = LCTBTIPC.BTIPC_FIRST_SHOT_DELAY_MS;
  const BTIPC_REQ_MAX_PAYLOAD = LCTBTIPC.BTIPC_REQ_MAX_PAYLOAD;
  const BTIPC_ECHO_STORM_WINDOW_MS = LCTBTIPC.BTIPC_ECHO_STORM_WINDOW_MS;

  // 缁熶竴鎻愪氦澶勭悊;甯﹂槻閲?鍑芥暟璋冪敤 + 浜嬩欢鐩戝惉鍙岄€氶亾鍙兘鍚屾椂瑙﹀彂)
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

    // EXP6734-C: C-5 涓ゆ Enter 鍒ゅ畾閽╁瓙(绗?涓嬫嫤鎴敼鍐欎笉鍙戦€?绗?涓嬫斁琛岃蛋姝ｅ父鍙戦€?
    if (State.c5 && expCall("exp6734cSubmitHook", input, trimmed)) return;

    if (!trimmed) return;

    // COMMUNITY 0.1.0:鏃犳ˉ璁剧疆鍏ュ彛銆備富璺緞=娓告垙鍐呭彲瑙佽缃潰鏉?鍔ㄦ€?CitadelHTMLPanel,
    // 浜や簰寰呯湡鏈洪獙璇?;鍏滃簳=/tr code <base64>(娴忚鍣?Pages銆屽鍑洪厤缃爜銆嶇矘璐村鍏?銆?    if (trimmed === "/tr" || trimmed.indexOf("/tr ") === 0) {
      clearInput();
      const trArg = trimmed.slice(3).trim();
      if (trArg.indexOf("code") === 0) { importCfgCode(trArg.slice(4).trim()); return; }
      togglePagePanel();
      log("UI_OPEN " + trOpenSummary()); // 鏃犳ˉ:璁剧疆闈㈡澘鍦ㄦ父鎴忓唴;鎴栨祻瑙堝櫒鎵撳紑 PAGE_URL 鐨勫€?      return;
    }

    // /bt6734e: 澶氬€肩鍙峰垽鍒疄楠?6734-E),涓嶅彂閫?    if (trimmed === "/bt6734e") {
      clearInput();
      expCall("runExp6734E");
      return;
    }

    // /bt6734d [n|win]: Bridge鈫扨anorama 涓嬭鍚炲悙鍩哄噯(6734-D),涓嶅彂閫?    //   鏃犲弬 = 鍏ㄧ煩闃?D1~D6(16/32/64/96/128/256 闈㈡澘 脳 20 杞?;鏁板瓧 = 鍗曢厤缃?win = 绐楀彛缁?W1~W5
    if (trimmed === "/bt6734d" || trimmed.indexOf("/bt6734d ") === 0) {
      const dArg = trimmed.slice(8).trim();
      clearInput();
      expCall("runExp6734D", dArg);
      return;
    }

    // /bt6734b: 鐪熷疄瀵瑰眬寤惰繜娴嬭瘯(6734-B),涓嶅彂閫?    if (trimmed === "/bt6734b") {
      clearInput();
      expCall("runExp6734B");
      return;
    }

    // /bt6734c: 杈撳叆妗嗘帶鍒跺疄楠?6734-C),涓嶅彂閫?甯冮槻鍚庝袱娈垫墜鍔?Enter 鍒ゅ畾
    if (trimmed === "/bt6734c") {
      expCall("runExp6734C", input, trimmed);
      return;
    }

    // !lcttest 娴嬭瘯鍛戒护:鍚?HUD 椤舵爮鑱婂ぉ娉ㄥ叆涓€鏉¤嫳鏂囨秷鎭?涓嶇湡瀹炲彂閫?
    // 鐢ㄩ€?鏃犻槦鍙?鏃?bot 鏃堕獙璇?HUD 鎵弿+缈昏瘧閫氳矾;杩涜缁冨満鍗冲彲娴?    if (trimmed === "!lcttest" || trimmed.indexOf("!lcttest ") === 0) {
      const testText = trimmed.length > 9 ? trimmed.slice(9).trim() : "hello can you push mid";
      injectHudTestMessage(testText);
      clearInput();
      return;
    }

    // 鍙戦€佸墠缈昏瘧(off=鍙戝師鏂?/ translation=浠呰瘧鏂?/ bilingual=鍘熸枃|璇戞枃)
    // 鎸夐厤缃殑鍙戦€佸墠缈昏瘧妯″紡澶勭悊
    const outgoingMode = State.cfg.outgoing || "off";
    if (State.cfg.enabled && outgoingMode !== "off" && trimmed.charAt(0) !== "/" && !State.c5) {
      const outTarget = resolveOutgoingTarget();
      // 闃查噸澶嶅彂閫?鍚屼竴鏂囨湰缈昏瘧涓?閲嶅鎸?Enter/Shift+Enter **鍘熸牱绔嬪嵆鍙戝嚭**(2026-10-31 瀹炶溅:
      // 鏃ч€昏緫鐩存帴 return 闈欓粯鍚炴秷鎭€斺€旂 2 涓?gg 娑堝け;dedupe 涓嶅尯鍒嗚亰澶╅€氶亾,Shift 閫氶亾鍚屽彈褰卞搷)銆?      // 鍘熸牱鍙戝嚭涓嶈繘缈昏瘧闃熷垪(涓嶇Н鍘?,娑堟伅缁濅笉涓?绗?1 鏉＄炕璇戝畬鎴愬悗鐓у父鍙戝弻璇€?      // 涓嶅悓鏂囨湰鍒欐帓闃?鍓嶄竴鏂囨湰鐨勭炕璇戠粨鏋滃凡鎻愪氦,涓嶅啿绐?
      if (State.outgoingPending === trimmed) {
        log("outgoing dedupe: same text pending -> sending original verbatim: " + trimmed.slice(0, 40));
        try { triggerStockSubmit(input); } catch (eDq) {}
        clearInput();
        return;
      }
      State.outgoingPending = trimmed;
      // 绔嬪嵆娓呯┖杈撳叆妗?瑙嗚鍙嶉"宸插彂閫?,涓嶅啀璇互涓烘病鍙戝嚭鍘昏€岄噸澶嶆寜閿?      clearInput();
      translateOutgoing(trimmed, function (translated, detected) {
        State.outgoingPending = null;
        let send = trimmed;
        if (translated && translated !== trimmed) {
          const trText = String(translated).trim();
          if (outgoingMode === "translation") send = trText;
          else if (outgoingMode === "bilingual") send = trimmed + " | " + trText;
          // 瓒呴暱娑堟伅淇濇姢:娓告垙鑱婂ぉ鍙戦€佹湁闀垮害涓婇檺,鎷兼帴杩囬暱浼氳鎴柇/澶辫触;
          // 浼樺厛淇濈暀鍘熸枃,璇戞枃瓒呴檺閮ㄥ垎鎴柇鍔犵渷鐣ュ彿
          const MAX_SEND_CHARS = 400;
          if (send.length > MAX_SEND_CHARS) {
            if (outgoingMode === "bilingual") {
              const budget = Math.max(0, MAX_SEND_CHARS - trimmed.length - 3);
              send = trimmed + " | " + (trText.length > budget ? trText.slice(0, budget) + "鈥? : trText);
            } else {
              send = send.slice(0, MAX_SEND_CHARS) + "鈥?;
            }
          }
          setStatus("宸插彂閫佽瘧鏂? " + String(send).slice(0, 40));
        } else if (!translated) {
          // 缈昏瘧涓嶅彲鐢?瓒呮椂:鎸夊師鏂囧彂閫?浣嗗繀椤荤暀鏃ュ織+娓告垙鍐呮彁绀?鍚﹀垯鐢ㄦ埛鐪嬪埌鍘熸枃浼氫互涓烘湇鍔″晢鍧忎簡
          log("outgoing: translation unavailable (timeout/error), sending original");
          showOutgoingFailTip();
          setStatus("缈昏瘧涓嶅彲鐢?宸叉寜鍘熸枃鍙戦€?);
        } else if (translated === trimmed) {
          // 缈昏瘧缁撴灉涓庡師鏂囩浉鍚?濡?API 鏈仛瀹炶川缈昏瘧):鎸夊師鏂囧彂閫?          log("outgoing: no-op (translation === original), sending original");
          // 2026-10-31 UX 闃插憜:detected == 鍙戦€佺洰鏍囪瑷€鏃?闈欓粯 no-op 浼氳褰撴垚"澶辨晥"銆?          // 缁欏嚭鍙鍔ㄦ彁绀?璁╃敤鎴风煡閬撳幓鏀广€屽彂閫佺洰鏍囪瑷€銆嶃€?          const ot = resolveOutgoingTarget();
          if (detected && ot && detected === ot) {
            setStatus("鍙戦€佺洰鏍囪瑷€(" + ot + ")涓庤緭鍏ヨ瑷€鐩稿悓,鏈炕璇戔€斺€旇璇戞垚鍏朵粬璇█璇峰湪璁剧疆鏀广€屽彂閫佺洰鏍囪瑷€銆?);
          } else {
            setStatus("缈昏瘧缁撴灉涓庡師鏂囩浉鍚?鎸夊師鏂囧彂閫?);
          }
        }
        log("outgoing mode=" + outgoingMode + " detected=" + (detected || "-") + " -> " + send.slice(0, 80) + " [tgt=" + (State.cfg.outgoingTarget || "-") + " ui.tgt=" + ((State.cfg.ui && State.cfg.ui.outgoingTarget) || "-") + " res=" + resolveOutgoingTarget() + "]");
        // 瑕嗙洊鍓嶅厛鎹曡幏褰撳墠杈撳叆妗嗗唴瀹?鑻ョ敤鎴峰凡杈撳叆鏂版秷鎭?涓嶈兘涓㈠け
        const cur = safeText(input);
        try {
          input.text = send;
        } catch (e) {}
        triggerStockSubmit(input);
        if (cur !== "" && cur !== trimmed) {
          // 鐢ㄦ埛宸茶緭鍏ユ柊鍐呭:鎭㈠瀹?璁╃敤鎴疯嚜琛屾彁浜?          try {
            input.text = cur;
          } catch (e) {}
        } else {
          clearInput();
        }
      });
      return;
    }

    // 甯歌鍙戦€?纭繚鏂囨湰灏变綅鍚庤Е鍙戝師鐗堝彂閫?涓?DLCT commitChatText 琛屼负涓€鑷?
    try {
      input.text = trimmed;
    } catch (e) {}
    triggerStockSubmit(input);
    clearInput();
  }

  function translateOutgoing(text, done) {
    // 鐩磋繛閫氶亾(canHttp)鍙敤鏃朵笉闇€瑕?HTML 闈㈡澘;鍗充究闈㈡澘涓嶅彲鐢ㄤ篃搴旇蛋鐩磋繛缈昏瘧銆?    // 鈶?涓婂眰鏁村悎:BTIPC 鍙敤鏃跺悓鏍蜂笉渚濊禆闈㈡澘/鐩磋繛(鑷缓 Image 闈㈡澘 + console.log 鍑虹珯)銆?    // 浠呭綋涓ゆ潯鏃ч€氶亾閮戒笉鍙敤涓?BTIPC 涔熸帴涓嶄簡(鎺㈤拡鍗犵嚎)鏃?鎵嶆寜鍘熸枃鍙戦€併€?    const canHttp = detectAsyncWebRequest();
    const panel = canHttp ? null : ensurePanel();
    const btipcReady = !!BTIPC && !BTIPC.busy();
    if (!canHttp && !panel && !btipcReady) {
      setStatus("妗ユ湭杩炴帴,宸叉寜鍘熸枃鍙戦€?);
      done(null, null);
      return;
    }
    ensureBridgeEvents();
    enqueueOutgoing(text, done);
  }

  // ================= 璁剧疆闈㈡澘 =================

  function setStatus(text) {
    const label = findChild(getRoot(), STATUS_LABEL_ID);
    if (label) {
      try {
        label.text = text || "";
      } catch (e) {}
    }
  }

  // ================= 璁剧疆闈㈡澘 UI(2026-10-28 浠诲姟鈶-1 鍒嗗)=================
  // 闈㈡澘鍑芥暟(寮€鍏?涓嬫媺/杈撳叆妗?鍥炲～/淇濆瓨/娴嬭瘯)宸叉媶鑷?lingua_chat_panel.vjs_c:
  // 閭ｉ噷缁?globalThis.LCTNS 瀵煎叆鏈枃浠剁殑瀹夸富绗﹀彿,鍐嶆妸鑷繁鐨勫嚱鏁板悕鎸傚洖 globalThis(鏅氱粦瀹?銆?  // 鏈枃浠跺彧鐣欎笟鍔′晶/鍧楀楂橀:setStatus銆乥ridgePost銆丅TIPC_GET_OPS銆乤pplyUILang銆丩CTPickUILang;
  // 鍧楀璋冪敤鐐?openSettingsPanel / fieldValue / setSelectText 鈥?
  // 淇濇寔瑁告爣璇嗙闆舵敼鍐?鈥斺€?闈㈡澘鏂囦欢瑁呰浇鍚庡嵆瑙ｆ瀽鍒?globalThis 鎸傝浇(椤哄簭鐢?XML 淇濊瘉)銆?
  // btipc07:health / gamenames / quickchat 涓夋帴鍙ｈ縼 BTIPC銆俆RQ 淇″皝鐧藉悕鍗曞喕缁?  // (core/btipc/transport.js 鍙 op=config|test),鎵€浠ユ柊璇箟涓€寰嬪杩?op=config 鐨?  // JSON body 鐨?"get" 瀛楁,鐢辨ˉ绔?runBtipcGet 瑙ｉ噴 鈥斺€?淇″皝/甯?鐘舵€佹満闆舵敼鍔?
  // 涓婂眰(healthCheck / syncGameNames / syncQuickChat)鐨勮皟鐢ㄦ柟寮忎篃瀹屽叏涓嶅彉銆?  // configsync(btipc11):閰嶇疆宸垎鍚屾銆俹p 鍚嶄笌 op=config 鐨?*鍐?*璇箟鍒嗗紑 鈥斺€?  // 妗ョ op=config 鍒嗘敮鎸?get 浼樺厛瑙ｉ噴 body,鍐欎笌 get 涓嶈兘鍏辩敤涓€涓?op 鍚嶃€?  const BTIPC_GET_OPS = { health: 1, gamenames: 1, quickchat: 1, configsync: 1 };

  function bridgePost(op, payload, done) {
    const isGet = !!BTIPC_GET_OPS[op];
    const body = isGet ? Object.assign({ get: op }, payload || {}) : (payload || {});
    const data = encodeURIComponent(JSON.stringify(body));
    // 鐩磋繛閫氶亾鍙敤鏃朵笉瑕佹眰 HTML 闈㈡澘瀛樺湪(hudchat 鏈姞杞芥椂娴嬭瘯/淇濆瓨涔熻兘鐢?
    const canHttp = detectAsyncWebRequest();
    const panel = canHttp ? null : ensurePanel();
    if (!canHttp && !panel) {
      done({ ok: false, error: "bridge_panel_unavailable" });
      return;
    }
    ensureBridgeEvents();
    enqueueBridge(isGet ? "config" : op, data, done, isGet);
  }

  // ---- 澶氳瑷€:搴旂敤褰撳墠 UI 璇█鍒伴潰鏉挎墍鏈夐潤鎬佹枃鏈?----
  function applyUILang() {
    const root = getRoot();
    if (!root) return;
    const panel = findChild(root, SETTINGS_PANEL_ID);
    const find = function (id) { return panel ? findChild(panel, id) : findChild(root, id); };
    // 闈㈡澘鏍囬
    var lbl = find("LCTPanelTitle"); if (lbl) try { lbl.text = t("panelTitle"); } catch (e) {}
    // 璁剧疆琛屾爣绛?    var ROW_MAP = {
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
    // 鑿滃崟閫夐」鏂囨湰
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
      "LCTMenuUILangAuto": "optUILangAuto",
    };
    for (var mid in MENU_MAP) { lbl = find(mid); if (lbl) try { lbl.text = t(MENU_MAP[mid]); } catch (e) {}
    }
    // 鎸夐挳鏂囨湰
    lbl = find("LCTSaveBtnLabel"); if (lbl) try { lbl.text = t("btnSave"); } catch (e) {}
    lbl = find("LCTTestBtnLabel"); if (lbl) try { lbl.text = t("btnTest"); } catch (e) {}
    lbl = find("LCTKeyHint"); if (lbl) try { lbl.text = t("btnHint"); } catch (e) {}
    // 鍚屾閫夋嫨鎺т欢褰撳墠鍊肩殑鏄剧ず鏂囨湰
    setSelectText("LCTProviderSelect", labelFor(PROVIDER_OPTIONS, State.cfg.provider || "bing"));
    setSelectText("LCTTargetLangSelect", labelFor(LANGUAGE_OPTIONS, State.cfg.targetLanguage || "zh-Hans"));
    setSelectText("LCTDisplayModeSelect", labelFor(DISPLAY_MODES, State.cfg.displayMode || "bilingual"));
    setSelectText("LCTOutgoingSelect", labelFor(OUTGOING_MODES, State.cfg.outgoing || "off"));
    setSelectText("LCTOutgoingTargetSelect", labelFor(LANGUAGE_OPTIONS, State.cfg.outgoingTarget || "en"));
    setSelectText("LCTUILangSelect", labelFor(UI_LANG_OPTIONS, uiLangPref() || "auto"));
    // 鍚屾寮€鍏虫枃鏈?    setToggleText("LCTEnabled", !!State.cfg.enabled);
    setToggleText("LCTForce", !!State.cfg.force);
    setToggleText("LCTTranslateOwn", State.cfg.translateOwn !== false);
    setToggleText("LCTChatLog", State.cfg.chatLog !== false);
    // 鍚屾妗ョ姸鎬?    updateBridgeStatusUI();
  }

  function LCTPickUILang(value) {
    // 2026-10-29 鎸佷箙鍖栦慨澶?GB 鐢ㄦ埛瀹炴祴"闈㈡澘閫夎瑷€,閲嶅惎鍗抽噸缃?):鍘熷疄鐜板彧鍐?    // State.cfg.uiLang + saveUiConfig(浼氳瘽 convar),浠庝笉鎺ㄦˉ 鈫?閲嶅惎琚ˉ閰嶇疆瑕嗙洊銆?    // 鐜板啓鍏?cfg.ui.uiLang(DEFAULTS.ui 鍧?缁忔ˉ鎸佷箙鍖?骞跺悓姝ユ帹妗ャ€?    if (!State.cfg.ui) State.cfg.ui = {};
    State.cfg.ui.uiLang = value;
    saveUiConfig();
    applyUILang();
    closeSelectMenus();
    try {
      bridgePost("config", { config: { ui: { uiLang: value } } }, function (res) {
        log("pickUILang persist: " + (res && res.ok ? "ok" : (res && res.error) || "failed"));
      });
    } catch (eP) { log("pickUILang persist THREW " + expErr(eP)); }
    log("pickUILang: " + value);
  }

  // ================= 鍚姩 =================

  // ================= 2026-10-16:閰嶇疆鍚屾鍚姩闂?+ 鐢ㄦ埛鑴忔爣璁?=================
  // 鍚姩闂?boot 绛夋帰閽堝畾璁?閫氬父 2-4s)鍐嶅悓姝?閬垮厤 t=0 鐩村彂蹇呰蛋 BTIPC 浣嶆车(25s+);8s 鏃犲畾璁鸿蛋鑰佽矾銆?  function startCfgSync() {
    if (State.cfgSyncStarted) return;
    State.cfgSyncStarted = true;
    startPageCfgSync(); // COMMUNITY: 閰嶇疆鏉冨▉ = 鎵樼椤?localStorage,缁?hash cfg get 鍚屾
  }
  function waitProbeForSync() {
    if (State.cfgSyncStarted || State.cfgSynced) { State.cfgSyncStarted = true; return; }
    if (State.httpsPanelOk !== null) { startCfgSync(); return; }
    State.cfgSyncWaitTries = (State.cfgSyncWaitTries || 0) + 1;
    if (State.cfgSyncWaitTries >= 8) { startCfgSync(); return; }
    try { $.Schedule(1.0, waitProbeForSync); } catch (e) { startCfgSync(); }
  }
  // 鐢ㄦ埛鑴忔爣璁?鍚姩鍚屾钀藉湴 / 闈㈡澘 _mask 鍥炲～涓嶅緱鎷嶆帀鐢ㄦ埛鍦ㄧ獥鍙ｅ唴鏀硅繃鐨勫€?  // (23:35 涓?00:48 涓ゆ瀹炶溅:pick openai 鈫?sync 钀藉湴 鈫?琚揩閲嶉€?銆?  // LCTSave 鎴愬姛娓呴浂(鎰忓浘宸茶惤鐩?;閲嶅惎鍚?loadUiConfig 鍏ㄦ柊,鏃犺剰銆?  function markCfgDirty(key) {
    if (!State.cfgDirty) State.cfgDirty = {};
    State.cfgDirty[key] = true;
  }

  // 鎶婃ˉ鍥炵粰鐨勬父鎴忎晶閰嶇疆钀藉湴鍒?State.cfg銆傚紑鏈哄悓姝ヤ笌杩愯鏃?閰嶇疆鍙樻洿"鐩戝惉鍏辩敤杩欎竴娈?  // (涓ゅ鍙ｅ緞蹇呴』涓€鑷?銆俤irty 閿?= 鐢ㄦ埛鍦ㄩ潰鏉块噷鏀硅繃杩樻病淇濆瓨鐨勫€?涓嶈兘琚ˉ鍥炲～鎷嶆帀銆?  function applyBridgeConfig(c, tag) {
    let changed = false;
    const ui = c.ui || {};
    const dirty = State.cfgDirty || {};
    if (tag === "cfg-watch") log("applyBridgeConfig probe: dirty=" + JSON.stringify(dirty) + " incoming.ui.outgoingTarget=" + (ui.outgoingTarget || "-"));
    if (typeof ui.displayMode === "string" && !dirty.displayMode) { State.cfg.displayMode = ui.displayMode; changed = true; }
    if (typeof ui.outgoing === "string" && !dirty.outgoing) { State.cfg.outgoing = ui.outgoing; changed = true; }
    if (typeof ui.outgoingTarget === "string" && !dirty.outgoingTarget) { State.cfg.outgoingTarget = ui.outgoingTarget; changed = true; }
    if (typeof ui.targetLanguage === "string" && !dirty.targetLanguage) { State.cfg.targetLanguage = ui.targetLanguage; changed = true; }
    if (typeof ui.enabled === "boolean" && !dirty.enabled) { State.cfg.enabled = ui.enabled; changed = true; }
    if (typeof ui.force === "boolean" && !dirty.force) { State.cfg.force = ui.force; changed = true; }
    if (typeof ui.provider === "string" && !dirty.provider) { State.cfg.provider = ui.provider; changed = true; }
    if (typeof ui.timeoutMs === "number" && !dirty.timeoutMs) { State.cfg.timeoutMs = ui.timeoutMs; changed = true; }
    // 椤跺眰寮€鍏?chatLog/translateOwn 涓嶅湪 ui 瀛愬璞￠噷,BUGFIX:娓告垙閲嶅惎鍚?    // 鑻ヤ笉鍥炲～,State.cfg 鍥炶惤鍒?DEFAULTS(translateOwn:true),瀵艰嚧"鍏虫帀杩樼炕璇?)
    if (typeof c.translateOwn === "boolean" && !dirty.translateOwn) { State.cfg.translateOwn = c.translateOwn; changed = true; }
    if (c.chatLog && typeof c.chatLog === "object") {
      if (typeof c.chatLog.enabled === "boolean" && !dirty.chatLog) { State.cfg.chatLog = c.chatLog.enabled; changed = true; }
    }
    if (changed) {
      saveUiConfig();
      log((tag || "config") + ": synced from bridge (outgoing=" + State.cfg.outgoing +
        ", outgoingTarget=" + State.cfg.outgoingTarget +
        ", translateOwn=" + State.cfg.translateOwn + ")");
    }
    // btipc05b:鐣欏叏閲?mask 缁欓潰鏉跨寮€(openSettingsPanel 鐩存帴娑堣垂,鍏?24s 鐜板満璇?
    State.cfg._mask = c;
    // btipc11:宸垎鍚屾鐨勫熀鍑?涓?_mask 鍒嗗紑:_mask 浼氳闈㈡澘淇濆瓨娓呯┖,杩欎唤涓嶈兘娓?鈥斺€?娓呬簡宸垎灏辨病鍩哄噯)銆?    State.cfgMask = c;
    return changed;
  }

  // ================= 閰嶇疆宸垎鍚屾(btipc11)=================
  // 涓?gamenames/quickchat 鍚屼竴濂椾袱娈靛紡(妗ョ core/sync_data.js):鎻℃墜鎶ユ湰鍦版寚绾?鈫?same(1 甯?鎴栧彧浼?  // **鍙樹簡鐨勫瓧娈?*(set=缁濆鍊?unset=鍒犻櫎,鍏稿瀷 1~3 涓?鈮?00B)銆傚樊鍒嗗熀鍑?= State.cfgMask(涓庢寚绾瑰悓鐗?,
  // 妗ヤ晶鎸夊鎴风鎸囩汗鏌ヨ嚜宸辩殑鐗堟湰鍘嗗彶绠楀樊鍒嗐€?  // 涓轰粈涔堝€煎緱:鍏ㄩ噺 maskCompact 鈮?00B=40 甯р増26s(BTIP小 涓嬭 10B/甯?,鎱㈤€氶亾涓?缃戦〉鏀逛簡娓告垙涓嶈"瑕佺瓑 20s 杞 + 26s 鍏ㄩ噺 鈮?6s;宸垎鍚?鈮? 甯?娌″彉)鎴?6 甯?鍙樹簡)銆?  function cfgPathApply(obj, path, value) {
    const ps = String(path).split(".");
    let cur = obj;
    for (let i = 0; i < ps.length - 1; i++) {
      if (!cur[ps[i]] || typeof cur[ps[i]] !== "object") cur[ps[i]] = {};
      cur = cur[ps[i]];
    }
    if (value === undefined) delete cur[ps[ps.length - 1]];
    else cur[ps[ps.length - 1]] = value;
  }
  function clearDirtyForPaths(paths) {
    if (!State.cfgDirty) return;
    for (const p of paths || []) {
      const key = String(p).split(".").pop();
      delete State.cfgDirty[key];
    }
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
      // 2026-10-31 搴旂敤璺緞娓?dirty(鍙戦€佹柟鍚戞暣鍙嶅疄璇?:妗ヤ晶鍙樻洿鏄洿鏂扮殑鐢ㄦ埛鎰忓浘
      // (缃戦〉淇濆瓨);闈㈡澘鏈繚瀛樼殑缂栬緫琚樉寮忎繚瀛樿鐩栨椂,涓嶅緱鍐嶆嫤鍚庣画鍥炲～銆?      clearDirtyForPaths(Object.keys(set).concat(d.unset || []));
    } else if (d.config && typeof d.config === "object") {
      mask = d.config;
      // full 杞借嵎 = 妗ヤ晶瀹屾暣鏉冨▉鐘舵€?娓呭叏閮?dirty(2026-10-31)
      if (State.cfgDirty) for (const k of Object.keys(State.cfgDirty)) delete State.cfgDirty[k];
    }
    else { log("cfg sync: bad payload"); return false; }
    applyBridgeConfig(mask, "cfg-watch");
    State.cfgMask = mask; // 鍩哄噯 = 鍚堝苟缁撴灉(涓嬩竴杞樊鍒嗙殑璧风偣)
    if (typeof d.fingerprint === "string" && d.fingerprint) State.cfgRev = d.fingerprint;
    log("cfg sync applied: " + (d.delta ? "delta" : "full") + " (rev=" + State.cfgRev + ")" +
      (d.delta && d.set ? " set=" + JSON.stringify(d.set).slice(0, 200) : ""));
    return true;
  }
  function syncConfigDelta(onDone) {
    // 2026-10-31:闄堟棫宸垎闃叉姢銆傝姹傛椂鐨?rev 鑻ュ湪鍝嶅簲钀藉湴鍓嶅凡琚洿鏂扮殑搴旂敤鎺ㄨ繘
    // (澶氫釜鍦ㄩ€斿悓姝ヤ贡搴忓埌杈?,鏈宸垎鏄繃鏈熺殑鈥斺€斿簲鐢ㄥ畠浼氬洖閫€鍒氱敓鏁堢殑閰嶇疆
    // (瀹炴祴:缃戦〉鏀?en 鍚庤闄堟棫 zh-Hans 宸垎瑕嗙洊,鍑虹珯鏂瑰悜"鏁村弽"澶嶅彂)銆備涪寮冨苟绛変笅娆¤疆璇€?    const reqRev = State.cfgRev || "";
    syncViaBtipc("configsync", reqRev,
      function () { log("cfg sync: fingerprint match, no transfer"); return true; },
      function (text, res) {
        if (reqRev && State.cfgRev && State.cfgRev !== reqRev) {
          log("cfg sync: stale delta discarded (reqRev=" + reqRev + " cur=" + State.cfgRev + ")");
          // conc-2 璇勫淇:涓㈠純鍚?2s 绔嬪嵆閲嶅悓姝?鎼哄甫宸叉帹杩涚殑 rev,涓€娆″嵆鏀舵暃),
          // 涓嶅共绛?60s 鍏滃簳杞銆傞噸璇曞彂閫佺殑鏄綋鍓?rev 鈫?妗ュ巻鍙插繀鏈夊熀绾?鈫?涓€杞敹鏁涖€?          try { $.Schedule(2.0, function () { try { syncConfigDelta(onDone); } catch (eR) {} }); } catch (eR2) {}
          return false;
        }
        return applyConfigPayload(text, res);
      },
      function (ok) { if (onDone) onDone(ok); });
  }

  // ================= 杩愯鏃堕厤缃洃鍚?2026-10-19, 2026-10-28 绠€鍖栦负鎱㈠厹搴? =================
  // 缃戦〉淇濆瓨鍙惤 config.json,娓告垙渚у彧鍦ㄥ紑鏈鸿涓€娆?鈫?"缃戦〉鏀逛簡娓告垙涓嶈"銆?  // 涓诲姏鏄厤缃帹閫?startConfigPush:https 闈㈡澘闀胯疆璇?缃戦〉淇濆瓨鍚?~0.3s 鐢熸晥);
  // 杩欓噷鐨勮疆璇㈠彧鏄?https 闈㈡澘鍒ゆ/鎺ㄩ€佹寕涓嶄笂鏃剁殑鍏滃簳:鍥哄畾 60s 宸垎瀵硅处,
  // 涓嶅仛蹇參鍒囨崲銆佷笉鍋氶€€閬裤€佷笉鍋氫紶杈撳繖璺宠繃(60s 涓€娆?涓嶅€煎緱浼樺寲)銆?  // 杞澶辫触涓嶈鍏?https 鍒ゆ;鏁存 try/catch 鈥斺€?浠讳綍寮傚父閮戒笉璁歌鐩戝惉閾炬柇鎺夈€?  // 2026-10-20 瀹炶俯:鍘嬬缉琛屾暟鏃舵妸甯搁噺澹版槑绮樺埌娉ㄩ噴琛屽熬 鈫?甯搁噺娌″０鏄?鈫?ReferenceError 琚?  // catch 鍚炴帀 鈫?鐩戝惉闈欓粯姝绘帀銆佺綉椤垫敼閰嶇疆娓告垙姘镐笉鐢熸晥銆傛晠:甯搁噺鐙崰涓€琛?+ 鍚姩鍗虫墦鏃ュ織銆?  const CFG_WATCH_FALLBACK_S = 60;
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
        State.cfgPollNext = true; // 鍏滃簳杞澶辫触涓嶈鍏?https 鍒ゆ(瑙?demoteToBtipc)
        // btipc11:杞璧板樊鍒嗗悓姝?鈥斺€?娌″彉鏃舵彙鎵?1 甯у氨鍥?鍙樹簡鎵嶅彇宸垎鐗囥€?        try {
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

  // ================= 閰嶇疆鍙樻洿鎺ㄩ€?2026-10-20) =================
  // 娴佺▼灏辨槸"妗ュ悜娓告垙鍙戜俊鍙?鈫?娓告垙鍐嶈閰嶇疆":
  //   娓告垙鎶婁竴涓暱杞鎸傚湪妗ヤ笂(/bridge?op=watch),缃戦〉涓€淇濆瓨,妗ョ珛鍒诲彨閱?鈫?娓告垙
  //   鍑犵櫨姣鍐呯煡閬?鍙樹簡",鍐嶈嚜宸卞幓璇婚厤缃?涓嶈蛋 title 閫氶亾,閬垮紑 512 瀛楃涓婇檺)銆?  // 闀胯疆璇㈠彧鑳芥寕**璇锋眰闈㈡澘**:2026-10-20 瀹炴祴,绗簩涓?HTML 闈㈡澘鐨?title 寮曟搸涓嶆毚闇?  // (Activate() 涔熶笉琛?鈫?瑙傚療闈㈡澘杩欐潯璺槸姝荤殑銆?  // 鍥犳鎸傞暱杞鍙湪**浼犺緭绌洪棽**鏃跺仛:鍗曟Ы璇箟涓?闀胯疆璇㈠崰鐫€闈㈡澘,缈昏瘧璇锋眰涓€鏉ュ氨琚《鎺?  // (椤舵帀鐨勬槸闀胯疆璇?涓嶅奖鍝嶇炕璇?;绌洪棽鍒ゅ畾涓?SetURL 鍦ㄥ悓涓€娈靛悓姝ヤ唬鐮侀噷,涓嶄細鎻掑埌璇锋眰涓棿銆?  function armConfigWatch() {
    // 绌洪棽鍒ゅ畾(State.pending/activeRequests/queue 閮界┖)鈥斺€?涓庝笅闈?SetURL 涔嬮棿涓嶈法浜嬩欢寰幆
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

  // 闀胯疆璇㈢殑鎸?鏀剁姸鎬佹満:
  //   鎸?armConfigWatch(鍙湪浼犺緭绌洪棽鏃?鍒ゅ畾涓?SetURL 鍚屼竴娈靛悓姝ヤ唬鐮?
  //   娲?椤甸潰璧锋潵浼氱粡**浜嬩欢**鎶?"lct-watch"(onBridgeEvent 閲岃 State.watchAliveAt)
  //   閱?妗ュ彨閱掓椂椤甸潰鍐?"LCTW{鈥" 鈫?onWatchPayload 澶勭悊骞舵妸 watchArmed 娓呮帀 鈫?閲嶆柊鎸?  // 涓嶇敤璇?panel.title:閭ｄ釜灞炴€ф槸闄堟棫鐨?2026-10-20 瀹炴祴)銆?  function configWatchTick() {
    try {
      if (!State.watchArmed) {
        if (armConfigWatch() && !State.cfgPushLogged) {
          State.cfgPushLogged = true;
          log("cfg watch(push): armed (璇锋眰闈㈡澘闀胯疆璇?缃戦〉淇濆瓨鍚?~0.3s 鐢熸晥)");
        }
      } else if (nowMs() - (State.watchAliveAt || State.watchArmedAt || 0) > 3000) {
        State.watchArmed = false; // 椤甸潰娌¤捣鏉?鈫?閲嶆寕
      } else if (nowMs() - (State.watchArmedAt || 0) > 22000) {
        State.watchArmed = false; // 闀胯疆璇㈣秴鏃?妗?20s 鍥?椤甸潰涓嶅啓鏍囬)鈫?閲嶆寕
      }
    } catch (e) {}
    try { $.Schedule(0.15, configWatchTick); } catch (e) {}
  }

  function startConfigPush() {
    if (State.cfgPushStarted) return;
    State.cfgPushStarted = true;
    if (State.httpsPanelOk !== true) return; // 娌℃湁 https 閫氶亾灏辨病鏈夋帹閫?閫€鍥炶疆璇?
    // **涓嶈鍦ㄨ繖閲岀洿鎺?arm**:startCfgWatch 鏄湪寮€鏈哄悓姝ョ殑鍥炶皟閲岃璋冪殑,閭ｄ竴鍒诲嚭绔欐Ы浣?    // 杩樻病杩?activeRequests 浠嶄负 1)鈫?绌洪棽鍒ゅ畾蹇呯劧澶辫触 鈫?鎺ㄩ€佹案杩滄寕涓嶄笂(2026-10-20 瀹炴祴:
    // 鏃ュ織閲岃繛 "cfg watch(push): armed" 閮芥病鏈?涓€鐩撮潬 15s 杞鍏滃簳,瀹炴祴寤惰繜 12~25s)銆?    // 浜ょ粰涓嬮潰鐨?tick 鍘绘寕:瀹冨湪浼犺緭绌洪棽鐨勯偅涓€鐬寕涓?鎸備笂涔嬪悗灏变笌妲戒綅鏃犲叧浜嗐€?    try { $.Schedule(0.15, configWatchTick); } catch (e) {}
  }

  function syncBridgeConfig(callback) {
    // BUGFIX 0.1.3:boot 鏃朵富鍔ㄤ粠妗ユ媺鍙栧凡淇濆瓨閰嶇疆,鍚屾杩?State.cfg,
    // 鍚﹀垯娓告垙閲嶅惎鍚?outgoing 绛夊亸濂藉洖钀藉埌 UI_DEFAULTS(鍙戦€佸墠缈昏瘧榛樿鍏?銆?    // boot 鏃?UI 鏍戝彲鑳藉皻鏈瀯寤?闈㈡澘鎵句笉鍒颁細绔嬪嵆澶辫触 -> 寤惰繜閲嶈瘯銆?    // BUGFIX 0.1.3 (again):涓嶈兘渚濊禆 State.bridgeUp 鍐冲畾鏄惁閲嶈瘯鈥斺€攂ridgeUp 涓?true 鏃?    // 涓€娆℃媺鍙栧け璐ヤ細闈欓粯鏀惧純,translateOwn 姘歌繙涓嶅悓姝ャ€傛敼涓?娌″悓姝ユ垚鍔熷氨鎸佺画閲嶈瘯(鈮?0 娆?60 绉?銆?    // btipc07 闃查噸鍏?2026-10-04 07:00 瀹炶溅):boot() 涓?onBridgeAlive() 閮戒細璋冨畠,鑰?cfgSyncing 浠ュ墠
    // 鍙湪 onBridgeAlive 閲岀疆浣?鈥斺€?褰撴櫄 config 琚苟琛屾媺 3 娆?07:00:02 瓒呮椂 / 07:00:33 涓€娆?25.6s /
    // 07:00:59 涓€娆?28.4s),鍗曟Ы闃熷垪鐧藉崰 85s,鎶?gamenames/quickchat 鎻℃墜鎸ゅ埌 07:01:27 鎵嶅紑濮嬨€?    // 鏀逛负:cfgSyncing 鐢辨湰鍑芥暟鑷,宸插湪閫旀椂鐩存帴鎶?callback 鎸傚埌绛夊緟鍒?涓嶆柊寮€寰幆)銆?    if (State.cfgSyncing) {
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
      // 2026-10-16:issued 鍚屾鎶?闈㈡澘鏈缓濂界瓑)涓嶈兘鎶?cfgSyncing 鍗℃ 鈥?      // 鍗℃鍒欐湰浼氳瘽鍐嶆棤鍚屾銆傛姏浜嗘寜閲嶈瘯璧?涓嶉潤榛樻斁寮冦€?      try {
        bridgePost("config", {}, function (res) {
        if (res && res.ok && res.config) {
          const c = res.config;
          applyBridgeConfig(c, State.cfgSynced ? "cfg-watch" : "boot");
          if (typeof res.rev === "string") State.cfgRev = res.rev;
          State.cfgSynced = true;
          startCfgWatch();
          finish();
        } else if (attempts < MAX_SYNC_ATTEMPTS) {
          // 鎷夊彇澶辫触(妗ユ湭灏辩华/缃戠粶鎶栧姩/闈㈡澘鏈瀯寤?:鏃犳潯浠堕噸璇?涓嶅啀渚濊禆 bridgeUp
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

  // ================= btipc07:鏁版嵁鍚屾涓ゆ寮?health/gamenames/quickchat) =================
  // 涓嬭鍙湁 ~12.6 B/s(docs/btipc-v1.md 搂9:16B/甯?脳 0.79s/甯?,9.5KB/39KB 鍏ㄩ噺鍚屾
  // 鐗╃悊涓嶅彲琛?14~46 鍒嗛挓),鎵€浠?
  //   鈶?鎻℃墜鍙姤鎸囩汗 鈥斺€?妗ョ浉鍚屽氨鍥?same=1,涓€鏉℃暟鎹兘涓嶄紶(甯告€?鎵撳寘鍐呯儤鐒欏€间笌妗ュ悓婧?;
  //   鈶?涓嶅悓鎵嶅垎鐗?鐗囬暱鎸夈€愬瓧鑺傘€戦檺(90B 鈮?8 甯?鈮?7s + 3.5s 鍥哄畾寮€閿€ 鈮?11s/鐗?,
  //      浣庝簬鍑虹珯 15s 涓㈠純绾?鐗囬棿绛夐槦鍒楃┖鍐嶆媺,缈昏瘧浼樺厛(鍗曟Ы闃熷垪,涓嶈浣嶄細鍗℃缈昏瘧);
  //   鈶?妗ヨ兘璇诲埌瀹㈡埛绔偅鐗堝厹搴曟椂缁欑殑鏄?delta(澧炲垹鏀?,閫氬父 1~2 鐗?鈮?鍗婂垎閽熴€?  const SYNC_LIM_BYTES = 90;
  const SYNC_MAX_CHUNKS = 400; // 鎶ゆ爮:90B 脳 400 = 36KB,澶熶袱浠借鏂欏叏閲忚繕鏈変綑閲?  const SYNC_MAX_TRIES = 3; // 姣忎細璇濇渶澶氶噸璇曟鏁?閬垮厤妗ヤ竴鐩村洖閿欐椂姣?15s 鍒蜂竴鏉″け璐ユ棩蹇?

  /**
   * 涓ゆ寮忓彇鏁般€?   * @param {string}   op        bridgePost 鐨?op 鍚?gamenames / quickchat)
   * @param {string}   localFp   鏈湴鎸囩汗(鎻℃墜绗竴鍙?
   * @param {function} onSame    鎸囩汗涓€鑷存椂璋冪敤(鏍囪 synced),杩斿洖鏄惁绠楁垚鍔?   * @param {function} onApply   鏀跺埌瀹屾暣杞借嵎鏃惰皟鐢?(text, res) -> bool
   * @param {function} callback  (ok) 鏀跺熬
   */
  function syncViaBtipc(op, localFp, onSame, onApply, callback) {
    const fail = function (why) {
      log(op + " sync failed: " + why);
      if (callback) callback(false);
    };
    const pull = function (off, acc, chunks, exp) {
      if (chunks > SYNC_MAX_CHUNKS) { fail("budget exceeded at " + chunks + " chunks"); return; }
      // fp 鎭掍负銆愬鎴风鏈湴鎸囩汗銆?鎻℃墜涓庡垎鐗囦竴鑷?妗ユ墠鑳芥瘡娆＄畻鍑哄悓涓€浠借浇鑽?;
      // exp 鏄彙鎵嬫椂妗ュ洖鐨勬寚绾?鐢ㄤ簬璁╂ˉ鍙戠幇"鎷夊埌涓€鍗婇厤缃閲嶅缓"銆?      const body = { fp: localFp || "" };
      if (off !== null) { body.off = off; body.lim = SYNC_LIM_BYTES; if (exp) body.exp = exp; }
      bridgePost(op, body, function (res) {
        if (!res || !res.ok) { fail((res && res.error) || "bridge_error"); return; }
        if (res.same) { if (callback) callback(onSame(res) !== false); return; }
        if (off === null) {
          // 鎻℃墜鍥炲寘:鎷垮埌妗ヤ晶鎸囩汗鍚庢墠寮€鎷?          if (!res.fingerprint) { fail("bad_handshake"); return; }
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
        // 璁╀綅:闃熷垪閲岃繕鏈夋椿灏辩瓑瀹冨仛瀹?缈昏瘧浼樺厛),鍐嶆媺涓嬩竴鐗?        const again = function () {
          if (State.queue.length > 0 || State.activeRequests > 0) { $.Schedule(1.0, again); return; }
          pull(nextOff, next, chunks + 1, exp);
        };
        $.Schedule(0.3, again);
      });
    };
    pull(null, "", 0, null);
  }

  // 搴旂敤鍚嶅崟杞借嵎:delta 灏卞湴澧炲垹鏀?鍏ㄩ噺鏁翠綋鏇挎崲銆傞噸寤哄け璐ヤ繚鐣欐棫鍚嶅崟(涓嶈鐩?銆?  function applyNamesPayload(text, res) {
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
        if (k === "english" || k === "schinese") continue; // 鍏冨瓧娈?闈炴父鎴忓悕
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

  // btipc07:鍚姩鍗宠鎵撳寘鍐呯儤鐒欑殑鍏ㄩ噺閰嶅鍚嶅崟銆傜浉瀵圭‖缂栫爜 100 鏉＄殑濂藉:
  //   鈶?瑕嗙洊闈㈢炕鍊?292 鏉?鏉ヨ嚜鏈満娓告垙鏈湴鍖?闅?mod 涓€璧峰彂甯?;
  //   鈶?闅忔枃浠剁儤鐒欎簡鎸囩汗 LCT_GAMENAMES_PAIRS_FP 鈥斺€?妗ョ鎻℃墜鑳?1 甯у垽瀹?瑕佷笉瑕佷紶",
  //      鍚﹀垯纭紪鐮侀偅 100 鏉℃牴鏈病鏈夋寚绾?姣忓眬閮戒細琚垽涓嶄竴鑷淬€佺櫧浼犱竴娆″悕鍗曘€?  function initBakedGameNames() {
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

  // 浠庢ˉ鎷夊彇娓告垙鍚嶄繚鎶ゅ悕鍗?op=config 鐨?get=gamenames)銆?  // 鎴愬姛鍒欑敤鍏ㄩ噺鍚嶅崟(鍘熷澶у皬鍐?瑕嗙洊纭紪鐮佸厹搴?PROTECT_NAMES / PROTECT_TO_ZH 骞堕噸寤烘鍒?
  // 澶辫触鍒欎繚鐣欑幇鏈夊悕鍗?涓嶈鐩?,鏈夐檺閲嶈瘯銆?  function syncGameNames(callback) {
    if (State.gamenamesTries >= SYNC_MAX_TRIES) { if (callback) callback(); return; }
    State.gamenamesTries = (State.gamenamesTries || 0) + 1;
    syncViaBtipc(
      "gamenames",
      State.gamenamesFp,
      function (res) {
        // 甯告€佽矾寰?鎵撳寘鐑樼剻鍊间笌妗ュ悓婧?涓€鏉℃暟鎹兘涓嶄紶銆傝繖鏉℃棩蹇楁槸楠屾敹鍞竴鍙鐨勮瘉鎹?        // (2026-10-04 07:00 瀹炶溅鍙戠幇:姝ゅ浠ュ墠闈欓粯,鍙兘闈犳ˉ绔?out=110B 鍙嶆帹)銆?        log("gamenames sync: fingerprint match, no transfer (" +
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
    State.cfg = loadUiConfig(); log("boot probe: loadUiConfig outgoingTarget=" + State.cfg.outgoingTarget + " outgoing=" + State.cfg.outgoing);
    // 2026-10-28:applyUILang 鐜板湪瑕佺敤闈㈡澘鏂囦欢鎸傜殑鍏ㄥ眬(setSelectText 绛?;闈㈡澘缂哄け鏃朵笉鑳借 boot 鎶涙
    try { applyUILang(); } catch (eL) { log("boot: applyUILang failed: " + expErr(eL)); } // 鍒濆鍖栫晫闈㈣瑷€
    ensureBridgeEvents(); // 灏芥棭娉ㄥ唽 HTML 闈㈡澘浜嬩欢(璇诲洖涓婚€氶亾)
    initBakedGameNames(); // btipc07:鍏堣鎵撳寘鍐呯儤鐒欑殑鍏ㄩ噺閰嶅鍚嶅崟(292 鏉?纭紪鐮佸彧鏈?100 鏉?
    // 2026-10-16:鍚姩鍚屾绛夋帰閽堝畾璁哄悗鍐嶅彂(瑙?startCfgSync/waitProbeForSync),t=0 鐩村彂蹇呰蛋鎱㈤€氶亾銆?    try { applyUILang(); } catch (eL2) { log("boot: applyUILang#2 failed: " + expErr(eL2)); } // 鍒濆鍖栫晫闈㈣瑷€(閰嶇疆鍚屾鍚庡簲鐢?
    updateBridgeDot(); // 鍒濆鐘舵€?妗ユ湭涓婄嚎鍓嶆樉绀虹孩鐐?    // https 闈㈡澘閫氶亾鎺㈤拡(2026-10-15 绔嬮」,2026-10-28 鏀圭嫭绔嬫Ы):涓庣炕璇戝崟妲藉苟琛?涓嶅啀璁╄矾閲嶈瘯;
    // 鍒ゆ鍚庣敱涓诲惊鐜寜 HTTPS_PANEL_REPROBE_MS 鑷姩閲嶆帰(瑙?maybeProbeHttpsPanel)銆?    try { $.Schedule(1.2, maybeProbeHttpsPanel); } catch (eP) {}
    try { $.Schedule(2.0, waitProbeForSync); } catch (eW) { startCfgSync(); }
    // EXP6734-B/C/D/E: 鎵嬪姩瑙﹀彂(杩涘灞€鍚庤亰澶╄緭鍏?/bt6734b | /bt6734c | /bt6734d | /bt6734e);6734-A 宸查噰瀹屼笉鑷姩璺?    // DMM 鐢ㄦ埛寮曞:鍚姩鍚?12s 妗ヤ粛鏈湪绾?=> 闈㈡澘鏄剧ず鏈繍琛?+ 瀹夎鎸囧紩
    // COMMUNITY: checkBridgeMissing 宸茬Щ闄?鏃犳ˉ褰㈡€?鏃犳ˉ缂哄け鎸囧紩姒傚康)
    $.Schedule(SLOW_POLL_SECONDS, scanChatMessages);
    // 妗ュ仴搴锋帰娴?姣?5 绉?涓庣炕璇戣姹傚叡鐢ㄤ覆琛岄槦鍒?閲忔瀬灏忎笉褰卞搷缈昏瘧)
    $.Schedule(2.0, function healthLoop() {
      healthCheck();
      $.Schedule(5.0, healthLoop);
    });
    // clearTimeout 璇箟鎺㈤拡(涓€娆℃€?瀹℃煡 F6 娓告垙鍐呭疄娴?:$.Schedule 杩斿洖鐨勫彞鏌勮兘鍚﹁
    // clearTimeout 鍙栨秷,鍐冲畾鏃ч潰鏉块€氶亾 outgoing 瓒呮椂(handleBridgePayload 閲?    // clearTimeout(job._timeout),鍙ユ焺鏉ヨ嚜 $.Schedule)鏄惁浼氭櫄鍒板弻缁撶畻 finishJob
    // 鈫?妲戒綅瓒呭彂(MAX_ACTIVE_REQUESTS=1 琚嚮绌?銆傛瘡娆″惎鍔?1 琛屾棩蹇?涓ょ缁撴灉浜掓枼:
    //   FIRED     = clearTimeout 瀵?$.Schedule 鏃犳晥(椋庨櫓瀹為敜)
    //   CANCELLED = 鍙彇娑?椋庨櫓鎺掗櫎)
    try {
      let _ctFired = false;
      const _ctH = $.Schedule(1.5, function () {
        _ctFired = true;
        log("ctprobe: FIRED (clearTimeout 涓嶈兘鍙栨秷 $.Schedule) typeof setTimeout=" +
            typeof setTimeout + " clearTimeout=" + typeof clearTimeout);
      });
      try { clearTimeout(_ctH); } catch (e) { log("ctprobe: clearTimeout THREW " + expErr(e)); }
      $.Schedule(3.5, function () {
        if (!_ctFired) log("ctprobe: CANCELLED (clearTimeout 鍙彇娑?$.Schedule) typeof setTimeout=" +
            typeof setTimeout + " clearTimeout=" + typeof clearTimeout);
      });
    } catch (e) { log("ctprobe: setup THREW " + expErr(e)); }
    // v2(F6 淇閲囩敤鐨勫彇娑堝櫒):CancelScheduled 璇箟楠岃瘉銆?.6s 鏈瑙﹀彂,鍏堝彇娑?
    // 3.6s 鏃舵姤缁撴灉 鈥斺€?CANCELLED = 淇鍙敤;FIRED = 璇?API 鏃犳晥,闇€鍥為€€鏂规銆?    try {
      let _v2Fired = false;
      const _ctH2 = $.Schedule(1.6, function () {
        _v2Fired = true;
        log("ctprobe2: FIRED (CancelScheduled 鏃犳晥!)");
      });
      if (typeof $.CancelScheduled === "function") { $.CancelScheduled(_ctH2); }
      else { log("ctprobe2: CancelScheduled 涓嶅瓨鍦?淇鏃犳晥,闇€鍥為€€鏂规)"); }
      $.Schedule(3.6, function () {
        if (!_v2Fired) log("ctprobe2: CANCELLED (CancelScheduled 鐢熸晥,F6 淇鍙敤)");
      });
    } catch (e) { log("ctprobe2: THREW " + expErr(e)); }
    // 鏃ュ織缂撳啿鍏滃簳鍐插埛(姣?8 绉?纭繚涓嶄涪鏈€鍚庝竴灏忔壒)
    $.Schedule(8.0, function logLoop() {
      flushChatLog();
      $.Schedule(8.0, logLoop);
    });
  }

  // ---- P4a 鍒嗗尯:鍚戞帰閽堟枃浠?lingua_chat_exp.vjs_c 鍙戝竷鏍稿績椤跺眰缁戝畾(2026-10-12)----
  // 鍚嶅崟涓庢帰閽堟枃浠跺ご鐨勫埆鍚嶅鍏ョ敱鍚屼竴浠借绠楃敓鎴愩€侀€愰」瀵硅处,tests/lc_p4_partition.test.js 閽夋銆?  // 2026-10-28(浠诲姟鈶-1):璁剧疆闈㈡澘鎷嗗垎鍚?闈㈡澘鏂囦欢(lingua_chat_panel.vjs_c)涔熺粡 LCTNS 瀵煎叆瀹夸富绗﹀彿;
  // 瀵硅处璇箟鏀逛负銆屽彂甯?鈯?鍚勬秷璐规柟瀵煎叆鍚嶅崟銆?瑙佸悓涓€娴嬭瘯),杩欓噷杩藉姞闈㈡澘鎵€闇€鐨勫悕瀛椼€?  globalThis.LCTNS = globalThis.LCTNS || {};
  LCTNS.BRIDGE_HOST = BRIDGE_HOST;
  LCTNS.BRIDGE_PORT = BRIDGE_PORT;
  LCTNS.BTIPC = BTIPC;
  LCTNS.CHAT_INPUT_ID = CHAT_INPUT_ID;
  LCTNS.DISPLAY_MODES = DISPLAY_MODES;
  LCTNS.LANGUAGE_OPTIONS = LANGUAGE_OPTIONS;
  LCTNS.LOCAL_CLIENT_ID = LOCAL_CLIENT_ID;
  LCTNS.OUTGOING_MODES = OUTGOING_MODES;
  LCTNS.PROVIDER_OPTIONS = PROVIDER_OPTIONS;
  LCTNS.SETTINGS_PANEL_ID = SETTINGS_PANEL_ID;
  LCTNS.SETTINGS_VISIBLE_CLASS = SETTINGS_VISIBLE_CLASS;
  LCTNS.State = State;
  LCTNS.UI_LANG_OPTIONS = UI_LANG_OPTIONS;
  LCTNS.VERSION = VERSION;
  LCTNS.boot = boot;
  LCTNS.bridgePost = bridgePost;
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
  LCTNS.markCfgDirty = markCfgDirty;
  LCTNS.resolveOutgoingTarget = resolveOutgoingTarget;
  LCTNS.nowMs = nowMs;
  LCTNS.readMessageRow = readMessageRow;
  LCTNS.resolveChatMessages = resolveChatMessages;
  LCTNS.resolveHudMessages = resolveHudMessages;
  LCTNS.resolveLobbyMessages = resolveLobbyMessages;
  LCTNS.safeText = safeText;
  LCTNS.saveUiConfig = saveUiConfig;
  LCTNS.setStatus = setStatus;
  LCTNS.t = t;
  LCTNS.triggerStockSubmit = triggerStockSubmit;
  LCTNS.updateBridgeStatusUI = updateBridgeStatusUI;

  // 瀵煎嚭缁?XML 甯冨眬璋冪敤鐨勫叏灞€鍑芥暟
  // 2026-10-28(浠诲姟鈶-1):璁剧疆闈㈡澘閭ｆ壒(LCTToggleSettings/LCTOnToggle/LCTSave 鈥?宸查殢闈㈡澘杩佸埌
  // lingua_chat_panel.vjs_c,鐢遍偅杈规寕 globalThis 鈥斺€?杩欓噷涓嶈兘鍐?exportGlobal(瑁呰浇鏈熸眰鍊间細 ReferenceError)銆?  // 鏁欒:姣忎釜瀵煎嚭蹇呴』鐙珛 try/catch鈥斺€旀浘鏈夎櫄鏋勪簨浠舵敞鍐屾姏寮傚父琚悶,
  // 瀵艰嚧鍚庣画瀵煎嚭鍏ㄩ儴璺宠繃(鎸夐挳鐐瑰嚮鎶?is not defined)銆?  function exportGlobal(name, fn) {
    try {
      globalThis[name] = fn;
    } catch (e) {
      log("export failed: " + name + " - " + (e && e.message ? e.message : String(e)));
    }
  }
  exportGlobal("LCTOnChatSubmit", function () {
    handleChatSubmit(findChild(getRoot(), CHAT_INPUT_ID));
  });
  exportGlobal("LCTPickUILang", LCTPickUILang);
  // 娴嬭瘯/璋冭瘯閽╁瓙(simtest 鐩存帴璋冪敤;娓告垙鍐呮棤鍓綔鐢?
  exportGlobal("showOutgoingFailTip", showOutgoingFailTip);
  exportGlobal("markBridgeUp", markBridgeUp);

  // 2026-10-28(浠诲姟鈶-1):boot 寤惰繜 0.1s 鈥斺€?璁剧疆闈㈡澘宸叉媶鍒?lingua_chat_panel.vjs_c,boot 閾?  // (applyUILang 鈫?setSelectText/setToggleText/labelFor/closeSelectMenus)闇€瑕侀潰鏉挎寕鐨勫叏灞€銆?  // boot 鍐呴儴鏈氨鏄?Schedule 鎺㈤拡(鏈€鏃?1.2s),寤?0.1s 鏃犲疄璐ㄥ奖鍝?鍙栨秷澶辫触鍒欓€€鍥炲悓姝ョ洿璋冦€?  try { $.Schedule(0.1, boot); } catch (eB) { boot(); }
})();
