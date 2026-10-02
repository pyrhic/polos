-- 콘티에서 장면별 화면 노출 시간을 직접 조절할 수 있게 (비워두면 대사 길이로 자동 계산)
-- youtube_tables_7_output_versions.sql 실행 후 추가로 실행

alter table youtube_segments add column if not exists target_seconds numeric;
