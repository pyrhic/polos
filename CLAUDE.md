# polos — 작업 안내 (개인 허브 앱)

Cloudflare Pages 정적 앱 + Functions(`functions/api/*` → `/api/*`). 빌드 단계 없음(루트에 package.json·wrangler 설정 없음).
`git push` (main) = 자동 배포 → https://polos-cxn.pages.dev . `_headers`가 모든 파일을 `Cache-Control: no-cache`로 준다.

## 방향

- 유튜브 앱(wizard-yt)은 2026-10-27에 **`C:\Users\PC\youtube-automation`(web/)로 옮겼다** → https://wizard-yt.pages.dev . polos에는 유튜브 코드가 없다. 옛 `/youtube/*`, `/wizard-yt`, `/privacy` 주소는 `_redirects`로 wizard-yt에 301 (구글 OAuth 동의 화면 주소는 2026-10-27 wizard-yt로 변경).
- polos는 **스킴밐스 + 간단한 도구(투두·일정·투자)** 만 남긴다. 다른 앱은 하나씩 따로 떼어 낸다.
- 나중엔 사람들이 만든 AI 기능·앱·영상을 공유하고 자랑하는 플랫폼(깃허브처럼)으로 키운다.

## 구조

허브: `index.html`(로고 캐러셀) → `skimmmiks/`, `todo/`, `trading/`. 공통: `app-menu.js`, `sw.js`(네트워크 우선 캐시), `update.js`(새 버전 감지 — 섹션/공통 파일이 생기면 `WATCH_FILES`에 추가).
서버: `functions/api/*.js` (주간보고서 생성, 로그 제출·조회, 구글 캘린더 일정, 저장소 관리).

## 확인

문법 검사:
```
for f in *.js functions/api/*.js; do node --check "$f" || echo "FAIL $f"; done
```
화면 확인: `.claude/launch.json`의 `polos-static` (`npx -y serve -l 8532 .`, 확인 후 끄기).

## 지켜야 할 규칙

- **비밀값 금지**: API 키·토큰·비밀번호 값을 레포·커밋·이 문서·로그에 넣지 않는다. 위치만: Cloudflare Pages 환경 변수(Functions의 `env.*`).
- **PGRST102**: 여러 행을 한 번에 insert(배열 POST)할 땐 모든 행의 키가 똑같아야 한다(`undefined` 대신 `""`/`[]`/`null`).
- UI는 미니멀(박스 없는 기호 버튼, 그 자리 편집). 사용자에게 SQL은 코드블록으로 보여주고 클립보드를 덮어쓰지 않는다.
