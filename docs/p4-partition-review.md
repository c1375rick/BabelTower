# P4 评审:lingua_chat.js 探针区分家(P4a)

> 状态:P4 已授权并执行(用户 2026-10-12 拍板范围)。
> 本文是 compatibility.md §1 红线要求的"凭证据单独决策"证据包 + 设计 + 验证记录。

## 1. 授权与范围

| 项 | 内容 |
|---|---|
| 红线原文(compatibility.md §1) | P4(lingua_chat 分区解冻)1.1.0 窗口凭证据单独决策;若问题能在冻结边界外解决,继续保持冻结 |
| 授权 | 用户 2026-10-12「开p4」;范围经选项确认为 **P4a 只分探针区**(另一选项"全量分区"被否) |
| 做什么 | 把 EXP6727~6738 历史实验探针区(2,124 行)从 `lingua_chat.js` 纯搬移到新文件 `lingua_chat_exp.js` |
| 不做什么 | 核心 5,4xx 行 / 18 分区**不动**(P4b 全量分区见 §7,本轮不做);冻结四件(`core/btipc/{crc16,framer,transport,window}.js`)零触碰 |

## 2. 证据

### 2.1 文件结构(2026-10-12 实测)

- 总量 **7,583 行**,严格 IIFE:`(() => { "use strict"; ... boot(); })();`
- 18 个分区横幅(工具函数/配置/UMM/消息过滤/模板匹配/译文注入/翻译队列/状态机/聊天扫描×3/打字指示器/发送接管/BTIPC 客户端/设置面板/启动/btipc07 同步/实验区)
- **实验区 = 5361..7223(EXP6727~6734-E,1,863 行)+ 7294..7554(EXP6738,261 行)= 2,124 行 ≈ 28%**
  - 这些是 2026-09-17~10-03 IPC 攻坚期的一次性诊断探针(检查表 A~E、入站三连/四连、最后一百米闭环、64 面板延迟矩阵、TextEntry 控制、吞吐基准、多值符号判别、三点指示器),攻坚已结论(btipc05~07 打通),使命完成
  - 位置取证:`boot()` 定义(7224..7293)与尾部基础设施(exportGlobal 定义 + 17 条 XML 回调注册 + `boot();` 调用,7555..7583)被历史插入挤进实验区行号之间 —— 属 core,**随核心保留**
- 探针区 **零求值自启动**:indent-2 非声明语句扫描(5361..7554)仅见函数收尾 `}` 与尾部 core 注册 —— 探针只在被 `/bt*` 命令触发时运行

### 2.2 跨区耦合(精确量化)

| 方向 | 数量 | 明细 | 处置 |
|---|---|---|---|
| 核心 → 探针 | **6 处调用** | 派发块 4397(`exp6734cSubmitHook`)/4411(`runExp6734E`)/4420(`runExp6734D`)/4427(`runExp6734B`)/4433(`runExp6734C`)/4460(`runExp6738`) | 改走 `expCall(name, …)` 晚绑定(探针文件缺失/异常降级为无操作) |
| 核心 → `expErr` | 4 处引用 | 2591/2606/2630(settle 路径)+ boot 体内 | `expErr` 定义(5427..5429)**移入核心工具函数区** —— 不跨文件 |
| 探针 → 核心 | **26 个绑定** | 词边界扫描纯探针文本 ∩ 核心 indent-2 顶层声明(314 个)。清单:`BRIDGE_HOST, BRIDGE_PORT, BTIPC, CHAT_INPUT_ID, LOCAL_CLIENT_ID, State, VERSION, boot, childAt, childCount, clearInput, collectText, findChild, findClass, getRoot, hasClass, isValid, log, nowMs, readMessageRow, resolveChatMessages, resolveHudMessages, resolveLobbyMessages, safeText, t, triggerStockSubmit` | 探针文件头部 `const { … } = LCTNS` 别名导入,**函数体调用点零改动**(纯搬移) |
| 声明冲突 | 0 | 26 项与探针 indent-2 顶层声明(43 个)无交集;`t`/`boot` 为词边界超集(`t` 实为探针嵌套局部同名、`boot` 为注释提及),死导入无害 | — |

> 清单算法加固取证:声明解析器覆盖 `async function`/`function*`/`class`/多声明子句,实测与简单法同为 314(文件内不存在这几种形态);旧口径"27 函数"差异系扫描误含 boot 体 + 尾部 core。

### 2.3 机制先例(非发明,全部已有)

| 需求 | 先例 | 出处 |
|---|---|---|
| 跨文件共享 | fallback 语料文件裸全局赋值(如 `LCT_QUICKCHAT_FALLBACK_TEMPLATES`),主文件直接读 | `lingua_chat_quickchat_fallback.js` L4-5 |
| 全局写 | `globalThis[name] = fn` | 本文件 exportGlobal(L7555) |
| 多文件装载 | 两 XML 各 `<include>` 4 个脚本(fallback ×3 必须先于主脚本) | `chat.xml`/`hudchat.xml` |
| 构建 | build.ps1 全 glob(node --check、resourcecompiler、VPK 打包均按目录枚举) | `scripts/build.ps1` L131/L191 |
| require 装载(node 侧) | simtest 直接 `require(SCRIPT)` + fallback `require` | `scripts/lingua_chat_simtest.js` L211/L218 |

### 2.4 护栏/消费者审计

