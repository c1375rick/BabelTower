# Babel Tower — Deadlock 游戏内聊天翻译 Mod

把《Deadlock》聊天里的外语消息实时翻译成你的语言,译文直接显示在原消息下方;
也支持"发送前把要说的话翻译成目标语言"(仅译文 / 原文|译文 双语模式)。

- 架构:全景(游戏内 Panorama 界面)+ 本地翻译桥(Node.js 本地服务)+ 翻译服务商
- 默认服务商:**Bing Translator(公共免费接口,免 Key,国内直连可用)**;可选 Microsoft / DeepL / OpenAI 兼容
- **设置入口:本地网页**(`/tr` 用系统浏览器打开 `http://127.0.0.1:8791/ui`),
  10 种界面语言,改完**游戏里 <1 秒生效**;游戏内旧面板保留为调试/兜底(`/tr panel`)
- 原理:聊天行扫描 → 去重/缓存 → **BTIPC 本地信道**送本地桥 → 译文追加显示
  (游戏移除 `$.AsyncWebRequest`、6726 更新废掉面板导航后,BTIPC 是唯一在用的通道;
  三条通道与派发顺序见 [docs/architecture.md](docs/architecture.md) §4.2)
- 名称保护:翻译前把英雄/物品名换成占位、译完还原;桥在线时从 `/api/v1/gamenames`
  拉全量名单(292 条,随游戏更新刷新),拉不到时用打包内置的 60 条兜底名单
- 许可证:**GNU GPL v3**,见 [LICENSE](LICENSE)

> 版本:1.2.2 (2026-10-21)
>
> **1.2.2**:配置同步改成**差分** —— 只传"变了的字段",不传全量。
> 慢通道(BTIPC,下行约 15 B/s)上"网页改了游戏不认"从最坏约 46 秒降到:
> 没变 **1 帧(≈0.65 秒)**、改一个字段 **120B(≈7.8 秒)**(旧路是全量 392B ≈26 秒 + 20 秒轮询)。
> 快通道(https 面板)上的推送 <1 秒照旧。机制见
> [docs/btipc-https-v1.md](docs/btipc-https-v1.md) §10。
>
> **1.2.1**:设置面板搬到**本地网页** —— `/tr` 用系统默认浏览器打开 `http://127.0.0.1:8791/ui`
> (10 种界面语言,默认跟随游戏界面语言;游戏内旧面板保留为调试/兜底,`/tr panel` 打开);
> 配置下发从"只开机读一次"改成**推送**:网页保存后游戏 **<1 秒**生效,不用重启游戏
> (桥主动推"配置变了"的信号,游戏再自己去读配置 —— 机制与踩过的三个引擎行为坑见
> [docs/btipc-https-v1.md](docs/btipc-https-v1.md) §9);
> "启用翻译"改为**总开关**(关掉后收发都不翻译)。
>
> **1.2.0**:新增 **https 面板通道**并已转正 —— 翻译下行从位泵的 3.0–27.4s 降到 **1 秒以内**
> (BTIPC 保留为兜底,证书未信任时体感与旧版一致);修掉"翻译慢 8 秒"的真因(bing 命中限流在
> provider 内部睡 7 秒,且回退链是空的);provider 的诊断日志从此进 `logs/bridge.log`。
> 详见 [docs/btipc-https-v1.md](docs/btipc-https-v1.md)。

---

## 目录结构

