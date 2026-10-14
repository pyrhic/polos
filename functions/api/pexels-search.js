// 콘티 페이지에서 키워드로 Pexels 영상을 찾는 프록시 (API 키를 클라이언트에 노출하지 않기 위함).
// 수동 "검색 미리보기"와 콘티의 자동 배치가 같이 쓴다.
// 검색 조건은 영상 생성 단계(youtube-automation 03_build_visuals.py의 search_pexels)와 똑같이 맞춘다
// (docs/storyboard-contract.md 2절): per_page=15, 길이 8초 이상, 세로면 높이 1280 이상이고 세로가 더 긴 mp4 중 가장 작은 것.
const PER_PAGE = 15;
const MIN_DURATION = 8;

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
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${PER_PAGE}&orientation=${orientation}`,
      { headers: { Authorization: apiKey } }
    );
    if (!pexelsRes.ok) {
      // 한도 초과(429)는 콘티가 "Pexels 한도 초과"로 구분해서 보여줄 수 있게 그대로 429로 돌려준다
      const quota = pexelsRes.status === 429;
      return new Response(JSON.stringify({ error: quota ? "Pexels 한도 초과" : "Pexels 검색 실패", quota, detail: await pexelsRes.text() }), {
        status: quota ? 429 : 502, headers: { "Content-Type": "application/json" },
      });
    }
    const data = await pexelsRes.json();
    const isPortrait = orientation === "portrait";
    const results = [];
    for (const v of data.videos || []) {
      if ((v.duration || 0) < MIN_DURATION) continue;
      const mp4s = (v.video_files || []).filter((f) => f.file_type === "video/mp4");
      // 실제 영상 제작에 쓸 HD 파일 (생성 단계와 같은 규칙. 맞는 파일이 없으면 이 영상은 뺀다)
      const hdFiles = isPortrait
        ? mp4s.filter((f) => (f.height || 0) >= 1280 && (f.height || 0) > (f.width || 0)).sort((a, b) => a.height - b.height)
        : mp4s.filter((f) => (f.width || 0) >= 1280 && (f.width || 0) <= 1920).sort((a, b) => a.width - b.width);
      if (!hdFiles.length) continue;
      const preview = [...mp4s].sort((a, b) => (a.width || 0) - (b.width || 0))[0];
      results.push({
        id: v.id,
        duration: v.duration,
        thumbnail: v.image,
        preview_url: preview ? preview.link : null,
        hd_url: hdFiles[0].link,
      });
    }
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
