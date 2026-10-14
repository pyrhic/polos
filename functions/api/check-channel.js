// 채널의 유튜브 로그인 허가증이 살아 있는지 "업로드 없이" 확인한다 (깃허브 액션 check-youtube-channel.yml 실행).
// 결과는 Supabase 표 youtube_channels의 check_status / check_message 에 남는다 (표가 없으면 액션 로그에만 남음).
import "../../config.js";
import { loadChannels, isValidSlot } from "../_lib/channels.js";

const { SUPABASE_URL, SUPABASE_ANON_KEY, GITHUB_REPO: REPO } = globalThis.POLOS_CONFIG;
const WORKFLOW = "check-youtube-channel.yml";

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json" },
});

export async function onRequestPost(context) {
  const { request, env } = context;
  const pat = env.GITHUB_PAT;
  if (!pat) return json({ error: "GITHUB_PAT 환경변수가 설정되지 않았습니다" }, 500);
  try {
    const { channelSlot } = await request.json();
    const slot = String(channelSlot || "");
    if (!isValidSlot(slot) || !(await loadChannels()).some((c) => c.slot === slot)) {
      return json({ error: "채널 번호가 올바르지 않습니다" }, 400);
    }
    const ghRes = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "polos-channel-check",
      },
      body: JSON.stringify({ ref: "main", inputs: { channel_slot: slot } }),
    });
    if (!ghRes.ok) return json({ error: "깃허브 액션 실행 실패", detail: await ghRes.text() }, 502);

    // 확인 중임을 표에 표시 (표가 없으면 조용히 건너뜀)
    await fetch(`${SUPABASE_URL}/rest/v1/youtube_channels?slot=eq.${slot}`, {
      method: "PATCH",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ check_status: "checking", check_message: null }),
    }).catch(() => {});
    return json({ success: true }, 200);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
