# POC 任务书:无桥路线(纯 CEF + 托管页)

> 2026-10-31 立项。执行方式:**子对话独立执行**,本文档自包含。
> 结论回填:[routes-comparison.md](routes-comparison.md) §3/§7.3。

## 0. 给执行者(子对话)的话

- 本 POC 回答"**去掉本地桥进程、CEF 面板直载远程托管页**"这条路线的关键未验证假设。
- **只做验证,不做产品化**:不改 `mod/panorama/scripts/lingua_chat.js` 等任何 1.2.5 已发布代码;
  不动 `dist/` 发布产物;不发布任何渠道;不占用正式端口 8791/8792。
- 实验产物一律放 `poc/` 目录(新建);游戏内测试用独立 vpk 文件名,测完必须恢复现场(见 §3.3)。
- 每完成一步把证据(命令输出/截图/数据)写进 `poc/RESULTS.md`,全部完成后产出 GO/NO-GO 报告(模板 §6)。

## 1. 背景(一段话)

Babel Tower 现状 = 本地 Node 桥(双进程 8791/8792)+ CA 链证书 + CEF 面板(hash 1 RTT 主路)
+ BTIPC 位泵兜底。证书首装(信任 + 完全重启 Steam)是 GameBanana 分发的最大失败面。
**无桥路线** = 砍掉本地桥与证书:CEF 面板加载远程托管页(GitHub Pages,公开有效证书),
页面 JS 直调翻译 API(用户 Key 或 CORS 友好免 Key 端点),配置持久化在 CEF localStorage
(QOL Lock 4.0.5 已验证的存储模式)。

## 2. 已有结论(不要重评,直接引用)

来自 [routes-comparison.md](routes-comparison.md) §3 与 [btipc-https-v1.md](btipc-https-v1.md) §11(2026-10-30 评估):

1. 10-29 三连击:证书强制执行——无桥**免疫**(公开证书);标题派发被砍——无桥**同样致命**
   (需 CitadelHTMLPanel + 面板绑定,btipc13 修复对远程页同样必要);JS 策略——托管页正常执行。
2. **CORS 墙**:免费零 Key 的 Bing 依赖桥服务端代发,托管页直连预期被拒——本项目"零 Key
   开箱即用"卖点在无桥路线下不成立(除非加 Cloudflare Worker 类中继,新增公共依赖)。
3. **Key 硬门槛** + 托管单点(GitHub Pages 国内可达性)+ 诊断黑暗(无 bridge.log)——评估已列,
   POC 用数据量化,不重复辩论。
4. hash 协议(LCTQ fragment + title 回程)与 localStorage 均为**未在远程页/跨重启实测过**的假设。

## 3. 环境与可复用件

### 3.1 机器与仓库

- 仓库 `F:\BabelTower`(Windows);Node 用 `portable-node\node.exe`(勿用系统 node 跑桥——POC 不需要桥)。
- 游戏 Deadlock(Steam,库在 `C:\SteamLibrary`);正式 mod vpk 装在
  `C:\SteamLibrary\steamapps\common\Deadlock\game\citadel\addons\pak15_dir.vpk`(**1.2.5 正式包,勿覆盖勿删除**)。
- `gh` CLI 已登录(c1375rick)——用它建 POC Pages 仓库。
- GB 自动化脚本(scripts/gb_*.js)与本 POC 无关,不要运行。

### 3.2 要复用的协议与代码(只读参考,不修改)

| 件 | 位置 | 用途 |
| --- | --- | --- |
| hash 上行协议 | `core/bridge_server.js` 内 `bridgePage` 模板的 `onHash`;`lingua_chat.js` 派发处(搜 `LCTQ:`) | fragment 形如 `#LCTQ:` + `encodeURIComponent(JSON.stringify({id,q,d}))` |
| title 回程协议 | 同上;页面侧 `document.title = "LCT" + id + JSON.stringify(响应)` | 游戏 HTMLTitle 事件收响应 |
| CitadelHTMLPanel 用法 | `mod/panorama/layout/hudchat.xml`(桥面板段) | POC vpk 照抄结构(独立 id) |
| QOL 存储对照 | `references/09_QOL405存储桥与CEF持久化对比.md` | localStorage 模式参照 |
| 路线评估 | `docs/routes-comparison.md` §3 / `docs/btipc-https-v1.md` §11 | 结论来源,勿重评 |

### 3.3 游戏内测试的现场纪律

- POC vpk 用**独立文件名**(如 `pak90_poc_dir.vpk`),测试期间**暂时把 `pak15_dir.vpk` 移到
  `poc/pak15_parked.vpk`**(移动前记录字节数),防止两包同名资产互踩;**测完必须移回并核对字节数一致**。
- 涉及游戏开关的步骤:游戏退出后才能增删 vpk;每次改动 vpk 后重启游戏验证。
- 现场恢复校验:`pak15_dir.vpk` 回到原位且字节数 = 移动前记录值 = 515,150 B 附近(以记录为准),并写入 RESULTS.md。

## 4. POC 步骤(每步先做后记)

### S1 — CEF 能否加载公网 HTTPS 页并执行 JS

1. `gh repo create c1375rick/babeltower-poc-pages --public`;push 一个 `index.html`
   (内联 JS:页面加载后把 `new Date().toISOString()` + `navigator.userAgent` 写入 `document.title`,
   并在页面上大字显示 "POC-ALIVE <时间戳>");开启 GitHub Pages(main 分支根目录)。
