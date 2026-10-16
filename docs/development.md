# 开发文档

## 1. 当前状态与验证情况

**发布状态**:`1.2.0 (2026-10-16)` 本地构建已出包自测,GitHub Release 待发;
版本号跨渠道共用、口径见 `ipc-checklist-6726.md` §16.7。上一版 `1.0.9 (2026-10-09)`。

**本地桥(core/)**:零依赖 Node.js,已通过本地端到端测试
(health / config 读写与打码回传 / translate 与 test 的真实 HTTP 链路;
Bing 免 Key 与 Microsoft 双服务商均已实测,真实译文验证通过)。
新增 `core/bridge_https.js` 独立 TLS 终结进程(8792,反代 8791):
证书缺失时以退出码 3 自退、不连带主桥;详见 `docs/btipc-https-v1.md` §3。

**游戏内 Panorama(mod/)**:**已实车验证**(2026-10-15/16 多轮,https 数据见
`docs/btipc-https-v1.md` §8)。当前各子系统状态:

| 子系统 | 状态 | 依据 |
| --- | --- | --- |
| 收/发消息翻译、译文追加、缓存重建 | ✅ 实车可用(https 通道 1 秒以内;BTIPC 兜底) | `translated [hud] …` + `bridge_https.log` 请求逐行对齐 |
| HUD 顶栏气泡挂译文 | ✅ 实车可用 | 用户肉眼确认 |
| 配置读写(设置面板保存/测试 + 开机同步) | ✅ 实车可用 | 保存经 https 同秒落盘(`config saved`);开机同步在探针定论后约 2 秒落地(`boot: config synced`) |
| **https 面板通道**(翻译 / 保存 / 读配置) | ✅ 已转正(2026-10-15/16) | 机制与数据见 `docs/btipc-https-v1.md` §8;证书未信任时探针判死、全程 BTIPC(体感与上线前一致) |
| **BTIPC 信道**(兜底:翻译 / 配置 / 回声) | ✅ 实车可用 | 协议 `btipc-v1.md`,`dispatch THREW = 0`;`core/btipc/*` 冻结未动 |
| `$.AsyncWebRequest` 直连 | ❌ 游戏已移除该 API | `ERROR: AsyncWebRequest has been removed.` |
| http 面板 `SetURL` 导航 | ⚠️ 判死冷却(10 分钟),仅作最后一级兜底 | `bridge nav failed: panel dead` 摘要 |
| health / 快捷语音 / 名称保护同步 | ✅ 已迁出(经 BTIPC `get` 或 https,指纹一致时零传输) | `gamenames sync: fingerprint match` / `quickchat templates delta applied` |

### 已确认的技术事实(通过 DLCT VPK 解编译验证,2026-08-03)

