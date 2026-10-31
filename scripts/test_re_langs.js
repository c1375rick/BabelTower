// 旧新正则对俄语/韩语/日语的判定对照(文件版,排除控制台编码干扰)
const oldRe = /^[\d\s\W_]+$/;
const newRe = (t) => !/\p{L}/u.test(t);

const ru = "\u041f\u0440\u0438\u0432\u0435\u0442, \u0438\u0434\u0435\u043c \u043c\u0438\u0434"; // Привет, идем мид
const ko = "\uc548\ub155\ud558\uc138\uc694";
const ja = "\u3053\u3093\u306b\u3061\u306f";
const num = "123 456";
const en = "gg wp";
const zh = "\u4f60\u597d";

console.log("俄语:  旧=" + (oldRe.test(ru) ? "跳过" : "翻译") + "  新=" + (newRe(ru) ? "跳过✗" : "翻译✓"));
console.log("韩语:  旧=" + (oldRe.test(ko) ? "跳过" : "翻译") + "  新=" + (newRe(ko) ? "跳过✗" : "翻译✓"));
console.log("日语:  旧=" + (oldRe.test(ja) ? "跳过" : "翻译") + "  新=" + (newRe(ja) ? "跳过✗" : "翻译✓"));
console.log("纯数字: 旧=" + (oldRe.test(num) ? "跳过✓" : "翻译✗") + "  新=" + (newRe(num) ? "跳过✓" : "翻译✗"));
console.log("英文:  旧=" + (oldRe.test(en) ? "跳过✗" : "翻译✓") + "  新=" + (newRe(en) ? "跳过✗" : "翻译✓"));
console.log("中文:  旧=" + (oldRe.test(zh) ? "跳过" : "翻译") + "  新=" + (newRe(zh) ? "跳过" : "翻译"));
