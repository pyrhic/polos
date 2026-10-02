// 콘티 페이지에서 키워드를 입력하면 실제 생성 때 쓰일 Pexels 영상 검색 결과를
// 미리 보여주기 위한 프록시 (API 키를 클라이언트에 노출하지 않기 위함).
export async function onRequestGet(context) {
  const { request, env } = context;
  const apiKey = (env.PEXELS_API_KEY || "").trim();
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "PEXELS_API_KEY 환경변수가 설정되지 않았습니다" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  const orientation = url.searchParams.get("orientation") || "portrait";
  if (!query) {
    return new Response(JSON.stringify({ error: "q(검색어)가 필요합니다" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const pexelsRes = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=8&orientation=${orientation}`,
      { headers: { Authorization: apiKey } }
    );
    if (!pexelsRes.ok) {
      return new Response(JSON.stringify({ error: "Pexels 검색 실패", detail: await pexelsRes.text() }), {
        status: 502, headers: { "Content-Type": "application/json" },
      });
    }
    const data = await pexelsRes.json();
    const results = (data.videos || []).map((v) => {
      const preview = (v.video_files || [])
        .filter((f) => f.file_type === "video/mp4")
        .sort((a, b) => (a.width || 0) - (b.width || 0))[0];
      return {
        id: v.id,
        duration: v.duration,
        thumbnail: v.image,
        preview_url: preview ? preview.link : null,
      };
    });
    return new Response(JSON.stringify({ results }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
