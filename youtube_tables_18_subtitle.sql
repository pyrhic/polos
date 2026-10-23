-- 장면 화면 자막 칸 (Supabase > SQL Editor > New query 에 붙여넣고 Run). 여러 번 실행해도 안전합니다.
-- SCRIPT(script_text) = 성우가 읽는 대본, SUBTITLE(subtitle_text) = 화면에 보이는 자막 (youtube-automation docs/storyboard-contract.md 16절)
--   null  = 옛 장면: SCRIPT 줄이 그대로 자막 (옛 콘티·채널 카드 장면은 예전과 똑같이 만들어진다)
--   ""    = 새 장면, 자막 없음
--   글    = 새 장면, 줄바꿈 = 화면 자막 한 줄
-- 이 SQL을 실행하기 전에도 앱은 동작한다 (자막 칸 저장만 안 되고 안내가 뜬다).
alter table youtube_segments add column if not exists subtitle_text text;

-- 새 칸을 REST(PostgREST)가 바로 알아보게
notify pgrst, 'reload schema';
