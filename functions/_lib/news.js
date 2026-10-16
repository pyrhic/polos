// 대본의 "관점 정리"에 쓸 칼럼·분석 기사를 찾아 본문을 가져온다.
// 구글 뉴스 검색·주소 풀기는 Cloudflare에서 막혀서(봇 차단 503) Supabase Edge Function news-search(mode "perspective")가 하고,
// 여기서는 그 후보 기사의 본문만 읽는다.
import "../../config.js";
import { fetchArticle } from "./article.js";

// 주제와 관련된 칼럼·분석·전문가 의견 기사 최대 max건: { title, source, url, text }
// excludeTitles: 이미 참고 기사로 쓰고 있는 기사 제목들(같은 기사는 뺀다). env: Cloudflare 환경변수(SUPABASE_URL을 바꿀 때만)
// 함수를 못 부르거나 후보가 없으면 [] (관점 정리 없이 쓴다)
export async function findPerspectiveArticles(topic, excludeTitles = [], max = 3, env = {}) {
  const C = globalThis.POLOS_CONFIG || {};
  const sb = String((env && env.SUPABASE_URL) || C.SUPABASE_URL || "").replace(/\/$/, "");
  const key = C.SUPABASE_ANON_KEY || "";
  if (!sb) return [];
  let items = [];
  try {
    const res = await fetch(`${sb}/functions/v1/news-search`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ q: topic, mode: "perspective", exclude: excludeTitles, max }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    items = Array.isArray(data && data.items) ? data.items : [];
  } catch {
    return [];
  }
  const resolved = await Promise.all(items.filter((it) => it && /^https?:\/\//.test(String(it.url || ""))).map(async (it) => {
    const art = await fetchArticle(it.url, 1600);
    return art.text.length >= 200 ? { title: it.title, source: it.source, url: it.url, text: art.text } : null;
  }));
  return resolved.filter(Boolean).slice(0, max);
}
