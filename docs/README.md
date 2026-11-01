# Babel Tower 技术文档索引

> 本页是 `docs/` 的**唯一入口**:谁该读哪篇、每篇的可信度、冲突时以谁为准。
> 新增或改稿后**必须同步本页表格**;版本口径以 GitHub Releases 为准。

## 0. 怎么读(三条路径)

| 你是 | 读这几篇 | 预计 |
| --- | --- | --- |
| **第一次接触项目** | 本页 → [architecture.md](architecture.md) → [routes-comparison.md](routes-comparison.md) | 30 分钟 |
| **要改代码** | [development.md](development.md) → [compatibility.md](compatibility.md) §1(冻结清单) → [risk_register.md](risk_register.md) | 20 分钟 |
| **用户报障** | [debugging.md](debugging.md) → [development.md](development.md) §2(冒烟清单) | 按需 |

## 1. 状态图例

| 标记 | 含义 | 维护义务 |
| --- | --- | --- |
| **现行** | 描述当前发布版本的真实行为,可直接引用 | 行为变更必须同步改 |
| **冻结** | 协议/规格已冻结,改动需独立授权 | 只允许追加"变更记录",不改定义 |
| **决策** | 记录"为什么这么选",含取舍与回退触发器 | 决策变化时新增一节,不覆盖旧节 |
| **追加式** | 按版本窗口往后追加,历史行不改 | 每次发版/引擎更新追加一行 |
| **历史** | 已完成/已过期的实验与评审,只作追溯 | 不再更新;新结论写进现行文档 |
| **已完成** | 一次性任务书,产出已归档 | 不再更新 |

> **已撤回的结论不留在正文**——统一登记在 [CORRECTIONS.md](CORRECTIONS.md)。
> 正文里出现"以前说…其实…"式段落,视为违规,应移到纠错账本。

## 2. 文档总表

### 2.1 规范与总览

| 文件 | 主题 | 状态 | 版本锚点 | 关键结论 / 用途 |
| --- | --- | --- | --- | --- |
| [architecture.md](architecture.md) | 进程拓扑、三条通信通道、桥端点、翻译服务商协议 | 现行 | 1.2.5 | 系统怎么跑;读代码前先读 |
| [btipc-v1.md](btipc-v1.md) | BTIPC 位泵协议(帧格式/状态机/参数/验收) | **冻结** | 2026-10-02 | 协议定义,改动需授权 |
| [btipc-https-v1.md](btipc-https-v1.md) | https 面板通道:拓扑、选路、排障、标签通道行为、配置差分、再评估 | 现行 | 1.2.5 | 通道①的全部细节与来源对账 |

### 2.2 路线与决策

| 文件 | 主题 | 状态 | 版本锚点 | 关键结论 / 用途 |
| --- | --- | --- | --- | --- |
| [routes-comparison.md](routes-comparison.md) | 四条路线总对照 + 分层模型 + 触发器 | 现行 | 2026-11-01 修订 | 选型总表;冲突时以 [cef-cost-decision.md](cef-cost-decision.md) 为准 |
| [cef-cost-decision.md](cef-cost-decision.md) | 部署形态与成本决策(①本机桥 / ③纯托管 / ③′公网中继) | **决策** | 2026-11-01 | **默认形态 = ③ 纯托管页**;回退触发器在 §6 |

### 2.3 运维与质量

| 文件 | 主题 | 状态 | 版本锚点 | 关键结论 / 用途 |
| --- | --- | --- | --- | --- |
| [development.md](development.md) | 构建、冒烟测试、本地测试、署名约定、FAQ | 现行 | 1.2.5 | 开发日常;§4.5 注释纪律必读 |
| [debugging.md](debugging.md) | 用户侧排障:桥在不在、日志在哪、怎么报 Bug | 现行 | 1.2.5 | 面向用户;提 Issue 前的自查 |
| [compatibility.md](compatibility.md) | 冻结清单、解冻边界、版本窗口快照、已知问题 | 追加式 | 1.2.5 | 发版前核对;§1 决定"能不能动这个文件" |
| [risk_register.md](risk_register.md) | 维护控制基线:工作项性质/风险/状态/授权范围 | 追加式 | 1.2.5 | 高风险改动的前置门 |

### 2.4 历史存档(只作追溯,不再更新)

