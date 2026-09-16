-- 마일스톤별 사진 하위 폴더 ID 저장 (Supabase SQL Editor에서 직접 실행)
alter table project_wbs_tasks add column if not exists photo_folder_id text;