- **测试零引用探针函数**:`tests/` 全量 grep `runExp673|p6738|exp6734c|expErr|expSendBeacon|expPump|snapStrings|dShotWindow|EXP6727|EXP6738` → 0 命中(exp6734D/E 命中为桥侧日志分析器单测,读 `scripts/exp6734*_analyze.js`,与客户端文件无关)
- 读 `lingua_chat.js` 的 10 个测试文件,锚点全部落在核心保留区(VERSION/谓词/状态机/面板/@sync 块/回退清单)
- 需同步的消费者:① `chat.xml`+`hudchat.xml` 各加 1 行 include;② `build.ps1` VPK 关键资产清单 +1 项;③ simtest 双文件 require + 缓存清理;④ `lc_btipc07_guard` XML include 顺序断言扩展(main < exp);⑤ 新增分区护栏测试

## 3. 设计

### 3.1 命名空间与装载顺序

```
chat.xml / hudchat.xml 的 include 顺序:
  lingua_chat_*_fallback.vjs_c(×3,原有)
  → lingua_chat.vjs_c(核心:发布 globalThis.LCTNS 后 boot())
  → lingua_chat_exp.vjs_c(探针:头部别名导入 LCTNS,尾部发布 6 个派发入口)
```

- 核心尾部(exportGlobal 注册之前)发布:`LCTNS.<26 绑定> = <同名>` —— 与导入清单**同一份名单**,双向对账
- 探针尾部发布:`LCTNS.exp6734cSubmitHook / runExp6734B/C/D/E / runExp6738`
- 探针文件头部防御:`const L = globalThis.LCTNS || {};` 后解构 —— 核心缺失时探针整体惰性失效,不抛

### 3.2 派发接线(核心侧唯一语义改动点)

```js
// 工具函数区新增(与 expErr 相邻):
function expCall(name, a, b) {          // 探针晚绑定:缺文件/内部异常 → 降级无操作
  var f = globalThis.LCTNS && globalThis.LCTNS[name];
  if (typeof f !== "function") return undefined;
  try { return f(a, b); } catch (e) { log("exp " + name + " THREW " + expErr(e)); return undefined; }
}
```

6 处派发改写为 `expCall("runExp…", …)`;`expCall` 语义 = 原调用 ∪ 缺失容忍 ∪ 异常兜底(原状:同闭包裸调,探针异常会窜进提交链)。

### 3.3 纯搬移保证

- 探针代码行**字节原样**(原在主 IIFE 内 indent-2,新文件同为 IIFE 内 indent-2,零缩进变化)
- 不删、不改、不"顺手优化"任何实验逻辑;`expErr` 为唯一移位项(核心区内部搬移)
- 语法护栏:两文件 `node --check`(build 内建);静态对账:新护栏双向断言(§4)

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `mod/panorama/scripts/lingua_chat.js` | 切除 2 段探针区;`expErr` 移入工具函数区;新增 `expCall` + LCTNS 发布块(26 项);6 处派发晚绑定 |
| `mod/panorama/scripts/lingua_chat_exp.js` | **新文件**:头注 + IIFE + 26 项别名导入 + 探针区原样 2,124 行 + 6 入口发布 |
| `mod/panorama/layout/chat.xml`、`hudchat.xml` | 主 include 后加 `lingua_chat_exp.vjs_c` |
| `scripts/build.ps1` | VPK 关键资产清单 +`lingua_chat_exp.vjs_c` |
| `scripts/lingua_chat_simtest.js` | 双文件 require + 双缓存清理 |
| `tests/lc_btipc07_guard.test.js` | XML 断言扩:main include 早于 exp include(双 XML) |
| `tests/lc_p4_partition.test.js` | **新护栏**(入 `run-tests.js` 清单,26→27):① 边界(核心无 EXP 横幅/探针文件有/行数域);② LCTNS 双向对账(核心发布 ⊇ 探针导入;探针导入 ⊆ 核心顶层声明;6 派发入口探针侧全发布);③ include 顺序;④ 探针区纯度(无 boot/exportGlobal/VERSION —— 防再混入) |
| `docs/compatibility.md` | §1 P4 授权状态、§4/§7 变更清单 |

## 5. 验证计划(结果见 §6)

1. `node --check` 双文件
2. 27/27 护栏(停桥 → checkout quickchat → 跑 → 拉桥)
3. simtest(双文件装载,翻译链回归)
4. `build.ps1` 编 VPK → 抠包核验(vpkedit 文件树:exp vjs_c 在;主 vjs_c 不含 EXP 横幅)
5. 装车 + 游戏冒烟:loaded 自报、boot synced、翻译链 E2E、**实弹一条 `/bt*` 命令走通晚绑定链路**(核心 expCall → LCTNS → 探针 → 日志回显)
6. 回滚路径:单 commit revert + `install_when_closed.ps1` 装回上一 VPK(备份 `bak-pre-targethero-*` 在)

## 6. 验证结果

(执行后回填)

## 7. P4b 全量分区为何不做(证据)

- 核心 18 分区互相咬合:State/状态机/队列/扫描/面板共享数百个顶层符号,全量切分 = 每个模块一份导入/发布接线 + 8 个护栏改路径 + simtest 多文件装载重排,diff 量级与回归风险远超"每版一种主要风险"预算
- 分区机制本轮已跑通(LCTNS + 顺序装载 + 双向对账护栏 + 构建链),后续按真实需求(某区独立变更/独立测试)增量再切,每次复用同一管线