```
BabelTower/
├── mod/panorama/          游戏内 UI 源码(需编译成 VPK 安装)
│   ├── layout/chat.xml      聊天布局覆盖(含游戏内旧设置面板)
│   ├── scripts/lingua_chat.js  主逻辑:扫描/去重/缓存/桥接/设置(内部代号 LCT)
│   └── styles/lingua_chat.css  译文与旧设置面板样式
├── core/                  本地翻译桥(Node.js,零依赖)
│   ├── bridge_server.js      桥服务器(/api/v1/* + /bridge + /watch + BTIPC 路由)
│   ├── web/ui.html           网页设置页(10 种语言;/tr 用系统浏览器打开它)
│   ├── btipc/                BTIPC 信道实现(crc16 / framer / window / transport)
│   ├── config.js             本地配置管理(apiKey 打码 + 配置指纹 configRev)
│   ├── dictionary.js         自适应学习词典(短词直译,见下方教程)
│   └── providers/            Bing(免 Key)/ Microsoft 双服务商
├── config/config.example.json  桥配置示例(复制为 config.json 使用)
├── config/dictionary.json   词典数据(user 手动 + learned 自动学习)
├── scripts/build.ps1       编译 + 打包 VPK 脚本
├── scripts/autostart.ps1   开机自启安装/卸载
├── scripts/gen_bridge_cert.ps1  本机 https 证书生成/信任/撤销(低延迟通道的唯一拦点)
├── scripts/install_babeltower.ps1 一键安装:证书 + 起桥 + 验收 + 下一步指引
├── scripts/update_babeltower.ps1  从官方 Releases 自更新(白名单 + 体积/SHA256 双校验 + 延后安装 + 回滚)
├── scripts/diagnose_babeltower.ps1 一键检测:只读,输出脱敏报告(每条结论带判据)
├── scripts/uninstall_babeltower.ps1 卸载/还原:mod + 自启 + 桥 + 证书 + 状态目录,默认保守逐项确认
├── BabelTower-维护菜单.bat  维护总入口(先选语言再进菜单:安装/更新/卸载/诊断/自启开关,也支持带参数)
├── StartDeadlock.bat       手动启动:桥 + 游戏
├── docs/                   架构与开发文档
│   ├── architecture.md       架构总览 + 三条通信通道 + 翻译服务商协议
│   ├── btipc-v1.md           BTIPC 协议规格(冻结)
│   ├── btipc-https-v1.md     https 面板通道(低延迟回程)+ 路线来源逐项对账
│   ├── ipc-checklist-6726.md 6726 版本 IPC 排查记录与发版口径
│   ├── compatibility.md      兼容性快照 + 冻结清单/解冻边界(2026-10-10 起)
│   └── development.md        构建 / 冒烟测试 / 常见问题
└── references/             研究参考材料(原版布局反编译等)
```

> 说明:项目对外品牌名为 **Babel Tower**;内部功能标识符沿用 LCT/lingua_chat 代号
> (游戏内已测稳定,避免改名引入回归),二者指同一项目。

## 安装

