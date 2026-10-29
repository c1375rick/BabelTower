# Deadlock 模组逆向研究：Deadlock Radio v2 + QOL Lock 4.0.5

> 来源：F:\ai控制音频 工作区（2026-10-29 分析完成）。
> 目的：为"玩家自选条件→音乐"的自定义 BGM 模组提供技术依据；对 BabelTower 的价值集中在 **CEF 桥（持久化/IO）** 与 **条件信号清单**。
> 研究过程与更多背景（雨爱切片架构、HUD 信号盘点、panorama API 边界）在原工作区 `F:\ai控制音频\analysis\01~09`。

## 文件索引

| 路径 | 内容 |
| --- | --- |
| `08_DeadlockRadio拆解与可配置BGM方案.md` | Radio v2 完整拆解（848 行）：CEF 播放器架构、桥协议、音频源、设置持久化、条件→音乐方案设计 |
| `09_QOL405存储桥与CEF持久化对比.md` | QOL 4.0.5 存储桥拆解 + 与 Radio 的桥选型对比 + 可复用协议清单 |
| `radio_v2_decompiled\` | Radio v2 反编译产物（主脚本 3387 行 JS、CSS、base_hud.xml、SVG 图标） |
| `radio_v2_source\pak05_dir.vpk` | Radio v2 原始 VPK（212KB，GameBanana mod 720163） |
| `qol405_decompiled\` | QOL Lock 4.0.5 反编译产物（core\ 17 个模块 + manifests\ + layout\ + styles\，不含 node_modules 构建残留） |
| QOL 4.0.5 原始 VPK | 未拷贝（27.9MB），在 `F:\ai控制音频\qollock_405_extract\pak03_dir.vpk` |

## 对 BabelTower 最重要的 5 个结论

1. **本游戏唯一可用的持久化通道 = CEF 内嵌面板**（`CitadelHTMLPanel` + `SetURL` + `$.RegisterEventHandler("HTMLTitle", ...)`）。两个独立模组（Radio、QOL 4.0.5）各自发现并采用；QOL 4.0.5 已删除旧版"借 Airheart 构筑名存配置"的重方案。
2. **桥协议两家已收敛**：请求走 `SetURL(url + "#" + encodeURIComponent(JSON))`（URL 片段），响应走 `document.title`（同步写）。QOL 版协议更健壮：`_seq` 去重、1500 字符分片、`frag1` 握手、reqId 计数器+时间戳、串行队列 + 5s 超时 + 看门狗。**推荐抄 QOL 协议 + Radio 的本地 file:// 宿主**（零外部站点依赖）。
3. **`javascript:` 注入可能已被 2026-10-01 游戏更新削弱**——QOL 的 bridge.html 注释明确"适配 10-01 更新、放弃 javascript: 改用 URL 片段"。Radio v2 用的正是 javascript: 路径，需实测是否仍可用；新实现优先 URL 片段方案。
4. **CEF 是游戏一等公民但未经官方担保**：游戏自己只在"看新闻"弹窗用过；Linux/Proton 会崩；CEF 音频不进游戏混音总线；DRM 流（Spotify 等）不可放。**持久化在 Linux 上无解**（两家模组都依赖 CEF）。
5. **条件信号可直接抄 Radio 的实测清单**（比纯静态分析更硬）：`InCombatAlert`→祖先 `.inCombat`、`damage_meter`→`.out_of_combat`、`gameplay_hud_alive.visible`、`AbilitiesContainer` 的 `gScoreboardOpen/gShopOpen/gDetailView/gItemDraftOpen/gEditingBuilds`、`EscapeMenu`→`ShowEscapeMenu`、帧时间切出检测。

## 与 BabelTower 现有认知的关系

- LEARNINGS 中"LCT 自己有持久化(convar+面板属性)"与本研究的结论一致：**convar 可写不可读、面板属性会话级**——跨重启只有 CEF 一条路。
- DMM 槽位/管理器经验（LEARNINGS 2026-09-25）同样适用于这两个模组的安装分析；Radio/QOL 都是覆盖 `base_hud.vxml_c` 的全量替换式挂载，与其它 mod 同名文件冲突的排查流程（vpkeditcli --file-tree 扫描）可直接复用。

## 关键代码定位（radio_v2_decompiled\panorama\scripts\custom\dlmusic_main_v1_2.js）

| 功能 | 行区间 |
| --- | --- |
| CEF 面板创建 + HTMLTitle 注册 | L859-L907 |
| ExecCEF（javascript: 注入入口） | L1052-L1055 |
| 桥骨架（title 劫持/队列/ack/重传） | L1078-L1243 |
| YouTube 桥 / 本地文件夹桥 | L1310-L1494 / L1496-L1669 |
| 看门狗 | L1737-L1751 |
| 消息分发（26 种） | L1754-L1884 |
| 战斗检测 + 音量 ducking | L1899-L1967 |
| 切出检测（帧时间） | L1969-L2012 |
| HUD 隐藏条件 | L2014-L2065 |

## 关键代码定位（qol405_decompiled\panorama\scripts\core\）

| 文件 | 职责 |
| --- | --- |
| `ql_storage_bridge.js`（28KB） | CEF 存储桥全部实现（握手/分片/去重/超时/面板重建） |
| `ql_persistence.js` | 面板属性同步（会话级，非持久化） |
| `ql_config_store.js` | Schema 校验 |
| `ql_config_adapter.js` | 334 键 → 新 bucket 迁移 |
| `ql_codec.js` | v2 wire 编解码 |
