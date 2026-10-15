# Deadlock 6726 Panorama 接口普查
## 读消息文本 / 对外通信能力全景(BabelTower 视角)

> 生成:2026-10-01 · 游戏版本 6726(City Never Sleeps,9/29 构建)
> 方法:Source2Viewer-CLI 19.2.0 解包 `pak01_dir.vpk` 全部 panorama 内容(434 XML + 438 CSS 全量解包分析)
> + exp6726b~h 七轮游戏内实车验证(console.log + 桥日志双源)
> 解包产物:`/tmp/dl6726/panorama/`(临时目录,重解包命令见文末)

---

## 1. 架构总判断(最重要的事实)

**整个游戏 0 个 panorama JS 文件。**

| 类型 | 数量 | 说明 |
|---|---|---|
| vxml_c(布局) | 434 | 全部声明式 |
| vcss_c(样式) | 438 | 全部内部资源 |
| vjs_c / 任何 JS | **0** | `panorama/scripts/` 目录不存在 |

Deadlock 的 UI 是"薄 UI":434 个 XML 里的自定义面板(`CitadelChat`、`CitadelAvatarImage`、
`CitadelHTMLPanel`、`AsyncDataPanel`、`CitadelUserName`…约 200 种)全部是 **C++ 实现的引擎面板**,
聊天数据、玩家数据、网络请求全在 C++ 层,XML 只负责摆位置。

**推论(解释了 9/17 与 9/30 的封锁)**:全局 `$` 的那 29 个 JS API 是给 mod 留的兼容层,
V 社自己不用 → 内部没有"别改坏自己"的压力 → 可以无痛掏空任何 JS 函数。
`$.AsyncWebRequest` 就是这么死的:9/17 后函数仍在、`typeof === "function"`,但调用返回 undefined。
**任何"typeof 检查通过 = API 可用"的假设在 6726 上都不成立。**

---

## 2. 读取消息文本的途径

BabelTower 收译链路 = 轮询 DOM。可用面如下:

| 途径 | 状态 | 说明 |
|---|---|---|
| DOM 轮询(ChatMessages 容器) | ✅ 在用,6726 仍工作 | `chat.xml` 结构未变:7 个 snippet,`ChatMessage` 行含 `MessageSource`/`MessageContents`;`{s:message_text}` 等绑定不变 |
| `Label.text` 读文本 | ✅ 在用,仍工作 | exp6726c 日志确认 DOM 走查正常产出翻译请求 |
| `html="true"` 富文本 Label | 存在 | 仅 Ping 行(`PingLabel`)使用,消息正文是普通 Label |
| `$.RegisterForUnhandledEvent` 事件总线 | 未证实有聊天事件 | BRIDGE_EVENT_CANDIDATES 注册过,6726 上未观察到事件到达 |
| C++ 面板内部数据 | ❌ 不可达 | `CitadelChat` C++ 管理聊天真数据,DOM 是投影;无 JS 接口可拿原始流 |

结论:**读文本不受影响**,问题从来不在读,在"把文本送出去翻译再拿回来"。

---

## 3. 对外通信通道全表(核心)

### 3.1 JS 层

| 通道 | ≤9/16 | 6726 现状 | 验证证据 |
|---|---|---|---|
| `$.AsyncWebRequest(url, opts)` | ✅ 直连 GET 主通道 | ❌ **空壳桩**:函数存在(name=AsyncWebRequest, length=0),期权式/单参/回调式三种调用全部返回 `undefined` 且**不抛异常**,无 resolved/rejected,外网 URL 同样无效 | exp6726e:diag-awr v1~v4 |
| `$.Schedule` / `$.CreatePanel` / DOM API | ✅ | ✅ 仍工作(29 个全局 $ 函数齐全) | 每轮 exp 日志 |
| `$.RegisterForUnhandledEvent` | ✅ 注册成功 | 注册成功但未见事件(存疑,无实用通道) | exp6726b |

### 3.2 HTML 面板通道

