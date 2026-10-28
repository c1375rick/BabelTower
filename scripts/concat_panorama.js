#!/usr/bin/env node
// scripts/concat_panorama.js —— Panorama 脚本拼接器 / 跨文件契约检查器
// ---------------------------------------------------------------------------
// 用法:
//   node scripts/concat_panorama.js --files a.js b.js c.js --out out.js [--check-only]
//
// 为什么需要它:Panorama 没有模块系统,chat.xml / hudchat.xml 只能按序 include 多个
//   .vjs_c。源码侧的"模块化"只能靠**拼接**交付(未来把新功能写成独立 src 模块,
//   构建时拼进主文件)。拼接是否语义等价,只取决于两件事,本工具就是这两件事的检查器:
//     ① 重名:拼接后落在**同一作用域**的顶层声明会不会重复声明/互相覆盖;
//     ② TDZ:文件 N 的**顶层立即代码**是否引用了文件 M>N 里声明的顶层 const
//        (拼接后 N 先求值,而 const 尚未初始化 → ReferenceError)。
//
// 作用域模型(关键:别照"缩进 ≤ 2"的直觉改)
//   Panorama 的跨 script 契约只有**全局层**。各文件现在都是自包 IIFE
//   (main/panel/exp 是 `(() => {`,btipc 是 `var LCTBTIPC = (function () {`),
//   IIFE 体内的 indent-2 顶层在拼接后**仍然是各 IIFE 自己的函数作用域**,彼此不共享。
//   所以本工具按"声明落在哪个作用域"分组,而不是按缩进:
//     - GLOBAL:括号深度 ≤1 且函数嵌套深度 0 的声明(裸文件 = 直接落进拼接文件顶层;
//       以及 `var LCTBTIPC = ...` 这种深度 0 的声明)。**只有 GLOBAL 之间才判重名**。
//     - MODULE:<文件>:文件最外层那个 IIFE 体内的 indent-2 顶层声明。它只属于该文件
//       自己的 IIFE,跨文件永远不撞;但未来把模块**拼进**该 IIFE 时就会撞 → 作为
//       "提示"(不阻塞)报出来,供增量模块化时人工过目。
//   这是与"深度 0-1 一刀切"的唯一偏离,原因见下(实测发现):
//     lingua_chat_panel.js 第 33 行 `const { State, t, findChild, ... } = L;` 与主文件
//     的 `const State / function t` 同名——它们各自在自己的 IIFE 里,拼接后语义安全。
//     一刀切会把真机四文件报成 14 组重名,工具当场变成噪音源(详见交付报告)。
//
// 声明识别:逐行看括号深度;深度 ≤1 且不在嵌套函数里才算"顶层",再匹配
//   const/let/var/function/async function。字符串、注释、正则字面量先被抹成空格
//   (maskCode),所以它们里面的 `{}` / 关键字不会污染深度与声明识别。
// 前向引用:同一套深度跟踪给出"顶层立即代码"(不嵌在函数里的行内标识符,含 IIFE
//   体内、块内的立即执行代码),只与**更靠后文件的 GLOBAL const** 求交集;
//   函数体内的引用不算(调用时才解析),实测一行的 `function f(){ return X; }`
//   也能正确排除(逐字符扫描,不按行首快照)。
//
// 退出码:重名 = 2;仅有前向引用警告 = 0;正常 = 0;参数/文件错误 = 1。
//
// 未来启用(主文件模块化)时的接线方式:
//   1. 新功能写成 src/xxx.js,文件内**不要**再包 IIFE(它会被拼进主文件的 IIFE 内),
//      顶层用 indent-2 声明,名字带模块前缀(新名字天然不撞);
//   2. build.ps1 里在"拼进主文件"之前先跑
//        node scripts/concat_panorama.js --files src/xxx.js --check-only
//      当闸门(重名 = 退出码 2 → 构建失败),再看 stderr 的"提示"确认没和主文件
//      IIFE 顶层撞名;
//   3. 若要拼**整**文件(不是片段),把 --files 按装载顺序列全、--out 指向中间产物;
//      注意交付形态仍是多文件 .vjs_c(拼接器只是工具 + 验证器,本次不进构建流程)。
// ---------------------------------------------------------------------------
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_DUPLICATE = 2;

