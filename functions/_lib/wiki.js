// 위키피디아 / 위키데이터 / 위키미디어 커먼즈 조회 도구 (모두 무료 공개 API).
// 위키미디어는 앱 이름이 들어간 User-Agent를 요구한다.
import "../../config.js";
export const UA = globalThis.POLOS_CONFIG.WIKI_USER_AGENT || "PolosYoutube/1.0 (set WIKI_USER_AGENT in config.js)";

export const WIKI_LANGS = ["ko", "en"];

export async function wikiGet(host, params) {
  const url = `https://${host}/w/api.php?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
  if (!res.ok) throw new Error(`위키 응답 오류 (${host} ${res.status})`);
  return res.json();
}

const decodeHtml = (s) => String(s || "")
  .replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

// 영상 소재로 쓰지 않는 문서 종류(위키데이터 "무엇의 한 종류인가"(P31) 번호). 이유별로 나눠서 화면에 알려준다.
//  meta: 동음이의어·목록·틀·분류 같은 위키 관리용 문서
//  work: 영화·드라마·음반·노래·게임·만화·가상 인물 같은 작품류 (조회수 순위를 다 차지해서 연예 작품으로 가득 차는 걸 막는다)
//  org : 방송사·웹사이트·플랫폼·인터넷 주소 끝자리·음악 그룹·기업 (홍보성 문서가 많고 이야기 소재가 아님)
const SKIP_DIRECT = {
  meta: ["Q4167410", "Q13406463", "Q11266439", "Q4167836", "Q17442446"],
  work: ["Q11424", "Q5398426", "Q1983062", "Q15416", "Q202866", "Q63952888", "Q482994", "Q134556", "Q7366", "Q7889", "Q95074", "Q15632617"],
  org: ["Q1616075", "Q15265344", "Q35127", "Q118140435", "Q559856", "Q6576792", "Q122759350", "Q29380", "Q14296",
    "Q641066", "Q216337", "Q215380", "Q43229", "Q4830453"],
};
// 상위 분류(P279)를 따라 3단계 안에 이 중 하나가 나오면 같은 이유로 제외 (예: "걸그룹" → … → "음악 그룹", "노래" → "음악 작품")
// 기업·단체(Q43229)는 위로 올라가면 정당·왕조·군대까지 걸려서, 위 목록처럼 바로 적힌 경우만 제외한다
const SKIP_ROOTS = {
  meta: ["Q17442446", "Q13406463"],                                                     // 위키미디어 내부 항목, 목록 문서
  work: ["Q2431196", "Q105543609", "Q108346082", "Q15416", "Q7889", "Q1004", "Q95074"],   // 영상 작품, 음악 작품, 음반, TV 프로그램, 게임, 만화, 가상 인물
  org: ["Q215380", "Q35127"],                                                           // 음악 그룹, 웹사이트
};
// 사건: 상위 분류가 "일어난 일(Q1190554)" 또는 "사건(Q1656682)"으로 이어지는 문서 (전쟁·전투·재난·사고·암살·혁명·선거·대회 등)
const EVENT_ROOTS = ["Q1190554", "Q1656682"];
// 문서 성격과 상관없는 표시라서 무시하는 종류: "위키뉴스 기사"(타이타닉호 침몰 사고 같은 사건 문서에 붙어 있다)
const IGNORE_TYPES = new Set(["Q17633526"]);
const SKIP_REASON = new Map(Object.entries(SKIP_DIRECT).flatMap(([why, ids]) => ids.map((id) => [id, why])));
const ROOT_REASON = new Map(Object.entries(SKIP_ROOTS).flatMap(([why, ids]) => ids.map((id) => [id, why])));

const p31Types = (ent) => ((ent && ent.claims && ent.claims.P31) || []).map((s) => s.mainsnak?.datavalue?.value?.id).filter((t) => t && !IGNORE_TYPES.has(t));

// 분류 번호 -> { 기준 분류 번호: 몇 단계 위인지 } (한 번 알아낸 것은 기억해 두고 다음 검색에서 다시 쓴다)
const classRootCache = new Map();
const ALL_ROOTS = [...EVENT_ROOTS, ...ROOT_REASON.keys()];
// 문서들의 종류 번호가 사건/제외 기준 분류의 몇 단계 아래인지(4단계까지) 위키데이터 질의(SPARQL) 한 번으로 알아낸다.
// 질의가 느리거나 실패하면 null -> 종류 번호만 보는 간단 판정으로 넘어간다.
// 돌려주는 값: ancestors(type) -> Map(기준 분류 번호 -> 단계: 자기 자신이나 바로 위는 1)
export async function loadClassTree(ents, { timeoutMs = 6000 } = {}) {
  const types = [...new Set(Object.values(ents || {}).flatMap(p31Types))];
  const need = types.filter((t) => !classRootCache.has(t) && /^Q\d+$/.test(t));
  if (need.length) {
    const vals = (ids) => ids.map((id) => "wd:" + id).join(" ");
    const q = `SELECT ?t ?r ?l WHERE { VALUES ?t { ${vals(need)} } VALUES ?r { ${vals(ALL_ROOTS)} }
 { ?t wdt:P279? ?r BIND(1 AS ?l) } UNION { ?t wdt:P279/wdt:P279 ?r BIND(2 AS ?l) }
 UNION { ?t wdt:P279/wdt:P279/wdt:P279 ?r BIND(3 AS ?l) } UNION { ?t wdt:P279/wdt:P279/wdt:P279/wdt:P279 ?r BIND(4 AS ?l) } }`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
        headers: { "User-Agent": UA, "Api-User-Agent": UA, Accept: "application/sparql-results+json" }, signal: ctl.signal,
      });
      if (!res.ok) return null;
      const j = await res.json();
      const found = new Map(need.map((t) => [t, new Map()]));
      for (const b of j.results?.bindings || []) {
        const t = String(b.t?.value || "").split("/").pop(), r = String(b.r?.value || "").split("/").pop(), l = Number(b.l?.value);
        const m = found.get(t);
        if (m && r && l) m.set(r, Math.min(m.get(r) ?? 9, l));
      }
      for (const [t, m] of found) classRootCache.set(t, m);
    } catch { return null; } finally { clearTimeout(timer); }
  }
  return (type) => classRootCache.get(type) || new Map();
}

// 종류 판정. ancestors(위 loadClassTree 결과)가 없으면 종류 번호만 보고 간단히 판정한다(인기 순위·오늘의 목록처럼 문서가 많을 때)
//  돌려주는 값: { kind: "person"|"event"|"thing"|null, skip: null|"meta"|"work"|"org" }
function classify(claims, ancestors) {
  const types = p31Types({ claims });
  if (types.includes("Q5")) return { kind: "person", skip: null };
  for (const t of types) if (SKIP_REASON.has(t)) return { kind: null, skip: SKIP_REASON.get(t) };
  const dated = ["P585", "P580", "P582", "P619"].some((p) => (claims[p] || []).length > 0);   // 일어난 때 / 시작·끝 시점 / 발사일(우주 비행)
  if (!ancestors) return { kind: dated ? "event" : "thing", skip: null };
  let eventLevel = Infinity;
  for (const t of types) {
    for (const [a, lvl] of ancestors(t)) {
      if (lvl <= 3 && ROOT_REASON.has(a)) return { kind: null, skip: ROOT_REASON.get(a) };
      if (EVENT_ROOTS.includes(a)) eventLevel = Math.min(eventLevel, lvl);
    }
  }
  // 사건 분류에 가깝게(2단계 이내) 이어지거나, 멀어도 일어난 때가 적혀 있으면 사건. (질병처럼 멀리서만 이어지는 개념은 지식)
  if (eventLevel <= 2 || (eventLevel < Infinity && dated)) return { kind: "event", skip: null };
  if (!types.length && dated) return { kind: "event", skip: null };
  return { kind: "thing", skip: null };
}

// 위키데이터 항목에서 종류(인물/사건/지식) / 사망 여부 / 출생·사망 연도를 읽는다
//  kind: "person"(인물) / "event"(사건) / "thing"(지식: 그 밖의 개념·사물·장소·작품 등) / null(쓰지 않는 문서, 이유는 skip)
export function entityFacts(ent, ancestors) {
  const claims = (ent && ent.claims) || {};
  const human = (claims.P31 || []).some((s) => s.mainsnak?.datavalue?.value?.id === "Q5");
  const year = (p) => {
    const t = (claims[p] || [])[0]?.mainsnak?.datavalue?.value?.time;
    const m = /^([+-])(\d{1,4})-/.exec(t || "");
    return m ? (m[1] === "-" ? -Number(m[2]) : Number(m[2])) : null;
  };
  // 사망일이 "알 수 없음"으로 적힌 경우(somevalue)도 사망으로 본다
  const deceased = (claims.P570 || []).some((s) => s.mainsnak?.snaktype !== "novalue");
  const label = (ent.labels?.ko?.value) || (ent.labels?.en?.value) || "";
  // 한국어/영어 위키피디아 문서 제목 (한쪽 언어로 검색해도 다른 쪽 문서를 알 수 있다)
  const links = {};
  for (const [lang, site] of [["ko", "kowiki"], ["en", "enwiki"]]) {
    const t = ent.sitelinks?.[site]?.title;
    if (t) links[lang] = { title: t, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, "_"))}` };
  }
  const diedTime = (claims.P570 || [])[0]?.mainsnak?.datavalue?.value?.time || "";
  const dm = /^[+-](\d{4})-(\d{2})-(\d{2})/.exec(diedTime);
  const diedAt = dm && dm[2] !== "00" && dm[3] !== "00" ? `${dm[1]}-${dm[2]}-${dm[3]}` : (dm ? dm[1] : null);
  const { kind, skip } = classify(claims, ancestors);
  return { human, kind, skip, deceased, born: year("P569"), died: year("P570"), diedAt, label, links };
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export async function getEntities(qids) {
  const ids = [...new Set(qids.filter(Boolean))];
  if (!ids.length) return {};
  const parts = await Promise.all(chunk(ids, 40).map((c) =>
    wikiGet("www.wikidata.org", { action: "wbgetentities", ids: c.join("|"), props: "claims|labels|sitelinks", languages: "ko|en", sitefilter: "kowiki|enwiki" })
      .then((d) => d.entities || {}).catch(() => ({}))));
  return Object.assign({}, ...parts);
}

