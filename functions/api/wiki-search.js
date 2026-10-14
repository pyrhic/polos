// 위키피디아(한국어+영어)에서 이름으로 검색하고, 위키데이터로 "인물인지 / 사망했는지"를 함께 알려준다.
// GET /api/wiki-search?q=이름
import { wikiGet, getEntities, entityFacts, WIKI_LANGS } from "../_lib/wiki.js";

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json" },
});

async function searchLang(lang, q) {
  const d = await wikiGet(`${lang}.wikipedia.org`, {
    action: "query", generator: "search", gsrsearch: q, gsrlimit: "6", gsrnamespace: "0",
    prop: "pageprops|pageimages|extracts|info", ppprop: "wikibase_item", piprop: "thumbnail", pithumbsize: "160",
    exintro: "1", explaintext: "1", exchars: "140", exlimit: "6", inprop: "url",
  });
  return (d.query?.pages || []).sort((a, b) => (a.index || 0) - (b.index || 0)).map((p) => ({
    lang, title: p.title, url: p.fullurl, qid: p.pageprops?.wikibase_item || null,
    snippet: String(p.extract || "").replace(/\s+/g, " ").trim(), thumb: p.thumbnail?.source || "",
  }));
}

export async function onRequestGet(context) {
  const q = new URL(context.request.url).searchParams.get("q") || "";
  if (!q.trim()) return json({ error: "검색어를 입력하세요" }, 400);
  try {
    const perLang = await Promise.all(WIKI_LANGS.map((l) => searchLang(l, q.trim().slice(0, 80)).catch(() => [])));
    const all = perLang.flat();
    const ents = await getEntities(all.map((r) => r.qid));
    // 같은 사람(같은 위키데이터 번호)은 한국어/영어 문서를 하나로 합친다
    const merged = new Map();
    for (const r of all) {
      const key = r.qid || `${r.lang}:${r.title}`;
      const facts = r.qid && ents[r.qid] ? entityFacts(ents[r.qid]) : { human: false, deceased: false, born: null, died: null, label: "", links: {} };
      const cur = merged.get(key) || { qid: r.qid, name: facts.label || r.title, human: facts.human, deceased: facts.deceased, born: facts.born, died: facts.died, thumb: "", snippet: "", langs: {} };
      cur.langs[r.lang] = { title: r.title, url: r.url };
      for (const [l, v] of Object.entries(facts.links || {})) if (!cur.langs[l]) cur.langs[l] = v;   // 검색에 안 걸린 다른 언어판도 연결
      if (!cur.thumb && r.thumb) cur.thumb = r.thumb;
      if (!cur.snippet || r.lang === "ko") cur.snippet = r.snippet || cur.snippet;
      merged.set(key, cur);
    }
    // 인물을 위로, 그다음 검색 순서대로
    const results = [...merged.values()].sort((a, b) => (b.human ? 1 : 0) - (a.human ? 1 : 0));
    return json({ results }, 200);
  } catch (err) {
    return json({ error: err.message }, 502);
  }
}
