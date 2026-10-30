const { execSync } = require("child_process");
const fs = require("fs");
const crypto = require("crypto");
const rel = JSON.parse(execSync("gh api repos/c1375rick/BabelTower/releases/tags/v1.2.4", { encoding: "utf8", maxBuffer: 20e6 }));
console.log("tag: " + rel.tag_name + "  target: " + (rel.target_commitish || "?") + "  draft: " + rel.draft + "  prerelease: " + rel.prerelease);
console.log("name: " + rel.name);
(rel.assets || []).forEach(a => {
  console.log("asset: " + a.name + "  size=" + a.size + "  digest=" + a.digest);
});
const localSha = crypto.createHash("sha256").update(fs.readFileSync("dist/BabelTower-1.2.4-win64.zip")).digest("hex");
const asset = (rel.assets || [])[0];
console.log("local  sha256: " + localSha);
if (asset) {
  const remote = (asset.digest || "").replace("sha256:", "");
  console.log((remote === localSha ? "✓ digest 一致" : "✗ digest 不一致!") + "  size " + (asset.size === fs.statSync("dist/BabelTower-1.2.4-win64.zip").size ? "一致" : "不一致"));
}