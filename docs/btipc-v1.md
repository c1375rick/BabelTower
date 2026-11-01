# BTIPC v1 Protocol Specification(冻结版 2026-10-02)

> **状态**:冻结 · **适用版本**:协议 v1(2026-10-02 定稿) · **最后核对**:2026-11-01
> **上游/证据**:`docs/ipc-downlink-benchmark-6734D.md`、`docs/ipc-multivalue-benchmark-6734E.md`、`docs/ipc-checklist-6726.md` §7–§8
> **一句话**:BTIPC 的帧格式、状态机与冻结参数;改动需独立授权,只允许追加变更记录。

> 状态:**冻结 + 已实现并实车验收**(规格即契约,实现须逐条对齐;改动需升版本)。
> **落地**:随 `1.0.7 (2026-10-03)` 发布,承载出站翻译 / 入站聊天翻译 / 配置读写(`op=config`,`op=test`)。
> 当前游戏版本已移除 `$.AsyncWebRequest`、6726 更新又废掉面板 `SetURL` 导航,
> **BTIPC 是唯一可用的桥通道**(三通道现状见 `architecture.md` §4.2)。
> 实现文件:`core/btipc/{crc16,framer,window,transport}.js` + 游戏侧 `lingua_chat.js` 的 `State.btipc`。
> 2026-10-02 十点终审已并入:位段显式化(§3.2)/ CRC 范围锁定(§3.2)/ BUSY 固定帧(§3.2)/ round 写死(§4.0)/ 参数补全(§9)/ 位序正式例(§3.3)/ Promise API(§7)/ 文件结构与顺序(§13)/ Security(§14)/ 评价表(§15)。
> 数据依据:`docs/ipc-downlink-benchmark-6734D.md`(D 组,run=324926 + 新 build 复验 890861)、`docs/ipc-multivalue-benchmark-6734E.md`(E 组,run=615338 + 新 build 复验 261844)、checklist §7~§8。
> 适用 build:25658155(已复验);25639407(兼容,参数取保守值)。

---

## 1. 设计原则(全部来自实测,禁止再假设)

1. **只信两个符号**:`ImageLoaded` 到达 = 1;未到达(12s 内)= 0。**禁止用时延差异编码信息**(E 组:新 build 3xx 二跳 2545→121ms,时延符号跨版本不稳定);
2. **0 位不可早知**:某面板没 fire,要么是 0 位、要么是还没到的 1 位 → 每轮闭合只能靠 **T_close + CRC 校验 + 重试**(v1.1 有精确闭合升级,见 §10);
3. **无推送**:桥 → 游戏无主动通道,**轮询即请求**(SetImage 的 URL 本身就是"给我第 r 帧");
4. **隐式 ACK**:游戏把轮次号 r 前进 = 确认上一帧;重试同一 r = 桥必须幂等重发同帧;
5. **全部参数有实测出处**(§9 参数表);
6. **与探针严格隔离**:面板前缀 `BTIPCD*`,路由 `/btipc/*`,互不干扰(B/D/E 探针用 BTBIT*/BTD*/BTE*)。

---

## 2. 信道拓扑

```text
┌─────────────────────── 游戏(Panorama)───────────────────────┐
│ BTIPC Client                                                 │
│  出站: console.log 行  "[LCT] BTIPC REQ/CAN ..."  (J1 通道)   │
│  入站: 128 个隐藏 Image 面板逐轮 SetImage 轮询               │
└──────────────┬──────────────────────────────┬────────────────┘
               │ console.log tail             │ GET /btipc/dl?w&r&p&t
               ▼                              ▼
┌──────────────────────── 桥(Node :8791)──────────────────────┐
│ REQ tail 解析器 → 翻译 → 帧队列 framer                        │
│ /btipc/dl: 按 (w,r) 幂等发帧:bit=1→200 PNG / bit=0→404      │
└──────────────────────────────────────────────────────────────┘
```

- **出站(游戏→桥,文本)**:console.log 结构化行(实测 1000 字符零截断、UTF-8 完整、10 连发零丢);
- **入站(桥→游戏,文本)**:128 面板位元轮询,每轮 16 字节帧;
- **ACK**:无显式 ACK —— 轮询 r 的推进即 ACK,重试同 r 即重传请求(全部走 URL 参数,零额外流量)。

