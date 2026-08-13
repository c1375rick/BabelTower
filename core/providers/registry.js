// Contributor: Thirt927 (https://github.com/Thirt927/BabelTower), merged 2026-08-13 under GPL-3.0
﻿// Babel Tower - Provider 娉ㄥ唽琛?// 鍐呯疆:
//   bing      Bing Translator(鍏叡鍏嶈垂鎺ュ彛,鍏?Key,榛樿)
//   microsoft Microsoft Translator(Azure,闇€鑷繁鐨?Key,璐ㄩ噺/棰濆害鏇寸ǔ)
// 鍚庣画 Provider(DeepL / OpenAI 鍏煎 / Ollama 绛?鍙渶鍦?providers/ 涓嬫柊澧炴枃浠?// 骞跺湪涓嬫柟娉ㄥ唽,鍗冲彲琚?Core 浣跨敤,娓告垙渚ф棤闇€鏀瑰姩銆?"use strict";

const providers = {
  bing: require("./bing"),
  microsoft: require("./microsoft"),
  openai: require("./openai"),
  deepl: require("./deepl"),
  google: require("./google"),
};

function getProvider(id) {
  return providers[id] || null;
}

function listProviders() {
  return Object.keys(providers).map((id) => ({ id, label: providers[id].label }));
}

module.exports = { getProvider, listProviders };
