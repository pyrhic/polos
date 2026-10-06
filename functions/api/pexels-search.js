// 콘티 페이지에서 키워드를 입력하면 실제 생성 때 쓰일 Pexels 영상 검색 결과를
// 미리 보여주기 위한 프록시 (API 키를 클라이언트에 노출하지 않기 위함).
export async function onRequestGet(context) {
  const { request, env } = context;
  const rawKey = env.PEXELS_API_KEY || "";
  // 공백/개행/탭 등 헤더에 쓸 수 없는 문자를 전부 제거 (복사 과정에서 섞여 들어가는 경우 방지)
  const apiKey = rawKey.replace(/[\r\n\t\s]/g, "");
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
      const mp4s = (v.video_files || []).filter((f) => f.file_type === "video/mp4");
      const preview = [...mp4s].sort((a, b) => (a.width || 0) - (b.width || 0))[0];
      // 실제 영상 제작에 쓸 HD 파일 (세로면 높이 1280 이상 중 가장 작은 것, 없으면 가장 큰 것)
      const byHeight = [...mp4s].sort((a, b) => (a.height || 0) - (b.height || 0));
      const hd = byHeight.find((f) => (f.height || 0) >= 1280) || byHeight[byHeight.length - 1];
      return {
        id: v.id,
        duration: v.duration,
        thumbnail: v.image,
        preview_url: preview ? preview.link : null,
        hd_url: hd ? hd.link : null,
      };
    });
    return new Response(JSON.stringify({ results }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: err.message,
      // 값 자체는 안 보여주고, 길이/문자 구성만 진단용으로 남김
      diagnostic: { rawLength: rawKey.length, cleanedLength: apiKey.length },
    }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
