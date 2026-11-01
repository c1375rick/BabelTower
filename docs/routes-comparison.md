# Babel Tower 四路线总对照(2026-10-31 初版 / 2026-11-01 按 POC 修订,btipc13)

> **状态**:现行 · **适用版本**:1.2.5 · **最后核对**:2026-11-01
> **上游/证据**:真机 POC([../poc/RESULTS.md](../poc/RESULTS.md))、2026-10-30 实车日志、[cef-cost-decision.md](cef-cost-decision.md)
> **一句话**:四条路线的总对照与分层模型;选型冲突时以决策页为准。
> 已撤回结论("CORS 墙""Key 硬门槛"等)见 [CORRECTIONS.md](CORRECTIONS.md)。

> 四条候选路线的专门对比:**https 路线**(1.2.5 已发布主路 → 高级/离线模式)、**BTIPC 路线**(现状兜底)、
> **纯 CEF 无桥路线**(2026-11-01 改判为**默认形态**,见 [cef-cost-decision.md](cef-cost-decision.md))、
> **OCR 路线**(未采用,获取层替代)。
> 细节展开:[btipc-https-v1.md](btipc-https-v1.md) §11(纯 CEF 再评估)、§12(OCR 对照)、
> [btipc-v1.md](btipc-v1.md)(BTIPC 协议)、[references/09_QOL405存储桥与CEF持久化对比.md]
> (../references/09_QOL405存储桥与CEF持久化对比.md)(无桥模式的真实参照:QOL Lock)。

## 0. 一句话结论

- **现状(1.2.5 已发布)= ①+② 双通道**:https 首选(hash 1 RTT),BTIPC 兜底(机制隔离,10-29 唯一存活)。
- **③ 纯 CEF 无桥**:安装面最省、**零证书、零重启 Steam**、零本机进程。免 Key 的
  `edge.microsoft.com` 与 `mymemory` 直连可用(真机 CEF 已验证),Key 为可选增强。
  风险 = 免 Key 上游限流/协议变更、托管单点、无 `bridge.log` 诊断面。
  **2026-11-01 决议:默认部署形态(待落地)**;① 降为高级/离线模式。
  见 [cef-cost-decision.md](cef-cost-decision.md)。
- **④ OCR**:获取层与引擎完全解耦(10-29 对它无感),但无元数据、无自动出站、区域校准
  是工程债——**获取层灾备位**,触发器见 §5。
- 四条路不在同一层:③④ 换的是"页面从哪来/文本从哪来",①② 换的是"文本怎么搬运"。
  分层模型见 §6。

## 1. 路线 ①:https 路线(本地桥 + CEF HTML 面板)——**1.2.5 已发布主路 → 高级/离线模式**

**架构**:CEF 隐藏 HTML 面板(`CitadelHTMLPanel`)加载本地桥页面
(`https://localhost:8792`,CA 链证书);游戏 `SetURL`/fragment(hash)送请求,页面 JS 调
本地桥 `/api/*`,响应写 `document.title` → HTMLTitle 事件(面板绑定)回游戏。
获取层为 Panorama DOM(`scanChatMessages`),回显为聊天行内译文标签。

| 维度 | 评价 |
| --- | --- |
| 延迟 | 翻译 **1 RTT**(通道 ~0.1s + provider 外部);配置推送 <1s(watch);探针秒级(事件驱动) |
| 组件 | 本地桥双进程(Node,8791/8792)+ CA 链证书(启动器自愈)+ vpk(面板+DOM 抓取) |
| 服务端能力 | 免 Key Bing 中继、provider 故障切换、名称保护、词库/quickchat 重烘焙、`bridge.log` 全量诊断 |
| 失效模式 | 10-29 三连击全灭(证书执行/标题派发/JS 策略)——**btipc13 已全部修复**;未来引擎更新仍可能开新洞 |
| 用户安装面 | 证书首装需完全重启 Steam(信任库被 Steam 宿主缓存)——**GB 分发最大失败面** |
| 状态 | ✅ 1.2.5 已发布主路,实车 probing→ALIVE 同秒、当日 774 条翻译。**2026-11-01 决议:降为"高级 / 离线 / 隐私"模式**,不再作为默认安装路径(见 [cef-cost-decision.md](cef-cost-decision.md)) |

## 2. 路线 ②:BTIPC 路线(console.log 上行 + 128×Image 位信号下行)——**现状兜底**

**架构**:上行,游戏把请求写成文本帧进 `console.log`(`$.Msg`),桥 tail 引擎日志文件解析;
下行,128 个隐藏 **Image 面板**轮询 `SetImage("/btipc/dl?w&r&p&t")`,bit=1→200 PNG /
bit=0→404,`ImageLoaded` 事件收位。**零证书、零 JS、零标题事件**。

