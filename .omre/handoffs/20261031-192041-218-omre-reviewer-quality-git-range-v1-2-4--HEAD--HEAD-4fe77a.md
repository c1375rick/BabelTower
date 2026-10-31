```json
{
  "schema_version": "1",
  "task_id": "quality-layout-panel-removal-v124-head",
  "agent": "omre-reviewer-quality",
  "dimension": "quality",
  "status": "completed",
  "target": {
    "kind": "working-tree",
    "value": "working tree @ 4fe77a8, git range v1.2.4..HEAD; only commit 88c2db8 touched the two layout XMLs and the panel script"
  },
  "slice_id": "slice-1",
  "findings": [
    {
      "id": "q-1",
      "severity": "high",
      "file": "mod/panorama/scripts/lingua_chat.js",
      "line": 1634,
      "title": "面板删除后主脚本仍存活调用 panel-only 全局 fieldValue（legacy custom 配置下发送/翻译直接断）",
      "description": "lingua_chat_panel.vjs_c 的 include 已从 chat.xml/hudchat.xml 移除（88c2db8，范围内唯一触碰布局的提交），panel 不再挂 globalThis.fieldValue（lingua_chat_panel.js:178/566），主脚本也无本地定义。但主脚本热路径仍保留 custom 分支裸调用：resolveOutgoingTarget() lingua_chat.js:1634 与 targetLanguage() :1625。触发条件是 State.cfg.targetLanguage/outgoingTarget === 'custom' —— 这是 v1.2.4 游戏内面板一级选项「自定义(手输语言代码)」的持久化结果，存于桥端 config.json 的 ui 块，每次开机由 applyBridgeConfig(:4377/:4378) 原样回灌 State.cfg。后果分两路：(a) 发送路：handleChatSubmit(:4035) 无顶层 try/catch，:4133 resolveOutgoingTarget() 在 outgoing≠off 时抛 ReferenceError → oninputsubmit 处理器死亡，消息不发、输入框不清、每次回车重复失败且无可见反馈；(b) 接收路：processRow 的逐行 catch(:3752-3756) 兜住 makeTextKey→targetLanguage() 的抛错 → 所有聊天行翻译静默失效并刷 processRow error 日志。网页 /tr 在保存时已把 custom 解析成具体语言码（ui.html:1352-1354/1401，不再持久化字面 custom），所以新存档无法产生该状态，但 v1.2.4 遗留配置会带着它进 1.2.5，且恢复手段（去网页改语言）对用户不可见。",
      "evidence": "grep 证实 fieldValue 仅定义于 lingua_chat_panel.js:178 并在 :566 挂 globalThis；两布局的 include 已删（git diff v1.2.4..HEAD）。lingua_chat.js:1625/1634 为仅有的两处调用，:4237 注释自认 fieldValue 是面板侧裸标识符。handleChatSubmit 4035-4048 无 try/catch；processRange 3751-3756 逐行 catch。applyBridgeConfig 4377-4378 无条件拷贝 ui.outgoingTarget/ui.targetLanguage（含 custom）。",
      "confidence": "high",
      "classification": "dangling-reference",
      "isRegression": false
    },
    {
      "id": "q-2",
      "severity": "medium",
      "file": "mod/panorama/scripts/lingua_chat.js",
      "line": 4312,
      "title": "applyUILang/LCTPickUILang 成为必抛死代码：每次 boot 固定两次 applyUILang failed，LCTPickUILang 仍是无保护的全局出口",
      "description": "面板删除后，applyUILang(:4264-4325) 引用的 60+ 个面板 id（SETTINGS_PANEL_ID/LCTPanelTitle/ROW_MAP/MENU_MAP）全部不存在，且 :4312-4322 调用的 setSelectText/setToggleText 是 panel 全局（lingua_chat_panel.js:568/569 挂载，现已无人挂载）→ 函数在 :4312 必抛 ReferenceError。两个 boot 调用点 :4753/:4757 有 try/catch（与实测 boot: applyUILang failed ×2 但 boot 继续 完全吻合，确认引用方受保护），但这意味着每次启动固定产生两条错误日志，且 90 行死函数 + SETTINGS_PANEL_ID(:66) + 全部 id 映射表继续误导维护者。此外 LCTPickUILang(:4327-4342) 无保护地调用 applyUILang()+closeSelectMenus()（:4334/:4335，两者均已是未定义标识符），却仍被 exportGlobal('LCTPickUILang')(:4873) 导出并经 LCTNS 发布 —— XML 引用已随面板删除、当前无调用方，但它是预留好的 booby trap：任何恢复引用（模板/回滚/复用）都会在点击处理器里裸抛。",
      "evidence": "lingua_chat.js:4753 与 :4757 的 try{applyUILang()}catch(eL/eL2)（对应 boot 日志 failed ×2）；:4312 setSelectText(...) 首个裸调用；:4334-4335 applyUILang()+closeSelectMenus() 无 try/catch；:4873 exportGlobal('LCTPickUILang', LCTPickUILang)；:4879 注释自认依赖面板全局。grep 证实主脚本无 [REDACTED_SECRET]seSelectMenus 定义。",
      "confidence": "high",
      "classification": "dead-code",
      "isRegression": false
    },
    {
      "id": "q-3",
      "severity": "low",
      "file": "mod/panorama/scripts/lingua_chat_panel.js",
      "line": 421,
      "title": "新增 catch 块引用未导入的 expErr：错误路径自身会抛 ReferenceError 掩盖原始错误（存档件，潜伏）",
      "description": "LCTPickLang 新增的 try/catch(:416-421) 在 catch 里调用 expErr(ePP)，但面板文件的 LCTNS 解构(:30) 并不含 expErr（宿主虽在 lingua_chat.js:4837 发布 LCTNS.expErr，面板未取），文件内也无本地定义 → 一旦 bridgePost 真的抛错，catch 处理器自身抛 ReferenceError: expErr is not defined 并替换原始异常，与该 catch『记录后继续』的目标相反。当前 include 已移除、面板不再从游戏加载（存档件），且测试只做语法检查（tests/run-tests.js:86-93），故为潜伏问题；但往死文件继续叠加与宿主解构名单脱节的新代码，加深分叉风险 —— 若日后重新挂载，该路径首日即坏。",
      "evidence": "lingua_chat_panel.js:30 解构名单（State,t,findChild,...,UI_LANG_OPTIONS，无 expErr）；:421 catch (ePP) { log('pick persist THREW ' + expErr(ePP)); }；grep 全文件 expErr 仅 :421 一处；宿主发布点 lingua_chat.js:4837 LCTNS.expErr = expErr; 对照主文件 LCTPickUILang(:4340) 用 expErr 合法（同文件 :946 已定义）。",
      "confidence": "high",
      "classification": "undefined-identifier",
      "isRegression": false
    },
    {
      "id": "q-4",
      "severity": "low",
      "file": "core/bridge_server.js",
      "line": 292,
      "title": "btipc 写路径的 config WRITE source 诊断引用越界 req：ReferenceError 被 catch(eD) 静默吞掉，诊断永不输出",
      "description": "runBtipcOp 是模块顶层函数(:275)，其写分支的诊断块(:291-297) 读取 req.headers —— 模块作用域不存在 req（唯一的 let req 在 fetchGitHubRelease :839 函数局部；requestHandler 的 req :1692 是参数）。因此 btipc 写路径（游戏侧 bridgePost 的 op=config 写，即 LCTPickLang/LCTPickUILang 推桥走的路）每次都在诊断第一行抛 ReferenceError 并被 catch(eD){} 吞掉，config WRITE source 日志永不出现。020d4bb 为『方向整反』排查加的写源归属诊断在 btipc 路径上是死代码 —— 排查时给出『该路径无写入记录』的假象（HTTP POST /api/v1/config 路径 :1530 附近的同名诊断在 requestHandler 作用域内，工作正常，这也解释了当时 12:42 证据只来自 POST）。功能无影响（:288-289 的 merge/save 与后续日志照常执行），纯诊断失效。",
      "evidence": "core/bridge_server.js:275 async function runBtipcOp(op, body, timeoutMs)（顶层）；:292 const ua = String(req.headers['user-agent']...) 在 try{...}catch(eD){} 内；grep 无模块级 req 声明/赋值（:839 let req 为 fetchGitHubRelease 局部，:841 唯一赋值；:1692 requestHandler=(req,res)=>）。对照 :1530 HTTP 路径诊断处于 requestHandler 作用域。",
      "confidence": "high",
      "classification": "dead-diagnostic",
      "isRegression": false
    },
    {
      "id": "q-5",
      "severity": "low",
      "file": "mod/panorama/layout/hudchat.xml",
      "line": 29,
      "title": "两布局与 ensurePanel 残留描述已删面板/旧面板类型的注释（doc rot）",
      "description": "chat.xml:29-30 与 hudchat.xml:29-30 保留了『设置面板 UI(2026-10-28 任务②C-1 拆分):必须晚于 lingua_chat.vjs_c ...』的装载顺序说明，但其描述的 lingua_chat_panel.vjs_c include 行已在同一次提交中被删，注释成为无主孤段；:32 的装载顺序链仍写 '→ panel → 探针'。lingua_chat.js:1830-1831 ensurePanel 注释仍写『必须在 chat.xml 里用 <HTML id=\"LCTBridgePanel\"> 声明』，而两布局现均为 CitadelHTMLPanel（chat.xml 自 v1.2.4 前已切换，hudchat.xml 本次范围对齐）。chat.xml:6-7 头注『设置按钮与设置面板』同样过时。不影响运行，但会误导下一次维护（例如按注释恢复 include 或以为缺 <HTML> 声明）。",
      "evidence": "git diff v1.2.4..HEAD 显示 include 行删除而上述注释行保留；hudchat.xml:29-30 与 chat.xml:29-30 现状；lingua_chat.js:1830-1831 注释 vs chat.xml:113 / hudchat.xml 尾部 <CitadelHTMLPanel id=\"LCTBridgePanel\" ...>。",
      "confidence": "high",
      "classification": "documentation-drift",
      "isRegression": false
    },
    {
      "id": "q-6",
      "severity": "low",
      "file": "tests/cfg_sync_guard.test.js",
      "line": 54,
      "title": "测试继续以源码正则钉住已卸载存档件的行为（pickLang 推桥块）",
      "description": "cfg_sync_guard.test.js:53-55 断言 lingua_chat_panel.js 源码文本中 markCfgDirty→saveUiConfig→推桥→closeSelectMenus→log 的精确块结构。该文件已不再被游戏加载（include 已删），测试守护的是一个零运行时影响的存档件：今后任何对存档件的整理/改注释都可能导致 CI 失败，而反过来，存档件坏掉（如 q-3 的 expErr）测试也照过。属于对死代码的脆性耦合，维护信号失真（绿档≠可用）。",
      "evidence": "tests/cfg_sync_guard.test.js:25 读取 mod/panorama/scripts/lingua_chat_panel.js；:54 正则断言 pickLang 块；:55 断言 'pick persist: 推桥同步' 注释存在。tests/run-tests.js:86-93 仅语法扫描该文件，无行为执行。",
      "confidence": "medium",
      "classification": "test-brittleness",
      "isRegression": false
    },
    {
      "id": "q-7",
      "severity": "low",
      "file": "mod/panorama/layout/chat.xml",
      "line": 105,
      "title": "评审提示中的『outgoing 目标菜单 English 置顶重排』不在 v1.2.4..HEAD 范围内（净差异为整块删除），语义无风险",
      "description": "范围内唯一触碰 chat.xml/hudchat.xml 的提交是 88c2db8，其净差异为设置面板整块删除（含 LCTOutgoingTargetMenu），无重排痕迹；v1.2.4 版本的菜单顺序为 zh-Hans 在前（diff 负侧可证）。『English 置顶』要么发生在 v1.2.4 之前，要么指现役设置面 core/web/ui.html:192-203（该处 English 确为第一项，且每个 option 携带显式 value，选中语义由 value 决定，与顺序无关；setOutgoingTargetValue 按 value 赋值 ui.html:1341-1349）。已删除面板中的 LCTMenuOption 本就通过 onactivate 显式传参（LCTPickLang('outgoingTarget','en')），顺序纯属展示。无论如何均不构成选中值语义风险。",
      "evidence": "git log --oneline v1.2.4..HEAD -- 两布局仅 88c2db8；net diff 负侧 LCTOutgoingTargetMenu 顺序 zh-Hans→zh-Hant→en→...；core/web/ui.html:192-203 option value 显式。",
      "confidence": "high",
      "classification": "spec-mismatch",
      "isRegression": false
    }
  ],
  "meta": {
    "total_findings": 7,
    "notes": "已验证的正面结论：①两布局标签配平（node 标签平衡检查 BALANCED），无 dangling onactivate/oninputsubmit（LCTOpenWebSettings 定义于 lingua_chat.js:926，LCTOnChatSubmit 导出于 :4870，/tr 与按钮双入口均经 UI_OPEN→桥拉网页，bridge_server.js:699-750）；②hudchat.xml 桥面板已与 chat.xml 逐字节同款（hittest/acceptsfocus 一致），ensurePanel 按 id findChild + SetURL 鸭子类型（:1833/:1845），无类型名假设，CitadelHTMLPanel 在 chat.xml 自 v1.2.4 前实车验证；③推桥载荷 {config:{ui:{outgoingTarget:v}}} 经 runBtipcOp op=config 写路径（bridge_server.js:287-303）进 applyMaskedUpdate，ui 块按字段逐一合并（core/config.js:338-350），不会整体覆盖 ui，应答 {ok:true} 与 res.ok 判断匹配，onConfigSaved 唤醒长轮询 + 面板 ack 清 dirty 与 applyConfigPayload clearDirtyForPaths(:4437) 语义一致，无合并缺陷；④boot 两处 applyUILang 均有 try/catch，与 failed ×2 但 boot 继续 的日志吻合。最高风险是 q-1（legacy custom 配置下发送断链）。注意：write_handoff 的 cwd 校验拒绝绝对路径，会话 cwd=F 盘仓库根，最终以 cwd='.' 落盘，绝对路径见返回 filePath。"
  }
}
```

