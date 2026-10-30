// docs/btipc-https-v1.md 追加 §12:第三路径对照——OCR 屏幕识别(获取层)
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "..", "docs", "btipc-https-v1.md");
let t = fs.readFileSync(f, "utf8");
if (t.includes("## 12. 第三路径对照:OCR 屏幕识别")) { console.log("already present"); process.exit(0); }

const sec = [
  "",
  "## 12. 第三路径对照:OCR 屏幕识别(2026-10-30)",
  "",
  "> 补全三路对照:§11 评的是**传输层**(CEF hash/nav vs BTIPC);第三条路——**OCR 屏幕",
  "> 识别**——根本不在传输层,它在**获取层**(怎么拿到聊天文本)。代表项目:",
  "> [RSTGameTranslation](https://github.com/thanhkeke97/RSTGameTranslation)(OneOCR/",
  "> Windows OCR,明确支持聊天窗口)、[TranslateOverlay](https://github.com/chiutse/TranslateOverlay)、",
  "> [OCR-Translator](https://github.com/tomkam1702/OCR-Translator) 等。用户在 https 方案调研期",
  "> 提及此路,本节补正式对照。",
  "",
  "### 12.1 三路径对照(同一场翻译要过三道关:获取 → 传输 → 回显)",
  "",
  "| | ① CEF 面板(hash/nav,本项目主路) | ② BTIPC(本项目兜底) | ③ OCR 屏幕识别(外部路线) |",
  "| --- | --- | --- | --- |",
  "| 所在层 | 传输(获取仍是 Panorama DOM) | 传输(获取同左) | **获取**(截屏 + OneOCR/Windows OCR/PaddleOCR) |",
  "| 文本获取 | `scanChatMessages` 直读 DOM:结构化(**发送者/队伍/频道元数据齐全**) | 同左(BTIPC 只换传输) | 像素→文本:**无元数据**;小字号/花体/背景干扰;译文标签同屏会互相污染(需区域管理) |",
  "| 引擎依赖 | 重(CEF 面板行为 + DOM 结构,10-29 三连击证明) | 中(Image 面板 + 日志 tail,原始机制) | **获取层零引擎依赖**(引擎更新对它无感)——但对**渲染层**仍有区域假设 |",
  "| 延迟 | hash 1 RTT / nav +0.3-0.5s 页载 | 帧泵(config delta ≈7.8s;翻译多帧) | **+0.3~1s**(捕获+识别)再 + 翻译 |",
  "| 出站翻译 | ✓(输入框钩子,双语外发独有) | ✓ | ✗(发送前内容无法可靠截取;各 OCR 项目均为入站) |",
  "| 额外依赖 | 零(证书链已自愈化) | 零 | OCR 引擎(Windows OCR 免费/OneOCR/PaddleOCR)或云 API;持续截屏的 GPU/CPU 占用 |",
  "| 挂掉的样子 | 10-29:页面 JS 不执行/标题事件被砍 → 全灭(BTIPC 兜住) | 上/下行机制 6726 以来未被动过 | DOM 怎么变它都活着;但聊天框**挪位/缩放/换肤**会静默降准确率 |",
  "",
  "### 12.2 OCR 路线的真实优劣(就「聊天翻译」这个场景)",
  "",
  "- **它真正的优势**:获取层与引擎解耦——10-29 那种 CEF 层更新对它完全无感;且能覆盖",
  "  DOM 之外的文本(如未进 DOM 的系统提示)。这是它在获取层「天然的灾备位」。",
  "- **它真正的劣势**:①无元数据——发送者/敌我/频道全靠画面位置猜,而聊天框是最不该猜的",
  "  UI(本项目 `[[对手队]]/[[队伍]]` 标签、发信者头像、去重逻辑全依赖 DOM 结构);",
  "  ②**出站能力为零**——双语外发(1.2.0 起的招牌功能)没有获取问题可绕;③持续截屏",
  "  的性能税与隐私面;④聊天小字号 + 半透明背景是 OCR 准确率的重灾区。",
  "- **与本项目的关系**:不是竞争关系,是**不同层的备胎**。OCR 替换不了传输层(BTIPC 的位);",
  "  BTIPC 替换不了获取层(若 DOM 死了,BTIPC 运的是一个已经拿不到文本的管线)。",
  "",
  "### 12.3 组合可能与触发器",
  "",
  "- **获取层灾备**(远景):若某次引擎更新砍掉 `ChatMessages` DOM 读取(类比 10-29 对 CEF",
  "  层做的事),OCR 是唯一还能拿到聊天文本的路线。届时以「区域校准向导 + Windows OCR",
  "  (免费零依赖)」做降级获取,元数据损失接受为降级语义。",
  "- **触发器**:DOM 抓取(`scanChatMessages`)连续两次引擎更新失效 → 启动 OCR 降级获取",
  "  的 PoC(与 §11.4 的收敛路线互斥性为零:获取层与传输层独立演进)。",
  "- **现在不做**:获取层是本项目最稳的一段(6726 以来未变);先建观测,不背 OCR 依赖。",
  "",
  "### 12.4 决议",
  "",
  "- 三路径各占一层:**获取(Panorama DOM,备选 OCR)/ 传输(CEF hash 首选,BTIPC 兜底) /**",
  "  回显(译文标签 + 网页设置页)**——层间不可互相替代,灾备按层独立储备**。",
  "- 本节与 §11 合读:传输层的风险评估见 §11;获取层的灾备位记为 OCR,触发器见 12.3。",
].join("\n");

t = t.replace(/\r?\n$/, "") + "\n" + sec + "\n";
fs.writeFileSync(f, t, "utf8");
console.log("appended §12, new size=" + t.length);
