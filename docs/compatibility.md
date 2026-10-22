# 兼容性与解冻边界(Compatibility & Unfreeze Boundary)

> 建立:2026-10-10(1.0.10 窗口,P0 基线存档)。
> 目的:每个发版窗口记录「游戏构建 × 桥版本 × 协议状态 × 回归结果」的可比对快照;
> 同时承载**冻结清单**与**解冻流程** —— 架构工程(P1-P3)与后续评审均以本文件为基线。
> 版本口径继承 `docs/ipc-checklist-6726.md` §16.7。

---

## 1. 冻结清单(决策 2026-10-10;显式路径,不使用通配符)

> 2026-10-12 起,五项工作项的性质/风险/状态/**解冻范围**与验收标准统一登记于 `docs/risk_register.md`(控制基线);本节仍为冻结文件的权威清单。

以下四个文件为**协议冻结区**,只审不改 —— 不改协议、重试、分帧、校验逻辑:

1. `core/btipc/crc16.js`
2. `core/btipc/framer.js`
3. `core/btipc/transport.js`
4. `core/btipc/window.js`

### 经批准可动的相邻面(1.0.10 起)

| 范围 | 权限 | 约束 |
|---|---|---|
| `core/btipc/index.js` | 允许**新增** | 只做统一导出;不得改变既有导出语义,须与旧调用方实际用法**逐项核对** |
| `core/transport/` | 允许**新增** | 只做适配与接口隔离,不承载业务逻辑 |
| `core/bridge_server.js` | 允许改 `require` 路径 | 不借机重构业务逻辑 |
| 既有协议文档 | 原则上冻结 | 只允许勘误,不变更协议语义 |

### 红线

- **适配器不得绕改冻结模块行为**。发现 BTIPC 内部缺陷 → 记为独立问题 + 提交解冻申请;
  禁止把内部行为"顺手修在适配层"再当成普通重构。
- 解冻申请须附:① 冻结模块已知缺陷清单;② 当前版本测试结果;③ 无法通过适配层解决的证据;
  ④ 具体文件/函数/行为;⑤ 协议兼容性与回滚路径评估。
- **P4(lingua_chat 分区)已执行 P4a(2026-10-12 用户授权)**:EXP6727~6738 探针区(2,124 行,28%)
  纯搬移至 `lingua_chat_exp.js`,核心 7,583→5,505 行;证据/设计/验证见 `docs/p4-partition-review.md`;
  契约钉 `lc_p4_partition`(LCTNS 双向对账/装载顺序/晚绑定/边界)。P4b(核心再分区)未授权,凭证据增量另议。

---

## 2. 版本口径(继承 §16.7)

| 位置 | 含义 | 同步铁律 |
|---|---|---|
| `lingua_chat.js` 的 `const VERSION` | 打进 pak 的版本串(玩家日志 `loaded …`) | 形式 `/^\d+\.\d+\.\d+-6726-btipc\d/` |
| `VERSION` 文件 | 发布号 | 与 `const VERSION` 主版本**两处必须同步改**,否则 `lc_btipc_guard` 红 |
| GitHub Release tag | 已发布版 | `v<VERSION>` |
| GameBanana 全局版本 / 文件行版本 | 已发布版 | 与 README L15 三处一致 |
| `README.md` L15 | `> 版本:x.y.z (日期)` | 升版须一并改 |

---

## 3. 窗口快照(每发版追加一行)

| 日期 | 版本 | 游戏构建 | 桥协议 | 全量测试 | 游戏内回归 | 备注 |
|---|---|---|---|---|---|---|
| 2026-10-09 | 1.0.9 | 6726 | btipc07d | 22/22 | 全绿(config×3 / quickchat delta 734 / health echo / 面板开关 / 零 JS 错 / CRC 噪声自愈 / STORM·busy requeue 实拍 / 僵尸组 E2E / EXP8 不吞消息) | 首记(补录) |
| 2026-10-10 | 1.0.10 | 6726 | btipc07d(冻结;仅 transport.js 注释勘误,零语义改动) | 24/24(统一入口) | **全绿**(§5 五项 + 僵尸组 E2E,见下) | B1 + F6 + P0-2 + 测试基建 |

---

## 4. 1.0.10 窗口变更清单

**B1(安全;桥侧,游戏内取证后落地)**
- 删除 `GET /api/v1/config?d=` 无鉴权写通道 → 显式 `410 config_write_removed_use_post_or_op_config`;
- 删除 `bodyFromRequest` 的 `?d=<JSON>` 请求体解析(translate/test/log 的 GET 写面一并消失);
- 新增跨站守卫 `crossSiteBlockReason` + `applyCors`,挂在 `requestHandler` 早于一切路由:
  ① Host 非回环前缀 → 拒(DNS rebinding);② 带浏览器元数据但非同源 → 拒(恶意网页);
  ③ 零元数据 → 放行(与 REQHDR 实测的游戏行为一致);
- `Access-Control-Allow-Origin: *`(10 处)收敛为 `applyCors` 仅回显本地同源 Origin。
- 活体验证:410 / evil Origin 403 / cross-site 403 / 本地 Origin 200+回显 / 游戏形态 200 无 ACAO,5/5 过;
  桥日志仅攻击探针被 `B1 blocked`,零误伤。

**F6(游戏侧;Panorama 实测后落地)**
- 实测 `clearTimeout`/`setTimeout` 在当前 Panorama **双双 undefined**,`$.Schedule` 句柄裸调
  `clearTimeout` 是无效空操作 → 取消失败 → 20s 晚到回调双 `finishJob` → 槽位超发;
- 修复:新增 `cancelSched(h)` 助手,主调官方取消器 `$.CancelScheduled`(diag-globals 枚举证实存在),
  `clearTimeout` 作双保险;旧通道超时取消点全部改走它;
- `ctprobe-v2`:游戏内探针验证 `CancelScheduled` 语义(1.6s 应取消,3.6s 报 CANCELLED/FIRED)。

**P0-2(上轮,已游戏内 E2E 实证)**
- `doneFail` chat 分支改走 `deliverError` + `!settled` 守卫(替代 undefined `job.done`);
- `pumpQueue` 丢弃分支同因补 `deliverError`;settle 全量留痕日志(`settle chat group err=…`)。

**测试基建(决策 2026-10-10)**
- 统一入口 `tests/run-tests.js`:**显式文件清单**(不用 glob),旧平文件 assert 保留,
  新测试可用 `node:test`;`package.json` 挂 `npm test`;
- 新护栏:`security_boundary_guard`(9 断言,B1 三闸 + ACAO + 回环 + mask)、
  `lc_chat_settle_guard`(20 断言,P0-2 + F6)、`build.ps1` 内 `node --check` 构建护栏。

**明确不做(等评审)**
- B6 原子写(`core/config.js` 保存):未获本窗授权,留保护名单;
- P4 `lingua_chat.js` 分区:P4a(探针区分家)已于 2026-10-12 执行(见 §8);P4b 核心再分区未授权。

---

## 5. 游戏内冒烟剧本(装车后复跑)— 2026-10-10 实测全绿

1. ✓ 启动游戏 → `loaded v1.0.10-6726-btipc07d`(10:01:22)+ `boot: config synced from bridge (outgoing=bilingual, translateOwn=true)`(10:02:46);
2. ✓ 开面板 → `test btipc: ok win=8f301b dt=4318ms` + 底部 X `close clicked`(10:05:55);
3. ✓ 打字翻译 → 出站 `outgoing btipc: ok`、入站 `translated [队伍] …你好`(10:05:37)、复活后 `translated [队伍] …僵尸二号`(10:19:59);
4. ✓ 停桥 → `chat btipc: FAIL kind=timeout 15000ms` + **`settle chat group err=timeout text=zombie one`** 留痕命中 → 出站 FAIL 20s 优雅回退发原文 → 拉桥 → 回声 `DONE frames=1 ≈1.8s` 全干净 → 新消息复活翻译(僵尸组 E2E 闭环);
5. ✓ 桥日志 `B1 blocked` 全程仅 2 条=人工攻击探针(零误伤);游戏 console `JS ERROR` 0 条;
6. ✓ F6:`ctprobe2: CANCELLED (CancelScheduled 生效)`(10:01:22,修复机制游戏内实证);ctprobe 复现旧环境 `clearTimeout 不能取消 + typeof undefined`。
   - 附:出站曾于 CRC 噪声风暴期 `FAIL kind=timeout 20000ms -> send original` 优雅回退(10:05:31),与基线"噪声自愈"同貌,风暴后 echo 恢复干净。

## 6. 已知问题登记

| ID | 现象 | 状态 |
|---|---|---|
| 幽灵异常 | `pumpQueue dispatchJob(job)` 调用点空消息抛出,两 catch 未留痕(引擎行号=编译行−4 已标定) | 间歇性,报告级;暂不改码,靠 settle 留痕 + 槽位健康观察 |
| `op=log` 聊天日志上传 | ~~仍走死面板通道,6726 起静默丢失~~ **已迁 BTIPC**(2026-10-11 P2:桥侧 `matchChatLogTrq` 首行识别 + `runBtipcOp` log 分支镜像旧端点语义;客户端并入 BTIPC op 通道 + 600B 切批;旧 `/api/v1/log` 端点保留未删)。**1.0.11 装车窗实车抓获并修复客户端路由漏点**:客户端 op 集合谓词写了 4 处(isOp/payload/viaBtipc 路由/dispatch-threw 兜底),前两处含 log 而 `dispatchJob` 的 viaBtipc 路由谓词漏补 → log op 不满足路由条件、落 `dispatchViaPanel` 死通道静默死(btipc08 起 11 天真实聊天日志从未落盘;E2E 直写 console.log 绕过客户端派发,故只验桥侧未暴露)。修复:2655 viaBtipc + 2631 兜底谓词补 log;新增 `op_log_guard` op 集合漂移护栏(凡 `config\|\|test` 谓词必须同步含 log) | ✅ E2E 4/4 + **真机实弹端到端**(17:36:11 `logs/chat/session_1791711175.jsonl` 落盘字段齐全,客户端 `log btipc: ok dt=7318ms`) |
| GET `/api/v1/translate?...` 零元数据 GET 付费面 | 旧浏览器(无 Sec-Fetch)残余面 | 残余风险接受(B1 主洞已堵);如需彻底可后续同样删除 |
| 对局中 BTIPC 回声间歇超时 + CRC RETRY/STORM | P4 冒烟实弹抓获(2026-10-12 17:09~17:11):对局 console.log 洪峰下 128 位组装丢位 → CRC 连败进风暴 → 回声 1 帧 8s 死线先到 → timeout 误判掉线;取证:上行 REQ 32/32、TRQ 11/11 全达桥(上行无撕行),翻译全成功 | **已加固(§11)**:风暴窗内 timeout/crc_dead 判拥塞不判掉线;CRC RETRY/STORM 自身按设计工作(~3s 自愈),常数不动 |

## 7. 桥侧收口审计(P1-P3 完成,2026-10-11;1.0.11 窗口变更清单底稿)

### 7.1 耦合面(审计结论:干净)

- `core/` 生产代码对冻结件 `core/btipc/{crc16,framer,transport,window}.js` 的 require:**仅剩
  `core/btipc/index.js` 与 `core/transport/game_channel.js` 两处**(桥业务只见 GameChannel)。
  `bridge_server.js`/`sync_data.js` 仅注释提及,零直连。护栏:`index_surface_guard` 6 断言 + `op_log_guard`。
- 冻结四件自 2026-10-10 起**零语义改动**;TRQ 信封白名单仍 `op=config|test`(行为钉:`op_log_guard` 第 1 项)。

### 7.2 桥侧 HTTP/TRQ 端点面(P3 清点;均回环监听 + B1 三闸/ACAO 收敛覆盖)

| 面 | 端点 | 状态 |
|---|---|---|
| TRQ op 通道 | `op=config` / `op=test` / `op=log`(P2 新增) | 主力;6726 后游戏侧全走此路 |
| BTIPC 下行 | `GET /btipc/dl` | 主力 |
| HTTP API | `/api/v1/{health,gamenames,quickchat,config,translate,test,log,version-check}` | `/api/v1/log` 与 TRQ op=log 双入口同语义(保留);`?d=` 写通道已 410(B1) |
| 面板/探针遗留 | `/bridge`,`/probe*`,`/dim.png`,`/test.png`,`/redir302`,`/rdata` | S0 面板时代遗留,回环 + 三闸下风险接受;游戏侧不再依赖(面板通道已判死冷却),后续大版本可议删除 |

### 7.3 1.0.11 窗口变更清单(P1+P2;P3 为纯审计零改码)

| 项 | 内容 | 验证 |
|---|---|---|
| P1 | 新增 `core/btipc/index.js`(统一门)+ `core/transport/game_channel.js`(零逻辑壳);`bridge_server` 3 require + 12 处引用换址 | 契约钉 `index_surface_guard`(同源/行为等价/源码锁);25/25;新桥活体 health/config 200 |
| P2 | `op=log` 迁 BTIPC:桥侧首行识别 + `runBtipcOp` log 分支(镜像 `/api/v1/log` 语义);客户端并入 op 通道 + 600B 切批 + 成功续排 | 契约钉 `op_log_guard`(6 断言);活体 E2E 4/4(`scripts/btipc_op_log_e2e.js`);26/26 |
| P2 顺手修 | 05c 同类缺陷:`runBtipcOp` 形参 `body` 被 `let body` 遮蔽 + 引用不存在的 `text`(strict ReferenceError 被 catch 伪装成 bad_json)—— E2E 实车抓获,形参已进护栏断言 | 活体 E2E 复跑 4/4 |
| P2 实车修 | **viaBtipc 路由谓词漏 log**(2655)+ dispatch-threw 兜底漏 log(2631):op 集合谓词 4 处只补了 isOp/payload 两处,路由处漏 → log op 落死通道静默丢。E2E 直写 console.log 绕过客户端派发故未暴露;装车窗打字实弹抓获。护栏:`op_log_guard` 新增 op 集合漂移钉(凡 `config\|\|test` 谓词必须同步含 log);`lc_btipc07_guard` viaBtipc 断言放宽为「恰好多一个受控例外 log」 | 26/26;真机实弹落盘 `session_1791711175.jsonl` |
| 僵尸组演练(1.0.11 实车) | 停桥:翻译作业 20s 超时 → `FAIL kind=timeout -> send original` settle 留痕 + 游戏内失败提示,聊天不卡死;拉桥:回声 15s 内自动判活,下一条消息翻译恢复(`chat btipc: ok`) | 游戏内实弹三步全过 |

---

## 8. P4a 探针区分家(1.1.0 窗口;2026-10-12)

| 项 | 内容 |
|---|---|
| 变更 | `lingua_chat.js` EXP6727~6738 探针区(2,124 行,28%)纯搬移 → `lingua_chat_exp.js`(自有 IIFE);核心 7,583→5,505 行;6 处 /bt* 派发改 `expCall` 晚绑定(探针文件缺失/异常降级无操作);`expErr` 移入核心工具区;settle/boot 路径零变化 |
| 接线 | 核心尾部发布 `globalThis.LCTNS`(27 绑定,与探针头部别名导入同一份计算生成);chat.xml/hudchat.xml 主脚本后 include 探针;simtest 双文件 require;build VPK 关键资产 +exp |
| 护栏 | 新 `tests/lc_p4_partition.test.js`(入清单,26→27):边界/LCTNS 双向对账/6 派发入口/装载与构建链/晚绑定 |
| 验证 | 27/27 首轮全绿;simtest 41/27 与 HEAD 基线同环境完全一致(既有 harness TRQ 回程缺口,非回归);build 8 文件;编译产物核验 core 零实验区残留/exp 横幅齐;装车 slot==dist(3A26F6A6…) |
| 证据 | `docs/p4-partition-review.md`(耦合量化 6+27/机制先例/纯搬移保证/回滚路径) |

---

## 9. B6 原子写(1.1.0 窗口;2026-10-12)

| 项 | 内容 |
|---|---|
| 问题 | `core/config.js` 两处落盘(save + load 首次自动生成)直 `writeFileSync` → 断电/崩溃留半截 config.json;load 损坏回退默认值 = 用户 API Key/偏好整段丢失(回退兜底救不了数据) |
| 变更 | 新 `writeFileAtomic(file, data)`:同目录 tmp 写入 → `fsyncSync` → `renameSync` 覆盖(Windows libuv = MoveFileEx REPLACE_EXISTING,同卷原子);rename 失败(目标被占用 EPERM 类)降级直写保保存成功底线;失败路径清 tmp。两处落盘全部换用 |
| 授权面 | B6 记录面 = `core/config.js`。同类相邻面**只登记不动**:`core/dictionary.js`(322 全量重写,带 .bak 兜底)、`core/name_protect.js`(CONFIG_PATH 写);append 型日志写不在半截危害类 |
| 护栏 | 新 `tests/config_atomic_write.test.js`(入清单,27→28):①源码钉(零直写 configPath,恰好 2 处 atomic)②实现钉(tmp+fsync+rename+降级+清 tmp)③沙箱功能(新建/覆盖无残留/stale tmp 收走)③b 降级底线(rename 注入 EPERM 保存仍成功) |
| 验证 | 28/28 首轮全绿;真实路径冒烟:桥重启 health 200 → POST `/api/v1/config {config:{}}` 纯重写 → 值 before/after 递归深等(零语义变更零丢值)、无 .tmp 残留 |

---

## 10. simtest TRQ 回程补齐(1.1.0 窗口;2026-10-12;纯测试基建,零产品码)

| 项 | 内容 |
|---|---|
| 问题 | `scripts/lingua_chat_simtest.js` 长期 41/27(与 P4 分家正交,HEAD 基线同败),27 败全是翻译类场景 0 标签;桥侧取证:sim 时段零条 translate TRQ —— 请求根本没发出来 |
| 根因①(回程串行饿死,主因) | boot 的 `op=config` 是 BTIPC 单槽首个在途作业(38 帧 × ~600ms ≈ 24s 实测),场景在同步完成前动作:入站 chat 只肯等 6×0.5s/12s → 掉死旧通道 settle → 0 标签;出站排队 >15s → 丢弃发原文 |
| 根因②(sync 冲配置) | 同步完成后 `syncBridgeConfig` 以桥端真机偏好覆盖场景配置(displayMode/outgoingTarget/force)→ translation_only 不折叠、出站英译英、中文免翻失守 |
| 根因③(陈旧断言) | test20 旧句式"我看到 McGinnis"已不在现行 loc(与 `tests/quickchat_match.test.js` 注释同口径:游戏不再产生的形态一律送翻译;语料指纹 fnv1a-197a3523 与兜底 fnv1a-f9ec2bc3 也印证换代) |
| 修法 | 纯 harness 三件:`waitBootSync(env)`(等 `State.cfgSynced` + 队列排空 + 无在途 + BTIPC 槽空闲,12 个翻译场景)+ `applyScenarioCfg(env)`(同步后场景配置回写 `State.cfg`)+ test20 换现行语料真模板 `Stun {s:hero_name}` → "Stun McGinnis"(纯拉丁+已知英雄参数,中文规则救不了,只有模板白名单命中才零标签;matcher 离线实证 SKIP)。另留 test3 失败态诊断快照钩子(仅失败时打印) |
| 验证 | run1(只修①)59/9 → run2(+②)64/4 → run3(+③)**68/0 exit=0**(361s);桥侧 translate TRQ 实证发出(chat ×11 + outgoing ×4,target=zh-Hans) |
| 口径 | simtest **不入** `run-tests.js` 清单(需实桥 + 真实翻译,与"停桥跑测试"铁律异环境),手动跑:`node scripts/lingua_chat_simtest.js`(桥须 8791 在线)。环境寿命 < 首个空闲健康 tick(≈32s) → echo→onBridgeAlive→quickchat 握手链在 sim 从不发生(登记为既有环境特性,非缺陷) |

---

## 11. transport 加固:回声拥塞豁免(1.1.0 窗口;2026-10-12;客户端判断逻辑,零协议改动)

| 项 | 内容 |
|---|---|
| 取证 | 对局窗 17:03-17:12 桥日志:上行 **100% 可靠**(REQ 32/32、TRQ 11/11 全达桥);CRC RETRY ×35、STORM ×20、echo FAIL ×3 **全部集中于对局洪峰**。死亡序列实证:17:09:36 回声 r=1 连败 ×2 → STORM enter(tClose=2500)→ 17:09:40 风暴轮 dt=2523 仍败 → 17:09:42 REQ_TIMEOUT(8s 死线先到)→ `echo FAIL kind=timeout` → onBridgeDown。同期翻译全成功(outgoing dt=6648ms 吸收风暴)——**拥塞不是掉线** |
| 危害链 | 误判 down → grace 过期 → `canHttp` 复位 → 死通道 nav 重探测(`diag-nav` ×N → `panel dead` 刷屏,现场 17:09:37-45 实证)——一个拥塞超时级联出整段垃圾 |
| 变更 | ① `State.btipcLastStormAt`:STORM enter 盖时间戳;② 回声 catch:`kind∈{timeout, crc_dead}` 且风暴发生在 `BTIPC_ECHO_STORM_WINDOW_MS(15000)` 内 → 降为拥塞日志 `...during congestion (recent storm), not treated as down`,**不调 onBridgeDown**;③ 真掉线(无近期风暴)路径原样不动 |
| 不动 | 8s 回声死线不拉长(单槽早释放给排队翻译——拉长会让排队 op 更易烧完 12s busy 预算掉死通道);STORM 常数不动(实测 ~3s 自愈,宽收口工作正常);`core/btipc/*` 冻结面零触碰 |
| 护栏 | 新 `tests/btipc_echo_storm_guard.test.js`(入清单,28→29):①状态钉(声明+STORM enter 盖章)②判断钉(豁免先于 onBridgeDown、分支 return、窗 ≥ 回声死线)③底线钉(死线仍 8000ms、真掉线日志+判红原样) |
| 验证 | 29/29 首轮全绿(停桥铁律)。**实弹完整验收(新车 sha 4EB39D6;2026-10-12 22:41 局 + 13 日 07:20 打字样本)**:① **6 次回声超时 6 次分类全对** —— 5 次风暴相邻全部豁免(23:11:37 / 23:22:14 / 23:27:12 / 23:31:56 / 07:21:31 `during congestion, not treated as down`,零 grace);1 次无风暴(22:52:11)正确走原判红路径 `grace started`;豁免实例含完整链(STORM → 8s 超时 → 豁免 → 5s 后 DONE 恢复)。② 3/3 链不丢不重不乱序(hello→你好 / test→测试 / push mid please→请推进中路,发送序 = 显示序)。③ 全场 10+ 次 STORM 全恢复,echo 102/102。④ E2E 打字实弹 3 链过;僵尸组演练经评审豁免(settle 路径零改动 + 1.0.10/1.0.11 两次实车已录)。观察项:22:50:28→22:52:18 95s 回声空窗(零 RETRY,形态似加载屏卡 JS 主线程,单次,已恢复) |


---

## 12. 脚本层加固:装车 / 重启桥 / 自启(1.1.0 窗口;2026-10-13;零产品码)

| 项 | 内容 |
|---|---|
| 起因 | 用户要求审查安装脚本与启动脚本。逐行审计 + 实机探针:2 个【中】风险 + 1 个**审查过程中新发现的自启致命 bug**(靠“重跑安装后与仓库生成物比对”暴露) |
| 装车原子性 | `Move-Item -Force`(PS 5.1 = 清属性+删+移,非原子,崩溃留空槽)换 **`[IO.File]::Replace`**(单次 ReplaceFileW = 原子换 + 旧车自动进备份,与 B6 同一套 tmp→原子提交纪律);探针实证三条边界:`Replace(src,dst,$null)` 抛“路径的形式不合法”(PS 把 $null 绑成空串,**必须传真实备份路径**)、只读目标抛 UnauthorizedAccess(须先清 ReadOnly)、目标不存在抛 FileNotFound(须 File.Move 分支)。另:备份改由交换本身产出(独立 Copy 可能与换入不同源)、交换瞬间复查游戏进程、外层 catch 让逃逸异常也落 ABORT 日志、日志加日期前缀、`-Tag` 默认由 `pre-targethero` 改 `install` |
| 重启不误报 | 旧行为:`Stop-Process` 失败被静默吞 + 新桥秒死时健康检查照打 → 拿到**旧实例的 200** 输出“重启完成 OK”,实际没换血。补:杀净复查(杀不掉即中止)、`$proc.HasExited` 验尸、并发 Mutex(**必须早于杀进程**,否则并发者互相杀掉对方刚启的桥)、健康通过后比对监听 PID;15s 死线改真死线(原 15×(1s+2s)=最坏 45s,注释是假的) |
| 端口读法 | `restart_bridge.ps1` / `bridge_health.ps1` 由“正则取全文第一个 port”改 `ConvertFrom-Json` 读顶层 `cfg.port`(与 `core/bridge_server.js` 的 `Number(cfg.port) || 8791` 同口径);现机 config 只有一个 port(实测),但嵌套 provider 端口排在前面即会读错 |
| 自启致命 bug | **`autostart.ps1` 模板里 `sh.Run` 行收尾是 5 个引号** —— VBScript 判为“未结束字符串常量”,整个 vbs **编译失败**(cscript 实证);仓库那份(4 个引号)是好的 ⇒ **每跑一次 `install-autostart.bat` 就把开机自启打坏**(Run 键在、登录时静默不起、零报错)。修模板 → 重新生成与生产在用文件零差异。另:缺 node 由“警告仍注册”改 `throw` 中止 |
| bat 入口 | `install-autostart.bat` / `remove-autostart.bat` 补 `if errorlevel 1`(原先失败也显示 “Done.”) |
| 护栏 | 新 `tests/script_hardening_guard.test.js`(入清单,29→30):①装车原子性(Replace/禁 Move-Item 覆盖/清只读/交换瞬间复查/File.Move 分支/外层 catch)②重启不误报(验尸/互斥/杀净复查/互斥早于杀进程)③端口 JSON 解析禁正则 + 顶层 port 存在 ④自启缺 node 中止 ④b **vbs 引号恰好 4 个**(模板与生成物双钉防复发)⑤bat errorlevel 可见 |
| 验证 | 30/30 首轮全绿(停桥铁律);实测:装车 exit=0(新旧 sha 一致、备份由 ReplaceFileW 产出、零 `.new`/`.swapbak` 残留)、restart_bridge 正常路径 OK + 并发互斥实测拦住第二个、autostart 重装 exit=0 且生成 vbs 与仓库零差异、cscript 实证 4 引号可用 / 5 引号语法错误 |

---

## 13. 环境迁移:游戏安装根 F:\(外置机械盘)→ C:\(NVMe)(2026-10-15;零产品码)

| 项 | 内容 |
|---|---|
| 起因 | 私人局反复"卡死→断开"。日志取证:断线全部是 `closed by peer (2029) NETWORK_DISCONNECT_TIMEDOUT`(签到 FULL 后精确 +29~30s 被对端掐)+ 断前 `high frame misdelivery` + `0ms ping` / `-1ms peak jitter`(回程测量缺失)。5 台不同服务器(同 51897 端口池)同死法 → 不是单台/单池故障。客户端侧同期指纹:`Audio device starved`(主循环停摆)、`Excessive frame time of 434.17ms clamped`、`Frame Time >17.5ms 46.5%`、翻译心跳往返(主线程停摆代理)峰值 **39.4 秒** |
| 根因 | 游戏装在 `F:\SteamLibrary\steamapps\common\Deadlock` = **WD Elements 2621 外置 USB 机械盘(SMR)**,游戏 98.54 GB / **170,890 个文件**;其中 `Reduced_CSDK_12` 138,821 + `CSwin64` 27,566 = 塞在游戏目录里的开发工具链死重(占 81% 文件数),游戏本体仅 4,440 文件 / 53.78 GB(327 个 ~100MB 分块 `pak01_XXX.vpk`)。切关卡/切局要在该盘上随机命中几百个分块 → 主线程停摆 4–40 秒,**超过 30 秒即被对端按 netchan 超时掐线**。反向排除:ICMP 到两个 SDR 继点 POP 0% 丢包 / 53–55ms,UDP 出口正常(8.8.8.8:53 有回包)→ 网络路径干净,VPN / ping 保活类方案不对症 |
| 处置①(死重外移) | `Reduced_CSDK_12` + `CSwin64` 移出游戏目录 → `F:\dev-tools\`(同卷改名;23ms / 70s)。游戏目录 **98.54 GB / 170,890 文件 → 55.63 GB / 4,504 文件**。CSDK 仍被发版构建使用,`scripts/release.ps1` 默认 `-Csdk12Root` 与 `docs/development.md`、`LEARNINGS.md` 命令行已同步。游戏目录另设 Windows 属性"内容不编入索引"(SearchIndexer 原在啃这 17 万文件) |
| 处置②(主体迁移) | Steam 内建"移动"把游戏迁至 `C:\SteamLibrary\steamapps\common\Deadlock`(NVMe BC901 512GB;独立库目录,同属 Steam)。**游戏根权威口径 = 环境变量 `DEADLOCK_ROOT`**(已 `setx` 持久化),仓内 12 处路径(装车 `install_when_closed.ps1`、6 个 e2e/探针脚本、`bridge_server.js` 兜底库列表、`game_names.js` 兜底、`line_budget_guard` 实测探针)统一改为「env 优先 + 新根兜底」 |
| 实测对照 | 关卡加载 `dl_hideout`:**13s(F:)→ 6s(C:,首次冷盘)**;主线程停摆代理(BTIPC 心跳往返):搬家前 平均 2.5s / 峰值 **39.4s** / 31 个 ≥2.5s 样本 → 暖机后**连续 6 次 1803–1825ms 基线、零尖刺**;帧时间:预热期 46.5% 帧 >17.5ms → 3 分钟内 **16.3%**(Avg Run 1.0,孤立单帧)。**私人局终验(2026-10-15 15:03–16:03,60 分钟)**:2 次远程 SDR 连接全稳定,**`2029` / `REMOTE_TIMEOUT` / `high frame misdelivery` / `Disconnection during connection` 四项全 0**;关卡加载暖态 **3s**(冷启 6s);全程 **0 次** 400ms 级单帧超时;心跳最近 8 次 1803–1812ms 基线,唯一长尖峰是开局冷启 **25.2s**(低于 30s 掐线线 ⇒ 不致断线;建议重启后首局避开远程私人局) |
| 副作用①(Steam) | Steam 搬运/校验会把 `game\citadel\gameinfo.gi` 与 `cfg\video.txt` **还原成原版**(实测 sha `CDDBD1B321023823`(OptiLock 装车值)→ `1037523D910F8FF2`(原版))。**切勿对 Deadlock 点"验证文件完整性"**,否则配置与 `*.bak-pre-optilock-*` 备份一并丢失;重装按 OptiLock 官方两步(源包永久件 `F:\download\星露谷mod\optilock_fps_configs_7a7bc.zip`) |
| 副作用②(DMM) | DMM 启停 mod 会**重写 gameinfo.gi**(两次实证:2026-10-14 22:42:58、2026-10-15 14:48:17,后者早于游戏启动 4 秒)。本次写入的是 GB 版 mod **OptiLock / QoL Lite(690233)自带**的 73.8 KB gameinfo(sha `F2DB5F02225EBB19`),与 zip 版 Recommended(75.8 KB)**不是同一构建,不得混用**。⇒「我装好的配置」≠「游戏实际跑的配置」,一律以 sha 复核归属 |
| 未完成/待办 | ① Defender 排除项(`Add-MpPreference -ExclusionPath "C:\SteamLibrary\steamapps\common\Deadlock"`)与 USB 选择性暂停关闭**需用户以管理员执行,尚未确认落地**;② OptiLock 现为**混搭态**(GB 版 gameinfo + 用户自有 video.txt:`mip_bias=1` / `viewportscale=0.667` / `upscaling=4`),官方要求两件成对,是否收敛待定;③ 私人局迁移后**已复测通过**(2026-10-15 15:03–16:03 两局,SDR 四项异常全 0,详见「实测对照」行);④ `F:\$RECYCLE.BIN` 堆 12.42 GB 可清(未清);⑤ F: 可用空间未如预期回收 55 GB(fsutil 确认仍 538.9 GB,SMR 删除回收延迟,非故障) |

## 14. addons 目录里并存两份 BabelTower(2026-10-15;零产品码)

| 项 | 内容 |
|---|---|
| 起因 | 做 https 面板通道的实机验证前,顺手按 `DlctBridge` 指纹扫 `addons\*.vpk`,发现**两份 BabelTower 同时装着**:`650634_pak04_dir.vpk`(247,963 B,2026-09-17 23:21)与 `pak15_dir.vpk`(496,790 B,本日)。两份都声明同一面板 id(`LCTBridgePanel`)与同一套 JS 入口 |
| 关键差别 | 旧包 `BTIPC` 标记命中 **0**、无 https 面板代码 —— 是 BTIPC 之前(该特性 2026-10-02 才进)的**旧快照**,几乎肯定是早期换装车命名时留下的手工残件(当前手工装车约定是无前缀 `pakNN_dir.vpk`) |
| 危害 | 不是"占地方",而是**制造假否定结论**:实机验证 https 面板时若旧包先加载,`https panel: ALIVE` 那行日志永不出现,会被误判成"证书路线不可行",而真实原因是装了一份没有该功能的旧代码。**实验环境里的无关变量会把结论归到被测对象上** —— 与 6739/6740 那两轮"全灭里混着打空"同一类错误 |
| 处置 | 改名为 `650634_pak04_dir.vpk.dup-20261015`(**不删,可逆**;sha 改名前后一致 `50935FD2E505C09D4AB4…`)。复扫确认**有效 `*.vpk` 里只剩 1 份**且带 BTIPC + https 面板代码 |
| 判定口径 | **认自己的包只能看内容标记**(`Babel Tower` / `LCTBridgePanel` / `BTIPC TRQ`),不能看文件名 —— 手工安装的 `pakNN_dir.vpk` 与 workshop 的 `<id>_pakNN_dir.vpk` 混在同一目录,名字完全不可靠。装车前固定先扫一遍 |
| 游戏资源完整性 | 本次只动 addon 目录,`game\citadel\gameinfo.gi`(sha `2d168be3d114301b03bb`)与 `pak01_dir.vpk`(sha `e449bce1eb96d293d673`)未触碰 |
| 遗留 | 该旧包是否曾属 Steam 订阅项未查(改名后 Steam 未重新下载,暂看不像订阅物);若日后它自己回来,说明是订阅项,需改用取消订阅或更新发布版,而不是继续改名 |
| **2026-10-22 更正 + 修好** | 上文"手工残件"的判断**只对了一半**:那份 247,963 B 的旧 BabelTower 内容确实来路不明,但**文件名 `650634_pak04_dir.vpk` 不是随手起的** —— 它是 **QOL Lock(mod 650634)的 pak04 槽位**,DMM 的"已禁用"命名约定正是 `<modid>_<原文件名>`(所以 `650634_pak05/pak11/pak15/pak16/pak47/pak67/pak68/pak92_dir.vpk` 都是它的禁用件,只有 pak04 被我们改了名)。改名 ⇒ DMM 清单 `.dmm.json` 的 `650634.disabledVpks` 指向一个不存在的文件 |
| 报错现象 | DMM 于 2026-10-22 更新(exe 06:24)后新增"备份必须自证一致"的校验:创建备份时先读回 staging 快照,逐条核对清单引用 ⇒ `backupCreationFailed: Created backup is inconsistent: Failed to restore backup: Mod is invalid: Manifest entry 650634 references missing VPKs: …\addons\650634_pak04_dir.vpk`。旧版 DMM 不校验,所以 10-15 改名后到 10-21 的备份一直没报(10-21 那份快照里同样只有 `.dup-20261015`) |
| 修法(2026-10-22 已执行) | ① 用 GameBanana 原档补回**正确内容**:`optional_announcer_slot1_seven_josefumivo.zip`(dl `1680726`,md5 `4fae5844…` 与 DMM 记录逐字节一致)→ 解出 `pak04_dir.vpk` 1,667,455 B(sha256 `27F677C0…`,与盘上 `pak09_dir.vpk` **同一份**)→ 放回 `650634_pak04_dir.vpk`;② 旧 BabelTower 残件改名 `babeltower-old-copy-20261015.bak`(不再以 `*_dir.vpk` 结尾 ⇒ 游戏不加载、清单不引用、仍可逆)。体检:`.dmm.json` 全量 **29 处文件引用 0 缺失** |
| 口径(新增) | **改 addons 里任何文件名之前,先查 `.dmm.json` 有没有引用它** —— DMM 认**文件名**,不认内容;它自己更新后还会校验清单与磁盘的一致性。反过来,`<modid>_pakNN_dir.vpk` 这种带前缀的名字 = 该 mod 处于**禁用**态(不会被游戏加载),手工装车用的无前缀 `pakNN_dir.vpk` 才是生效的 |
| 遗留(次要) | 盘上 `pak09_dir.vpk` 与 QOL 的 pak04 是同一份播报包(不同 mod 各占一个槽);QOL 现处禁用态,若日后启用会连带加载这 9 个件(含 47 MB pak47),启用前先确认优先级与 pak15 上的 BabelTower 不冲突 |

## 13. https 面板通道转正 + 保存修复 + 日志打码(1.2.0 窗口;2026-10-15)

| 项 | 内容 |
|---|---|
| **1. 新增通道并转正** | `core/bridge_https.js` 独立 TLS 终结进程(8792),证书缺失 exit 3、上游不通返 502 不退出;客户端开机探针定通道 + 硬/软失败分类 + 连击 3 次降级。**翻译下行从位泵 3.0–27.4s 降到 1s 以内**(服务端侧实测 55–76ms)。`core/btipc/*` 冻结面四件零改动;http 8791 永远保留 |
| **2. B1 跨站闸自伤** | 面板同源 fetch 带的 `https Origin` 不在白名单 → 翻译全线失败。改惰性 `isLocalOrigin()`(顺带踩到"模块级 const 在 PORT 之前求值 → ReferenceError 直接把桥搞崩") |
| **3. 翻译慢 8 秒** | 三层归因全部已修:① bing 命中 429 后内部睡「1s→2s→4s」共 7s 且不抛错 → 改短等一次并抛 `rateLimited`;② `fallbackProviders` 原为空 → 配 `google`;③ provider 的 `console.*` 接进 `logs/bridge.log`(桥是隐藏窗口启动,此前全部蒸发)。顺带修"是否需要 Key"硬编码 `pid !== "bing"` 导致同为免 Key 的 google 被误跳过 → 改 provider 自己声明 `requiresKey` |
| **4. 保存扩围到面板通道** | 用户反馈「OpenAI 的 API 老是保存不上」。根因纯算术:带 Key 载荷 ≈600B,位泵 10B/帧 → 61 帧 ≈ **38s**,而写死线只有 **8s**(死线按**应答** 1 帧定,没算上行 61 帧)→ 必然 `REQ_TIMEOUT`。同根因的 `op=log`(600B 批)与读配置(7.8–26s)一并接入。**代价:BTIPC 兜底那条路的 8s 写死线未动**(判死退回位泵时保存会照旧失败) |
| **5. 日志打码** | 保存载荷经 URL 查询串 `?d=` 带 Key 进来 → `core/bridge_https.js` 的 `redactUrl()` 与游戏侧 `diag-nav` **按值打码**,不靠截断长度(实测 Key 在第 ~132 字符而日志取 96 —— 那是算术余量,字段一变短就没了)。**BTIPC 侧**:上行 b64 是运输通道(`transport.js` 的 `REQ_RE` 从该行解析)不能改 → 改为桥抄进 `bridge.log` 时打码,协议侧仍收原样行 |
| **6. 证书信任实测** | 对照实验双向验证(撤销信任不重启 Steam 仍 `ALIVE` vs 完全退出 Steam 报 `not usable` + `TLS_ALERT_CERTIFICATE_UNKNOWN`)。结论:**游戏确实校验证书;信任缓存在 Steam 进程,只重启游戏无效;撤销信任同样要重启 Steam;不需要管理员** |
| **7. 版本口径** | `VERSION` / `lingua_chat.js const VERSION` / README 三处同步(**现为 1.2.2,开发中未发版**;已发布仍是 1.2.1)(README 版本行改版号时**另两处必须一起改**的护栏再次验证:只改一处→全链路红)。**构建标 btipc11**:BTIPC 请求语义变了(op=config 新增 `{"get":"configsync"}` **差分同步**,只传增删改不传全量),与 1.2.1 的 btipc10 线区分;`core/btipc/*` 零改动 |
| **8. 发行包补 VERSION** | 打包脚本只读 `VERSION` 命名 zip 从不拷它 → 1.0.9~1.2.0 **全部发行包都没有 VERSION** → 用户侧 health 恒报 `unknown`、version-check 的 `currentVersion` 恒为 `null`(而它是"有没有新版本"的比较基准)。已修并加进 `$requiredUserEntry`(缺一个拒绝出包)。**放错位置也踩一次**:拷贝放在断言之后 → 断言当场拦下出包 |
| **9. 测试入口加语法关** | 护栏只读源码做正则、不 require 产品模块 → `bridge_server.js` 正则语法错时**全链 33/33 全绿而桥起不来**。`tests/run-tests.js` 加**第 0 关**:对 19 个随包 JS 做 `node --check`,语法错直接红 |
| **护栏** | 新增 `https_panel_guard`(85 项)/`release_entry_guard`(73 项)/`log_redaction`(8 项);`run-tests.js` 显式清单登记(33 项,**全链 33/33**) |
| **发行** | `BabelTower-1.2.0-win64.zip` 35.4MB,sha256 `584875C8…`,56→57 条目(补 VERSION);冒烟通过;装车 pak15_dir.vpk 494888B(sha `7DA5CBB2…`)与包内 pak 一致;addons 扫内容标记确认仅此一份、无双载 |
| **版本口径表** | 1.1.0 → btipc08;**1.2.0 → btipc09**;**1.2.1 → btipc10**;**1.2.2(开发中) → btipc11** |

## 16. 随包 Node 运行时(1.2.2 开发中;2026-10-22 升级)

| 项 | 内容 |
|---|---|
| 随包运行时 | `portable-node/node.exe`(**不进 git**,`.gitignore` 第 17 行;只随发行包分发,用户不需要自装 Node)|
| 升级前 | v26.1.0(1.2.0 ~ 1.2.1 随包版本)|
| 升级后 | **v26.12.1**(官方 win-x64 zip,下载后按官方 `SHASUMS256.txt` 校验 `b3efd5c7…`)|
| 为什么升级 | Node.js 2026-10-21 发安全公告(26.12.1 / 24.22.1 / 22.23.4),修 4 条 high + 3 条 medium;我们随包的 26.1.0 落后 11 个补丁版|
| 本仓是否被波及 | **基本不波及**(逐条核对见 checklist §18.6):不触 dns.resolve / Brotli / ZipFile / Permission Model / crypto.randomUUID;真正沾边的只有 keep-alive 应答错配(medium)与 TLS 主机名校验(high,但需先攻破 DNS/hosts)|
| 依赖更新 | 随公告更新了 ca-cert(eMudhra Intermediate CA 被曝 compromised)、OpenSSL、c-ares、Undici → **出站 TLS 信任库一并翻新**|
| 升级后实测 | 全链 35/35 ✓;诊断脚本报 Node v26.12.1 ✓;http 8791 ✓、https 8792(TCP+TLS+HTTP 200)✓、出站 bing 翻译 ✓、api.github.com 版本检查 ✓、BTIPC 位泵 ✓|
| 发布影响 | **1.2.2 已发布**(GitHub `v1.2.2` @ `58ed2eb` = Latest;GameBanana 全局版本 1.2.2,文件 `File_1858768`,更新条目 `467168`)。**1.2.1 及更早的发行包随包仍是 26.1.0** —— 建议尽快升级 |
| 第二道护栏 | `core/tls_guard.js`:出站 TLS 走自定义 `checkServerIdentity` —— 主机名含 Unicode 点号 / 全角数字 / 非规范或十六进制 IP 写法时**明确失败并说清原因**,其余委托 Node 默认校验。5 个 provider + 桥的版本检查全部接上(`tests/tls_guard.test.js` 钉住接线)|
| 出包闸 | `scripts/package_release.ps1` 校验随包 Node 版本 **≥ 26.12.1**,低于就拒绝出包 —— `portable-node/` 在 .gitignore 里(版本不进 git log),不设闸就可能悄悄出个旧运行时|
