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

// 영상 소재로 쓰지 않는 문서 종류(위키데이터 "무엇의 한 종류인가" 번호): 동음이의어, 목록, 틀, 분류, 그리고 영화·드라마·음반·노래·게임 같은 작품류
// (작품류는 조회수 순위를 다 차지해서 "지식" 목록이 연예 작품으로 가득 차는 걸 막는다)
const SKIP_KINDS = new Set([
  "Q4167410", "Q13406463", "Q11266439", "Q4167836", "Q17633526",
  "Q11424", "Q5398426", "Q1983062", "Q15416", "Q202866", "Q63952888", "Q482994", "Q134556", "Q7366", "Q7889", "Q95074", "Q15632617",
  // 방송사·웹사이트·플랫폼·인터넷 주소 끝자리·음악 그룹·기업 같은 것도 "지식" 소재가 아니라서 제외
  "Q1616075", "Q15265344", "Q35127", "Q118140435", "Q559856", "Q6576792", "Q122759350", "Q29380", "Q14296",
  "Q641066", "Q216337", "Q215380", "Q43229", "Q4830453",
]);

// 위키데이터 항목에서 종류(인물/사건/지식) / 사망 여부 / 출생·사망 연도를 읽는다
//  kind: "person"(인물) / "event"(사건: 일어난 때가 적힌 문서) / "thing"(지식: 그 밖의 개념·사물·장소) / null(쓰지 않는 문서)
export function entityFacts(ent) {
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
  const types = (claims.P31 || []).map((s) => s.mainsnak?.datavalue?.value?.id).filter(Boolean);
  const dated = (claims.P585 || []).length > 0 || (claims.P580 || []).length > 0;   // 일어난 때 / 시작 시점이 적혀 있으면 사건으로 본다
  let kind = "thing";
  if (human) kind = "person";
  else if (types.some((t) => SKIP_KINDS.has(t))) kind = null;
  else if (dated) kind = "event";
  return { human, kind, deceased, born: year("P569"), died: year("P570"), diedAt, label, links };
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
