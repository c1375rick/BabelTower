// Preliminary CORS-header probe (NOT authoritative): shows whether the upstream sends
// Access-Control-Allow-Origin for our origin, plus the preflight (OPTIONS) answer.
// The authoritative verdict comes from a real Chromium (poc browser run / CEF in game).
// Usage: portable-node\node.exe poc\probe_cors_headers.js
"use strict";
const ORIGIN = process.env.POC_ORIGIN || "https://c1375rick.github.io";

const CASES = [
  { name: "bing-edge", url: "https://edge.microsoft.com/translate/translatetext?to=zh-Hans&isEnterpriseClient=false", method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(["hello world"]) },
  { name: "openai", url: "https://api.openai.com/v1/chat/completions", method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer no-key-poc" }, body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }) },
  { name: "deepl-free", url: "https://api-free.deepl.com/v2/translate", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "text=hello&target_lang=ZH" },
  { name: "google-v2", url: "https://translation.googleapis.com/language/translate/v2?key=no-key-poc&q=hello&target=zh-CN", method: "GET" },
  { name: "mymemory", url: "https://api.mymemory.translated.net/get?q=hello&langpair=en|zh-CN", method: "GET" },
  { name: "libretranslate-com", url: "https://libretranslate.com/translate", method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: "hello", source: "en", target: "zh", format: "text" }) },
  { name: "libretranslate-terraprint", url: "https://translate.terraprint.co/translate", method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: "hello", source: "en", target: "zh", format: "text" }) },
];

function short(v) { return v == null ? "-" : String(v).slice(0, 80); }

async function probe(c) {
  const out = { name: c.name, preflight: null, actual: null };
  // preflight
  try {
    const r = await fetch(c.url, {
      method: "OPTIONS",
      headers: Object.assign({ Origin: ORIGIN, "Access-Control-Request-Method": c.method, "Access-Control-Request-Headers": "content-type,authorization" }),
      signal: AbortSignal.timeout(15000),
    });
    out.preflight = { status: r.status, acao: r.headers.get("access-control-allow-origin"), acam: r.headers.get("access-control-allow-methods"), acah: r.headers.get("access-control-allow-headers"), acac: r.headers.get("access-control-allow-credentials") };
  } catch (e) { out.preflight = { error: String(e.message) }; }
  // actual
  try {
    const init = { method: c.method, headers: Object.assign({ Origin: ORIGIN }, c.headers || {}) };
    if (c.body != null && c.method !== "GET") init.body = c.body;
    const r = await fetch(c.url, Object.assign(init, { signal: AbortSignal.timeout(15000) }));
    out.actual = { status: r.status, acao: r.headers.get("access-control-allow-origin"), acac: r.headers.get("access-control-allow-credentials"), ctype: r.headers.get("content-type") };
  } catch (e) { out.actual = { error: String(e.message) }; }
  return out;
}

(async function () {
  console.log("Origin used: " + ORIGIN + "  (preliminary header probe - NOT a CORS verdict)\n");
  for (const c of CASES) {
    const r = await probe(c);
    console.log("## " + r.name);
    console.log("   preflight OPTIONS: " + (r.preflight.error ? ("ERR " + r.preflight.error) : ("HTTP " + r.preflight.status + " ACAO=" + short(r.preflight.acao) + " ACAM=" + short(r.preflight.acam) + " ACAH=" + short(r.preflight.acah))));
    console.log("   actual " + c.method + "     : " + (r.actual.error ? ("ERR " + r.actual.error) : ("HTTP " + r.actual.status + " ACAO=" + short(r.actual.acao) + " ACAC=" + short(r.actual.acac))));
    console.log("");
  }
})();