# Review Handoff

## Metadata

- Agent: omre-reviewer-quality
- Scope: git range v1.2.4..HEAD (HEAD=4fe77a8): mod/panorama/layout/chat.xml, mod/panorama/layout/hudchat.xml (settings-panel block removal, bridge panel <HTML>->CitadelHTMLPanel), mod/panorama/scripts/lingua_chat_panel.js (LCTPickLang bridgePost + dirty clear), plus load-coupled surfaces lingua_chat.js / core/bridge_server.js / core/config.js / core/web/ui.html / tests
- Timestamp: 2026-10-31T11:20:41.218Z
- Status: completed
- Confidence: high

## Files Inspected

- `mod/panorama/layout/chat.xml`
- `mod/panorama/layout/hudchat.xml`
- `mod/panorama/scripts/lingua_chat_panel.js`
- `mod/panorama/scripts/lingua_chat.js`
- `core/bridge_server.js`
- `core/config.js`
- `core/web/ui.html`
- `scripts/remove_panel_main.js`
- `tests/run-tests.js`
- `tests/cfg_sync_guard.test.js`

## Findings

### Finding 1

- Severity: high
- Category: dangling-reference
- File: mod/panorama/scripts/lingua_chat.js
- Lines: 1634
- Evidence: grep 证实 fieldValue 仅定义于 lingua_chat_panel.js:178 并在 :566 挂 globalThis；两布局的 include 已删（git diff v1.2.4..HEAD）。lingua_chat.js:1625/1634 为仅有的两处调用，:4237 注释自认 fieldValue 是面板侧裸标识符。handleChatSubmit 4035-4048 无 try/catch；processRange 3751-3756 逐行 catch。applyBridgeConfig 4377-4378 无条件拷贝 ui.outgoingTarget/ui.targetLanguage（含 custom）。
- Impact: lingua_chat_panel.vjs_c 的 include 已从 chat.xml/hudchat.xml 移除（88c2db8，范围内唯一触碰布局的提交），panel 不再挂 globalThis.fieldValue（lingua_chat_panel.js:178/566），主脚本也无本地定义。但主脚本热路径仍保留 custom 分支裸调用：resolveOutgoingTarget() lingua_chat.js:1634 与 targetLanguage() :1625。触发条件是 State.cfg.targetLanguage/outgoingTarget === 'custom' —— 这是 v1.2.4 游戏内面板一级选项「自定义(手输语言代码)」的持久化结果，存于桥端 config.json 的 ui 块，每次开机由 applyBridgeConfig(:4377/:4378) 原样回灌 State.cfg。后果分两路：(a) 发送路：handleChatSubmit(:4035) 无顶层 try/catch，:4133 resolveOutgoingTarget() 在 outgoing≠off 时抛 ReferenceError → oninputsubmit 处理器死亡，消息不发、输入框不清、每次回车重复失败且无可见反馈；(b) 接收路：processRow 的逐行 catch(:3752-3756) 兜住 makeTextKey→targetLanguage() 的抛错 → 所有聊天行翻译静默失效并刷 processRow error 日志。网页 /tr 在保存时已把 custom 解析成具体语言码（ui.html:1352-1354/1401，不再持久化字面 custom），所以新存档无法产生该状态，但 v1.2.4 遗留配置会带着它进 1.2.5，且恢复手段（去网页改语言）对用户不可见。
- Recommendation: 

