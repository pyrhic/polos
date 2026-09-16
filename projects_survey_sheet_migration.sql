-- 만족도 조사 응답/차트를 담을 별도 구글시트 ID 저장 (간트차트 시트와는 별개, Supabase SQL Editor에서 실행)
alter table projects add column if not exists survey_sheet_id text;