> **2026-10-15 复核**:下列 8 条已用 DLCT 的**完整发行包**逐条实测,全部属实 ——
> 实物在游戏安装根目录的 `DLCT\` 下(含 `bridge_server.js` /
> `pak01_dir.vpk` / `LICENSE_NOTICE.md`,不是只有 vpk)。解包出
> `panorama/scripts/deadlock_chat_translator.js`(54,576 B)。
> 另补两条当时未记录的:标签类名 DLCT 用 `DlctTranslationLabel`(本项目用 `LCTTranslation`);
> 桥监听 `127.0.0.1:8765` 且**无 https、无证书** —— https 面板方案另有来源(见
> `docs/btipc-https-v1.md` §2),不在此列。完整技术对账见
> `docs/btipc-https-v1.md` §2.6。

1. **HTML 面板必须用 XML `<HTML id="..." />` 标签声明**
   (运行时 `$.CreatePanel("HTML", ...)` 不会得到可用的 HTML 面板;
   DLCT 声明为 `<HTML id="DlctBridge" class="DlctBridge" />`)
2. **加载方法:`panel.SetURL(url)`**(不是 BLoadUrl)—— http 面板直连在 6726 后失效,
   现仅作判死冷却后的最后一级兜底;https 面板通道见 §1 状态表
3. **读回:`panel.title`**(页面把 `id+JSON` 写进 document.title,Panorama 轮询读取;
   DLCT 另有 GetAttributeString 兜底)
4. **提交处理器接管模式成立**:DLCT 的 TextEntry 同样改为
   `oninputsubmit="DeadlockChatTranslatorSubmit();"`(本项目为 LCTOnChatSubmit)
5. 编译后字符串表存在后缀压缩(字节里 id 显示为碎片),但运行时与解编译均完整还原,
   不影响 findChild 查找
6. `resourcecompiler` 输出扩展名规范化为 `.vxml_c / .vjs_c / .vcss_c`

### 仍需游戏内验证/微调的点

1. **发送接管**:万一聊天发不出去,回退:chat.xml 的 TextEntry 改回
   `oninputsubmit="CitadelChatInputSubmitted();"`(失去 /tr 与发送前翻译,收发正常)
2. 设置面板定位(负偏移)与 ToggleButton 文本显示,需游戏内微调 CSS
3. 聊天新消息类型(反编译 snippet 之外的)未渲染时,按缺失 snippet 补上
4. 出站翻译的**队友视角**可见性(本项目日志与 HUD 已通,对面看到的译文待复核)

## 2. 冒烟测试清单(首次进游戏)

1. 用 `StartDeadlock.bat` 启动(或手动 `node core\bridge_server.js` 再开游戏)
2. **确认 `-condebug` 生效**(BTIPC 上行的硬前提):`game\citadel\console.log` 开头
   `[CommandLine]` 行应含 `-condebug`,`logs\bridge.log` 应有 `game console.log found: …`。
   缺了它游戏不写该文件 → 桥收不到任何上行 → mod 完全不工作;
   桥检测到游戏跑 90s 仍无本次启动的 console.log 会打 `[warn] 缺少 -condebug`。
   `StartDeadlock.bat` 已自动带;从 Steam 界面直接启动则必须自己在
   属性 → 常规 → 启动选项 里填 `-condebug`
   候选路径不再写死盘符:桥按 Steam 注册表安装路径 + `libraryfolders.vdf` 里的全部库
   自动发现(库在 D:/E:/G: 一样能找到),兜底才是老的 F: / C:\Program Files (x86) 两条;
   全都找不到时每 60s 重扫一次
3. 看游戏日志首屏:版本串 `loaded <const VERSION>` + 开机探针结论
   (`https panel: ALIVE` = 证书已信任走快路;`not usable` = 未信任、全程 BTIPC)
   + `boot: config synced from bridge`(配置读通,探针定论后约 2 秒落地)
4. 训练场/机器人房间打开聊天,发一条外语消息
5. 期望:几秒内消息下方出现译文;`logs\bridge.log` 出现 `translate ok`
6. 设置面板:`/tr` 打开 → 服务商 bing → 测试 → 保存(无需任何 Key)
   日志应出现 `diag-nav … op=test / op=config` + `config saved`(经 https 同秒落盘);
   证书未信任时走位泵慢通道,保存以数十秒计,属预期(见 `docs/btipc-https-v1.md` §7)
7. 打字发一条本已是目标语言的短语(如 `ggwp`)→ HUD 顶栏气泡下应挂出译文
8. 快捷语音轮盘发几条(如 `上了` / `攻击 1 级` / `谢了!`)→ 应**不**被翻译
9. 聊天滚动(消息多到回收)后,译文应从缓存重建
10. 打开 VConsole / Panorama 调试器,确认无 `[LCT]` 相关报错

> 日志噪声已处理(护栏 `tests/lc_panel_nav_guard.test.js`):旧 http 面板通道失效后会判死并
> 冷却 10 分钟,冷却内不再导航、不打日志 —— `bridge nav failed: panel dead` 从每 15s 一条
> 降为每冷却周期一条摘要(细节日志全程仅一条)。看到这条摘要**不代表桥挂了**;
> 判断通道走哪条看 `https panel: ALIVE`(快路)还是 `not usable`(全程 BTIPC);
> 判断桥是否活着看 BTIPC 回声 / `boot: config synced`。
> `health`/`quickchat`/`gamenames` 已迁出旧通道(经 BTIPC `get` 或 https,见 §1 状态表)。

> `logs\` 目录不需要手工建(2026-10-03 反馈「日志目录不会自动创建」):发布包和
> git clone 里都没有它(`.gitignore` 排除),桥写日志前会自动 `mkdir -p`,只在首次探测一次;
> 全新解压后第一次跑就该有 `logs\bridge.log` —— 没有就说明 `config.json` 的 `logFile` 被改空了。

## 3. 构建

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Csdk12Root "F:\dev-tools\Reduced_CSDK_12"
```

