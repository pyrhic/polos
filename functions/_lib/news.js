// 구글 뉴스 검색(RSS, 무료·키 없음)으로 주제와 관련된 칼럼·분석 기사를 찾아 본문을 가져온다.
// 대본의 "관점 정리"에 쓸 자료를 모으는 용도. 구글 뉴스 링크는 중간 주소라서 실제 언론사 주소로 풀어서 쓴다.
import { decode, fetchArticle } from "./article.js";

const UA = "Mozilla/5.0";
const OPINION_HINT = /사설|칼럼|기고|시론|논평|분석|전망|전문가|교수|비판|우려|논란|쟁점|해석|진단|평가/;

export async function searchNews(query, limit = 20) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return [];
  const xml = await res.text();
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const rawTitle = decode((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "");
    const link = decode((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "").trim();
    const source = decode((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || "");
    if (!rawTitle || !link) continue;
    // 제목 끝의 " - 매체명"은 떼어낸다
    const title = source && rawTitle.endsWith(" - " + source) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;
    items.push({ title, link, source });
    if (items.length >= limit) break;
  }
  return items;
}

// 구글 뉴스 중간 주소 -> 실제 기사 주소 (구글의 공개 웹 화면이 쓰는 변환 요청을 그대로 따라 한다)
export async function resolveGoogleNews(link) {
  try {
    const id = new URL(link).pathname.split("/").pop();
    const page = await fetch(`https://news.google.com/rss/articles/${id}?hl=ko&gl=KR&ceid=KR:ko`, { headers: { "User-Agent": UA } });
    const html = await page.text();
    const sg = (html.match(/data-n-a-sg="([^"]+)"/) || [])[1];
    const ts = (html.match(/data-n-a-ts="([^"]+)"/) || [])[1];
    if (!sg || !ts) return null;
    const inner = JSON.stringify(["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]);
    const body = "f.req=" + encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]]));
    const res = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": UA }, body,
    });
    const text = await res.text();
    const m = text.match(/garturlres\\",\\"(https?:[^"\\]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const norm = (t) => String(t || "").replace(/[\s'"“”‘’\[\]\(\)·,.\-…]/g, "").slice(0, 14);

// 주제와 관련된 칼럼·분석·전문가 의견 기사 최대 3건: { title, source, url, text }
// excludeTitles: 이미 참고 기사로 쓰고 있는 기사 제목들(같은 기사는 뺀다)
export async function findPerspectiveArticles(topic, excludeTitles = [], max = 3) {
  const query = `${topic} (사설 OR 칼럼 OR 분석 OR 전망 OR 전문가) when:14d`;   // 최근 2주 기사만
  const items = await searchNews(query, 24);
  const skip = new Set(excludeTitles.map(norm));
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
    if (picked.length >= max + 2) break;      // 본문을 못 읽는 기사에 대비해 여유분
  }
  const resolved = await Promise.all(picked.map(async (it) => {
    const url = await resolveGoogleNews(it.link);
    if (!url) return null;
    const art = await fetchArticle(url, 1600);
    return art.text.length >= 200 ? { title: it.title, source: it.source, url, text: art.text } : null;
  }));
  return resolved.filter(Boolean).slice(0, max);
}