const BANNER_RULE = "═".repeat(6);

const KEYWORDS = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "export", "extends", "finally", "for", "function", "if",
  "import", "in", "instanceof", "let", "new", "return", "super", "switch", "this",
  "throw", "try", "typeof", "var", "void", "while", "with", "yield", "await",
  "async", "of", "static", "get", "set", "true", "false", "null", "undefined",
]);

const DECL_RE = /^(\s*)(async\s+function|const|let|var|function)(\s+)/;

// ---------------------------------------------------------------------------
// 1) 词法遮罩:注释 / 字符串 / 模板 / 正则字面量 → 空格(等长,换行保留)
//    只为了数括号、找标识符;不改变行号。
// ---------------------------------------------------------------------------
function maskCode(src) {
  const out = src.split("");
  const n = src.length;
  let i = 0;
  let prevChar = "";
  let prevWord = "";

  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (src[k] !== "\n") out[k] = " ";
  };

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    if (c === "/" && c2 === "/") {
      let end = src.indexOf("\n", i);
      if (end === -1) end = n;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === "/" && c2 === "*") {
      let end = src.indexOf("*/", i + 2);
      end = end === -1 ? n : end + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const start = i;
      i++;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        if (src[i] === "\n" && quote !== "`") break; // 未闭合的普通字符串:只到行尾
        i++;
      }
      blank(start, i);
      prevChar = quote;
      prevWord = "";
      continue;
    }
    if (c === "/" && regexCanStart(prevChar, prevWord)) {
      const start = i;
      let inClass = false;
      i++;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "\n") break; // 正则不跨行
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) { i++; break; }
        i++;
      }
      blank(start, i);
      prevChar = "/";
      prevWord = "";
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      prevWord = src.slice(i, j);
      prevChar = src[j - 1];
      i = j;
      continue;
    }
    if (!/\s/.test(c)) {
      prevChar = c;
      prevWord = "";
    }
    i++;
  }
  return out.join("");
}

function regexCanStart(prevChar, prevWord) {
  if (!prevChar) return true;
  if ("(,=:[!&|?{};+-*%<>~^".includes(prevChar)) return true;
  return /^(?:return|typeof|case|in|of|new|delete|void|instanceof|do|else|yield|await)$/.test(prevWord);
}