---

## 3. 帧格式(16 字节 = 128 bit,一帧一轮)

### 3.1 面板 ↔ 位映射

- 面板:`BTIPCD0 .. BTIPCD127`(隐藏 2×2,按需创建,跨轮复用);
- 字节 k(0..15)= bit[k*8 .. k*8+7];**面板 p 携带全局第 p 位,LSB 在前**(即 byte k 的 bit b → 面板 k*8+b);
- 编码:**位=1 → 桥回 HTTP 200(PNG);位=0 → 桥回 404(空体)**。

### 3.2 帧布局(位段写死,冻结)

```text
+----+----+----+----+----+----+------------+
| B0 | B1 | B2 | B3 |CRCH|CRCL|  Payload   |
+----+----+----+----+----+----+------------+
   \_______________/          \___________/
     CRC 输入(4B)           CRC 输入(10B)

B0      : bit7 = END      bit0..6 = seq(0..127)
B1..B2  : request_id(16 bit,游戏分配,大端)
B3      : bit7 = VALID    bit0..6 = LEN(0..10)
          VALID=1 数据帧 / VALID=0 BUSY 帧;LEN=本帧 payload 有效字节数
B4..B5  : CRC-16/CCITT-FALSE(poly 0x1021, init 0xFFFF),大端存放
B6..B15 : payload(10 字节字段,LEN 不足处补 0x00)
```

- **CRC 覆盖范围(冻结)**:`CRC16(B0..B3 + B6..B15)` = 固定 14 字节(含 LEN 之后的 0x00 填充),**不含 CRC 自身**;
  seq/id/VALID/LEN 全属协议控制信息 → round 错位、LEN 被改都会被 CRC 揪出,decode 后无需再验字段;
- 掩码读写(Panorama JS,写死):

```js
const end   = (b0 & 0x80) !== 0   // bit7
const seq   =  b0 & 0x7f           // bit0..6
const valid = (b3 & 0x80) !== 0   // bit7
const len   =  b3 & 0x7f           // bit0..6
// 编码对称:b0 = (end ? 0x80 : 0) | seq; b3 = (valid ? 0x80 : 0) | len
```

- 消息 = 帧 0..N 的 payload 顺序拼接(按 seq);END=1 的帧是最后一帧,其 LEN 给出有效尾长;
- **BUSY 帧固定格式(冻结,不随机)**:

```text
B0 = 0x00           (seq=0, END=0)
B1..B2 = request_id (保留,便于对账)
B3 = 0x00           (VALID=0, LEN=0)
B4..B5 = CRC16      (照常计算:输入 = B0..B3 + 全 0 payload,固定 14 字节)
B6..B15 = 全 0x00
```

  游戏侧只判 `VALID=0` → 判定 BUSY → sleep(BUSY_BACKOFF_MS) → 轮次推进,**不跑重组逻辑**;
- **CRC16 两侧各自内联实现,逐字节一致**(游戏侧 Panorama JS / 桥端 Node);测试向量见 §12。

### 3.3 位序 worked example(正式例子,测试断言照此写)

设帧首两字节 `B0 = 0x01`、`B1 = 0xA5`,LSB first(panel p ← byte[p>>3] 的 bit(p&7)):

```text
B0 = 0x01 = 0000 0001
  bit0=1   → panel0  = 1 (200,将 fire)
  bit1..7=0 → panel1..7 = 0 (404,静默)

B1 = 0xA5 = 1010 0101   (bit7 ...... bit0,LSB 在最右)
  bit0=1 → panel8  = 1     bit4=0 → panel12 = 0
  bit1=0 → panel9  = 0     bit5=1 → panel13 = 1
  bit2=1 → panel10 = 1     bit6=0 → panel14 = 0
  bit3=0 → panel11 = 0     bit7=1 → panel15 = 1
```

→ 本轮 fires = {0, 8, 10, 13, 15}。该例跨字节边界、同时含 0x01 与 0xA5,作为 `tests/btipc/frame.test.js` 固定断言(§12.2)。

---

## 4. 入站轮次生命周期(游戏侧驱动)

