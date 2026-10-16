// @ts-nocheck
// Supabase Edge Function "news-search" — 구글 뉴스(RSS, 무료·키 없음) 검색을 Cloudflare 대신 여기서 한다.
// (Cloudflare에서 news.google.com을 부르면 봇 차단 503 "Sorry..."가 와서 0건이 된다. Supabase에서는 정상으로 답한다)
//
// POST { q, mode? }
//   mode "search"(기본)    콘티 만들기 창의 Search. 최근 1주 기사 최대 5건 → { items: [{ title, url, source, date }] }
//                          구글 뉴스 링크(중간 주소)는 실제 언론사 주소로 풀어 두고, 못 푼 기사는 뺀다.
//   mode "perspective"     /api/gemini-draft의 "관점" 자료 후보. POST { q: 주제, mode, exclude: [이미 쓰는 기사 제목], max }
//                          최근 2주 칼럼·분석 기사를 매체가 겹치지 않게 골라 주소를 푼 후보 최대 max+2건
//                          → { items: [{ title, source, url }] }  (기사 본문은 읽지 않는다 — 부르는 쪽(Cloudflare)이 읽는다)
// 실패하면 { error } (4xx/5xx). 모든 응답에 from: "news-search".
//
// 배포: 대시보드 Edge Functions → 새 함수 이름 news-search → 이 파일 전체를 붙여 넣고 Deploy.
//       브라우저·Cloudflare가 publishable 키로 부르므로 함수 설정에서 "Verify JWT"(Enforce JWT verification)를 끈다.
// 이 파일은 다른 파일을 불러오지 않는다 (대시보드에 그대로 붙여 넣을 수 있게).

const UA = "Mozilla/5.0";
const FETCH_TIMEOUT_MS = 8000;          // 구글에 보내는 요청 하나당
const MAX_BODY = 1_500_000;             // 읽을 응답 크기 상한 (RSS·중간 페이지는 보통 수십~수백 KB)
const MAX_SEARCH = 5;
const OPINION_HINT = /사설|칼럼|기고|시론|논평|분석|전망|전문가|교수|비판|우려|논란|쟁점|해석|진단|평가/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (obj, status) => new Response(JSON.stringify({ from: "news-search", ...obj }), {
  status, headers: { ...CORS, "Content-Type": "application/json" },
});

const decode = (s) => String(s || "")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#039;/g, "'").replace(/&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

// 같은 기사(제목 앞부분이 같음) 판별용
const norm = (t) => String(t || "").replace(/[\s'"“”‘’\[\]\(\)·,.\-…]/g, "").slice(0, 14);

// 응답 본문을 최대 max 바이트까지만 읽는다
async function readCapped(res, max = MAX_BODY) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  if (size >= max) { try { await reader.cancel(); } catch { /* 무시 */ } }
  const buf = new Uint8Array(Math.min(size, max));
  let off = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.min(c.length, buf.length - off));
    buf.set(part, off);
    off += part.length;
    if (off >= buf.length) break;
  }
  return new TextDecoder("utf-8").decode(buf);
}

