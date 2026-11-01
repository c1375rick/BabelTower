# exp6734-D:Bridge → Panorama 下行吞吐基准(Downlink Capacity Benchmark)

> **状态**:历史(实验记录) · **适用版本**:exp6734-D(2026-10-02) · **最后核对**:2026-11-01
> **说明**:结论已进入 BTIPC v1 参数表([btipc-v1.md](btipc-v1.md) §9);数据保留,不再复跑。

> 定位:**BTIPC v1 冻结前的第一产出**。帧大小、窗口、超时不拍脑袋,全部由本基准的实测数据决定。
> 状态:探针已实现待实车(版本 `1.0.7-6726-exp6734D`)+ 桥端 `/probe_bit` 已加 `c=` 分组;分析器 `scripts/exp6734d_analyze.js` + 单测已过(43/44,唯一失败为会话前遗留 `quickchat_match.test.js`)。
> 上游依据:`docs/ipc-checklist-6726.md` §7(exp6734-B,64 面板 × 20 轮 1280 样本)。

---

## 1. 为什么先做这个

exp6734-B 证明了通道**可用**,但只测了一种配置(64 面板 / 每面板 1 bit / 等全轮 + 1.5s 间隔),不足以定规格:

- 6734-B 有效吞吐实测 ~34 bit/s(64bit / 1.9s 轮间隔)——按此速率一条 60~150 字节的译文回程要 15~35 秒,**不可用**;
- 轮完成 P50=331ms 意味着调度有 ~5× 余量;面板是 `$.CreatePanel` 自建的(64 只是"凑一个 64-bit 字"的方便数),**不是引擎上限**;
- 但堆面板是否线性扩、何时拥塞,**没有数据**。

同时必须把两个概念分开:

```text
物理传输单位(一次 SetImage 的面板批)   ≠   协议帧(逻辑一帧的 bit 数)

例: BTIPC Frame = 128 bits
    Physical Image Burst = 64 panels → ACK → 64 panels → ACK
```

协议帧可以大于单次发射批——这是本基准特意保留的设计空间(W 组就是为了量它)。

**因此:先用 exp6734-D 钉死 `MAX_SAFE_PAYLOAD / SAFE_WINDOW / FRAME_TIMEOUT`,再写 BTIPC v1 代码。**

---

## 2. 测试矩阵

### D 组:面板数扩展性(每面板 1 bit)

| 测试 | 面板数 | 每面板承担 | 目的 |
| -- | --: | ---- | ------- |
| D1 | 16 | 1 bit | 小帧基准 |
| D2 | 32 | 1 bit | 中小帧 |
| D3 | 64 | 1 bit | 当前基准(与 6734-B 可比) |
| D4 | 96 | 1 bit | 看扩展性 |
| D5 | 128 | 1 bit | 看是否开始拥塞 |
| D6 | 256 | 1 bit | 极限探测 |

每配置 **20 轮**;轮间隔 0.5s(有丢失的轮后置 3s 沉降);单轮超时 12s。

### W 组:并发窗口(256 bit 帧分批发射)

| 测试 | 帧 | 窗口 | 轮数 | 目的 |
| -- | --: | --: | --: | ---- |
| W1 | 256 bit | 16 | 10 | 小窗流水 |
| W2 | 256 bit | 32 | 10 | |
| W3 | 256 bit | 64 | 10 | 对照 D3 窗口 |
| W4 | 256 bit | 96 | 10 | |
| W5 | 256 bit | 128 | 10 | 大窗 |

窗口模式:窗口 k 全部到齐(或 6s STALL)才发窗口 k+1;单 bit 永不到不拖死整帧。
判定"窗口是否比一次性 256 发射更稳",看同为 256 bit 帧的 W 组 word 分位 vs D6。

---

## 3. 每轮记录字段 → 日志行映射