2. 做最小 POC vpk:照 `hudchat.xml` 桥面板段做一个 `poc_layout.xml`(CitadelHTMLPanel,
   SetURL 指向 Pages URL)+ `poc_boot.js`(boot 时 SetURL;监听 HTMLTitle,把每次 title 变化
   用 `$.Msg("[POC] title=" + …)` 打到引擎 console)。
3. 游戏+`-condebug` 启动,等面板加载;tail 引擎日志确认收到 `POC-ALIVE` title。
4. **判定**:title 收到时间戳 = 远程页加载 ✓ + JS 执行 ✓ + title 回程 ✓(S1/S2 的回程部分顺带验证)。
   记录:加载耗时、连续 3 次游戏重启的可达性(国内网络实测)。

### S2 — hash 上行 → 页面解析 → title 应答(echo 回环)

1. Pages 页加 onHash 分支:`location.hash` 以 `#LCTQ:` 开头 → `JSON.parse(decodeURIComponent(...))`
   → 把 `{echo: 原payload.d.text, id: payload.id}` 以 `document.title = "LCT"+id+JSON` 写回。
2. POC 脚本每 5s `SetURL(页面URL + "#LCTQ:" + encodeURIComponent(JSON.stringify({id: 随机, q: "echo", d: {text: "ping-<n>"}})))`。
3. **判定**:游戏侧按序收到 `ping-1..n` 的 title 应答 = hash 上行 + 解析 + title 下行全通 ✓。
   记录:往返延迟分布(≥10 次),同页连续 hash 变更是否都触发 hashchange。

### S3 — CEF localStorage 跨游戏重启持久性

1. 页面加 localStorage 分支:hash 指令 `{q:"store", d:{k,v}}` 写 localStorage;`{q:"load", d:{k}}`
   读出并 title 应答;页面每次加载自动把 `localStorage.pocBootCount`+1 并显示。
2. POC 脚本:先写 `pocKey=hello-<日期>`,游戏完全退出再启动,读回。
3. **判定**:跨重启读回一致 + bootCount 递增 = 持久 ✓。记录:重启 3 次的行为;若丢失,记录 CEF 配置文件路径证据。

### S4 — CORS 实测矩阵(CEF 内直调翻译 API)

1. 页面加诊断模式:hash 指令 `{q:"cors", d:{endpoint}}` → `fetch(endpoint)`(带 15s 超时)→
   结果(HTTP 状态/CORS 错误文案/译文是否解析成功)写 title(前缀 `LCTDIAG`)并在页面显示;POC 脚本收集进引擎日志。
2. 端点矩阵(每个都测,免 Key 与带 Key 分开记):
   - Bing 免 Key 端点(现状桥中继的同一上游 URL)——预期 CORS 拒,实锤记录
   - `https://api.openai.com/v1/chat/completions`(用户自备 Key)
   - `https://api-free.deepl.com/v2/translate`(DeepL Free Key)
   - `https://translation.googleapis.com/language/translate/v2`(Google Key)
   - `https://api.mymemory.translated.net/get`(免 Key)
   - 任一 LibreTranslate 公共实例(免 Key)
   - (可选)自建最小 Cloudflare Worker 中继转发 Bing——若通,记录"免 Key 恢复"结论
3. **判定**:每个端点一行"CEF 内通/被拒 + 确切报错"。**这张表是无桥路线可行性核心证据**。

### S5 — 端到端半环:托管页内完成一次真实翻译

1. Pages 页加最小翻译 UI(输入框 + 目标语言 + 按钮):直调 S4 中**可用**的最佳端点完成翻译并显示。
2. 游戏 CEF 面板里手动/脚本触发一次(hash 发文本 → 页面翻译 → title 回中文/英文译文)。
3. **判定**:游戏 console 里看到真实译文往返 = "无桥时页面具备翻译能力" ✓。

### S6 — 汇总

把 S1-S5 数据填进 §6 模板,回填 routes-comparison.md §7.3 的触发器证据行
(不动 §3 结论——那是总文档,只追加一行"POC 2026-11-xx 数据:…"到 §7.3)。

## 5. 禁区(违反 = POC 作废)

1. 不改 `mod/panorama/scripts/lingua_chat.js`、`lingua_chat_btipc.js`、`core/*.js` 任何正式代码。
2. 不动 `dist/`、不跑 `scripts/build.ps1` 之外的打包、不发布任何渠道。
3. 不占用端口 8791/8792;不起正式桥(`core/bridge_server.js`)——POC 全程无桥。
4. 不动 `pak15_dir.vpk` 的内容;POC vpk 独立命名;测试后现场恢复(§3.3)并核对。
5. 不在 Pages 仓库放任何 Key;测试 Key 放本地临时文件(`poc/key.txt`,不入 git)。

## 6. 交付物:`poc/RESULTS.md` + GO/NO-GO

```markdown
# 无桥 POC 结果(日期,build 6726+)
S1 加载: Pages URL=… 加载耗时=…s, 3 次重启可达性=…/3, title 回程=通/不通
S2 echo: 往返延迟 min/avg/max=…ms(样本 n), 连续 hash=全部触发/部分丢失
S3 localStorage: 跨重启=保持/丢失(3 次), bootCount 递增=是/否
S4 CORS 矩阵: <每端点一行: 通/拒 + 报错原文 + 免Key/带Key>
S5 端到端: 游戏内收到真实译文=是/否, 译文往返耗时=…s
现场恢复: pak15 已还原(字节数核对=…)
GO/NO-GO 建议: <一段话——哪些假设成立/被证伪;若 GO,最小产品化缺口清单
(CORS 中继方案/Key 门槛/诊断面/托管单点对策);若 NO-GO,死因一句话>
```

GO/NO-GO 只给数据与建议,**不自行启动产品化**——决策回到主对话。
