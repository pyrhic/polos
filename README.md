# polos

개인 허브 홈페이지 ("뽈로"). `sakyowon-site`(직장 정체성 전용 페이지)보다 상위에서, 직장/사업/취미/농사/일상 등 여러 정체성을 한곳에 모으는 진입점.

## 현재 상태
- 최상위 허브(`index.html`): "뽈로" — 로고+버튼 스타일, 4개 아이덴티티로 연결
  - 직장(사교원) → `sakyowon-site` (별도 도메인)
  - 사업(스킴밐스) → `/skimmmiks` (Q&A, Lessons, Skim Jam, Skim Session)
  - 트레이딩 → `/trading` (원래 sakyowon-site에 있었으나 이전됨)
  - 글쓰기 → `/writing` (양양전설/에세이/일일일시/습작의기억, 원래 sakyowon-site에 있었으나 이전됨)
- 4개 아이덴티티 페이지는 서로 캐러셀(스와이프/점 클릭)로 전환 가능 (`hub-nav.js`, 크로스도메인)
- 물든책방, 취미(음악과 건축), 농사, 일상은 아직 미착수

## 셋업
- Cloudflare Pages: 이 레포를 Connect to Git으로 연결 (정적 페이지 + Functions)
- 환경변수: `GOOGLE_SERVICE_ACCOUNT_KEY` (trading/writing 기능에 필요, sakyowon-site와 동일한 값)
- Supabase: `sakyowon-wiki-db` 프로젝트 재사용. `skimmmiks_tables.sql`을 SQL Editor에서 실행 필요
