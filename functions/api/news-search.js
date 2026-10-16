// 콘티 만들기 창의 Search: 주제로 구글 뉴스(RSS, 무료·키 없음)를 찾아 기사 최대 5건을 돌려준다.
// 구글 뉴스 링크는 중간 주소라서 실제 언론사 주소로 풀어 둔다 (콘티를 만들 때 gemini-draft가 본문·사진을 그 주소에서 읽는다).
// 못 푼 기사는 뺀다. 응답: { items: [{ title, url, source, date }] }
import { searchNews, resolveGoogleNews } from "../_lib/news.js";

const MAX = 5;
const json = (obj, status) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json" },
});
const norm = (t) => String(t || "").replace(/[\s'"“”‘’\[\]\(\)·,.\-…]/g, "").slice(0, 14);

export async function onRequestPost(context) {
  try {
    const { q } = await context.request.json();
    const query = String(q || "").trim().slice(0, 100);
    if (!query) return json({ error: "검색할 주제를 입력하세요" }, 400);
    const items = await searchNews(`${query} when:7d`, 20);   // 최근 1주 기사
    let diag = null;
    if (!items.length) { try { const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`, { headers: { "User-Agent": "Mozilla/5.0" } }); const t = await r.text(); diag = { status: r.status, head: t.slice(0, 160) }; } catch (e) { diag = { err: e.message }; } }
    // 같은 기사(제목 앞부분이 같음)는 하나만
    const seen = new Set();
    const uniq = items.filter((it) => { const k = norm(it.title); if (seen.has(k)) return false; seen.add(k); return true; });
    // 주소 풀기에 실패하는 기사에 대비해 여유분까지 한꺼번에 푼다
    const picked = uniq.slice(0, MAX + 3);
    const urls = await Promise.all(picked.map((it) => resolveGoogleNews(it.link)));
    const out = [];
    picked.forEach((it, i) => {
      if (!urls[i] || out.length >= MAX) return;
      out.push({ title: it.title, url: urls[i], source: it.source || "", date: it.pubDate || "" });
    });
    // 진단용: 구글 뉴스가 몇 건을 줬고 몇 건을 풀었는지 (화면은 items만 쓴다)
    return json({ items: out, found: items.length, resolved: urls.filter(Boolean).length, diag }, 200);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
