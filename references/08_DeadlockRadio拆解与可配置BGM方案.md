# Deadlock Radio v2 拆解 与「可配置条件→音乐」BGM 方案

**生成时间**：2026-10-29 | **子报告 08** | **状态**：取代「纯 vsnd 切片」路线的技术结论
**素材**：
- 主脚本 `F:\ai控制音频\radio_v2_decompiled\panorama\scripts\custom\dlmusic_main_v1_2.js`（3387 行 / 159 KB，下称 **JS**）
- 样式 `...\styles\custom\dlmusic_hud.css`（1368 行 / 22 KB，下称 **CSS**）
- 挂载 `...\layout\base_hud.xml`（14 行，下称 **XML**）
- 原始 VPK `F:\ai控制音频\radio_v2_extract\pak05_dir.vpk`（212 KB）
- 官方简介：GameBanana Mod 720163（`_sText`，下文称 **GB**）
- 对照：`analysis\01_js脚本分析.md`（雨爱切片架构）、`04_HUD检测信号盘点.md`（条件词汇表）、`05_API边界与状态机设计.md`（API 边界）

**标注约定**：
- **【证据】** = 有代码行号或本地文件可直接核对；
- **【推断】** = 由证据类推、未实测；
- **【外部】** = 来自官方简介/社区资料，非本地代码。

---

## 0. 摘要：这一份拆解改了什么结论

### 0.1 三个最关键的修正（对初勘的纠正）

| 初勘说法 | 实际情况 | 依据 |
|---|---|---|
| 「YouTube IFrame API (`loadVideoById`)」 | **没有用 IFrame API**。用的是**真实 youtube.com 网页 + 该网页自带的播放器对象** `document.getElementById('movie_player')`，调它的 `loadVideoById / playVideo / setVolume / nextVideo`。 | 【证据】JS L1319 `function P() { return document.getElementById('movie_player'); }`、L1386 `p.loadVideoById(...)`、L1370 `p.setVolume(vol)` |
| 「消息桥 = 把消息编码进 document.title」 | 不止如此。还有：**70 ms 发送节流 + 40 条队列上限**、**序号 ack/重传（600 ms×12 次）**、**跨域守卫（hostname/protocol）**、**`window.__dlm` 幂等守卫**、**`document.title` 属性劫持 + MutationObserver 防覆盖**、**6 s 静默看门狗 + 自动重注入**。 | 【证据】JS L1083-L1119、L1090-L1100、L1737-L1751 |
| 「体检/联机只是附加项」 | 更重要的发现：**这个 mod 已经实现了「条件 → 音乐行为」的雏形**——战斗检测驱动的**音量自动压低（ducking）**、切出窗口的暂停/静音、以及 4 类 HUD 状态的隐藏。它踩出来的**条件信号清单**可直接搬到我们的规则引擎里。 | 【证据】JS L1907-L1967（ducking）、L1974-L2012（切窗）、L2014-L2065（HUD 状态） |

### 0.2 六条可以直接写进设计文档的事实

1. **「无需编译音频」成立，且有实物证据**：整个 mod 的 VPK 只有 **10 个文件 / 212 KB**，其中**零个音频文件**、零 soundevents、零 vsnd。音乐全部由内嵌 CEF 播放。【证据】`vpkeditcli --file-tree` 输出；对比雨爱 mod 的切片管线（`01_js脚本分析.md`）。
2. **CEF 面板是游戏一等公民，不是黑科技**：游戏自己的新闻弹窗就用 `<CitadelHTMLPanel id="NewsPostWebFrame">`。【证据】`citadel_panorama_decompiled\popups\popup_news_post.xml` L10-L15。
3. **注入的 `javascript:` URL 极其巨大仍可用**：估算单次注入 ≈ **26 KB**（YT 桥）/ ≈ 23 KB（本地文件夹桥）。【证据】按 JS L1081-L1666 的字符串字面量长度累计估算（±10%）。
4. **panorama → 页面 只有一条命令通道**：`cefPanel.SetURL('javascript:'+js)`。**页面 → panorama 也只有一条**：`document.title` → `HTMLTitle` 事件。桥是**双单向**的。【证据】JS L886、L1054；全文无其它 CEF 命令 API。
5. **设置持久化的真实位置是 CEF 的 localStorage（按 origin 分区）**，panorama 侧**仍然没有持久化**：每次握手把 panorama 内存里的设置 JSON 推给页面保存，页面下次把 `dlm_settings` 带回来。这是「用浏览器当硬盘」的绕道方案。【证据】JS L124-L144、L1241、L1247-L1249、L1781-L1794。
6. **不可控外部依赖有 3 个**：YouTube 站点 DOM、Cloudflare Worker 中继（`relay-ckjvp.dlr-k7q2m9x.workers.dev`，密钥硬编码 `anrKvZKLlQaJZu1ScaK9kM9z`）、以及 CEF 运行时本身。参考实现里**前两个挂了只降级不崩**。【证据】JS L11-L13、L1166-L1186、L1224-L1231。

### 0.3 一句话结论（回答任务 6）

**能实现**，而且**推荐「③ 混合架构」：CEF 只当哑巴播放器，panorama 当条件采集器与规则仲裁器**。
理由：**条件只在 panorama 侧存在**（HUD 面板树），**音频能力只在 CEF 侧存在**（任意音源、实时音量、淡入淡出、跳转）。两者之间已有**经过 1.2 版本实战验证的双向桥**（26 KB 注入 + title 回传 + ack 重传 + 看门狗）。剩下的工作量主要在**规则模型 + 配置 UI + 把播放器改造成"可被规则驱动"**，而不是在打通技术上。详见 §7。

---

## 1. 物料事实：这个 mod 到底装了什么

### 1.1 VPK 清单（10 个文件）

```
panorama/images/custom/dlmusic/  dlm_{backward,forward,note,pause,play,quiet,shuffle}.vsvg_c   (7 个图标, 共 ~8 KB)
panorama/layout/base_hud.vxml_c                                                              1.52 KB
panorama/scripts/custom/dlmusic_main_v1_2.vjs_c                                            156.25 KB
panorama/styles/custom/dlmusic_hud.vcss_c                                                   40.73 KB
```
【证据】`vpkeditcli --file-tree pak05_dir.vpk`。

**含义**：
- 没有任何 `soundevents/`、`scripts/soundevents/`、`*.vsnd_c` —— **完全不碰游戏音频管线**；
- 只覆盖 1 个 layout 文件 `base_hud.xml`（Deadlock panorama mod 的标准挂载点，与雨爱 mod 做法一致，见 §6.6）；
- 全部逻辑压在**一个 3387 行的 JS** 里（实际是**两个 IIFE 拼在一个文件**：L1-L2528 是 HUD/播放器/CEF，L2530-L3387 是 ESC 菜单里的设置浮层）。

### 1.2 `base_hud.xml` 覆盖（14 行全文要点）

```xml
<include src="s2r://panorama/styles/base.vcss_c" />
<include src="s2r://panorama/styles/citadel_base_styles.vcss_c" />     <!-- 比雨爱多引了一个 citadel 基础样式 -->
<include src="s2r://panorama/styles/custom/dlmusic_hud.vcss_c" />
<include src="s2r://panorama/scripts/custom/dlmusic_main_v1_2.vjs_c" />
<Panel class="WindowRoot" hittest="false" disallowedstyleflags="hover,descendantfocus">
  <CitadelHud id="Hud" />      <!-- 雨爱写的是 hittest="false"，这里没写 -->
</Panel>
```
【证据】XML L4-L13；对照 `F:\ai控制音频\decompiled\panorama\layout\base_hud.xml` L7-L10。

【推断】这是**全量替换**而非追加：一旦 Valve 给 `base_hud.xml` 加东西（新 include、新根属性），这个 mod 会静默丢掉那些改动 —— 这是"12 月更新兼容性"风险的具体形态（§6.6）。

### 1.3 关键常量表（全部硬编码，无配置入口）

| 常量 | 值 | 行 |
|---|---|---|
| `YT_HOME` | `https://www.youtube.com/` | L9 |
| `YT_LIGHT` | `https://www.youtube.com/robots.txt` | L10 |
| `RELAY_URL` | `wss://relay-ckjvp.dlr-k7q2m9x.workers.dev/r/anrKvZKLlQaJZu1ScaK9kM9z/` | L11 |
| `API_URL` / `API_KEY` | `https://relay-ckjvp.../` / `anrKvZKLlQaJZu1ScaK9kM9z` | L12-13 |
| `MOD_PAGE` | `https://gamebanana.com/mods/720163` | L16 |
| `STEAM_VDF` | `C:/Program Files (x86)/Steam/steamapps/libraryfolders.vdf` | L17 |
| `FOLDER_TAIL` | `/steamapps/common/Deadlock/game/citadel/addons/deadlockradio_music` | L18 |
| `STEAM_GUESSES` | 14 个常见 Steam 库路径（C/D/E/F/G 盘 × Steam/SteamLibrary/Games） | L19-21 |
| `BROWSER_W/H/DX/DY` | `680 / 558 / 243 / 66`（CEF 面板尺寸与偏移，硬编码像素） | L32-35 |
| `BRIDGE_TIMEOUT_MS` | `6000` | L53 |
| `POLL_SEC` | `0.1`（战斗轮询周期） | L1886 |
| `FB_WAIT_MS` | `5*60*1000`（反馈冷却 5 分钟） | L3034 |

**文件开头的注释本身是硬素质**：`// no toLocale*/Intl, crashes panorama`（JS L1）—— Deadlock 的 panorama JS 引擎**缺 `Intl`**，调用 `toLocaleString()` 之类会崩。这条要记进我们的开发守则。

---

## 2. CEF 能力清单（任务 1）

### 2.1 `CitadelHTMLPanel` 实际被用到的 API —— 只有 8 项

| 能力 | 用法（代码原文） | 行 | 性质 |
|---|---|---|---|
| 创建 | `$.CreatePanel('CitadelHTMLPanel', ctx, 'DLMusicCEF')` | L884 | **方法** |
| 取上下文 | `$.GetContextPanel()` → 取到 `base_hud` 的上下文 → 面板是它的**直接子级** | L874 | 方法 |
| 复用查找 | `ctx.FindChildTraverse('DLMusicCEF')` | L877 | 方法 |
| **导航 / 执行** | `cefPanel.SetURL(YT_HOME)` / `SetURL(YT_LIGHT)` / `SetURL('file:///…')` / **`SetURL('javascript:'+js)`** | L895, L900, L940, L976, L1049, **L1054** | **方法（唯一的"执行"手段）** |
| 布局 | `style.width/height/margin/horizontalAlign/verticalAlign` | L801-L805 | 属性 |
| 层级/遮挡 | `style.zIndex`（`browserVisible ? '1000' : '0'`）、`style.opacity`（`0.99` vs `0`） | L806-807 | 属性 |
| 命中 | `cefPanel.hittest = browserVisible` | L808 | 属性 |
| UI 缩放 | `cefPanel.actualuiscale_y`（**只读**，用于反推浏览器 zoom） | L814, L826 | 属性（只读） |
| 事件 | `$.RegisterEventHandler('HTMLTitle', cefPanel, fn)` | L886 | 事件 |

