// Babel Tower - 英雄名简写表(从游戏官方本地化提取)
"use strict";
const HERO_ZH = {
  "Warden": "沃督",
  "Yamato": "大和",
  "Infernus": "炽焱",
  "Seven": "柒",
  "Vindicta": "薇妲",
  "Grey Talon": "灰爪",
  "Lady Geist": "盖斯特夫人",
  "Abrams": "亚伯兰",
  "Wraith": "灵魅",
  "McGinnis": "麦金妮",
  "Paradox": "悖论",
  "Dynamo": "奇能",
  "Kelvin": "开尔文",
  "Viscous": "魔液",
  "Haze": "岚梦",
  "Holliday": "哈雷黛",
  "Bebop": "比波普",
  "Calico": "卡厉可",
  "Mo & Krill": "莫克双雄",
  "Shiv": "希弗",
  "Ivy": "青藤",
  "Wrecker": "破坏王",
  "Lash": "劳什",
  "Akimbo": "阿金驳",
  "Pocket": "口袋",
  "Mirage": "蜃景",
  "Fathom": "海魇",
  "Vyper": "蝰邪",
  "Sinclair": "无双魔术师",
  "Trapper": "陷阱师",
  "Raven": "渡鸦",
  "Victor": "维克多",
  "Mina": "米娜",
  "Drifter": "孤猎",
  "Venator": "诛邪者",
  "Paige": "佩吉",
  "Boho": "波米",
  "The Doorman": "门侍",
  "Doorman": "门侍",
  "Swan": "天鹅舞伶",
  "Skyrunner": "御空行者",
  "Billy": "比利",
  "Rem": "雷姆",
  "Celeste": "赛凌",
  "Apollo": "阿波罗",
  "Graves": "格瑞墓",
  "Silver": "西尔芙"
};

// 前缀简写(3+ 字母且唯一匹配)+多词名首字母缩写
const HERO_ABBR = {};
const HERO_ABBR_OWNER = {};
(function () {
  for (const name of Object.keys(HERO_ZH)) {
    const zh = HERO_ZH[name];
    const hn = name.toLowerCase();
    const compact = hn.replace(/[^a-z]/g, "");
    const parts = hn.split(/[^a-z]+/);
    let initials = "";
    for (const p of parts) if (p) initials += p[0];
    if (initials.length >= 2 && initials.length < hn.length) {
      if (HERO_ABBR[initials] === undefined) { HERO_ABBR[initials] = zh; HERO_ABBR_OWNER[initials] = name; }
    }
    for (let L = 3; L < compact.length; L++) {
      const pre = compact.slice(0, L);
      if (HERO_ABBR[pre] === undefined) { HERO_ABBR[pre] = zh; HERO_ABBR_OWNER[pre] = name; }
    }
    if (HERO_ABBR[compact] === undefined) { HERO_ABBR[compact] = zh; HERO_ABBR_OWNER[compact] = name; }
  }
})();

function lookupHeroAbbr(w) {
  if (typeof w !== "string" || w.length < 2) return "";
  return HERO_ABBR[w.toLowerCase()] || "";
}

function isHeroAbbr(w) {
  return typeof w === "string" && Object.prototype.hasOwnProperty.call(HERO_ABBR, w.toLowerCase());
}

module.exports = { HERO_ZH, HERO_ABBR, lookupHeroAbbr, isHeroAbbr };
