// 콘티 화면(storyboard.html) 로드 하네스 (jsdom). 네트워크(fetch)는 가짜 데이터로 대신한다 — 실제 Supabase·API는 부르지 않는다.
// 시나리오 2개(목록 / ?open=1 장면 화면)마다 에러·요청 기록·최종 DOM·전역 함수 목록을 JSON으로 남긴다.
// 사용(이 폴더에서): npm install  →  node run.js [polos 루트=../..] [페이지=youtube/storyboard.html] [출력=임시폴더/storyboard-check.json]
// 고치기 전·후 결과를 각각 저장하고 node compare.js before.json after.json 으로 비교한다.
const fs = require("fs");
const path = require("path");
const { JSDOM, ResourceLoader, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, "..", ".."));
const PAGE = process.argv[3] || "youtube/storyboard.html";
const OUT = process.argv[4] || path.join(require("os").tmpdir(), "storyboard-check.json");

const SCRIPTS = [
  { id: 1, title: "테스트 콘티", category: "trend", status: "approved", create_status: null, created_at: "2026-10-01T00:00:00Z",
    video_settings: { title1: "제목 하나", title2: "제목 둘", source_text: "출처", mood: "calm", caption_font_size: 80, auto_upload: false } },
  { id: 2, title: "두번째", category: "wiki", status: "approved", create_status: "running", created_at: "2026-10-02T00:00:00Z", video_settings: {} },
];
const SEGMENTS = [
  { id: 11, script_id: 1, order_no: 1, section: "도입", text: "첫 문장입니다. 둘째 문장입니다.", subtitle_text: "첫 줄\n둘째 줄",
    asset_paths: ["blank:black", "https://images.pexels.com/photos/1/a.jpeg"], asset_trims: {}, asset_notes: {}, direction: null, target_seconds: 6 },
  { id: 12, script_id: 1, order_no: 2, section: "전개", text: "가운데 장면 대본.", subtitle_text: "", asset_paths: [], asset_trims: {}, asset_notes: {}, direction: null, target_seconds: null },
  { id: 13, script_id: 1, order_no: 3, section: "구독/좋아요", text: "구독 부탁드려요.", subtitle_text: null, asset_paths: ["subscribe/x.png"], asset_trims: {}, asset_notes: {}, direction: null },
];

function fakeResponse(url, opts) {
  const u = String(url);
  const method = (opts && opts.method) || "GET";
  let body = [];
  if (method === "GET") {
    if (u.includes("/rest/v1/youtube_scripts")) {
      const m = u.match(/id=eq\.(\d+)/);
      body = m ? SCRIPTS.filter((s) => String(s.id) === m[1]) : SCRIPTS;
    } else if (u.includes("/rest/v1/youtube_segments")) {
      const m = u.match(/script_id=eq\.(\d+)/);
      body = m ? SEGMENTS.filter((s) => String(s.script_id) === m[1]) : SEGMENTS;
      if (u.includes("offset=") && !u.includes("offset=0")) body = [];
    } else if (u.includes("/rest/v1/youtube_channels")) {
      body = [{ slot: 1, label: "채널1" }];
    }
  }
  const text = JSON.stringify(body);
  return Promise.resolve({ ok: true, status: 200, headers: { get: () => "application/json" },
    json: async () => JSON.parse(text), text: async () => text, blob: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0), clone() { return this; } });
}

class LocalLoader extends ResourceLoader {
  fetch(url) {
    const u = new URL(url);
    if (u.hostname !== "localhost") return Promise.resolve(Buffer.from(""));
    const f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!fs.existsSync(f)) { log.missing.push(u.pathname); return Promise.reject(new Error("404 " + u.pathname)); }
    log.loaded.push(u.pathname);
    return Promise.resolve(fs.readFileSync(f));
  }
}

let log;
async function scenario(name, query) {
  log = { name, errors: [], consoleErrors: [], requests: [], loaded: [], missing: [] };
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => log.errors.push(String(e.message || e) + (e.detail ? " :: " + String(e.detail && e.detail.stack || e.detail).split("\n").slice(0, 2).join(" | ") : "")));
  vc.on("error", (...a) => log.consoleErrors.push(a.map(String).join(" ")));
  const html = fs.readFileSync(path.resolve(ROOT, PAGE), "utf8");
  const dom = new JSDOM(html, {
    url: "http://localhost/youtube/storyboard.html" + (query || ""),
    runScripts: "dangerously", resources: new LocalLoader(), virtualConsole: vc, pretendToBeVisual: true,
    beforeParse(w) {
      let t = 1760000000000; w.Date.now = () => t; // 고정 시각
      w.Math.random = (() => { let s = 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
      w.fetch = (url, opts) => { log.requests.push(((opts && opts.method) || "GET") + " " + String(url).replace(/^https?:\/\/[^/]+/, "")); return fakeResponse(url, opts); };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.speechSynthesis = { getVoices: () => [], speak() {}, cancel() {}, addEventListener() {} };
      w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
      w.HTMLMediaElement.prototype.pause = function () {};
      w.HTMLMediaElement.prototype.load = function () {};
      w.Element.prototype.setPointerCapture = function () {};
      w.Element.prototype.scrollIntoView = function () {};
      w.Notification = class { static requestPermission() { return Promise.resolve("denied"); } }; w.Notification.permission = "denied";
    },
  });
  await new Promise((r) => dom.window.addEventListener("load", r));
  await new Promise((r) => setTimeout(r, 2500));
  const w = dom.window;
  log.title = w.document.title;
  log.listViewDisplay = w.document.getElementById("listView").style.display;
  log.detailViewDisplay = w.document.getElementById("detailView").style.display;
  { const c = w.document.body.cloneNode(true); c.querySelectorAll("script").forEach((s) => s.remove()); log.body = c.innerHTML.replace(/[\r\n]\s*[\r\n]/g, "\n"); }
  // 전역 함수가 window에 남아 있는지 (onclick="..." 같은 인라인 처리기용)
  log.globalFns = Object.keys(w).filter((k) => typeof w[k] === "function" && !(k in new JSDOM("").window)).sort();
  log.scriptTags = Array.from(w.document.querySelectorAll("script")).map((s) => s.src ? s.getAttribute("src") : "(inline " + s.textContent.length + ")");
  w.close();
  return log;
}

(async () => {
  const results = [];
  results.push(await scenario("list", ""));
  results.push(await scenario("detail", "?open=1"));
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  console.log("saved", OUT);
  for (const r of results) {
    console.log(`[${r.name}] errors=${r.errors.length} consoleErrors=${r.consoleErrors.length} requests=${r.requests.length} missing=${r.missing.length} globalFns=${r.globalFns.length} bodyLen=${r.body.length} list=${r.listViewDisplay || "-"} detail=${r.detailViewDisplay || "-"}`);
    r.errors.forEach((e) => console.log("   ERR " + e.slice(0, 300)));
    r.consoleErrors.forEach((e) => console.log("   CERR " + e.slice(0, 300)));
    r.missing.forEach((e) => console.log("   MISSING " + e));
  }
  process.exit(0);
})();