**结论（重要）**：**没有** `ClearScreen / Reload / GoBack / ExecuteJavaScript / SetCookie / SetZoom` 等任何额外方法被用到。【证据】全文 grep `SetURL` 只出现 6 次，见上表；其它 CEF 相关调用为零。

- "重载" = `SetURL` 再导航一次（L1009-L1013 `reloadBrowser` → `LoadSource`）。
- "清屏" = **不存在的概念**；隐藏靠 `opacity:0 + hittest:false + zIndex:0`（L806-808），配合 `<Panel class="DLMBrowserFrame">` 当底板（L879-882，CSS L541-552：690×568、`z-index:999`、深色描边）。
- "缩放页面" = **页面内** `document.documentElement.style.zoom`（L1214），由 panorama 通过 `window.lkZoom(z)` 注入；panorama 侧只负责算倍数。

### 2.2 面板生命周期：三个必须抄的补丁

1. **不要改尺寸，否则白屏**：源码注释 `// dont resize, goes blank till hovered`（L797），`ApplyBrowserStyle` 只在创建/显示切换时设一次固定尺寸（L798-L810）。
2. **必须定期"戳"一下才会重绘**：`RepaintNudge()` 在 0.05/0.3/0.8/1.6 s 四次执行：注入 `lkRepaint()`（页面里 `dispatchEvent(resize)` + 切 class + `scrollBy(±1)`，L1233-L1235）**并**在 panorama 侧把 opacity 在 `1 ↔ 0.99` 之间翻转（L847-L857）。
3. **启动时先上"轻页面"省性能**：`Init` 后 3 s 用 `EnsureCEFPanel(true)`（L2511），先导航到 `robots.txt`（极轻的纯文本页），等玩家真的打开菜单才切到 YouTube（L863-L869 `if (!light && lightPage) { ...LoadSource(S.source); }`）。

【推断】轻页面是一次**性能权衡**：CEF 常驻一个完整 YouTube 页面在 HUD 里，代价是真金白银的帧时间；作者用 robots.txt + 隐藏 + 按需加载来压成本。我们要做常驻 BGM 时，**必须**用"极简自建页面"而不是 YouTube 首页，否则性能不可接受。

### 2.3 HTMLTitle 桥的完整协议（逐层拆）

#### (a) 传输层：`document.title` 的劫持

```js
var titleDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
function setTitle(v) { ourTitle = v; titleDesc.set.call(document, v); }       // L1090-L1093
Object.defineProperty(document, 'title', { configurable:true,
  get: () => ourTitle || pageTitle,
  set: v => { pageTitle = String(v); } });                                     // L1094
new MutationObserver(...).observe(document.head, {childList,subtree,characterData});  // L1095-L1100
```
**要点**：YouTube 自己一直在改 `document.title`（当前视频名），会**冲掉**我们的消息。作者的解法是三层：
把 `document.title` 的 setter 变成"只记录对方的标题"，我们自己的发送走**直接调原型上的 setter**（`titleDesc.set.call`），再加一个 MutationObserver 兜底把 `<title>` 节点内容改回来。
【证据】L1088 的注释原文：`// talk through document.title, yt keeps overwriting it`。

#### (b) 帧格式

```js
function send(t, d) { outQ.push(JSON.stringify({t:t, d:d||{}})); if(outQ.length>40) outQ.splice(0,outQ.length-40); if(!outT) flushOut(); }   // L1111-L1115
```
- 载荷：`{"t":<类型>,"d":{...}}`，**纯 JSON 字符串**（不是 base64 —— 初勘说法需修正）。
- 节流：`flushOut` 保证**每条至少间隔 70 ms**（≈14 条/秒上限），队列**最多 40 条**，超了丢最老的。【证据】L1101-L1110、L1113。
- `document.title` 不止是承载，还兼作**页面加载信号**：任何**非 `{` 开头**的 title 都被 panorama 当作"页面换好了"（L1757-L1763），并据此**立刻重注入桥**（YouTube 侧限 2 s 一次，L1761）。

#### (c) 可靠层：序号 + ack + 重传

```js
var pid = Math.floor(Math.random()*1e9).toString(36), relN = 0, relQ = {};
function sendSure(t,d){ d.q = pid+'-'+(++relN); relQ[d.q] = {...}; send(t,d); }     // L1116-L1118
window.lkAck = function(q){ delete relQ[q]; };                                      // L1118
setInterval(()=>{ for(var k in relQ){ if(++m.tries>12){delete relQ[k];continue;} send(m.t,m.d); } }, 600);  // L1119
```
panorama 侧：
```js
if (data.d.q) { ExecCEF("window.lkAck && window.lkAck('"+q+"')"); if (seenQ[q]) return; seenQ[q]=1; if(++seenCount>400){seenQ={};seenCount=0;} }   // L1769-L1773
```
- 序号 = `pid-relN`（pid 每次页面实例随机，relN 单调）；
- 重传 **600 ms 一次、最多 12 次 ≈ 7.2 s**；panorama 收到即回 ack 并**去重**（`seenQ`，LRU 式满 400 清空）。
- **只有关键消息用 `sendSure`**（bridge/alive/vdf/peer/ver/fbsent/peersent/peerstate），高频流（tick/hb/v/vizstat）用裸 `send`。

#### (d) 消息类型全表（≈28 种，含诊断类）

| 方向 | `t` | 载荷 `d` | 行 |
|---|---|---|---|
| 页→P | `bridge` | `href` + `saved`（localStorage 里的设置） | L1249 |
| 页→P | `alive` | `at`（重注入时的存活探测） | L1083 |
| 页→P | `hb` | `n`（每 ~3 s 心跳计数） | L1435 |
| 页→P | `meta` | `id/title/author/art/fixed` | L1458、L1549、L1638 |
| 页→P | `tick` | `cur/dur/id/u` | L1480、L1663 |
| 页→P | `st` | `playing` | L1481 |
| 页→P | `play` / `pause` | — | L1440-L1441、L1541-L1542 |
| 页→P | `v` | `b`（5 段频谱 0-9） | L1297 |
| 页→P | `viz` / `vizstat` | `ok/why/state/live/sent/zero/vol/muted/tagged/last` | L1261-L1272、L1304 |
| 页→P | `folder` | `count/skipped/first[]/title/formats{}` | L1646-L1647 |
| 页→P | `vdf` | `paths[]`（Steam 库路径） | L1508 |
| 页→P | `cover` | `u`（`data:image/jpeg;base64,…` 96×96） | L1620 |
| 页→P | `tags` | `how/title/artist/pic`（ID3 读盘诊断） | L1631 |
| 页→P | `peer` | `n/h/id/t/off/b/p/age` | L1163 |
| 页→P | `peerstate` | `on/room` | L1172、L1181 |
| 页→P | `peersent` | `off` | L1149 |
| 页→P | `ver` | `v` + `notes`（远程更新公告） | L1226 |
| 页→P | `fbsent` | `ok` | L1230 |
| 页→P | `still` / `resumed` / `joinlate` / `restart` / `unmuted` / `hooked` / `ad` / `error` | 各种状态/诊断 | L1344、L1443、L1388、L1471、L1363、L1442、L1412-L1428、L1364 |
| P→页 | `window.lkPlay/lkPause/lkNext/lkPrev/lkSeek/lkSetVolume/lkFadeTo/lkPlayId/lkSaveSettings/lkZoom/lkRepaint/lkMeta/lkVer/lkFeedback/lkPeer/lkAck/lkRefresh` | 见 §3.4 | L1368-L1400、L1214、L1233-L1234 |

#### (e) 看门狗与状态机

```js
var pageSeen = false, bridgeOk = false, lastBridgeMsgMs = 0, injectCount = 0;
$.Schedule(2.0, BridgeWatchdog);                                     // L892
function BridgeWatchdog(){                                           // L1737-L1751
  if (!Valid(cefPanel)) return;
  if (pageSeen && Date.now()-lastBridgeMsgMs > 6000) {
     bridgeOk = false; injectCount++;
     ExecCEF(BuildBridge());                                         // 重新注入
     lastBridgeMsgMs = Date.now()-6000+2500;                         // 下一次最早 2.5 s 后再试（看门狗每 2 s 一跳）
  }
  $.Schedule(2.0, BridgeWatchdog);
}
```
状态机（作者实际用的三个布尔）：

| 状态 | 置位条件 | 清位条件 | 影响 |
|---|---|---|---|
| `pageSeen` | 收到任一**非 JSON** title（=页面在导航） | `LoadSource` / `OpenFolder` / `OpenVdf` 重置 | 允许看门狗启动 |
| `bridgeOk` | 收到 `bridge` 或 `alive` | 看门狗超时 / `LoadSource` | **所有 P→页 命令都以它为闸门**（`SendZoom` L821、`checkVersion` L1708、`PeerSyncTick` L2238 都先查它） |
| 注入幂等 | — | — | 桥开头 `if (window.__dlm) { send alive; return; }`（L1083-L1084） |

**这套设计解决的真实故障**：YouTube 站内导航（点视频/刷新）会**清掉注入的 JS**，但新页面的 title 会立刻通知 panorama，于是 2 s 内重注入；如果页面卡死（不导航也不发消息），6 s 看门狗兜底。**这就是"javascript: 注入不稳"的工程答案** —— 不稳，但可自愈。

### 2.4 `javascript:` 注入的手法与限制

**手法**：`BuildBridge()`（L1673-L1679）把 `SettingsJson()` + `zoom` 拼成 opts 对象 → 传给 `BuildYTBridge(vol, optsJson, fresh)` 或 `BuildFolderBridge(...)` → 若干字符串数组 `join(' ')` 成**一整段 IIFE**：

```js
function ExecCEF(js) { if (!Valid(cefPanel)) return; try { cefPanel.SetURL('javascript:' + js); } catch(e) {} }   // L1052-L1055
```

**限制（分证据等级）**：