### Finding 2

- Severity: medium
- Category: dead-code
- File: mod/panorama/scripts/lingua_chat.js
- Lines: 4312
- Evidence: lingua_chat.js:4753 与 :4757 的 try{applyUILang()}catch(eL/eL2)（对应 boot 日志 failed ×2）；:4312 setSelectText(...) 首个裸调用；:4334-4335 applyUILang()+closeSelectMenus() 无 try/catch；:4873 exportGlobal('LCTPickUILang', LCTPickUILang)；:4879 注释自认依赖面板全局。grep 证实主脚本无 [REDACTED_SECRET]seSelectMenus 定义。
- Impact: 面板删除后，applyUILang(:4264-4325) 引用的 60+ 个面板 id（SETTINGS_PANEL_ID/LCTPanelTitle/ROW_MAP/MENU_MAP）全部不存在，且 :4312-4322 调用的 setSelectText/setToggleText 是 panel 全局（lingua_chat_panel.js:568/569 挂载，现已无人挂载）→ 函数在 :4312 必抛 ReferenceError。两个 boot 调用点 :4753/:4757 有 try/catch（与实测 boot: applyUILang failed ×2 但 boot 继续 完全吻合，确认引用方受保护），但这意味着每次启动固定产生两条错误日志，且 90 行死函数 + SETTINGS_PANEL_ID(:66) + 全部 id 映射表继续误导维护者。此外 LCTPickUILang(:4327-4342) 无保护地调用 applyUILang()+closeSelectMenus()（:4334/:4335，两者均已是未定义标识符），却仍被 exportGlobal('LCTPickUILang')(:4873) 导出并经 LCTNS 发布 —— XML 引用已随面板删除、当前无调用方，但它是预留好的 booby trap：任何恢复引用（模板/回滚/复用）都会在点击处理器里裸抛。
- Recommendation: 

