// 폴로스 유튜브 기능 설정 — 앱을 자기 것으로 쓰려면 이 파일의 값 3개만 바꾸면 됩니다.
// (화면 파일과 서버 함수가 모두 이 파일을 읽습니다. 다른 파일에는 이 값들이 없습니다.)
//
//  SUPABASE_URL      Supabase 대시보드 → 프로젝트 → Project Settings → API → Project URL
//  SUPABASE_ANON_KEY 같은 화면의 anon(publishable) public 키 — 공개돼도 되는 키라 여기 적어도 됩니다.
//                    (비밀 키인 service_role 키는 절대 여기에 넣지 마세요)
//  GITHUB_REPO       영상 생성/업로드 자동화 저장소 "내계정/저장소이름"
//
// 비밀 키(Gemini, Pexels, GitHub 토큰)는 여기가 아니라 Cloudflare 환경변수에 넣습니다.
globalThis.POLOS_CONFIG = {
  SUPABASE_URL: "https://oenqrlgmnkpzxsavnfyo.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_sZ4wQgaC5f-i40pVzf0vIA_R7iJWDf5",
  GITHUB_REPO: "pyrhic/youtube-automation",
  // 유튜브에 올릴 채널 목록 (slot 번호는 GitHub 비밀값 YOUTUBE_OAUTH_TOKEN / YOUTUBE_OAUTH_TOKEN_2와 짝).
  // label은 화면에 보이는 채널 이름 - 새 채널 이름을 여기에 적으세요.
  YT_CHANNELS: [
    { slot: "1", label: "Wicked Wiki" },
    { slot: "2", label: "새 채널" },
  ],
};
