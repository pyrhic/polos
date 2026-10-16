// 위키피디아(한국어+영어)에서 검색하고, 위키데이터로 문서 종류(인물·사건·지식 / 쓰지 않는 문서)와 사망 여부를 함께 알려준다.
// 인물은 사망한 인물만 소재로 쓴다(생존 인물은 명예훼손 위험). 목록·동음이의어, 영화·노래 같은 작품, 기업·방송사·그룹은 제외.
// GET /api/wiki-search?q=검색어
import { wikiGet, getEntities, entityFacts, loadClassTree, WIKI_LANGS } from "../_lib/wiki.js";

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json" },
});

// 위키데이터에 "목록"으로 적혀 있지 않은 목록·기록 정리 문서도 제목으로 거른다
const LIST_TITLE = /(목록|명단|일람|기록과 통계)$|^(lists? of|index of|outline of|timeline of) /i;

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
    const ancestors = await loadClassTree(ents).catch(() => null);   // 상위 분류로 사건/지식/제외를 가린다 (못 읽으면 간단 판정)
    // 같은 문서(같은 위키데이터 번호)는 한국어/영어 문서를 하나로 합친다
    const merged = new Map();
    for (const r of all) {
      const key = r.qid || `${r.lang}:${r.title}`;
      const facts = r.qid && ents[r.qid] ? entityFacts(ents[r.qid], ancestors) : { human: false, kind: null, skip: "meta", deceased: false, born: null, died: null, label: "", links: {} };
      if (facts.kind && facts.kind !== "person" && LIST_TITLE.test(r.title)) { facts.kind = null; facts.skip = "meta"; }
      const cur = merged.get(key) || { qid: r.qid, name: facts.label || r.title, kind: facts.kind, skip: facts.skip, human: facts.human, deceased: facts.deceased, born: facts.born, died: facts.died, thumb: "", snippet: "", langs: {} };
      cur.langs[r.lang] = { title: r.title, url: r.url };
      for (const [l, v] of Object.entries(facts.links || {})) if (!cur.langs[l]) cur.langs[l] = v;   // 검색에 안 걸린 다른 언어판도 연결
      if (!cur.thumb && r.thumb) cur.thumb = r.thumb;
      if (!cur.snippet || r.lang === "ko") cur.snippet = r.snippet || cur.snippet;
      merged.set(key, cur);
    }
    // 쓸 수 있는 문서(사망 인물·사건·지식)를 위로, 그다음 검색 순서대로
    const usable = (r) => (r.kind && (r.kind !== "person" || r.deceased) ? 1 : 0);
    const results = [...merged.values()].sort((a, b) => usable(b) - usable(a));
    return json({ results }, 200);
  } catch (err) {
    return json({ error: err.message }, 502);
  }
}
