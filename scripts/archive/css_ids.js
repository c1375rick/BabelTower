// 抠出编译 CSS 里的 id 选择器 / class 选择器,和本地文件 diff
// node scripts/css_ids.js <compiled.css> [localXml ...]
const fs = require('fs');

const [, , cssPath, ...locals] = process.argv;
if (!cssPath) {
  console.error('usage: node scripts/css_ids.js <compiled.vcss_c> [localXml ...]');
  process.exit(2);
}

const buf = fs.readFileSync(cssPath);
const s = buf.toString('latin1');

// 所有含关键词的上下文
const kw = process.env.KW;
if (kw) {
  let i = -1;
  while ((i = s.indexOf(kw, i + 1)) >= 0) {
    const a = Math.max(0, i - 120), b = Math.min(s.length, i + 120);
    console.log('--- ' + kw + ' @' + i + ' ---');
    console.log(s.slice(a, b).replace(/[^\x20-\x7e]/g, '.'));
  }
}

const idSel = [...new Set((s.match(/#[A-Za-z_][A-Za-z0-9_]{1,60}/g) || []))].map(x => x.slice(1));
const clsSel = [...new Set((s.match(/\.[A-Za-z_][A-Za-z0-9_]{2,60}/g) || []))].map(x => x.slice(1));

console.log('=== css id selectors (' + idSel.length + ') ===');
console.log(idSel.join('\n'));

if (locals.length) {
  const localIds = new Set();
  for (const f of locals) {
    if (!fs.existsSync(f)) continue;
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/id="([^"]+)"/g)) localIds.add(m[1]);
  }
  const missing = idSel.filter(x => !localIds.has(x));
  console.log('=== css ids NOT in local (' + missing.length + ') ===');
  console.log(missing.join('\n'));
}
