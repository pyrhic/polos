-- 콘티 맨 앞 "전체 설정" 카드(자막 크기, 배경음악, 분위기, 화면 전환) 저장용
-- youtube_tables_8_target_seconds.sql 실행 후 추가로 실행

alter table youtube_scripts add column if not exists video_settings jsonb not null default '{}'::jsonb;