### Finding 3

- Severity: low
- Category: undefined-identifier
- File: mod/panorama/scripts/lingua_chat_panel.js
- Lines: 421
- Evidence: lingua_chat_panel.js:30 解构名单（State,t,findChild,...,UI_LANG_OPTIONS，无 expErr）；:421 catch (ePP) { log('pick persist THREW ' + expErr(ePP)); }；grep 全文件 expErr 仅 :421 一处；宿主发布点 lingua_chat.js:4837 LCTNS.expErr = expErr; 对照主文件 LCTPickUILang(:4340) 用 expErr 合法（同文件 :946 已定义）。
- Impact: LCTPickLang 新增的 try/catch(:416-421) 在 catch 里调用 expErr(ePP)，但面板文件的 LCTNS 解构(:30) 并不含 expErr（宿主虽在 lingua_chat.js:4837 发布 LCTNS.expErr，面板未取），文件内也无本地定义 → 一旦 bridgePost 真的抛错，catch 处理器自身抛 ReferenceError: expErr is not defined 并替换原始异常，与该 catch『记录后继续』的目标相反。当前 include 已移除、面板不再从游戏加载（存档件），且测试只做语法检查（tests/run-tests.js:86-93），故为潜伏问题；但往死文件继续叠加与宿主解构名单脱节的新代码，加深分叉风险 —— 若日后重新挂载，该路径首日即坏。
- Recommendation: 