| 限制 | 结论 | 依据 |
|---|---|---|
| **不能出现 `%` 和 `#`** | 硬约束（`%` 会被当百分号转义，`#` 会被当 fragment 截断）。作者为此付出的代价：CSS 选择器**避开 `#id`**（用 `[id=confirm-button]`，L1340；广告选择器全用标签名/类名，L1063-L1070）；字号/颜色都写 `html.dlmnoads` 的 class 派生（L1073-L1075）。 | 【证据】L1078 注释 `// goes in a javascript: url, no % or #`；L1058-L1070、L1340 |
| **长度** | 实测可行 ≈ **26 KB**（YT 桥）/ ≈ 23 KB（本地桥）。上限未知，但 26 KB 已被线上版本验证。 | 【证据+估算】L1081-L1666 字符串长度累计 |
| **必须自带跨域守卫** | 桥第一行就是 `if (location.hostname.indexOf('youtube.com')<0) return;` 或 `if (location.protocol!=='file:') return;`，防止注入误杀到别的页面。 | 【证据】L1080 |
| **必须幂等** | `window.__dlm` 标记；重复注入只回一个 `alive`，**保护 `relQ` 等页面内状态不被重置**。 | 【证据】L1083 |
| **每次注入都是"导航命令"** | 兼作"执行"用；频率实测：音量淡入淡出可 **150 ms 一发**（`PollCombat` L1951），`RepaintNudge` 连发 4 发。 | 【证据】L1951、L854-L856 |
| **语法错误即静默失败** | `try/catch` 吞掉异常（L1054），页面侧无回显 → 只能靠"看门狗重注入 + 页面没有 `bridge` 回来"来间接发现。 | 【证据】L1054 + L1740 |
| **`javascript:` 不受 CSP?** | 【推断】YouTube 页面没拦，`file://` 页面也执行成功（本地模式有 `folder` 消息回来即证明）。自带页面可完全控制 CSP，**自己的页面务必允许 inline/eval 类脚本**，否则注入会失效。 | 【推断】L976→L1646 的实测链路 |

**另外两个"必须抄"的页面侧补丁**：

1. **绕过自动播放策略**：`v.muted = true; v.play().then(()=>{ v.muted=false; })`（L1356-L1366；本地 `<audio>` 同法 L1528-L1535）。Chromium 的 autoplay gate 不拦静音播放。
2. **伪造"页面可见"**：`Object.defineProperty(document,'hidden',{get:()=>false})` + `visibilityState='visible'` + 手动 `dispatchEvent(visibilitychange)`（L1236-L1240）。否则游戏窗口失焦时 Chromium 会节流定时器/暂停媒体。

### 2.5 与游戏原生用法的对照

游戏自己只用 `<CitadelHTMLPanel id="NewsPostWebFrame">` 展示新闻（`popup_news_post.xml` L10-L15），**没有任何游戏侧脚本引用它**（`citadel_panorama_decompiled` 里唯一的 js 是 `popup_settings.js`，全文无 CEF 相关）。

【推断】这有两层含义：
- **好消息**：CEF 是**出厂默认启用**的能力，不需要启动参数/设置；
- **风险**：Valve 只在"看新闻"这种低风险场景用它，**没有**为"比赛内 HUD 里常驻一个第三方网页"做过担保。一旦 Valve 收紧（例如只允许白名单域名、或比赛内禁用），这个 mod 会瞬间失效，且我们无法预防（§6）。

---

## 3. 音频源与播放路径（任务 2）

### 3.1 两条路径的分派

```js
function LoadSource(src) {                     // L1022-L1050
  currentSource = src; pageSeen=false; bridgeOk=false; ...清空 UI...
  if (src === 'folder') { if (S.folderPath) {folderGuess=-1; OpenFolder(S.folderPath);} else {folderGuess=-1; OpenVdf();} return; }
  cefPanel.SetURL(YT_HOME);                     // 否则回 YouTube 首页
}
```
`S.source ∈ {'youtube','folder'}`（L72、L118）。**两条路径共用同一个 CEF 面板、同一个桥骨架**（`BridgeCommon`），只有业务尾巴不同（`BuildYTBridge` vs `BuildFolderBridge`）。

### 3.2 路径 A：YouTube

**工作方式（页面内）**：

| 环节 | 实现 | 行 |
|---|---|---|
| 页面 | 真实 `https://www.youtube.com/`（用户可像浏览器一样浏览、搜索、点视频） | L900 |
| 播放控制 | 取 `#movie_player` → `loadVideoById(id)` / `loadVideoById({videoId,startSeconds})` / `playVideo` / `pauseVideo` / `nextVideo` / `setVolume` / `mute/unMute` | L1319、L1368-L1370、L1378、L1386 |
| 回退 | 若不在 `/watch` 页或无 `#movie_player`：`location.href = 'https://www.youtube.com/watch?v='+id+'&t='+at+'s'` | L1387 |
| 元数据 | `p.getVideoData()` → `{video_id,title,author}`；再 `fetch('/oembed?...')` 校正（注释：切换后 getVideoData 会读到旧值） | L1449-L1467 |
| 封面 | panorama 直接 `SetImage('https://img.youtube.com/vi/<id>/mqdefault.jpg')` | L1702、L1852、L2345 |
| 广告 | 检测 `#movie_player.classList.contains('ad-showing')` → `mute()` + `video.currentTime = duration-0.1` + 点 `.skip` 按钮 + 若 2 s 后仍在广告则 **`loadVideoById` 重载正片并跳回原位**（`mainTime`）；广告期间 `vizHold()` 暂停频谱 | L1401-L1432 |
| 去广告 CSS | 注入样式隐藏 8 类 `ytd-*ad*` 选择器 + `.ytp-ad-*` + `:has()` 组合选择器 | L1063-L1076 |
| 「Continue watching?」 | 每 2 s 检测 `yt-confirm-dialog-renderer`，若视频暂停则点 confirm 并 `playVideo()` | L1335-L1345 |
| 历史（上一首） | 自己维护 `sessionStorage.dlm_hist`（最多 50 条），**不用 `history.back()`**（注释：会离开 YouTube） | L1315-L1317、L1393-L1398 |
| 防"自动播放下一首"漂移 | 换曲后若 `currentTime > 3` 且用户没主动 seek（`seekedAt`）→ 强制 `currentTime = 0` 并上报 `restart` | L1471 |
| 续播 | 每 10 次 tick（≈5 s）写 `localStorage.dlm_last = {id,t}`（仅当 `rememberSong`）；下次启动若 `fresh && rememberSong` → 导航到 `/watch?v=..&t=..s` 并置 `sessionStorage.dlm_resume='pause'` 让其**先暂停**再播 | L1478、L1484-L1491、L1443 |

【证据】全部为代码直读。**这是"寄生在真实站点上"的方案，最大的成本是紧跟 YouTube 的 DOM 变更**（§6.5）。

### 3.3 路径 B：本地音乐文件夹

**发现链（4 级降级，值得整段抄）**：

```
1) 若 S.folderPath 已存 → OpenFolder(folderPath)                              L1045
2) 否则 OpenVdf()：
   a. cefPanel.SetURL('file:///C:/Program Files (x86)/Steam/steamapps/libraryfolders.vdf')   L940
   b. 2.0 s 后若桥未通 → 直接注入文件夹桥（VDF 是纯文本，页面 title 会变成文件名）          L941
   c. 4.5 s 后仍未拿到 vdf 消息 → 放弃，folderGuess=0，试 STEAM_GUESSES[0]+FOLDER_TAIL       L942-L947
   d. 拿到 vdf → 页面正则解析每行 `"path"  "<值>"`（按 `"` 切，取 [3]，`\`→`/`）           L1505-L1508
      → sendSure('vdf',{paths}) → OnVdf 去重 + 与 STEAM_GUESSES 合并                          L950-L964
3) OpenFolder(path)：SetURL('file:///'+encodeURI(path)+'/')（必须带尾斜杠）   L921-L924、L976
   - 4.0 s 内没收到 'folder' 消息 → FolderFailed('no folder page')            L977-L980
   - FolderFailed → folderGuess++ 试下一个候选路径；全试完 → {missing:true}    L983-L992
4) 页面侧判定"这是不是一个目录列表"：document.title 以 'Index of' 开头 → 是  L996
   → send('folder', {count, skipped, first[5], title, formats{canPlayType}})    L1644-L1647
   → panorama 的 FolderPage() 认可后把 folderTrying 写回 S.folderPath 并保存     L1000-L1006
```

**为什么能列目录**：CEF 的 `file:///dir/` 会渲染 Chromium 的**目录索引页**（`<a href>` 列表），页面脚本 `document.querySelectorAll('a')` 即可枚举（L1514）。**这就是全部"本地文件访问"的实现** —— **只读，且仅限目录列举 + 媒体元素加载**。

**支持格式**（白名单 + 运行期探测）：

```js
var AUD = /[.](mp3|m4a|aac|mp4|m4v|ogg|oga|opus|wav|flac|webm)$/i;                 // L1498
var MIME = { mp3:'audio/mpeg', m4a:'audio/mp4', ... flac:'audio/flac', webm:'audio/webm' };  // L1499
function canPlay(h){ var m=MIME[ext]; return !m || probe.canPlayType(m) !== ''; }   // L1512-L1513
```
- 未在 MIME 表里的扩展名**放行**（`!m` → true）；表内有但 CEF 编解码器不支持的 → `skipped++` 并计数上报（L1515、L1647）。
- 实际上报给 UI 的探测结果有 6 项：`mp3/mp4/ogg/wav/flac/webm`（L1647）。
- 【证据】CB 官方说 "**MP3 is recommended**"（GB）—— 与"flac/opus 可能被跳过"的代码路径吻合。

**元数据与封面（纯客户端解析 ID3v2）**：

| 能力 | 实现 | 行 |
|---|---|---|
| 无标签时回退文件名 | `nameOf()` 去扩展名 + 按 `' - '` 拆成 `Artist / Title` | L1526、L1548-L1549 |
| 读 ID3 | `XHR arraybuffer` + 手写解析 `TIT2`(标题) / `TPE1`(艺术家) / `APIC`(封面) | L1574-L1609、L1628-L1643 |
| 仅 mp3 | `if (!/[.]mp3$/i.test(f)) return;` | L1629 |
| 读盘失败 | `x.onerror → say('blocked')`（**说明 `file://` 下的 XHR 有可能被拦**） | L1641 |
| 封面传输 | `Blob → <img> → canvas 96×96 → toDataURL('image/jpeg',0.82)` → `send('cover',{u})` | L1610-L1627 |
| panorama 侧校验 | 正则只接受 `^data:image/jpeg;base64,[A-Za-z0-9+/=]+$` 再 `SetImage` | L1812-L1815 |

