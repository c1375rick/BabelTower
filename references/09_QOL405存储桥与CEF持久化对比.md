# QOL Lock 4.0.5 存储桥与 CEF 持久化对比分析（完整版）

**分析目标**：拆解 QOL Lock 4.0.5（pak03_dir.vpk，27.9MB）的 ql_storage_bridge.js，与 Deadlock Radio v2 对比，为"条件→BGM"模组提供可落地持久化结论。

**关键结论预告**：
1. 存储桥完全依赖 CEF（CitadelHTMLPanel）；无 CEF 则无持久化。
2. 协议：URL 片段 JSON → 页面解析 → localStorage → document.title → panorama HTMLTitle（QOL_RES:）。
3. 多片传输（CHUNK_SIZE=1500），请求队列串行，超时 5s，看门狗 5 次。
4. node_modules / @humanfs 在 panorama 侧零引用，判为构建残留。
5. 持久化落点：托管页面 origin（predi-i.github.io）的 localStorage，键 qollock_settings，值为 Base64 JSON 字符串。
6. 推荐混合架构③（CEF 播放 + panorama 规则引擎），持久化复用桥协议但替换宿主为本地 file://，避免外部站点依赖；Linux/Proton 需非 CEF 后备。

---

## 1. 存储桥机制全解（ql_storage_bridge.js，L1-699，28059 字节）

