-- 프로젝트별로 연결된 만족도 조사 구글폼 ID를 저장 (Supabase SQL Editor에서 직접 실행)
alter table projects add column if not exists survey_form_id text;
