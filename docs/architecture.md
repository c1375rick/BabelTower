# 架构文档

## 1. 总览

```text
游戏进程(Panorama)
  lingua_chat.js
    扫描 #ChatMessages 行 → 签名去重 / 缓存 / 语言启发式 → 串行队列(MAX_ACTIVE=1)
    译文追加显示(聊天行下方 / HUD 顶栏气泡 / 大厅聊天记录)

    与本地桥的通道(dispatchJob 按序尝试,2026-10-15 起 https 优先):
      ① https 面板 翻译 / 配置读写 / 测试 / 读数:隐藏 HTML 面板经本地 TLS(8792)
                    同源取走整条结果,一个 RTT。开机探针 ALIVE 才用;硬失败原样
                    交回 BTIPC,3 连击本会话退回(详见 docs/btipc-https-v1.md)
      ② BTIPC      兜底:出站翻译、入站聊天翻译、配置读写(op=config)、测试(op=test)、回声
                    上行 console.log 行 "[LCT] BTIPC REQ ..." → 桥 tail 轮询读回
                    下行 128 个隐藏 Image 面板轮询 GET /btipc/dl 取 16 字节帧
      ③ http 面板  最后一级兜底(判死冷却 10min):隐藏 HTML 面板 SetURL → /bridge
                    页面,轮询 document.title 读回
      ✕ 直连      $.AsyncWebRequest → GET/POST /api/v1/*(游戏已移除,仅留探测)

                    │ 127.0.0.1:8791(仅本机)
                    ▼
本地翻译桥 Node.js(core/)
  /btipc/dl + console.log tail   ← ① BTIPC(协议与状态机见 docs/btipc-v1.md)
  /bridge                        ← ③ HTML 面板页面(结果写 document.title)
  /api/v1/translate|test|config|health|quickchat|gamenames|log|version-check  ← ②
  providers/*.js ── HTTPS ──► 翻译服务商(Bing免Key / Azure / DeepL / Google / OpenAI 兼容,见 §6)
```

游戏内的 Panorama 无法直接发 HTTP:`$.AsyncWebRequest` 已被游戏移除(调用即抛
`AsyncWebRequest has been removed.`),隐藏 HTML 面板的 http `SetURL` 导航在 2026-09-30
的 **6726** 更新后也静默失效(`src=""`、`act=0`,桥日志记 `bridge nav failed: panel dead`)
—— 所以快路是 **① https 面板**(需信任本机证书),**② BTIPC 是全程保留的兜底**,
③ 只剩最后一级。详见 §4.2 与 `docs/btipc-https-v1.md`。

> 2026-10-03 实测(`logs/bridge.log`):
> `bridge transport: AsyncWebRequest removed/unavailable, using HTML panel channel`、
> `bridge nav failed: panel dead (no lct-alive within 1.5s) | title(undefined)="" act=0 src=""`
> 与 `BTIPC TRQ w=.. op=config text="{}"` + `boot: config synced from bridge` 同时存在。

## 2. 消息流(收)

1. 轮询扫描 `ChatMessages` 子面板(快节奏 0.2s / 慢节奏 0.8s)
2. 从每行提取:频道(ChannelName)、发送者(SenderName)、正文(MessageContents)
3. 签名 = `channel \x00 sender \x00 text`,用于去重(Set)与缓存(Map)
4. 过滤:空/短文本、纯数字符号、`/` 指令、自己的消息、已为目标语言(启发式);
   **总开关 `enabled=false` 时收发都不翻**(见 §5)
5. 入队 → 串行翻译(MAX_ACTIVE=1)→ 成功追加译文 Label / 失败红字(重试 1 次);
   翻译请求经 §4.2 的通道送桥(https 优先,BTIPC 兜底)、译文从同一条信道读回
6. 聊天滚动回收后,签名命中缓存则自动重建译文
7. 快捷语音轮盘消息(模板命中)直接 skip 不送翻;模板语料由桥同步或打包兜底
   (`core/quickchat.js` 生成,见 `tests/quickchat_match.test.js`)

## 3. 消息流(发)

