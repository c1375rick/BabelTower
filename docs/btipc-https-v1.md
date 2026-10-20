# https 面板通道 v1(2026-10-15)

BTIPC 位泵是**唯一零摩擦可用**的下行通道,也是本通道的兜底,`core/btipc/*` 冻结面一概不动。
本文件描述**并行的**第二条下行:让游戏内的隐藏 HTML 面板加载一个 https 页面,由**页面在桥这一侧**
取走整条翻译结果,一次写进 `document.title`,于是下行从位泵的
`FIRST_SHOT(1200ms) + 帧数 × tClose(600ms)` 变成**一个 RTT + 翻译耗时**。

---

## 1. 为什么值得做

BTIPC 位泵的延迟是**算术上可预测、但必然很大**的:

| 载荷 | 帧数 | 位泵下行耗时 |
|---|---|---|
| 短句 23B | 4 帧 | 3.0s |
| 17 帧 | 17 | 11.6s |
| 38 帧 | 38 | 24.4–27.4s |

每帧有效载荷仅 10B,吞吐 ~16.7 B/s;`dt ≈ tClose` 证明 600ms 是纯客户端 sleep,
不是协议开销 —— 也就是说这条路的慢**不来自网络**。

https 面板通道把搬运工作交给桥:页面同源 `fetch('/api/v1/translate')` 拿到**整条**结果,
写一次 title。游戏侧只做"导航 + 轮询 title",所以下行只剩一个 RTT。

**转正后的实测对照(2026-10-15,同一局内)**:位泵 3.0–27.4s → 面板 **< 1s**。
拆开看,服务端侧只占 55–76ms(§8 有数),余下是 WebKit 页面加载 + 0.3s 的 title 轮询粒度。

## 2. 方案来源与技术对照

### 2.0 涉及的三方实现

| 项目 | 说明 | 与本节的关系 |
|---|---|---|
| **DLCT**(另一款 mod) | 面板机制的公开可观测事实:`<HTML id="…">` 必须 XML 声明(运行时 `$.CreatePanel("HTML")` 无效)、`panel.SetURL(url)`、`panel.title` 读回、提交处理器接管。详见 `docs/development.md` §1。**2026-10-15 已用其完整发行包实测复核,8/8 属实,明细见 §2.6** | 面板机制的事实来源;实现为本项目独立编写 |
| **本项目**(`a48cefe`,2026-08-03 首发) | 面板/title 通道首发即有(`chat.xml` 声明 `<HTML id="LCTBridgePanel">`、`SetURL` 导航、桥页面同源 fetch 后写 `document.title`);BTIPC 位泵为 10 月新增。均可用 `git show` 按提交复核 | 基线 |
| **DeadlockTranslate 0.6.19** | "给面板一个受信任的本机 https"方案的来源(自签证书 + 写入 `CurrentUser\Root` + 信任后完全重启 Steam)+ 证书 SAN 布局 + "这条路可行"的实机先例(包内 `bridges:786 errors:0`) | https 方案的来源;实现为本项目独立编写 |

DLCT 的 `LICENSE_NOTICE.md` 中还列有它的上游参考:翻译流程设计参考
「RogueCore Chat Translator」的 `js/main.js`;聊天注入机制参考
`Hantu-Raya/Deadlock-mods-collection` 的 `poker/panorama/scripts/poker_chat_debug.js`(Apache-2.0)。
本项目代码注释里的 `DLCT/poker 同款机制`,"poker"指的就是后者 —— 记在这里,以后查链不断。

### 2.1 https 方案要素对照

| 要素 | 参考实现 | 本项目实现 |
|---|---|---|
| **本机 https 端点 + 自签证书 + 写入 `CurrentUser\Root` 信任库** | `Trust-Local-Https.ps1`、`src/Bridge/LocalHttps.cs` | 独立重写,脚本见 `scripts/gen_bridge_cert.ps1`。此前覆盖情况:6739/6740 只验证过"面板 http 不通",**未发出过 https 请求就判了全灭**(见 §2.4) |
| 证书 SAN 布局:`DNS:localhost` + `IP:127.0.0.1` + `IP:::1`,EKU serverAuth | `LocalHttps.cs`:`san.AddDnsName("localhost"); san.AddIpAddress(IPAddress.Loopback); san.AddIpAddress(IPAddress.IPv6Loopback)` | 同款布局,独立实现 |
| **"信任后必须完全退出并重启 Steam"** | `Trust-Local-Https.ps1` 第 49 行原文:"Fully exit and restart Steam … so its HTML browser reloads the trust store." | 按该说明执行,并以本项目实测(§4.1)复核确认 |
| 这条路**可行**的实机先例 | 包内跑通 | 本项目 6743 起独立复现(§8) |

