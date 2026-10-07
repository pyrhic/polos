// 완성 영상(버전)을 유튜브에 업로드하는 깃허브 액션(upload-youtube.yml)을 실행시킨다. 항상 비공개로 올린다.
const SUPABASE_URL = "https://oenqrlgmnkpzxsavnfyo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_sZ4wQgaC5f-i40pVzf0vIA_R7iJWDf5";
const REPO = "pyrhic/youtube-automation";
const WORKFLOW = "upload-youtube.yml";

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json" },
});

// 유튜브 API는 제목/설명의 < > 를 허용하지 않는다.
const clean = (s) => String(s || "").replace(/[<>]/g, "").trim();

export async function onRequestPost(context) {
  const { request, env } = context;
  const pat = env.GITHUB_PAT;
  if (!pat) return json({ error: "GITHUB_PAT 환경변수가 설정되지 않았습니다" }, 500);

  try {
    const { outputId, videoUrl, title, description, tags } = await request.json();
    if (!outputId || !videoUrl || !clean(title)) {
      return json({ error: "outputId, videoUrl, title이 필요합니다" }, 400);
    }
    if (!String(videoUrl).startsWith(`${SUPABASE_URL}/storage/v1/object/public/youtube-outputs/`)) {
      return json({ error: "허용되지 않은 영상 주소입니다" }, 400);
    }
    const cleanTitle = clean(title);
    if (cleanTitle.length > 100) return json({ error: "제목은 100자 이내여야 합니다" }, 400);
    const cleanDesc = clean(description);
    if (cleanDesc.length > 5000) return json({ error: "설명은 5000자 이내여야 합니다" }, 400);

    const supaHeaders = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    };

    // 이미 올라갔거나 올리는 중이면 중복 업로드 방지
    const cur = await fetch(`${SUPABASE_URL}/rest/v1/youtube_outputs?select=youtube_status&id=eq.${encodeURIComponent(outputId)}`, { headers: supaHeaders });
    const rows = await cur.json();
    if (!cur.ok || !rows.length) return json({ error: "해당 영상을 찾을 수 없습니다" }, 404);
    if (rows[0].youtube_status === "uploading" || rows[0].youtube_status === "done") {
      return json({ error: "이미 업로드 중이거나 업로드된 영상입니다" }, 409);
    }

    const ghRes = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "wicked-wiki-trigger",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          output_id: String(outputId),
          video_url: videoUrl,
          title: cleanTitle,
          description: cleanDesc,
          tags: clean(tags),
        },
      }),
    });
    if (!ghRes.ok) {
      return json({ error: "깃허브 액션 실행 실패", detail: await ghRes.text() }, 502);
    }

    await fetch(`${SUPABASE_URL}/rest/v1/youtube_outputs?id=eq.${encodeURIComponent(outputId)}`, {
      method: "PATCH", headers: supaHeaders,
      body: JSON.stringify({ youtube_status: "uploading", youtube_error: null }),
    });
    return json({ success: true }, 200);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