1. 获取发行包（GitHub Release 附件 `BabelTower-<版本>-win64.zip`），解压到任意目录（路径可含中文/空格，**保持压缩包内目录结构**）。
   包里自带 `portable-node/`，开箱即用不用另装 Node；自行构建见下方 [从源码构建](#从源码构建-vpk)。
2. mod 装进 Deadlock（**二选一**）:
   - **推荐**：用 Deadlock Mod Manager 导入（自动分配空闲 pak 槽位）
   - 或手动：把包里的 `pak01_dir.vpk` 复制到 `game/citadel/addons/` 目录（改名为空闲的 `pakNN_dir.vpk`，**不要覆盖其它 mod，也不要同时放两份我们的包**）
3. （推荐）安装 [Universal Mod Manager](https://gamebanana.com/mods/693642)：
   游戏内设置窗口，调 Babel Tower 选项不用开 `/tr`（见下方 [UMM 设置联动](#ummuniversal-mod-manager设置联动)）
4. 给 Deadlock 加 `-condebug` 启动参数（**必做，只需设置一次**）—— 游戏不带它就不会写
   `game/citadel/console.log`，而桥只能从该文件读回游戏侧消息（BTIPC 上行的唯一通路），
   缺了它 mod 表现为**装了完全没反应**：
   Steam 库 → Deadlock 右键 → 属性 → 常规 → **启动选项** 填 `-condebug`
   > 桥若检测到游戏已运行 90s 仍无本次启动的 `console.log`，会在 `logs\bridge.log` 打一条
   > `[… ] [warn] 缺少 -condebug` 告警
5. 双击 **`BabelTower-维护菜单.bat`**（中文菜单先选语言），按菜单走：
   - **选 1 一键安装**：环境检查 → 证书信任（https 低延迟通道的唯一拦点）→ 起桥 → 验收
   - **选 5** 装开机自启（之后 Steam 直接启动游戏即可，桥常驻；不想装也行，用选 6 关）
6. 日常使用（都在同一个维护菜单里，不用记多个脚本）：
   | 事项 | 做法 |
   | --- | --- |
   | 玩游戏 | Steam 直接启动（已装自启）；没装自启就双击 `StartDeadlock.bat` 手动启动（桥 + 游戏，自动带 `-condebug`） |
   | 更新到新版本 | 维护菜单 → 选 2（只从官方 Releases 取包，体积 + SHA256 双校验） |
   | 出问题先诊断 | 维护菜单 → 选 4（只读，生成脱敏报告，可直接发反馈） |
   | 卸载 | 维护菜单 → 选 3（默认保守，逐项确认） |
   | 桥没起来 | 双击 `restart_bridge.bat`（一键重启 + 健康检查） |

## 使用

| 操作 | 说明 |
| --- | --- |
| 聊天输入 `/tr` 回车 | **用系统默认浏览器打开网页设置页** `http://127.0.0.1:8791/ui`(鼠标锁定也能用) |
| 聊天输入 `/tr panel` 回车 | 只开**游戏内旧设置面板**(调试/兜底用,见下方[网页设置页](#网页设置页桌面浏览器)) |
| 输入框右侧 **译** 按钮 | 打开游戏内旧设置面板(鼠标可用时) |
| 网页设置页 | 选项均为**点击选择**,改完点**保存**生效,**游戏里 <1 秒内生效**,不用重启游戏 |
| [UMM](https://gamebanana.com/mods/693642) 设置窗口 | **装了 UMM 的用户推荐用这个**(见下),不用再开 `/tr`;网页设置页(`/tr`)功能更全,两者共用同一份配置 |

### 网页设置页(桌面浏览器)

`/tr` 打开的是**本地网页**(`http://127.0.0.1:8791/ui`,由本地桥提供,不走游戏内任何通道),
比游戏内面板好用得多:

- **多语言**:页面支持 简体中文 / 繁體中文 / English / 日本語 / 한국어 / Français / Deutsch /
  Español / Русский / Português (Brasil) 共 10 种;右上角可手动切换,默认**跟随游戏界面语言**
  (游戏每次与桥通信都会报上自己的界面语言,见 `docs/btipc-https-v1.md` §9)。
- **翻译服务**:选服务商(Bing 免 Key / Microsoft / DeepL / OpenAI 兼容 / Google)、填 Key、
  回退链、超时、源/目标语言 —— Key 只写本地 `config/config.json`,页面上永远是打码的。
- **游戏内行为**:翻译总开关(关掉后**收发都不翻译**)、显示模式、发送前翻译、发送目标语言、
  强制翻译、游戏侧等待超时。**保存后游戏 <1 秒内生效**(桥主动推送"配置变了"的信号,
  游戏再自己去读配置,机制见 `docs/btipc-https-v1.md` §9)。
  游戏取配置走**差分**:只传变了的字段,没变时几乎不占带宽(慢通道上的细节见 §10)。
- **通道健康**:一张表实时显示游戏↔桥的四条通路(BTIPC 下行/上行、HTML 桥页加载、桥页取数)
  的最近活跃时间,用来判断"是没连上,还是只是没说话"。
- **高级**:整份配置(打码 JSON)可直接编辑保存。

> 游戏内的旧面板还在(`/tr panel` 或点 **译** 按钮),保留为**调试/兜底**入口:
> 它读的是开机缓存,改配置后要重启游戏才刷新;日常设置请用网页。

设置项(网页与游戏内面板共用同一份 `config/config.json`):

- **启用翻译**:总开关(关掉后收发都不翻译)
- **服务商**:`bing(免 Key)` 默认 ⇄ `microsoft(Azure Key)`
- **API Key / 区域**:仅 Microsoft 需要填写(Key 只保存在本地 `config/config.json`,打码显示)
- **目标语言**:下拉选择(简中/繁中/英/日/韩/法/德/西 + 自定义)
- **显示模式**:双语(原文+译文)⇄ 仅译文
- **发送前翻译**:关(发原文)⇄ 仅译文 ⇄ 双语(原文 | 译文)
- **发送目标语言**:下拉选择
- **超时(ms)** / **强制翻译**

行为说明:

- 只翻译别人的消息(自己的消息默认跳过)
- 已是目标语言的消息(启发式判断)不重复翻译
- 纯数字/符号、指令(`/` 开头)不翻译
- 翻译失败自动重试一次,仍失败显示红字错误
- 聊天滚动/回收后,译文会从缓存自动重建

## 翻译词典(自适应学习)

词典用于**稳定短句/游戏术语的翻译**:命中词典的词条直接查表返回(毫秒级),
不走翻译服务商,避免 Bing 对短词(如 `gg`、`mid`)翻译结果抖动的问题。

### 自动学习(无需手动操作)

- 词典**空表起步**,随着游戏进行自动累积你常用的短句
- 学习规则:纯 ASCII 短文本(≤30 字符、≤5 个词)+ 译文 ≠ 原文
- 同一译文**出现 3 次 → 立即固化落盘**,之后该词条查表秒回
- 防误译保护:译文与原文相同、或译文只有 1 个字符而原文是 2+ 字母词(如 `gank`→`去`)
  等可疑结果不会被学习

### 手动编辑(config/dictionary.json)

文件结构(`config/dictionary.json`,桥运行目录下):

```json
{
  "user": {
    "zh": {
      "glhf": "祝好运，玩得开心"
    }
  },
  "learned": {}
}
```

- **`user` 区**:你手动写的词条(程序不覆盖,优先于 learned 生效)
  - 固定词条、或 Bing 某词翻得不好时,直接写这里覆盖
- **`learned` 区**:程序自动学习写入,**不要手动编辑**(下次固化会被覆盖)
- **语言前缀**:`zh`(简中/繁中)、`en`、`ja`、`ko`、`fr`、`de`、`es` 等,
  按你在设置里选的**目标语言**匹配(zh-Hans/zh-CN/zh-TW 都命中 `zh`)
- 修改后**重启桥**(或等下次自动加载)生效

### 关闭词典

在 `config/config.json` 里加:

```json
{
  "dictionary": { "enabled": false }
}
```

关闭后所有词条都走翻译服务商(不查表、不学习)。

## 翻译服务商

### 默认:Bing Translator(免 Key,公共免费接口)

- 使用 Edge 内置翻译同款免鉴权端点(`edge.microsoft.com/translate/translatetext`,无需 token),国内直连可用
  (2026-09 更换:原 Bing 网页翻译接口受区域跳转影响间歇性 401,已弃用)
- 无需注册;公共接口有隐形限流,出现 429 会自动重试
- 该接口可能随微软调整而变化,届时本仓库会跟进修复

### 可选:Microsoft Translator(Azure Key)

1. 注册 [Azure](https://azure.microsoft.com/free),创建 Translator 资源
2. 设置面板:服务商切到 `microsoft`,填入 Key(区域按需)
3. 点**测试**验证

## 更新规划(Roadmap)

> ✅ = 已实现,planned = 计划中。

- ✅ **BTIPC 本地通信层**:游戏移除 `$.AsyncWebRequest`、6726 更新废掉面板导航后,
  出站翻译 / 入站聊天翻译 / 配置读写改走自研 BTIPC 信道(上行 `console.log` 结构化行 +
  下行 128 个隐藏面板的位编码帧,CRC + 幂等重试),协议见 [docs/btipc-v1.md](docs/btipc-v1.md)
- ✅ **更多翻译接口**:DeepL / Google / OpenAI 兼容接口,主服务商失败时自动回退(Thirt927 贡献)
- ✅ **https 面板通道(低延迟回程,已转正)**:隐藏 HTML 面板只接受证书有效的
  https(引擎 `error:-202`),信任一张本机自签证书后,面板页面在桥这一侧同源取走**整条**结果,
  下行从位泵的 `1200ms + 帧数×600ms`(实测 3~27s)变成**一个 RTT**(实测 1 秒以内,见 §8)。
  双击 `BabelTower-维护菜单.bat → 选 1` 完成「信任证书 + 起桥 + 验收」;**信任后必须完全退出并
  重启 Steam**(信任库由 Steam 宿主缓存,只重启游戏不生效)。
  BTIPC 全程保留为兜底:证书没信任 / Steam 没重启的用户体感与现在完全一致。
  通道机制、启用流程与**路线来源逐项对账**见 [docs/btipc-https-v1.md](docs/btipc-https-v1.md)
- ✅ **游戏术语表**:内置词典 2801 条 + 自适应学习(上限 5000/语言)
- ✅ **名称保护动态同步**:翻译前占位/译后还原,桥在线时从 `/api/v1/gamenames` 拉全量名单
  (292 条),桥不可达则用打包内置 60 条兜底
- ✅ **HUD 翻译浮层**:顶栏消息被游戏清理后自动接管显示(1.0.7 修复气泡不挂译文)
- ✅ **聊天日志轮转**:单文件 5MB 自动归档,30 天清理
- ✅ **Bing 指数退避**:限流时自动退避重试
- ✅ **UMM 设置联动**:安装 [Universal Mod Manager](https://gamebanana.com/mods/693642) 后可在其设置窗口调整 Babel Tower 常用选项(不装 UMM 完全不影响本 mod)
- planned **统一通信通道**:health / 快捷语音语料 / 名称保护同步也迁到 BTIPC,
  清掉旧面板通道每 15s 一条的死链日志
- planned **翻译失败提示**:游戏内显示翻译失败/桥离线状态,不再静默
- ✅ **网页设置页**:设置面板搬到本地网页(`/tr` 用系统浏览器打开),10 种界面语言
  (默认跟随游戏语言),保存后游戏 **<1 秒**生效;游戏内旧面板保留为调试/兜底
  (见 [docs/btipc-https-v1.md](docs/btipc-https-v1.md) §9)
- planned **Linux 移植**:支持 Steam Deck / Proton 环境

### UMM(Universal Mod Manager)设置联动

安装 [UMM](https://gamebanana.com/mods/693642) 后,它会自动发现 Babel Tower 并提供设置窗口,可调:
启用翻译 / 服务商 / 目标语言 / 显示模式 / 发送前翻译 / 发送目标语言 / 强制翻译 / 超时 / 翻译自己的消息 / 聊天日志。

> **装了 UMM 的用户:建议统一用 UMM 修改设置,不要混用 `/tr` 面板**。
>
> 两处改动都即时生效、都写入同一份本地配置,但 UMM 窗口的**显示**跟随它自己的存档:
> 混用两边时可能出现"行为已变、UMM 显示未变"的错位(不影响实际翻译,但看着别扭)。
> 固定用一个入口就不会有显示错位。UMM 里点 **Save Settings** 可把当前值存为它自己的跨重启存档。

UMM 使用要点:

- **改动即时生效**:在 UMM 里改完,下一条消息/发送就按新值执行,无需重进游戏
- **跨重启保留**:点一次 UMM 窗口的 **Save Settings** 即可;之后 UMM 会记住这些值
- **想让某项跟随 `/tr` 面板的值**:点该项行旁的 **reset** 图标,清掉 UMM 存档后,
  该项显示会回到 mod 上报的当前配置
- **API Key / 区域 / 回退服务商** 不在 UMM 中提供(机密不走 UMM 通道),仍需用 `/tr` 面板或手改 `config/config.json`
- 中文界面下 UMM 里显示为**巴别塔**,各设置项均为中文;`/tr` 面板界面语言切到 English 后 UMM 标签也变英文
- 未安装 UMM 时本 mod 行为完全不变,无需任何配置

#### 与 `/tr` 面板的关系(技术细节,选读)

两个入口写的是**同一份本地配置**(本地桥的 `config/config.json`),没有两套设置文件:

- UMM 改动 → 经协议下发 → 即时生效并写入桥配置
- `/tr` 保存 → 直接写入桥配置,同样即时生效
- 两边不一致时,**最后改动的一方生效**
- UMM 的存档(点过 Save Settings 后)只影响 UMM 窗口自己的显示,不会覆盖 `/tr` 保存的值

## 从源码构建 VPK

需要 [Reduced CSDK 12](https://deadlockmodding.pages.dev/modding-tools/csdk-12) 与
[VPKEdit CLI](https://github.com/craftablescience/VPKEdit/releases)(放入 `tools/`):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Csdk12Root "D:\Reduced_CSDK_12"
```

产物 `dist/pak01_dir.vpk` 经 Mod Manager 导入。

## 本地测试(不开游戏)

```powershell
node core\bridge_server.js
# 另开终端:
curl.exe http://127.0.0.1:8791/api/v1/health
curl.exe -X POST http://127.0.0.1:8791/api/v1/translate -H "Content-Type: application/json" -d "{\"text\":\"hello\",\"targetLanguage\":\"zh-Hans\"}"
```

## 查看调试信息与提交 Bug

遇到翻译失败/不显示/桥连不上时,按下面的步骤收集调试信息再反馈
(详细图文教程见 **[docs/debugging.md](docs/debugging.md)**):

1. **看桥状态**:浏览器打开 `http://127.0.0.1:8791/ui`(游戏内 `/tr` 同址),
   页面顶部的「通道健康」卡片会显示游戏↔桥四条通路的最近活跃时间
   (未运行先双击 `restart_bridge.bat`)
2. **看桥日志**:用记事本打开 `logs\bridge.log`,找 `translate failed:` 开头的行,
   那就是失败原因(如 `翻译失败(429)`=限流、`接口拒绝访问(401/403)`=接口拒绝)
3. **手动验证**(可选):浏览器访问 `http://127.0.0.1:8791/api/v1/health`,
   能看到 JSON 即桥正常
4. **提交反馈**:[GitHub Issues](https://github.com/c1375rick/BabelTower/issues)
   (用 Bug Report 模板)或 GameBanana 评论区,附上:
   Mod 版本 + 现象描述 + `bridge.log` 相关片段 + 安装方式 + 是否代理

> 日志默认开启(v1.0.5+),保存在本地 `logs\bridge.log`,**不含 API Key**,
> 上传前可自行检查。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 译文显示"本地桥未运行" | 确认桥在运行(自启/StartDeadlock.bat/手动 node);或看 `logs\bridge.log` |
| 翻译失败,日志出现 429 | 公共接口限流,桥会自动退避重试;频繁出现可切 Microsoft 或稍后再试 |
| 401/403(用 Microsoft 时) | Key 错误;403 检查是否需填区域 |
| 完全不翻译 | 检查"启用翻译"(总开关)、目标语言;网页设置页顶部「通道健康」看游戏是否连着桥;游戏内 `/tr panel` 看旧面板的状态行 |
| 聊天发不出去 | 见 docs/development.md 的回退方案 |
| 装了/卸了其它 mod 后翻译失效 | Mod Manager 里检查 Babel Tower 是否仍"已启用";pak 槽位可能被重新分配,重新用 Mod Manager 导入一次即可,无需重下完整包 |
| 其它 | 按[调试教程](docs/debugging.md)收集信息后[提 Issue](https://github.com/c1375rick/BabelTower/issues) |

## 许可证与致谢

- 本项目代码:**GNU GPL v3**,见 [LICENSE](LICENSE) 与 [LICENSE_NOTICE.md](LICENSE_NOTICE.md)
- 原版聊天布局结构(chat.xml 中的 Valve 素材片段):保留原样以保证功能,版权归 Valve
- 技术路线参考:RogueCore Chat Translator(UE4SS 思路)、
  Hantu-Raya/Deadlock-mods-collection(Apache-2.0,提供了原版 chat.xml 反编译与
  Panorama 轮询模式参考)、plainheart/bing-translate-api(公共接口协议参考)

### 贡献者:Thirt927

本项目合并了 [Thirt927](https://github.com/Thirt927) 的 `optimizations` 分支核心功能,包括:

- **多翻译接口支持**:DeepL / Google / OpenAI 兼容接口(可在设置面板切换,支持回退链)
- **内置词典**:`config/dictionary.builtin.json`(2801 条,JSON 文件无法内联注释,贡献记录于此)
- **大厅聊天翻译**:HUD 顶栏与大厅聊天记录支持(`hudchat.xml`)
- **聊天日志**:按比赛 ID 落盘到 `logs/chat/`

上述贡献按 GPL-3.0 §5 要求,在合并文件头部标注 `// Contributor: Thirt927`,保留原始版权声明。

## AI 辅助开发声明

本项目在开发过程中使用了 AI 编程助手(OpenClaw)辅助完成以下工作:
- 代码编写与调试,以及聊天行回收、串行队列等缺陷的定位与修复
- 模拟测试框架(lingua_chat_simtest.js)的编写,用于在无真人队友的环境下回归验证翻译功能
- 构建/发布脚本的编写与维护

以上所有代码均由作者审查并测试后发布;作者对项目的功能、质量与合规性负全责。

### Windows 图形界面启动器（第三方，可选）

[BabelTowerLauncher — 巴别塔启动器](https://github.com/alloywr147/BabelTowerLauncher)
是独立维护的 Windows x64 可视化启动与更新管理器，适用于官方 Windows 便携完整包。

支持游戏与安装目录自动检测、启动前检查本地桥和翻译接口、
拖入压缩包更新，以及桥重启与诊断。

- [下载启动器](https://github.com/alloywr147/BabelTowerLauncher/releases)
- [使用说明与已知限制](https://github.com/alloywr147/BabelTowerLauncher#readme)

当前为测试版，启动器压缩包不包含 Mod 本体。
