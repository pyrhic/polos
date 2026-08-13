// 검색어로 유튜브 인기 영상 메타데이터(제목/조회수/길이)만 가져온다.
// 영상 자체나 대본은 가져오지 않음 — 패턴 참고용.
function parseIso8601Duration(duration) {
  const m = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const [, h, mi, s] = m;
  return (parseInt(h || 0) * 3600) + (parseInt(mi || 0) * 60) + parseInt(s || 0);
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  if (!q) {
    return new Response(JSON.stringify({ error: "검색어(q)가 필요합니다" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "YOUTUBE_API_KEY 환경변수가 설정되지 않았습니다" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}` +
      `&type=video&order=viewCount&maxResults=15&regionCode=KR&relevanceLanguage=ko&key=${apiKey}`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) {
      return new Response(JSON.stringify({ error: "유튜브 검색 실패", detail: await searchRes.text() }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    const searchData = await searchRes.json();
    const videoIds = (searchData.items || []).map((item) => item.id.videoId).filter(Boolean);
    if (videoIds.length === 0) {
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails` +
      `&id=${videoIds.join(",")}&key=${apiKey}`;
    const detailsRes = await fetch(detailsUrl);
    if (!detailsRes.ok) {
      return new Response(JSON.stringify({ error: "유튜브 상세정보 조회 실패", detail: await detailsRes.text() }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    const detailsData = await detailsRes.json();

    const videos = (detailsData.items || []).map((item) => ({
      videoId: item.id,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      viewCount: parseInt(item.statistics.viewCount || "0"),
      durationSec: parseIso8601Duration(item.contentDetails.duration),
    }));
    videos.sort((a, b) => b.viewCount - a.viewCount);

    return new Response(JSON.stringify(videos), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
