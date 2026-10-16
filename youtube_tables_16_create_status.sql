-- 콘티 자동 생성 상태 (Supabase > SQL Editor > New query 에 붙여넣고 Run). 여러 번 실행해도 안전합니다.
-- 새 콘티(뉴스·위키)는 빈 행을 먼저 만들고 서버(Edge Function create-conti)가 채운다. 그 진행 상태를 적는 칸.
--   create_status     비어 있음 = 예전 콘티·직접 만든 콘티(완성) / queued 대기 중 / running 만드는 중 / done 완성 / error 실패
--   create_error      실패 이유 (화면에 그대로 보여 줌)
--   create_request    만들 때 쓴 입력값(주제·기사·위키 문서·분위기·채널 카드 등) — 다시 만들기에 씀
--   create_started_at 만들기 시작한 때 — 15분 넘게 끝나지 않으면 화면에서 "시간 초과"로 보여 줌
alter table youtube_scripts add column if not exists create_status text
  check (create_status is null or create_status in ('queued','running','done','error'));
alter table youtube_scripts add column if not exists create_error text;
alter table youtube_scripts add column if not exists create_request jsonb;
alter table youtube_scripts add column if not exists create_started_at timestamp with time zone;
