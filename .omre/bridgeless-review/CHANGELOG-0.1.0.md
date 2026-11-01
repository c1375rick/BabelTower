# Babel Tower Community 0.1.0（无桥版首发）

Deadlock 游戏内聊天翻译的**社区无桥版**：游戏内 CEF 面板直接加载托管页（GitHub Pages），
页面直调翻译 API。**没有本地桥进程、没有自签证书、不需要重启 Steam。**

- 上游主线（本地桥 + BTIPC 双通道）：<https://github.com/c1375rick/BabelTower>（GPL-3.0）
- 本仓库：AGPL-3.0（依 GPL-3.0 §7 单向升级；托管页受 §13 网络条款覆盖）
- 托管页源码：`pages/index.html`（规范副本）→ 部署镜像仓库 `babeltower-community-pages`

---

## 1. 无桥化改造摘要（游戏侧 `mod/panorama/scripts/lingua_chat.js`）

策略：**保留全部代码 + 开关**（`BTIPC_ENABLED = false`），不做大段删除——每条编辑的锚点
都在运行时抽取验证过（`lineOf`），避免"删除误伤/虚构锚点"。

`git show 6a476c8 --stat` 对应 9 个 hunk（提交说明记为 11 处编辑，含常量与守护点），逐条：

| # | 编辑 | 效果 |
|---|------|------|
| 1 | `VERSION = "0.1.0-ce"` | 版本标记（日志/诊断可见） |
| 2 | 新增常量 `BTIPC_ENABLED = false`、`PAGE_URL` | 唯一的开关面；页面地址单点定义 |
| 3 | `healthCheck()` 的 BTIPC 分支加守卫 | 无桥时不发 BTIPC 健康探测 |
| 4 | `demoteToBtipc()` 守卫 | hash 通道失败时**收敛为原文**，不降级到不存在的桥 |
| 5 | 探针 URL：`https://127.0.0.1:8792/bridge?...` → `PAGE_URL?boot=1&lang=...` | hash 通道 `hashBase` 自动跟随托管页 |
| 6 | 删除 bridge `imgProbe`（Image 面板旁证） | 无桥后该旁证无意义 |
| 7 | 配置同步入口 → `startPageCfgSync()`（新增 `hashCfgSync()`） | 页面 localStorage 为准：`LCTQ {op:"cfg"}` 拉回配置，包成 `{ui:{...}}` 复用 `applyBridgeConfig/dirty/convar` 不变量 |
| 8 | `/tr` → 游戏内可见设置面板（动态 `CitadelHTMLPanel`，指向 `PAGE_URL#settings`）+ `/tr code <base64>` 兜底（`importCfgCode()` → 页面 `cfgcode` op） | 设置入口不再依赖本地浏览器 |
| 9 | 删除 `/bt6736`（echo）、`/bt6737`（translate smoke） | BTIPC 测试命令无桥后不可用；`/lcttest` 保留 |
| 10 | 删除 `checkBridgeMissing`（及 12s 调度） | 无桥形态没有"桥未启动"这个概念 |

布局层（`chat.xml` / `hudchat.xml`）**零改动**：主线已声明
`<CitadelHTMLPanel id="LCTBridgePanel" hittest="false" acceptsFocus="false" />`，
无桥版继续复用它作为 CEF 载体。

### 1.1 本次收尾修正（页面侧，非游戏侧）

`pages/index.html` 的 alive 标题与游戏侧契约不一致，属于**会阻断 V1 的缺陷**：

- 游戏侧（事件路径 `t === TITLE_ALIVE`、`pollTitle()` 的 `title === TITLE_ALIVE`）是
  **严格相等**比较 `"lct-alive"`；
- 页面原先把 `document.title` 设为 `"lct-alive BTC-ALIVE <ver> <ts>"`（带后缀）→ 探针永远
  结算不了 → 通道被判死 → 无桥形态下等于不翻译。

修正：`setTitle("lct-alive")`（带时间戳的形态只留在页面状态行 `setStatus(ALIVE)`）。
离线冒烟脚本 `poc/sim/smoke_main.js` 已覆盖该契约（V1「probe settled ALIVE」一项）。

---

## 2. 页面 v0.1.0 能力（`pages/index.html`）

- **多上游轮换**：`bing-edge`（免 Key）→ `mymemory`（免 Key）→ 用户自备 Key
  （OpenAI 兼容 / Google），失败自动切换。
- **冷却退避**：某上游连续失败按冷却窗口摘除，冷却结束自动回归（`inCooldown()`）。
- **配置码**：页面「导出配置码」按钮 → base64(JSON)；游戏内 `/tr code <粘贴>` → 页面
  `cfgcode` op 逐键写入 CEF localStorage。
- **配置权威在页面**：`localStorage`（跨游戏重启持久，POC 真机已验证），游戏侧只读不写。
- **AGPL 合规**：页面保留上游/源码链接（AGPL §13 要求网络用户可获取源码）。
- **诊断保留**：`echo/alive/status/store/cors` 等 POC 诊断 op 不删（真机排障用）。

---

## 3. 安装方法

### 3.1 VPK（手动）

