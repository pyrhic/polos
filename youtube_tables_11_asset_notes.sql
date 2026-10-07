-- 기사에서 가져온 사진의 출처(언론사/기사 링크/사진 설명)를 장면별로 저장해 저작권 확인에 쓰기 위함
-- youtube_tables_8_target_seconds.sql 실행 후 추가로 실행
-- asset_notes 형식: { "<asset_paths의 경로>": { "source": "언론사", "articleUrl": "...", "articleTitle": "...", "caption": "..." } }

alter table youtube_segments add column if not exists asset_notes jsonb not null default '{}'::jsonb;
