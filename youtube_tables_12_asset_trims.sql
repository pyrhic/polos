-- 영상/GIF 소재에서 사용할 구간(시작~끝 초)을 소재별로 저장하기 위함
-- youtube_tables_11_asset_notes.sql 실행 후 추가로 실행 (Supabase > SQL Editor)
-- asset_trims 형식: { "<asset_paths의 경로>": { "start": 3.2, "end": 9.5 } }  (end가 null이면 끝까지)

alter table youtube_segments add column if not exists asset_trims jsonb not null default '{}'::jsonb;