| 通道 | ≤9/16 | 6726 现状 | 验证证据 |
|---|---|---|---|
| `<HTML>` 面板 `SetURL()` | ✅ /bridge 页面 + title 轮询 | ❌ **静默忽略**:调用不抛异常,桥日志 **0 次请求**(60+ 次导航零到达);`panel.title` 属性已删除(typeof undefined)→ 回读同样死 | exp6726b/c:diag-nav、diag-title×160+、桥日志 GET /bridge = 0 |
| `<HTML>` 面板新方法 | — | 枚举 60 方法无导航 API;新增 `SetCompositionLayerTextureName`/`WriteCompositionLayerPNG/JPEG` → 疑改合成层纹理渲染 | exp6726c:diag-panel-props1~3 |
| 激活假设(不可见导致不加载) | — | ❌ 排除:visible=true + 激活 + 换 class 后依然 0 请求 | exp6726b:diag-activate |

### 3.3 Image 面板通道(✅ 唯一存活的外部加载)

| 通道 | 6726 现状 | 验证证据 |
|---|---|---|
| `Image.SetImage("http://...")` 远程加载 | ✅ **请求真实到达本地桥** | exp6726f:桥日志 `IMG-HIT id=f1` |
| 运行时建 `<Image>` 面板 | ✅ 可行 | exp6726f:`$.CreatePanel("Image")` 成功 |
| **尺寸回读**(`actuallayoutwidth/height` 编码数据) | ❌ 恒 0:不可见面板 0(exp6726g),**可见面板 + 零样式 + 全部 6 项布局/内容/期望尺寸指标也全 0**(exp6726h)→ 引擎不再按图片固有尺寸布局,尺寸编码信道不通 | exp6726g/h:diag-dim ×50 采样 |

**关键佐证(为什么这条通道 V 社自己也在用)**:
`avatar_image.xml` 里 `CitadelAvatarImage` = 外框 `Image` + 内层 `Image`,XML 均无 src →
运行时由 C++ 注入 Steam CDN 头像 URL。**游戏自己的聊天头像就跑在这条 Image 外部加载通道上**,
mod 与游戏共用同一管线;V 社若封它需同时处理自家头像功能(域名白名单是可能的收口方式)。

### 3.4 其他引擎面板(普查结论)

| 面板 | 判定 |
|---|---|
| `CitadelHTMLPanel`(popup_news_post.xml,游戏内新闻网页框) | C++ 浏览器面板,**唯一值得继续实验的对象**:XML 声明 + JS 探针查其方法面(有无 SetURL/Navigate);无证据可被 mod 驱动,但成本一行 XML |
| `AsyncDataPanel`(新闻/资料/战绩页 ×7 处) | 纯展示组件:`state="{d:...}"` 由 C++ 注入,**无 URL 属性**,非 mod 网络口 |
| `MoviePanel` | 仅 `file://{resources}` 本地 webm |
| `panel://` src | 内部纹理引用(场景面板转 UI 纹理),非加载器 |
| `UICanvas` | 本地画布(取色器/小地图),无对外能力 |
| `<HTML>`(原生) | 6726 原生 XML 已无使用(仅我们 mod 在用);Label `html="true"` 只是富文本属性,与网络无关 |

### 3.5 声明面统计(外部 URL 清零的证据)

- 434 个 XML:外部 URL **0 个**(仅 Source2Viewer 反编译水印 434 处 + 官方论坛链接 1 处文本)
- 438 个 CSS:`url()` 全部 `s2r://` 内部资源,外部 URL **0 个**
- XML url 类属性(`*-url=`):**0 个**

结论:6726 在**声明层面已经完全闭合**,任何外部加载只能由 JS/C++ 运行时发起。

---

## 4. 6726 后 BabelTower 功能受影响面

| 功能 | 依赖通道 | 6726 状态 |
|---|---|---|
| 收到消息 → 译文显示 | 双向传输 | ❌ 全死 |
| 设置保存/读取(/api/v1/config) | 直连 | ❌ 死(设置仅本会话内存有效) |
| 聊天日志(/api/v1/log) | 直连 | ❌ 死 |
| 快捷语料/专名握手(/api/v1/quickchat 等) | 直连 | ❌ 死(兜底文件仍生效) |
| 桥健康显示 | 直连 | ❌ 死(永远显示未知/离线) |
| **发送前翻译** | 双向(需译文文本回填 TextEntry) | ❌ **6726 上无解**:一切文本回读通道被移除 |
| UI/设置面板本身 | 无 | ✅ 正常 |

