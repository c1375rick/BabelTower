# 无桥 POC 结果(2026-10-31 模拟/浏览器 + 2026-11-01 真机,Deadlock 6726+ 线)

> 任务书:[docs/poc_bridgeless_cef.md](../docs/poc_bridgeless_cef.md)
> **S1–S5 已在真游戏 CEF 内跑通**(2026-11-01,`pak90_dir.vpk`,见 §2–§6)。
> 纪律:未改 `mod/`、`core/`、`dist/`;未起任何桥、未占用 8791/8792(机器上另有一套**先前已在运行**
> 的正式桥,POC 不经过它,见 §现场恢复)。
> `pak15_dir.vpk` 测试期间移出到 `poc/pak15_parked.vpk`,**已移回并核对**(见 §现场恢复)。

## 0. 一句话结论

**GO(有条件)**。真游戏 CEF 里:公网 HTTPS 托管页**能加载、能执行 JS、title 能回程**;
hash↔title 回环 **12/12 按序**、通道 RTT **2–24ms**;**localStorage 跨游戏重启持久**(bootCount 递增);
**CORS 矩阵在 CEF 内大量放行**——免 Key 的 Bing/mymemory 直连可用,**自备 Key 的 OpenAI/Google
也能被页面直调**(401/400 的原生 JSON 错误可读),即"Key 用户"路径在无桥下成立。
原评估的"致命伤 1:CORS 墙"**在真机 CEF 上被大幅证伪**。

---

## 1. 证据分层(可信度)

| 层 | 工具 | 用途 |
| --- | --- | --- |
| A. 模拟环境 | `poc/sim/*`(假 Panorama + 假 CEF + 真页面 JS;**无桥**) | 协议/逻辑回归,16/16 PASS |
| B. 应用内 Chromium | OpenCode 内置浏览器(Chrome 152) | 旁证;**网络路径与游戏不同**(见 §5 差异表) |
| **C. 真游戏 CEF** | Deadlock + `poc/pak90_dir.vpk` | **最终判定——已完成** |

> 层 B 与层 C 结果不一致(openai/google/libretranslate),说明 **CEF 内 CORS 必须用真机测**,
> 浏览器正/反都不能替代。**层 C 才是结论。**

---

## 2. S1 — CEF 加载公网 HTTPS 页并执行 JS ✅

真机日志(`game\citadel\console.log`,2026-11-01):

```
[POC] S1 SetURL https://c1375rick.github.io/babeltower-poc-pages/ (boot)
[POC] title=POC-ALIVE 2026-11-01T01:46:30.435Z      ← 页面 JS 执行 + title 回程
[POC] S1 ALIVE at t=…                                ← 同秒,<1s
```

| 项 | 值 |
| --- | --- |
| Pages URL | `https://c1375rick.github.io/babeltower-poc-pages/`(public;Pages=main 根目录) |
| 加载→title | **同秒(<1s)** |
| 有效 POC 启动次数 | **2/2**(每次重开都出现 `POC-ALIVE`) |
| JS 执行 | ✅ 页面 `POC_PAGE` 全功能可用(后续 S2–S5 全靠它) |
| 布局命中 | 覆盖 `chat.xml`(对局内)+ `hudchat.xml`(大厅),二者都成功引导 |

> 首轮(仅覆盖 `hudchat.xml`)对局内**无 `[POC]`** ——原因是 mod 的门户不仅在 `hudchat.xml`,
> 对局内走 `chat.xml`。补上后才命中。**产品化注意:两个布局都要覆盖。**

## 3. S2 — hash 上行 → 页面解析 → title 应答 ✅

真机 12/12,全部按序(`ping-1..12`,seq 1..12)。通道 RTT(SetURL 变 fragment → title 事件回脚本):

| n | min | avg | max |
| --- | --- | --- | --- |
| 12 | **2 ms** | **~11 ms** | **24 ms** |

> 这是**通道**往返(页面在 CEF 进程内,无网络);真实翻译再叠加 provider 外网耗时(见 §6 535ms)。
> 连续 hash 变更**每次都触发** hashchange,无丢失。

## 4. S3 — localStorage 跨游戏重启 ✅

| 阶段 | 证据 |
| --- | --- |
| 首启(bootCount=1) | `3-load-before → value:null`(首次无值,预期) |
| 写 | `3-store → stored:hello-2026-11-01`,lsOk=true |
| 同会话读 | `3-load-after → value:"hello-2026-11-01"` |
| **完全重启游戏后** | `3-load-before → value:"hello-2026-11-01", bootCount:2` ✅ |

