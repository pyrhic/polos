-- 프로젝트별로 연결된 구글시트(간트) ID를 저장 (Supabase SQL Editor에서 직접 실행)
alter table projects add column if not exists gantt_sheet_id text;