### Finding 4

- Severity: low
- Category: dead-diagnostic
- File: core/bridge_server.js
- Lines: 292
- Evidence: core/bridge_server.js:275 async function runBtipcOp(op, body, timeoutMs)（顶层）；:292 const ua = String(req.headers['user-agent']...) 在 try{...}catch(eD){} 内；grep 无模块级 req 声明/赋值（:839 let req 为 fetchGitHubRelease 局部，:841 唯一赋值；:1692 requestHandler=(req,res)=>）。对照 :1530 HTTP 路径诊断处于 requestHandler 作用域。
- Impact: runBtipcOp 是模块顶层函数(:275)，其写分支的诊断块(:291-297) 读取 req.headers —— 模块作用域不存在 req（唯一的 let req 在 fetchGitHubRelease :839 函数局部；requestHandler 的 req :1692 是参数）。因此 btipc 写路径（游戏侧 bridgePost 的 op=config 写，即 LCTPickLang/LCTPickUILang 推桥走的路）每次都在诊断第一行抛 ReferenceError 并被 catch(eD){} 吞掉，config WRITE source 日志永不出现。020d4bb 为『方向整反』排查加的写源归属诊断在 btipc 路径上是死代码 —— 排查时给出『该路径无写入记录』的假象（HTTP POST /api/v1/config 路径 :1530 附近的同名诊断在 requestHandler 作用域内，工作正常，这也解释了当时 12:42 证据只来自 POST）。功能无影响（:288-289 的 merge/save 与后续日志照常执行），纯诊断失效。
- Recommendation: 

