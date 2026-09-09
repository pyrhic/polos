-- 프로젝트 기간 유형(하루/여러날/한달) 저장용 컬럼 (Supabase SQL Editor에서 직접 실행)
-- start_date/due_date는 이제 "기획 시작일"이 아니라 "행사(실행) 시작일/종료일"로 씀
alter table projects add column if not exists duration_type text default '1일';
