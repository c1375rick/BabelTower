// 离线测试:BTIPC framer(core/btipc/framer.js)
// §12.2 往返 + §3.3 位序正式例 + §3.2 BUSY 固定帧 + Assembler 幂等/gap + 篡改检出
// 跑法: node tests/btipc/frame.test.js   或   node --test "tests/**/*.test.js"
"use strict";
const {
  FRAME_BYTES, PAYLOAD_MAX, SEQ_MAX_FRAMES,
  encode, decode, busyFrame, buildFrame, frameCrc, crcInputOf,
  Assembler, bitsOf, fromBits,
} = require("../../core/btipc/framer.js");
const fs = require("node:fs");
const path = require("node:path");
const { crc16 } = require("../../core/btipc/crc16.js");
const { parseGameLine, REQ_MAX_PAYLOAD } = require("../../core/btipc/transport.js");

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS |", label); }
  else { fail++; console.log("  FAIL |", label); }
}

// ---------- §12.2 framer 往返 ----------
console.log("--- 往返 ---");
const texts = {
  "空消息": "",
  "10B(单帧整除)": "0123456789",
  "11B(跨帧)": "0123456789X",
  "300B 中文(多帧+END)": "汉".repeat(100),
};
for (const [label, text] of Object.entries(texts)) {
  const bytes = Buffer.from(text, "utf8");
  const frames = encode(0x00c8, text);
  const asm = new Assembler();
  let last = null;
  for (const f of frames) last = asm.add(f);

  const expectFrames = Math.max(1, Math.ceil(bytes.length / PAYLOAD_MAX));
  const tailLen = bytes.length === 0 ? 0 : ((bytes.length - 1) % PAYLOAD_MAX) + 1;

  ok(frames.length === expectFrames, `${label}:帧数 ${frames.length} = ${expectFrames}`);
  ok(frames.every((f) => f.length === FRAME_BYTES), `${label}:每帧 16B`);
  ok(frames.every((f, i) => (f[0] & 0x7f) === i), `${label}:seq 0..N 连续`);
  ok(frames.every((f, i) => ((f[0] & 0x80) !== 0) === (i === frames.length - 1)), `${label}:END 仅末帧`);
  ok(frames.every((f) => f.readUInt16BE(1) === 0x00c8), `${label}:id 贯穿`);
  ok((frames[frames.length - 1][3] & 0x7f) === tailLen, `${label}:末帧 LEN=${tailLen}`);
  ok(frames.every((f) => (f[3] & 0x80) !== 0), `${label}:数据帧 VALID=1`);
  ok(last && last.ok && last.done, `${label}:Assembler done`);
  ok(last && Buffer.compare(last.bytes, bytes) === 0, `${label}:解出逐字节相等`);
  ok(last && last.text === text, `${label}:text 还原`);
}

// seq7 上限:1280B = 128 帧;1281B 必须 throw
{
  const frames = encode(1, "a".repeat(1280));
  ok(frames.length === SEQ_MAX_FRAMES && (frames[127][0] & 0x7f) === 127, "1280B = 128 帧,seq 上限 127");
  let threw = false;
  try { encode(1, "a".repeat(1281)); } catch (e) { threw = e instanceof RangeError; }
  ok(threw, "1281B → throw(seq7 溢出防御)");
}

// ---------- §3.3 位序正式例子 ----------
console.log("--- 位序 §3.3 ---");
{
  const raw = Buffer.alloc(FRAME_BYTES);
  raw[0] = 0x01;
  raw[1] = 0xa5;
  const bits = bitsOf(raw);
  ok(bits[0] === 1 && bits.slice(1, 8).every((b) => b === 0), "B0=0x01 → panel0=1,panel1..7=0");
  ok(bits[8] === 1 && bits[9] === 0 && bits[10] === 1 && bits[11] === 0 &&
     bits[12] === 0 && bits[13] === 1 && bits[14] === 0 && bits[15] === 1,
     "B1=0xA5 → panel8,10,13,15=1;panel9,11,12,14=0");
  ok(bits.slice(16).every((b) => b === 0), "panel16..127 全 0");
  const fires = bits.map((b, i) => (b === 1 ? i : -1)).filter((i) => i >= 0);
  ok(fires.join(",") === "0,8,10,13,15", "fires = {0,8,10,13,15}");
  const back = fromBits(bits);
  ok(back[0] === 0x01 && back[1] === 0xa5 && back.subarray(2).every((b) => b === 0), "fromBits 反还原首两字节");
}

