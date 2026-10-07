// 구글 트렌드 "지금 인기 급상승" 공개 RSS를 읽어 검색량 높은 순으로 돌려준다 (공식 API가 없어 RSS 사용).
const decode = (s) => String(s || "")
  .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

const pick = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decode(m[1]) : "";
};

// "1000+", "2만+" 같은 표기에서 비교용 숫자를 뽑는다
function trafficNumber(text) {
  const n = parseInt(String(text).replace(/[^0-9]/g, ""), 10) || 0;
  if (/만/.test(text)) return n * 10000;
  if (/천/.test(text)) return n * 1000;
  if (/억/.test(text)) return n * 100000000;
  return n;
}

export async function onRequestGet(context) {
  const geo = (new URL(context.request.url).searchParams.get("geo") || "KR").replace(/[^A-Za-z-]/g, "").slice(0, 8) || "KR";
  try {
    const res = await fetch(`https://trends.google.com/trending/rss?geo=${geo}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) {
      return new Response(JSON.stringify({ error: "구글 트렌드를 불러오지 못했습니다", status: res.status }), {
        status: 502, headers: { "Content-Type": "application/json" },
      });
    }
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m, index) => {
      const block = m[1];
      const traffic = pick(block, "ht:approx_traffic");
      const news = [...block.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)].slice(0, 3).map((n) => ({
        title: pick(n[1], "ht:news_item_title"),
        url: pick(n[1], "ht:news_item_url"),
        source: pick(n[1], "ht:news_item_source"),
      }));
      return {
        title: pick(block, "title"),
        traffic,
        trafficNum: trafficNumber(traffic),
        pubDate: pick(block, "pubDate"),
        news,
        index,
      };
    });

    // 검색량 높은 순 (같으면 피드 순서 유지)
    items.sort((a, b) => b.trafficNum - a.trafficNum || a.index - b.index);
    const ranked = items.map(({ index, ...rest }, i) => ({ rank: i + 1, ...rest }));

    return new Response(JSON.stringify({ geo, fetchedAt: new Date().toISOString(), items: ranked }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