### 1.1 初始化与面板
代码证据 L21-22：BRIDGE_PANEL_ID="QOLStorageBridge"；BRIDGE_URL 固定为 https://predi-i.github.io/...。
代码证据 L466-546（init）：先 FindChild，失败则 $.CreatePanel("CitadelHTMLPanel", parent, id)；面板 2px/0.01opacity/visible/hittest=false；注册 $.RegisterEventHandler("HTMLTitle", panel, _onHtmlTitle)；SetURL(BRIDGE_URL)；启动 $.Schedule(WATCHDOG_INTERVAL_SEC=20, _watchdogTick）。
推断：面板在 hud.xml 与 hud_escape_menu.xml 均被引用，意味着 HUD 与菜单各自初始化；后初始化者覆盖 _bridgePanel 引用，但面板实例仍存在。

### 1.2 握手（QOL_BRIDGE_READY:frag1）
代码证据 L328-353：正则 ^QOL_BRIDGE_READY:frag1(?:$|:)；匹配则 _bridgeReady=true、_processQueue()、AddClass("BridgeReady")、SetAttributeString("QOL_BridgeReady","1"）、取消看门狗、_runAutoload()。L356-370：若无 frag1（旧缓存页），_oldPageLogged 一次，1 秒重试，最大 5 次（MAX_INIT_ATTEMPTS L27），超限清空队列并抛初始化错误（L400-409）。
推断：frag1 是协议版本标识；页面代码写 document.title = 'QOL_BRIDGE_READY:frag1' 作为首次就绪信号。

### 1.3 请求编码
代码证据 L149-152：_sendFragment(f,a) 生成 {q: "_fragmentCounter++", f, a}，encodeURIComponent(JSON.stringify(...)) 拼接到 BRIDGE_URL + "#" + ...。命令名见 L558（save）、L575（saveChunk）、L584（load）、594（remove）及 _handleResponse 对 savePartAck/chunked 的处理。
推断：hashchange 触发（页面代码注释已说明：fragment 不发服务器，hashchange 不重载；首次加载的 fragment 被忽略，避免重播旧请求）。

### 1.4 响应解析（_handleResponse L230-318）
代码证据：JSON.parse（L233）；reqId 匹配（L240-243）；_seq 去重（L247-249）；!resp.ok 报错（L252）；savePartAck 确认片并发送下一片（L259-273）；chunked 接收多片（L276-310：验证 total 1..5000、part 有效、顺序一致 expectedPart），全部接收后 join("") 完成；标准单帧取 resp.data（L313-315）。
推断：CEF 可能重复投递 HTMLTitle（_seq 防护）；chunked 是"拉取式"流式传输，桥主动请求 next（L299）。

### 1.5 reqId、超时、重试、队列
代码证据 L417-418：reqId = "qol_" + ++_reqCounter + "_" + Date.now()。L24：REQUEST_TIMEOUT_MS=5000；L164-178：计时器 $.Schedule/setTimeout；超时调用 _finishRequest(reqId, timeoutErr)。L36/_requestQueue：FIFO；L180-188：_processQueue 只在 _bridgeReady 且无 _activeRequest 时取出并启动；完成后自动触发下一请求（L220-223）。L429-432：面板不可用直接错误完成。L117-126：_withCallback 支持 callback+Promise 双重传递。
推断：无自动重试（仅初始化看门狗重试 URL 导航）；上层需自行重试。

### 1.6 面板存活与重建
代码证据 L94：_isPanelAlive = Q.core.panel.isAlive；L471-496：init 检测下若已死则重新创建（L489-496）；若失败 return null。L387-410：_watchdogTick 检查存活（L396），存活则重导航（L398），超限放弃。L128-147：_runAutoload 先检查 _isRestoreStateCurrent（L131），恢复失败 5 秒重试一次（L141-144）。
推断：运行时无自动重建机制；若 HUD 重建，需外层重新 init（ql_app 的 500ms 轮询承担部分职责）。

### 1.7 日志与能力探测
代码证据 L78-92：_log/_logWarn 优先 QOL_INFO/QOL_WARN，否则 $.Msg。探测（try/catch）：FindChild（未包裹但条件判断 L483）；$.CreatePanel（L488-494）；AddClass/SetAttributeString（L336-341）；RegisterEventHandler（L516-521）；SetURL（L529-536）；CancelScheduled（L155-160）；Schedule（L173-177）。未探测：JSON/Array/String/Date（直接假设存在）；btoa 有手动回退（L50-56）。无 localStorage 直接访问（完全代理至页面）。

---

## 2. 读取桥页（bridge.html，完整抓取）

已通过 urllib.request.urlopen 直接获取 https://predi-i.github.io/qollock-updates/bridge.html（CSP default-src 'none'; script-src 'unsafe-inline'），完整 HTML/JS 无外部脚本。

### 2.1 初始化与 localStorage 探测
代码：if (window.top !== window.self) 强制跳转；try { localStorage.setItem('__qol_probe__','1'); removeItem } catch (e) { document.title = 'QOL_BRIDGE_ERROR:' + msg; return; }。若不可用则退出，不写 QOL_BRIDGE_READY；桥侧 L372-376 设 _bridgeReady=false。附加 serviceWorker 注册（静默）。

### 2.2 片段解析与路由
代码：FRAGMENT_HANDLERS = {save, saveChunk, load, next, remove}; onFragment() 解析 hash.slice(1) → decodeURIComponent → JSON.parse → msg.q 去重 → msg.f 路由 → msg.a 数组传参。_lastFragmentId 防重复。

### 2.3 键名与格式
键：decodeText(key, isB64)；桥侧总发 Base64（_utf8ToBase64 String(key) L553），页面 atob 解码得 UTF-8 键。值：同样 Base64 解码后直接 localStorage.setItem，**无 JSON 包装**；桥侧已预转 JSON（L552 JSON.stringify(val)），所以存的是可直接 JSON.parse 的 JSON 字符串。

### 2.4 分片与限制
CHUNK_SIZE=1500 字符。保存：_saveBuffers[id]=new Array(total)；每片写入数组；part+1===total 时 join('') 写入，删除缓冲区，响应成功（含 _seq）；否则 send(savePartAck)。加载：val.length<=1500 单帧；否则切分数组 _loadBuffers[id]，逐片响应（chunked:true, part, total）；__qolNextChunk 读取对应片，最后一片删除缓冲区。30 秒超时清理。桥侧 L555 与页面完全一致（对称）。

### 2.5 写回 document.title
send(id, ok, data, err, extra)：resp={id, ok:!!ok, _seq:++_sendSeq}; data/err/extra 合并；document.title='QOL_RES:' + JSON.stringify(resp)。同步写入，桥侧实时接收。

### 2.6 版本/公告
无版本号字段；无公告。代码注释明确："Deadlock's 2026-10-01 update lets CitadelHTMLPanel.SetURL load only https: URLs, so javascript: calls no longer reach this page." → 已适配更新，放弃 javascript:，改纯 https: + hashchange。页面纯功能，与 Radio 载页不同。

---

## 3. 配置数据流

### 3.1 分工
- ql_persistence.js：低级面板属性持久化（getUIRoot / resolveHudPanel / readStorageConfigRawFromUi / writeStorageConfigRawToUi / markConfigEdited / getConfigChangeStamp）。键名 Deadlock_Mod_Settings_v1 / QOL_USER_EDIT_REV，revision 管理，2 秒缓存（CONFIG_FULL_REREAD_INTERVAL_MS L128）。
- ql_config_store.js：Schema 验证（registerSchema/get/set/all/load/exportAll），逐 feature bucket，类型校验（toggle/slider/dropdown/text/palette/action/number/buttongroup/multitoggle）。
- ql_config_adapter.js：旧平面 334 键→新 ConfigStore 迁移（OLD_TO_NEW L40-85）；coerceType（L107-122）；buildKeyToFeatureMap 扫描 FeatureRegistry。
- ql_codec.js：紧凑二进制编解码（v2 wire 格式），Base64/Base64Url 转换，token 打包（BUILD_CATEGORY_PAYLOAD_TOKEN_REGEX），序列化/反序列化（用于构建载荷，非桥协议）。

### 3.2 序列化与格式
桥协议值 = JSON 字符串（桥侧 save 前已 JSON.stringify）。ql_app 通过 saveSettings（L605-623）调用 save(SETTINGS_STORAGE_KEY, rawToSave)（L618），rawToSave = WrapConfigForStorage(_parseStoredSettings(config))（L611-612）。_parseStoredSettings 调用 Q.parseStoredConfig（L599-601）。3.1.4 的位打包已被 JSON 对象替代；ql_codec 仍存在用于构建分类载荷。Schema 版本 QOL_SCHEMA_SEMVER 默认 4.0.0（ql_codec L45）；adapter 有 legacy_3_1_9 迁移。

### 3.3 写入时机与去抖
ql_app L30-35：_configPollTimer 500ms 轮询。ql_persistence L128-220：2 秒全量重读间隔 + 缓存。桥侧无显式去抖，但 _requestQueue 串行 + _activeRequest 限制并发；上层应负责去抖（如滑块拖动延迟 250ms 后写入）。

### 3.4 失败降级
load 失败 → _loadSettings 拒绝 → _withCallback 传递给回调；上层可用默认配置。save 为空/解析失败 → 直接拒绝。桥初始化 5 次失败 → 清空队列并抛错。面板不可用 → 直接错误完成。无本地文件后备；Linux/无 CEF → 无持久化。

---

## 4. node_modules / @humanfs

VPK 27.9MB 内含 node_modules（含 @humanfs、eslint）。panorama 脚本 grep 零命中。推断：构建工具残留（文件系统抽象/代码检查），非运行时依赖；不影响 CEF/localStorage 方案；若需本地文件持久化，需自行引入（Deadlock panorama 无文件 API，只有面板属性+CEF）。

---

## 5. 与 Radio 方案对比

| 维度 | QOL 4.0.5 | Radio v2（report 08） |
|---|---|---|
| 宿主 | https://predi-i.github.io/...（作者站点） | file:/// 本地目录 / YouTube IFrame |
| 请求通道 | SetURL + #fragment（已适配 2026-10-01，无 javascript: 限制） | javascript: 注入（已被阻断，需改片段协议或重注入） |
| 响应通道 | document.title = QOL_RES: + JSON → HTMLTitle（相同） | 同 |
| 外部依赖 | 强（作者站点必须可达） | 弱（本地无依赖；YouTube 可切换） |
| 持久化落点 | 托管 origin localStorage（qollock_settings，Base64 JSON 字符串） | CEF localStorage（dlm_settings）/ 本地文件 |
| 大小限制 | CHUNK_SIZE 1500 字符/片，多片上限 5000（约 7.5M 字符） | 音频切片 ~10MB/分钟；配置 小得多 |
| 稳定性 | 高（纯 https: + hashchange）；依赖站点可达性；初始化看门狗 5 次 | 中（CEF 常驻待验证 E1；javascript: 已阻断） |
| 隐私 | 数据在作者 GitHub Pages（同源但可被扩展访问）；无加密 | 本地文件更隐私；CEF localStorage 同源 |
| 降级 | 无（桥失败→无持久化）；上层回默认配置 | 无显式降级；但可切换音源 |

**对 BGM 模组的明确建议（混合架构③）**：
- 条件检测在 panorama 侧（SignalHub），音频在 CEF 侧（CitadelHTMLPanel 载本地/YouTube）。
- 持久化直接复用桥协议（URL 片段 + title 事件 + 多片 + 队列 + 超时 + 看门狗 + localStorage 探测），但宿主改为 **本地托管页面**（打包进 VPK 的 `file:///` 或自建托管），避免依赖 `predi-i.github.io`。
- 数据量小（rules.json 数 KB~数十 KB），分片可保留但通常单帧即可。
- **硬限制**：Linux/Proton CEF 崩 → QOL 也无法持久化；因此必须设计 **非 CEF 后备**（例如简化规则表直接写入 panorama 面板属性，接受 Linux 用户无持久化，或提供手动导出/导入）。

---

## 6. 关键问题回答

**QOL 4.0.5 持久化是否不依赖 CEF？答案：否，完全依赖 CEF。**
证据：L5 注释明确 "CitadelHTMLPanel with localStorage backend"；init 全程使用 $.CreatePanel("CitadelHTMLPanel")、SetURL、RegisterEventHandler("HTMLTitle"）；响应只来自 CEF 面板事件；页面侧直接操作 localStorage（CEF 进程同源）；ql_persistence 的属性读写是运行时同步，不是跨会话持久化。若 CEF 崩（Linux/Proton 已知），QOL 无持久化；这直接影响我们是否需要为 Linux 找替代路径：**是的，必须提供非 CEF 后备或接受 Linux 不支持**。

---

## 7. 可直接复用清单

1. **URL 片段协议**（L149-152）：请求格式、encodeURIComponent、SetURL + #，已适配 2026-10-01 更新。
2. **响应前缀 QOL_RES:** + JSON 解析（L378-381 + 页面 send）：标准化、剥前缀、防解析失败。
3. **_seq 去重**（L247-249）：防 CEF 重复投递 HTMLTitle。
4. **_lastFragmentId 去重**（页面 onFragment）：防同一片段重复触发。
5. **多片协议**（L558-577 + 页面 __qolSaveChunk/Load/NextChunk）：CHUNK_SIZE 1500，saveChunk/next/load 分片流式传输，30 秒缓冲区超时。
6. **请求 ID 格式**（L417-418）：qol_计数_时间戳，唯一可追踪。
7. **初始化看门狗**（L387-410）：20 秒间隔，5 次重试，超限清空队列抛错。
8. **串行队列 + 超时**（L36, L180-188, L164-178）：FIFO + _activeRequest 限制并发，5 秒超时，完成后自动下一请求。
9. **面板不可用直接失败**（L429-432）：不阻塞其他请求。
10. **_withCallback**（L117-126）：callback + Promise 双重传递，异常不泄漏。
11. **localStorage 探测**（页面初始化）：写 _probeKey 并立即删除，异常写 QOL_BRIDGE_ERROR:，桥侧设 false。
12. **iframe 防嵌入**（页面 L2-5）：window.top !== window.self 强制跳转。
13. **serviceWorker 探测**（页面 L26-28）：可选增强，静默失败。
14. **API 探测写法**（桥侧多处 try/catch）：CreatePanel、RegisterEventHandler、SetURL、Schedule/CancelScheduled 前先判断 typeof === "function"；btoa 有手动回退（L50-56）。
15. **配置版本控制**（ql_codec L45 QOL_SCHEMA_SEMVER，adapter legacy_3_1_9）：支持迁移，避免旧配置失效。

---
*完整分析基于：ql_storage_bridge.js（完整 699 行）、ql_persistence/js/store/adapter/codec（全部读取）、bridge.html（完整抓取），VPK 验证（grep 零命中 node_modules），对照 report 08。所有代码引用为直接读取；推断已明确标注。*