// ---------------------------------------------------------------------------
// 2) 声明名提取(含解构 / 多声明符)
// ---------------------------------------------------------------------------
function findMatching(text, openIdx) {
  const open = text[openIdx];
  const close = open === "{" ? "}" : open === "[" ? "]" : ")";
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function namesFromPattern(text) {
  const t = String(text || "").trim().replace(/;$/, "").trim();
  if (!t) return [];
  if (t[0] === "{" || t[0] === "[") {
    const end = findMatching(t, 0);
    const inner = end > 0 ? t.slice(1, end) : t.slice(1);
    const names = [];
    for (const rawPart of splitTopLevel(inner)) {
      const part = rawPart.trim();
      if (!part) continue;
      const rest = /^\.\.\./.test(part) ? part.slice(3).trim() : part;
      const left = rest.includes(":") ? rest.slice(0, rest.indexOf(":")) : rest;
      const m = /^([A-Za-z_$][\w$]*)/.exec(left.trim());
      if (m) names.push(m[1]);
    }
    return names;
  }
  const m = /^([A-Za-z_$][\w$]*)/.exec(t);
  return m ? [m[1]] : [];
}

function parseDecl(maskedLine) {
  const m = DECL_RE.exec(maskedLine);
  if (!m) return null;
  const kind = m[2].replace(/\s+/g, " ");
  const rest = maskedLine.slice(m[0].length);
  if (kind === "function" || kind === "async function") {
    const nm = /^([A-Za-z_$][\w$]*)/.exec(rest);
    return { kind, names: nm ? [nm[1]] : [] };
  }
  const names = [];
  for (const part of splitTopLevel(rest)) names.push(...namesFromPattern(part));
  return { kind, names };
}

// ---------------------------------------------------------------------------
// 3) 括号归类:这个 `{` 打开的是函数体还是普通块?
//    (区分"立即执行的顶层代码"与"函数体":后者里的引用调用时才解析)
// ---------------------------------------------------------------------------
function classifyBrace(prefix) {
  const t = prefix.replace(/\s+$/, "");
  if (/=>$/.test(t)) return "fn";
  if (/\bfunction\b[^(){};]*\([^()]*\)$/.test(t)) return "fn";
  if (/\bfunction\s*[\w$]*\s*\([^()]*\)$/.test(t)) return "fn";
  // 对象/类里的方法简写 `foo(a, b) {`
  if (/^\s*(?:async\s+)?(?:get\s+|set\s+)?[\w$"'#]+\s*\([^()]*\)\s*$/.test(t)) return "fn";
  return "block";
}

function isDeclarationStartLine(line) {
  return /^\s*(?:const|let|var|function|async\s+function|class)\b/.test(line);
}

// ---------------------------------------------------------------------------
// 4) 单文件分析
// ---------------------------------------------------------------------------
function analyzeText(src, label) {
  const clean = String(src).replace(/^\uFEFF/, "");
  const masked = maskCode(clean);
  const rawLines = clean.split(/\r?\n/);
  const mLines = masked.split("\n").map((l) => l.replace(/\r$/, ""));

  const stack = []; // { kind: "fn" | "block", wrapper: boolean, line: number }
  const decls = []; // { name, kind, line, scope }
  const refs = [];  // { name, line }

  const effectiveFnDepth = () => {
    const fnCount = stack.reduce((n, f) => n + (f.kind === "fn" ? 1 : 0), 0);
    const wrapperTransparent = stack.length > 0 && stack[0].wrapper ? 1 : 0;
    return fnCount - wrapperTransparent;
  };

  for (let li = 0; li < mLines.length; li++) {
    const line = mLines[li];
    const lineNo = li + 1;
    const startDepth = stack.length;

    // --- 顶层声明 ---
    // GLOBAL:完全不在函数里(裸文件顶层 / btipc 的 `var LCTBTIPC = ...`)
    // MODULE:唯一的外层函数帧就是本文件的 IIFE 包装(拼接后仍属于该文件自己的作用域)
    if (startDepth <= 1) {
      const parsed = parseDecl(line);
      if (parsed && parsed.names.length) {
        const fnFrames = stack.filter((f) => f.kind === "fn").length;
        let scope = null;
        if (fnFrames === 0) scope = "GLOBAL";
        else if (fnFrames === 1 && stack.length === 1 && stack[0].wrapper) scope = "MODULE";
        if (scope) {
          for (const name of parsed.names) decls.push({ name, kind: parsed.kind, line: lineNo, scope });
        }
      }
    }

    // --- 逐字符扫描:括号深度 + 立即代码里的标识符 ---
    const declaredHere = new Set();
    for (const d of decls) if (d.line === lineNo) declaredHere.add(d.name);

    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === "{") {
        const kind = classifyBrace(line.slice(0, i));
        const wrapper = kind === "fn" && stack.length === 0 && !isDeclarationStartLine(line);
        stack.push({ kind, wrapper, line: lineNo });
        i++;
        continue;
      }
      if (ch === "}") {
        stack.pop();
        i++;
        continue;
      }
      if (/[A-Za-z_$]/.test(ch)) {
        let j = i + 1;
        while (j < line.length && /[A-Za-z0-9_$]/.test(line[j])) j++;
        const word = line.slice(i, j);
        const prev = line.slice(0, i).replace(/\s+$/, "");
        const next = line.slice(j).replace(/^\s+/, "");
        const isProperty = prev.endsWith(".") || prev.endsWith("?.");
        // 对象字面量/解构里的键(`{ key: ... }`、`{ key, ... }`)不是引用
        const isObjectKey = next.startsWith(":") && (prev.endsWith("{") || prev.endsWith(","));
        if (!KEYWORDS.has(word) && !isProperty && !isObjectKey &&
            !declaredHere.has(word) && effectiveFnDepth() === 0) {
          refs.push({ name: word, line: lineNo });
        }
        i = j;
        continue;
      }
      i++;
    }
  }

  const countLines = clean.length === 0
    ? 0
    : rawLines.length - (/\r?\n$/.test(clean) ? 1 : 0);

  return {
    path: label,
    base: path.basename(label),
    lines: countLines,
    text: clean,
    decls,
    refs,
  };
}

// ---------------------------------------------------------------------------
// 5) 检查:重名 / 前向引用 / 拼接提示
// ---------------------------------------------------------------------------
function findDuplicates(files) {
  const groups = new Map(); // key = 作用域 + 名;MODULE 的作用域按文件隔离
  for (const f of files) {
    for (const d of f.decls) {
      const scopeKey = d.scope === "GLOBAL" ? "GLOBAL" : "MODULE:" + f.base;
      const key = scopeKey + "\u0000" + d.name;
      if (!groups.has(key)) groups.set(key, { name: d.name, scope: d.scope, items: [] });
      groups.get(key).items.push({ file: f.base, line: d.line, kind: d.kind });
    }
  }
  const conflicts = [];
  for (const g of groups.values()) {
    const distinctFiles = new Set(g.items.map((x) => x.file));
    // GLOBAL 跨文件 = 真冲突;同文件内重复(含 MODULE 内重复)= 语法错,也报
    if (g.scope === "GLOBAL" && distinctFiles.size > 1) conflicts.push(g);
    else if (g.items.length > 1) conflicts.push(g);
  }
  conflicts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return conflicts;
}

function findForwardRefs(files) {
  const globalConsts = files.map((f) => {
    const m = new Map();
    for (const d of f.decls) {
      if (d.scope !== "GLOBAL") continue;
      if (d.kind === "function" || d.kind === "async function") continue;
      if (!m.has(d.name)) m.set(d.name, d);
    }
    return m;
  });

  const seen = new Set();
  const warnings = [];
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const later = globalConsts[j];
      if (!later.size) continue;
      for (const ref of files[i].refs) {
        const decl = later.get(ref.name);
        if (!decl) continue;
        const key = files[i].base + ">" + files[j].base + "::" + ref.name;
        if (seen.has(key)) continue;
        seen.add(key);
        warnings.push({
          name: ref.name,
          from: files[i].base,
          fromLine: ref.line,
          to: files[j].base,
          toLine: decl.line,
          kind: decl.kind,
        });
      }
    }
  }
  return warnings;
}

