// §12 修正:代表项目换成锁语·LockLingo(用户指认的 OCR 路径项目),
// 用它的真实设计修正对照表(出站=剪贴板中继、区域校准成本被项目自身工具化证实)。
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "..", "docs", "btipc-https-v1.md");
let t = fs.readFileSync(f, "utf8");
let n = 0;

// ① 头部代表项目:LockLingo 置首(Deadlock 专用、真实竞品),通用类降为参考
const old1 = [
  "> 补全三路对照:§11 评的是**传输层**(CEF hash/nav vs BTIPC);第三条路——**OCR 屏幕",
  "> 识别**——根本不在传输层,它在**获取层**(怎么拿到聊天文本)。代表项目:",
  "> [RSTGameTranslation](https://github.com/thanhkeke97/RSTGameTranslation)(OneOCR/",
  "> Windows OCR,明确支持聊天窗口)、[TranslateOverlay](https://github.com/chiutse/TranslateOverlay)、",
  "> [OCR-Translator](https://github.com/tomkam1702/OCR-Translator) 等。用户在 https 方案调研期",
  "> 提及此路,本节补正式对照。",
].join("\n");
const new1 = [
  "> 补全三路对照:§11 评的是**传输层**(CEF hash/nav vs BTIPC);第三条路——**OCR 屏幕",
  "> 识别**——根本不在传输层,它在**获取层**(怎么拿到聊天文本)。**代表项目(Deadlock 专用,",
  "> 2026-10-31 用户指认):[锁语 · LockLingo](https://github.com/piaobo2233/deadlock-translator)",
  "> (MIT,Python + Tesseract 本机 OCR + OpenCV,安装包零额外依赖);同类通用工具:",
  "> [RSTGameTranslation](https://github.com/thanhkeke97/RSTGameTranslation)(OneOCR/Windows OCR)、",
  "> [TranslateOverlay](https://github.com/chiutse/TranslateOverlay)、[OCR-Translator](https://github.com/tomkam1702/OCR-Translator)。本节对照以 LockLingo 的真实设计为准。",
].join("\n");
if (t.includes(old1)) { t = t.replace(old1, new1); n++; }

// ② 对照表 OCR 列修正:出站翻译 ✗ → △(剪贴板中继);文本获取补"个人识别区域"
const old2 = "| 文本获取 | `scanChatMessages` 直读 DOM:结构化(**发送者/队伍/频道元数据齐全**) | 同左(BTIPC 只换传输) | 像素→文本:**无元数据**;小字号/花体/背景干扰;译文标签同屏会互相污染(需区域管理) |";
const new2 = "| 文本获取 | `scanChatMessages` 直读 DOM:结构化(**发送者/队伍/频道元数据齐全**) | 同左(BTIPC 只换传输) | 像素→文本:**无元数据**;小字号/背景干扰;区域假设是真成本——LockLingo 为此做了整套「个人识别区域」工具(拖框/放大/按分辨率保存) |";
if (t.includes(old2)) { t = t.replace(old2, new2); n++; }

const old3 = "| 出站翻译 | ✓(输入框钩子,双语外发独有) | ✓ | ✗(发送前内容无法可靠截取;各 OCR 项目均为入站) |";
const new3 = "| 出站翻译 | ✓(输入框钩子,**自动**双语外发) | ✓ | △ LockLingo 有——但走**剪贴板中继**(游戏内复制中文→译文回剪贴板→用户手动粘贴发送,默认关闭非自动);自动注入输入框无解 |";
if (t.includes(old3)) { t = t.replace(old3, new3); n++; }

// ③ 回显列补充:LockLingo 无法注入游戏 UI,译文在游戏外的字幕气泡
const old4 = "| 挂掉的样子 | 10-29:页面 JS 不执行/标题事件被砍 → 全灭(BTIPC 兜住) | 上/下行机制 6726 以来未被动过 | DOM 怎么变它都活着;但聊天框**挪位/缩放/换肤**会静默降准确率 |";
const new4 = "| 挂掉的样子 | 10-29:页面 JS 不执行/标题事件被砍 → 全灭(BTIPC 兜住) | 上/下行机制 6726 以来未被动过 | DOM 怎么变它都活着(引擎零集成,连 vpk 都没有);但聊天框**挪位/缩放/换肤**会静默降准确率——且译文只能显示在**游戏外的字幕气泡**(无注入通道) |";
if (t.includes(old4)) { t = t.replace(old4, new4); n++; }

// ④ 新增 12.2.1 实例小节(插在 12.3 之前)
const ins = [
  "",
  "### 12.2.1 实例:锁语 · LockLingo 的设计选择印证了上表(2026-10-31 核对)",
  "",
  "LockLingo 是 Deadlock 生态里 OCR 路径的完整实现(1.1.0,安装包零额外依赖),它的每个",
  "设计选择都能在上表找到对应行:",
  "",
  "- **本机 Tesseract + 个人识别区域工具**:区域假设的成本真实到值得做一整套校准 UI",
  "  (拖框/放大/按分辨率保存,不开游戏可导入局内截图调试)——印证「区域假设」行;",
  "- **外部字幕气泡显示**:OCR 路线没有任何注入游戏 UI 的通道(无 vpk),译文只能在",
  "  游戏外渲染——印证「回显」差异(本项目译文直接挂在聊天行下);",
  "- **出站走剪贴板中继且默认关闭**:OCR 拿不到输入框内容,只能借游戏复制 + 剪贴板",
  "  监听中继,且需要用户手动粘贴——印证「出站翻译 △」行;",
  "- **本地词库/记忆/缓存优先,API 可选**:对外部翻译服务的成本与延迟做了本地化缓冲",
  "  (本项目 provider 层等价物是 bing 免 Key + 多 provider 兜底);",
  "- **引擎零集成**:没有 vpk、没有 Panorama 脚本——10-29 那类更新对它**完全无感**,",
  "  这正是 OCR 路线在获取层的核心优势(§12.2 第一条);代价清单也如作者自述:",
  "  仅主屏全屏/无边框、4K/超宽/DPI 未验收、可能漏译误识别、无自动 HUD 定位。",
  "",
  "小结:LockLingo 证明了 OCR 获取层路线在 Deadlock 上**可行且可用**(MIT,值得尊敬的",
  "完整实现),同时它的每个补丁(区域工具/外部气泡/剪贴板中继)都在反证:获取层一旦",
  "能走 DOM(本项目),注入式回显与自动出站是 OCR 路线拿不到的体验。",
].join("\n");
if (!t.includes("### 12.2.1 实例")) {
  const anchor = "### 12.3 组合可能与触发器";
  t = t.replace(anchor, ins + "\n" + anchor); n++;
}

fs.writeFileSync(f, t, "utf8");
console.log("applied " + n + " edit(s), size=" + t.length);
