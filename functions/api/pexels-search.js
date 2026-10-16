// 콘티 페이지에서 키워드로 Pexels 영상을 찾는 프록시 (API 키를 클라이언트에 노출하지 않기 위함).
// 수동 "검색 미리보기"와 콘티의 자동 배치가 같이 쓴다.
// 검색 조건 (docs/storyboard-contract.md 2절, 로컬 옛 방식 03_build_visuals.py의 search_pexels도 같은 규칙):
// 한 번 검색에 한 번만 부르고 per_page=80(Pexels 최대)으로 후보를 넉넉히 받는다 (한도: 시간당 200회, 월 2만 회).
// 길이 8초 이상, 세로면 높이 1280 이상이고 세로가 더 긴 mp4 중 가장 작은 것. 같은 제작자 영상은 최대 2개까지만.
// 순서 섞기·이전 콘티에서 쓴 영상 거르기는 콘티 화면이 한다.
const PER_PAGE = 80;
const MAX_PER_CREATOR = 2;
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
    const perCreator = new Map();
    for (const v of data.videos || []) {
      if ((v.duration || 0) < MIN_DURATION) continue;
      const mp4s = (v.video_files || []).filter((f) => f.file_type === "video/mp4");
      // 실제 영상 제작에 쓸 HD 파일 (생성 단계와 같은 규칙. 맞는 파일이 없으면 이 영상은 뺀다)
      const hdFiles = isPortrait
        ? mp4s.filter((f) => (f.height || 0) >= 1280 && (f.height || 0) > (f.width || 0)).sort((a, b) => a.height - b.height)
        : mp4s.filter((f) => (f.width || 0) >= 1280 && (f.width || 0) <= 1920).sort((a, b) => a.width - b.width);
      if (!hdFiles.length) continue;
      // 같은 제작자 영상이 후보를 독차지하지 않게 (조건을 통과한 것 중 Pexels 순서로 앞의 2개만)
      const user = v.user || {};
      const creator = user.id != null ? `id:${user.id}` : user.name ? `name:${user.name}` : "";
      if (creator) {
        const n = perCreator.get(creator) || 0;
        if (n >= MAX_PER_CREATOR) continue;
        perCreator.set(creator, n + 1);
      }
      const preview = [...mp4s].sort((a, b) => (a.width || 0) - (b.width || 0))[0];
      results.push({
        id: v.id,
        duration: v.duration,
        thumbnail: v.image,
        preview_url: preview ? preview.link : null,
        hd_url: hdFiles[0].link,
        user_id: user.id ?? null,
        user_name: user.name || "",
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