| 要求字段 | 日志行(brige.log 内 `exp6734D:` 前缀) |
| --- | --- |
| round / panel_count / bit_count | `ROUND n=<cfg> r=<r> SHOT t=<t>` + `CFG <cfg> START n= win= rounds=` |
| SetImage timestamp | `SHOT t=` / 每窗 `WIN n=.. k=../.. SHOT a..b t=`(批内同 ms) |
| ImageLoaded timestamp | `LOADED n=.. r=.. i=.. dt=.. seq=..`(dt = 轮起点→该 bit 到达) |
| first/last bit latency | `ROUND .. DONE first= last=` |
| word_completion_latency | `ROUND .. DONE|TIMEOUT word=` |
| lost | `ROUND .. lost=`(TIMEOUT 轮未到数) |
| duplicate | `DUP n=.. r=.. i=.. dt=..`(游戏侧)+ 服务端同 `(c,round,id)` 重复落底 |
| reordered | 由 `LOADED seq=` 到达序与 `i` 比较得出 |
| server_request_count | 桥侧 `BIT c=<cfg> id=BTD<i> round=<r>` 逐条计数 |
| 窗口停滞 | `WIN .. STALL loaded=a/b`;窗口完成 `WIN .. DONE dt=` |

配置键 `<cfg>` 形如 `64@435123`(面板数[或 256w64] @ runTag),同时进 URL `c=` 参数:
既击穿 image 缓存,又让服务端按配置分组、按 run 隔离重复跑。

---

## 4. 计算口径(`scripts/exp6734d_analyze.js`)

```text
bit 延迟分位    = 单 bit dt 的 P50/P90/P95/P99/MAX(最近秩 nearest-rank)
word 分位       = 每轮 word 完成时间的 P50/P95/P99/MAX(TIMEOUT 轮 = 截止时刻,单独计 TMO 列)
有效吞吐(word) = 每轮 loaded_bits / word_seconds,取中位
可持续吞吐(sus) = Σbits / (首拍 → 末轮完成 墙钟跨度,含轮间隔)
Loss            = Σ lost
Dup             = 游戏 DUP 行数 + 服务端重复落底数
Reo%            = 轮内相邻到达逆序对 / 总相邻对 × 100
对账            = 游戏 (cfg,round,i) 集合 ↔ 服务端集合 → gameOnly / srvOnly
```

---

## 5. 最终输出表(分析器实际输出为下表超集)

```text
Cfg | Rounds | Bits | P50 | P95 | P99 | Max | W-P50 | W-P95 | W-Max | Loss | Dup | Reo% | TMO | b/s(word) | b/s(sus)
----|--------|------|-----|-----|-----|-----|-------|-------|-------|------|-----|------|-----|-----------|--------
16@run  |20/20|...|-|-|-|-|-|-|-|-|-|-|-|-|-
32@run  |20/20|...|...
64@run  |20/20|...|...        ← 与 6734-B 同口径可比
96@run  |20/20|...|...
128@run |20/20|...|...
256@run |20/20|...|...
256w16@run |10/10|...|...
256w32@run |...
256w64@run |...
256w96@run |...
256w128@run|...
```

取数:

```bash
node scripts/exp6734d_analyze.js logs/bridge.log          # 表格
node scripts/exp6734d_analyze.js logs/bridge.log --json   # 机器可读
node scripts/exp6734d_analyze.js logs/bridge.log --only=64@435123
```

---

## 6. 判定规则(数据 → 冻结 BTIPC v1)

从表中取三个参数:

```text
MAX_SAFE_PAYLOAD = word P95 未出现非线性跃迁(如 64→96→128 近似平稳、256 陡增)的最大面板数
SAFE_WINDOW      = 256 帧下 word P95 最优且 STALL/TMO 最少的窗口;若窗口无收益则 = MAX_SAFE_PAYLOAD(单批直发)
FRAME_TIMEOUT    = word P99 × 安全系数(≥2,且 ≥3s —— 6734-B 长尾已要求 ≥3s)
```

