# Babel Tower 无桥 CEF POC(实验产物)

任务书:[../docs/poc_bridgeless_cef.md](../docs/poc_bridgeless_cef.md) · 结果:[RESULTS.md](RESULTS.md)

**只做验证,不做产品化**。未改任何 1.2.5 正式代码/产物;未起任何桥。

## 目录

| 路径 | 说明 |
| --- | --- |
| `RESULTS.md` | POC 结果 + GO/NO-GO(主交付物) |
| `pages/index.html` | 托管页(**S1–S5 全部页面逻辑**,单文件内联 JS)。已发布到 `https://c1375rick.github.io/babeltower-poc-pages/` |
| `vpk/src/panorama/layout/hudchat.xml` | POC 布局(覆盖 HUD 聊天布局,声明 `CitadelHTMLPanel id=LCTPocPanel`) |
| `vpk/src/panorama/scripts/poc_boot.js` | POC 面板引导脚本(SetURL 远程页 + HTMLTitle 监听 + hash 上行 + 自动 S2/S3/S4/S5 序列) |
| `build_poc_vpk.ps1` | 独立 vpk 构建(**不碰 dist/**;产物 `pak90_dir.vpk`) |
| `pak90_dir.vpk` | POC vpk(独立槽位 90)。**已安装到 addons**(2026-10-31,见下) |
| `pak15_parked.vpk` | 被暂时移出的正式 mod 包(514412 B,sha256 `688A12F4…`)。**测完必须移回** |
| `tail_poc.ps1` | 跟随 `console.log` 过滤 `[POC]` 的小工具 |
| `sim/poc_sim.js` | 模拟环境:假 Panorama + 假 CEF(复用仓库 `tests/sim/panorama_mock.js` 思路,**去掉了真桥依赖**) |
| `sim/run_poc_sim.js` | 模拟运行 S1/S2/S3/S5(+S4 管道),输出 `out/sim_results.json` |
| `probe_cors_headers.js` | Node 带 `Origin` 头的 CORS 头裸探测(旁证用,非权威) |
| `.pages-repo/` | Pages 仓库的本地克隆(gitignore;内容镜像 `pages/index.html`) |

## 跑模拟环境

```powershell
F:\BabelTower\portable-node\node.exe F:\BabelTower\poc\sim\run_poc_sim.js
```

> 注:任务书禁区 3 禁止起正式桥(`core/bridge_server.js`)。仓库自带的
> `tests/lc_sim_channel.test.js` 会起一个 8793 端口的真桥——**与无桥 POC 无关且被禁区覆盖,
> 故未运行**。本 POC 的模拟环境按同样的"假 Panorama + 假 CEF + 真页面 JS"范式自建,
> 但没有桥:页面直调公网端点(与无桥路线一致)。

## 构建 POC vpk

```powershell
powershell -ExecutionPolicy Bypass -File F:\BabelTower\poc\build_poc_vpk.ps1
```

依赖 `F:\dev-tools\Reduced_CSDK_12` 的 resourcecompiler 与 `tools\vpkeditcli.exe`。
源码会临时暂存到 `<CSDK>\content\citadel_addons\pocpano`(专用 addon 名,**不碰 linguachat**)。

## 真机测试(已测完,现场已恢复)

结果见 [RESULTS.md](RESULTS.md):**S1–S5 真机 CEF 全部通过**(2 次启动)。现场已还原
(`pak90` 已删、`pak15` 已移回并核对 514412 B / sha256 `688A12F4…`)。

**测试期间的盘面(历史记录)**

| 位置 | 文件 | 说明 |
| --- | --- | --- |
| `addons\pak15_dir.vpk` | **已移出** | 正式 1.2.5 mod,暂停用 |
| `poc\pak15_parked.vpk` | 514412 B | 移出的正式包(sha256 `688A12F4…B1C6`) |
| `addons\pak90_dir.vpk` | 11719 B | **POC 包,已安装** |

命名说明:任务书示例是 `pak90_poc_dir.vpk`,但引擎/DMM 只加载 `pakNN_dir.vpk`(NN 纯数字,
见 `core/pak_scan.js` 与安装脚本的 `^pak\d+_dir\.vpk$` 匹配),故用 `pak90_dir.vpk`。

**测试步骤**

1. 用 `-condebug` 启动 Deadlock(游戏当前未运行)。
2. 另开一个窗口跑 `powershell -ExecutionPolicy Bypass -File F:\BabelTower\poc\tail_poc.ps1`,
   看 `[POC]` 行(S1 会先出 `title=POC-ALIVE …`,随后 S2/S3/S4/S5 依次出)。
3. 观察点:
   - **完全没有 `[POC]` 行** → 我们的 HUD 布局被别的 pak 抢了(`pak03_dir.vpk` = QOL Lock
     也带 `hudchat.vxml_c`;按槽位应 pak90 胜出,若没胜出改用更高槽位或临时移走 QOL)。
   - `S1 ALIVE` 没出现 → 真 CEF 没加载公网页或没回标题(退出条件)。
4. 跑完 **恢复现场**:
   ```powershell
   Remove-Item 'C:\SteamLibrary\steamapps\common\Deadlock\game\citadel\addons\pak90_dir.vpk'
   Move-Item  'F:\BabelTower\poc\pak15_parked.vpk' `
              'C:\SteamLibrary\steamapps\common\Deadlock\game\citadel\addons\pak15_dir.vpk'
   # 核对:字节数 514412,sha256 688A12F49C76B6284A79E3ED7A655C6FCA6A12CB3D3214918BA2EEEDFB17B1C6
   ```
   **两个动作都必须在游戏退出后做。**

## 修改指引

- 页面逻辑改 `pages/index.html`,再 `git -C poc\.pages-repo` 同步并 push(触发 Pages 重建)。
- POC 脚本改 `vpk/src/panorama/scripts/poc_boot.js`,再 `build_poc_vpk.ps1` 重打包。
- 页面 URL 在游戏里由 `poc_boot.js` 顶部的 `PAGE_URL` 决定;模拟环境用 `globalThis.POC_PAGE_URL` 覆盖。