```text
SHOT(r):  132→128 个面板 SetImage("/btipc/dl?w=<win>&r=<r>&p=<i>&t=<win>-<id>")
          (t=窗口号-请求号-轮次,兼缓存击穿 —— 同 win 跨请求复用时防引擎缓存串窗;URL 对 (w,r,p,轮次) 唯一,同面板同轮不重复 SetImage)
收集:     ImageLoaded → per (r,panel) 去重 → bit[p]=1
闭合:     T_CLOSE 到点 → 读出 128 bit → 组 16 字节 → 校验 CRC
判定:     CRC ok & V=1 → 交付/拼装(seq 去重);END=1 → 消息完成,停止轮询
          CRC ok & V=0 → BUSY:退避 BUSY_BACKOFF 后 r++
          CRC fail    → 重试:同 r 重投(≤RETRY_MAX);连续 2 轮 fail → 风暴模式
          T_HARD 到点(12s)仍没收齐 → 强制闭合走 CRC 判定(通常 fail→重试)
```

### 4.0 round 规则(写死,最易出 bug 处)

**游戏端**只维护一个整数 `r`(当前轮号),每轮闭合后按下表更新:

| 判定 | r 的动作 |
| --- | --- |
| CRC ok, VALID=1, END=0 | `r++`(推进 = 隐式 ACK,取下一帧) |
| CRC ok, VALID=1, END=1 | 消息完成 → resolve,停轮(r 冻结) |
| CRC ok, VALID=0(BUSY) | 退避 BUSY_BACKOFF_MS 后 `r++` |
| CRC fail | **r 不动,同轮重投**(≤RETRY_MAX;连续 2 轮 fail → 风暴) |
| T_HARD 到点仍没收齐 | 强制闭合 → 按上表判定(通常 fail → 同 r 重试) |

**桥端**不维护 `nextFrameIdx` 之类自增计数器(会与游戏脱步),帧号只由轮号现算:

```text
frameIndex = round - frameStartRound

frameStartRound = 10 时:
  round 10 → frame0
  round 11 → frame1
  round 12 → frame2
  重投 round 10 → frame0      ← 天然幂等,零状态
```

### 4.1 风暴模式(escalation)

- 触发:**连续 2 轮 CRC fail**(或单轮 dt 最大值 > 2×T_CLOSE);
- 动作:接下来 4 轮 T_CLOSE 放宽到 `STORM_TCLOSE`(2500ms),并插入 1s 轮间冷却;
- 退出:任一轮 CRC ok 即恢复正常参数;
- 依据:D 组风暴实测(进图加载期 word 15~28s、零丢失)——风暴只慢不丢,宽闭合即可吸收。

### 4.2 为什么不需要 pilot 面板

T_close 方案下,风暴 = 大量 CRC fail → 升级宽闭合,不需要额外探测位;省下 4 bit/轮。

---

## 5. 出站行格式(游戏 → 桥)

经 `console.log`(`[LCT]` 前缀,桥端 tail 解析):

```text
[LCT] BTIPC REQ w=<win> id=<id> len=<n> crc=<hex4> b64=<base64(payload)>
[LCT] BTIPC CAN w=<win>                                ← 取消/放弃窗口
```

- `<win>`:6 位十六进制窗口号(nowMs 低 24 位 hex),一次传输一个窗口;
- `<id>`:4 位十六进制 request_id(帧 B1..B2 同值);
- payload = 请求文本的 UTF-8 字节;`len`=字节数;`crc`=CRC16(payload) 大端 hex;
- 长度预算:完整 console.log 行 = 引擎前缀(≈24,含时间戳)+ `[LCT] ` + 行头 48 + b64;J1 实测上限 1000 → b64 ≤908 → **payload ≤680B**(§9 REQ_MAX_PAYLOAD;BTIPC.request 超限立即 reject too_long);按字节计不按字符计;
- 桥端校验 len/crc(此处 CRC 仅覆盖 payload,REQ 行尚无帧头;帧级 CRC 见 §3.2)/base64/windowId 格式,失败**静默丢弃**(完整规则见 §14);幂等:游戏侧超时重发 REQ,同 w 幂等覆盖。

### 5.1 上层信封(payload 首行;不动 §3~§6 的冻结协议)

传输层把 payload 当**不透明字节**;上层在 payload 开头约定一行信封头 + `\n`:

```text
t=<target>[;tm=<ms>] \n <原文>        出站翻译(目标语言必须随请求走,否则桥按默认译反方向)
op=test[;tm=<ms>]    \n <JSON>        测试:载荷 {}(桥用默认 hello / zh-Hans);响应 JSON(translation / error)
op=config            \n <JSON>        配置:读 = {},写 = {"config":{...}};响应 JSON(含 maskCompact)
<裸文本>                             无换行 / 首行不匹配信封头 → 一字不差透传
```

- **白名单**(实现:`core/btipc/transport.js` 的 `TRQ_ENV_HEAD_RE`)只有
  `op=config|test`、`t=[A-Za-z0-9-]{1,16}`、`tm=\d{1,7}`;
- 未知 `op`、未知键、不安全字符集 → 整条按裸文本透传(裸文本 = 冒烟 `/bt6737`、
  `scripts/btipc_trq_e2e.js`、老客户端;桥回退 config 默认 target,向后兼容);
- 游戏侧在**目标语言不在 `[A-Za-z0-9-]{1,16}` 时主动回落旧通道**,不让桥端信封解析失败
  而译成错误方向;
- **读写死线分离**:写应答 1 帧(`{ok:true}`)→ 8s;读应答 `maskCompact` ≈400B = 40 帧 ×
  真机 600ms/帧 ≈ 24s → 50s(btipc05d,覆盖首发起跑竞态 + 中途 CRC 重试的最坏 ≈43s)。

---

## 6. 桥端状态机(per window)

```text
窗口表 winMap[<win>] = {
  req: {id, payload, tReq},
  frames: [] | null,        // 翻译完成后由 framer 填充(16B 数组的数组)
  frameStartRound: null,    // frames[0] 首次被服务的轮号(锚定后不变)
  tLast: ts,                // GC 用
}

GET /btipc/dl?w&r&p&t:
  1. win 不存在           → 404(游戏侧视为 BUSY 等价,继续轮询)
  2. frames 未就绪        → 200,回 BUSY 固定帧(§3.2,VALID=0;与 r 无关)
  3. frameStartRound=null → frameStartRound = r;serve frames[0]
  4. r >= frameStartRound → idx = r - frameStartRound  ← 不存 nextFrameIdx(§4.0)
     idx < frames.length  → serve frames[idx]      ← (w,r) 幂等:重投同 r 得同帧
     idx ≥ length         → serve 末帧(END) again  ← 游戏正常已停轮,兜底
  5. 更新 tLast
REQ 行到达:同 w → 重置窗口(幂等覆盖);新 w → 建窗
翻译完成:   framer.encode(id, payloadText) → frames[]
GC:END 帧被服务后 45s,或窗口 60s 无活动 → 删除
    (END_GC 必须 > 客户端最长重试跨度 ≈ T_HARD 12s + 8×(2.5s+1s) ≈ 34s;
     否则窗口会在客户端仍在重试时自删 → 全 404 → 错报 crc_dead。实车 2026-10-02 已抓到该现场)
```

- **framer**:文本 UTF-8 → 每 10B 一帧 → 末帧 len=余数 + END=1;空译文 = 单帧 len=0+END;
- 幂等性由"idx 只由 r 决定"保证,不依赖 ACK 行;
- 桥重启 → 窗口表清空 → 游戏收 404/BUSY → REQ 超时兜底(§8)。

---

## 7. 游戏侧 API(lingua_chat.js 内实现,`State.btipc` 命名空间)

```js
// 冻结为 Promise 形:调用方只面对 BTIPC,不接触面板/URL/桥(升 v1.1 不动调用点)
BTIPC.request({ windowId, text, timeoutMs })
  .then(resultText => { /* 成功:译文文本 string */ })
  .catch(err       => { /* err = { kind, message } */ })

BTIPC.cancel()            // 放弃在途窗口 → reject({ kind:'cancelled' })
BTIPC.busy() -> bool      // 有在途传输?
```

