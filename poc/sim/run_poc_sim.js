// Babel Tower bridgeless POC - simulation run (S1/S2/S3/S5 + S4 plumbing).
// Usage: portable-node\node.exe poc\sim\run_poc_sim.js
// Writes poc\out\sim_results.json and prints a summary.
"use strict";
const fs = require("fs");
const path = require("path");
const { createSim, startStaticServer } = require("./poc_sim");

let pass = 0, fail = 0;
const report = { ts: new Date().toISOString(), checks: [], data: {} };
function check(name, cond, extra) {
  const row = { name: name, ok: !!cond, extra: extra === undefined ? null : extra };
  report.checks.push(row);
  if (cond) { pass++; console.log("  PASS " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  [" + extra + "]" : "")); }
}

function sendAwait(POC, label, q, d, timeoutMs) {
  return new Promise(function (resolve) {
    let done = false;
    const timer = setTimeout(function () { if (!done) { done = true; resolve({ timedOut: true }); } }, timeoutMs || 25000);
    POC.send(label, q, d, function (payload, ms) {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ payload: payload, ms: ms });
    });
  });
}

function stat(arr) {
  if (!arr.length) return { n: 0 };
  const s = arr.slice().sort(function (a, b) { return a - b; });
  const sum = arr.reduce(function (a, b) { return a + b; }, 0);
  return { n: arr.length, min: s[0], max: s[s.length - 1], avg: Math.round(sum / arr.length) };
}