const get = (url, init = {}) => fetch(url, { ...init, headers: { "User-Agent": UA, ...(init.headers || {}) }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

// 구글 뉴스 RSS 검색 → [{ title, link, source, pubDate }]
async function searchNews(query, limit = 20) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await get(url);
  if (!res.ok) { try { await res.body?.cancel(); } catch { /* 무시 */ } return []; }
  const xml = await readCapped(res);
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const rawTitle = decode((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "");
    const link = decode((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "").trim();
    const source = decode((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || "");
    const pubDate = decode((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "").trim();
    if (!rawTitle || !link) continue;
    // 제목 끝의 " - 매체명"은 떼어낸다
    const title = source && rawTitle.endsWith(" - " + source) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;
    items.push({ title, link, source, pubDate });
    if (items.length >= limit) break;
  }
  return items;
}

// 구글 뉴스 중간 주소 → 실제 기사 주소 (구글의 공개 웹 화면이 쓰는 변환 요청을 그대로 따라 한다). 못 풀면 null
async function resolveGoogleNews(link) {
  try {
    const id = new URL(link).pathname.split("/").pop();
    if (!id) return null;
    const page = await get(`https://news.google.com/rss/articles/${id}?hl=ko&gl=KR&ceid=KR:ko`);
    const html = await readCapped(page);
    const sg = (html.match(/data-n-a-sg="([^"]+)"/) || [])[1];
    const ts = (html.match(/data-n-a-ts="([^"]+)"/) || [])[1];
    if (!sg || !ts) return null;
    const inner = JSON.stringify(["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]);
    const body = "f.req=" + encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]]));
    const res = await get("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body,
    });
    return parseResolved(await readCapped(res, 200_000));
  } catch {
    return null;
  }
}

// batchexecute 답에서 실제 주소를 꺼낸다. 주소 속 "=", "&"는 =, &으로 이스케이프돼 오므로 JSON으로 풀어 읽는다
function parseResolved(text) {
  for (const line of String(text || "").split("\n")) {
    if (!line.includes("garturlres")) continue;
    try {
      for (const e of JSON.parse(line)) {
        if (!Array.isArray(e) || e[1] !== "Fbv4je" || typeof e[2] !== "string") continue;
        const inner = JSON.parse(e[2]);
        if (Array.isArray(inner) && inner[0] === "garturlres" && /^https?:\/\//.test(String(inner[1] || ""))) return inner[1];
      }
    } catch { /* 아래 방식으로 */ }
  }
  const m = String(text || "").match(/garturlres\\",\\"(https?:(?:[^"\\]|\\\\u[0-9a-fA-F]{4})+)/);
  return m ? m[1].replace(/\\\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : null;
}

// 콘티 만들기 창의 Search: 최근 1주 기사, 같은 기사는 하나만, 주소를 푼 기사 최대 5건
async function searchMode(q) {
  const items = await searchNews(`${q} when:7d`, 20);
  const seen = new Set();
  const uniq = items.filter((it) => { const k = norm(it.title); if (seen.has(k)) return false; seen.add(k); return true; });
  const picked = uniq.slice(0, MAX_SEARCH + 3);   // 주소 풀기에 실패하는 기사에 대비해 여유분까지 한꺼번에 푼다
  const urls = await Promise.all(picked.map((it) => resolveGoogleNews(it.link)));
  const out = [];
  picked.forEach((it, i) => {
    if (!urls[i] || out.length >= MAX_SEARCH) return;
    out.push({ title: it.title, url: urls[i], source: it.source || "", date: it.pubDate || "" });
  });
  return out;
}

// 관점 자료 후보: 칼럼·분석 기사를 앞에, 매체가 겹치지 않게 max+2건 (본문을 못 읽는 기사에 대비한 여유분)
async function perspectiveMode(topic, exclude, max) {
  const query = `${topic} (사설 OR 칼럼 OR 분석 OR 전망 OR 전문가) when:14d`;   // 최근 2주 기사만
  const items = await searchNews(query, 24);
  const skip = new Set(exclude.map(norm));
  const seenSource = new Set();
  const ranked = items
    .filter((it) => !skip.has(norm(it.title)))
    .map((it) => ({ ...it, score: OPINION_HINT.test(it.title) ? 2 : 0 }))
    .sort((a, b) => b.score - a.score);
  const picked = [];
  for (const it of ranked) {
    if (seenSource.has(it.source)) continue;   // 매체가 겹치지 않게
    seenSource.add(it.source);
    picked.push(it);
    if (picked.length >= max + 2) break;
  }
  const urls = await Promise.all(picked.map((it) => resolveGoogleNews(it.link)));
  return picked.map((it, i) => (urls[i] ? { title: it.title, source: it.source, url: urls[i] } : null)).filter(Boolean);
}

async function handle(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return reply({ error: "POST만 받아요" }, 405);
  let body;
  try { body = await request.json(); } catch { return reply({ error: "요청 형식이 잘못됐어요" }, 400); }
  const q = String((body && body.q) || "").trim().slice(0, 100);
  if (!q) return reply({ error: "검색할 주제를 입력하세요" }, 400);
  const mode = body.mode === "perspective" ? "perspective" : "search";
  try {
    if (mode === "perspective") {
      const exclude = (Array.isArray(body.exclude) ? body.exclude : []).slice(0, 10).map((t) => String(t || "").slice(0, 200));
      const max = Math.max(1, Math.min(5, Number(body.max) || 3));
      return reply({ items: await perspectiveMode(q, exclude, max) }, 200);
    }
    return reply({ items: await searchMode(q) }, 200);
  } catch (err) {
    return reply({ error: String((err && err.message) || err) }, 500);
  }
}

Deno.serve(handle);
