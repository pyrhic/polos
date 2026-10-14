// 위키피디아 / 위키데이터 / 위키미디어 커먼즈 조회 도구 (모두 무료 공개 API).
// 위키미디어는 앱 이름이 들어간 User-Agent를 요구한다.
const UA = "WickedWiki/1.0 (https://polos-cxn.pages.dev)";

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

// 위키데이터 항목에서 인물 여부 / 사망 여부 / 출생·사망 연도를 읽는다
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
  return { human, deceased, born: year("P569"), died: year("P570"), label };
}

export async function getEntities(qids) {
  const ids = [...new Set(qids.filter(Boolean))].slice(0, 40);
  if (!ids.length) return {};
  const d = await wikiGet("www.wikidata.org", { action: "wbgetentities", ids: ids.join("|"), props: "claims|labels", languages: "ko|en" });
  return d.entities || {};
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
