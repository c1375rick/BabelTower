# Deadlock 6726 Panorama IPC 检查表 — exp6727~6734C 实测全记录

> 部署:2026-10-01 · mod 最新 `v1.0.7-6726-exp6734C`(装在 addons/**pak15_dir.vpk**,DMM 登记 local-d0264ee4;备份 `pak15_dir.vpk.bak-pre-exp6734C-1001-223452`;上一版备份 `bak-pre-exp6734B-1001-173951`)
> 桥:`core/bridge_server.js` 含 `/probe` 信标、`/probe_img` 状态码差分、游戏 console.log 尾随器
> 检查表原始出处:`新建 文本文档.txt`(A~J 节)

---

## 1. 探针 → 检查项对照(exp6727)

探针在游戏启动 5s 后自动运行一次(每会话),输出走**双路上报**:

| 源 | 路径 | 覆盖 |
| --- | --- | --- |
| ① `$.Msg` → 游戏 `console.log` → 桥尾随 | `logs/bridge.log` 中 `[game]` 行 | B2~B6 + 全部 `exp67xx:` 结果行 |
| ② Image 信标 `SetImage(/probe?d=..)` | `logs/bridge.log` 中 `PROBE` 行 | 出站通道本身 + 结果冗余副本 |

收结果命令:

```bash
grep -E "exp67|3[0-2]-[①②③]|3[0-2]-SUM|PROBE-IMG|\[game\]" F:/BabelTower/logs/bridge.log | tail -100
```

---

## 2. exp6727 状态回填表(基础面)

| # | 项目 | 状态 | 备注 |
| --- | --- | --- | --- |
| A1 | GameInterfaceAPI 存在 | ❌ | `typeof = undefined`,顶层真不存在 |
| A2–A5 | ConsoleCommand / Get·SetSettingString / CommandLine | ❌ | 全局同名均不存在 |
| A6/A7 | 设置值 ⇄ Bridge | ⬜ | 阻塞(A3/A4 死) |
| B1 | ConsoleCommand 执行 | ⬜ | 依赖 A2 |
| B2 | Console → Log | ✅ | `$.Msg` 全部落 console.log |
| B3 | Bridge 监听 Log | ✅ | 1s 轮询尾随,到达延迟 1~9s |
| B4 | 长字符串 100/500/1000 | ✅ | 实测 133/533/1033 字节**精确相等,零截断** |
| B5 | 高频 ×10 | ✅ | 10/10 零丢包 |
| B6 | 特殊字符/换行 | ✅ | 中文/日文/emoji/JSON 完整;换行续行 `(cont)` 捕获 |
| C1–C3 | Clipboard | ❌/⚠️ | 三面扫描 NONE;getOwnPropertyNames 复核也无 clip 命名 |
| D1–D3 | CitadelHTMLPanel 创建+枚举 | ✅ | ~300 项全枚举 |
| D4 | SetURL 产生请求 | ❌ | 见 §4 scheme 判死 |
| D5–D8 | 导航/执行方法 | 💡 | 漏网发现 `RunScriptInPanelContext`(见 6728 域名拦截)/`WriteCompositionLayerPNG` |
| D9/D10 | title/location | ❌ | undefined |
| E1 | 事件注册 | ⚠️ | 自定义名被拒 → 白名单制(6728 探出清单) |
| I0 | 全局面枚举 | ✅⚠️ | for..in 仅可枚举;getOwnPropertyNames 见 §4 |

---

## 3. exp6728~6731 入站攻坚过程结论

| 轮 | 实验 | 结论 |
| --- | --- | --- |
| 6728 | RSI 调用 | API 为真但被域名检查拦:`must be called from a context with a domain that matches this panel`;签名=`takes 1 arguments [script]`;`location/document/window` 全 undefined → JS 侧无法探域,暂死 |
| 6728 | 隐藏全局扫描 | 顶层无 GameInterfaceAPI/GameEvents/CustomNetTables;`$`≡`panorama`(29 函数);新发现 `RegisterEventHandler`/`BImageFileExists`/`DispatchEvent` |
| 6728 | 事件白名单 | **8 个 VALID**:ClientUI_FireOutput, PanelLoaded, HTMLLoadPage, HTMLStartRequest, HTMLFinishRequest, HTMLURLChanged, HTMLTitle, **ImageLoaded**;52 INVALID |
| 6729 | SetURL 变体矩阵 | **scheme 级判死**:仅 about:blank 触发 HTMLLoadPage;file:// 与 http://(含 localhost/127.0.0.1) 在 LoadPage 前被拒回落空页,0 请求到桥 |
| 6729 | Data() | `{}` 空对象,死 |
| 6730 | BImageFileExists | **s2r:// 资源查询 API**(真实 s2r 路径 true,其余全 false),桥不可写该命名空间 → 封案 |
| 6730 | REH arity | **恰好 3 参**;第 2 参 = 面板 id 或面板对象 |
| 6730 | ImageLoaded 差分 v1 | 全 NO——探针缺陷(同面板覆盖 + 1.1s 窗口太短) |
| 6731 | 自建面板能否触发 | **能**(LCTImgProbe/LCTDimProbe 实证);`REH(panelObj)` **OK**;`REH(idStr)` 报错暴露 id 查找仅限 XML 布局上下文(chat.xml) |

---

## 4. exp6732 最终结果 — ⭐ 反向通道闭环

```
四面板各单发一次,永不覆盖;P200/P404 同挂双路回调:

                Bridge HTTP    Unhandled    REH(panel-bound)
LCTP200            200 ✅        FIRED x1       FIRED        ← 同一毫秒双路同时到达
LCTP404            404 ✅          NO            NO
LCTP500            500 ✅          NO            —
LCTPR           连接拒绝           NO            —

32-SUM unhandled = LCTP200:FIRED x1 | LCTP404:NO | LCTP500:NO | LCTPR:NO
32-SUM reh       = REH:200:FIRED | REH:404:NO
```

**判定:Bridge → Panorama 反向通道成立。**

- 信道:`Bridge 控制 HTTP 状态码 → Image 面板 → ImageLoaded → JS 回调` = **状态码位元**(200=1 / 非200=0)
- 双路回调行为完全一致,任选;REH 可按面板绑定 → 多面板天然并行
- 延迟:开机风暴期 SetImage→请求发出 ≈ 5.9s(引擎队列),**响应→事件 = 毫秒级**;对局中延迟待测
- 探针铁律:**同一面板禁止重复 SetImage**(覆盖取消);判定不轮询,handler 自报告

---

## 5. J 记分(终版)

| # | 项 | 状态 | 依据 |
| --- | --- | --- | --- |
| J1 | 出站 | ✅✅ 双通道 | Image 信标(PROBE seq 有序零丢) + console.log tail(1000 字符零截断/10 连发零丢/UTF-8 完整) |
| J2 | 入站 | ✅ **位元级+吞吐已量化** | exp6732 状态码差分 + 双路回调;6734-B 实测 1280 样本零丢: P50=173ms / P99=1365ms, 64 面板常态 ~190 bit/s |
| J3 | 唯一 ID | ✅ | seq 递增完整;请求可带 `n`/`id` 参数 |
| J4 | 异步 | ✅ | 事件驱动,多面板并行,不阻塞 |
| C5 | 发送前回填 | ✅ | exp6734-C:拦截 Enter → 改写 `input.text` → 第2下走原版链路发出,**服务端回显 = 改后文**(23:13:35 `row[chat#36] SENT=MODIFIED`) |

---

## 6. exp6733~6734 收尾三轮

| 轮 | 实验 | 结论 |
| --- | --- | --- |
| 6733 | 302 重定向高带宽入站 | 引擎跟随重定向(桥见 `PROBE-RDATA f=BT_FINAL33`,loaded=2),但**四层回读全空**:字符串 diff / URL 扫描 / GetAttributeString 6 键 / 5 个猜名方法全部读不回最终 URL → **高带宽文本入站关闭** |
| 6734-A | Image 面板 93 函数全量枚举 | hits 仅 6 个且全是写入型(SetImage/SetImageFromPanel/SetImageFromFile/SetCompositionLayerTextureName/FindChildInLayoutFile/FindPanelInThisOrParentLayoutFile),**零 Get* 回读口 → src 回读永久关死**;全量名单在 bridge.log `34-A[...] all fns` 4 片 |
| 6734-B | 64 面板 × 20 轮位元延迟 | 见 §7 实测数据;**入站位元通道吞吐定案** |
| 6734-C | 输入框读写 + 两段 Enter 发送回填 | 见 §8;**TextEntry 读写全成立,改写文本经原版链路发出(SENT=MODIFIED)→ 发送前翻译回填路线成立** |

备查未测(用户要求不扩散):`SetPanelEvent` / `WriteCompositionLayerPNG` / `SetImageFromFile`。

---

## 7. exp6734-B 实测数据(2026-10-01 20:18,对局中 /bt6734b 手动触发)

20 轮 × 64 面板,共 1280 个位元样本;分析脚本 `scripts/exp6734b_analyze.js logs/bridge.log`。

### 7.1 延迟分布(单面板 SetImage → ImageLoaded,dt = nowMs − t0)

| 指标 | 值 |
| --- | --- |
| n | 1280 |
| min | 6 ms |
| P50 | 173 ms |
| P90 | 583 ms |
| P95 | 832 ms |
| P99 | 1365 ms |
| MAX | 1399 ms |
| mean | 255 ms |

- <200ms 占 56.6%,<500ms 占 88.0%,<1000ms 占 95.5%,≥1s 共 57 个(4.5%)
- 轮间隔(SHOT→SHOT):min 1679 / mean 1919 / max 2899 ms

### 7.2 可靠性对账(游戏侧 vs 服务端)

| 项 | 值 |
| --- | --- |
| 游戏侧 LOADED | 1280(20 轮全 64/64,零 TIMEOUT,零 ABORT) |
| 服务端 BIT 落底(round≥1) | 1344 = 1280 + **64 重复** |
| gameOnly(游戏有服务端无) | **0** |
| srvOnly(服务端有游戏无) | **0** |
| 服务端重复 | 64 个,全部是 round=20 在 20:37:18 **整轮重放**(晚 18 分钟,引擎 image 缓存/重取行为,非协议丢失) |

**判定:位元零丢失、零错位;存在迟到整轮重放 → 协议必须按 (id, round) 幂等去重。**

### 7.3 顺序性

- 服务端跨轮逆序:**0**(轮与轮之间严格有序)
- 轮内 idx 逆序:游戏侧上报 24 次 / 服务端 25 次(约 1.9% 面板乱序到达)→ **同轮 64 位不可假定按 idx 序到达,必须按 id 定位位值**

### 7.4 吞吐判定(64 面板够不够?)

- **够**。单轮 64 位全到齐的完成时间 = 该轮 max:典型 330 ms(P50 of round-max),最差 1399 ms(R19);20 轮轮 max 中位 ≈ 331 ms
- 等效吞吐:64 bit / ~0.33 s ≈ **190 bit/s(常态)**,按最差轮 ≈ 46 bit/s;轮间隔 1.5 s 调度下余量 >4×
- 64 面板一轮即一个 64-bit 字(8 字节),对控制字/短 ID/序号绰绰有余;文本类载荷走 J1 出站(console.log tail,1000 字符零截断)不对称互补
- 长尾告警:R19 整轮 p50=1337 ms(疑似帧尖峰,同期 frame time 245~256 ms clamped)→ 协议超时窗口按 ≥3 s 设计

---

## 8. exp6734-C 输入框控制实测(2026-10-01 22:57 部署 / 23:13 实测,/bt6734c 手动触发)

目的:验证「发送前翻译」的回填路线 —— 拦截 Enter → 改写 TextEntry.text → 让原版发送链路发出改后文。

### 8.1 C-1 树扫描 / C-2 面板枚举(只读)

- C-1:递归扫 4001 个面板,910 个带 text;`ChatInput found=yes`(id 直达)
- C-2:`Object.getOwnPropertyNames(ChatInput)` 分 5 片输出,新发现方法面:
  `SetMaxChars / GetMaxCharCount / GetCursorOffset / SetCursorOffset / ClearSelection / SelectAll / RaiseChangeEvents / SetPanelEvent / RunScriptInPanelContext / WriteCompositionLayerPNG|JPEG` + `Data / SetCompositionLayerTextureName`(写入型)

### 8.2 C-3 只读 / C-4 写+读回(22:57 与 23:13 两轮均绿)

| 项 | 结果 |
| --- | --- |
| C-3 只读 | `text="/bt6734c" matchCmd=true` ✅ |
| C-4 写+读回 | 22:57 `LCTW658489` / 23:13 `LCTW611522`,`write=true match=true` ✅ |

**判定:TextEntry.text 读写闭环成立**(6726 上发送前翻译的回填前提)。

### 8.3 C-5 两段 Enter 发送判定(23:13:33~23:13:38)

流程:布防 → 用户输入 `1` 按 Enter(第1下,拦截改写不发送)→ 输入框变为 `LCTC613953M 1` → 再按 Enter(第2下,走原版发送)→ 观测 chat/lobby/hud 三容器增量行。

| 时刻 | 日志 | 判读 |
| --- | --- | --- |
| 23:13:33 | `C3 userText="1"` / `C4 rewrite=true readback="LCTC613953M 1" match=true` | 第1下拦截+改写生效,未发送 |
| 23:13:35 | `C5 submit#2 raw="LCTC613953M 1" isRewritten=true` → `stock submit dispatched` | 第2下经原版链路发出 |
| 23:13:35 | `row[chat#36] SENT=MODIFIED text="[队伍] … LCTC613953M 1"` | **服务端回显 = 改后文** |
| 23:13:38 | `row[chat#37] SENT=ORIGINAL text="1"` | 用户实验后手动补发的第 3 条(已确认),非引擎泄漏 |
| 23:13:38 | `C5-RESULT BOTH` → 人工判读 | 实际 = **SENT=MODIFIED 成立** |

**判定:引擎发送时读取的就是改写后的 `input.text` → 「拦截→回填→原版链路发送」路线成立。**

- 附带证据:23:13:36 `diag-nav … op=translate&text=LCTC6…` 是**入站翻译拾取了这条新 marker 消息**(核心功能自触发),不是第三次发送;其后 `bridge nav failed` 为面板通道既有抖动,与本实验无关
- 排除法:钩子第2下只派发一次(仅一条 `submit#2` 日志);`st.orig` 从不被代码发送;`clearInput` 正常 → 多余行只能来自用户手动第 3 下(已确认)
- 实现要点:hook 必须在 `if (!trimmed)` **之前**调用且出错必放行;布防期 outgoing 翻译分支跳过(`&& !State.c5`)防干扰;第1下 `return true` 吞掉、第2下 `triggerStockSubmit + clearInput`

### 8.4 C 节对协议的意义

发送前翻译的出站链补齐最后一环:J1 文本出站(console.log tail)+ **回填发送(TextEntry 改写)** —— 用户消息可先经桥翻译再由原版链路发出,无需任何已判死的回读口。

---

## 9. 下一步:IPC 协议设计要点

> 2026-10-01 更新:协议冻结前先插 **exp6734-D 下行吞吐基准**(`docs/ipc-downlink-benchmark-6734D.md`)——
> MAX_SAFE_PAYLOAD / SAFE_WINDOW / FRAME_TIMEOUT 三参数全部由实测表定;本节 6734-B 的 64 面板数据成为 D3 对照组。

位元通道已定案(200=1/非200=0,64 面板并行,~190 bit/s 常态);协议必须的四件事由实测直接推出:

1. **幂等去重**:按 (id, round) 去重(7.2 实测到 18 分钟后整轮重放)
2. **按 id 定位**:同轮 64 位到达序不可靠(7.3,~1.9% 逆序),位值只由面板 id 决定
3. **超时 ≥3 s**:最差轮 1399 ms + 帧尖峰余量(7.4)
4. **request_id 编码**:一轮 = 64 bit = 8 字节,可整轮承载 seq/ack/opcode,乱序由 ID 自纠正

出站文本通道:console.log tail(B 通道)已验证承载聊天文本。双向成型:**J1 文本出站 + J2 位元入站**,不对称但各自带宽充足。

已判死勿再试:`AsyncWebRequest` / `SetURL`(任何 URL) / `title` / 布局尺寸 / `GameInterfaceAPI` / `RSI`(无域钥匙) / `Data()` / `Clipboard` / `BImageFileExists`(非文件 oracle) / **302→src 回读(6733)** / **Image Get*(6734-A)**。

---

## 10. 回滚

```bash
# mod: 每轮安装前都有备份
ls addons/pak15_dir.vpk.bak-pre-exp673*   # 选对应轮次恢复到 addons/pak15_dir.vpk

# 桥: git checkout core/bridge_server.js core/config.js config/config.example.json 后重启
```

---

## 11. BTIPC v1 btipc01 部署(2026-10-02 08:43)

- **规格**:`docs/btipc-v1.md` 十点终审已并入并冻结;实现顺序①~⑤完成,⑥(翻译链)按铁律等回声实车通过后再接;
- **桥**:`core/btipc/{crc16,framer,window,transport}.js` + `/btipc/dl` 路由 + REQ tail 校验(§14);当前回声模式;桥已重启(health 200,tail 正常);
- **游戏**:`lingua_chat.js` VERSION=`1.0.7-6726-btipc01`(BTIPC Client + `/bt6736` 回声命令;探针代码未动);
- **测试**:`tests/btipc/{crc,frame,simulator}.test.js` = 12 + 80 + 12 全绿(含游戏侧内联副本对账 —— 抓过代理对漏 +0x10000 的 emoji bug);全量 51/53(2 红为 quickchat 既有:handshake 指纹漂移 + match 遗留,与 BTIPC 无关);
- **仿真**(§12.3):100 传输 × 5% 轮级丢包 → 零错字 / 重试率 3.09% / 107.5 bit/s,三门槛全过;风暴强制演练 10/10 DONE;BUSY 前 6 轮 20/20 DONE;
- **安装**(槽位铁律全流程):pak15_dir.vpk = 391328B(lingua_chat.vjs_c 297.42kb,与 dist 字节一致);备份 `pak15_dir.vpk.bak-pre-btipc01-1002-084351`;
- **回滚**:`cp addons/pak15_dir.vpk.bak-pre-btipc01-1002-084351 addons/pak15_dir.vpk` + 桥回退重启;
- **待实车**:进游戏聊天 `/bt6736 20` → `logs/bridge.log` 应见 1× `BTIPC REQ w=..` + 20× `btipc6736: RUN n/n ECHO_OK`、零 FAIL/零 MISMATCH、逐帧 `BTIPC: r=.. seq=.. OK|END`。

---

## 12. btipc02 — crc_dead 根因修复(2026-10-02 09:49)

**实车结果**(btipc01,三轮各 20 连发):`ok=16 fail=4` / `ok=16 fail=4` / 第3轮 6/20 挂,全部 `FAIL kind=crc_dead msg=CRC fail 9x > 8`,单轮耗时 ~25s。失败后立即恢复(下一 `REQ` 是新窗口)。

### 根因 A(桥端,已修,已生效)

`core/btipc/window.js` `END_GC_MS = 10000` **小于客户端最长重试跨度**:

```
客户端最坏 = T_HARD 12s + 9×(STORM 2.5s + 1s 冷却) ≈ 40s
桥端却在 END 帧首次被服务后 10s 就删窗
```

日志抓到现场:

```
08:53:39[info] BTIPC GC removed=1 remain=1   ← 窗口被删
08:53:39 BTIPC: r=2 frameFails=8
08:53:41 BTIPC: r=2 frameFails=9 → crc_dead
```

删窗后 128 面板全 404 → 全零位 → CRC 必败 → 走满 9 次死线。**这也解释了单轮 ~25s 的耗时**。改 `END_GC_MS = 45000`。

> 附带纠正:先前推测的“新 REQ 未清零 / 状态机泄漏”**不成立** —— `st` 每次 `request()` 全新构造,四个计数器初始化为 0,CRC ok 时归零。日志里 `r=1 OK` 后 `r=2 frameFails=1` 是**新的一次窗口传输**,不是泄漏。

### 根因 B(客户端,已修,已打包)

`mod/panorama/scripts/lingua_chat.js` `tTag` 原为 `&t=win-idHex`,**同 r 重投的 128 个 URL 逐字节相同**,违反 §4「URL 对 (w,r,p) 唯一」。撞同一 URL 时 Panorama 可能不再触发 `ImageLoaded` → `st.fire` 永远为空 → 重试复现同一次失败(对应日志里 `frameFails` 1→9 始终 `seq=-1`)。改为 `&t=win-idHex-roundNo`。

### 测试

新增 `tests/btipc/window_gc.test.js`(4/4),把「`END_GC_MS` > 客户端最坏重试跨度」钉成不变量;该测试在旧值 10s 下会失败,确认能抓回归。全量 **55/57**(51 + 4 新增),2 红仍为 quickchat 既有。

### 安装(槽位铁律全流程)

- 覆盖前确认 pak15 含 lingua 4 文件(裸 `pak15_dir.vpk`,非 DMM 编号文件)✓
- 备份 `pak15_dir.vpk.bak-pre-btipc02-20261002-094930` ✓
- 覆盖后 `lingua_chat.vjs_c` 297.42 → **297.64 kb**,391328 → 391551 B,与 `dist/pak01_dir.vpk` `cmp` IDENTICAL ✓
- 桥已重启(health 200)✓

### 回滚

```bash
cp addons/pak15_dir.vpk.bak-pre-btipc02-20261002-094930 addons/pak15_dir.vpk
# 桥:git checkout core/btipc/window.js mod/panorama/scripts/lingua_chat.js && powershell -ExecutionPolicy Bypass -File scripts/restart_bridge.ps1
```

### 实车验收(2026-10-02 09:55)—— ✅ 通过

```
btipc6736: ALL DONE n=20 ok=20 fail=0
```

20/20 `ECHO_OK`,`got="Hello BTIPC"` 逐字节一致,**零 `crc_dead`**。

**决定性证据 = RUN 8**(`w=51ac12`):同一 `r=1` 连败 7 轮(`frameFails=1..7`)→ `STORM enter consec=7` → **`STORM exit`** → `r=1 seq=0 OK` / `r=2 END` → `DONE total=22405ms` → `ECHO_OK`。

- 旧版此窗口在 10s 被 GC 删掉 → 必然 `crc_dead`;新版撑过 22.4s 正常收口 → **根因 A 修复确认**;
- `STORM exit` 是修复后才可能出现的日志(旧路径永远走不到 CRC ok)。

**根因 B 的正确归因**(先前“面板复用致迟到 ImageLoaded 串轮”的假说**未被证实**,已作废):真实原因是进图加载期(`hero_reveal` 资源加载 + `OnPostPredictionError` 刷屏,同期日志可见)HTTP 队列积压。`t` 加 `roundNo` 使每轮取到全新 URL、不撞引擎缓存,风暴宽收口才能攒够干净的 128 位。回声正确性无缺陷,风暴期只变慢不变错。

**残留(非阻塞)**:风暴期单轮 dt 可达 22s(RUN 8),对 `REQ_TIMEOUT=30s` 余量偏薄。属可靠性余量而非正确性问题;建议在接翻译链(步骤⑥)前按本轮实车 dt 分布重新标定 `T_CLOSE_MS` / 风暴参数。

---

## 13. 步骤⑥ 翻译链接入(2026-10-02)

按“**A:零协议改动**”方案实施。两条传输路径完全分离,共用同一套帧/窗口/重试核心。

### 桥端

- `core/btipc/transport.js`:新增 **`TRQ`** 命令(与 `REQ` **等长**,均为 3 字符命令词 → **不额外占用 §9 J1 的 1000 字节行预算**),解析结果带 `translate:true`;`REQ` 仍为 `translate:false`。TRQ 沿用 REQ 全部 §14.1 校验(CRC/windowId/base64/行长)。
- `core/bridge_server.js`:`REQ` 保持同步 `setFrames`(回声 conformance 不碰翻译 API);**`TRQ` → `acceptReq(frames=null)` → 客户端立即得 BUSY → 异步 `runTranslate` → `setFrames`**。翻译耗时(100ms~8s/超时)完全落在窗口等待期,**不污染传输状态机**。缓存/自适应学习与 `/api/v1/translate` 同语义;窗口已被 GC/CAN 时 `setFrames` 返回 false → 丢弃。
- **翻译失败信号**:编成**空 END 帧(len=0)**,协议层零新位段。

### 客户端

- `lingua_chat.js`:`request({..., translate:true})` → 发 `TRQ`。
- **BUSY 改为同 r 重 poll**(去掉原 `st.r += 1`):BUSY = “本 window DATA 未就绪”,不是新 frame;此时桥端尚未 `setFrames` 故不锚定 `frameStartRound`,待首个 DATA poll 才锚定。
- **翻译失败 ≠ 成功**:`st.translate && got === ""` → `reject({kind:"translate_error"})`。回声模式**不做**此判定(空串是合法回声)→ echo/translate 语义隔离。
- 新增 `/bt6737 [text]` 翻译 smoke;`/bt6736` 回声 conformance 保留(回归测试路径不经翻译 API)。

### 验收

- 离线 `tests/btipc/translate.test.js` **10/10**:TRQ 解析、TRQ/REQ 行长逐字节相等、最坏行 ≤1000、§14.1 校验继承、BUSY 不锚定 round、`setFrames` 后首 poll 锚定、空 END 帧语义、**⑥ 未新增任何位段**(BUSY/DATA 帧布局字节级不变)、超 seq7 上限抛错;
- 全量 **65/67**(55 + 10 新增),2 红仍为既有 quickchat;
- 桥级 E2E(`scripts/btipc_trq_e2e.js`):真实 tail 写 TRQ → 真 HTTP 轮询 → `TRQ → "你好"` 两轮均 ok(677ms / 1231ms)。

**已知未覆盖**(需实车):E2E 脚本首轮即发,翻译已完成故 `busy=0`,**未观测到 BUSY 等待路径**;长文本/多帧译文与 30s 死线关系也未测。

### 待实车验收(✅ 已于 2026-10-02 13:10~13:12 完成,结果见下)

1. `/bt6736 20` —— 回声回归仍应 `ok=20 fail=0`(确认⑥ 未伤已验收的传输核心);
2. `/bt6737 hello` —— 应见 `BTIPC TRQ` → 若干 `BUSY` → `DONE` → `btipc6737: OK`,拿到中文译文;
3. 拿真实聊天译文长度分布,再决定是否需要 response 长度限制 / `REQ_TIMEOUT` 自适应。

### 实车验收结果(2026-10-02 13:10~13:12,VPK `pak15_dir.vpk` SHA256=09ED22A2,桥 1.0.6 + provider=bing)

**① 回声回归 `/bt6736 20`**:`ALL DONE n=20 ok=19 fail=1` —— ✅ 通过(通过口径见下)。

- 19× `ECHO_OK`,dt 2407~3118ms,回声内容全对;
- 1× FAIL = RUN 14 `kind=crc_dead msg=CRC fail 9x>8 dt=25470`,发生在 13:06:08~13:06:32 进图加载风暴期(`hero_reveal.vnmclip` 密集加载,`STORM enter consec=2 tClose=2500` 已触发但风暴超出 `STORM_ROUNDS=4` 预算);
- **判为非⑥回归**的三条依据:(a) 同模式 fail 在⑥打包前的 08:52 轮即存在(该轮 `ok=16 fail=4`,失败全是 `crc_dead dt≈25.3s`);(b) 风暴期外对照轮 09:55 `ok=20 fail=0`;(c) ⑥改动只在 TRQ 路径,回声走 `REQ` 同步 `setFrames`,与客户端 STORM/重试状态机无交集。

**② 翻译 smoke `/bt6737`**:6 次全部 `OK`,全链路零失败 —— ✅ 通过。

```
[game] BTIPC TRQ w=.. text="hello"
[info] BTIPC TRQ .. (BUSY until translated)     ← BUSY 路径首次实车观测(E2E 未覆盖项,已补上)
[info] BTIPC TRQ .. ok dt=51ms out=2B frames=1
[game] BTIPC: r=1 seq=0 len=6 END
[game] DONE .. frames=1 bytes=6 total=1809ms
[game] btipc6737: OK win=.. dt=1809ms got="你好"
```

- BUSY 轮消耗的 r 未污染帧序(`w` 样本:r=1 BUSY ×1 → r=1 seq=0 END),实车验证了 `translate.test.js`「BUSY 期间消耗的 r 不影响帧序」;
- 空译文/解码正确:`bytes` 与译文 UTF-8 长度逐条吻合。

**③ 译文长度 → 耗时分布**(5 样本,`frames` 全部满足规格 §B 的 `frames = ceil(bytes/10)`):

| 输入(REQ len) | 译文 bytes | frames | total | 各帧 dt | RETRY/CRC |
|---|---|---|---|---|---|
| `w`(1) | 1 | 1 | 2964ms(含 BUSY 1 轮 + 翻译 576ms) | 624 | 0 |
| `hello`(5) | 6 | 1 | 1806ms | 609 | 0 |
| spirit urn 长句(56) | 45 | **5** | 4739ms | 608~979 | 0 |
| yellow lane 长句(72) | 63 | **7** | 5749ms | 616~725 | 0 |
| rotate left 长句(72) | 52 | **6** | 5635ms | 613~1056 | 0 |

- **多帧路径实车通过**:5 帧/6 帧/7 帧三档,`seq=0..N` 递增、末帧 `END` 正确、零 RETRY / 零 CRC / 零 STORM;
- **耗时模型**(5 样本拟合,残差 <5%):`total ≈ 1200ms 固定开销 + 650~680ms × frames`;桥侧翻译本身 51~576ms(缓存 2ms),**瓶颈是 650ms/帧的轮询**,不是翻译 API;
- **30s 死线余量**:`REQ_TIMEOUT=30000` 对应 ≈44 帧 ≈ 440 字节(≈147 汉字)的译文上限;实测最长 7 帧 / 63 字节 / 5.7s,余量充足。

**结论**:`REQ_TIMEOUT=30s` 维持不变,**暂不加 response 长度限制**。触发条件与兜底路径已存在(超 44 帧/440B 才会逼近死线,桥侧超时由 §13 既有 `kind:'timeout'` 降级路径接住),留待真实游戏聊天出现超长译文再按数据复议;帧长 10B 是协议 §B 冻结位段,改它 = 改协议,不为假想需求动冻结面。

**观察项(非阻塞)**:两条长输入均被截在恰好 **72 字符**(`walker b` / `going t` 处断),截断发生在 `/bt6737` 处理器上游(客户端 handler 只有 `text.slice(0,60)` 用于打日志,mod 内无 72 上限)→ 疑为游戏聊天输入框自身的 TextEntry 上限,待单独确认;若确认,则线上真实输入 ≤72 字符,译文帧数天然 ≤ ~10 帧,死线更宽松。

## 14. 步骤⑥-整合:出站翻译接 BTIPC(2026-10-02)

按规格 §13.3 第 6 步「接入 `lingua_chat.js`(/tr 链)」,把**发送前翻译(outgoing)**接上 BTIPC。客户端 `VERSION=1.0.7-6726-btipc03`。

**范围**:仅出站;入站聊天翻译(kind `chat`)与 config/log/health 桥任务**继续走旧通道**(直连/HTML 面板)——入站对时延更敏感(实车 BTIPC ≈1.2s 首拍 + 650ms/帧),且旧通道入站在线上可用;迁移入站 = `dispatchJob` 里一行扩展,留待有数据再做。

### 信封契约(上层约定;行/帧/窗口协议零改动)

- TRQ payload 首行 `t=<target>[;tm=<ms>]` + `\n` + 原文;target 字符集 `[A-Za-z0-9-]`、1..16 位;
- **target 必须随请求走**:桥 config `defaults.targetLanguage` 是入站目标(zh-Hans),出站 `outgoingTarget` 默认 en,不带就会译反方向;
- `tm = OUTGOING_TIMEOUT_MS - 4000 = 16000`:桥端 provider 死线小于游戏侧 20s 死线,桥先给结论(成功帧或空 END 帧),客户端才收得到;
- **无信封(裸文本)→ 桥回退 config 默认**:`/bt6737` 冒烟、E2E 老用例逐字节兼容;
- 解析器:`core/btipc/transport.js` `parseTrqEnvelope`(桥端唯一实现源);游戏侧**只拼接不解析**(纯字符串,零反斜杠正则,规避 resourcecompiler 转义 bug);不安全目标语言(自定义语言含空格/Unicode)→ 游戏侧直接回落旧通道,不让桥猜方向。

### 改动清单

| 文件 | 改动 |
|---|---|
| `core/btipc/transport.js` | `parseTrqEnvelope` + 导出(§14.1 校验路径不变,信封对传输层是不透明字节) |
| `core/bridge_server.js` | `onBtipcTranslateReq` 吃信封 → `runTranslate({text, targetLanguage, timeoutMs})`;**缓存/词典键 `tl` 改用生效 target**(原先写死 `cfg.defaults.targetLanguage`,与 `/api/v1/translate` 缓存键不一致会撞错方向) |
| `lingua_chat.js` | ① 新增 `outgoingViaBtipc(job)`;② `dispatchJob` 排队 15s 时限上移到通道选择前(结论不变)+ 出站先试 BTIPC;③ `translateOutgoing` 出口门:BTIPC 可用时不因面板/直连双死而拦;④ VERSION bump |
| `scripts/btipc_trq_e2e.js` | 加 `env-en`(`t=en\n你好` → 应出英文)与 `env-zh`(`t=zh-Hans\nthank you…` → 应出中文)定向用例 |
| `tests/btipc/translate.test.js` | 信封 6 例(拆解 / 裸文本兼容 / 字符集收紧 / 空原文 / 行级往返过 §14.1 / J1 预算)→ **16/16** |

### 失败语义(`outgoingViaBtipc` 结算矩阵,对齐旧通道 + spec §8)

| 情形 | 行为 |
|---|---|
| busy(探针在途)/ too_long(>680B)/ 目标语言不安全 | 返 false → **回落旧通道**(直连/HTML 面板),行为与整合前一致 |
| 成功(译文帧) | `handleBridgePayload({ok:true, translation})` → 占位还原 → 发送 |
| `translate_error`(桥收到请求但翻译失败,空 END 帧) | 走既有响应型失败语义:**attempts 重试 ≤1 次**,再败按原文 |
| `timeout / crc_dead / bridge_down`(传输型失败) | spec §8:**按原文发送** + `outgoing btipc: FAIL kind=…` 日志,不重试(旧通道同样不可达时重试只会白等 20s) |
| 队列死线 | BTIPC 内部 20s 死线 + **22s deadman** 兜底强制结算(迟到回调由 `settled/_timedOut` 拦截),单槽队列永不卡死 |
| 排队 >15s | 上移到 `dispatchJob` 顶部的既有检查,发原文(先于 BTIPC,避免已等 15s 再起 20s 传输) |

### 决策记录:too_long 回落旧通道(对 spec §8 的有据偏离)

§8 原文「>680B → 按原文发送」写定于旧通道不可用时期;现旧通道可用,**回落能译则译,严格优于发原文**,且 J1 行预算不受影响(信封按字节计入 680B 上限,超限即回落,行长最坏不变)。若 72 字符 TextEntry 上限坐实(§13 观察项),680B 不可达,此分支纯防御。

### 时序预算

出站典型 = 1.2s 首拍 + 翻译 0.1~6s(BUSY 轮 ~1.1s/轮)+ 650ms/帧 → 60B 译文约 5~8s,20s 死线内;provider 16s 死线 + 空 END 帧回传 ≤1.5s < 20s 客户端死线。

### 测试

- `tests/btipc/` **23/0**(translate 10→16);全量仅剩 quickchat_match 16 红(既有,待实车样本),其余全绿;`client_copy_sync` 29/0(改动全在 @sync 块外)。

### 部署

- VPK 槽位铁律:备份 `pak15_dir.vpk.bak-pre-btipc03-…` 后安装;
- 桥重启加载新 `bridge_server/transport`;语料指纹 bd57c0e6 三方对账应保持 ALL MATCH。

### 待实车验收(设置里发送前翻译 outgoing ≠ off)

1. 发一条中文 → `logs/bridge.log` 应见链:`[LCT] BTIPC TRQ … b64=…`(游戏)→ `BTIPC TRQ w=… target=en text=… (BUSY until translated)`(桥)→ 若干 `BTIPC: r=… seq=… OK|END` → `outgoing btipc: ok win=… dt=…ms`,状态条「已发送译文: …」;
2. 切换出站目标语言(如自定义)→ 桥日志 `target=` 跟随;
3. 回归:`/bt6737 hello`(裸文本兼容)、`/bt6736 20`(回声不受影响);
4. 桥停机发消息 → `outgoing btipc: FAIL kind=timeout … -> send original` + 「翻译不可用,已按原文发送」,≤22s 必有结论。

**回滚**:客户端回装上一份 VPK 备份;桥 `git checkout core/bridge_server.js core/btipc/transport.js && powershell -ExecutionPolicy Bypass -File scripts/restart_bridge.ps1`。

## 15. btipc05b 首验失败 → 05c/05d 修复 + 实车复验(2026-10-03)

### 15.1 首验现场(05b,09:19 起)

| 指标 | 值 |
|---|---|
| `dispatch THREW` | **23** |
| `busy, requeue` | **666**(单秒 74 行洪水) |
| `RETRY crc` / `STORM enter` / `REQ_TIMEOUT` / `bridge offline` | 28 / 9 / 7 / 2 |
| `op=config` 成功 | **0** |

### 15.2 根因链(两处真回归,均由编辑引入)

**① 主根因:误删 `} else {`。** `op` 分发里 `if (job.op === "test")` 的 `else` 被删,`op=config` 整块落进 `if(test)` 内:
- `payload` 停在 `undefined` → `btipcUtf8Bytes(undefined).length` 抛出 → `dispatch THREW ×23/25`;
- `op=test` 载荷随后被 config 赋值覆盖成 `op=config + {}` → 测试按钮发错载荷。

**② 放大器:`pumpQueue` while 原地自旋。** busy 分支把 job `unshift` 回队首,while 立刻又 `shift` 出来 → 原地自旋,0.5s 延迟泵失效,`busyWaits=74` 在 <1ms 内打满 → console.log 洪水 → 桥 tail 迟 7~24s → 回声 8s 死线内收不到 → CRC 风暴 / `REQ_TIMEOUT` / `bridge offline`(同指标 btipc05 上局 = 0)。

**铁律:先修真回归 → 再校正测试数据 → 最后重跑,禁止直接把红改绿。**

### 15.3 修复

| 版本 | 改动 |
|---|---|
| 05c | ① 恢复 `} else {`;② busy 分支置 `job._btipcDeferred = true`,`pumpQueue` 见标记即 `break`(重排 0.5s 延迟泵);③ 重投日志改首行 + 每 10 次 |
| 05d | 读死线 35s→**50s**、op 忙等窗 37s→**52s** —— 实车成功读 `dt=43664ms`,另一次正卡在 `35025ms` 只到 `seq=22/38`,35s 余量仅 4.8s |

### 15.4 A/B 实证

| 构建 | `dispatch THREW` | `op=config` TRQ |
|---|---|---|
| 05b 跑仿真器 | 25 | 0 |
| 05c | **0** | **20** |

`tests/lc_btipc_guard.test.js`(11 项)对坏版 **4 FAIL / exit 1**,对修后 **11 PASS / exit 0**。

### 15.5 实车复验(2026-10-03 11:13 起,VPK SHA256=AE9C44B9…)

```
loaded v1.0.7-6726-btipc05d; watching ChatMessages
config btipc: ok win=c1c0da dt=43664ms ok=true
boot: config synced from bridge (outgoing=bilingual, translateOwn=true)
bridge online
BTIPC: DONE win=… frames=1 bytes=6 total≈1820ms   (每 15s 一次)
```

| 指标 | 05b | 05d |
|---|---|---|
| `dispatch THREW` | 23 | **0** |
| `busy, requeue` | 666 | **0** |
| `BTIPC: DONE` | 0 | **27**(1 配置读 + 26 回声) |
| `config btipc: ok` | 0 | **1**(`dt=43664ms`) |
| 配置同步 | 失败 | **`boot: config synced`** |
| 桥状态 | offline | **`bridge online`** |

桥侧 E2E:op **5/5**(cfg-read `dt=23588` ≤35000 / cfg-write `dt=1862` ≤8000 / readback / test / health)、translate **4/4**(`hello→你好` / 缓存 / `t=en` 反向 / `t=zh-Hans`+BUSY)。

### 15.6 证据边界与待办

- 仿真器已打通 BTIPC 下行(`Msg` 落盘带引擎前缀 / `ImageLoaded` 捕获 / `MockPanel.SetImage` + `get id()`),38 帧配置读端到端 `END seq=37`;余下 27 FAIL 属 harness 10s 断言 vs 24s 开机读占单槽,不在官方测试清单。
- **已知未定根因:启动首读的定时器偶发偏早**(05c 报 35000ms 却 10915ms 触发;05d 报 50000ms 却 24595ms)。仅发生在进程内第一次读,`syncBridgeConfig` 每 2s 重试自愈,后续请求死线均准确。
- 16 红 fixture 待用户同局采样:技能冷却 → `XX正在冷却`、技能就绪 → `XX好了!`、Enemy Missing → `不见了`、Spotted → `被发现了`、轮盘 `我可以治疗你` + 未翻译整句长句原文(记时间点)。
- ~~`bridge nav failed: panel dead (no lct-alive within 1.5s)` 每 15s 一条,是 `op=log` 聊天日志上传走 nav 通道打不通(6726 后 `SetURL` 导航全灭)。与翻译链路无关(BTIPC 走面板字节通道),归 **btipc07 清死链**时一并处理。~~ **已处理(2026-10-03)**:面板通道判死冷却 —— 连续 3 次 `src=""` 判死 → 10 分钟内 `dispatchViaPanel` 快速失败(不导航、不打日志),到点自动复探、导航成功即解除;细节日志全程只打一条,进冷却只打一条摘要;离线复探直连通道也限流 10 分钟一次。护栏 `tests/lc_panel_nav_guard.test.js`(23 断言)。**接口本身迁 BTIPC 仍是 btipc07**(health/quickchat/gamenames)。

## 16. HUD 气泡不挂译文:`quick` 判定过宽 → btipc05e 修复 + 实车确认(2026-10-03)

### 16.1 症状

用户 11:31 回归实测中发现唯一真回归:**左下聊天行译文正常,顶栏 HUD 气泡行永远只有原文**。当日全量日志 `translated [hud] = 0`(仅有的 3 条 `translated` 全是聊天频道)。

### 16.2 排查(逐条证伪,未跳步)

| 嫌疑 | 结论 | 证据 |
|---|---|---|
| 配置问题 | ❌ 排除 | 用户仅改过 `targetLanguage` zh-Hans↔zh-Hant;`enabled/displayMode/translateOwn/force` 全正常 |
| 05d 回归 | ❌ 排除 | 05d 改动只在 op 分发/死线,不碰渲染路径 |
| 翻译管线故障 | ❌ 排除 | `!lcttest ok` 全链路走通:`TRQ b64=b2s=` → `translated [hud] <unknown>: 好` → 行被游戏回收后 `recreated translation overlay` 兜底成功 |
| 模板匹配器误吞 | ❌ 排除 | 离线跑 `core/quickchat_match.js`(735 模板/1814 名表):`hello`/`hi`/`ok`/`gg`/`FOR THE KING RAAAAH` 全部 `TRANS`,轮盘文本全部 `SKIP` |
| `!lcttest hello` 无 TRQ | ❌ 非故障 | L3410 **缓存命中**(11:35:58 自己发过 `hello`),静默注入属设计行为 |
| 健康回声污染 `State.cache` | ❌ 排除 | 回声正文是 `text:"health"`(`b64=aGVhbHRo`,6 字节),不是 `hello` —— 早前误读 base64 |

**排除到只剩一条**:`diag: quick row hud=1 text=hi|gg|防守分路|FOR THE KING RAAAAH` 每条 HUD 行都伴随出现,之后无下文。

### 16.3 根因

`shouldSkip` L1572 `if (record.quick) return true;` 无条件跳过,而 HUD 顶栏行的 `quick` 三标记(L1261-1262)用 `FindChildTraverse` **递归整棵子树**:

- 聊天/大厅行的 `PingLabel` 是专用标记,可信;
- **HUD 顶栏行是统一模板**,`PingStyleIcon`/`SubjectIcon`/`CooldownTimer`/`ResponseHeroes` 是**常驻槽位**(10-02 `exp6738` dump 实锤)—— 打字消息同样命中 `PingStyleIcon`;
- `PingStyleIcon` 是 `e1bf714`(btipc03-05 按 10-02 dump 补)加入的,当时 dump 里 27 条 `ROW hud` **全是轮盘文本,无一条打字消息**,取证有盲区。

**放大效应**:不止 L3408 直接 `return`,L3378/L3389 的**缓存恢复也被 `!skipTranslation` 拦住** → 即使缓存里已有 `hi→嗨`,HUD 行也注入不进去。即"HUD 气泡 100% 拿不到译文"。

### 16.4 修复(`83696eb`,VERSION → `1.0.7-6726-btipc05e`)

HUD 行的 DOM 标记须由**文本侧再确认**才跳过:

```js
if (record.quick) {
  const textLocalized = isQuickChatTemplate(text) || (!State.cfg.force && isTargetLanguageText(text));
  if (!record.hud || textLocalized) return true;
  // HUD 行 + 标记存疑(既非已知轮盘语料、也不是目标语言)→ 落到下面的正常判定
}
```

- 聊天/大厅行(`!record.hud`)→ **行为一字不变**,16/26 红 fixture 基线原样不动;
- HUD 行 + 轮盘语料命中 → 仍跳过(`isQuickChatTemplate`);
- HUD 行 + 中文非语料 → 仍跳过(`isTargetLanguageText`,`去商店` 这类 16/17 语料缺口由它兜住);
- HUD 行 + 打字英文 → **放行翻译**(核心修复)。

代价(已论证可接受):语料外 + 语言 ≠ 目标的窄边缘面,如 `target=en` 下的非语料中文会放行翻译 —— 而这本就是用户目标语言的正确行为。

### 16.5 验证

**离线**:新增 `tests/lc_hud_quick_guard.test.js` **20/0**(从客户端源码提取 `shouldSkip`/`isTargetLanguageText` 到沙箱,接真实匹配器逐条锁死);`lc_btipc_guard` 11/0、`client_copy_sync` 29/0、`quickchat_match` **51/16(基线原样)**、`quickchat_handshake` 23/0、`loc_parser` 13/0、`umm_integration` 52/0、btipc 组 crc12/frame80/simulator12/window_gc 全绿。

**装车取证**:备份 `pak15_dir.vpk.bak-pre-hudquick-20261003-124220`(423995B)→ 槽位 SHA256 `9E09400E…0FBE2` == dist 源;包内 `btipc05e` / `textLocalized`×2 / `50000` / `_btipcDeferred`×5 全 FOUND。备份链三级可回滚:hudquick ← btipc05d ← btipc05c。

**实车(14:03 重启)**:

- `loaded v1.0.7-6726-btipc05e` ✓(**实车所见即此串**;14:49 为对齐发布而打的 `1.0.6-6726-btipc05e` 包只进了 GitHub/GameBanana,未装车 —— 见 §16.7 版本号口径)
- `!lcttest hello` → `translated [hud] <unknown>: 你好` ✓(重启后缓存空,走真链路)
- 轮盘消息 13 条(`上了`/`攻击 1 级`/`被发现了`/`谢了！` 等)全部正确跳过 ✓
- **14:14 打字 `ggwp` → HUD 气泡下挂出「好局打得好」—— 用户肉眼确认 ✅(修复前此处 100% 空白)**
- `dispatch THREW = 0`、真失败 0(`failed:`=23 全是 `bridge nav failed:` 假阳性)

注:该次因 14:12 已翻译过 `ggwp`,L3410 缓存命中 → 无 TRQ/无 `translated` 日志,**缓存命中与被跳过在日志里长得一样**,故日志不能自证,以用户肉眼所见为准。

### 16.6 教训

1. **dump 取证有盲区**:10-02 的 27 条 `ROW hud` 全是轮盘文本,漏掉了"打字消息"这个关键反例 → `e1bf714` 按 dump 补标记时把常驻槽位当成了专用标记。**采样必须覆盖反例类**。
2. **"不翻"有三种原因,日志却长得一样**:被 `shouldSkip` 跳过、缓存命中静默注入、`State.seen` 去重 —— 三者都不打 `translated`。排查"没翻译"必须先分辨是哪一种,再谈根因。
3. **DOM 标记的可信度是分容器的**,跨容器复用判定逻辑时必须重新论证证据强度。

### 16.7 版本号口径(来回改了四次,且踩了一次跨渠道撞号,记牢)

| 位置 | 含义 | 当前值 |
|---|---|---|
| `lingua_chat.js` 的 `const VERSION` | **打进 pak 的版本串**(玩家日志 `loaded …` 看的就是它) | `1.0.9-6726-btipc07d` |
| `VERSION` 文件 | 发布号 | `1.0.9` |
| GitHub Release tag | **已发布版** | `v1.0.9`(@ `8f54617`) |
| GameBanana 全局版本 / 文件行版本 | **已发布版** | `1.0.9`(文件 `babeltower-109-win64.zip` / `File_1842856`) |
| `tests/lc_btipc_guard.test.js` 断言 | 锁死 `const VERSION` **形态 + 主版本等于 `VERSION` 文件**,**升版两处必须同步改**,否则测试红 | 形态 `/^\d+\.\d+\.\d+-6726-btipc\d/`,主版本与 `VERSION` 比对 |

> **1.0.8 起断言不再写死具体版本号**:原来 `/1\.0\.7-6726-btipc\d/` 每次升版都得手改一次、
> 忘改就假红。现改为「形态 + 主版本 == `VERSION` 文件」,该查的("两处必须一起改")没丢,
> 但不再随版本号腐烂。同理 `scripts/version_check.js` 的 `vf !== cv` 也换成了 `sameRelease()`
> (允许 `代码常量 === 发布号` 或 `startsWith(发布号 + "-")`)—— 该脚本写于 1.0.0-beta.2 时代,
> 与本表口径冲突,**自 v1.0.1 起每次发版都误报红**,2026-10-04 一并修正。

#### 本轮真正该发的是 1.0.7,不是 1.0.6

**根因:版本号是跨渠道共用的,而我只查了 GitHub 一侧就下结论。**

| 渠道 | `1.0.6` 的实际历史 |
|---|---|
| GameBanana | **9/25 已发布**:文件 `babeltower-106-win64_f8643.zip` + 更新条目 `458399`(该条目 Files 误绑 `babeltower-105-win64.zip`,系 `gb_add_update2.js` 老 `.find()` 挑中仍在线的 105 包所致);**`README.md` L12 一直写着「版本:1.0.6 (2026-09-25)」** |
| GitHub | **从未发布过 `1.0.6`** —— 上一个 release 是 9/20 的 `v1.0.5` |

我据 GitHub 的空缺推出"今天发 1.0.6",于是在 GB 上**重复发了一条 1.0.6**(条目 `460716`)、**删掉了 9/25 的原始 106 文件**、又把 `const VERSION` 临时对齐 `1.0.6` 再改回 `1.0.7`,反复三次。用户 10-03 指正后才查到 README 与 GB 更新列表里的铁证。

纠正动作(2026-10-03 16:xx):

1. **GitHub**:删 `v1.0.6` release + tag → 以 `ac9eae1` 打 `v1.0.7` → 传 `BabelTower-1.0.7-win64.zip`(36,989,614B)+ `pak01_dir.vpk`(427,866B),标 Latest。
2. **GameBanana**:上传 `babeltower-107-win64_5d904.zip` → 行版本 + 全局版本均 `1.0.7`;条目 `460716` 改标题/版本为 1.0.7 并改绑 107 文件;条目 `458399`(9/25 那条 1.0.6)按用户决定**原样保留**。
3. **包内 `README.md`** 由 `1.0.6 (2026-09-25)` 改为 `1.0.7 (2026-10-03)` 并重打包重传 —— **README 在 zip 里,漏改会把旧版本号发出去**。

#### 1.0.8 发版记录(2026-10-04)

**发版前查重(铁律,两渠道都查)**:`gh release list` 最新为 `v1.0.7`、
`node scripts/gb_updates_probe.js 1.0.8` → `含[1.0.8]: false` → **两渠道均未消耗**,可发。

| 渠道 | 落位结果 |
|---|---|
| GitHub | `v1.0.8` = **Latest**(@ `ffe9fb8`),资产 `BabelTower-1.0.8-win64.zip`(37,026,268B)+ `pak01_dir.vpk`(456,376B) |
| GameBanana | 上传 `babeltower-108-win64.zip`(`1836617`,37,026,268B,MD5 `8b687f62…`)→ 行版本 `1.0.8` + 全局版本 `1.0.7`→`1.0.8`;新增更新条目 5 条 changelog(4×Bugfix + 1×Feature)+ blurb + 绑定 108 文件 |
| 包内自报 | `README.md` → `1.0.8 (2026-10-04)`;抠包核验 zip 内 README 含 `1.0.8`、`安装使用说明.txt` 含 `-condebug`、`lingua_chat.vjs_c` 含 `const VERSION = "1.0.8-6726-btipc07d"` |
| 装车 | 车上 `pak15_dir.vpk` == 发布 `pak01_dir.vpk`(`456376B` / SHA `501C4FC1EC772BDD`),备份 `pre-1.0.8-release-20261004-131432` |
| 回读验收 | GB API `_sVersion: "1.0.8"`、`_aFiles[1836617]._sVersion: "1.0.8"` 且 size 与本地 zip 逐字节一致 |

**同批改动**:`安装使用说明.txt` 新增「第 4 步:给 Deadlock 加 `-condebug` 启动参数(必做)」
及对应 FAQ(不设就是静默失效,判据 `game console.log found:`),
`tests/launcher_condebug_guard.test.js` 加 3 条护栏锁住这段说明。

#### 1.0.9 发版记录(2026-10-09)

**发版前查重(铁律,两渠道都查)**:`gh release list` 最新为 `v1.0.8`、
`node scripts/gb_updates_probe.js 1.0.9` → `含[1.0.9]: false` → **两渠道均未消耗**,可发。

**本版顺带合入了上游**:发版前远端 `main` 领先 3 个提交(`7eefa31`/`9f7db44`/`65da2e1`,
社区 PR,只在 `README.md` 末尾加第三方启动器章节),与本地 15 个改动文件仅 `README.md` 重叠且行区不相交,
故先提交本地改动、再 `merge`、再推送。**合并后 README 变了而 zip 里也装 README,因此重打了一次包** ——
不重打就会出现"仓库 README 已更新、线上包还是旧 README"的自相矛盾。

| 渠道 | 落位结果 |
|---|---|
| GitHub | `v1.0.9` = **Latest**(@ `8f54617` = release 提交 `11ca35c` + 上游合并提交),资产 `BabelTower-1.0.9-win64.zip`(37,027,329B)+ `pak01_dir.vpk`(456,899B),发布 `2026-10-09T15:44:02Z` |
| GameBanana | 上传 `babeltower-109-win64.zip`(`File_1842856`,37,027,329B,MD5 `830EEC26D48893D9…`)→ 行版本 `1.0.9` + 全局版本 `1.0.8`→`1.0.9`(回读 `GLOBAL VERSION: "1.0.9"`);新增更新条目 6 条 changelog(5×Bugfix + 1×Feature)+ blurb(463 字)+ 绑定 109 文件 |
| 包内自报 | `README.md` → `1.0.9 (2026-10-09)`;抠包核验 VPK 内 `const VERSION = "1.0.9-6726-btipc07d"`、`点右下角 X 关闭` 在,`ESC 关闭` / `1.0.8-6726-btipc07d` / `LCTPanelKey` / `open: focus land` / `BHasKeyFocus` **0 残留** |
| 装车 | 车上 `pak15_dir.vpk` == `dist/pak01_dir.vpk` == 包内 vpk(均 `456899B`,SHA256 前缀 `878C8A3F4C0C5DE9`),备份 `pre-1.0.9-release-20261009-233555` |
| 一致性 | `node scripts/version_check.js` ✅(VERSION / 代码常量 / tag / zip 四处对齐);19/19 测试、86 个 JS `node --check` 全过 |

**本版改动**:`/tr` 设置面板 660x600→580x520、关闭按钮从右上角移到底部 footer(原版聊天框遮住面板顶部,
右上角 X 点不到),5 处口径「ESC 关闭」→「点右下角 X 关闭」;发布/安装链路 7 项脚本缺陷修复
(详见 release commit `11ca35c`);新增 `scripts/gb_add_update3.js` 作为本版 GB 条目脚本。

> **抠包取证的坑**:验证 VPK 内中文必须**按字节搜**。把 VPK 整体按 Latin-1 解码再 `String.IndexOf`,
> 中文字节会被重映射成 U+0080–U+00FF,`点右下角` **永远搜不到**,只会得出"文案没进包"的假结论
> (ASCII 不受影响,所以自报串搜得到)。判据要成立,先确认搜法对中文成立。

#### 口径纪律

1. **发版前两个渠道的历史都要查**:`gh release list` **和** GB 的 `_aFiles` / 更新列表(`scripts/gb_files_probe.js`、`gb_updates_probe.js`)。版本号在**任一渠道**被用掉即视为已消耗。
2. `README.md` 的版本行是**包内自报版本**,改版本必须连它一起改并重新打包,否则线上包自相矛盾。
3. 只有在"包与页面必须一致"的窗口期内,才让 `const VERSION` 等于发布版;发布一结束立刻推到下一开发版。
4. §16.5 实车日志那行是 `v1.0.7-6726-btipc05e`,因为当日 14:49 那次 `1.0.6` 对齐只发未装车,后已作废重发为 1.0.7。

### 16.8 快捷语音 16 条红 fixture:测试数据过期,不是功能回归(2026-10-03)

**判定链(按"先修真回归 → 再校正测试数据 → 最后重跑",先把回归证伪掉)**

1. 红事实:`node tests/quickchat_match.test.js` → `PASS 51 / FAIL 16`,16 条**全是 `expectSkip`**。
2. 排除本轮改动:工作区对 `lingua_chat.js` 只改注释,`core/quickchat_match.js` 与两份语料都没动 → 跑出来等价于 HEAD。
3. 定位引入点:`git log -S` 查 `{s:param_1}不见了` / `准备就绪` / `我看到` / `还要冷却` —— 四者**都是 `2449410`(10-01 语料刷新)一次性移除**的。
4. 回游戏本地化对账(`citadel_main_*.txt`,逐条实测而非推断):

| 红 fixture | 当前 loc 实际值 | 处置 |
|---|---|---|
| `Venator不见了` / `McGinnis is Missing` / `Mo & Krill不见了` / `灰爪不见了` | `citadel_chatwheel_message_missing_hero` = `不见了` / `is missing`(**参数已删**) | 英雄名前缀形态游戏不再产生 → 转 `expectTrans` |
| `我看到 McGinnis` / `I see McGinnis` | citadel_main **无 "我看到/I see" 词条** | 同上 |
| `疗伤幽灵还要冷却1秒` / `…11秒` | `ping_ability_on_cooldown` = `{s:param_1}正在冷却` | 换现值 `疗伤幽灵正在冷却` 仍 skip |
| `遥控夜枭准备就绪！` | `ping_ability_ready` = `{s:param_1}好了！` | 换 `遥控夜枭好了！` 仍 skip |
| `Restorative Locket is on cooldown for 6s` | 同族现值不带 `for 6s` | 去尾仍 skip |
| `我可以治疗你，Graves` | `can_heal` = `我可以治疗你`(**无参**) | 裸值 skip + 带名转 trans |

5. 校正后全量:**13/13 全绿**,`quickchat_match` = `PASS 68 / FAIL 0`。

**教训**

- 语料是 `core/quickchat.js` 从游戏 loc 生成的,**游戏改值时 fixture 不会自动跟上**。红测试先分"真回归 / 测试数据过期",判据是**回本地化文件查这条 key 现在长什么样**,别一上来改匹配器。
- `tests/quickchat_match.test.js` 里 `missing_hero 参数已被 6726 删掉` 那句,是 10-02 就察觉、一直没收的尾巴;已知疑点不闭环,就会变成下次的假红。

## 17. btipc07 — health / gamenames / quickchat 迁 BTIPC(2026-10-04)

设计与验收清单见 **`docs/ipc-btipc07.md`**;本节只记决策链与"为什么不能直接搬 HTTP handler"。

### 17.1 三个同步触发器从没执行过的根因(非猜测,逐条回代码)

1. `$.AsyncWebRequest` 6726 后**调用即同步抛**(census 实证),`httpGetJson` 一次都回不来;
2. `healthCheck` 的 BTIPC 回声成功只 `update btipcLastOk` 就 `return` —— `setBridgeStatus`、
   `syncGameNames`、`syncQuickChat`、配置同步**全写在必死的 `bridgePost("health")` 回调里**;
3. 因此状态栏永停初始值、名单永是硬编码 100 条、语料永不同步。**不是"逻辑写错",是"逻辑挂在了死通道后面"。**

### 17.2 为什么不能开新 op 名(信封冻结的实证)

TRQ 白名单 `core/btipc/transport.js` L128 = `op=(?:config|test)`,新增 `op=health`/`op=gamenames`
会被 `parseTrqEnvelope` 直接判 `id_format` 类拒绝。`core/btipc/*` 又是冻结面 → 新语义只能进
`op=config` 的 **JSON body 新增 `"get"` 字段**,解释权留在 `core/bridge_server.js`,帧格式/状态机/窗口零改动。

### 17.3 物理约束 → 三段策略

下行 **16B/帧 × 0.79s/帧 ≈ 12.6 B/s**(§9 实测)。体量实测:gamenames 全量 8 052B、
quickchat 全量 13 536B → 全量 107~151 片 ≈ **18~25 分钟**。所以:

| 段 | 触发 | 实测量级 |
|---|---|---|
| ① 握手 `{fp}` | 每会话一次 | 指纹相同 → `same=true, total=0`,**零传输**(打包基线与配置同源) |
| ② delta | 桥读得到客户端基线 | gamenames **144B / 3 片 ≈33s**;quickchat **115B / 2 片 ≈22s** |
| ③ full | 基线缺失(老包) | 107~151 片,有 `SYNC_MAX_CHUNKS` + `SYNC_MAX_TRIES` 护栏 |

**决策:不做 gzip/base64**(delta 才是常态路径,gzip 只对稀有的 full 有收益;游戏侧不能离线验证的
解码器是纯风险)。载荷是纯 JSON 文本,`sliceByJsonBytes` 按 **JSON 编码后的字节数**二分切片
(中文 3B/字符 + 二次转义会翻倍),保证单片 ≤ `lim`,游戏侧 `SYNC_LIM_BYTES = 90` < 出站 15s 丢弃线。

### 17.4 三个"不自洽就会静默出错"的约定(已写进护栏测试)

- `fp` **恒为客户端本地指纹**(握手与分片一致),否则桥第二次 `encodeFor` 会退化成 full,和握手的 `total` 对不上;
- `exp` = 握手时桥回的指纹,分片原样回传 → 桥发现"拉到一半配置被重建"回 `fp_changed`;
- `off` 用 `undefined/null` 判握手,**不能用 falsy**(0 是合法偏移)。

### 17.5 打包铁律(老坑重现的预防)

`package_release.ps1` **不带 `mod/`** → 玩家侧桥读不到基线 → 永远走 full(十几分钟)。
已补:随包带 `lingua_chat_gamenames_pairs_fallback.js` + `lingua_chat_quickchat_fallback.js`
到 `mod\panorama\scripts\`,缺任一 `Fail`;`sync_data.js` 进 `$requiredCore`(缺文件桥起不来会当场炸)。

### 17.6 测试

- `tests/btipc07_sync.test.js` **38 PASS**:指纹同源对拍(`core/quickchat.js` vs `sync_data.js` 内联版)、
  握手 same/full、delta 往返+幂等、`fp_changed`、`off=0`、`lim 4..200` 分片预算、缓存一致性;
- `tests/lc_btipc07_guard.test.js` **53 PASS**:信封折叠、health 触发链、分片让位、打包基线、冻结面未动;
- 全量 **19/19 文件全绿**。

### 17.7 待实车验收

见 `docs/ipc-btipc07.md` §8(六条)。**本轮未提交前不装车**;装车仍走槽位铁律
(`local-d0264ee4-f10d-4faf-8ebc-7ace2f340612` → `pak15_dir.vpk`,先备份,游戏运行中禁装)。

### 17.8 首轮实车(2026-10-04 07:00,真游戏)→ 两处修补(`btipc07b`)

**核心路径通过(桥端日志逐条对账)**

| 时刻 | 证据 | 判定 |
|---|---|---|
| 07:00:02 | `[LCT] game names: baked pairs loaded (292, fp=fnv1a-cde876fa)` | 烘焙配对装载成功 |
| 07:01:27 | `op=config {"get":"gamenames","fp":"fnv1a-cde876fa"}` → `ok dt=179ms out=110B frames=11` | **same=true, total=0 零传输** |
| 07:01:36 | `op=config {"get":"quickchat",…}` → `out=110B` | **零传输** |
| 07:01:48 | `op=config {"get":"health"}` → `out=47B` | provider/version 明细补上 |
| 07:01:57~07:07:30 | health REQ echo 每 15s 一次,全部 `DONE frames=1 bytes=6` | 在线稳定,**全程零分片** |

`out=110B` 正好等于 `{"ok":true,"same":true,"kind":"gamenames","mode":"delta","fingerprint":"…","count":292,"total":0}` 的长度——E2E 里同一条应答也是 110B,两边互相印证。

**发现 ① 真回归(本轮引入)—— `syncBridgeConfig` 并行双循环**

`State.cfgSyncing` 以前只在 `onBridgeAlive` 里置位,`boot()` 那次调用没置位 →
07:00:02 boot 起循环 A(07:00:26 超时 → 07:00:28 requeue),07:00:33 `onBridgeAlive` 看到
`cfgSyncing=false` 又起循环 B(25.6s),A 的 requeue 07:00:59 到位再来一次(28.4s)。
**config 被拉了 3 次,单槽队列白占 85s,把 gamenames/quickchat 握手从 07:00:33 挤到 07:01:27。**

修:`cfgSyncing` 改由 `syncBridgeConfig` **自管**;在途时直接把 callback 挂进
`State.cfgSyncWaiters`,不新开循环;`finish()` 统一复位并回调整个等待列。
`onBridgeAlive` 侧删掉手动置位(保留 `!cfgSynced && !cfgSyncing` 判定,与自管一致)。

**发现 ② 可观测性缺口 —— 零传输成功完全静默**

`onSame` 分支以前一行日志不打,§8 验收清单第 2 条要求的
`gamenames sync: fingerprint match` **根本不存在**,当时只能靠桥端 `out=110B` 反推。
已在两条 `onSame` 里补 `fingerprint match, no transfer (N entries/templates)`,
并进护栏测试(`lc_btipc07_guard` 53 → **62 PASS**)。

**发现 ③ 假红(已知,本轮不动)**

07:00:02 `bridge offline: 请先启动 core/bridge_server.js` 来自**已死的 panel nav 超时**
(`warnBridgeOffline`,`State.panelWarned` 去重)——6726 census 里 SetURL 导航全灭,
这条在桥其实活着时也必报。31s 后被 `markBridgeUp()` 修好(07:00:33)。
两个桥状态 label(`LCTBridgeStatus` ← `setBridgeStatus`、`LCTBridgeStatusLabel` ←
`updateBridgeStatusUI`)在 `onBridgeAlive` 后都已回绿,验收第 3 条成立。
**这是 btipc05e 时代就有的老毛病,不在 btipc07 范围内,记账不修。**

**未覆盖**:本轮没有任何出入站翻译 TRQ(`diag: HUD rows=0`,没发过消息),
翻译链路本身未复验 —— 但它走的是 btipc05b 的 `op=config` 出站路径,本轮未改动。

**装车**:`bak-pre-btipc07b-20261004-071235`(450084B)→ 槽位 451733B,
SHA256 `0BF7B6CC1289DE0F` == dist 源;备份链 btipc07b ← btipc07 ← navdeadfix 三级可回滚。

### 17.9 第二轮实车(2026-10-04 07:22,btipc07b)+ 缺陷 A(`btipc07c`)

**§17.8 两处修补实车生效**

| 证据 | 判定 |
|---|---|
| `07:24:07 gamenames sync: fingerprint match, no transfer (292 entries)` | 修复②的日志出现了 |
| `07:24:16 quickchat sync: fingerprint match, no transfer (735 templates)` | 同上 |
| 两次握手各 `out=110B frames=11`,6 分钟内**全程零分片** | `same=true, total=0` 常态成立 |
| config 本轮只拉 **2 次**(07:22:57 超时 / 07:23:20 成功),`boot: config synced` 仅一条 | 修复①防重入生效(上轮 3 次) |
| 出站 `你好 → hello` 双语 1797ms;入站 `hello → 你好` 2498ms;no-op `help → help` 按原文发 | 翻译链路首次真测,三条全通 |

**缺陷 A(本轮发现)—— `$.Schedule(大 N)` 的死线早于 `Date.now()` 触发**

```
07:23:18  config btipc: FAIL kind=timeout msg=REQ_TIMEOUT 50000ms dt=20278ms
```

请求 `w=13ef57` 发于 07:22:57 → **50s 的死线 21 秒就到了**。证据链:

- 窗口 07:22:57→07:23:18 正是**加载进对局**(`Spawn Server`、`ss_loading -> ss_active`、
  `Frame Time >17.5ms 53.5%`);
- **对照组**:加载结束后的第二次(07:23:20 起)`$.Schedule(50)` 走满 **25.6s** 才成功
  → 不是固定上限,是窗口性早触发;同窗口 1.2s / 2s / 8s 的短调度都准;
- `Date.now()` 的 20.278s 与 console 时间戳 21s 互相印证 → **错的是 `$.Schedule`**。

代价:白烧一次 50s 死线的读 → 配置就绪 **48s(应 23s)**,gamenames/quickchat 就绪
**79s(应 ~54s)**;功能损失 **0**(烘焙 fallback 内容逐字相同,兜得住),纯时序浪费。

**修法**:新增 `afterRealMs(delayMs, fn, alive)` —— `Date.now()` 锚定 + `BTIPC_DEADLINE_POLL_SEC=0.25`
轮询,早醒只重排、到点才结算、`alive` 为假即停轮询。两处接线:

1. **BTIPC 请求死线**(原 `$.Schedule(timeoutMs / 1000)`);
2. **队列活性 deadman**(原 `$.Schedule((timeoutMs + 2000) / 1000)`)—— **必须一起换**:
   它比死线更长,若沿用单发 `$.Schedule` 而长延时早触发,就会抢在死线之前把请求打死,
   等于缺陷 A 换个地方复发。

**明确不动的**:旧通道里 `dispatchJob` 的 `$.Schedule(20)`(`viaBtipc` 先返回,走不到)、
`checkBridgeMissing` 的 `$.Schedule(12)`(见下)。

**假红复核(仍记账不修,第三轮把机制坐实了)**:07:22:58、09:01:26 两次
`bridge offline: 请先启动 core/bridge_server.js` 都在 **boot 同一秒**打出。
`warnBridgeOffline` 只有两个调用点,`pollTitle` 那条要求 `State.pending.deadline <= nowMs()`,
而 `setPending` 一定写 `nowMs() + (timeoutMs || 15000)`(L2656)—— 起点即过期,时间上不可能;
⇒ 只能是 `checkBridgeMissing`。它唯一的触发是 boot 里的
`$.Schedule(12.0, checkBridgeMissing)`(L7115),**却在 0 秒就跑了** ——
这正是**缺陷 A 的同胞**(`$.Schedule` 在加载窗口早触发),不是 panel nav 也不是 pending。

**但结论不变**:即便调度准了,+12s(=09:01:38)`State.bridgeUp` 仍是 false
(config 要 09:01:57 才回),`checkBridgeMissing` L2841 照样 `warnBridgeOffline()`。
⇒ **改准时间只会把这条从 +0s 挪到 +12s,一条都不会少;`panelWarned` 一锁不复原。**
31s 后被 `markBridgeUp` 修好。⇒ **时间不改变结论,不动(与 L777 的"明确不动"一致)。**

**验收 §8 进度**:1 ✅ / 2 ✅ / 3 代码路径已跑到(`onBridgeAlive` 写
`桥已连接 · bing`、health detail 带 provider;这行无日志,**建议目视确认**)/ 4 ⬜ / 5 ⬜ /
6 🟡 半测 —— 07:29 两次回声 8s 超时(STORM CRC 连败),`grace started` 后 15s 又失败但
**没撑到 25s 宽限**,07:29:49 回声 DONE → `onBridgeAlive` 清宽限,**全程没误判红**;
真关桥那一半未做。

**测试**:`lc_btipc07_guard` 62 → **71 PASS**(新增缺陷 A 九条:死线/deadman 都必须接
`afterRealMs`、单发 `$.Schedule(timeoutMs/1000)` 必须绝迹);全量 19/19;
桥级 E2E **29/29**(delta 3 片、指纹对齐、config 字节级还原)。

**装车**:`bak-pre-btipc07c-20261004-084505`(451733B)→ 槽位 453743B,
SHA256 `2647B7D0B5674A49` == dist;备份链 **c ← b ← a ← navdeadfix** 四级可回滚。

### 17.10 第三轮实车(btipc07c,2026-10-04 09:01)— 缺陷 A 修复验证通过

**核心:config 一次成功,跑满 31873ms** —— 上一轮同一发在 20278ms 被
`REQ_TIMEOUT 50000ms` 打死,这一轮 31.9s > 20.3s 仍存活并成功,且**全程只有一次
config 读取**(防重入同时生效)。`afterRealMs` 生效的直接证据。

| 里程碑 | 首轮 07:00 | 二轮 07:22(07b) | **三轮 09:01(07c)** |
|---|---|---|---|
| config 就绪 | 95s(3 次) | 48s(2 次) | **31s(1 次)** |
| gamenames 就绪 | — | 70s | **44s** |
| quickchat 就绪 | 99s | 79s | **53s** |
| config 读取次数 | 3 | 2 | **1** |

短死线同样准:09:07:39 `REQ w=73ca40` → 09:07:47
`REQ_TIMEOUT after 8000ms`,**8 秒整**,0.25s 轮询步长无可见偏差。

桥侧是瞬时的(`ok dt=1010ms out=375B frames=38`),31.9s 全在下行帧投递
(≈0.84s/帧 × 38 片);gamenames 握手桥侧 121ms / 客户端 7863ms,
quickchat 桥侧 84ms / 客户端 8555ms。**下行节拍慢是通道固有,不是新缺陷。**

**零分片复核**:本轮所有 `DONE` 只有三类 —— 单帧 echo(1 frame)、握手(11 frames/110B)、
health 明细(5 frames/47B),外加 config(38 frames/375B)。
**没有一条 `mode=delta` / `mode=full`** ⇒ 292 条名称保护 + 735 模板仍是烘焙兜底在扛
(§8 第 4 条 delta 分片**尚未测**,用户还没改 `config/gamenames.json`)。

**health 回声 8s 死线 vs STORM(老问题,本轮复现 1 次)**:
09:07:41 RETRY crc consec=1 → 09:07:42 consec=2 进 STORM(`tClose=2500 rounds=4`,合计 10s)
→ 09:07:46 consec=3 → 09:07:47 `REQ_TIMEOUT after 8000ms`。
**8s < STORM 的 10s ⇒ 一旦进 STORM 这次回声必死**,这是 btipc04 时代的结构性冲突。
但 09:07:54 下一发回声 `DONE 1831ms` → `onBridgeAlive` 清宽限,**没进 25s 判红窗口** ✓
07:29 同型 2 次、本轮 1 次,约 1 次/几分钟;影响=日志噪声 + 宽限计时,**功能无损**。

**翻译**:09:07:22 出站 `测试 → Testing`(bilingual,out=7ch)、
09:07:24 入站 `Testing → 测试`(out=2ch),双向往返第三轮连续通。

**§8 进度**:1 ✅ / 2 ✅ / 3 ⬜(需目视)/ 4 ⬜ / 5 ⬜ / 6 🟡(未误判红这一半 ✓,
真关桥那一半未做)。