设计方向 A/B 的判据(示例值,以实测替换):

```text
若  64 panels→330ms, 128→360ms, 256→700ms   ⇒ 近线性 ⇒ 可上 128/256 大帧(方向 B)
若  64→330ms, 128→1.8s, 256→6s              ⇒ 拥塞   ⇒ 冻结 64 物理窗口 + 分帧(方向 A)
窗口组 若 256w64(word P95) < 256 单批        ⇒ 协议帧 128/256 + 物理窗口 64(帧 ≠ 发射批)
```

**只有这张表出来后,才写 `BTIPC.sendControl/waitAck/requestId/dedup/timeout` 与 frame/window/timeout 规格。**

---

## 7. 运行方式

```text
游戏内聊天(进对局后):
  /bt6734d        全矩阵 D1~D6(6 配置 × 20 轮 ≈ 5~10 分钟,视 256 面板表现)
  /bt6734d win    窗口组 W1~W5(5 配置 × 10 轮)
  /bt6734d 96     单配置调试(8..512)
  /bt6734d 256w64 亦可直接单开窗口配置(参数透传 cfg 串)

进度日志:游戏侧 ALL DONE 一次性收尾;中途可随时 grep exp6734D 观察
```

前置:桥已重启(`/probe_bit` 新增 `c=` 分组,老桥会忽略该参数导致服务端无法分组)。
面板:自建 `BTD0..BTD511` 隐藏 2×2(与 6734-B 的 `BTBIT*` 隔离),跑完留在 UI 树无副作用;重复跑自动复用。

---

## 8. 已知风险与注意

1. **256 面板引擎开销未验过**——D6 若出现帧尖峰/掉帧即为数据本身(拥塞证据),记录之,不要中途杀;
2. **console.log 体量**:全程约 2.5 万指标行(6734-B 为 1280 行);若 LOADED 行有丢失,分位数会缺样,word 分位(ROUND 行少得多)仍可用——分析器对缺样自动降级;
3. **TIMEOUT 轮是删失数据**:word = 截止时刻(上界),分析时看 TMO 列占比再解读 word P99;
4. **超时轮残留加载污染**:有 lost 的轮后置 3s 沉降再开下一轮;STALE 行(未发射面板的迟到到达)不计入;
5. 服务端 `BIT` 旧格式(`BIT id=BTBIT..`)保持不变,6734-B 分析器兼容不受影响。

---

## 9. 路线图(本步在最前)

```text
exp6734-D 吞吐基准        ← 现在
  ↓ 确定 physical window
  ↓ 确定 logical frame
  ↓ 确定 timeout / retry
BTIPC v1 协议冻结(文档 + 规格)
  ↓
BTIPC 代码(Bridge ↔ Panorama 独立跑通)
  ↓
接入 BabelTower(lingua_chat.js 旧 dispatchJob 换轨)
  ↓
C6 Submit 单 Enter(单段回填,免双击)
  ↓
真实翻译 API 全链路
```

---

## 10. 实车结果第一轮(run=324926,2026-10-02 00:15~00:21,/bt6734d D 组)

> ⚠️ 基线变更记录:2026-10-02 01:21 Steam 更新 Deadlock build 25639407 → 25658155;
> 本组数据采集于 25639407,新 build 需烟雾复验后方可执行 §6 冻结( addons/pak15 未受更新影响,已复验)。
> ✅ 复验完成(01:31~01:34,run=890861,/bt6734d 64):稳态 word 321~488ms 与旧基线 W-P50=397 重合,零丢失零重复零超时 —— **§6 冻结在新 build 上生效**。
> (前 8 轮 word 15~28s 为进图加载风暴,非新 build 行为变化;另注:新 build 上 200/3xx 的 bit dt 各提速 4×/20×,见 E 文档 §8.4。)

