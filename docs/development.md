# 开发文档

## 1. 当前状态与验证情况

**本地桥(core/)**:已实现并通过本地端到端测试
(health / config 读写与打码回传 / translate 与 test 的真实 HTTP 链路;
Bing 免 Key 与 Microsoft 双服务商均已实测,真实译文验证通过)。

**游戏内 Panorama(mod/)**:**未在游戏内实际运行**,但已做两层静态验证:

- 编译产物经 Source 2 Viewer 19.2(Valve 官方参考实现)解编译,完整还原
  (含 `<HTML id="LCTBridgePanel" class="LCTBridgePanel" />` 声明、全部中文文本与处理器)
- 与 DLCT 已发布 VPK(`Deadlock\DLCT\pak01_dir.vpk`)解编译结果逐项对照,
  关键机制一致(见下)

### 已确认的技术事实(通过 DLCT VPK 解编译验证,2026-08-03)

1. **HTML 面板必须用 XML `<HTML id="..." />` 标签声明**
   (运行时 `$.CreatePanel("HTML", ...)` 不会得到可用的 HTML 面板;
   DLCT 声明为 `<HTML id="DlctBridge" class="DlctBridge" />`)
2. **加载方法:`panel.SetURL(url)`**(不是 BLoadUrl)
3. **读回:`panel.title`**(页面把 `id+JSON` 写进 document.title,Panorama 轮询读取;
   DLCT 另有 GetAttributeString 兜底)
4. **提交处理器接管模式成立**:DLCT 的 TextEntry 同样改为
   `oninputsubmit="DeadlockChatTranslatorSubmit();"`(我方为 LCTOnChatSubmit)
5. 编译后字符串表存在后缀压缩(字节里 id 显示为碎片),但运行时与解编译均完整还原,
   不影响 findChild 查找
6. `resourcecompiler` 输出扩展名规范化为 `.vxml_c / .vjs_c / .vcss_c`

### 仍需游戏内验证/微调的点

1. **HTML 面板通道**:若译文仍不出现,看游戏控制台 `[LCT] bridge panel found;
   SetURL=yes/no` 与 `bridge online` 日志定位
2. **发送接管**:万一聊天发不出去,回退:chat.xml 的 TextEntry 改回
   `oninputsubmit="CitadelChatInputSubmitted();"`(失去 /tr 与发送前翻译,收发正常)
3. 设置面板定位(负偏移)与 ToggleButton 文本显示,需游戏内微调 CSS
4. 聊天新消息类型(反编译 snippet 之外的)未渲染时,按缺失 snippet 补上

## 2. 冒烟测试清单(首次进游戏)

1. 用 `StartDeadlock.bat` 启动(或手动 `node core\bridge_server.js` 再开游戏)
2. 训练场/机器人房间打开聊天,发一条外语消息
3. 期望:几秒内消息下方出现译文;桥控制台出现 `translate ok` 日志
4. 设置面板:`/tr` 打开 → 服务商 bing → 测试 → 保存(无需任何 Key)
5. 聊天滚动(消息多到回收)后,译文应从缓存重建
6. 打开 VConsole / Panorama 调试器,确认无 `[LCT]` 相关报错

## 3. 构建

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Csdk12Root "F:\SteamLibrary\steamapps\common\Deadlock\Reduced_CSDK_12"
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

## 5. 常见问题

- **桥端口被占用**:桥会自动静默退出(认为已有实例),属正常
- **改了 config.json 不用重启?**:config 每次请求时重新读取,改完即生效
- **Key 显示为 **********:打码显示;留空保存 = 清除 Key
- **日志里有 Key?**:不应该有;若发现,视为 bug 提交
- **Bing 接口 429/限流**:公共接口有隐形限流,连发测试会短暂 400;等 1 分钟自动恢复(桥内已做指数退避重试)
- **Bing 接口 401/403**:2026-09-19 已切换 Edge 免鉴权端点(无需 token),正常不会再出现 token 失效类 401;
  若再现,多为微软接口变动,对照 docs/architecture.md §6 的协议变更历史处理
- **调试工具**:`tools\Source2Viewer-CLI.exe`(VRF 19.2)可解编译 .vxml_c/.vjs_c 等