- `windowId`:6 位 hex(调用方生成 = nowMs 低 24 位),一次传输一个窗口;上层串行,同一时间仅一个在途;
- `text`:待译原文(UTF-8 字节即 REQ payload);`timeoutMs` 缺省 = REQ_TIMEOUT_MS(30s);
- `err.kind`:`'timeout' | 'crc_dead' | 'bridge_down' | 'cancelled' | 'too_long' | 'busy' | 'bad_args'`(too_long: UTF-8 >680B 立即拒,防 J1 超行;busy: 已有在途传输;bad_args: windowId 格式错);
- **分层铁律**:`lingua_chat 业务 → BTIPC API(本节)→ panel transport(§3/§4)`,业务代码禁止直接拼 /btipc URL。

游戏侧状态机:

```text
IDLE → REQ_SENT(发 REQ 行 + 启动轮询 r=1)
     → POLLING(T_CLOSE 闭合循环;BUSY→退避;DATA→拼装)
     → DONE(END 拼装完成 → resolve)/ FAIL(→ reject)
```

- 轮询面板:`BTIPCD0..127`,SHost 用 `BRIDGE_HOST:BRIDGE_PORT`;
- **首拍延迟 `INITIAL_SHOT_DELAY=1200ms`**:桥 tail 轮询间隔 1000ms,REQ 行可能晚于首拍到达 → 首轮全 404 → 误触风暴;延迟 1.2s 再 SHOT(实车校准);
- **REQ 超时** `REQ_TIMEOUT=30s`:从 REQ 发出起算,BUSY 超过 30s(桥挂/翻译挂)→ reject({kind:'timeout'}) → 上层降级(按原文发送 + 提示,沿用现有 showOutgoingFailTip 路径);
- CRC 重试死线:同帧累计 fail > 8 次 → reject({kind:'crc_dead'});
- 每帧服务日志(低频):`BTIPC: r=<r> seq=<s> len=<l> dt=<ms> <OK|RETRY|BUSY|END>` → console.log tail,供验收对账。

---

## 8. 错误处理与边界

| 场景 | 行为 |
| --- | --- |
| 桥进程挂 | /btipc/dl 连接拒绝 → 面板不 fire → T_HARD 强制闭合 → CRC fail ×N → REQ_TIMEOUT 兜底 |
| 桥重启(窗口丢失) | 404/BUSY 循环 → REQ_TIMEOUT → reject({kind:'timeout'});游戏重试策略由上层定 |
| 200 丢失(引擎丢载) | fires 不足 → 闭合后 CRC fail → 同 r 重投;桥幂等重发同帧 |
| 风暴(进图/卡顿) | §4.1 升级;D 组实测风暴零丢失,只是慢 |
| CRC 连续死 | 8 次 → crc_dead → 上层按原文发送降级 |
| 文本 >680B | request 立即 reject({kind:'too_long'}) → 上层按原文发送降级 |
| 已有在途 / windowId 非法 | reject({kind:'busy' / 'bad_args'}),上层排队或修正参数后重试 |
| 用户在翻译期间再发消息 | 上层 existing outgoingPending 队列串行,同一时间一个窗口 |
| 游戏重开 | 一切内存态归零,窗口号换新,无跨会话状态 |

---

## 9. 参数表(冻结值 + 实测出处)

| 参数 | 值 | 出处 |
| --- | --- | --- |
| WINDOW_PANELS | 128 | D 组:128 已达 191 b/s,256 仅 +2.4% 吞吐、延迟 ×2.2 |
| FRAME_BYTES | 16(128 bit) | 一轮 = 一帧;位=面板 |
| PAYLOAD_PER_FRAME | 10 B | 6 B 头(seq1+id2+len1+crc2) |
| BIT1 / BIT0 | 200 PNG / 404 | E 组:200 必 fire;404 全静默(40/40 轮 ×2 build) |
| T_CLOSE_MS | 600 | 新 build bit dt:P50 31 / P95 161 / Max 522(600≈P99.9) |
| STORM_TCLOSE_MS | 2500 | D 组风暴 word 15~28s,2.5s×连续升级吸收 |
| STORM_TRIGGER(连续 CRC fail 轮数) | 2 | §4.1;单轮偶发 fail 走 RETRY,连败才升级 |
| STORM_ROUNDS(风暴持续轮数) | 4 | 4 轮宽闭合 ≈ 吸收一次进图加载突发 |
| T_HARD_MS | 12000 | D/E 轮超时同值;风暴期最慢帧仍 <12s |
| RETRY_MAX(同帧) | 3 | 600ms×4 ≈ 2.4s/帧最坏常规路径 |
| CRC_DEAD | 8 次 | ≈ 每帧 2 个风暴周期仍败 → 放弃 |
| BUSY_BACKOFF_MS | 500 | BUSY 轮询节奏(翻译典型 0.5~2s) |
| REQ_MAX_PAYLOAD | 680 B | 完整 console.log 行(引擎前缀 ≈24 + [LCT]6 + 行头 48 + b64 908)≤ 1000(J1);680B=68 帧 ≤ seq7 的 128 帧上限 |
| REQ_TIMEOUT_MS | 30000 | 覆盖慢 provider + 风暴 |
| WINDOW_TTL_MS | 60000 | 桥端 GC |
| CRC16 | CCITT-FALSE | poly 0x1021 init 0xFFFF;测试向量 §12 |
| 面板前缀 / 路由 | BTIPCD* / /btipc/dl | 与 BTBIT*/BTD*/BTE* 探针隔离 |