本项目独立实现、与参考实现不同的部分:

| 要素 | 说明 |
|---|---|
| 拦点定位为**证书链**(`error:-202` = `ERR_CERT_AUTHORITY_INVALID`) | 实机抓到的 neterror 代码,定位依据 |
| **非交互进程写信任库必须用 `certutil`**(`Import-Certificate` 报 "UI is not allowed in this operation") | 参考实现用 .NET `X509Store` + 交互式确认,不存在该约束;自动化语境下的差异点 |
| 把 TLS 终结拆成**独立进程** | 本项目架构约束(`bridge_server.js` 护栏要求全桥只有一处 listen)下的选择 |
| 探针门控、硬/软失败分类、三次连击降级、兜底三级链 | 本项目通道设计(§5) |
| 面板是**单槽共享**控件,实验探针会抢生产通道 | 实现中发现并处理(`exp6742` 曾自动开火) |

通用工程常识(自签证书、信任库、SAN/EKU 的定义本身)不列归属。

### 2.3 需要澄清的两处表述

为准确起见,记下本轮写得不严谨又更正的地方:

1. 曾把"**IP 必须用 IP SAN**"写成"本项目实测踩出来的坑"。不准确 —— 它是这套方案固有的要求,
   DeadlockTranslate 的 `LocalHttps.cs` 早已用 `AddIpAddress(IPAddress.Loopback)` 实现。本项目是**独立重写出了同款**。
2. 曾把"**信任后必须完全重启 Steam**"同样写成"本项目实测"。也不准确 —— DeadlockTranslate 的 `Trust-Local-Https.ps1`
   第 49 行原文就写着。以本项目实跑**验证**为准,不写成**发现**。

### 2.4 结论修正史,以及"全灭"里混着"打空"

| 时间 | 当时的结论 | 后来被什么推翻 |
|---|---|---|
| 6726 版 | 面板 `SetURL` 对所有 http 一律失效 | 只测过 http,没测过 https |
| 6739/6740 | http 与公网 https 一律失效 | **这两轮从未发出过 https 请求**:本地无监听、无证书,"全灭"的结论超前了(后查明本地 https 臂打到了没监听的端口) |
| 6743 | 拦点是证书链 `error:-202`(`ERR_CERT_AUTHORITY_INVALID`) | — |

**"全灭"里混着"打空",会把两类结论搅成一种** —— 这是那两轮白跑的原因,也是为什么
`scripts\probe_https_server.js` 要求先确认当次真的在监听再采信结论。
重开这条路的依据:先复现了可行先例,再独立定位拦点(§4.1)。

### 2.5 零代码重叠的审计基线(对 DeadlockTranslate 0.6.19)

工具 `scripts\audit_attribution.js`(可复跑)四层扫描:

- 协议层:44 个 BTIPC 标记 → 命中 **0**
- 标识层:325 个本项目函数/常量名 → 命中 **1**,且是 `targetLanguage` 这类通用属性名
- 文本层:本项目文档的中文独特句子 → 命中 **0/10**
- 逐 6 行 shingle:与 `lingua_chat.js`(4165 段)、`chat.xml`(197 段)重叠 **0.00%**

**这份 0.00% 存作基线** —— 日后做同类比对时,可拿现在的扫描结果当对照。
前三层都会漏,第四层才抓得住搬运;反过来,搬运必被第四层抓到。

### 2.6 DLCT 审计(2026-10-15 实测;上一版曾记为"实物已丢、审不了")