### Finding 5

- Severity: low
- Category: documentation-drift
- File: mod/panorama/layout/hudchat.xml
- Lines: 29
- Evidence: git diff v1.2.4..HEAD 显示 include 行删除而上述注释行保留；hudchat.xml:29-30 与 chat.xml:29-30 现状；lingua_chat.js:1830-1831 注释 vs chat.xml:113 / hudchat.xml 尾部 <CitadelHTMLPanel id="LCTBridgePanel" ...>。
- Impact: chat.xml:29-30 与 hudchat.xml:29-30 保留了『设置面板 UI(2026-10-28 任务②C-1 拆分):必须晚于 lingua_chat.vjs_c ...』的装载顺序说明，但其描述的 lingua_chat_panel.vjs_c include 行已在同一次提交中被删，注释成为无主孤段；:32 的装载顺序链仍写 '→ panel → 探针'。lingua_chat.js:1830-1831 ensurePanel 注释仍写『必须在 chat.xml 里用 <HTML id="LCTBridgePanel"> 声明』，而两布局现均为 CitadelHTMLPanel（chat.xml 自 v1.2.4 前已切换，hudchat.xml 本次范围对齐）。chat.xml:6-7 头注『设置按钮与设置面板』同样过时。不影响运行，但会误导下一次维护（例如按注释恢复 include 或以为缺 <HTML> 声明）。
- Recommendation: 

### Finding 6

- Severity: low
- Category: test-brittleness
- File: tests/cfg_sync_guard.test.js
- Lines: 54
- Evidence: tests/cfg_sync_guard.test.js:25 读取 mod/panorama/scripts/lingua_chat_panel.js；:54 正则断言 pickLang 块；:55 断言 'pick persist: 推桥同步' 注释存在。tests/run-tests.js:86-93 仅语法扫描该文件，无行为执行。
- Impact: cfg_sync_guard.test.js:53-55 断言 lingua_chat_panel.js 源码文本中 markCfgDirty→saveUiConfig→推桥→closeSelectMenus→log 的精确块结构。该文件已不再被游戏加载（include 已删），测试守护的是一个零运行时影响的存档件：今后任何对存档件的整理/改注释都可能导致 CI 失败，而反过来，存档件坏掉（如 q-3 的 expErr）测试也照过。属于对死代码的脆性耦合，维护信号失真（绿档≠可用）。
- Recommendation: 

### Finding 7

- Severity: low
- Category: spec-mismatch
- File: mod/panorama/layout/chat.xml
- Lines: 105
- Evidence: git log --oneline v1.2.4..HEAD -- 两布局仅 88c2db8；net diff 负侧 LCTOutgoingTargetMenu 顺序 zh-Hans→zh-Hant→en→...；core/web/ui.html:192-203 option value 显式。
- Impact: 范围内唯一触碰 chat.xml/hudchat.xml 的提交是 88c2db8，其净差异为设置面板整块删除（含 LCTOutgoingTargetMenu），无重排痕迹；v1.2.4 版本的菜单顺序为 zh-Hans 在前（diff 负侧可证）。『English 置顶』要么发生在 v1.2.4 之前，要么指现役设置面 core/web/ui.html:192-203（该处 English 确为第一项，且每个 option 携带显式 value，选中语义由 value 决定，与顺序无关；setOutgoingTargetValue 按 value 赋值 ui.html:1341-1349）。已删除面板中的 LCTMenuOption 本就通过 onactivate 显式传参（LCTPickLang('outgoingTarget','en')），顺序纯属展示。无论如何均不构成选中值语义风险。
- Recommendation: 

