// 派生 gb_update_124.js:复制 gb_update_122.js 成熟流程,替换版本串。
const fs = require("fs");
const path = require("path");
let t = fs.readFileSync(path.join(__dirname, "gb_update_122.js"), "utf8");
t = t.replace(/const NEW_VERSION = "1\.2\.2";/, 'const NEW_VERSION = "1.2.4";');
t = t.replace(/BabelTower-1\.2\.2-win64\.zip/g, "BabelTower-1.2.4-win64.zip");
t = t.replace(/GameBanana 1\.2\.2 update/, "GameBanana 1.2.4 update");
t = t.replace(/node scripts\\gb_update_122\.js/g, "node scripts\\gb_update_124.js");
fs.writeFileSync(path.join(__dirname, "gb_update_124.js"), t, "utf8");
console.log("written gb_update_124.js, size=" + t.length);
console.log("NEW_VERSION 1.2.4: " + t.includes('const NEW_VERSION = "1.2.4";'));
console.log("zip 名 1.2.4: " + t.includes("BabelTower-1.2.4-win64.zip"));
console.log("残留 1.2.2 引用(应只剩注释): " + (t.match(/1\.2\.2/g) || []).length);