---

## 10. 吞吐与延迟预算(诚实数字)

```text
原始位吞吐     ≈ 128 bit / (T_CLOSE 600ms + SHOT 开销 ~50ms) ≈ 197 bit/s(新 build 稳态)
有效载荷吞吐   = 每帧 10 字节(80 bit)/ 0.65s ≈ 123 bit/s
典型译文回程   30B = 3 帧 ≈ 2.0s;60B = 6 帧 ≈ 3.9s;120B = 12 帧 ≈ 7.8s
端到端         + 翻译服务耗时(0.5~2s)→ 发送前翻译总延迟 ≈ 2.5~6s(60B 级)
```

**v1.1 升级路径(规格已定,按需触发)**:

1. **精确闭合**:B0..B7 改为"数据段 fire 计数"三元冗余 + 数据段 fires==count 闭合 → 消除数据位 CRC 误判,轮时延 → ~450ms;
2. **CONT 紧缩帧**:首帧带 id,后续帧 seq7+END+crc16+14B payload → 载荷 +40%;
3. 合计目标:60B 回程 ≤2.5s。**v1.0 先不做**,参数表不动,机制位已在 B3 预留(V 位语义不变)。

> 明示:≤2s 的硬目标对 60B 级回复需要 v1.1;v1.0 的 3~6s 已优于现状(6726 上发送前翻译当前 = 永远超时按原文发)。

---

## 11. 时序图(一次完整翻译)

```text
游戏                         桥
 │ [LCT] BTIPC REQ w=f3a1 id=00c8 len=12 crc=.. b64=..  │
 │ ────────────────────────────────────────────────►    │ tail 解析→翻译中
 │ SHOT r=1 (128 panels)                                │
 │ ────────────────────────────────────────────────►    │ 无帧 → 全帧 BUSY(V=0)
 │ ◄── 200×k / 404×(128-k) ────────────────────────     │
 │ T_CLOSE → CRC ok, V=0 → 退避 500ms                   │
 │ SHOT r=2 ────────────────────────────────────►       │ 翻译完成,帧就绪
 │ ◄── frames[0] (seq0, V=1) ────────────────────       │ frameStartRound=2 锚定
 │ SHOT r=3 → frames[1] … SHOT r=7 → frames[5](END)     │
 │ resolve("你好!") → 停轮;桥 45s 后 GC 窗口               │
```

---

## 12. 验收标准(实现完成的定义)

1. **CRC 测试向量**:`"123456789"` ASCII → CRC16 = 0x29B1(CCITT-FALSE 标准向量);全 0x00×16 → 0x0000? 以实现互检为准(游戏侧 vs 桥端同输入必同输出);
2. **framer 往返**:`framer.encode(id, text)` → 解码还原逐字节相等;text ∈ {"", 10B, 11B(跨帧), 300B 中文(多帧+END)};另断言 §3.3 位序例(B0=0x01,B1=0xA5 → fires {0,8,10,13,15})与 §3.2 BUSY 固定帧字节;
3. **模拟器**(`scripts/btipc_sim.js`):以 E/D 实测 dt 分布(新 build:P50 31/P95 161/Max 522 + 风暴模式)注入 5% 丢包 → 100 次传输零错字、重试率 <10%、吞吐 ≥100 bit/s 载荷;
4. **实车 conformance**:`/bt6736` 探针命令 → 桥 `/btipc/test?text=...` 回声模式,游戏侧解出与发送一致;0x00/0xFF/0x55/0xAA 花样帧 ×20 轮零 CRC fail;
5. **实车端到端**:真实对局 `/tr` 开启发送前翻译 → 英文消息 → 队友可见译文,日志含逐帧 `BTIPC: r=.. seq=.. OK` 全序列;
6. **风暴演练**:进图加载期发起一次传输 → 升级路径生效,最终 DONE。