**切歌的怪招**：`goTo()` 在"列表超过 30 分钟没刷新"时会写 `localStorage.dlm_folder_next = {name,idx,t}` 然后 **`location.reload()`**（L1519-L1525），重载后从 localStorage 里取回起点（L1648-L1650）。【推断】这是为了绕开某种 `<audio>` 长会话/内存问题或 CEF 卡顿的土办法；代价是每次切歌一次整页重载（有白屏与断音）。

### 3.4 播放控制映射表（"player API"）

| 用户动作 | panorama 侧 | 注入调用 | YT 实现 | 本地实现 |
|---|---|---|---|---|
| 播放/暂停 | `TogglePlayPause` L549-L554 | `lkPlay()` / `lkPause()` | `p.playVideo()` / `p.pauseVideo()` L1368-L1369 | `au.play()`/`au.pause()` L1553-L1554 |
| 下一首 | （HUD 按钮） | `lkNext()` | 先点 `.ytp-next-button`，否则 `p.nextVideo()` L1378 | `goNext()`：`played[]` 记录 + 可选 shuffle L1560 |
| 上一首 | — | `lkPrev()` | 若 `currentTime>3` 回 0；否则取自维护历史 L1390-L1399 | 同理 + shuffle 时回退 `played.pop()` L1562 |
| 拖动进度 | Slider `onvaluechanged` → `DragTo` L594-L612 | `lkSeek(sec)` | `video.currentTime = min(sec, dur-3)` L1379 | 同 L1564 |
| 音量 | `PollCombat` 的 `CurrentGain()` | `lkSetVolume(v)` / `lkFadeTo(to,sec)` | `p.setVolume(v)` 或 `video.volume=v/100` L1370 | `au.volume=v/100` L1565 |
| 淡入淡出 | 计算 `sec`（进/出战斗分别用 `fadeOutSec`/`fadeInSec`，否则 0.3 s） | `lkFadeTo` | 50 ms 步进线性插值 L1372-L1377 | 同 L1566-L1571 |
| 静音（快捷） | `ToggleQuiet()` 点击封面：`quietVol` ↔ `normalVol` | 走 `PollCombat` 的 `target` | — | — L689-L694、L1943 |
| 随机 | `ToggleShuffle()` | — | 无（YouTube 自己的播放列表） | `nextIdx()` 8 次拒绝采样 L1555-L1559 |
| 刷新列表/重载 | `reloadFolder/reloadBrowser` L1009-L1020 | `lkRefresh()` | — | `goTo(idx,cur,true)` 或 `location.reload()` L1563 |
| 页面缩放 | `cycleZoom` [0,50,75,100,125,150]（0=Auto） | `lkZoom(z)` | `documentElement.style.zoom = z` + 网格列数补偿 L1202-L1216 | 同（共用 BridgeCommon） |
| 静音判定（切窗） | `S.tabMode` = `mute/pause/play` L1944、L1978-L1985 | `lkPause/lkPlay` | — | — |

**关键差异**：**YouTube 路径没有"随机播放"**（`shuffle` 只作用于本地文件夹，见 L1556），也**没有真正的"下一首队列"** —— 全靠站点自身推荐。

### 3.5 元数据/进度回传链（页 → HUD）

```
YT: 每 500 ms → send('tick',{cur,dur,id,u})            L1480
    getVideoData 变化 → send('meta',{id,title,author})  L1458  →（oembed 校正，L1465）
    panorama: SetTitle/SetArtist(清理 ' - Topic','VEVO'，L576-L580)
              CheckArtId 400 ms 防抖 → SetImage(img.youtube.com/vi/<id>/mqdefault.jpg)  L1694-L1703
              CheckMetaId 2 s 内不一致 → 注入 window.lkMeta() 让页面重报  L1682-L1691
本地: 每 500 ms → send('tick',{cur,dur})                L1663
    load() 时 send('meta',{title,author} from 文件名)    L1549
    ID3 读完再 send('meta',{fixed:true,...}) + send('cover')  L1638、L1620
```
- **进度条是本地插值 + 网络校准**：`prog={cur,at}`，`ProgressTick` 每 30 ms 用 `cur + (now-at)/1000` 外推（L653-L659），`tick` 到达时重置基准；拖动时 2.5 s 内忽略回传（L645-L651）。
- `sync` 防抖：`SyncPlaying` 在 1.5 s 内忽略相反状态（L544-L547），避免"用户刚点暂停、旧 tick 又把它设回播放"的抖动。

---

## 4. 设置与持久化（任务 3）

### 4.1 `dlm_settings` 全字段（36 项，默认值 = 代码初值）

```js
var S = {                        // L71-L103，字段顺序即原顺序
  source:'youtube',              // 音源: 'youtube' | 'folder'
  folderPath:'',                 // 本地音乐目录绝对路径（用 / 分隔）
  normalVol:30, quietVol:10,     // 百分比（0-100），交给 lkSetVolume
  duckEnabled:true, combatVol:10,// 战斗压低开关与目标音量
  fadeOutSec:0.5, fadeInSec:2.0, // 进/出战斗的淡变时长
  holdSec:3.0,                   // 离开战斗后维持压低的秒数
  tabMode:'mute',                // 'mute' | 'pause' | 'play'（切出窗口行为）
  skipAds:true,                  // YouTube 去广告
  artBorder:true, borderStyle:'gold', gloss:40,
  sheen:true, sheenSec:1.2, sheenDelayMin:4.0, sheenDelayMax:9.0,
  visualizer:true, vizPos:'left', vizSens:100, vizSmooth:50,
  shareSongs:false,              // 联机共享总开关（默认关）
  showHud:true, showArt:true, playerStyle:'full',   // 'full' | 'minimal'
  rememberSong:false,            // 续播
  shuffle:true,                  // 仅本地文件夹有效
  browserZoom:0,                 // 0=自动, 50/75/100/125/150
  fbAt:0,                        // 上次反馈时间戳（5 min 冷却）
  lastTab:'playback'             // 上次打开的设置页
};
```
【证据】L71-L103；`DEFAULTS = JSON.parse(JSON.stringify(S))`（L104）用于重置（L146-L153）。

### 4.2 存哪、何时写、怎么读回

**存储位置：CEF 的 `localStorage['dlm_settings']`（页面侧写，L1241 `saveOpts`）。**

写入链（panorama 是"主副本"，localStorage 是"落盘副本"）：

```
用户改设置 → DLMusic.settingsChanged()                        L132-L144
  → settingsTs = Date.now()（单调时间戳，冲突仲裁用）
  → 0.6 s 去抖（saveQueued）
  → ExecCEF('window.lkSaveSettings(' + SettingsJson() + ')')   // JSON 里带 _ts
      → 页面 opts = o; saveOpts() → localStorage.setItem('dlm_settings', ...)   L1241
```

读取链（每次桥握手）：

```
页面启动 → BridgeTail(): send('bridge', {href, saved: localStorage.dlm_settings})   L1247-L1249
panorama 'bridge' 分支: if (data.d.saved) ApplySavedSettings(data.d.saved)          L1785
ApplySavedSettings(): if (saved._ts <= settingsTs) return;   // 只接受更新的副本     L110-L111
                      逐字段类型校验后覆盖 S                                        L115-L117
```

**跨会话是否保留？**
- **YouTube 路径：是。** 每次启动先开 `robots.txt`（仍在 `www.youtube.com` origin，L10）→ 桥握手 → 页面把 `dlm_settings` 带回来 → `ApplySavedSettings` 生效。**但注意**：`robots.txt` 与首页同 origin，所以 localStorage 是同一份。
- **本地文件夹路径：不确定。** `file://` 是**另一个 origin**（且 Chromium 对 `file://` 的 localStorage 常有额外限制/隔离）。恰好这个 mod 的 `BridgeTail` 也读 `dlm_settings`，而 `BuildFolderBridge` 又用注入带去的 `opts` 兜底（L1232 `fresh` + L1651 `mine = localStorage.dlm_settings`），所以**即使 file:// 的 localStorage 是空的，播放器也能工作**（用的是 panorama 在注入时塞进 `opts` 的副本）。
- 【推断】**"设置真的跨会话保留"这件事，YouTube origin 上有较强制约（有 `_ts` 仲裁 + `rememberSong` 的实测文案"next time you start the game"），`file://` origin 上属于"未验证"。** 这是我们要自己做的能力，必须实测（§7.7 E3）。

### 4.3 重置 / 导入导出

| 能力 | 实现 | 行 |
|---|---|---|
| 重置 | `DLMusic.resetSettings()`：遍历 `DEFAULTS` 覆盖，**保留 `fbAt`**（防刷），再 `settingsChanged()` 落盘 | L146-L153 |
| UI 防误触 | "Reset to defaults" 需**3 s 内点两次**（文案变 "Click again to reset"） | L3174-L3185 |
| 版本迁移 | `if (saved.tabMode === undefined && saved.playWhenTabbedOut === true) saved.tabMode='play';`（1.1→1.2 字段改名兼容） | L113 |
| 导入/导出 | **没有**。UI 里没有任何"导出配置"入口。 | 【证据】全 UI 构建 L3105-L3343 |
| 其它 localStorage 键 | `dlm_last`（YT 续播 id+t）、`dlm_last_f`（本地续播 name+t）、`dlm_folder_next`（切歌重载跳板）；`sessionStorage`：`dlm_hist`、`dlm_keep`、`dlm_resume` | L1478、L1665、L1523、L1315、L1329-L1330、L1443 |

**结论**：作者**没有**找到 panorama 侧持久化（与 `05` 报告 §A.4 一致：无 convar、无文件写），他的答案是**"把 localStorage 当配置盘"**。我们要做「玩家自选规则」，这条是**唯一现成的持久化路径**，但它有 origin 分裂与不透明的问题（§7.4）。

---

## 5. 联机同步（任务 4）

### 5.1 架构

```
[我的 CEF 页面] --WSS--> [Cloudflare Worker 中继] <--WSS-- [队友的 CEF 页面]
     AES-GCM 加密载荷（密钥由房间名派生）       仅做转发/年龄戳/ping-pong
```

### 5.2 协议细节