| 维度 | 评价 |
| --- | --- |
| 延迟 | config same ≈0.65s / delta ≈7.8s / full ≈26s;翻译多帧(慢于 ① 一个量级) |
| 组件 | 与 ① 共用本地桥(btipc 端点);vpk 侧 128×Image 面板 |
| 服务端能力 | 与 ① 共享(config 差分 btipc11、指纹聚合) |
| 失效模式 | 上/下行都是**原始机制**(日志文件 + Image 位信号),6726 以来从未被动过;10-29 全程存活 |
| 用户安装面 | 零证书依赖——证书没弄好它也工作 |
| 状态 | ✅ 兜底。10-29 事件中唯一活过的路径;**不退役**(退役 = 把"两天零翻译"常态化) |

## 3. 路线 ③:纯 CEF 无桥路线(托管页 + CEF localStorage)——**默认形态(2026-11-01 决议,待落地)**

**架构**:去掉本地桥进程。CEF 面板加载**远程托管页**(如 GitHub Pages 上的 bridge.html,
公开有效证书);游戏侧 vpk 不变(DOM 抓取 + SetURL + hash/标题回程——btipc13 的修复
同样需要);翻译由**页面 JS 直调 provider API**(免 Key 上游优先,Key 可选增强);配置持久化在
**CEF localStorage**(QOL Lock 4.0.5 的真实模式,references/09 有逐项对比)。

| 维度 | 评价 |
| --- | --- |
| 延迟 | 与 ① 相同(面板通道不变);配置读写变 **localStorage 即时**(零网络) |
| 组件 | **无本地进程、无端口、无本地证书链**;vpk 照旧 + 托管页(发版即全量生效) |
| 10-29 三连击免疫性 | 证书强制执行(10-29a):**免疫**(公开有效证书);标题派发(10-29b):**同样致命**(需 CitadelHTMLPanel+绑定修复,托管页救不了);JS 策略:托管页正常执行 |
| CORS 与免 Key | 页面直调 provider,受上游 `ACAO` 约束。**真机已验证**:`edge.microsoft.com`(与现状桥**同一上游**)HTTP **200 + `ACAO:*`**、`mymemory` 200;OpenAI/Google/LibreTranslate 的 401/400 响应体可读;仅 DeepL Free 与 `terraprint` 被拦。免 Key 直连成立,**无需 Worker 中继** |
| API Key | **可选增强**:免 Key 可用;需要更高质量/更低限流时填用户自己的 Key |
| 托管单点(风险) | GitHub Pages 下架/改版/证书事故 = 全用户失联;本机 POC **2/2 可达**,但单机两次不能外推全国可达性;本地桥的数据与服务都在用户机器上 |
| 诊断面 | 无 `bridge.log`;用户报障只剩截图;fallback/名称保护/词库等服务端能力需重做进页面(或由 ③′ 提供) |
| 配置持久化 | CEF localStorage 自包含(10-29 期间 QOL 用户无感的根本原因)——但 CEF 缓存清理/游戏重装会丢(本地桥是 `config.json` 文件) |
| 状态 | ✅ **2026-11-01 改判为默认部署形态**(待产品化落地):装 vpk →(可选)填 Key,零证书、不必重启 Steam;① 同时降为高级/离线模式。成本账与回退触发器见 [cef-cost-decision.md](cef-cost-decision.md)。注:QOL"不做翻译"的成功不能直接外推到翻译场景,可外推的只有 fragment 常驻与 localStorage 持久(references/09) |

## 4. 路线 ④:OCR 路线(外部应用截屏识别,锁语 LockLingo 模式)——**未采用,获取层灾备**

