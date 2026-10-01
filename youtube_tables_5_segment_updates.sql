-- 콘티 보완: (1) 장면별 실제 대본 문장(대사) 표시, (2) 장면 하나에 소재 여러 개 허용
-- youtube_tables_4_segments.sql 실행 후 추가로 실행

alter table youtube_segments add column if not exists script_text text;
alter table youtube_segments add column if not exists asset_paths jsonb not null default '[]'::jsonb;
alter table youtube_segments drop column if exists asset_path;
