// 큐레이션 페이지에서 검색어로 Pexels 사진을 찾아 보여주는 프록시 (API 키를 클라이언트에 노출하지 않기 위함).
// 영상 제작에는 w=1600으로 줄인 주소를 쓴다 (원본은 수 MB라 내려받기만 오래 걸림).
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export async function onRequestGet(context) {
  const { request, env } = context;
  const apiKey = (env.PEXELS_API_KEY || "").replace(/[\r\n\t\s]/g, "");
  if (!apiKey) return json({ error: "PEXELS_API_KEY 환경변수가 설정되지 않았습니다" }, 500);

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim();
  if (!query) return json({ error: "q(검색어)가 필요합니다" }, 400);
  const orientation = ["portrait", "landscape", "square"].includes(url.searchParams.get("orientation")) ? url.searchParams.get("orientation") : "portrait";
  const page = Math.max(1, Math.min(10, Number(url.searchParams.get("page")) || 1));

  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&page=${page}&orientation=${orientation}`,
      { headers: { Authorization: apiKey } }
    );
    if (!res.ok) return json({ error: "Pexels 검색 실패", detail: (await res.text()).slice(0, 300) }, 502);
    const data = await res.json();
    const results = (data.photos || []).map((p) => ({
      id: p.id,
      thumb: p.src.medium,
      url: `${String(p.src.original).split("?")[0]}?auto=compress&cs=tinysrgb&w=1600`,
      page_url: p.url,
      photographer: p.photographer,
      photographer_url: p.photographer_url,
      alt: p.alt || "",
      width: p.width,
      height: p.height,
    }));
    return json({ results, page, total: data.total_results || 0 });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