## Suggested Fixes

- q-1: 在 lingua_chat.js 内联消除 custom 分支对 fieldValue 的依赖 —— resolveOutgoingTarget/targetLanguage 的 custom 分支改为回退默认（en / zh-Hans）并 log 提示 custom 目标已随面板移除废弃、请在网页 /tr 重新选择；或定义模块级 fallback fieldValue（safeText(findChild(...))）兜底。建议加一次性迁移：boot 时若 ui.outgoingTarget/ui.targetLanguage==='custom' 则经 bridgePost 重写为解析值。
- q-2: 删除或缩编 applyUILang（面板 id 表随面板一并删除），boot 处改为条件调用（typeof setSelectText === 'function'）或直接移除调用点，消除固定 ×2 错误日志；LCTPickUILang 要么删除 exportGlobal，要么函数体改为纯持久化（去掉 applyUILang/closeSelectMenus 裸调用）。
- q-3: 若保留存档件，把 expErr 加入面板 :30 的 LCTNS 解构（宿主 :4837 已发布），或将 catch 改为 (ePP && ePP.message) ? ePP.message : String(ePP)；更好：停止往死文件叠加功能，迁移说明写进文件头。
- q-4: 把诊断块移入 requestHandler 的 btipc 分支，或为 runBtipcOp 增加来源参数（如 srcHeaders），删除对越界 req 的引用；至少把 catch(eD){} 改为 log 一次 btipc write-source diag unavailable 避免静默。
- q-5: 同步删除/改写 chat.xml:29-30、hudchat.xml:29-30 的孤注释与装载顺序链，更新 lingua_chat.js:1830-1831 注释为 CitadelHTMLPanel 现状。
- q-6: cfg_sync_guard 中针对 lingua_chat_panel.js 的源码断言要么随存档决策移除，要么显式标注 @archived 并降级为仅存在性/语法检查。

## Open Questions

- 『outgoing 目标菜单 English 置顶』重排的具体提交不在 v1.2.4..HEAD 净差异中（两布局仅有 88c2db8 一个提交）——请确认该重排是否发生在 v1.2.4 之前或属于 core/web/ui.html；如属预期范围，可能存在评审范围/标签偏差。
- 产品决策确认：遗留 custom 目标配置（v1.2.4 面板写入）是否需要自动迁移，还是接受『用户自行去网页 /tr 重选』（q-1 的恢复路径）？
- lingua_chat_panel.js 作为存档件是否应从发布包/语法检查清单中一并移除，以避免继续投入（q-3/q-6）？

## Notes for Primary Agent

已验证的正面结论：①两布局标签配平（node 标签平衡检查 BALANCED），无 dangling onactivate/oninputsubmit（LCTOpenWebSettings 定义于 lingua_chat.js:926，LCTOnChatSubmit 导出于 :4870，/tr 与按钮双入口均经 UI_OPEN→桥拉网页，bridge_server.js:699-750）；②hudchat.xml 桥面板已与 chat.xml 逐字节同款（hittest/acceptsfocus 一致），ensurePanel 按 id findChild + SetURL 鸭子类型（:1833/:1845），无类型名假设，CitadelHTMLPanel 在 chat.xml 自 v1.2.4 前实车验证；③推桥载荷 {config:{ui:{outgoingTarget:v}}} 经 runBtipcOp op=config 写路径（bridge_server.js:287-303）进 applyMaskedUpdate，ui 块按字段逐一合并（core/config.js:338-350），不会整体覆盖 ui，应答 {ok:true} 与 res.ok 判断匹配，onConfigSaved 唤醒长轮询 + 面板 ack 清 dirty 与 applyConfigPayload clearDirtyForPaths(:4437) 语义一致，无合并缺陷；④boot 两处 applyUILang 均有 try/catch，与 failed ×2 但 boot 继续 的日志吻合。最高风险是 q-1（legacy custom 配置下发送断链）。注意：write_handoff 的 cwd 校验拒绝绝对路径，会话 cwd=F 盘仓库根，最终以 cwd='.' 落盘，绝对路径见返回 filePath。
