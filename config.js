// 폴로스 유튜브 기능 설정 — 화면 파일과 서버 함수가 모두 이 파일을 읽습니다. (다른 파일에는 이 값들이 없습니다.)
//
//  SUPABASE_URL      Supabase 대시보드 → 프로젝트 → Project Settings → API → Project URL
//  SUPABASE_ANON_KEY 같은 화면의 anon(publishable) public 키 — 공개돼도 되는 키라 여기 적어도 됩니다.
//                    (비밀 키인 service_role 키는 절대 여기에 넣지 마세요)
//  GITHUB_REPO       영상 생성/업로드 자동화 저장소 "내계정/저장소이름"
//  YT_CHANNELS       유튜브 채널 목록의 "기본값". 실제 목록은 Supabase 표 youtube_channels에 있으면 그 표를 쓰고,
//                    표가 없거나 비어 있을 때만 이 목록을 씁니다. slot은 GitHub 비밀값과 짝(1번=YOUTUBE_OAUTH_TOKEN,
//                    N번=YOUTUBE_OAUTH_TOKEN_N)이고, ready:false 는 로그인 승인 전이라는 뜻입니다.
//  REAUTH_DIR        (선택) 허가증을 PC에서 다시 받을 때 쓰는 youtube-automation 폴더 경로. 비우면 재로그인 명령 버튼을 숨깁니다.
//  WIKI_USER_AGENT   위키미디어 서버가 요구하는 앱 소개 문구 — "앱이름/버전 (연락처 주소나 이메일)" 형태로 적으세요.
//
// 비밀 키(Gemini, Pexels, GitHub 토큰)는 여기가 아니라 Cloudflare 환경변수에 넣습니다.
globalThis.POLOS_CONFIG = {
  SUPABASE_URL: "https://oenqrlgmnkpzxsavnfyo.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_sZ4wQgaC5f-i40pVzf0vIA_R7iJWDf5",
  GITHUB_REPO: "pyrhic/youtube-automation",
  YT_CHANNELS: [
    { slot: "1", label: "Wicked Wiki" },
    { slot: "2", label: "연예계중개" },
    { slot: "3", label: "OUTSTAGRAM", ready: false },
  ],
  REAUTH_DIR: "C:/Users/PC/youtube-automation",
  WIKI_USER_AGENT: "WickedWiki/1.0 (https://polos-cxn.pages.dev)",
};