function findSpliceNotes(files) {
  // 裸文件的 GLOBAL 名 vs 某包装文件 IIFE 顶层名:拼接"整文件"安全,拼"片段"会撞。
  const notes = [];
  const moduleDecls = [];
  for (const f of files) {
    for (const d of f.decls) if (d.scope === "MODULE") moduleDecls.push({ file: f.base, ...d });
  }
  for (const f of files) {
    for (const d of f.decls) {
      if (d.scope !== "GLOBAL") continue;
      for (const m of moduleDecls) {
        if (m.file === f.base || m.name !== d.name) continue;
        notes.push({
          name: d.name,
          globalFile: f.base,
          globalLine: d.line,
          moduleFile: m.file,
          moduleLine: m.line,
        });
      }
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// 6) 拼接
// ---------------------------------------------------------------------------
function detectEol(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length;
  return lf > 0 && crlf / lf > 0.5 ? "\r\n" : "\n";
}

function buildBundle(files) {
  const total = files.length;
  const eol = files.length ? detectEol(files[0].text) : "\n";
  const chunks = files.map((f, idx) => {
    const banner = "// " + BANNER_RULE + " [" + (idx + 1) + "/" + total + "] " +
      f.base + " (行数 " + f.lines + ") " + BANNER_RULE;
    const body = f.text.replace(/\r\n/g, "\n").replace(/\s+$/, "");
    return banner + "\n" + body;
  });
  const joined = chunks.join("\n\n") + "\n";
  return eol === "\n" ? joined : joined.replace(/\n/g, eol);
}

// ---------------------------------------------------------------------------
// 7) CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { files: [], out: null, checkOnly: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--files") {
      i++;
      while (i < argv.length && !argv[i].startsWith("--")) opts.files.push(argv[i++]);
      i--;
    } else if (a === "--out") {
      opts.out = argv[++i] || null;
    } else if (a === "--check-only") {
      opts.checkOnly = true;
    } else if (a === "--help" || a === "-h") {
      opts.help = true;
    } else {
      throw new Error("未知参数: " + a);
    }
  }
  return opts;
}