| 环节 | 实现 | 行 |
|---|---|---|
| 地址 | `wss://relay-ckjvp.dlr-k7q2m9x.workers.dev/r/<API_KEY>/` + **房间名（sha256 hex）** | L11、L1168 |
| 房间名派生 | `sha256('dlr-room|' + src)`，**src = 本场 10 名玩家的 `name` 小写、排序、`\n` 连接**（<2 人则不组房） | L1192、L2196-L2200 |
| 房间切换去抖 | 名单变化后需**稳定 45 s** 才真正换房（`room.since`） | L2201-L2207 |
| 加密 | `key = SHA-256('dlr-note|' + API_KEY + '|' + room)` → `AES-GCM`；`iv = crypto.getRandomValues(12B)`；报文 = `base64(iv‖ciphertext)` | L1196-L1198、L1146-L1149 |
| 发送节流 | **两条 note 至少间隔 2200 ms**（注释：`relay drops notes < 2s apart`） | L1138-L1140 |
| 载荷 | `{h:英雄, n:名字, c:'y:<11位视频id>', t:标题60字, b:边框样式, p:播放位置, off:1}` | L1144、L2228 |
| 接收 | `t.length>600` 丢弃；`<29` 字节丢弃；解出后做**白名单校验**（视频 id 正则、边框枚举、`p<36000`、去控制字符） | L1152-L1164 |
| `age:` | 中继在转发前发一行 `age:<ms>`，页面缓存 `peer.age`，附在 `peer` 消息里 → panorama 给 card 做时间对齐（`PeerStartAt`） | L1176、L2250、L2361-L2364 |
| ping | `ws.send('ping')` **每 240 s**；中继回 `'pong'` | L1174、L1176 |
| 重连 | backoff `[8s, 30s, 120s, 300s]`，**最多 5 次**，然后放弃 | L1182-L1184 |
| 退订/关闭 | `peerstate{on:false}` → panorama `ClearPeers()` 清空卡片 | L1181、L1833 |

### 5.3 联动数据流（我方 → 队友看到）

1. `PeerSyncTick()` 每 1 s：算房间 → 用 `FindMe()` 找到**自己的名字**（`CitadelAvatarImage.accountid` ↔ `CitadelUserName.accountid` 匹配，L2152-L2177）→ 用名字在 TopBar 的 `CitadelHudTopBarPlayer` 列里定位自己的行（L2102-L2128）；
2. 歌名/视频 id 稳定 **10 s** 后才组 note（L2227-L2229）；
3. `ExecCEF("window.lkPeer('<hexRoom>','<hexNote>',<shareSongs>)")`（L2237-L2240）；
4. 队友侧：`peer` 消息 → `OnPeer` 存 `DLMusic.peers`（L2245-L2251）→ **只在他按住 Tab 时**才创建/定位卡片（`PeerTick`，L2385-L2419：`GetPositionWithinWindow()` + `actualuiscale_x` 换算，贴在队友英雄头像下方 6 px）；
5. 点卡片 → `PlayPeer()` → `lkPlayId(id, at)`（**从对方所在位置续播**，L2361-L2383）。

### 5.4 外部依赖评估（重要）

| 依赖 | 挂掉的表现 | 用户可见 | 代码证据 |
|---|---|---|---|
| Cloudflare Worker 中继 | `ws.onclose` → 最多重试 5 次（8s→300s）→ 彻底放弃；**永不显示错误 UI** | 只是"Sharing: connected"日志不出现、别人看不到你的歌 | L1177-L1185、L1834 |
| Worker 的 `/v/<key>`（版本+公告） | `fetch` 失败静默；`verGot` 永远 false；顶栏更新链接不出现；**更新公告页退回内置 changelog**（`BUILTIN_NOTES`） | 无感 | L1224-L1227、L1705-L1712、L2911-L2915、L2986-L2987、L3298 |
| Worker 的 `/f/<key>`（反馈） | 15 s 超时 → 显示 "Failed, try again later" | 可见 | L1228-L1231、L3066 |
| YouTube 站点 | `bridge` 通 → 页面加载失败时 title 仍是 `youtube.com`，桥注入后 `V()` 为 null → 无 tick → 播放器一直显示空 | 可见（无歌） | L1320、L1436 |
| **以上都不影响本地文件夹播放路径** | — | — | 【证据】文件夹桥不引用 RELAY/API |

**结论**：中继属于 **"可控的不可控依赖"** —— 它只承载"锦上添花"的社交功能，**主功能（放歌）不依赖它**，且失败完全静默降级。**我们做 BGM mod 时不应复制这个依赖**（没必要）。

【推断】安全角度：房间名 = 对"全队玩家名排序串"的哈希，**可被任何人算出**（玩家名在比赛里公开）→ 房间**不是私密的**；内容用 `API_KEY` 派生的密钥加密，但 `API_KEY` 是**硬编码在已发布的 JS 里**（`anrKvZKLlQaJZu1ScaK9kM9z`，L11-L13）→ 实际上**只是混淆，不是保密**。作者的用法（只传"在听什么歌"）风险很低，但**不要**把这套协议当成隐私通道。

---

## 6. 风险与边界（任务 5）

### 6.1 CEF 是否默认可用 —— 是

【证据】游戏自己的 `popup_news_post.xml` 用 `CitadelHTMLPanel` 展示新闻；`GB` 官方简介**没有任何"需要开启某设置/加启动参数"的说明**，只说了安装与使用。
【推断】CEF 在 Windows 正式客户端**默认启用**，无需 `-cef`/`-html` 之类参数。

### 6.2 已知的平台限制（作者自己写在简介里）

| 现象 | 原文 | 影响 |
|---|---|---|
| **Linux/Proton 必崩** | "To linux users: This mod wont work for you and **will crash your game**. I'm sorry :(" | 硬限制，与 CEF 在 Linux 下的实现有关；我们的 mod 同样要面对（要么不做 Linux，要么给 Linux 走 vsnd 分支） |
| **Spotify 不支持** | "Spotify is not supported. The game's built-in browser **cannot play** Spotify." | 【推断】DRM（Widevine）不可用 → **任何受 DRM 保护的服务都不行**（Spotify/Apple Music/部分 SoundCloud 曲目） |
| **录音需"桌面音频"** | "The music is played through Deadlock's built-in browser" → 录游戏窗口音频**录不到音乐** | 【推断】CEF 音频**不在游戏音频混音总线里** → 意味着**游戏内音量/静音可能也管不到它**（未实测，见 §7.7 E5） |
| 卡住了怎么办 | "press **Reload** … or **Reset to Defaults**" | 官方承认"会卡" |

### 6.3 `file://` 的权限边界：**只读，而且很可能只是"目录列举 + 媒体加载"**

- **能读**：`file:///dir/` 目录索引（L976 + L996 `Index of`）、`<audio src=file://…>`（L1546）、`<img>` Blob（封面）、`XHR` 读 mp3 头部（L1630，**但代码自己留了 `x.onerror → 'blocked'` 分支**，L1641）。
- **能写**：**没有**。没有任何写文件 API；`localStorage` 虽在 `file://` 下可写，但那是 CEF 自己的存储目录，**不是**音乐目录（不能拿它当"导出配置到指定路径"）。
- 【推断】Chromium 对 `file://` 有"同目录/同源"限制：`file:///A/` 的页面去 XHR `file:///B/x.mp3` 可能被 CORS 拦 → **跨目录读文件不可靠**（这解释了为什么音乐必须放在固定的 `addons/deadlockradio_music` 里，且封面读取会 `blocked`）。
- **反向风险**：`file://` 页面能列**任意**路径的目录（只要路径已知）。作者用它列 `libraryfolders.vdf` 与音乐目录；**理论上**能列 `C:/`。这属于"用户自己装的 mod 读自己机器"，但也是这类 mod 被质疑"越权"的技术点，**我们的实现要主动限制在自己目录内**。

### 6.4 反作弊 / 官方政策

【外部】Deadlock Mod Manager 官方 FAQ：「Deadlock currently allows client-side modifications that don't affect gameplay balance or provide unfair advantages… Cosmetic mods (skins, UI changes) are generally safe… Use at your own discretion – mod policies can change。」
【推断】BGM 播放器属于"纯客户端、纯表现层"，**不提供竞技优势** → 处于当前政策允许区间；且它**不注入游戏进程、不改内存**（只放一个 panorama addon VPK），与 VAC 的检测面不同。但：
- 这只是"社区共识 + 官方默认容忍"，**没有 Valve 的书面保证**；
- 该 mod 会**主动发起对外网络连接**（YouTube、Worker）—— 若将来 Valve 收紧"客户端外联"，这类功能首当其冲；
- **CEF 加载第三方网页**是最"扎眼"的部分（可被理解为"在游戏里开了个浏览器"）。**保守做法**：只允许本地 `file://` 页面 + 用户自带音乐，YouTube 作为可选开关默认关闭。

### 6.5 注入 `javascript:` 的稳定性

**结论：可用，但必须按 §2.3/§2.4 那套"自愈"模式写**。已知失败面：
1. 站内导航/刷新 → 注入丢失（**已解**：非 JSON title 触发重注入，L1757-L1761）；
2. 页面卡死 → 6 s 看门狗（**已解**，L1737-L1751）；
3. 页面改版导致选择器失效 → **无解**，只能跟版本（这是 YouTube 路径的固有成本）；
4. 语法错误静默（`try/catch`，L1054）；
5. `%`/`#` 编码陷阱（L1078）；
6. **重复消息可能丢**：【推断】`document.title` 赋**相同值**不触发 `HTMLTitle`，所以作者让每条消息都带变化字段（`hb.n`、`tick.cur`、`alive.at`、`q` 序号）。我们自己设计协议时必须给每条消息加**单调序号**。

### 6.6 版本更新兼容风险（12 月大版本）

三层脆弱点，按危险度排序：

| 层 | 脆弱点 | 崩了会怎样 | 缓解 |
|---|---|---|---|
| **① `base_hud.xml` 全量替换** | Valve 若改动该文件（新增 include/根属性/Hud 属性），mod 版会**静默覆盖掉** | HUD 某功能异常、或 mod 自身加载失败 | 每次更新后**重新反编译游戏原文件对比**（本次已建立流程：`citadel_panorama_decompiled`）；把差异合并进我们的 `base_hud.xml` |
| **② HUD 面板 id/class** | `InCombatAlert`、`damage_meter`+`out_of_combat`、`AbilitiesContainer`+`gScoreboardOpen/gShopOpen/gDetailView/gItemDraftOpen`、`gameplay_hud_alive`、`EscapeMenu`+`ShowEscapeMenu`、`TopBar`/`CitadelHudTopBarPlayer`、`CitadelAvatarImage.accountid`、`CitadelUserName.accountid`、`PlayerNameNWContainer`、`CitadelHudQuickbuy`、`gold_and_ap_container` | 条件检测静默失效（`DetectCombat` 会返回 false，且 `combatDebug` 字符串里写"n/a"）；共享找不到自己的名字 | 代码已用"找不到就重试/降级"的写法（`Valid()` + 3~5 s 重查，L2104、L2426）；**我们要加"信号自检 + 面板显示状态"**，让玩家能看出"这个条件现在读不到" |
| **③ YouTube DOM** | `#movie_player`、`getVideoData`、`ytp-next-button`、`ad-showing`、`yt-confirm-dialog-renderer`、`ytd-rich-grid-renderer` | YouTube 路径整体失效（本地文件夹路径不受影响） | 不修；改为**自建播放页**（§7.2） |

