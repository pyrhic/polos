-- 프로젝트별 사진 업로드용 구글드라이브 폴더 ID 저장 (Supabase SQL Editor에서 직접 실행)
alter table projects add column if not exists photo_folder_id text;
