# btipc07 — health / gamenames / quickchat 迁 BTIPC(指纹协商 + 分片 + delta)

> **状态**:历史 · **适用版本**:btipc07(2026-10-04 落地) · **最后核对**:2026-11-01
> **说明**:设计已实现,行为以 `core/btipc/` 与 `lingua_chat.js` 为准;保留本篇用于追溯"为什么这么设计"。

状态:已实现,离线护栏 19 个测试文件全绿;**未实车**。

## 1. 要解决的问题

6726 之后 `$.AsyncWebRequest` 是死的(调用即同步抛),HTML 面板 `SetURL` 导航也全灭
(见 `docs/panorama-api-census-6726.md`)。这导致三件事从来没有真正跑起来过:

| 现象 | 根因 |
|---|---|
| 状态栏永远停在初始值,桥明明在线也显示离线 | `healthCheck` 的 BTIPC 回声成功后只 `update btipcLastOk` 就 `return`,状态更新逻辑全在必死的 `bridgePost("health")` 回调里 |
| 名称保护一直用硬编码 ~100 条名单 | `syncGameNames` 挂在同一个必死回调的 `if (!State.gamenamesLoaded)` 分支上 → 一次都没执行 |
| 快捷语音语料从不跟游戏更新 | 同上,`syncQuickChat()` 也在那个分支里 |

另外 `$.AsyncWebRequest` 死透之后,`/api/v1/gamenames`、`/api/v1/quickchat`、`/api/v1/health`
三个 HTTP GET 对游戏侧已经完全不可达 —— 想让它们动,只能走还活着的 BTIPC 位通道。

## 2. 物理约束(为什么不能"直接搬 HTTP handler")

`docs/btipc-v1.md` §9:下行一轮 = 16 字节(128 面板 × 1 bit),真机实测 **0.79 s/帧**,
即 **≈12.6 B/s**。而:

| 数据 | 紧凑 JSON(UTF-8) | 说明 |
|---|---|---|
| `config/gamenames.json` | 8 052 B / 292 条 | 全量 ≈107 片 |
| `config/quickchat.json` 模板 | 13 536 B / 735 条 | 全量 ≈151 片 |

按片长 90 B、每片约 11 s(9 帧 × 0.79 s + 3.5 s 固定开销)估算:
**全量同步 = 18~25 分钟**,期间每片还会占住单槽队列(`MAX_ACTIVE_REQUESTS = 1`)约 7 s。

所以"拉全量"只能是兜底路径,常态必须是**一条数据都不传**。三段策略:

1. **指纹协商**(握手,1 个小请求):客户端报本地指纹,桥相同 → `same=true`,传输量 0;
2. **delta**:桥能读到客户端那一版基线时,只下发增删改(实测 gamenames 144 B / 3 片 ≈33 s,
   quickchat 115 B / 2 片 ≈22 s);
3. **full**:基线缺失(老包 / 手工部署)才走,慢但正确,且有分片预算与重试上限护栏。

## 3. 协议:为什么是 `op=config` + `"get"` 字段

`core/btipc/*` **冻结**。TRQ 信封白名单是 `op=(?:config|test)`
(`core/btipc/transport.js` L128),新增 `op=health` 会被 `parseTrqEnvelope` 直接拒掉 ——
动它就是动协议。

因此新语义一律走 **`op=config` 的 JSON body 新增 `"get"` 字段**,解释权在
`core/bridge_server.js`(不在冻结面):

```
请求: op=config\n{"get":"gamenames","fp":"fnv1a-cde876fa"}
       op=config\n{"get":"gamenames","fp":"<本地指纹>","off":0,"lim":90,"exp":"<握手指纹>"}
       op=config\n{"get":"quickchat","fp":...}
       op=config\n{"get":"health"}
       op=config\n{}                       ← 原有配置读(不变)
       op=config\n{"config":{...}}          ← 原有配置写(不变)
```

`{"get":...}` 与 `{"config":...}` 互斥,`runBtipcOp` 里先判 `get`。

### 应答

| 场景 | 应答 |
|---|---|
| 握手 · 指纹一致 | `{ok:true, same:true, kind, mode, fingerprint, count, total:0}` ← **零传输** |
| 握手 · 不一致 | `{ok:true, same:false, mode:"delta"\|"full", fingerprint, count, total}` |
| 分片 | `{ok:true, same:false, kind, off, part, done}` |
| 拉到一半配置被重建 | `{ok:false, error:"fp_changed"}` |
| health | `{ok:true, provider, version, updateInfo?}` |

