# 架构文档

## 1. 总览

```
┌──────────────────────── 游戏进程 ────────────────────────┐
│  Panorama(聊天 UI)                                        │
│  ┌────────────────────────────────────────────┐          │
│  │ lingua_chat.js                              │          │
│  │  扫描 #ChatMessages 行                      │          │
│  │  签名去重 / 缓存 / 语言启发式                │          │
│  │  队列(串行)                                 │          │
│  │  隐藏 HTML 面板 ── BLoadUrl ──┐             │          │
│  │  (轮询 panel.title 读回)      │             │          │
│  └───────────────────────────────┼─────────────┘          │
└───────────────────────────────────┼───────────────────────┘
                                    │ localhost:8791(仅本机)
┌───────────────────────────────────┼───────────────────────┐
│  本地翻译桥 Node.js(core/)         │                       │
│  /bridge 页面(同源 fetch 受限 API) ◄┘                       │
│  /api/v1/translate|test|config|health                      │
│  providers/*.js ── HTTPS ──► 翻译服务商                     │
│  (bing免Key/Azure/DeepL/Google/OpenAI兼容,见 §6)           │
└────────────────────────────────────────────────────────────┘
```

游戏内的 Panorama 无法直接发 HTTP(Deadlock 移除了 `$.WebRequest`),
因此用**隐藏 HTML 面板**加载本地桥页面;页面内 JS 在同源下调用受限 API,
再把结果写回 `document.title`,Panorama 轮询读取(带请求 id 前缀防串扰)。

## 2. 消息流(收)

1. 轮询扫描 `ChatMessages` 子面板(快节奏 0.2s / 慢节奏 0.8s)
2. 从每行提取:频道(ChannelName)、发送者(SenderName)、正文(MessageContents)
3. 签名 = `channel \x00 sender \x00 text`,用于去重(Set)与缓存(Map)
4. 过滤:空/短文本、纯数字符号、`/` 指令、自己的消息、已为目标语言(启发式)
5. 入队 → 串行翻译(MAX_ACTIVE=1)→ 成功追加译文 Label / 失败红字(重试 1 次)
6. 聊天滚动回收后,签名命中缓存则自动重建译文

## 3. 消息流(发)

- `chat.xml` 的 TextEntry `oninputsubmit` 改由 `LCTOnChatSubmit()` 接管
- `/tr` → 打开设置面板,不发送
- 发送前翻译开启 → 先翻译输入文本,再派发 `CitadelChatInputSubmitted` 事件
  触发原版发送(该事件路径在 poker 系 mod 中已验证可用)
- 其余情况直接派发事件,行为与原版一致

## 4. 桥协议(受限,非通用代理)

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/bridge?id=..&op=..&text=..&source=..&target=..` | GET | 隐藏面板页面;结果写回 document.title = `LCT<id>+JSON` |
| `/api/v1/translate` | POST | `{operation,provider,text,sourceLanguage,targetLanguage}` → `{ok,translation,detectedLanguage}` |
| `/api/v1/test` | POST | 用当前配置翻译固定文本,验证 Key |
| `/api/v1/config` | GET/POST | 读(打码)/写(支持打码回传)配置 |
| `/api/v1/health` | GET | 健康检查 |

安全:仅监听 127.0.0.1;请求体 ≤64KB;单文本 ≤4000 字符;无任意 URL 代理;
日志不含 apiKey;apiKey 只在本地 `config/config.json`(gitignore)。

## 5. 配置

- **桥配置**(`config/config.json`,含 apiKey):由设置面板经桥写回,或手动编辑
- **游戏侧 UI 偏好**(enabled/displayMode/outgoing/outgoingTarget/force/timeoutMs):
  存于根面板属性 + convar `lct_ui`,不包含任何密钥

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