> 2026-10-02 判读:128 面板 = physical window 候选(191 bit/s,P95 798ms,较 256 仅損 2.4% 吞吐但 worst-case 减半);
> 256 无拥塞但已进收益递减区;风暴期需独立处理(normal_timeout ≈ 3s 与 loading 暂停分离,不因 17.5s 而调大 normal)。
>  下一步 → **exp6734-E 多值符号判别**(`docs/ipc-multivalue-benchmark-6734E.md`):验证单面板能否 >1 bit。
  E 已收官:仅 200/3xx 两符号可靠,3xx 慢态无吞吐优势 → **BTIPC v1 冻结全 200 编码,128 panels,1 bit/panel**;
  3xx 保留作 ACK 单符号备选;201/204/206/304/4xx/5xx = 静默丢弃(引擎不回调)。

```text
Cfg             Rds       Bits     P50     P90     P95      P99      Max    W-P50    W-P95    W-Max  Loss  Dup  Reo%  TMO b/s(word)  b/s(sus)
16@324926     20/20        320     174    4069    5912     7926     8393      235     7865     8393     0    0     0    0      66.9       6.3
32@324926     20/20        640    2441    9701   11695    15921    17462     8236    16748    17462     0    0     0    0       3.8       4.1
64@324926     20/20       1280     206     417     464      553      593      397      585      593     0    0   0.5    0     156.1      71.3
96@324926     20/20       1920     269     515     573     1459     1540      539      736     1540     0    0   0.3    0     170.2      88.3
128@324926    20/20       2560     311     599     658      755      809      661      798      809     0    0   0.2    0     191.3     112.8
256@324926    20/20       5120     595    1209    1446     1627     1764     1262     1722     1764     0    0   0.2    0       196       141
```

- 服务端落底逐配置精确 = 期望(320/640/1280/1920/2560/5120),**游戏↔服务端对账零差异、零丢失、零重复、TMO=0**;
- Reorder 0.2~0.5%,优于 6734-B 的 1.9%;未识别行 1 = 用户重复敲命令的 `already running, ignore`(良性)。

### 10.1 16/32 异常 = 对局加载风暴污染(非通道属性)

逐轮 word 显示**断点而非整体慢**:16 配置 r1-13 = 107~357ms、r14-20 = 2.9~8.4s;32 配置 r1-13 = 4.6~17.5s、r14-20 = 162~444ms。慢窗 ≈ 00:15:33→00:18:20,与日志中 GCServerWelcome(00:15:16)、ResourceSystem 加载英雄/地图资源(00:15:34+)完全吻合 = **进入对局加载期,引擎 image 队列被占**。

结论:**16/32 的 P90+ 分位作废(需稳态重跑 `/bt6734d 16` 与 `/bt6734d 32` 补测);同时证明风暴期通道零丢失(12s 轮超时吸收了全部延迟)**。

### 10.2 干净段初步判定(64/96/128/256,待 W 组确认)

| N | word P50 | word P95/P99 | b/s(word) | b/s(sus) |
| --: | --: | --: | --: | --: |
| 64 | 397ms | 585 / 553 | 156 | 71 |
| 96 | 539ms | 736 / 1459 | 170 | 88 |
| 128 | 661ms | 798 / 755 | 191 | 113 |
| 256 | 1262ms | 1722 / 1627 | 196 | 141 |

- **256 面板无拥塞趺点**(word 随 N 近线性,b/s(word) 饱和在 ~200):wait-for-all 轮调度的通道容量顶 ≈ **200 bit/s**;
- 256 轮 word P99=1627ms → 干净态 3s 超时够;但风暴态实测到 17.5s → 协议需风暴感知(加载期暂停/降速)或接受重传;
- 提速空间已量化:① 每面板独立流水(不等全轮,N/bitP50 ≈ 256/0.595 ≈ 430 bit/s 理论)  ② 状态码多值化(×≈2.3)③ W 组窗口发射 —— 待 `/bt6734d win` 数据。
  (后记: E 组实测否定了 ②——见 docs/ipc-multivalue-benchmark-6734E.md §8.3)
