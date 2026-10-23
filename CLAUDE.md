# polos — 작업 안내 (개인 허브 앱 + wizard-yt 유튜브 콘티 화면)

Cloudflare Pages 정적 앱 + Functions(`functions/api/*` → `/api/*`). 빌드 단계 없음(루트에 package.json·wrangler 설정 없음).
`git push` (main) = 자동 배포 → https://polos-cxn.pages.dev . `_headers`가 모든 파일을 `Cache-Control: no-cache`로 준다.
짝 레포: `C:\Users\PC\youtube-automation` (GitHub Actions 영상 생성 파이프라인). Supabase 프로젝트: `pyrhic-shared-db`.

## 구조

허브: `index.html`(로고 캐러셀) → `skimmmiks/`, `trading/`, `todo/`, `youtube/` 등. 공통: `config.js`(Supabase 주소·공개 anon 키), `app-menu.js`, `sw.js`(네트워크 우선 캐시), `update.js`.

wizard-yt (`youtube/`) 흐름: **Search → Scenes(콘티) → Studio(영상·업로드) → Channels**

| 화면 | 파일 |
|---|---|
| Search: Trend / Wikipedia / Pexels | `search.html` → `trend.html`, `wiki.html`, `pexels.html`(슬라이드쇼 편집은 `pexels-edit.html`) |
| Scenes (콘티 편집) | `storyboard.html` + `storyboard/*.js` (아래 지도) |
| Studio (완성 영상·유튜브 업로드) | `review.html`, `upload.js` |
| Channels (채널·구독 카드) | `channels.html`, `channels.js` |
| 공통 | `generate.js`(자막 줄 계산 genCaption*, 성우 목록, 생성/콘티 작업 감시·알림), `conti-core.js`·`conti-job.js`(콘티 자동 생성), `conti-create-modal.js`(새 콘티 팝업), `hook-kit.js`(후킹 공식) |

서버: `functions/api/*.js`(Gemini 초안, Pexels 검색, TTS, 생성/업로드 트리거 등), 공용 `functions/_lib/*.js`.
Supabase Edge Functions 소스: `supabase/functions/create-conti/`, `supabase/functions/news-search/`.
DB 변경: 루트 `youtube_tables_*.sql` (번호 순, 사용자가 Supabase SQL Editor에서 직접 실행). 루틴 도구: `tools/auto_conti.py`, 지시문 `tools/ROUTINE.md`.

### 콘티 화면 스크립트 지도 (`youtube/storyboard/`)

원래 `storyboard.html` 안의 인라인 스크립트 한 덩어리를 **내용·순서 그대로** 잘라 나눈 것(2026-10-23). 같은 지도가 `storyboard.html` 맨 위 주석에도 있다.
일반 `<script src>`로 01→16 순서대로 불러온다. 파일끼리 전역(`let`/`const`/`function`)을 같이 쓰므로 **순서를 바꾸지 말고, `defer`/`async`/모듈로 바꾸지 말 것.**

| 파일 | 내용 |
|---|---|
| `01-core.js` | Supabase 설정·공통 상태(scripts/segments)·이스케이프·소재 종류 판별(사진/영상/빈 화면/Pexels) |
| `02-media.js` | 클립 비중·원본 길이(`asset_trims.__weights/__pexels`), Pexels 겹침 확인, 장면 카드 소재 영역·썸네일 |
| `03-timeline.js` | 타임라인 한 줄, 손가락 동작(고르기/길게 눌러 순서 바꾸기), 소재 추가 메뉴 |
| `04-captions.js` | 장면 길이 계산, SCRIPT/SUBTITLE 분리(계약 16절), 자막 줄(6절), 긴 자막 줄 자동 끊기 |
| `05-settings.js` | 개요 박스, 설정 카드, 부분별 저장, 요약 줄 휠, 채널 카드 목소리, 기본값 |
| `06-conti-list.js` | 콘티 이름 편집, 목록(`loadScripts`)·만드는 중 콘티, 새 콘티, 기사 사진·영상 가져오기 |
| `07-scenes.js` | `loadSegments`·장면 구분 묶음·`render()`, Pexels 검색 팝업, 장면 저장/삭제/업로드 |
| `08-trim-pos.js` | 구간 지정 팝업, 사진 위치 팝업 |
| `09-preview.js` | 장면 미리보기(화면 전환), 카드 안 미리보기 엔진 |
| `10-voice.js` | 미리보기 음성(실제 성우 `/api/tts` + 싱크, 대체 휴대폰 목소리), 안내 팝업 |
| `11-caption-adjust.js` | 미리보기에서 자막 직접 조정(위치·크기·굵기) |
| `12-full-preview.js` | 미리보기 전부 멈추기, 전체 미리보기 |
| `13-autofill.js` | Pexels 자동 배치(빈/모자란 장면, `asset_trims.__autofill` 기록) |
| `14-open-generate.js` | 생성 전 검사(소재 없는 장면), 콘티 열기/삭제, 자동 업로드 체크, 영상 생성·상태 감시, 장면 추가 |
| `15-channel-card.js` | 채널 카드(구독/좋아요) 고르기·등록·적용 |
| `16-boot.js` | 끌어다 놓기·붙여넣기 업로드, 시작(`loadScripts` → `?open=`, Trend에서 온 경우, 서비스 워커) |

새 코드를 넣을 때: 그 기능 파일에 넣는다. 파일을 불러올 때 **바로 실행되는 문장**(리스너 등록에 함수 이름을 그대로 넘기기, 즉시 실행 함수 등)이 **뒤 파일**의 이름을 쓰면 안 된다(아직 없음 → ReferenceError). 아래 `forward-refs.js`로 확인.