- 编译:`resourcecompiler.exe -i <src> -o <dst>`(逐文件,输出扩展名自动规范化)
- 打包:`vpkeditcli <game_addon_dir> -o dist\pak01_dir.vpk --single-file`
- 校验:VPK 内必须含 chat.vxml_c / lingua_chat.vjs_c / lingua_chat.vcss_c
- 输出:`dist/pak01_dir.vpk` → 经 Deadlock Mod Manager 导入(勿覆盖现有 pak 槽位)

资源编译器探测顺序:CSDK12 的 `game\bin_cs2\win64\` → bin_tools → bin → bin_server。

## 4. 常用本地测试(不开游戏)

```powershell
cd F:\BabelTower
node core\bridge_server.js
# 另一终端:
curl.exe http://127.0.0.1:8791/api/v1/health
curl.exe -X POST http://127.0.0.1:8791/api/v1/translate -H "Content-Type: application/json" -d "{\"text\":\"hello world\",\"targetLanguage\":\"zh-Hans\"}"
curl.exe -X POST http://127.0.0.1:8791/api/v1/test -H "Content-Type: application/json" -d "{}"
curl.exe http://127.0.0.1:8791/api/v1/config
```

## 4.5 注释与署名约定(2026-10-15)

**resourcecompiler 产出的 `vjs_c` 保留注释原文** —— 在 `pak15_dir.vpk` 里直接能 grep 到中文注释。
所以:

1. **代码注释会随二进制分发给每一个用户。** 写进注释与写进代码没有区别,凡不该外发的信息
   (内部结论、第三方名称/commit、挖包路径、未验证的推断)一律不进注释。
2. **署名与事实性对照放文档层。** 代码注释只标「设计面是本项目的(指向 `docs/architecture.md`
   的对应条目)+ 关键结论出自本仓哪几条实验(指向 checklist)」,第三方署名、commit 与审计基线
   写在对应 feature 文档里,并从代码注释链过去。当前样例:`docs/btipc-https-v1.md` §2。
3. 判据很简单:**这段注释会不会被一个只装了发布包、没 cloned 仓库的人看到?** 会,就按第 1 条办。

## 5. 常见问题

- **桥端口被占用**:桥会自动静默退出(认为已有实例),属正常
- **改了 config.json 不用重启?**:config 每次请求时重新读取,改完即生效
- **Key 显示为 **********:打码显示;留空保存 = 清除 Key
- **日志里有 Key?**:不应该有;若发现,视为 bug 提交
- **Bing 接口 429/限流**:公共接口有隐形限流,连发测试会短暂 400;等 1 分钟自动恢复(桥内已做指数退避重试)
- **Bing 接口 401/403**:2026-09-19 已切换 Edge 免鉴权端点(无需 token),正常不会再出现 token 失效类 401;
  若再现,多为微软接口变动,对照 docs/architecture.md §6 的协议变更历史处理
- **调试工具**:`tools\Source2Viewer-CLI.exe`(VRF 19.2)可解编译 .vxml_c/.vjs_c 等