`base_hud.xml` 这条有直接对照：雨爱 mod 的同名文件只有 `base.vcss_c` + 自己的 js（`decompiled\panorama\layout\base_hud.xml` L3-L7），Radio 多引了 `citadel_base_styles.vcss_c`、且 `CitadelHud` 少了 `hittest="false"` —— **说明这个文件是"各家自己抄一份"的，没人能保证跟上 Valve**。

### 6.7 作者在 UI/Help 里写明的已知问题（Troubleshoot 文案原文）

| 位置 | 原文 | 解读 |
|---|---|---|
| Help · 使用 | "The player sits next to your abilities. **Hold Tab** to use the buttons or drag the progress bar." | 比赛内 HUD 上的控件**只有在按住 Tab（记分板）时才可点** → 印证 `hittest` 在 HUD 上受限；我们的规则 UI 也应在**ESC 菜单**里，而不是 HUD 上 |
| Help · 战斗 | "The music will get quieter while you're in combat and will come back afterwards." | 已实现 ducking |
| Help · 自有音乐 | "Make a folder called `deadlockradio_music` in `Deadlock\game\citadel\addons` … **If it can't find your folder, copy the folder's location and paste it into the Folder box.** If your files are named **Artist - Title**, both will show." | 目录自动发现**会失败**，必须有"手工粘贴路径"兜底（对应 L1045/L984-L992 的降级链） |
| Help · 排障 | "Press **Reload** at the top of the Browser tab. If that doesn't fix it, press **Reset to defaults**." | 作者承认状态会卡死，只提供"重载/重置"两颗按钮 |
| 版本日志 1.2 | "YouTube's 'Continue watching?' pop-up gets answered for you."、"Album art and titles **don't get stuck** on the old song anymore"、"Visualizer fixes" | 说明**元数据串台/卡死**是这类桥的常见病（对应 `CheckMetaId` L1682、`lkMeta` L1327、oembed 校正 L1463） |

---

## 7. 综合方案：玩家自选「条件 → 音乐」（任务 6）

### 7.1 三种架构对比

| 维度 | **① 纯雨爱式**（vsnd 切片 + 条件状态机） | **② CEF 播放任意音乐 + 条件驱动** | **③ 混合：CEF 放音乐 + panorama 做条件与仲裁**（推荐） |
|---|---|---|---|
| 音源 | 只有打进 VPK 的切片 | 任意（YT / 本地文件 / 直链） | 同 ② |
| 玩家自选音乐 | **不能**（要作者切片编译） | **能**（自己丢文件 / 贴链接） | **能** |
| 动态音量/淡变 | **没有**（`05` §A.5：无音量 API，只能烘焙包络） | 有（`setVolume` + 50 ms 步进淡变） | 有 |
| 跳转/进度/元数据/封面 | 无 | 有（tick/meta/cover） | 有 |
| 音频资产体积 | ~10 MB / 分钟 / 状态（`05` §B.4） | **0**（VPK 212 KB 实证） | **0** |
| 条件来源 | panorama 轮询 HUD（唯一） | panorama 轮询 HUD（唯一） | panorama 轮询 HUD（唯一） |
| 条件→音乐 的耦合度 | 紧耦合（状态机直接选事件名） | 松耦合但**逻辑散在注入脚本里** | **清晰分层**：规则引擎 ↔ 播放器 API |
| 实现难度 | **高**（每首歌一条切片+编译+事件表管线） | 中（桥已现成，但要写规则逻辑进注入串） | 中（复用现成桥，新增规则层与播放器 API） |
| 能力上限 | 低（只能播自己的歌、硬切、无音量） | 高 | **最高**（还能保留 vsnd 作为兜底音源） |
| 主要风险 | 包体爆炸、更新重编译、无音量 | CEF/YouTube 依赖、Linux 崩、注入脆弱 | 同 ②，但**可降级**（CEF 挂了回退 ①的少量关键切片） |
| 离线可用 | 是 | 本地文件夹路径可以；YT 不行 | 可以（本地路径） |

**为什么 ① 不应作为主路线**：它的每一种能力（换歌/音量/淡变/进度）都要**重新走一遍编译管线**，而"玩家自选音乐"这个需求本身就与"预先切片编译"互斥。① 的正确定位是**兜底与增强**：CEF 不可用（Linux）或玩家不想联网时，用 1~3 段关键切片播"低血量环境音"。

**为什么 ② 单独用不够**：条件计算必须在 panorama 侧（HUD 面板树），而 ② 的字面实现会把"规则判断"塞进 26 KB 的注入串里 —— 每改一条规则就要重新注入整个播放器，日志/调试都在页面里，**不可维护**。

### 7.2 推荐架构 ③：模块划分

```
┌────────────────────── panorama (vjs_c) ───────────────────────┐
│  SignalHub   每 100~500 ms 轮询 → 原子信号（§7.5 表）           │
│  RuleEngine  信号 → 去抖/滞回 → 规则匹配 → 仲裁 → 目标状态        │
│  PlayerAPI   状态 → 一条 lkApply(...) 注入命令（批量化）          │
│  UiBridge    ESC 菜单注入（现成 L2579-L2726 可直接复用）          │
│  Persist     ↔ CEF localStorage（dlm_rules / dlm_settings）      │
└───────────────────────────────┬────────────────────────────────┘
                 SetURL('javascript:lkApply({...})')  →   |   ←  document.title JSON
┌───────────────────────────────┴────────────────────────────────┐
│  cef player.html  （自建极简页，file:// 或 data:）                │
│   SlotPlayer:  多音源槽位、<audio>/YouTube、淡变、预加载、交叉淡化   │
│   Reporter:    tick/meta/cover/state 回传（复用 tick/meta 协议）   │
└────────────────────────────────────────────────────────────────┘
```

**关键设计决策：不再寄生 YouTube 首页，自建 `player.html`。**
理由：① 26 KB 注入串可以缩短到 3~5 KB（页面自己实现播放器）；② 摆脱 YouTube DOM 的版本风险；③ 页面可以是**我们自己的规则编辑器**（HTML 表单远比 panorama 的 `TextEntry` 好用，且**没有 500 字符上限**）；④ `file://` 页面可以与音乐文件同目录，**避免跨目录 CORS**。

代价：① 需要用户有本地文件，或接受"贴 YouTube 链接走 `youtube.com/embed`"（iframe 方案，需实测是否被 CEF 允许）。
【推断】YouTube 官方 embed（`https://www.youtube.com/embed/<id>?enablejsapi=1`）在 CEF 里**可能可用**（Lockify 的"play any direct web stream"说明网络流可以；embed 是否被 X-Frame 限制无关，因为它是顶层页面）。**必须实测**（§7.7 E7）。若不行的降级是：保留 Radio 的"寄生 youtube.com"作为可选模式。

### 7.3 「条件 → 音乐」的数据模型（规则表 schema）

#### 7.3.1 规则一条 = 一个"音乐槽位 + 触发条件 + 时间行为"

```jsonc
{
  "id": "lowhp_duel",
  "name": "残血对决",
  "enabled": true,
  "priority": 70,                 // 数字越大越优先；同优先级比"条件个数"，再比"进入时间新"
  "when": {                       // ★ 布尔树：all/any/none + 原子条件（可嵌套，深度限 3）
    "all": [
      { "sig": "hp.pct",     "op": "lt",  "v": 0.50, "enterSec": 1.0, "exitSec": 1.0, "exitV": 0.60 },
      { "sig": "hp.dropRate", "op": "gte", "v": 15,  "windowSec": 1.0, "enterSec": 0.5, "exitSec": 2.0, "exitV": 5 }
    ],
    "none": [ { "sig": "self.dead", "op": "eq", "v": true } ]
  },
  "hold": { "minSec": 3, "maxSec": 0, "cooldownSec": 8 },   // 最短驻留 / 最长（0=不限）/ 退出后冷却
  "music": {
    "slot":   "A",                       // 槽位：A=主 B=过渡 C=氛围…（每槽独立播放器）
    "source": "folder",                  // folder | url | yt | playlist
    "target": "combat/",                 // folder: 子目录或文件名数组；url: 直链；yt: 视频 id 数组
    "pick":   "shuffle",                 // first | shuffle | sequential | match:<正则>
    "startAt":{"mode":"crossfade","sec":1.5},
    "loop":   true,
    "stopOthers": true
  },
  "volume": { "gain": 100, "duck": { "target": 40, "fadeSec": 1.0 } }
}
```

#### 7.3.2 条件原子（最小闭集 + 扩展）

| sig | 类型 | 来源（panorama 侧） | 评级 |
|---|---|---|---|
| `hp.pct` | 0~1 | `.currentHealthLabel` / `.totalHealthLabel`（雨爱已验证） | A |
| `hp.dropRate` | 点数/秒 | 上式派生（0.1 s 采样差分） | A |
| `combat.in` | bool | `#InCombatAlert` 向上 12 层找 `.inCombat`（**Radio 实证**，L1909-L1912） | A |
| `letcombat.out` | bool | `#damage_meter` 向上 20 层找 `.out_of_combat`（Radio 实证，L1913） | A |
| `self.dead` | bool | `#gameplay_hud_alive.visible === false`（Radio 实证，L2055） | A |
| `respawn.count` | int | TopBar 各列 `.RespawnTimer` 非零条数（报告 04 A 级） | A |
| `kills.friend` / `kills.enemy` | 差分 | 顶栏 `FriendlyKills` / `EnemyKills`（报告 04 A 级） | A |
| `scoreboard.held` | bool | `#AbilitiesContainer` 有 class `gScoreboardOpen`（Radio 实证，L2046） | A |
| `shop.open` / `build.open` / `draft.open` | bool | `AbilitiesContainer` 的 `gShopOpen` / `gEditingBuilds` / `gDetailView` / `gItemDraftOpen`（Radio 实证，L2014、L2435） | A |
| `esc.open` | bool | `#EscapeMenu` 及其祖先有 `ShowEscapeMenu`（Radio 实证，L2024） | A |
| `tabbedout` | bool | 帧时间稳定落在 22~32 ms（Radio 实证，L1988-L2012） | A（但受刷新率影响，见 §7.7 E8） |
| `gametime.sec` | int | `Label.GameTime` 解析（报告 04 A 级） | A |
| `lowhp.banner` | bool | `#LowHealthWarning` 可见性（报告 04） | A |
| `damaged.recent` | bool | `.damageImpactInstance` 存在/透明度、`#damage_indicator_canvas` 子项（报告 04） | A/B |
| `networth.diff` | int | 顶栏 `{s:team_networth}` 两队差（报告 04 A） | A |
| `buff.count` / `buff.has:<name>` | int/bool | `.modifier` + `.modifier_name`（报告 04 A/B） | A/B |