- `chat.xml` 的 TextEntry `oninputsubmit` 改由 `LCTOnChatSubmit()` 接管
- `/tr` → 让桥用系统默认浏览器打开桌面设置页 `/ui`(不发送);`/tr panel` → 只开游戏内旧面板
- **网页设置页**(`core/web/ui.html`,由桥在 8791 提供):10 种界面语言(默认跟随游戏界面语言)、
  翻译服务表单、游戏内行为卡片、通道健康卡;保存后经 §4.3 的推送链路 <1 秒生效
- 发送前翻译开启 → 先翻译输入文本(经 §4.2 的通道,超时/通道不可用则**按原文发送**),
  再派发 `CitadelChatInputSubmitted` 事件触发原版发送(该事件路径在 poker 系 mod 中已验证可用)
- 其余情况直接派发事件,行为与原版一致

## 4. 桥协议(受限,非通用代理)

### 4.1 端点

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/btipc/dl?w&r&p&t` | GET | **① BTIPC 下行**:位=1 → 200 PNG,位=0 → 404(见 [btipc-v1.md](btipc-v1.md)) |
| `[LCT] BTIPC REQ/CAN ...` | console.log tail | **① BTIPC 上行**:游戏写结构化行,桥轮询 `console.log` 读回 |
| `/bridge?id=..&op=..&text=..&source=..&target=..` | GET | **③** 隐藏面板页面;结果写回 document.title = `LCT<id>+JSON` |
| `/bridge?op=watch&rev=..` | GET | **配置变更长轮询**:页面把标题写成 `lct-watch`,桥在配置变化时立刻回 `LCTW{…}`(见 §4.3) |
| `/api/v1/watch?rev=..` | GET | 配置指纹长轮询(同上,页面内部 fetch 用) |
| `/api/v1/translate` | POST | `{operation,provider,text,sourceLanguage,targetLanguage}` → `{ok,translation,detectedLanguage}` |
| `/api/v1/test` | POST | 用当前配置翻译固定文本,验证 Key |
| `/api/v1/config` | GET/POST | 读(打码)/写(支持打码回传)配置;POST 带 `{"revOnly":true}` 时只回 8 位配置指纹(约 30B) |
| `/watch` | GET | 网页/游戏用的配置指纹页:标题里直接带指纹,零 JS 立即返回(轮询兜底用) |
| `/ui` | GET | **网页设置页**(`core/web/ui.html`):`/tr` 用系统浏览器打开的就是它 |
| `/api/v1/health` | GET | 健康检查 |
| `/api/v1/quickchat` | GET | 快捷语音模板语料(桥从本机游戏 loc 实时生成,含指纹) |
| `/api/v1/gamenames` | GET | 英雄/物品名保护名单(`config/gamenames.json`) |
| `/api/v1/log` | GET/POST | 游戏侧日志上报(诊断探针) |
| `/api/v1/version-check` | GET | 版本检查 |

安全:仅监听 127.0.0.1;请求体 ≤64KB;单文本 ≤4000 字符;无任意 URL 代理;
日志不含 apiKey;apiKey 只在本地 `config/config.json`(gitignore)。

### 4.2 游戏 → 桥:通道与派发顺序(`dispatchJob`)

| 优先级 | 通道 | 承载的请求 | 状态(2026-10-16 实测) |
| --- | --- | --- | --- |
| ① | **https 面板**(终结于 `core/bridge_https.js` 8792) | 出站翻译、入站聊天翻译、配置读写、测试、读数 | ✅ **优先**:开机探针 `ALIVE` 后一个 RTT;`bridge_https.log` 逐条可对齐 |
| ② | **BTIPC**(协议 [btipc-v1.md](btipc-v1.md),实现在 `core/btipc/`) | 同上全部(https 硬失败时原样交回,不扣重试;探针判死则全程走它) | ✅ **兜底**:`BTIPC TRQ w=.. op=config` + `boot: config synced from bridge` |
| ③ | http 面板 `SetURL` → `/bridge` + `document.title` 轮询 | BTIPC 恰好接不下(busy/too_long)时 | ⚠️ 判死冷却 10min,最后一级 |
| ✕ | 直连 `$.AsyncWebRequest` → `/api/v1/*` | 无(仅留探测) | ❌ 游戏已移除该 API,调用即抛 `AsyncWebRequest has been removed.` |

- **① 的上行硬依赖 `-condebug`**:游戏→桥只能读 `game/citadel/console.log`(桥
  `startGameLogTail()` 每秒尾随),而该文件**只在游戏带 `-condebug` 启动时**才会生成。
  缺参 = ① 上行全断 + ②③ 本就不可用 ⇒ mod 装了完全没反应(2026-10-03 玩家反馈即此因)。
  `StartDeadlock.bat` 用 `steam://run/1422450//-condebug` 自动带上(`steam://rungameid/`
  没有传参位置);从 Steam 界面直接启动则必须由玩家在 属性 → 常规 → 启动选项 填一次。
  桥侧兜底:游戏运行 90s 仍无本次启动的 `console.log` → `logs\bridge.log` 打一条
  `[warn] 缺少 -condebug` 并给出修复步骤(每次启动只判一次)。
- **① 的上行文件路径同样不能写死**(2026-10-03 玩家反馈「桥漏查 D 盘游戏日志」):
  旧实现只列 `F:\SteamLibrary` 与 `C:\Program Files (x86)\Steam` 两条,Steam 库在
  D:/E:/G: 或装在自定义路径的用户 `fs.existsSync` 永远为假 ⇒ tail 起不来,表现与
  缺 `-condebug` 一模一样(静默不工作)。现由 `core/steam_paths.js` 统一发现:
  `cfg.gameLogPath` / `DEADLOCK_ROOT` → Steam **注册表安装路径** →
  `<steam>/config|steamapps/libraryfolders.vdf` 里登记的**全部库** → 老写死路径兜底;
  没找到时每 60s 重扫一次候选(库是后来才加的也能接上)。
  同款修法也用在 `core/game_names.js`(否则 `/gamenames` 在非标准路径下静默为空)。
  护栏:`tests/bridge_paths_logs_guard.test.js`。
- ① 接不了的三种情形(`payload > 680B` 的 `too_long`、目标语言不在 `[A-Za-z0-9-]` 安全字符集、
  通道忙等超过死线)会**回落 ②→③**;两条旧通道都不可用时,出站**按原文发送**、
  配置/测试操作回 `{ok:false, error}`(状态栏给出具体错误)。
- BTIPC 忙时**不立刻回落**:chat/outgoing 短等 `6 × 0.5s`(死线 12s),op 等满读死线
  (50s)+2s 缓冲,避免掉进必死的旧通道。
- **面板通道判死冷却**(死链日志的处置,`tests/lc_panel_nav_guard.test.js` 护栏):③ 连续
  `PANEL_NAV_DEAD_STREAK=3` 次 `src=""`(引擎压根没开始加载页面;加载慢不算,免得误杀)即判
  通道死,随后 `PANEL_NAV_COOLDOWN_MS=10min` 内 `dispatchViaPanel` 直接走 `!panel` 快速失败
  分支 —— 不再 `SetURL` 导航、不打日志;到点自动复探,导航一旦成功立即解除。
  细节日志 `bridge nav failed` 全程只打一次,进冷却只打一条摘要;
  离线复探直连通道(`reset to re-probe direct`)同样限流 `CANHTTP_REPROBE_MS=10min` 一次。
  效果:死链日志从**每 15s 一条**降到每冷却周期一条。
- **已知欠账已结清**(btipc07 + https 扩围,2026-10-15/16):`health`、`quickchat`、`gamenames`
  动态同步已迁出旧通道 —— 经 BTIPC `get` 或 https 面板通道,指纹一致时零传输
  (`gamenames sync: fingerprint match` / `quickchat templates delta applied`);
  打包内置兜底(快捷语音 fallback 模板、硬编码 `PROTECT_NAMES`)仅在桥不可达时生效。

### 4.3 配置下发:网页保存 → 游戏 <1 秒生效(2026-10-20)

设置搬到**网页设置页**(`/tr` 用系统浏览器打开 `http://127.0.0.1:8791/ui`)后,网页保存只落
`config/config.json`;游戏侧原本**只在开机读一次**(`boot: config synced from bridge`),
于是"网页改了游戏不认"。现在的下发链路:

```
网页点保存 ──POST /api/v1/config──▶ 桥落盘 + 记下新指纹(configRev)
                                    │
                                    ├─▶ 叫醒游戏挂在桥上的长轮询 /api/v1/watch?rev=<上次指纹>
                                    │      (指纹已变 → 立刻回 {ok,rev,changed:true};没变 → 挂住 ≤20s)
                                    ▼
        页面把应答写进 document.title = LCTW{…} ──引擎事件──▶ 游戏读到 → 重读配置 → 落地
```

- **信号走标题通道,整份配置不走**:标题通道约 512 字符上限,配置约 400 字节,塞不下也不该塞。
- 指纹由 `maskCompact` 派生(`core/config.js` 的 `configRev()`):内容不变则指纹不变,
  桥重启后指纹也不变(内容派生,不是计数器)。
- 兜底:15s 一次的指纹轮询(推送没挂上时顶班)。
- 面板标题的三个引擎行为(经**事件**送达/同帧标题变更会合并/第二个 HTML 面板的标题事件收不到)
  与最终实现,见 [btipc-https-v1.md](btipc-https-v1.md) §9。
- 实测:网页保存 → 桥落盘 <100ms → 游戏读到信号 <200ms → 重读落地 ~100ms ⇒ **合计 <1 秒**。

## 5. 配置

- **桥配置**(`config/config.json`,含 apiKey):由**网页设置页**或游戏内旧面板经桥写回,或手动编辑
- **游戏侧 UI 偏好**(enabled/displayMode/outgoing/outgoingTarget/force/timeoutMs):
  存于根面板属性 + convar `lct_ui`,不包含任何密钥
- **"启用翻译"是总开关**:关掉后**收发都不翻译**(2026-10-20 修:此前它只管发送前翻译)

## 6. 翻译服务商

主服务商与回退链由 `config.json` 的 `provider` / `fallbackProviders` 决定;
游戏侧只需传 provider id,新增/切换服务商对游戏内无感。

### bing(默认,免 Key)

- **当前协议(2026-09-19 起)**:`POST https://edge.microsoft.com/translate/translatetext?to=<lang>[&from=<lang>]&isEnterpriseClient=false`
  - body 为 JSON 数组 `["<text>"]`
  - 响应与旧 ttranslatev3 同构:`[{detectedLanguage:{language},translations:[{text,to}]}]`
  - **无需任何 token/Key**,不存在 token 失效问题;语言代码直接传目标语言(含 `en`,旧版 en→en-GB workaround 已随协议切换移除)
  - 429 限流:指数退避重试(1s→2s→4s,最多 3 次)
  - 协议参考 plainheart/bing-translate-api v4 的 MET 模式(该端点即 Edge 浏览器内置翻译所用)

### 协议变更历史(排障用)

| 时期 | 协议 | 现状 |
| --- | --- | --- |
| ~2026-08 上旬 | `edge.microsoft.com/translate/auth` 免 Key 授权端点 | 已 404 下线 |
| 2026-08 ~ 2026-09 | Bing 网页翻译 `ttranslatev3`(GET /translator 提取 IG/IID/token 后 POST) | `www.bing.com` 会 302 到 `cn.bing.com`(区域跳转),cn 子域签发的 token 被其自家接口拒绝(401 `{"ShowCaptcha":false}`,刷新无效),弃用 |
| 2026-09-19 起 | Edge `translatetext`(免鉴权) | 当前使用 |

> 排障提示:日志出现 `接口拒绝访问(401/403)` 且 provider 为 bing 时,多为微软接口/协议变动,
> 先对照上表,再参考 plainheart/bing-translate-api 的最新实现跟进。

### microsoft(可选,需 Azure Key)

- `POST https://api.cognitive.microsofttranslator.com/translate?api-version=3.0`
- 头:`Ocp-Apim-Subscription-Key`;配置了 region 时另带 `Ocp-Apim-Subscription-Region`

### 其它(deepl / google / openai 兼容)

- 各自独立 provider 文件,需在设置面板填对应 Key;主服务商失败时按 `fallbackProviders` 依次回退(未配 Key 的自动跳过)

## 7. 复用与扩展

- 新增翻译服务商:`core/providers/` 新增文件,在 `registry.js` 注册即可,
  游戏侧无改动(面板的服务商字段填 id)
- 多语言:设置面板改 `targetLanguage` 即可
