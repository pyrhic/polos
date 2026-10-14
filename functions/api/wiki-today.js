// 오늘(한국 날짜)이 생일 또는 기일인 사망 인물. 위키미디어 "이 날의 역사(On this day)" 목록을 쓴다.
// GET /api/wiki-today?lang=ko|en|both
import { getEntities, entityFacts } from "../_lib/wiki.js";

const UA = "WickedWiki/1.0 (https://polos-cxn.pages.dev)";
const json = (obj, status, extra = {}) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", ...extra },
});

async function feed(lang, type, mm, dd) {
  const r = await fetch(`https://api.wikimedia.org/feed/v1/wikipedia/${lang}/onthisday/${type}/${mm}/${dd}`, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
  if (!r.ok) return [];
  const j = await r.json();
  return (j[type] || []).map((e) => ({ year: e.year, page: (e.pages || [])[0], lang, type })).filter((e) => e.page && e.page.wikibase_item);
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const langParam = url.searchParams.get("lang") || "both";
  if (!["ko", "en", "both"].includes(langParam)) return json({ error: "언어가 올바르지 않습니다" }, 400);
  // "이 날의 역사" 목록은 영어판이 충실하고 한국어판은 비어 있어서, 영어판 목록으로 찾고 한국어 문서는 위키데이터로 연결한다.
  // 언어 선택은 "그 언어 문서가 있는 인물만" 보여주는 필터로 쓴다.
  const langs = ["en"];
  const kst = new Date(Date.now() + 9 * 3600e3);
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0"), dd = String(kst.getUTCDate()).padStart(2, "0");

  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) { const hit = await cache.match(context.request); if (hit) return hit; }
  try {
    const lists = await Promise.all(langs.flatMap((l) => ["births", "deaths"].map((t) => feed(l, t, mm, dd).catch(() => []))));
    const all = lists.flat();
    const ents = await getEntities(all.map((e) => e.page.wikibase_item));
    const byKey = new Map();
    for (const e of all) {
      const qid = e.page.wikibase_item;
      const ent = ents[qid];
      if (!ent) continue;
      const f = entityFacts(ent);
      if (!f.human || !f.deceased) continue;          // 태어난 날이 오늘이어도 생존 인물은 제외
      const key = `${e.type}:${qid}`;
      const cur = byKey.get(key) || { type: e.type, qid, year: e.year, name: f.label || e.page.title, born: f.born, died: f.died, description: "", thumb: "", langs: {} };
      cur.langs[e.lang] = { title: e.page.title, url: e.page.content_urls?.desktop?.page || `https://${e.lang}.wikipedia.org/wiki/${encodeURIComponent(e.page.title.replace(/ /g, "_"))}` };
      for (const [l, v] of Object.entries(f.links || {})) if (!cur.langs[l]) cur.langs[l] = v;
      if (!cur.description || e.lang === "ko") cur.description = e.page.description || cur.description;
      if (!cur.thumb && e.page.thumbnail?.source) cur.thumb = e.page.thumbnail.source;
      byKey.set(key, cur);
    }
    // 한국어·영어 문서가 모두 있는 인물을 먼저(널리 알려진 인물일 가능성이 높다), 그다음 사진이 있는 인물
    const rank = (p) => (p.langs.ko && p.langs.en ? 2 : 0) + (p.thumb ? 1 : 0);
    const items = [...byKey.values()]
      .filter((p) => langParam === "both" || p.langs[langParam])
      .sort((a, b) => rank(b) - rank(a));
    const res = json({
      date: `${mm}월 ${dd}일`,
      births: items.filter((p) => p.type === "births").slice(0, 30),
      deaths: items.filter((p) => p.type === "deaths").slice(0, 30),
    }, 200, { "Cache-Control": "public, max-age=21600" });
    if (cache) context.waitUntil(cache.put(context.request, res.clone()));
    return res;
  } catch (err) {
    return json({ error: err.message }, 502);
  }
}
