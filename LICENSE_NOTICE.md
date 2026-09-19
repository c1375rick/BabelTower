# LICENSE NOTICE

本 Mod 为**独立实现**,不包含任何现有 Mod 的源代码、资源或标识。
以下内容仅为技术路线与素材来源的说明。

## 1. 本项目代码

- 许可证:GNU General Public License v3.0(见 [LICENSE](LICENSE))
- 内部代号 LCT / lingua_chat 与对外品牌 Babel Tower 指同一项目

## 2. Valve 游戏素材(保留原样,版权归 Valve)

`mod/panorama/layout/chat.xml` 中的聊天布局结构片段
(ChatMessage / ChatMessageSource / ChatMessageContents_* / ChatMessageSender_* 等
snippet,以及 ChatLinesArea / ChatMessages / ChatControls / ChatInput 等 ID 与属性)
来自《Deadlock》原版 `panorama/layout/chat.xml` 的反编译重建
(Source 2 Viewer 19.2.0.0 输出)。保留这些片段是为了保证覆盖布局后聊天功能
与引擎数据绑定不损坏。版权归 Valve Corporation。

## 3. 参考过的公开项目(仅借鉴思路,未复制代码)

### Hantu-Raya/Deadlock-mods-collection(Apache-2.0)

- 提供了原版 `chat.xml` 的 Source 2 Viewer 重建参考
  (`references/poker_chat.xml`,研究参考用途)
- `poker_chat_debug.js` 展示了 Panorama 轮询扫描 ChatMessages、
  `$.DispatchEvent("CitadelChatInputSubmitted", ...)` 触发原版发送等
  **公开 API 用法模式**(API 用法本身不属于可版权表达)
- 其仓库 AGENTS.md 提供了 Source 2 Panorama 运行时约束的知识参考

### RogueCore Chat Translator(异动核心聊天翻译,UE4SS)

- 聊天翻译"本地服务 + 界面注入"的产品思路参考

### plainheart/bing-translate-api(MIT)

- Bing/微软公共翻译接口的协议参考(2026-09-19 起采用其 MET 模式同款
  Edge 免鉴权端点 edge.microsoft.com/translate/translatetext;
  早期为 Bing 网页翻译 ttranslatev3 + 页面参数提取)

### 其它

- Deadlock Chat Translator(DLCT):调研对象,其"隐藏 HTML Panel + localhost Bridge"
  技术路线与本地桥安全原则等思路被借鉴;**未复制其代码、协议、标识、配置结构或 UI**

## 4. 第三方组件

- 运行时无第三方 npm 依赖(仅 Node.js 内置模块)
- 翻译服务:Bing 公共接口(免 Key)或 Microsoft Translator v3(用户自备 Azure Key)

## 5. 其他

- 游戏内截图/展示时请勿泄露自己的 API Key
- 本项目与 Valve 无关,未经 Valve 认可