1. 完全退出 Deadlock。
2. 备份并移走主线 VPK（避免文件名/内容混淆）：

   ```powershell
   $p = "$env:ProgramFiles(x86)\Steam\steamapps\common\Deadlock\game\citadel\addons\pak15_dir.vpk"
   Get-FileHash $p -Algorithm SHA256    # 记录，收尾时核对
   Move-Item $p "$env:USERPROFILE\pak15_dir.vpk.safe"
   ```

3. 把包内 `pak90_ce_dir.vpk` 复制到 `Deadlock\game\citadel\addons\`
   （**独立文件名**，不会覆盖主线 `pak15_dir.vpk`；但同一时间只建议装一个 Babel Tower 变体）。
4. 启动游戏（排查期加 `-condebug`），控制台看 `[LCT]` 日志。

### 3.2 Mod Manager（Deadlock Mod Manager / 同类工具）

把 `pak90_ce_dir.vpk` 作为独立 mod 导入即可；卸载时移除该 vpk，不需要动主线包。

---

## 4. 已知限制（0.1.0）

1. **游戏内设置面板交互待真机验证**：`/tr` 动态创建的 `CitadelHTMLPanel` 是否可被鼠标
   点击、CEF 是否接受焦点，本版本**未在真机验证**；兜底路径是浏览器打开托管页导出配置码
   → `/tr code <粘贴>`。
2. **免 Key 上游限流**：`bing-edge` / `mymemory` 是公开免费端点，高频/长文本会被限流
   （冷却退避只能缓解，不能消除）；重度使用请自备 Key。
3. **托管单点**：所有用户的翻译出口是 `c1375rick.github.io/babeltower-community-pages`。
   页面被墙/被限流 = 全体用户失效；镜像备援（CF Pages + 启动探测）在路线图上，尚未实现。
4. **BTIPC 代码仍在包内**：`lingua_chat_btipc.vjs_c` 随包发布、由布局 `<include>` 加载，
   但 `BTIPC_ENABLED=false` 下不会被调用（保留是为最小化改动、便于与主线同步）。
5. **协议两侧同步发版**：`LCTQ` hash / title 回程协议变更必须页面与 vpk 同时发版。

---

## 5. 真机验证清单（0.1.0 发布前必跑）

**前置**

- [ ] 游戏**完全退出**（含 Steam 后台 CEF 残留；任务管理器确认无 `deadlock.exe`）
- [ ] 移走主线 `pak15_dir.vpk` 到安全处，并记录 `sha256`
      （先例格式见 `poc/RESULTS.md`）
- [ ] 安装 `pak90_ce_dir.vpk` 到 `game\citadel\addons\`
- [ ] 以 `-condebug` 启动，确认控制台日志文件可读

**V1 引擎面（CEF 加载 + 回程）**

- [ ] 日志出现 `[LCT] https panel: probing https://c1375rick.github.io/...`
- [ ] 随后出现 `[LCT] https panel: ALIVE`（页面 title 必须**恰为** `lct-alive`）
- [ ] 若只有 probing 没有 ALIVE：记录 `diag-title` 快照与 `pageErrors`

**V2 配置流（页面 localStorage 权威）**

- [ ] 日志出现 `page-cfg: synced from bridge`（`LCTQ {op:"cfg"}` 拉回并落地）
- [ ] 页面改一项配置（如总开关/目标语言）→ 30s 内游戏侧日志再次同步

**V3 翻译（核心功能）**

- [ ] 对局内发中文 → 日志 hash dispatch → 页面轮换上游 → 发出的是双语/译文
- [ ] 队友英文消息 → 原消息下方出现译文标签（≈1s 级）
- [ ] 断开网络/上游全挂 → 消息**回落为原文发出**（不卡发送、不重复发）

**V4 设置入口**

- [ ] `/tr` 打开游戏内可见面板：记录是否渲染、鼠标能否点击输入
      （不可交互 = 已知限制 4.1，不是回归，记录现象即可）
- [ ] 兜底：浏览器打开托管页 → 导出配置码 → 游戏内 `/tr code <粘贴>` →
      日志 `cfg code imported`
- [ ] `/lcttest` 仍可用（保留的诊断命令）

**V5 收尾**

- [ ] 退出游戏
- [ ] 恢复主线 `pak15_dir.vpk`，`sha256` 与前置记录**逐位一致**
- [ ] 删除 `pak90_ce_dir.vpk`
- [ ] 记录验证结论到 `poc/RESULTS.md`（同格式：日期 / 构建 sha256 / 结论 / 异常快照）

---

## 6. 构建与回归（本仓库）

```powershell
# vpk（产物 dist\pak01_dir.vpk → 复制为 dist\pak90_ce_dir.vpk）
powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Csdk12Root "<Reduced_CSDK_12>"

# 发行 zip（产物 dist\BabelTower-0.1.0-win64.zip + BabelTower-Community-0.1.0-win64.zip）
powershell -ExecutionPolicy Bypass -File scripts\package_release.ps1

# POC 回归（无桥模拟 16 项，poc_boot.js 脚本面）
portable-node\node.exe poc\sim\run_poc_sim.js

# 主脚本冒烟（真实 lingua_chat.js + 真实 pages/index.html，假 Panorama/CEF）
portable-node\node.exe poc\sim\smoke_main.js
```

本次收尾实测：POC 模拟 **16/16 PASS**；主脚本冒烟 **10/10 PASS**；
VPK `pak01_dir.vpk` = 525,500 B（主线 pak15 = 514,412 B，量级一致）。