// ---------- §3.2 BUSY 固定帧 ----------
console.log("--- BUSY 固定帧 ---");
{
  const busy = busyFrame(0x00c8);
  ok(busy.length === FRAME_BYTES, "16B");
  ok(busy[0] === 0x00, "B0=0(seq0,END0)");
  ok(busy.readUInt16BE(1) === 0x00c8, "id 保留");
  ok(busy[3] === 0x00, "B3=0(VALID0,LEN0)");
  ok(busy.subarray(6).every((b) => b === 0), "payload 全 0");
  const d = decode(busy);
  ok(d.ok && d.valid === false && d.seq === 0 && d.end === false && d.len === 0, "decode:CRC ok + valid=false");
  ok(crcInputOf(busy).length === FRAME_BYTES - 2, "CRC 输入固定 14 字节");
  ok(frameCrc(busy) === busy.readUInt16BE(4), "CRC 字段与重算一致");
}

// ---------- 篡改检出(控制位全在 CRC 覆盖内) ----------
console.log("--- 篡改检出 ---");
{
  const mk = () => encode(0x1234, "hello")[0];
  const a = mk(); a[6] ^= 0x01;
  ok(decode(a).reason === "crc", "payload 翻 1 bit → crc 拒收");
  const b = mk(); b[0] ^= 0x02; // seq bit1
  ok(decode(b).reason === "crc", "seq 翻位 → crc 拒收(控制位在覆盖内)");
  const c = mk(); c[3] ^= 0x80; // VALID
  ok(decode(c).reason === "crc", "VALID 翻位 → crc 拒收");
  const d = mk(); d[4] ^= 0x80; // CRC 自身
  ok(decode(d).reason === "crc", "CRC 字节翻位 → 拒收");
  const e = mk(); e[1] ^= 0x10; // id
  ok(decode(e).reason === "crc", "id 翻位 → crc 拒收");
  ok(decode(mk().subarray(0, 15)).reason === "size", "15B → size 拒收");
  // 伪造 BUSY:VALID=0 但 payload 非 0(连 CRC 都算对)→ 固定格式拒收
  const forged = busyFrame(1);
  forged[6] = 0x01;
  forged.writeUInt16BE(frameCrc(forged), 4);
  ok(decode(forged).reason === "format", "伪造 BUSY(payload 非 0)→ format 拒收");
}

// ---------- Assembler:BUSY / 重复 / END 重放 / gap ----------
console.log("--- Assembler ---");
{
  const asm = new Assembler();
  ok(asm.add(busyFrame(7)).busy === true, "BUSY → busy 标记,不入账");
  const frames = encode(7, "abcdefghijEXTRA"); // 15B → 2 帧
  ok(frames.length === 2, "15B → 2 帧");
  ok(asm.add(frames[0]).done === false, "第 0 帧 → 未完成");
  ok(asm.add(frames[0]).done === false, "重复第 0 帧 → 幂等,仍未完成");
  const r = asm.add(frames[1]);
  ok(r.ok && r.done && r.text === "abcdefghijEXTRA", "END 帧 → 完成拼装");
  ok(asm.add(frames[1]).done === true, "END 重放 → 仍 done(幂等)");

  const asm2 = new Assembler();
  const gap = asm2.add(frames[1]); // 缺帧 0 直接收 END
  ok(gap.ok === false && gap.reason === "gap" && gap.missing === 0, "缺帧 0 → gap 拒收");
}

// ---------- buildFrame 参数校验 ----------
console.log("--- buildFrame 校验 ---");
{
  let threw = 0;
  const tryBuild = (o) => { try { buildFrame(o); } catch (e) { if (e instanceof RangeError) threw++; } };
  tryBuild({ seq: 128, id: 0, end: false, valid: true, payload: Buffer.alloc(0) });
  tryBuild({ seq: -1, id: 0, end: false, valid: true, payload: Buffer.alloc(0) });
  tryBuild({ seq: 0, id: 0x10000, end: false, valid: true, payload: Buffer.alloc(0) });
  tryBuild({ seq: 0, id: -1, end: false, valid: true, payload: Buffer.alloc(0) });
  tryBuild({ seq: 0, id: 0, end: false, valid: true, payload: Buffer.alloc(11) });
  ok(threw === 5, `seq/id/len 越界全部 throw(${threw}/5)`);
}

