-- 콘티(대본을 장면별로 나눈 구간 + 검색 키워드 + 선택적 직접 업로드 소재) 저장용
-- youtube_tables_2_assets.sql 실행 후 추가로 실행 (같은 youtube-assets 버킷의 storage_path를 재사용)

create table youtube_segments (
  id bigint generated always as identity primary key,
  script_id bigint references youtube_scripts(id) on delete cascade,
  order_no integer not null,
  section text,
  keyword text,
  asset_path text,
  created_at timestamp with time zone default now()
);

alter table youtube_segments enable row level security;
create policy "anon_all_youtube_segments" on youtube_segments for all using (true) with check (true);
grant select, insert, update, delete on public.youtube_segments to anon;