---

## 5. 可行路径(按验证充分度排序)

### A. 桥渲染译文为 PNG,Image 面板显示(✅ 唯一已全链路验证的方向)
- 原理:不需要"读回"。译文在桥侧渲染成 PNG(系统字体),游戏 `Image.SetImage("http://127.0.0.1:8791/render?...")` 直接把像素显示为翻译气泡。
- 已验证:请求出得去(f1 IMG-HIT)、图片上屏(与游戏头像同管线);未验证:大图显示效果/缓存/清理,需 PoC。
- 代价:译文为像素(不可选中/复制);发送前翻译无解;桥需加渲染依赖(@napi-rs/canvas 或系统字体绘制)。
- 缓解:能力探测失败 → 静默降级显示原文(不弹窗不刷屏);通道代码独立可拔。

### B. `CitadelHTMLPanel` 探针(一行 XML 的成本,值得排队)
- mod chat.xml 声明 `<CitadelHTMLPanel id="LCTProbe"/>`,JS 枚举其方法面;若暴露导航 + title 类回读属性 → 恢复旧通道。
- 预期不高:它是 C++ 面板,JS 大概率只有通用 Panel 方法,但实验成本最低。

### C. 回退原版 VPK,等 Valve / 社区
- `pak15_dir.vpk.bak-diag-1001`(9/25 原版)随时可回滚;DeadlockLingua fork 同样中招,社区暂无公开方案。

### 不可能清单(6726 上无需再试)
- 任何形式的**文本读回**:AsyncWebRequest 空壳 / HTML title 删除 / 布局尺寸恒 0
- 发送前翻译(依赖文本读回)

---

## 6. 稳定性评估(这条通道能活多久)

- Image 外部加载:Panorama 十年常驻能力 + Deadlock 自家头像依赖 → **短期低风险**;
  中期风险 = 域名白名单(steamuserimages 等)一步收口,mod 无法绕过。
- JS API 兼容层:无内部使用压力,**任何残留函数可随时被掏空**,能力探测必须每次会话执行并支持运行时降级。
- 结论:按"随时可断"设计 — A 方案探测失败自动回退"显示原文",绝不妨碍聊天本体。

---

## 附:复现命令

```bash
# 解包(全部 layout + styles)
tools/Source2Viewer-CLI.exe -i "C:/SteamLibrary/steamapps/common/Deadlock/game/citadel/pak01_dir.vpk" \
  -d -f "panorama/layout" -e "vxml_c" -o /tmp/dl6726 --threads 8
tools/Source2Viewer-CLI.exe -i "C:/SteamLibrary/steamapps/common/Deadlock/game/citadel/pak01_dir.vpk" \
  -d -f "panorama/styles" -e "vcss_c" -o /tmp/dl6726 --threads 8

# 确认 0 JS
tools/Source2Viewer-CLI.exe -i .../pak01_dir.vpk --vpk_list -e "vjs_c"   # 输出为空

# 验证桥仍在的 Image 通道:桥日志应出现 IMG-HIT
# exp6726f 客户端日志: diag-img: SetImage sent -> http://127.0.0.1:8791/test.png?id=f1
```

## 实验版本索引(mod/panorama/scripts/lingua_chat.js,均未提交 git)
| 版本 | 内容 | 结果 |
|---|---|---|
| 1.0.3-diag | DIAG-6726 基础诊断 | 确认 AsyncWebRequest 消失、面板导航失败 |
| -fix6726 | localhost→127.0.0.1 | ❌ 无效 |
| -exp6726b | 面板可见+激活后再导航 | ❌ 仍 0 请求 |
| -exp6726c | 面板方法全枚举 | 无导航 API;title 类型 undefined |
| -exp6726d | 全局 $ 枚举 + ready-events | **发现 AsyncWebRequest 函数仍在**;ready 事件不触发 |
| -exp6726e | AWR 逐变体调用 | **实锤空壳桩**(v1~v4 全 undefined 不抛异常) |
| -exp6726f | Image SetImage 探针 + 桥 /test.png | **✅ 请求到达桥**(IMG-HIT f1) |
| -exp6726g/h | PNG 尺寸回读(133×77) | ❌ 布局尺寸恒 0(隐/显两种形态均 0) |