**当前完成度(2026-10-03)**:`§12.1~12.3` 离线验收全绿(`node tests\btipc\*.test.js`,
crc / frame / simulator / window_gc);`§12.4` 实车回声、`§12.5` 端到端(出站
`!lcttest hello` → HUD 译文、入站轮盘 13 条正确跳过)已通过,取证见
`ipc-checklist-6726.md` §16.5;`§12.6` 风暴升级路径在实车日志中出现并恢复
(`lingua_chat.js` btipc05c/05d 注释记有 STORM 罚时现场),**尚缺一轮专门的进图演练复核**。

---

## 13. 实现清单与顺序

### 13.1 文件结构(冻结;仓库桥代码在 `core/`,故设计稿的 `bridge/btipc/` 落为 `core/btipc/`)

```text
F:\BabelTower\
 ├── docs\
 │    └── btipc-v1.md                ← 本规格
 ├── core\
 │    ├── btipc\
 │    │    ├── crc16.js              # CRC-16/CCITT-FALSE(桥端唯一实现源)
 │    │    ├── framer.js             # 文本 ↔ 16B 帧 encode/decode + 位映射 + Assembler
 │    │    ├── window.js             # Map<win,Transfer> 窗口表 + 状态机 + GC
 │    │    └── transport.js          # /btipc/dl 应答 + REQ 行解析校验
 │    └── bridge_server.js           # 只做路由接线(薄)
 ├── mod\panorama\scripts\
 │    └── lingua_chat.js             # BTIPC Client 区块(State.btipc;Panorama 无模块系统,内联 crc16+decode)
 ├── tests\btipc\
 │    ├── crc.test.js                # §12.1 向量
 │    ├── frame.test.js              # §12.2 往返 + §3.3 位序例 + §3.2 BUSY 固定帧
 │    └── simulator.test.js          # §12.3 信道仿真
 └── scripts\
      └── btipc_sim.js               # 仿真器 CLI(§12.3)
```

### 13.2 文件职责

| 文件 | 内容 |
| --- | --- |
| `core/btipc/crc16.js` | `crc16(bytes)`,CCITT-FALSE;游戏侧同算法内联副本(逐字节一致) |
| `core/btipc/framer.js` | `encode(id, utf8) -> frames[16B]` / `decode(frame)` / `assemble()` / `bitsOf(frame)`;BUSY 帧构造 |
| `core/btipc/window.js` | `Map<win, Transfer>`;REQ 覆盖、frameStartRound 锚定、GC(END+45s / TTL 60s) |
| `core/btipc/transport.js` | `serveDL({w,r,p,t}) -> {status, body}`(idx = r - frameStartRound)+ REQ/CAN 行解析(§14 校验) |
| `core/bridge_server.js` | `/btipc/dl` 路由 + console.log tail 的 `BTIPC REQ/CAN` 分发 |
| `mod/panorama/scripts/lingua_chat.js` | BTIPC Client 区块(State.btipc;面板创建/轮询/闭合/CRC/拼装/Promise API);**不触碰**探针代码与业务逻辑 |
| `tests/btipc/*.test.js` | CRC 向量 / framer 往返 / 信道仿真(幂等、重试、GC) |
| `scripts/btipc_sim.js` | 信道仿真器(§12.3),先仿真后实车 |
| 探针命令 `/bt6736` | conformance 驱动(回声/花样帧),复用现有命令分支模式 |

### 13.3 实现顺序(先回声后翻译,不许跳步)

1. `core/btipc/crc16.js` → `tests/btipc/crc.test.js` 绿(0x29B1 向量);
2. `core/btipc/framer.js` → `tests/btipc/frame.test.js` 绿(往返 + 位序例 + BUSY 帧);
3. 桥端 `/btipc/dl` + `window.js` + `transport.js` + REQ tail 校验;
4. Panorama BTIPC client(§7 Promise API);
5. `scripts/btipc_sim.js` + `tests/btipc/simulator.test.js`;
6. 接入 `lingua_chat.js`(`/tr` 链)。

