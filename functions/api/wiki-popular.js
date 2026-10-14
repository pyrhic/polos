// 위키피디아에서 많이 읽힌 "사망 인물" 순위. 위키미디어 조회수 순위(문서별 조회수)를 합산한 뒤 위키데이터로 사망 인물만 남긴다.
// GET /api/wiki-popular?period=day|week|month|3m|6m|1y&lang=ko|en|both
// (위키피디아는 검색어 통계를 공개하지 않아서 "많이 검색된"이 아니라 "많이 읽힌" 순위다)
import { topViews, getEntitiesByTitles, entityFacts } from "../_lib/wiki.js";

const json = (obj, status, extra = {}) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", ...extra },
});

const PERIODS = {
  day: { label: "가장 최근 하루", days: 1, offset: 2 },
  week: { label: "최근 7일", days: 7, offset: 2 },
  month: { label: "지난달", months: 1 },
  "3m": { label: "최근 3개월", months: 3 },
  "6m": { label: "최근 6개월", months: 6 },
  "1y": { label: "최근 1년", months: 12 },
};
const CAP = 250;                       // 조회수 상위 몇 개까지 인물 여부를 확인할지 (제출 요청 수 제한 때문)
const pad = (n) => String(n).padStart(2, "0");
const SKIP = /^(Main_Page|-)$|:/;      // 대문, 특수/위키백과/포털/분류 같은 이름공간 문서는 제외

function paths(period) {
  const now = new Date();
  const out = [];
  if (period.days) {
    for (let i = 0; i < period.days; i++) {
      const d = new Date(now.getTime() - (period.offset + i) * 864e5);
      out.push(`${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`);
    }
  } else {
    for (let i = 1; i <= period.months; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      out.push(`${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/all-days`);
    }
  }
  return out;
}

async function rankLang(lang, period) {
  const lists = await Promise.all(paths(period).map((p) => topViews(lang, p).catch(() => [])));
  const total = new Map();
  for (const list of lists) for (const a of list) {
    if (SKIP.test(a.article)) continue;
    total.set(a.article, (total.get(a.article) || 0) + a.views);
  }
  const top = [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, CAP);
  const titles = top.map(([t]) => t.replace(/_/g, " "));
  const ents = await getEntitiesByTitles(lang, titles);
  const people = [];
  top.forEach(([t, views], i) => {
    const ent = ents.get(t.replace(/_/g, " "));
    if (!ent) return;
    const f = entityFacts(ent);
    if (f.human && f.deceased) people.push({ qid: ent.id, title: t.replace(/_/g, " "), views, f });
  });
  return people;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const period = PERIODS[url.searchParams.get("period") || "month"];
  const langParam = url.searchParams.get("lang") || "both";
  if (!period) return json({ error: "기간이 올바르지 않습니다" }, 400);
  const langs = langParam === "both" ? ["ko", "en"] : [langParam];
  if (!langs.every((l) => ["ko", "en"].includes(l))) return json({ error: "언어가 올바르지 않습니다" }, 400);

  // 같은 요청은 6시간 동안 저장해 둔 결과를 쓴다 (순위는 하루 단위로만 바뀜)
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) { const hit = await cache.match(context.request); if (hit) return hit; }
  try {
    const perLang = await Promise.all(langs.map((l) => rankLang(l, period)));
    const byQid = new Map();
    perLang.forEach((list, li) => list.forEach((p, rank) => {
      const lang = langs[li];
      const cur = byQid.get(p.qid) || { qid: p.qid, name: p.f.label || p.title, born: p.f.born, died: p.f.died, diedAt: p.f.diedAt, views: {}, ranks: {}, langs: {}, score: 0 };
      cur.views[lang] = p.views; cur.ranks[lang] = rank + 1;
      cur.score += 1 / (rank + 1);      // 언어별 순위로 합친다 (영어 조회수가 한국어보다 훨씬 커서 숫자를 그대로 더하지 않는다)
      cur.langs[lang] = { title: p.title, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}` };
      for (const [l, v] of Object.entries(p.f.links || {})) if (!cur.langs[l]) cur.langs[l] = v;
      byQid.set(p.qid, cur);
    }));
    const yearAgo = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
    const people = [...byQid.values()].sort((a, b) => b.score - a.score).slice(0, 40)
      .map((p) => ({ ...p, recent: !!p.diedAt && p.diedAt >= yearAgo }));
    const res = json({ period: url.searchParams.get("period") || "month", label: period.label, people }, 200, { "Cache-Control": "public, max-age=21600" });
    if (cache) context.waitUntil(cache.put(context.request, res.clone()));
    return res;
  } catch (err) {
    return json({ error: err.message }, 502);
  }
}
