-- 콘티 보완: 장면별 연출 지시(ACTION) — 줌인/줌아웃/패닝/틸트 등 카메라 디렉션
-- youtube_tables_5_segment_updates.sql 실행 후 추가로 실행

alter table youtube_segments add column if not exists direction text;
