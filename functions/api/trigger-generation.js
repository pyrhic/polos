// 깃허브 액션(youtube-automation 레포)의 "영상 생성" 워크플로우를 원격으로 실행시킨다.
const SUPABASE_URL = "https://oenqrlgmnkpzxsavnfyo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_sZ4wQgaC5f-i40pVzf0vIA_R7iJWDf5";
const REPO = "pyrhic/youtube-automation";
const WORKFLOW = "generate-video.yml";

export async function onRequestPost(context) {
  const { request, env } = context;
  const pat = env.GITHUB_PAT;
  if (!pat) {
    return new Response(JSON.stringify({ error: "GITHUB_PAT 환경변수가 설정되지 않았습니다" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await request.json();
    const { scriptId, scriptContent, assetUrls, channel } = body;
    if (!scriptId || !scriptContent) {
      return new Response(JSON.stringify({ error: "scriptId, scriptContent가 필요합니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
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
          channel: channel || "wicked-wiki",
          script_id: String(scriptId),
          script_content: scriptContent,
          asset_urls: (assetUrls || []).join("\n"),
        },
      }),
    });

    if (!ghRes.ok) {
      return new Response(JSON.stringify({ error: "깃허브 액션 실행 실패", detail: await ghRes.text() }), {
        status: 502, headers: { "Content-Type": "application/json" },
      });
    }

    // 러너가 큐에서 뜨는 데 시간이 걸릴 수 있어 즉시 상태를 표시해둔다.
    await fetch(`${SUPABASE_URL}/rest/v1/youtube_scripts?id=eq.${scriptId}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ generation_status: "running" }),
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