| 文件 | 主题 | 状态 | 归档原因 |
| --- | --- | --- | --- |
| [panorama-api-census-6726.md](panorama-api-census-6726.md) | 6726 版 Panorama 接口普查(读文本/对外通信全表) | 历史 | 版本快照;其中"对外通道"结论已被 2026-11-01 公网页验证扩展 |
| [ipc-checklist-6726.md](ipc-checklist-6726.md) | exp6727~btipc13 全量实验记录(1170+ 行) | 历史 | 一手实验日志;新实验另开文档,不回改此篇 |
| [ipc-downlink-benchmark-6734D.md](ipc-downlink-benchmark-6734D.md) | 下行吞吐基准(D 组) | 历史 | 协议定参依据,数据仍有效,不再复跑 |
| [ipc-multivalue-benchmark-6734E.md](ipc-multivalue-benchmark-6734E.md) | 单面板多值符号判别(E 组) | 历史 | 结论已进 BTIPC v1 参数表 |
| [ipc-btipc07.md](ipc-btipc07.md) | health/gamenames/quickchat 迁 BTIPC 的设计 | 历史 | 已落地(btipc07),实现为准 |
| [p4-partition-review.md](p4-partition-review.md) | P4a 探针分家 / P4b 未采纳的证据 | 历史 | 评审已结案 |
| [poc_bridgeless_cef.md](poc_bridgeless_cef.md) | 无桥 POC 任务书 | 已完成 | 产出见 [../poc/RESULTS.md](../poc/RESULTS.md) |

### 2.5 纠错

| 文件 | 主题 | 状态 | 用途 |
| --- | --- | --- | --- |
| [CORRECTIONS.md](CORRECTIONS.md) | 已撤回 / 已降级 / 待复核结论账本 | 现行 | 查"这条结论现在还作不作数";新纠错必须登记在此 |

## 3. 冲突时以谁为准(事实源优先级)

```
cef-cost-decision.md   (部署形态的最终决议)
  > routes-comparison.md   (路线总表)
    > architecture.md      (当前 1.2.5 的实现事实)
      > btipc-https-v1.md / btipc-v1.md   (通道细节)
        > compatibility.md / risk_register.md   (窗口与授权,不定义行为)
          > 历史存档
```

## 4. 维护规则

1. **每篇 H1 下必须有状态块**(五个字段):
   ```
   > **状态**:现行 | 冻结 | 决策 | 追加式 | 历史 | 已完成
   > **适用版本**:1.2.x(协议类写冻结日期)
   > **最后核对**:YYYY-MM-DD
   > **上游/证据**:指向实测日志、POC、外部发行包或本仓提交
   > **一句话**:这篇负责什么
   ```
2. **改结论走三步**:① 在 [CORRECTIONS.md](CORRECTIONS.md) 登记(原结论 → 证据 → 现结论);
   ② 正文**直接改写为新结论**(不保留删除线、不写"以前说…");
   ③ 同步本页索引与所有引用该结论的文档。
3. **未验证的不要写成结论**:标 `待复核` 并进 CORRECTIONS 的待复核表;禁止用"可能/据传"充当事实。
4. **每次引擎更新**跑 POC 的 S1/S2/S4(见 [../poc/RESULTS.md](../poc/RESULTS.md) §附),
   结果回填 `compatibility.md` 的窗口快照与 `risk_register.md`。
5. **每次发版**:更新 `development.md` §1 的发布状态、`compatibility.md` 追加窗口行、
   本页"适用版本";随包 Node 版本必须写进 release 记录。
6. **链接约定**:文档之间用相对路径;跨目录用 `../`;章节引用写 `§N`,标题文字改动时同步全局引用。
7. **改完跑一遍文档体检**(零依赖,死链/缺元数据/漏索引都会红):
   ```powershell
   .\portable-node\node.exe scripts\check_docs.js
   ```

## 5. 术语表

| 术语 | 含义 |
| --- | --- |
| 桥 / 本地桥 | `core/bridge_server.js`(8791)+ `core/bridge_https.js`(8792)两个本机进程 |
| 面板 / CEF 面板 | Panorama 里的隐藏 `HTML` 面板,承载页面 JS,是游戏唯一的联网出口 |
| 通道 ① | https 面板(本机自签证书,页面同源调桥) |
| 通道 ② | BTIPC:console.log 上行 + 128×Image 位信号下行(零证书/零 JS) |
| 通道 ③ | 纯 CEF 无桥:公网托管页直接加载,页面直调 provider(零证书/零本机进程) |
| 通道 ③′ | 公网同源中继:③ 的页面 + 我们运营的代理(可选增强,非默认) |
| 通道 ④ | OCR 截屏识别(获取层灾备,未采用) |
| 免 Key 上游 | `edge.microsoft.com/translate/translatetext`(与现状桥同一上游) |
