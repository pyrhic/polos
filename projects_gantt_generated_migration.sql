-- 간트차트를 실제로 한 번이라도 생성했는지 기록 (Supabase SQL Editor에서 실행)
-- 이 값이 있으면 "간트차트 생성하기" 버튼 대신 "시트에서 가져오기" 버튼만 보여줌
alter table projects add column if not exists gantt_generated_at timestamptz;