**CEF 配置目录的 localStorage 跨游戏重启持久,`pocBootCount` 1→2 递增。** 与 QOL 4.0.5 模式一致。

## 5. S4 — CORS 实测矩阵(真游戏 CEF)✅

来源:**层 C,游戏内 CEF**(免 Key 与带 Key 分开记)。

| 端点 | Key | 判定 | 证据(CEF 内) |
| --- | --- | --- | --- |
| `edge.microsoft.com/translate/translatetext`(**现状桥的 Bing 免 Key 上游**) | 免 Key | ✅ **通** | HTTP **200**,译文可读(`你好，世界`),1897ms |
| `api.mymemory.translated.net/get` | 免 Key | ✅ **通** | HTTP **200**,`你好世界`,1894ms |
| `api.openai.com/v1/chat/completions` | 自备 Key | ✅ **CORS 放行** | HTTP **401**,body 可读:`Incorrect API key provided: no-key-poc…`,2331ms |
| `translation.googleapis.com/language/translate/v2` | 自备 Key | ✅ **CORS 放行** | HTTP **400**,body 可读:`API key not valid…`,1579ms |
| `https://libretranslate.com/translate` | 免 Key | ✅ **CORS 放行** | HTTP **400**,body 可读(提示去 portal 取 key),1827ms |
| `api-free.deepl.com/v2/translate` | DeepL Free Key | ⛔ **被 CORS 拦** | `Failed to fetch`(无 ACAO),1675ms |
| `translate.terraprint.co/translate` | 免 Key | ⛔ **被 CORS 拦** | `Failed to fetch`,1624ms |

### 5.1 与应用内浏览器(层 B)的差异——为什么必须真机测

| 端点 | 层 C 真机 CEF | 层 B 应用内浏览器 |
| --- | --- | --- |
| openai | ✅ 401 可读 | ⛔ `ERR_TUNNEL_CONNECTION_FAILED`(代理隧道,与 CORS 无关) |
| google-v2 | ✅ 400 可读 | ⛔ 同上 |
| libretranslate.com | ✅ 400 可读 | ⛔ 被拦 |
| deepl-free | ⛔ 被拦 | ⛔ 被拦 |
| terraprint | ⛔ 被拦 | ⛔ 被拦 |
| bing-edge / mymemory | ✅ | ✅ |

### 5.2 结论

- **"零 Key 开箱即用"在无桥下成立**:`edge.microsoft.com`(免 Key)在 CEF 内 CORS 放行并出译文;
  这与现状桥用的是**同一个上游**,换成页面直连不掉能力。
- **"Key 用户"路径也成立**:OpenAI/Google 的响应在 CEF 内**可被页面读取**(401/400 是服务端语义,
  不是 CORS 拦截)。即用户填自己的 Key 后,页面可直调,无需服务端。
- 真正被 CORS 挡住的只有 **DeepL Free** 与 **LibreTranslate 公共实例**;二者本就在候选矩阵边缘。
- **§2.2 / routes-comparison §3 的"致命伤 1:CORS 墙杀掉免费 Bing"在真机 CEF 上被证伪**,
  "致命伤 2:Key 硬门槛"也随之缓解(Key 是可选增强,不是入门门槛)。

## 6. S5 — 端到端半环 ✅

```
[POC] reply 5-translate ok 535ms {"ok":true,"translation":"你好世界","provider":"mymemory"}
```

游戏 console 里收到真实中文译文往返(hash 发文本 → 页面翻译 → title 回中文)= **无桥时页面具备翻译能力**。

---

## 现场恢复(状态:**已恢复并核对**)

游戏退出后已恢复,逐项核对:

| 位置 | 状态 | 核对 |
| --- | --- | --- |
| `addons\pak90_dir.vpk`(POC) | **已删除** | `Test-Path` = False |
| `addons\pak15_dir.vpk`(正式 1.2.5) | **已移回** | size = **514,412 B**,sha256 = `688A12F49C76B6284A79E3ED7A655C6FCA6A12CB3D3214918BA2EEEDFB17B1C6`(**= 移出前记录值,逐字节一致**) |
| `poc\pak15_parked.vpk` | 已消失(移回原位) | —— |