async function main() {
  const srv = await startStaticServer();
  const pageUrl = "http://127.0.0.1:" + srv.port + "/index.html";
  const store = {};                 // ONE localStorage store shared by both sims = same CEF profile/origin
  report.data.pageUrl = pageUrl;
  console.log("[poc-sim] page served at " + pageUrl);

  // ================= S1: CEF loads page + JS executes + title downlink =================
  console.log("\n[S1] load page -> JS executes -> title POC-ALIVE back to Panorama");
  const sim1 = createSim({ pageUrl: pageUrl, store: store });
  const POC1 = sim1.loadPocScript();
  const tBoot = Date.now();
  POC1.boot();
  await sim1.waitFor(function () { return POC1.State.alive === true; }, 15000, "S1 alive title")
    .catch(function () {});
  const loadMs = POC1.State.alive && POC1.State.events.length ? POC1.State.events[0].at - tBoot : null;
  check("S1.1 面板整页加载发生(fullLoads>=1)", sim1.fullLoads >= 1, "fullLoads=" + sim1.fullLoads);
  check("S1.2 面板执行了页面 JS(无页面异常)", sim1.pageErrors.length === 0, sim1.pageErrors.slice(0, 2).join(" | "));
  check("S1.3 title 回程收到 POC-ALIVE", POC1.State.alive === true, "aliveTitle=" + String(POC1.State.aliveTitle).slice(0, 40));
  check("S1.4 title 事件确实派发到脚本", sim1.titleEvents >= 1, "titleEvents=" + sim1.titleEvents);
  report.data.S1 = { fullLoads: sim1.fullLoads, titleEvents: sim1.titleEvents, loadMs: loadMs, aliveTitle: POC1.State.aliveTitle, pageErrors: sim1.pageErrors };
  console.log("  [info] S1 load->title = " + loadMs + "ms (sim local server; real Pages latency differs)");

  // ================= S2: hash uplink -> page parse -> title echo =================
  console.log("\n[S2] 12x echo round-trip (#LCTQ uplink)");
  const lat = [], echoes = [], missing = [];
  for (let i = 1; i <= 12; i++) {
    const r = await sendAwait(POC1, "2-echo", "echo", { text: "ping-" + i }, 10000);
    if (r.timedOut || !r.payload) { missing.push(i); }
    else { lat.push(r.ms); echoes.push(r.payload.echo); }
    await sim1.sleep(300); // space out so each hash change is its own navigation
  }
  const hashNavs = sim1.navigations.filter(function (n) { return n.kind === "hash" && n.url.indexOf("LCTQ:") >= 0; }).length;
  const st = stat(lat);
  check("S2.1 全部 12 次 echo 收到应答", echoes.length === 12, "got=" + echoes.length + " missing=" + JSON.stringify(missing));
  check("S2.2 应答按序 ping-1..ping-12", echoes.join(",") === Array.from({ length: 12 }, function (_, i) { return "ping-" + (i + 1); }).join(","), echoes.join(","));
  check("S2.3 每次请求都触发 hashchange(hash 导航数>=12)", hashNavs >= 12, "hashNavs(LCTQ)=" + hashNavs);
  check("S2.4 页面无异常", sim1.pageErrors.length === 0, sim1.pageErrors.slice(0, 2).join(" | "));
  report.data.S2 = { n: st.n, min: st.min, avg: st.avg, max: st.max, hashNavs: hashNavs, echoes: echoes };
  console.log("  [info] S2 round-trip min/avg/max = " + st.min + "/" + st.avg + "/" + st.max + "ms (n=" + st.n + "), LCTQ hash navs=" + hashNavs);

  // ================= S3: localStorage + across-restart persistence =================
  console.log("\n[S3] localStorage write -> restart -> read back");
  const stamp = new Date().toISOString().slice(0, 10);
  const wantVal = "hello-" + stamp;
  const w = await sendAwait(POC1, "3-store", "store", { k: "pocKey", v: wantVal }, 10000);
  check("S3.1 写入 localStorage 成功", !!(w.payload && w.payload.ok), JSON.stringify(w.payload || null).slice(0, 120));
  const readNow = await sendAwait(POC1, "3-load-after", "load", { k: "pocKey" }, 10000);
  check("S3.2 同会话读回一致", !!(readNow.payload && readNow.payload.value === wantVal), "value=" + (readNow.payload && readNow.payload.value));
  const bootCount1 = (sim1.cef.docs.get(sim1.panels.pocPanel).sandbox.POC_PAGE || {}).bootCount;
  sim1.dispose();
  // ---- "restart": new CEF doc, SAME localStorage store ----
  const sim2 = createSim({ pageUrl: pageUrl, store: store });
  const POC2 = sim2.loadPocScript();
  POC2.boot();
  await sim2.waitFor(function () { return POC2.State.alive === true; }, 15000, "S3 restart alive").catch(function () {});
  const readAfter = await sendAwait(POC2, "3-load-after", "load", { k: "pocKey" }, 10000);
  const bootCount2 = (sim2.cef.docs.get(sim2.panels.pocPanel).sandbox.POC_PAGE || {}).bootCount;
  check("S3.3 跨重启读回一致", !!(readAfter.payload && readAfter.payload.value === wantVal), "value=" + (readAfter.payload && readAfter.payload.value));
  check("S3.4 bootCount 递增(跨重启)", bootCount2 === (bootCount1 || 0) + 1, "before=" + bootCount1 + " after=" + bootCount2);
  check("S3.5 localStorage 可用探测(页面 lsOk)", !!(readAfter.payload && readAfter.payload.lsOk), "lsOk=" + (readAfter.payload && readAfter.payload.lsOk));
  report.data.S3 = { wantVal: wantVal, valueAfterRestart: readAfter.payload && readAfter.payload.value, bootCount1: bootCount1, bootCount2: bootCount2 };

  // ================= S4: CORS diagnostic plumbing (NOT a real CORS verdict) =================
  console.log("\n[S4] CORS diagnostic plumbing (Node fetch does NOT enforce CORS - verdict only from browser tool)");
  const corsLogic = {};
  for (const ep of ["mymemory", "bing-edge"]) {
    const r = await sendAwait(POC2, "4-cors-" + ep, "cors", { endpoint: ep }, 20000);
    corsLogic[ep] = r.payload || null;
    console.log("  [info] S4 " + ep + " -> " + JSON.stringify(r.payload || null).slice(0, 160));
  }
  check("S4.1 cors 指令返回结构化结果(mymemory)", !!(corsLogic["mymemory"] && typeof corsLogic["mymemory"].status === "number"), JSON.stringify(corsLogic["mymemory"] || {}).slice(0, 120));
  report.data.S4_sim_plumbing_only = corsLogic;

  // ================= S5: end-to-end translate inside the page =================
  console.log("\n[S5] end-to-end translate via page JS (mymemory, no key)");
  const tr = await sendAwait(POC2, "5-translate", "translate", { provider: "mymemory", text: "hello world", target: "zh-CN" }, 25000);
  const txt = tr.payload && tr.payload.translation;
  check("S5.1 页面内完成一次真实翻译", !!(tr.payload && tr.payload.ok && txt), JSON.stringify(tr.payload || null).slice(0, 160));
  check("S5.2 译文含中文", !!txt && /[\u4e00-\u9fff]/.test(String(txt)), "translation=" + txt);
  report.data.S5 = { ok: !!(tr.payload && tr.payload.ok), translation: txt, ms: tr.payload && tr.payload.ms, via: "mymemory(免Key)" };
  console.log("  [info] S5 translation = " + txt + " (" + (tr.payload && tr.payload.ms) + "ms)");

  // ---- summary ----
  report.pass = pass; report.fail = fail;
  const outDir = path.join(__dirname, "..", "out");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "sim_results.json"), JSON.stringify(report, null, 2), "utf8");
  console.log("\nSIM RESULT: PASS " + pass + " / FAIL " + fail + "  (-> poc/out/sim_results.json)");
  try { srv.srv.close(); } catch (e) {}
  process.exit(fail ? 1 : 0);
}

main().catch(function (e) {
  console.error("SIM FATAL: " + (e && e.stack ? e.stack : e));
  process.exit(2);
});
