// 깃허브 액션(youtube-automation 레포)의 "영상 생성" 워크플로우를 원격으로 실행시킨다.
import "../../config.js"; // 주소/키/저장소 이름은 루트의 config.js 한 곳에서 관리한다
import { checkUploadMeta } from "../_lib/upload-meta.js";
const { SUPABASE_URL, SUPABASE_ANON_KEY, GITHUB_REPO: REPO } = globalThis.POLOS_CONFIG;
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
    const { scriptId, scriptContent, segments, settings, channel, version, autoUpload } = body;
    if (!scriptId || !scriptContent) {
      return new Response(JSON.stringify({ error: "scriptId, scriptContent가 필요합니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    if (!segments || !segments.length) {
      return new Response(JSON.stringify({ error: "콘티(segments)가 없습니다 — 콘티 페이지에서 먼저 만들어주세요" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    // 생성되면 자동으로 비공개 업로드 (콘티의 "생성되면 자동으로 비공개 업로드"를 켰을 때만).
    // Studio 업로드(/api/trigger-upload)와 같은 검사를 지금 해 두고, 값은 segments_json의 auto_upload로 워크플로우에 넘긴다
    // (워크플로우가 완성 영상을 저장한 뒤 upload-youtube.yml을 실행한다 — docs/storyboard-contract.md 15절). 비밀값은 넣지 않는다.
    let autoUploadMeta = null;
    if (autoUpload) {
      const { meta, error } = await checkUploadMeta(autoUpload);
      if (error) {
        return new Response(JSON.stringify({ error: `자동 업로드 설정 오류: ${error} — "생성되면 자동으로 비공개 업로드"를 끄고 다시 누르거나 채널을 확인하세요` }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      autoUploadMeta = { title: meta.title, description: meta.description, tags: meta.tags, channel_slot: meta.channel_slot, privacy: "private" };
    }

    const ghRes = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "wizard-yt-trigger",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          channel: channel || "wizard-yt",
          script_id: String(scriptId),
          script_content: scriptContent,
          segments_json: JSON.stringify({ segments, settings: settings || {}, ...(autoUploadMeta ? { auto_upload: autoUploadMeta } : {}) }),
          version: String(version || 1),
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