**回声先行**:第 1~5 步全绿 + 实车 `/bt6736` 回声 "Hello BTIPC" ≥20 连发零 fail,才允许接翻译 API。

**隔离铁律**:BTIPC 代码不得调用/修改 exp6727~6734 探针的 State 字段;探针退役时(封版剥离)BTIPC 独立存活。

> **落地状态(2026-10-03)**:13.3 的 1~6 步全部完成,随 `1.0.7` 发布。
> 第 6 步的"接入"随 btipc04(入站 chat)与 btipc05(`op=config` / `op=test`)扩到
> 四类业务,调度入口是 `lingua_chat.js` 的 `dispatchJob`:先试 ① BTIPC,
> 接不了才回落 ② 直连 / ③ 面板导航(当前游戏版本两条都不可用,故 ① 实际不可退)。

---

## 14. Security / Abuse Considerations

> BTIPC 不是安全协议(信道两端 = 游戏 ↔ 本机自己的桥);但桥的 console tail 与 HTTP 入口在本机暴露,必须防注入与串扰。

### 14.1 REQ 行校验(桥端 tail 解析,全部通过才受理)

| 检查 | 规则 | 不过则 |
| --- | --- | --- |
| 行长 | ≤1000 字符(J1 实测上限) | 静默 drop + WARN |
| 行尾锚定 | `[LCT] BTIPC REQ ...` 之后整体匹配到行尾(允许尾随 `\r`) | drop(防拼接注入) |
| w | `/^[0-9a-f]{6}$/` | drop |
| id | `/^[0-9a-f]{4}$/` | drop |
| len | 十进制整数 0..680(REQ_MAX_PAYLOAD,对齐 J1 整行 1000),且 == b64 解码后字节数 | drop |
| crc | 4 位 hex == CRC16(payload)(桥侧重算比对) | drop |
| b64 | 严格 base64(字符集 + 长度 mod 4 + 解码不抛) | drop |

- **静默 drop** = 不回、不建窗、只记一行 WARN(不把错误回显到任何游戏可见通道);
- 同 w 重复 REQ = 幂等覆盖(游戏超时重发是正常路径,不是滥用);
- 载荷上限 680B:整行 ≈78 + b64 908 = 986 ≤ 1000(含引擎前缀与时间戳的最坏口径);且 680B → 68 帧 ≤ seq7 的 128 帧上限(§3.2)。

### 14.2 窗口隔离

```text
所有传输状态 → Map<window_id, Transfer>,读写只经该 Map
```

- 窗口 A 的 req/frames/frameStartRound/tLast 不得被 B 覆盖;同 id 不同 w = 两个独立传输;
- `/btipc/dl?w=...` 只命中自己的窗口;未知 w → 404(不枚举、不提示存在性);
- GC 双条件(§6)保证僵尸窗口必回收;单窗口状态上限 = frames 数 ×16B(680B 载荷 → 68 帧 = 1088B);
- 面板前缀 `BTIPCD*` 与路由 `/btipc/*` 对探针(`BTBIT*/BTD*/BTE*`、`/probe_*`)互不干扰。

---

## 15. 协议评价(v1 冻结时)

| 项目 | 状态 |
| --- | --- |
| 可靠性 | ✅ CRC + 同 round 幂等重试 + 风暴升级;D/E 两轮实测零丢失 |
| 实现复杂度 | 低(无显式 ACK、无自增计数器、两端各一个小状态机) |
| 调试难度 | 低(每帧一行日志、URL 可见、CRC 可离线重算) |
| 吞吐 | 一般(≈123 bit/s 有效载荷;60B 译文 ≈ 3.9s) |
| 扩展性 | 好(B3 VALID 位、窗口表、帧队列均可扩) |
| v1.1 升级空间 | 好(精确闭合/CONT 帧不动参数表与 API) |

核心取舍:把"图片加载事件当二进制信道"的最大风险,从协议层面转化为 **CRC + retry** 问题,而不是追求不可能的无反馈同步。