上一版结论"DLCT 实物不在本机、跑不了对照"**是错的** —— 漏扫了游戏安装根目录。
实物在游戏安装根目录的 `DLCT\` 下,而且是**完整发行包**
(`bridge_server.js` + `pak01_dir.vpk` + `README.md` + `LICENSE_NOTICE.md` + portable-node)。
解包得 `panorama/scripts/deadlock_chat_translator.js`(54,576 B)、`layout/chat.xml`、`styles/*.css`。

**① 下表关于 DLCT 的事实:8/8 全部属实**

| 事实 | 复核结果 |
|---|---|
| `<HTML id="DlctBridge" class="DlctBridge" />` | ✓ 逐字一致 |
| `panel.SetURL(url)` | ✓ |
| 页面写 `document.title`,Panorama 读回 | ✓ |
| `GetAttributeString` 兜底 | ✓ |
| `oninputsubmit="DeadlockChatTranslatorSubmit();"` | ✓ |
| `commitChatText` | ✓ |
| `bridgealiveJS` 存活标记 | ✓ |
| 桥在 `127.0.0.1:8765`,**无 https、无证书** | ✓ —— 这条同时坐实了 https 方案与 DLCT 无关 |

**② 上一版记为"查不到证据"的 2 处,现已补上**:聚焦面板(DLCT 有 `SetFocus` + `GetContextPanel`;
精确的"优先控件失败则面板"顺序未逐行验)、路线四段(扫描 `ChatMessages` / 按签名去重 /
隐藏面板桥接本地桥 / 原文下方追加译文 **4/4 都有**;标签类名 DLCT 用 `DlctTranslationLabel`,
本项目用 `LCTTranslation`)。

**④ 两侧桥设计的差异**(供对照存档):DLCT 的 `bridge_server.js` 只有 124 行,
提供通用 `/proxy`:按 `target` + `headers` 参数转发(用于转发跨域请求)。
本项目的桥不提供通用代理(见 `core/bridge_server.js` 文件头"没有任意 URL 代理能力"),
provider 目标由配置/代码限定。标题协议也不同:DLCT `document.title = id + JSON`(无前缀),
本项目 `LCT + id + JSON`(带标识前缀,避免与别的 title 撞)。

### 附:已经排除的解释(别再重走一遍)

Panorama 的隐藏 HTML 面板走 **WebKit**(`pak01:panorama/browser/webkit.css` 佐证),
所以下面这些"看起来该成立"的理由都不成立:

| 猜测 | 排除依据 |
|---|---|
| 是 CEF/Chromium 的策略问题 | 面板走 WebKit,不是 CEF |
| 引擎用了某个 Windows 证书 API | 在 `client.dll` / `panoramauiclient.dll` 里搜证书相关 API **零命中** |
| pak01 里带了 CA 包,只是没生效 | pak01 内无 CA 包 |
| 引擎内嵌的证书可以用 | 引擎内嵌的 11 张证书全是 Valve 自身模块签名链 |
| 面板需要先 visible/active 才加载 | 已实测必要但不充分(visible+active 后 `src` 仍为空) |
| 该项目文档中的面板通道验证结论 | 其 `VALIDATION.md` 记录的为模拟环境结论,与游戏内实测口径不同,不宜直接对读 |

## 3. 拓扑

```
游戏内隐藏面板 <── https ──> core/bridge_https.js(8792,TLS 终结) ── http ──> core/bridge_server.js(8791)
     │                            独立进程                                │
     │ 导航 /bridge?...                    复用同一个 requestHandler        │
     └─ 页面 JS 在同源下 fetch /api/v1/translate,并把整条结果写进 document.title
                                                    │
BTIPC 位泵 ─────────────────────────────────────────┘ (兜底,全程保留)
```

**为什么 TLS 终结是独立进程**(`core/bridge_https.js`):

1. `core/bridge_server.js` 有安全护栏要求"整个桥只有一处 `listen` 调用",不允许第二个内联绑定;
2. **证书缺失/过期/握手失败绝不能连带 BTIPC 一起死** —— BTIPC 是当前唯一零摩擦可用的下行通道;
3. 面板页面同源 `fetch('/api/v1/…')` 由它原样转发,桥的路由与状态**零改动**。

它的行为约定:证书缺失/口令错 → 打印提示并以**退出码 3** 退出(启动器据此跳过,不视为故障);
上游 8791 不通 → **502 且不退出**(桥起来即自愈);只监听回环(127.0.0.1 + ::1),不做鉴权 ——
它存在的唯一目的是让引擎的证书校验通过,不是对外暴露面。

## 4. 启用步骤(用户侧,三步,顺序不能换)

```powershell
# ① 生成本机自签证书并信任(幂等;重复执行安全)
powershell -ExecutionPolicy Bypass -File scripts\gen_bridge_cert.ps1 -Trust

# ② 完全退出并重启 Steam —— 包括托盘图标也要退,然后重新打开 Steam
#    ③ 启动游戏,进对局发一条消息
```

**三个必须知道的坑**(都实测踩过):

1. **IP 必须用 IP SAN**。把 IP 写成 DNS 名字(`DNS:127.0.0.1`)不算,证书校验照旧失败。
   本项目签发 `CN=BabelTower-localhost`,SAN 同时含 `DNS:localhost` 与 `IP:127.0.0.1`、`IP:::1`。
2. **信任库写入要用 `certutil`**(`certutil -user -addstore Root ...`)。
   `Import-Certificate` 在非交互进程里报 `UI is not allowed in this operation`;
   `Remove-Item` 删已信任项同样会被拒 —— 撤销要用 `certutil -user -delstore Root`。
3. **信任后必须完全退出并重启 Steam**。信任库由 Steam 宿主缓存,**只重启游戏不生效** ——
   这一条最容易被误判成"证书方案不可行"。

不做 ①~③ 也能用:通道探针会判死,全程留在 BTIPC,体感与本通道上线前**完全一致**。

### 4.1 验证结论:信任与否缓存在 Steam 进程,加减信任都要完全重启 Steam 才生效(2026-10-15 双向实测)

这一条以前只是引用 `Trust-Local-Https.ps1` L49 的说法(`so its HTML browser reloads the
trust store`)。当天做了一组对照实验把它**验成了事实**,而且同时拿到了它的另一面:

| 实验 | 操作 | 探针判据 | 说明 |
|---|---|---|---|
| 基线 A | 撤销信任,**Steam 不重启**(PID 20048 / 启动于 22:20:50,那时尚信) → 开游戏 | `ALIVE` | Steam 长驻进程**缓存了信任决定**,游戏继承 |
| 基线 B | **完全退出 Steam**(新 PID 23736 / 22:48:16,证书撤销状态下出生) → 开游戏 | **`not usable (bridge_nav_failed)`** | 信任对**新 Steam 进程**不成立 |

基线 B 有一条**独立的正面证据**:`bridge_https.log` 在 22:52:48 记
`[::1] TLS 被客户端拒绝(ERR_SSL_SSL/TLS_ALERT_CERTIFICATE_UNKNOWN)` ——
游戏是用**明确的证书告警**拒的,不是超时、不是连不上。所以:

- **游戏的 HTML 面板确实校验证书**(曾怀疑它"不校验也能通",被这条告警否掉);
- **信任的缓存位置在 Steam,不在游戏进程** —— 只重启游戏没用;
- **推论(同样重要):撤销信任也要重启 Steam 才生效。** 同一个机制的两面,当天都亲手验过:
  基线 A 就是"证书已经从库里删掉了,游戏却还报 ALIVE"。
  **证书操作没有"即时生效"这回事,任何加减都要配一次 Steam 完全重启。**

### 4.2 不需要管理员(2026-10-15 实测确认,不再是推理)

- 证书写的是 `CurrentUser\Root`(`certutil -user -addstore Root`,`-user` 就是当前用户),
  **普通权限即可**;Steam 和游戏用**同一个 Windows 用户**跑就行,提不提权都读同一张证书。
- **实测确认**:恢复信任 → **完全退出重开 Steam(不提权)** → 开游戏 → 探针 `ALIVE`。
  与 §4.1 的基线 A/B 拼起来是一个完整三段论:
  ① 基础 B 的 `TLS_ALERT_CERTIFICATE_UNKNOWN` 证明游戏**确实校验证书**;
  ② 基线 A vs B 证明信任**缓存在 Steam 进程**,不在游戏进程;
  ③ 本条证明这一切**在普通权限下就成立**。
- 管理员开关与证书无关。DeadlockTranslate 0.6.19 的文档同样写明「通常不需要管理员」;
  其 `--admin-compatible` 仅面向它自己的后台进程权限场景与受保护目录写入(`access-denied`)
  这类架构兜底。两边在这个结论上是一致的:证书问题看信任库归属,不看权限等级。
- 它自家文档还有一句可直接引用:「切换到另一管理员账户**不能解决证书/密钥归属问题**」。
  证书归属的是**用户**,不是权限等级 —— 这也是本节"普通权限即可"的依据。

## 5. 通道怎么选(客户端逻辑)

```
开机 1.2s 探针 → 导航 https://localhost:8792/bridge?op=health&id=probe
   ├─ 页面 alive(1.5s 内见到 lct-alive 且拿到应答) → 本会话走 https 面板
   │    日志: https panel: ALIVE (https://localhost:8792) — …one RTT…
   └─ 拿不到                                     → 本会话全程 BTIPC
        日志: https panel: not usable (…) — …stay on BTIPC…
```

**为什么必须探一次而不是"每请求都试"**:证书未信任的用户若每条请求都先撞一次死链,
会白付 `BRIDGE_ALIVE_SECONDS`(1.5s)—— 比今天的 BTIPC 还慢。探一次定生死,未通过就一次都不试。

**失败分两类,这是本设计的全部要点**:

| 类别 | 判据 | 处置 | 理由 |
|---|---|---|---|
| 硬失败 | `bridge_nav_failed` / `bridge_offline` / `bridge_load_failed` / `bridge_panel_unavailable` | job **原样交回 BTIPC** 重做,不消耗 `job.attempts` | 请求**从未到达桥**,重做零风险;它不是翻译失败,不该扣重试 |
| 软失败 | `bridge_timeout` / `timeout` / `bad_bridge_payload` | 不交回,按既有语义结算(出站发原文) | 页面 alive 且 fetch 已发出,只是慢;出站已被等了 `OUTGOING_TIMEOUT_MS`,再拖 3~27s 是净损失 |

连击到 `HTTPS_PANEL_DEAD_STREAK`(3)次 → `httpsPanelOk = false`,**本会话不再试**,只告警一次。
交接前必须撤掉面板路径挂的出站超时句柄 —— 否则它稍后触发会二次 `job.done/finishJob`,
击穿 `MAX_ACTIVE_REQUESTS = 1` 的单槽(0.1.3「发中文卡死」事故的同款机制)。

兜底链是三级的,任何一级都不会"把原文直接发出去":
https 面板 → BTIPC 位泵 → http 面板通道(BTIPC 恰好 busy/too_long 时)。

**http 面板的判死不约束 https**。`navDeadUntil` 是 http 通道的结论,而 config/test/log 三个 op
至今仍走 http 面板、在当前 build 上必然连撞 `src=""` 而进冷却。若 https 也受它约束,一次 http 判死
会把**能用的** https 通道压掉 10 分钟,且日志里只看得到 http 的死链记录,极难归因。
所以 `navSuppressedFor(hooks)` 给 `httpsChannel` 一个**显式**豁免(护栏钉死这个豁免不得扩大到所有通道)。

## 6. 排障

| 日志 | 含义 | 处置 |
|---|---|---|
| `https panel: ALIVE …` | 通道可用 | 无需处理 |
| `https panel: not usable (bridge_nav_failed)` | 页面从未加载 | 走 §4:多半是没 `-Trust` 或**没完全重启 Steam** |
| `https panel: hard fail #n/3` | 单次硬失败,已交回 BTIPC | 观察是否到 3 |
| `https panel: dead (3 consecutive hard fails)` | 本会话退 BTIPC | 同上;修好后重进游戏即恢复 |
| `bridge_https.log` 里 `TLS 被客户端拒绝(ERR_SSL_SSL/TLS_ALERT_CERTIFICATE_UNKNOWN)` | 引擎**用证书告警**拒了本项目签发的自签证书 —— 这就是"没信任"的正面证据 | 跑 `-Trust` 并**完全退出重启 Steam**;见 §4.1 |
| `bridge_https.log` 里 `TLS 被客户端拒绝(ECONNRESET)` | 同样是没信任,但客户端直接掐了连接,没给告警 | 同上。两种码都指同一件事 |
| `bridge_https.log` 里 `REQ GET /bridge?op=health (经 https 面板通道进来)` | 有请求**确实走了 TLS** 进来 | 只证明"走了 https",**不证明证书被信任** —— 带 `-k` 的 curl 也会进来这一行。判信任要看游戏侧判据或上面的 TLS 告警 |
| `cfg watch(push): armed (请求面板长轮询…)` | 配置推送已挂上(长轮询挂在请求面板上) | 正常。有了这行,网页改设置才是 <1s 生效;没有它就只会看到 12~25s 的轮询延迟 |
| `cfg watch(push): config changed (rev=…)` / `applied (…)` | 桥把"配置变了"推到游戏了 | 正常。两条都出现 = 端到端通 |
| `cfg watch: transport busy, skip n` | 指纹轮询被跳过(传输忙) | 正常,推送在位时轮询只是兜底 |

> **跨文件对时序前先看时区。** `bridge_https.log` 曾用 `toISOString()`(UTC)记时间,
> 而 `bridge.log` 用本地时间,本机 UTC+8 → **两个本该对着读的日志差 8 小时**,
> 当场把一次 TLS 拒绝误判成"8 小时前的事"。已于 2026-10-15 统一为本地时间(护栏钉死)。

一键旁路(现场排障):`mod/panorama/scripts/lingua_chat.js` 里 `HTTPS_PANEL_ENABLED = false`,
即刻全量退回 BTIPC(布尔字面量,护栏会盯着它不被改成表达式)。

## 7. 冻结与边界

- `core/btipc/*` 一律不改;护栏断言其中不出现本特性任何痕迹。
- http 8791 永远保留;`core/bridge_server.js` 的监听逻辑一行未动。
- **2026-10-15 扩围**:本通道现在接管 `outgoing` / `chat` / **全部 `bridge` op**
  (`config` 保存与读取、`test`、`log`)。扩围的**唯一理由**是用户实机反馈
  「OpenAI 的 API 老是保存不上」,而根因是纯算术:带 Key 的保存载荷 ≈600B,
  位泵 10B/帧 → 61 帧 ≈ **38 秒**,而写死线只有 **8 秒**(死线当初按**应答** 1 帧定的,
  没算上行请求本身要 61 帧)→ 必然 `REQ_TIMEOUT` → 面板显示「保存失败」。
  同根因的 `op=log`(600B 批、同 8 秒死线)与读配置(7.8–26 秒)一并接入。
  **判据是"根因相同",不是"哪个 op 眼下没报障"。**
  通道判死时全部原样交回 BTIPC(`demoteToBtipc`),兜底语义与翻译路径完全一致。
  **代价(如实记录):BTIPC 兜底那条路的 8 秒写死线没动** —— 面板通道健康时保存 1 秒,
  一旦判死退回位泵,保存会照旧失败。这是 2026-10-15 用户选 B 方案时明确接受的取舍。
- 护栏:`tests/https_panel_guard.test.js`(74 项)、`tests/lc_panel_nav_guard.test.js`
  (新增 https 豁免的两侧断言)、`tests/security_boundary_guard.test.js`。
- 实机仿真:`scripts/lingua_chat_simtest.js` 场景 21/22/23
  (探针判活 / 证书未信任 / 中途掉线降级),`LCT_SIM_ONLY=21,22,23` 可单跑。

## 8. 实测数据(2026-10-15)

### 8.1 端到端(游戏内,面板通道转正后)

**最干净的一组(23:01,新 Steam 不提权,https 进程已记录成功请求,整条链可对齐)**:

| 时刻 | 事件 | 出处 |
|---|---|---|
| 23:00:37 | 探针 `ALIVE` | `console.log` |
| 23:01:30 | `GET /bridge?id=r1&op=translate&text=测试&target=en` | `bridge_https.log` |
| 23:01:30 | `POST /api/v1/translate`(页面同源 fetch) | `bridge_https.log` |
| **23:01:31** | **`outgoing mode=bilingual -> 测试 \| Testing`** ← **1 秒** | `console.log` |
| 23:01:42 | `GET /bridge?id=r2&op=translate&text=Testing&target=zh-Hans` | `bridge_https.log` |
| 23:01:42 | `POST /api/v1/translate` | `bridge_https.log` |
| **23:01:43** | **`translated [[队伍]] …: 测试 测试`** ← **1 秒** | `console.log` |

这一组是本项目第一次拿到**完整闭环**:导航 → 页面加载 → fetch → 出译文,
每一步都有时间戳、两个日志文件时区一致、可逐行对齐。
在此之前只能证明"游戏说它成了",证明不了"请求确实走了 TLS"。

其他样本:

| 项 | 数值 | 取证 |
|---|---|---|
| 用户体感 | **基本 1 秒以内** | 玩家口述 |
| 日志样本(22:36) | 出站与入站**同一秒**出译文(`22:36:41` / `22:36:42`,`22:36:51`) | `console.log` |
| 修复后窗口失败数 | **0** 超时 / 0 失败 / 0 条走位泵的翻译 | `translation unavailable`、`BTIPC TRQ …text=` 均 0 命中 |

### 8.2 服务端侧(独立测量,可复现)

用 `curl` 直打 **8792 的真实 TLS 握手**(**不绕 `-k`,即 Windows 信任库对任意真实客户端生效**,
顺带证明证书信任不是只对游戏引擎有效):

| 步骤 | 耗时 |
|---|---|
| `GET /bridge`(页面;游戏里由 WebKit 干,这里只量 HTTP 部分) | 27 / 29 / 37 / 43 ms |
| `POST /api/v1/translate`(页面同源 fetch,带 `Origin: https://localhost:8792`) | 24 / 27 / 30 / 33 ms |
| 合计 | **55–76 ms** |

### 8.3 剩下的时间归属

服务端 0.06s,端到端 < 1s,差额约 0.9s 由两项构成:
**① WebKit 文档加载**(游戏内,无法从外部测);**② title 轮询粒度 0.3s**(`TITLE_POLL_SECONDS`)。
这两项**未单独测量过** —— 想再压延迟,方向就是"少一次轮询"或"复用面板文档",属于可选优化。

### 8.4 前后对照:同一晚,同一个 provider

面板通道转正后的第一局里出现 **~8 秒**的翻译(桥 22:27:22 收到 → 22:27:30 才 `translate ok`),
被误以为"新通道还是慢"。真实原因在 provider 侧:bing 命中 429 后在 provider **内部**睡
「1s→2s→4s」共 7 秒,且那 7 秒里它不抛错、**桥的回退链根本没机会接手**。修复后:

- bing 限流改成短等 0.6s 就抛 `rateLimited`,把回退机会让出去;
- `fallbackProviders` 从 `[]` 配成 `["google"]`(免 Key);
- provider 的 `console.*` 诊断**接进 `logs/bridge.log`**(此前走 stdout,桥是隐藏窗口启动,全部蒸发),
  并加自证标记 `[console.log] [bridge] console capture active`。

→ 同一场景 8s → < 1s。

### 8.5 仍未验证(如实记录)

- WebKit 页面加载的单独耗时(见 §8.3),因此"再压到 0.4s 以内"目前无依据。
- 样本量小(2 条日志样本 + 玩家口述),长句(>60 字)与多窗口并发下是否仍 < 1s **未测**。
- 429 那条分支**未能端到端复现**:连打 26 条未逼出限流(端点比预期耐打),
  该分支目前只有单元测试(`tests/providers.test.js` 两条)覆盖。

## 9. 标题通道的三个引擎行为(2026-10-20 实测;做"配置即时下发"时踩出来的)

背景:设置搬到桌面网页后,网页保存只落 `config/config.json`,而游戏侧原本**只在开机读一次**
(`boot: config synced from bridge`)→ "网页改了游戏不认"。要做到"保存后 <1 秒生效",
就得让桥**主动**把"配置变了"这个信号送到游戏,游戏再自己去读配置
(信号走标题通道,整份配置不走:标题通道约 512 字符上限,而配置约 400 字节)。

下面三条是**引擎行为**,不是本项目的选择,踩了三次才对上。

### 9.1 标题经**事件**送达,`panel.title` 属性是陈旧的

请求应答通道(翻译/配置读)读的是引擎的 HTML 事件(`HTMLChangedTitle` 等),事件参数里带标题文本;
`panel.title` / `GetAttributeString("title")` 读到的是**上一次**的标题。

- 实测:推送包写进标题后,游戏按属性去读,永远读到旧值 → 推送"送达零次",
  而桥日志里看得到请求、游戏的推送日志一行都没有(当时误判成"推送没挂上")。
- 结论:**任何拿标题当信号的机制,都必须挂在 `onBridgeEvent` 那条事件通道上**,不要读属性。
  `readBridgeTitle()` 只适合做兜底轮询。

### 9.2 同一帧里的两次标题变更会被合并,只送第一个

页面脚本连续写两次 `document.title`(例如先 `lct-alive` 再 `lct-watch`),引擎只送第一次。

- 实测:watch 页面收不到 `lct-watch` → 游戏判定"页面没起来" → 每 1.5s 重挂长轮询,
  流量 0.33 req/s,长轮询永远挂不满 20s。
- 结论:同一个页面**只写一次标题**。桥侧 `/bridge?op=watch` 的页面因此先写 `lct-watch`
  并直接 `return`,不再走通用的 `lct-alive` 那段。

### 9.3 第二个 HTML 面板的标题事件收不到 → 长轮询只能挂请求面板

曾为配置推送单独加过一个 `<HTML id="LCTWatchPanel">`(chat.xml / hudchat.xml 各一份):
页面能加载、请求能到桥(桥日志看得到),但**游戏收不到它的标题**(属性读不到、事件也收不到,
`Activate()` 也不行)。该面板最终被删除。

- 结论:标题信号只能走**请求面板**。代价:长轮询占着面板,翻译请求一来就把它顶掉
  (顶掉的是长轮询,不影响翻译)→ 所以长轮询**只在传输空闲时挂**:
  `State.pending`/`activeRequests`/队列都为空才导航,且"空闲判定"与 `SetURL` 必须在
  同一段同步代码里(JS 单线程、中间不跨事件循环 → 不会插到请求中间)。
- 另一条教训:挂长轮询的时机**不能在别的 job 的回调里**做 —— 那一刻出站槽位还没还
  (`activeRequests` 仍为 1),空闲判定必然失败,推送永远挂不上。
  实测:日志里连 `cfg watch(push): armed` 都没有,一直靠 15s 轮询兜底,延迟 12~25s。

### 9.4 最终形态与实测

- **桥**:`GET /api/v1/watch?rev=<配置指纹>` —— 指纹已变立刻回;没变就挂住最多 20s,
  期间网页一保存就被 `notifyConfigWatchers()` 叫醒(应答 `{ok:true, rev, changed:true}`)。
  指纹由 `maskCompact` 派生(`core/config.js` 的 `configRev()`):内容不变则指纹不变,
  桥重启后指纹也不变(内容派生,不是计数器)。
- **游戏**:与应答通道分开的一套推送状态机
  (`armConfigWatch` 挂 / `onWatchPayload` 处理唤醒 / `configWatchTick` 兜底重挂):
  挂 → 活(收到 `lct-watch` 事件)→ 醒(收到 `LCTW{…}`)→ 重挂。
  唤醒包的处理必须与应答通道共用 `onBridgeEvent`(§9.1)。
- **兜底**:15s 一次的指纹轮询(推送没挂上时顶班)。轮询也走请求面板的单槽队列,
  空闲判定失败就跳过 —— 不能因为"传输忙"把轮询饿死。

实测(2026-10-20,同一台机器):

| 环节 | 耗时 |
|---|---|
| 网页点保存 → 桥落盘 | < 100ms |
| 桥叫醒长轮询 → 游戏读到 `LCTW` | < 200ms |
| 游戏重读配置并落地 | ~100ms |
| **合计(网页保存 → 游戏行为改变)** | **< 1 秒** |

对照:网页化之前"改设置"必须重启游戏;中间那版纯轮询方案实测 12~25 秒
(轮询间隔 15s + 传输忙时被跳过)。

### 9.5 顺带记两条容易再犯的

- **别把"引擎行为"当既定事实用**:§9.1 / §9.2 两条都是我从已有机制的成功**外推**出来的
  (桥页动态改 title 能 work → 以为"页面没 load 完也能读到 title")。
  涉及引擎行为的假设,先做最小实验(比如导航到一个故意延迟 10s 才返回的页面,
  看标题读不读得到),再往上建机制。
- **没有正号信号的功能不算做完**:推送路径当时只有"没报错"这种负证据,导致两次误判
  ("是别的问题""是我改坏了")。现在推送有 `cfg watch(push): armed` / `config changed` /
  `applied` 三条正号日志,坏在哪一步一眼可见(见 §6 排障表)。