## 계약 문서 = 진실의 원천

`C:\Users\PC\youtube-automation\docs\storyboard-contract.md` (1~16절)가 콘티 규칙의 기준이다(DB 저장 위치, 화면 규칙, 생성 전 검사, `segments_json`, 자막 줄, Pexels 표시, 채널 카드, 슬라이드쇼, 자동 업로드, SCRIPT/SUBTITLE 등).
**규칙을 바꿀 땐 계약 문서부터 고치고**, 그다음 youtube-automation과 polos를 고친다. 코드 주석에 "계약 N절"로 근거를 단다.

## 배포 순서

1. **youtube-automation** 먼저 `git push` (새 값을 받는 쪽이 먼저 깔려야 옛 요청이 안 깨진다)
2. **polos** `git push` (main) → Cloudflare Pages 자동 배포
3. **Supabase Edge Functions** (고쳤을 때만) — 이 PC의 polos 폴더에서:
   ```
   npx supabase functions deploy <name> --no-verify-jwt --use-api
   ```
   `<name>` = `create-conti` 또는 `news-search`. DB 칸 추가는 `youtube_tables_*.sql`을 사용자가 SQL Editor에서 실행.

## 테스트 방법

단위 테스트는 없다. 콘티 화면은 로드 하네스(`tools/storyboard-check`, jsdom, 가짜 fetch — 실제 Supabase·API를 부르지 않음)로 고치기 전·후를 비교한다.
```
cd tools/storyboard-check
npm install                                   # 처음 한 번 (node_modules는 git 제외)
node run.js ../.. youtube/storyboard.html "$TEMP/before.json"   # 고치기 전에 (이미 고쳤으면 git stash → 실행 → git stash pop)
node run.js ../.. youtube/storyboard.html "$TEMP/after.json"    # 고친 뒤
node compare.js "$TEMP/before.json" "$TEMP/after.json"          # "SAME"이면 에러·요청 순서·전역 함수·최종 DOM이 같음
node forward-refs.js                                            # "forward-ref statements: 0" 이어야 함
```
분리 때 기준값: 목록 시나리오 에러 0·요청 2, 장면 시나리오 에러 2(jsdom 미구현 `scrollTo`·canvas `getContext`, 원래부터)·요청 8, 전역 함수 346. 동작을 일부러 바꾸면 DOM/요청 차이는 당연히 생기니 차이 내용을 읽고 판단한다. 결과 json은 임시 폴더에 둔다(레포에 커밋하지 않음).

문법 검사:
```
for f in youtube/*.js youtube/storyboard/*.js functions/_lib/*.js functions/api/*.js; do node --check "$f" || echo "FAIL $f"; done
```
화면 확인: `.claude/launch.json`의 `polos-static` (`npx -y serve -l 8532 .`, 확인 후 끄기). 실제 DB를 쓰므로 콘티를 열면 저장 요청(PATCH 등)이 나간다 — 목록 화면까지만 보거나 사용자에게 확인. wrangler 빌드 단계는 없다(이 PC에 wrangler 미설치).
Pexels·Gemini·YouTube 같은 한도 있는 API는 시험 삼아 반복 호출하지 않는다.

## 지켜야 할 규칙

- **PGRST102**: 여러 행을 한 번에 insert(배열 POST)할 땐 **모든 행의 키(칸 이름)가 똑같아야 한다.** 다르면 PostgREST가 PGRST102로 거부한다. JSON에서 `undefined`는 키째 빠지므로 없는 값도 `""`/`[]`/`null`로 채운다. (근거: `conti-core.js`, `conti-create-modal.js`, `supabase/functions/create-conti/index.ts`의 주석, 커밋 3d2abd2·8ef581b — 채널 카드 장면에만 `asset_paths`가 있거나 keyword·direction이 undefined여서 콘티 생성이 실패했던 일)
- **콘티 = 생성 결과**: 콘티에서 보이는 것이 그대로 영상이 된다. 생성 단계는 검색·대체 없이 콘티에 담긴 소재만 쓴다 — 몰래 채우기 금지. Pexels 자동 배치는 콘티 화면에서(보이게) 하고 결과를 `__autofill`에 남긴다(계약 2절). 소재 없는 장면은 생성 전 검사에서 막는다(계약 3절, 구독/좋아요 장면 제외). 비워 두는 건 사람이 일부러 고른 경우만: X로 지운 장면은 `__cleared = true`(다시 자동 배치 안 함), 클립을 전부 지우면 빈 화면 토큰(`blank:black`/`blank:white`/`blank:bars`)을 고르게 한다(계약 1·2절).
- **비밀값 금지**: API 키·토큰·비밀번호·허가증 값을 레포·커밋·이 문서·로그에 넣지 않는다. 위치만: 로컬 환경(git 제외 파일), GitHub Secrets(youtube-automation), Cloudflare Pages 환경 변수(Functions의 `env.*`). `config.js`에는 공개용 anon 키만(service_role 키 절대 금지).
- **점수·평가 표시 안 함**: 후킹 점수·제목 점검 화면은 2026-10-23에 뺐다. 판단은 사람이 한다 — 점수/등급 UI를 새로 만들지 않는다(후킹 공식은 Gemini 프롬프트에만).
- 유튜브 업로드는 항상 비공개(private), 자동 공개 전환 없음.
- UI는 미니멀(박스 없는 기호 버튼, 그 자리 편집). 사용자에게 SQL은 코드블록으로 보여주고 클립보드를 덮어쓰지 않는다.