const HELP = [
  "用法: node scripts/concat_panorama.js --files a.js b.js --out out.js [--check-only]",
  "  --files ...    按**装载顺序**列出输入文件",
  "  --out <path>   拼接产物路径(check-only 时可省略)",
  "  --check-only   只做检查(重名 / 前向引用),不写文件",
  "退出码: 重名 = 2;仅警告 = 0;正常 = 0;参数或文件错误 = 1",
].join("\n");

function run(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error("[concat_panorama] " + e.message);
    console.error(HELP);
    return EXIT_USAGE;
  }
  if (opts.help) {
    console.log(HELP);
    return EXIT_OK;
  }
  if (!opts.files.length) {
    console.error("[concat_panorama] 缺少 --files");
    console.error(HELP);
    return EXIT_USAGE;
  }
  if (!opts.checkOnly && !opts.out) {
    console.error("[concat_panorama] 缺少 --out(或用 --check-only 只检查)");
    console.error(HELP);
    return EXIT_USAGE;
  }
  const missing = opts.files.filter((f) => !fs.existsSync(f));
  if (missing.length) {
    console.error("[concat_panorama] 找不到输入文件: " + missing.join(", "));
    return EXIT_USAGE;
  }

  const files = opts.files.map((f) => analyzeText(fs.readFileSync(f, "utf8"), f));
  const totalLines = files.reduce((n, f) => n + f.lines, 0);

  const conflicts = findDuplicates(files);
  const warnings = findForwardRefs(files);
  const notes = findSpliceNotes(files);

  console.log("[concat_panorama] " + files.length + " 个文件," + totalLines + " 行 → " +
    files.map((f) => f.base).join(" → "));
  console.log("[concat_panorama] 重名检测: " + (conflicts.length ? conflicts.length + " 组冲突" : "0 组(通过)"));
  console.log("[concat_panorama] 前向引用警告: " + warnings.length + " 条");
  console.log("[concat_panorama] 拼接提示(不阻塞): " + notes.length + " 条(裸文件全局名与某 IIFE 顶层同名,拼片段时才需改名)");

  for (const c of conflicts) {
    console.error("✗ 重名冲突: " + c.name + "  (" + c.scope + ")");
    for (const it of c.items) {
      console.error("    " + it.file + ":" + it.line + "  " + it.kind);
    }
  }
  for (const w of warnings) {
    console.error("⚠ 前向引用风险: " + w.name +
      "  —  " + w.from + ":" + w.fromLine + " 的顶层立即代码引用了更靠后的 " +
      w.to + ":" + w.toLine + " " + w.kind + " " + w.name + "(拼接后先求值 → TDZ/undefined)");
  }
  for (const n of notes) {
    console.error("提示(不阻塞): " + n.name + "  —  " + n.globalFile + ":" + n.globalLine +
      " 是全局声明,与 " + n.moduleFile + ":" + n.moduleLine + " 的 IIFE 顶层同名;" +
      "整文件拼接安全,若把片段拼进该 IIFE 才需要改名");
  }

  if (conflicts.length) {
    console.error("[concat_panorama] 失败: 重名会让拼接后的语义不唯一,先改名再拼");
    return EXIT_DUPLICATE;
  }

  if (opts.checkOnly) {
    console.log("[concat_panorama] --check-only: 未写输出文件");
    return EXIT_OK;
  }

  const bundle = buildBundle(files);
  fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
  fs.writeFileSync(opts.out, bundle, "utf8");
  console.log("[concat_panorama] 已写出 " + opts.out + " (" + bundle.split(/\r?\n/).length + " 行)");
  return EXIT_OK;
}

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}

module.exports = { analyzeText, findDuplicates, findForwardRefs, findSpliceNotes, buildBundle, run };