// 위키피디아 문서 제목들로 위키데이터 항목을 한꺼번에 찾는다 (제목 -> 항목). 50개씩 한 번에 조회.
export async function getEntitiesByTitles(lang, titles) {
  const site = `${lang}wiki`;
  const out = new Map();
  const parts = await Promise.all(chunk([...new Set(titles)], 50).map((c) =>
    wikiGet("www.wikidata.org", { action: "wbgetentities", sites: site, titles: c.join("|"), props: "claims|labels|sitelinks", languages: "ko|en", sitefilter: "kowiki|enwiki" })
      .then((d) => d.entities || {}).catch(() => ({}))));
  for (const ents of parts) for (const ent of Object.values(ents)) { const t = ent.sitelinks?.[site]?.title; if (t) out.set(t, ent); }
  return out;
}

// 위키미디어 조회수 순위 (상위 1000개 문서). path는 "2026/10/12"(하루) 또는 "2026/09/all-days"(한 달)
export async function topViews(lang, path) {
  const r = await fetch(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${lang}.wikipedia/all-access/${path}`, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
  if (!r.ok) return [];
  const j = await r.json();
  return j.items?.[0]?.articles || [];
}

// 제목으로 문서 본문(평문)과 다른 언어판 제목을 가져온다
export async function getArticle(lang, title, cap = 12000) {
  const other = lang === "ko" ? "en" : "ko";
  const d = await wikiGet(`${lang}.wikipedia.org`, {
    action: "query", prop: "extracts|langlinks|pageprops|info", explaintext: "1", exsectionformat: "plain",
    titles: title, redirects: "1", lllang: other, ppprop: "wikibase_item", inprop: "url",
  });
  const p = d.query?.pages?.[0];
  if (!p || p.missing) return null;
  return {
    lang, title: p.title, url: p.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
    text: String(p.extract || "").slice(0, cap), qid: p.pageprops?.wikibase_item || null,
    otherTitle: p.langlinks?.[0]?.title || null, otherLang: other,
  };
}

const BAD_FILE = /(logo|icon|flag|signature|stub|symbol|commons-|wiki|button|edit-|ambox|crystal|nuvola|folder)/i;

// 문서에 쓰인 사진 중 자유 라이선스인 것만 (저작자/라이선스 정보 포함). 대표 사진을 맨 앞에 둔다.
export async function getFreeImages(lang, title, limit = 10) {
  const host = `${lang}.wikipedia.org`;
  const [imgs, lead] = await Promise.all([
    wikiGet(host, {
      action: "query", generator: "images", titles: title, gimlimit: "50", redirects: "1",
      prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: "1400",
      iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|Credit|NonFree|ImageDescription",
    }),
    wikiGet(host, { action: "query", prop: "pageimages", piprop: "name", titles: title, redirects: "1" }).catch(() => null),
  ]);
  const leadName = lead?.query?.pages?.[0]?.pageimage || "";
  const out = [];
  for (const p of imgs.query?.pages || []) {
    const ii = p.imageinfo?.[0];
    if (!ii) continue;
    const ext = ii.extmetadata || {};
    if (!/^image\/(jpeg|png|webp)$/.test(ii.mime || "")) continue;
    if (ext.NonFree?.value && String(ext.NonFree.value).toLowerCase() !== "false") continue;   // 위키피디아 안에서만 쓰는 비자유 사진은 제외
    const license = decodeHtml(ext.LicenseShortName?.value);
    if (!license) continue;
    const fileName = String(p.title || "").replace(/^(File|파일):/i, "");
    if (BAD_FILE.test(fileName) || (ii.width || 0) < 600 || (ii.height || 0) < 400) continue;
    out.push({
      url: ii.thumburl || ii.url, page: ii.descriptionurl || "", file: fileName,
      artist: decodeHtml(ext.Artist?.value).slice(0, 120), license, licenseUrl: ext.LicenseUrl?.value || "",
      caption: decodeHtml(ext.ImageDescription?.value).slice(0, 140), width: ii.width, height: ii.height,
      isLead: !!leadName && fileName.replace(/ /g, "_") === leadName.replace(/ /g, "_"),
    });
  }
  out.sort((a, b) => (b.isLead ? 1 : 0) - (a.isLead ? 1 : 0));
  return out.slice(0, limit);
}

export function creditLine(img) {
  const who = img.artist ? ` / ${img.artist}` : "";
  return `사진: ${img.file}${who} / ${img.license} / ${img.page}`;
}
