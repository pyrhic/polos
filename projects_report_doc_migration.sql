-- 프로젝트별로 연결된 구글독스(결과보고서) ID를 저장 (Supabase SQL Editor에서 직접 실행)
alter table projects add column if not exists report_doc_id text;