### 三个必须自洽的约定

- **`fp` 恒为客户端本地指纹**(握手与分片都传它)。桥用它算 `mode`;分片阶段若换成
  桥侧指纹,`encodeFor` 会退化成 `full`,和握手给的 `total` 对不上。
- **`exp` 是握手时桥回的指纹**,分片原样回传 → 桥据此发现"拉到一半配置被重建"。
- **`off` 用 `undefined/null` 判握手**,不能用 falsy —— `0` 是合法偏移。

### 分片预算

`lim` 按 **JSON 编码后的字节数**限(不是字符数):中文 1 字符 = 3 字节,且载荷再包一层
JSON 时里面的反斜杠/引号会被二次转义(最多翻倍)。`sliceByJsonBytes` 用二分找最大可用
`end`,保证单片 `Buffer.byteLength(JSON.stringify(part)) <= lim`(单个字符装不下时允许
最多 8 字节余量,否则无法前进)。

- `DEFAULT_LIM = 90`(实测 9 帧 ≈7 s),`MAX_LIM = 200`
- 游戏侧 `SYNC_LIM_BYTES = 90` ≤ 140 —— **必须低于出站 15 s 排队丢弃线**,
  否则同步期间玩家发的消息会被 `job.enqueuedAt > 15000` 直接发原文
- 每片之间检查 `State.queue.length > 0 || State.activeRequests > 0`,`$.Schedule` 让位,
  **翻译优先**(单槽队列,不让位会把翻译卡十几秒)

## 4. 基线:为什么发布包要多带两个文件

delta 的前提是"桥知道客户端手上是什么"。客户端那份数据在打进 VPK 的
`mod/panorama/scripts/*_fallback.js` 里,而 `package_release.ps1` 原本**不带 `mod/`** ——
玩家侧桥永远读不到基线,只能走 full(十几分钟)。