**规则引擎行为（去抖/滞回/仲裁）**，全部是纯 JS，无需新 API：

```
tick(0.1s):
  for atom in atoms: raw = read(); atom.state = debounce(raw, atom.enterSec/exitSec, exitV)
  matched = rules.filter(r => evalTree(r.when, atoms) && !r.cooldown)
  if (!matched) → 回到 base 规则
  winner = matched.sort(priority desc, condCount desc, enteredAt asc)[0]
  if (winner.id !== current.id) {
      if (now - current.enteredAt < current.hold.minSec) skip      // 最短驻留
      else → 交叉淡化到 winner（fade = winner.music.startAt.sec）
  }
```

**为什么"滞回"必须双阈值**：`hp.pct` 就一个标签，机械抖动会疯狂切歌 —— 报告 04/05 已有结论（进入 1 s 确认、退出用 0.60 高阈值、`holdSec` 兜底）。Radio 的 ducking 用 `holdSec=3 s` 解决的是同一个问题（L1938-L1939），**可以直接照抄这个思路**。

#### 7.3.3 音乐槽位绑定

- **槽位 = 独立播放器实例**（独立的 `<audio>` / 独立音量 / 独立淡变）。Radio 只有 1 个播放器（单例 `au`，L1500/L1536），要支持"战斗曲 + 环境音并存"必须改成**槽位数组**。
- 每个槽位有 `gain/duck/paused`，规则只写"我想要的槽位状态"，`PlayerAPI` 做**差分下发**（只在变化时发命令，避免 26 KB 级注入的频繁触发；参考 L1951 的 `lastSentArg/stateChanged` 去重模式）。
- 槽位归属建议：`A=主旋律`（被规则独占）、`B=战斗层`（可与 A 叠加）、`C=短音效/提示`（一次性，播完即止）。

#### 7.3.4 玩家在哪配置 & 如何持久化

| 方案 | 可行性 | 评价 |
|---|---|---|
| **P1. panorama 内做规则编辑器**（复用现成的 `Section/ToggleRow/ChoiceRow/StepperRow` 积木，L2740-L2876） | 高（现成） | 适合"少量预设 + 几个数值"；做"任意多条件组合"的编辑器会非常痛苦（无列表增删、无自由文本、无滚动拖拽） |
| **P2. 在 CEF 里做 HTML 规则编辑器**（自建 `rules.html`，和 `player.html` 一起放音乐目录） | 高（推荐） | 表单/JSON 编辑/导入导出/校验全在页面里，**不受 panorama UI 限制**；通过 `send('rules', {...})` 回传、panorama 存 localStorage |
| **P3. 规则写在 `rules.json` 文件里**（用户自己用记事本编辑） | 中（需实测 XHR） | 最"极客"、最省 UI 工作；但 `file://` XHR 可能被拦（L1641 有 `blocked` 分支），需实测（§7.7 E4）。**若可行是性价比最高的路径**（还能让玩家分享规则文件） |
| 持久化 | **CEF localStorage**（`dlm_rules`），沿用 L1241/L1247-L1249 的桥回传模式 | 唯一现成路径；`_ts` 单调仲裁（L110-L111）必须保留 |
| 兜底 | 规则也可硬编码一份 `DEFAULT_RULES` 在 vjs_c 里 | 防"localStorage 丢了/被清"导致开天窗 |

**我的建议**：**P3（读 `rules.json`）+ P2（页面里可视化编辑并写回 localStorage）+ P1（panorama 里只放 3~5 个"预设开关"）**。三层共存，任何一层失败都能退回下一层。这正好复刻 Radio 的"文件夹发现四级降级"哲学。

### 7.4 条件从哪来 + panorama 如何实时传给 CEF

**来源**：只能是 panorama 轮询 HUD 面板树（`04`/`05` 已定论：无 `Game./Players./Entities.`、无 convar、`GameEvents.Subscribe` 只覆盖 `OnTakeDamage/OnBuyItem` 这类离散事件，拿不到 HP%）。
本轮新增的**实证信号**（Radio 踩出来的，可直接放进我们的 SignalHub）：

| 信号 | 读法 | 证据 |
|---|---|---|
| 战斗 | `FindChildTraverse('InCombatAlert')` → 向上 12 层 `BHasClass('inCombat')` | L1909-L1912 |
| 脱离战斗 | `FindChildTraverse('damage_meter')` → 向上 20 层 `.out_of_combat`，并需"曾见过 out_of_combat"才相信（`sawOutOfCombat`） | L1913-L1915 |
| 自己死了 | `FindChildTraverse('gameplay_hud_alive').visible === false` | L2055 |
| 计分板按住 | `AbilitiesContainer.BHasClass('gScoreboardOpen')` | L2046 |
| 商店/详情/选卡/草稿 | `gShopOpen` / `gDetailView` / `gItemDraftOpen` / `gEditingBuilds` | L2014、L2050-L2052、L2435 |
| ESC 菜单 | `EscapeMenu` 向上 16 层 `ShowEscapeMenu` | L2019-L2031 |
| 切出游戏 | `$.Schedule(0.0)` 递归测帧间隔，稳定 22~32 ms 且抖动 <6 ms → 判定切出 | L1988-L2012 |
| 我是谁 / 队友是谁 | `CitadelAvatarImage.accountid`、`CitadelUserName.accountid`、`PlayerNameNWContainer` 下的 2 个 Label（名/英雄） | L2152-L2177、L2115-L2129 |

**传递通道（P → 页）只有一条**：`SetURL('javascript:...')`。工程要点：

1. **批量**：一条命令下发**整个所需状态**（`lkApply({slots:[...],vol:{...}})）`，不要一个条件一发；参考 `PollCombat` 的"变了才发 + 150 ms 最小间隔"（L1951-L1961）。
2. **不要用 `document.title` 反向传**（那是页→P 的单向道）；P→页 只能注入。**双向都要做的话就是"注入下行 + title 上行"**，正是 Radio 的结构。
3. **心跳**：页面每 3 s 发 `hb`（L1435），panorama 的看门狗 6 s 无消息就重注入（L1737-L1751）—— 这套要原样保留，因为**注入的脚本会随页面导航消失**。
4. **条件带序号**：`lkApply({seq:n, ...})`，页面丢弃 `seq <= lastSeq` 的乱序命令。【推断】`SetURL` 是异步导航，连发时可能乱序 → 必须有序号。

### 7.5 玩家需要准备什么 & "无需编译音频"是否成立

| 选项 | 玩家要做的 | 我们不需要做的 |
|---|---|---|
| **本地音乐（推荐默认）** | 建 `Deadlock\game\citadel\addons\deadlockradio_music\`，把 `Artist - Title.mp3` 丢进去（可建子目录做"槽位"，如 `combat/`、`lowhp/`）；可选放 `rules.json` | **不编译任何音频**、不打包进 VPK、不做 soundevents |
| YouTube | 在游戏内浏览器里点歌 / 粘贴链接 /（我们的方案）贴视频 id 列表 | 同上 |
| 直链音频 | 贴一个 `https://…mp3` 直链（Lockify 已证实"play any direct web stream or online MP3"） | 同上 |
| 不支持 | Spotify / Apple Music 等 DRM 流 | — |

**"无需编译音频"成立，三条独立证据**：
1. Radio 的 VPK 212 KB、**0 音频文件**（§1.1）；
2. 雨爱式管线要切 1.05 s 片段 + ×N 状态 + resourcecompiler + VPK 打包（`05` §B.5），Radio 全部跳过；
3. 播放能力来自 CEF 的 Chromium 解码器（`canPlayType` 探测，L1512-L1513），不是引擎的 `vsnd` 体系。

**代价（必须写进设计文档）**：
- 音频**不经过游戏混音器** → 游戏内"主音量/音乐音量"滑块**大概率管不到**（GB 的"录桌面音频"是侧面证据）→ 我们得自己做音量 UI（Radio 已做：`normalVol/quietVol/combatVol`）；
- 48 kHz/任意码率都能放（Chromium 处理 resample）→ 反而比 vsnd 更省心；
- **Linux 会崩** → Linux 只能退回 vsnd 方案。

### 7.6 分期实施路线

| 期 | 内容 | 复用 Radio 的部分 | 估工 |
|---|---|---|---|
| **P0 打通** | 自建 `player.html`（单槽 + `<audio>` + 淡变 + tick/meta 回传）；panorama 侧桥骨架（注入 + ack + 看门狗 + 重注入） | L1052-L1055、L1081-L1119、L1245-L1251、L1737-L1751 几乎可原样搬 | 小 |
| **P1 条件** | SignalHub（7.4 表）+ 阈值/滞回去抖 + "条件自检"日志面板 | L1907-L2065、L2102-L2177 | 中 |
| **P2 规则** | 规则表 + 仲裁 + 多槽位播放器 + 差分下发 `lkApply` | 新写（结构参考 §7.3） | 中 |
| **P3 配置** | ESC 菜单注入（现成）+ `rules.json` 读取 + CEF HTML 编辑器 + localStorage 落盘 | L2579-L2726（菜单注入）、L3105-L3343（表单积木）、L1241/L1785（持久化） | 中 |
| **P4 体验** | HUD 迷你播放器（复用 L375-L500 的 `BuildPlayer` 全套）、封面/ID3、快捷键、静音规则 | L192-L500、L1574-L1643 | 中 |
| **P5 可选增强** | 联机"同听一首"（有社交需求才做；注意 §5.4 隐私评估）、vsnd 兜底音源（Linux/离线） | L1101-L1240、L2191-L2419 | 大 |

### 7.7 待验证清单（必须实测才能定案）

> 标注：**E** = 环境/能力验证，**R** = 风险验证，**D** = 设计取舍验证。