// ---------- 游戏侧内联副本对账(源: mod/panorama/scripts/lingua_chat_btipc.js §BTIPC)----------
// 2026-10-28:BTIPC 传输层从 lingua_chat.js 拆出,函数本体随迁 —— 对账改读新文件(语义不变)
// §12.1 铁律:两侧 crc16/decode/编码器必须逐字节一致;曾抓出代理对漏加 0x10000 的 emoji bug。
console.log("--- 游戏侧内联副本对账 ---");
{
  const linguaPath = path.join(__dirname, "..", "..", "mod", "panorama", "scripts", "lingua_chat_btipc.js");
  const src = fs.readFileSync(linguaPath, "utf8");
  const extract = (name) => {
    const start = src.indexOf("function " + name + "(");
    if (start < 0) return null;
    let depth = 0, i = src.indexOf("{", start);
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) break; }
    }
    return src.slice(start, i + 1);
  };
  const gNames = ["btipcCrc16", "btipcDecodeFrame", "btipcUtf8Decode", "btipcUtf8Bytes", "btipcBase64"];
  const parts = gNames.map(extract);
  const missing = gNames.filter((n, i) => !parts[i]);
  if (missing.length) {
    ok(false, "游戏侧内联函数缺失: " + missing.join(","));
  } else {
    // 间接 eval 把函数声明进全局;常量用 prelude 注入(与源内一致)
    const api = (0, eval)("const BTIPC_FRAME_BYTES = 16, BTIPC_PAYLOAD_MAX = 10;\n" + parts.join("\n") +
      "\n;({ a: btipcCrc16, b: btipcDecodeFrame, c: btipcUtf8Decode, d: btipcUtf8Bytes, e: btipcBase64 })");
    const gCrc = api.a, gDec = api.b, gU8d = api.c, gU8e = api.d, gB64 = api.e;

    // crc16: 标准向量 + 与桥端逐字节一致
    ok(gCrc([...Buffer.from("123456789", "ascii")]) === 0x29b1, "游戏侧 crc16 check 向量 0x29B1");
    let crcSame = true;
    for (let n = 0; n < 64; n++) {
      const arr = [...Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff))];
      if (gCrc(arr) !== crc16(Buffer.from(arr))) { crcSame = false; break; }
    }
    ok(crcSame, "游戏侧 crc16 与桥端 64 组输入逐字节一致");

    // utf8 双向(含 emoji 代理对 —— 曾漏 +0x10000)
    const gTexts = ["", "Hello BTIPC", "你好,BabelTower!", "😀🎉 emoji 混合 mix", "零一二三四五六七八九"];
    ok(gTexts.every((t) => Buffer.from(gU8e(t)).toString("utf8") === t), "游戏侧 utf8 字节 = Buffer(含 emoji)");
    ok(gTexts.every((t) => gU8d(gU8e(t)) === t), "游戏侧 utf8 编解码往返");

    // base64 与 Buffer 一致
    let b64Same = true;
    for (let n = 0; n <= 21; n++) {
      const arr = [...Buffer.from(Array.from({ length: n }, (_, i) => (i * 91 + 5) & 0xff))];
      if (gB64(arr) !== Buffer.from(arr).toString("base64")) { b64Same = false; break; }
    }
    ok(b64Same, "游戏侧 base64 与 Buffer 22 组长度一致");

    // decodeFrame 与桥端 framer 对账
    const gFrames = encode(0x00c8, "Hello BTIPC 你好");
    let decSame = true;
    for (const f of gFrames) {
      const d = gDec([...f]);
      const ref = decode(f);
      if (!(d.ok && ref.ok && d.seq === ref.seq && d.end === ref.end && d.id === ref.id &&
            d.len === ref.len && JSON.stringify(d.payload) === JSON.stringify([...ref.payload]))) {
        decSame = false;
        break;
      }
    }
    ok(decSame, "游戏侧 decodeFrame 与桥端逐字段一致");
    const gd = gDec([...busyFrame(0x00c8)]);
    ok(gd.ok && gd.valid === false && gd.seq === 0 && gd.len === 0, "游戏侧 BUSY 可解");
    const corrupt = [...gFrames[0]]; corrupt[0] ^= 0x02;
    ok(gDec(corrupt).ok === false, "游戏侧篡改拒收");

    // 游戏侧构造 REQ 行 → 桥端 parseGameLine 全链路 + 行长预算
    const rt = ["Hello BTIPC", "你好啊队友们我们这把打上路", "x"];
    let reqOk = true;
    for (const t of rt) {
      const bytes = gU8e(t);
      const line = "[PanoramaScript] [LCT] BTIPC REQ w=f3a1c2 id=00c8 len=" + bytes.length +
        " crc=" + ("0000" + gCrc(bytes).toString(16)).slice(-4) + " b64=" + gB64(bytes);
      const p = parseGameLine(line);
      if (!(p.ok && p.cmd === "REQ" && p.payload.toString("utf8") === t)) { reqOk = false; break; }
    }
    ok(reqOk, "游戏 REQ 行 ↔ 桥端解析全链路");
    const worst = gU8e("汉".repeat(Math.floor(REQ_MAX_PAYLOAD / 3))); // 汉=3B → 226 字 = 678B ≤ 680
    const worstLine = "[PanoramaScript] [LCT] BTIPC REQ w=f3a1c2 id=00c8 len=" + worst.length +
      " crc=" + ("0000" + gCrc(worst).toString(16)).slice(-4) + " b64=" + gB64(worst);
    ok(worst.length <= REQ_MAX_PAYLOAD && worstLine.length <= 1000 && parseGameLine(worstLine).ok,
       "最坏行长 " + worstLine.length + " 字符 ≤ 1000 且可解析");
  }
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
