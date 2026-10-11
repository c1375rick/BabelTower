# 兼容性与解冻边界(Compatibility & Unfreeze Boundary)

> 建立:2026-10-10(1.0.10 窗口,P0 基线存档)。
> 目的:每个发版窗口记录「游戏构建 × 桥版本 × 协议状态 × 回归结果」的可比对快照;
> 同时承载**冻结清单**与**解冻流程** —— 架构工程(P1-P3)与后续评审均以本文件为基线。
> 版本口径继承 `docs/ipc-checklist-6726.md` §16.7。

---

## 1. 冻结清单(决策 2026-10-10;显式路径,不使用通配符)

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
- **P4(lingua_chat 分区解冻)当前不授权**,记为待评审事项,1.1.0 窗口凭证据单独决策。
  若问题能在冻结边界外解决,继续保持冻结。

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
- P4 `lingua_chat.js` 分区:1.1.0 单独评审(见 §1)。

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