其它:游戏已退出;`mod/`、`core/`、`dist/` 未改。

**关于端口 8791/8792(如实说明)**:本 POC **全程未启动任何桥、也未主动占用**这两个端口。
收尾核查时发现机器上**已有一套先行运行的正式桥**(`core/bridge_server.js` + `core/bridge_https.js`,
监听 8791/8792,进程启动时间 2026-10-31 18:26,早于本次 POC,非本次启动——多半是用户的登录自启/
上次启动器遗留)。POC 页面**不经过**该桥(直调公网端点),测试期间 `pak15` 已移出、无人消费该桥,
故**无干扰**;它为用户的正常设施,保留不动。

---

## GO/NO-GO 建议

**GO(有条件)。**

**已证实的假设(真游戏 CEF)**
1. 公网 HTTPS 托管页可在 CEF 内加载、执行 JS、`document.title` 回程(2/2 启动)。
2. hash↔title 1 RTT 半环成立,12/12 按序,RTT 2–24ms。
3. localStorage 跨游戏重启持久。
4. CORS:Bing(免 Key)、mymemory(免 Key)**直连可用**;OpenAI/Google **响应可读**(Key 路径可用)。
5. 端到端翻译在页面内完成(535ms,免 Key)。

**被证伪的结论**
- [routes-comparison.md](../docs/routes-comparison.md) §3 / [btipc-https-v1.md](../docs/btipc-https-v1.md) §11
  "免费零 Key 在无桥下因 CORS 墙不成立"——**真机 CEF 证伪**(该上游带 `ACAO:*` 且预检放行)。

**仍存的风险(不阻塞 GO,但要在产品化里处理)**
1. **免 Key 上游稳定性**:`edge.microsoft.com` 是公共免费接口,429 限流与协议变更风险与现状桥相同;
   无服务端则**没有回退链/缓存**——页面内需做多上游轮换(bing-edge → mymemory → 用户 Key)。
2. **托管单点**:GitHub Pages 国内可达性本机 2/2 通过,但仍是单点;建议备援镜像(CF Pages/对象存储)。
3. **诊断黑暗**(无 bridge.log):页面内自诊断 + title 回传已具雏形,产品化需把关键结果送到游戏侧可见处。
4. **引擎变动**:同为 10-29 三连击面(证书免疫、title 派发仍需 `CitadelHTMLPanel`+面板绑定修复——
   真机已证明该路径在**远程页**上同样工作)。
5. **两个布局都要覆盖**(`chat.xml` + `hudchat.xml`),否则对局内或大厅其一失效。

**若 GO,最小产品化缺口清单**
1. 页面内**多上游轮换 + 限流退避**(免 Key 优先,Key 可选增强)。
2. **诊断面**:结果回传 + 页面内错误可视化(替代 bridge.log)。
3. **托管备援**(多域名/镜像 + 启动探测)。
4. 配置从 localStorage 迁到页面 UI(Key 输入、语言、模式),复用 QOL 的分片/队列/看门狗。
5. 真机回归:每次引擎更新后重跑本 POC 的 S1/S2/S4(三条是引擎面)。

---

## 附:复现

```powershell
# A. 模拟环境(无桥)
F:\BabelTower\portable-node\node.exe F:\BabelTower\poc\sim\run_poc_sim.js

# 生成 POC 布局(从当前 mod 布局派生)+ 打包
F:\BabelTower\portable-node\node.exe F:\BabelTower\poc\make_poc_layouts.js
powershell -ExecutionPolicy Bypass -File F:\BabelTower\poc\build_poc_vpk.ps1

# C. 真机:退游戏 → 移 pak15 → 装 pak90 → -condebug 启动 → 跑 poc\tail_poc.ps1
```

## 附:已回填总文档(S6)

任务书 S6 要求"回填 `routes-comparison.md` §7.3 触发器证据行"。**已按附录草稿追加**(2026-11-01):

- 位置:`docs/routes-comparison.md` §7 第 3 条(路线 ③ 的触发器)下的一个子条目。
- 内容:本 POC 真机 CEF 数据摘要(加载/title 回程 2/2、hash 12/12 RTT 2–24ms、localStorage 跨重启持久、
  CORS 矩阵结论、"先解决 Bing 免 Key CORS 中继"被证伪、遗留风险)。
- **未改动 §3 结论段任何字句**(按任务书要求),仅在 §7.3 追加证据行。
