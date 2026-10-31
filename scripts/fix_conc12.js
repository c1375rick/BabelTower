// 修复评审 finding conc-1/conc-5:resolveOutgoingTarget 改为 convar 优先。
// 背景:双上下文(chat.xml/hudchat.xml 各一个脚本实例)——差分应用发生在拉取的上下文,
// 另一个上下文的 State.cfg.outgoingTarget 滞后(最多 60-120s)。convar(lct_ui)是
// 跨上下文全局共享的,saveUiConfig(Convars.SetValue)在差分应用时立即写入——
// convar 是唯一的跨上下文新鲜源。同上下文时 convar==State.cfg,无回退风险。
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let t = fs.readFileSync(f, "utf8");
let n = 0;

const oldFn = [
  "  function resolveOutgoingTarget() {",
  "    let lang = State.cfg.outgoingTarget || \"en\";",
  "    if (lang === \"custom\") {",
  "      lang = fieldValue(\"LCTOutgoingTargetCustom\") || \"en\";",
  "    }",
  "    return lang;",
  "  }"
].join("\n");
const newFn = [
  "  function resolveOutgoingTarget() {",
  "    // 2026-10-31 评审修复(conc-1/conc-5):convar 优先——双上下文下,差分应用发生在",
  "    // 拉取的上下文,另一上下文的 State.cfg.outgoingTarget 滞后 60-120s;",
  "    // convar(lct_ui)是全局共享的,saveUiConfig 在差分应用时立即写入——它是唯一",
  "    // 的跨上下文新鲜源。同上下文时 convar==State.cfg,顺序无回退风险。",
  "    try {",
  "      if (typeof Convars !== \"undefined\" && Convars.GetStr) {",
  "        const raw = Convars.GetStr(UI_CONVAR, \"\");",
  "        if (raw) {",
  "          const j = JSON.parse(raw);",
  "          if (j && typeof j.outgoingTarget === \"string\" && j.outgoingTarget) return j.outgoingTarget;",
  "        }",
  "      }",
  "    } catch (e) {}",
  "    let lang = State.cfg.outgoingTarget || \"en\";",
  "    if (lang === \"custom\") {",
  "      lang = fieldValue(\"LCTOutgoingTargetCustom\") || \"en\";",
  "    }",
  "    return lang;",
  "  }"
].join("\n");
if (t.includes(oldFn)) { t = t.replace(oldFn, newFn); n++; console.log("resolveOutgoingTarget: convar 优先"); }
else { console.error("fn anchor missing"); process.exit(1); }

// conc-2:陈旧差分丢弃后触发一次立即重同步(否则干等 60s 轮询)
const oldDiscard = [
  "        if (reqRev && State.cfgRev && State.cfgRev !== reqRev) {",
  "          log(\"cfg sync: stale delta discarded (reqRev=\" + reqRev + \" cur=\" + State.cfgRev + \")\");",
  "          return false;",
  "        }",
].join("\n");
const newDiscard = [
  "        if (reqRev && State.cfgRev && State.cfgRev !== reqRev) {",
  "          log(\"cfg sync: stale delta discarded (reqRev=\" + reqRev + \" cur=\" + State.cfgRev + \")\");",
  "          // conc-2 评审修复:丢弃后 2s 立即重同步(携带已推进的 rev,一次即收敛),",
  "          // 不干等 60s 兜底轮询。重试发送的是当前 rev → 桥历史必有基线 → 一轮收敛。",
  "          try { $.Schedule(2.0, function () { try { syncConfigDelta(onDone); } catch (eR) {} }); } catch (eR2) {}",
  "          return false;",
  "        }",
].join("\n");
if (t.includes(oldDiscard)) { t = t.replace(oldDiscard, newDiscard); n++; console.log("陈旧差分丢弃后 2s 重同步"); }
else { console.error("discard anchor missing"); process.exit(1); }

fs.writeFileSync(f, t, "utf8");
console.log("done, edits=" + n);