| # | 待验证 | 为什么必须实测 | 怎么验证（最小成本） |
|---|---|---|---|
| **E1** | 比赛内 `CitadelHTMLPanel` 是否稳定（能否在 `base_hud` 上下文里长期存活、是否被 HUD 层裁切/hittest 屏蔽） | 游戏只在"看新闻"弹窗里用过它；比赛内常驻是 mod 的私有用法 | 装 Radio，进训练场，观察 20 min 有无白屏/掉帧/音频中断 |
| **E2** | `SetURL('javascript:...')` 的**频率上限**与**长度上限** | 26 KB 单发已知可行；**1 s 一发持续 30 min** 未验证（我们规则引擎要持续下发） | 写探针：每秒注入 `window.__n=(window.__n||0)+1`，页面每 3 s 用 title 回 `__n`，比对是否漏发/掉帧 |
| **E3** | `file://` 与 `youtube` 两个 origin 的 **localStorage 持久性与隔离** | 决定"规则存哪" | 在两模式下各存一个键，**重启游戏**再看是否还在 |
| **E4** | `file://` 下 **XHR/fetch 读同目录文件**是否被拦 | 决定 `rules.json`（P3）与 ID3 封面能否用 | 放 `t.txt`，页面 XHR 读它；Radio 的 `tags` 消息（L1631）会告诉我们 "read/blocked/empty" |
| **E5** | CEF 音频是否受**游戏音量/静音**影响；是否出现在 Windows 音量合成器的 Deadlock 进程里 | 决定要不要自己做音量 UI、以及"游戏静音=音乐静音"是否符合预期 | 游戏内把主音量拉到 0，听音乐是否还在 |
| **E6** | 实际可播格式（`canPlayType` 返回 vs 真正解码）；flac/opus/wav 成功率 | 决定给玩家的说明（GB 只敢说 mp3） | 用 Radio 的 `folder` 消息里 `formats{}`（L1647）+ 逐个试播 |
| **E7** | **自建页面**方案可行性：`file:///…/player.html` 能否被 `SetURL` 加载并执行注入的 `javascript:`；`youtube.com/embed` 能否作为顶层页播放 | 决定我们是"寄生 YouTube"还是"自建播放器"（架构分叉点） | 最小 demo：一个只有 `<audio>` + title 回传的 html |
| **E8** | 切出检测（帧时间 22~32 ms）在**高刷/限帧**环境下是否成立 | 这是 Radio 的 `tabMode` 与我们的"切出时暂停"的基础 | 在 60/144/240 Hz + 限帧设置下各跑一次，看 `TabFrame` 日志 |
| **E9** | 注入脚本在**页面内导航**后的存活/失效边界（YouTube 站内点击 vs `location.href` 跳转 vs 刷新） | 决定重注入策略的触发点 | 观察 Radio 日志 "Injecting ... bridge (#N)" 的计数增长 |
| **E10** | 多 CEF 面板（1 个播放器 + 1 个编辑器）是否允许同时存在 | 决定 UI 架构 | 创建两个 `CitadelHTMLPanel`，看是否都出画面 |
| **R1** | 反作弊/官方政策的**实际执行**（是否有人因这类 mod 被封） | 决定是否上线 YouTube 路径 | 社区检索 + 观察；保守默认关外联 |
| **R2** | Linux/Proton 崩溃的具体表现与是否有开关可绕 | 决定是否支持 Linux | 若有 Linux 环境，装 Radio 复现（GB 明说会崩） |
| **R3** | 12 月大版本更新后 `base_hud.xml` / HUD id 是否变化 | 决定更新维护成本 | 更新后重新反编译，diff `base_hud.xml` + grep 关键 id |
| **R4** | CEF 常驻的**性能代价**（帧时间/内存） | 决定"常驻 vs 按需" | 对比开关 mod 的 fps/帧时间分布（参考 Radio 自己的 TabFrame 数据） |
| **D1** | 规则粒度：是"每槽位一条规则"还是"一组规则共享槽位" | 影响 schema 与 UI | 先用 4 条规则（默认/低血/团战/死亡）验证表达力 |
| **D2** | 过渡策略：交叉淡化 vs 硬切 vs 等小节 | 影响听感与实现复杂度 | P2 阶段做 A/B |

---

## 8. 附录

### 8.1 代码索引表（按功能定位，便于后续深挖）

| 功能 | 行区间 |
|---|---|
| 常量/版本/路径猜测 | L1-L35 |
| 桥状态变量 | L47-L55 |
| **设置 schema + 默认值** | **L71-L104** |
| 设置读写/重置/去抖落盘 | L108-L153 |
| 根/层查找、HUD 容器 | L155-L180 |
| 封面/边框/光泽/闪光 | L192-L330 |
| 播放器 UI 构建（4 种布局公用） | L363-L500 |
| 播放状态/标题/艺术家 | L538-L580 |
| 进度条与拖动 | L582-L687 |
| 快捷静音 | L689-L694 |
| 跑马灯/频谱绘制 | L696-L795 |
| **CEF 面板样式/缩放/显隐/重绘** | **L797-L857** |
| **CEF 面板创建 + HTMLTitle 注册** | **L859-L907** |
| 音源切换/目录地址 | L909-L924 |
| **VDF → 目录发现降级链** | **L926-L1007** |
| 重载/切换音源 | L1009-L1050 |
| **ExecCEF（注入入口）** | **L1052-L1055** |
| YT 去广告 CSS | L1057-L1076 |
| **桥公用骨架（title 劫持/队列/ack/中继）** | **L1078-L1243** |
| 桥收尾（bridge 消息） | L1245-L1251 |
| 频谱采集（AudioContext） | L1253-L1308 |
| **YouTube 桥（播放/广告/元数据/历史/续播）** | **L1310-L1494** |
| **本地文件夹桥（格式/ID3/封面/重载切歌）** | **L1496-L1669** |
| 桥装配 | L1671-L1679 |
| 元数据/封面防串台 | L1681-L1703 |
| 版本检查/外链/反馈 | L1705-L1735 |
| **看门狗** | **L1737-L1751** |
| **消息分发（26 种）** | **L1754-L1884** |
| **战斗检测 + 音量仲裁（ducking）** | **L1899-L1967** |
| **切出检测（帧时间）** | **L1969-L2012** |
| **HUD 隐藏条件（4 类）** | **L2014-L2065** |
| 队友栏/自己身份识别 | L2102-L2177 |
| Hex 编码 | L2179-L2184 |
| **房间/共享节奏** | **L2191-L2251** |
| 队友卡片 UI | L2261-L2334 |
| 队友歌曲续播 | L2361-L2383 |
| Tab 卡片贴位 | L2385-L2419 |
| 快捷购买图标挪位 | L2421-L2495 |
| **初始化调度表** | **L2505-L2528** |
| —— 第二 IIFE：设置浮层 —— | L2530 起 |
| ESC 菜单定位/注入循环 | L2565-L2726 |
| 表单积木（Toggle/Choice/Stepper/Text） | L2728-L2878 |
| 值刷新/状态刷新 | L2881-L2933 |
| 内置 changelog | L2967-L2983 |
| 反馈（5 min 冷却） | L3034-L3082 |
| **设置浮层全量 UI** | **L3105-L3343** |
| **Help 文案（排障原文）** | **L3288-L3293** |
| 开/关/轮询 | L3345-L3387 |

### 8.2 与既有报告的差异修订

| 报告 | 原结论 | 本报告的修订 |
|---|---|---|
| `04` | 条件词汇表以"击杀差分/复活人数/血量/受击"为主 | **新增 5 类实证信号**：`InCombatAlert.inCombat`、`damage_meter.out_of_combat`、`gameplay_hud_alive.visible`、`AbilitiesContainer` 的 5 个状态 class、`EscapeMenu.ShowEscapeMenu`、帧时间切出检测（§7.4 表） |
| `05` §A.5 | 「音频控制能力极弱，只能 PlayUISoundEvent / StopUISoundEvent」 | 对**引擎音效总线**仍然成立；但 **CEF 是一条完全独立的、能力完整的音频栈**（音量/淡变/跳转/多格式）→ 「多 BGM 切换只能硬切」这个结论**只在 vsnd 路线成立** |
| `05` §B.3 | 过渡只能"硬切 + 烘焙淡变" | CEF 路线可做**真·交叉淡化**（50 ms 步进，L1372-L1377）与**多槽位叠加** |
| `05` §B.4/B.5 | 必须有切片 + resourcecompiler + VPK 打包管线 | 该管线**仅在 vsnd 兜底路线需要**；主路线**零音频资产** |
| `01` | 雨爱用 stepMilliseconds + 50 ms 交叠模拟连续播放 | 仍有效，作为"CEF 不可用时的兜底音源"保留 |

### 8.3 可复用的"硬经验"清单（写给实现者）

1. **panorama JS 无 `Intl`**，`toLocaleString` 会崩（L1）。
2. **`javascript:` 里不能有 `%` 和 `#`**（L1078）→ 选择器写 `[id=x]`，不要 `#x`。
3. **`document.title` 会被页面自己改**→ 必须劫持 setter + MutationObserver（L1090-L1100）。
4. **同一 title 重复不触发事件**→ 每条消息必须带变化字段（序号/时间戳）。
5. **注入会随导航丢失**→ 非 JSON title 立刻重注入 + 6 s 看门狗（L1757-L1761、L1737-L1751）。
6. **注入必须幂等**（`window.__dlm`）+ 跨域守卫（hostname/protocol）（L1080-L1084）。
7. **自动播放要先静音播再取消静音**（L1356-L1366、L1528-L1535）。
8. **伪造 `document.hidden/visibilityState`** 才能后台继续播（L1236-L1240）。
9. **CEF 面板不要 resize，否则白屏**；显示时"戳"4 次重绘（L797、L847-L857）。
10. **启动先用轻页面**（robots.txt），打开菜单才加载重页面（L2511、L893-L897）。
11. **`file:///dir/` 会被渲染成目录索引**（`Index of` + `<a>` 列表）→ 这就是"文件系统 API"（L976、L996、L1514）。
12. **`file://` 下 XHR 可能被拦**（L1641），凡"读文件"都要留失败分支。
13. **HUD 上的按钮必须按住 Tab 才可点**（GB 帮助文案）→ 交互 UI 放 ESC 菜单。
14. **战斗/死亡等状态用"祖先 class 上溯 + 曾经见过"的双保险**（`sawOutOfCombat`，L1913-L1915），避免面板还没实例化时误判。
15. **切出游戏可用帧时间特征检测**（22~32 ms 稳定），但阈值与刷新率绑定（L1999）。

---

*报告终止。本文件为新增，未修改 `analysis\` 下任何既有报告。*