**架构**:整个 mod 变成**游戏外应用**(无 vpk):持续截屏聊天区 → 本机 OCR(Tesseract/
Windows OCR)→ 翻译 → **游戏外字幕气泡**显示。代表:锁语 LockLingo
([piaobo2233/deadlock-translator](https://github.com/piaobo2233/deadlock-translator),
MIT,Tesseract + OpenCV);同类:RSTGameTranslation / TranslateOverlay。

| 维度 | 评价 |
| --- | --- |
| 延迟 | 获取 +0.3~1s(截屏+识别)再 + 翻译;作者自述"不承诺固定延迟" |
| 组件 | 独立应用(Python+Tesseract+OpenCV 打包);**引擎零集成——连 vpk 都没有** |
| 获取层 | 像素→文本:无发送者/队伍/频道元数据;区域假设是真成本(LockLingo 做了整套"个人识别区域"校准 UI);聊天小字号 + 半透明背景是准确率重灾区 |
| 出站 | △ 剪贴板中继(游戏内复制中文 → 译文回剪贴板 → **用户手动粘贴**,默认关闭);自动注入输入框无解 |
| 回显 | 游戏外字幕气泡(无注入通道)——本项目聊天行内挂标签的体验拿不到 |
| 10-29 免疫性 | **完全免疫**(引擎更新对它无感)——但聊天框挪位/缩放/换肤会静默降准确率 |
| 状态 | ⏸ **获取层灾备位**。触发器:`scanChatMessages` DOM 抓取连续两次引擎更新失效 → 启动 OCR 降级 PoC(见 btipc-https-v1.md §12.3) |

## 5. 总对照矩阵

| | ① https(hash) | ② BTIPC | ③ 纯 CEF 无桥 | ④ OCR |
| --- | --- | --- | --- | --- |
| 所在层 | 传输(面板) | 传输(原始信号) | 传输(面板,页在远端) | **获取**(截屏) |
| 翻译延迟 | **1 RTT** | 多帧(慢) | **1 RTT** + provider 外网 | +0.3~1s 识别 |
| 配置推送 | <1s(watch) | 60s 轮询 | localStorage 即时 | 无此概念 |
| 本地进程 | 桥双进程 | 桥双进程(共享) | **无** | 独立应用 |
| 证书依赖 | CA 链 + 首装重启 Steam | **零** | **零**(公开证书) | **零** |
| API Key | 不需要(bing 免 Key) | 不需要 | **可选**(免 Key 直连已验,Key 为增强) | 可选(LockLingo 本地词库缓冲) |
| 元数据(敌我/发送者) | ✓ | ✓ | ✓ | ✗ |
| 出站自动双语 | ✓ | ✓ | ✓ | ✗(剪贴板手动) |
| 诊断 | bridge.log 全量 | 同 | 无 bridge.log(`title` 回传) | 应用内 |
| 10-29 存活性 | 修复后 ✓(修复前全灭) | ✓ 全程 | 证书击免疫/标题击同样死 | ✓ 完全免疫 |
| 采用状态 | ✅ 已发布主路 → **高级/离线模式** | **✅ 兜底** | **✅ 默认形态**(待落地) | ⏸ 获取层灾备 |

## 6. 分层模型(为什么四条路不能简单互换)

同一场翻译要过四道关,**每条路线只是替换其中一层**:

```
获取(Panorama DOM / OCR 截屏)
  → 传输(①② 面板通道 / ③ 同①但页在远端)
    → 服务(本地桥:免费中继/名称保护/词库 / ③ 无服务:页内多上游轮换,免 Key 优先、Key 可选)
      → 回显(DOM 标签注入 / ④ 外部气泡)
```

- ①②③ 的获取层与回显层相同,差别在**传输与服务的归属**(本地进程 vs 远端托管);
- ④ 单独换掉**获取与回显**两层,传输反而退化(OCR 结果本地即可翻译,无需桥);
- 因此"换路线"从来不是整体替换,而是**按层替换**——灾备也按层独立储备
  (传输层灾备 = BTIPC;获取层灾备 = OCR;服务层灾备 = Key 直连模式,即 ③ 的核心)。

## 7. 决议与演进

1. **保留 ①+② 双通道能力**(10-29 的直接教训;BTIPC 不退役,① 降为高级/离线模式但通道不删)。
2. **CEF 内部收敛**(① 内部,收益独立):watch 并入常驻页(单页双工)→ 配置同步全走
   hash → nav 模式退役。详见 [btipc-https-v1.md](btipc-https-v1.md) §11.4。
3. **③ 由"可选形态"升级为默认部署形态(2026-11-01 决议)**:免 Key 直连经真机 CEF 验证成立
   → 用户安装面从"3 手工步(含**完全重启 Steam**)"降到"1–2 步"。
   ① 同时降为高级/离线/隐私模式;② 保持兜底不动。完整成本账、③′ 公网同源中继的可选项
   与回退触发器见 [cef-cost-decision.md](cef-cost-decision.md)。
   - **POC 2026-11-01 数据(无桥直载托管页,真机 CEF)**:公网页加载 + title 回程 2/2(同秒);
     hash 回环 12/12(通道 RTT 2–24ms);localStorage 跨游戏重启持久(bootCount 递增);
     CORS 矩阵——免 Key 的 `edge.microsoft.com`(现状桥用的**同一上游**)与 `mymemory` **直连通**,
     OpenAI(401)/Google(400)/LibreTranslate(400)响应**可读**(Key 路径亦可用),仅 DeepL Free 与
     公共 LibreTranslate 被拦。
   - **落地要点**:"先解决 Bing 免 Key 的 CORS 中继"**不再需要**;
     遗留风险 = 免 Key 上游限流 / 托管单点 / 无 `bridge.log` 诊断面。详见 `poc/RESULTS.md`。
4. **④ 触发器**:`scanChatMessages` 连续两次引擎更新失效(获取层死了才需要它)。
5. 复审:每次引擎更新后回填本表的"10-29 存活性"一行;两条触发器任一触发即升 P1。