所以包里单独补一份到 `mod\panorama\scripts\`(与 VPK 内同源),缺文件直接 `Fail`。

| 基线文件 | 抽出的内容 |
|---|---|
| `lingua_chat_gamenames_pairs_fallback.js` | `LCT_GAMENAMES_PAIRS` + `LCT_GAMENAMES_PAIRS_FP` |
| `lingua_chat_quickchat_fallback.js` | `LCT_QUICKCHAT_FALLBACK_TEMPLATES` + `LCT_QUICKCHAT_FALLBACK_FINGERPRINT` |

桥比对 `基线指纹 === 客户端上报指纹` 才走 delta —— 这是**正确性前提**:
delta 的目标值是绝对值(新增/改译名直接给新值),在"客户端确实等于基线"时施加才等价于
`基线 → 现值`。客户端会在同步成功后更新自己的指纹,所以同会话内再同步会退回 full(正确,
但会慢);跨会话重启回到烘焙值 → 又能走 delta。

## 5. gamenames 为什么要新烘焙一份配对名单

原客户端只有硬编码 ~100 条 `PROTECT_NAMES` + 一张平表 `LCT_GAMENAMES_FALLBACK`
(键值被排序打平,**配对信息丢失**,不能用来还原中文译名),而且**没有指纹** ——
每次握手都会被判不一致,白传一次。

新增 `core/game_names.js → writeClientFallback()` 生成
`lingua_chat_gamenames_pairs_fallback.js`(292 条 `英文 → 中文` + 指纹),
与 `config/gamenames.json` 同批同源,所以常态指纹必然相同:

```
pairs entries=292 fp=fnv1a-cde876fa
config fp=fnv1a-cde876fa -> match: true
```

启动时 `boot() → initBakedGameNames()` 装载它,覆盖面比硬编码翻一倍。

> `core/quickchat.js` 是约束范围外的不动文件,所以写入点放在 `core/game_names.js`
> (它自己就是 gamenames 的生成器),两个生成器各写各的兜底文件,互不覆盖。

## 6. health

- 15 s 一次的 REQ 回声保持不变(1 帧,便宜);
- **回声成功 → `onBridgeAlive()`**:置在线、更新状态栏、补触发配置/名单/语料三个同步、
  每会话一次 `{"get":"health"}` 取 `provider` / `updateInfo`(回声不带这些字段);
- 回声失败 / 超过 45 s 无成功 / 既不新鲜也没有在途传输 → `onBridgeDown()`(先给宽限再判红);
- 传输在途(`State.btipcActive`)视为桥活着,避免同步分片期间误报离线。

## 7. 改动面

| 文件 | 改动 |
|---|---|
| `core/sync_data.js` | **新增**。指纹 / delta / 切片 / `syncGet` 全部纯函数(不依赖 quickchat,防 `game_names → sync_data → quickchat → game_names` 循环) |
| `core/bridge_server.js` | `runBtipcOp` config 分支加 `get` 分发;`readSyncBaseline`;`/api/v1/gamenames` 补 `fingerprint`;`sync_data.js` 进模块完整性自检 |
| `core/game_names.js` | 新增 `writeClientFallback()`;主入口顺带生成配对名单 |
| `mod/panorama/scripts/lingua_chat.js` | `bridgePost` 折叠 op、`job.read` 读死线、`onBridgeAlive/onBridgeDown`、`syncViaBtipc` 分片、`applyNamesPayload`、`syncGameNames`/`syncQuickChat` 改写、`initBakedGameNames` |
| `mod/panorama/layout/{chat,hudchat}.xml` | include 配对名单(先于 `lingua_chat.vjs_c`) |
| `scripts/package_release.ps1` | `sync_data.js` 进必需清单;随包带两份基线(缺文件 `Fail`) |
| `tests/btipc07_sync.test.js` | **新增** 38 条:同源对拍 / 握手 / delta / full / fp_changed / off=0 / 分片预算 / 缓存 |
| `tests/lc_btipc07_guard.test.js` | **新增** 53 条:接线护栏(信封折叠、health 触发、让位、打包、冻结面) |

**未动**:`core/btipc/*`、`providers/dictionary/config/css/quickchat`、信封白名单、帧格式、状态机。

## 8. 实车验收清单

**两轮实车(详见 checklist §17.8 / §17.9):1 ✅;2 ✅ —— 第二轮 07:24:07 与 07:24:16
两条 `fingerprint match, no transfer` 已可见,握手各 `out=110B frames=11`,全程零分片;
3 代码路径已跑到(无日志,**建议目视确认**);6 🟡 半测;4、5 ⬜ 未测。
第二轮另挖出**缺陷 A**(单发 `$.Schedule(大 N)` 的死线早于 `Date.now()` 触发,
把本该成功的 config 读打死),已在 `btipc07c` 修(见 §17.9)。**

1. 控制台应出现 `game names: baked pairs loaded (292, fp=fnv1a-cde876fa)` —— ✅ 07:00:02;
2. 首次 `bridge online` 后 ≤15 s 内出现零传输日志(常态 `total=0`,**不应**出现上百片)
   —— ✅ 实测 `out=110B` 即 `same=true,total=0`,且 6 分钟内全程零分片;
   ⚠️ 首轮这条日志不存在(已修);⚠️ 实际因 config 同步重复占槽被挤到 07:01:27(已修);
3. 状态栏在线时应显示 `桥已连接 · <provider>` —— ✅ 由 `setBridgeStatus` 写
   `LCTBridgeStatus`,`markBridgeUp` 同步刷新 `LCTBridgeStatusLabel` 与圆点;
4. 人为制造不一致(改 `config/gamenames.json` 一条译名后重启桥)→ 应看到
   `mode=delta`、3 片左右收齐、`gamenames applied … via delta`,期间发消息翻译不卡 —— ⬜ 未测
   (桥级 E2E 已覆盖同一条链路,29 PASS);
5. 老包场景(删掉发布包里的 `mod\` 目录)→ 应退 `mode=full`,分片有进度、有预算护栏 —— ⬜ 未测;
6. 来回切设置面板 / 关桥,状态栏应在宽限期后变红、恢复后自动清错 —— 🟡 **半测**:
   07:29 两次回声 8s 超时(STORM CRC 连败)→ `grace started`,15s 后再失败但**没撑到
   25s 宽限**,07:29:49 回声 DONE → `onBridgeAlive` 清宽限,**全程没误判红**;
   「真关桥 → 变红」那一半仍未做。

## 9. 已知取舍

- **full 路径很慢**(18~25 分钟)。gzip+base64 能压到 6~8 分钟,但游戏侧要自带 inflate;
  评估后认为 delta 才是常态路径(22~33 s),为兜底路径加一个 150 行、真车前只能离线验证的
  解压器不划算 —— 若实车发现 full 触发频繁,再按 `enc` 握手字段加压缩协商。
- 分片期间**单次仍会占住队列约 7 s**(物理下限,帧就是这么慢)。片间让位保证了
  "翻译插队",但极端情况下入站译文最多晚 ~7 s 出现。
- 同会话内 delta 只能走一次(施加后本地指纹变了,桥的基线对不上)。同步本身每会话只跑一次,
  实际不影响。
