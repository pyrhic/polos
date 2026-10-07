-- 완성 영상(버전)을 앱에서 바로 유튜브에 올리고, 올린 상태/영상 ID를 저장
-- youtube_tables_7_output_versions.sql 실행 후 추가로 실행
-- youtube_status: null(안 올림) | uploading | done | error

alter table youtube_outputs add column if not exists youtube_status text;
alter table youtube_outputs add column if not exists youtube_video_id text;
alter table youtube_outputs add column if not exists youtube_error text;
