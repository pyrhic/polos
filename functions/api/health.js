// 설정이 제대로 들어갔는지 알려주는 점검용 함수. 비밀값은 절대 돌려주지 않고 "들어 있는지(true/false)"만 알려준다.
//   GET /api/health            환경변수 4개가 들어 있는지
//   GET /api/health?verify=1   + GITHUB_PAT 가 자동화 저장소에 실제로 접근되는지 (깃허브에 한 번 물어봄)
import "../../config.js";

const ENV_NAMES = ["GITHUB_PAT", "GEMINI_API_KEY", "PEXELS_API_KEY", "GOOGLE_CLIENT_SECRET"];

export async function onRequestGet(context) {
  const { env, request } = context;
  const C = globalThis.POLOS_CONFIG;
  const result = {
    env: Object.fromEntries(ENV_NAMES.map((n) => [n, typeof env[n] === "string" && env[n].trim().length > 0])),
    config: {
      supabase: /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(C.SUPABASE_URL || "") && !!C.SUPABASE_ANON_KEY,
      githubRepo: /^[\w.-]+\/[\w.-]+$/.test(C.GITHUB_REPO || ""),
    },
  };
  if (new URL(request.url).searchParams.get("verify") === "1") {
    result.githubPatWorks = null;
    if (result.env.GITHUB_PAT && result.config.githubRepo) {
      try {
        const r = await fetch(`https://api.github.com/repos/${C.GITHUB_REPO}/actions/workflows`, {
          headers: { Authorization: `Bearer ${env.GITHUB_PAT.trim()}`, Accept: "application/vnd.github+json", "User-Agent": "polos-health" },
        });
        result.githubPatWorks = r.ok;
      } catch { result.githubPatWorks = false; }
    }
  }
  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
