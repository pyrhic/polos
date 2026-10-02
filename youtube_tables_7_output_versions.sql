-- 같은 대본으로 여러 번 생성해도 기존 영상을 덮어쓰지 않고 v1, v2, v3...로 쌓이게
-- youtube_tables_3_output.sql 실행 후 추가로 실행 (버킷은 그대로 재사용)

create table youtube_outputs (
  id bigint generated always as identity primary key,
  script_id bigint references youtube_scripts(id) on delete cascade,
  version integer not null,
  storage_path text not null,
  video_url text not null,
  created_at timestamp with time zone default now()
);

alter table youtube_outputs enable row level security;
create policy "anon_all_youtube_outputs_rows" on youtube_outputs for all using (true) with check (true);
grant select, insert, update, delete on public.youtube_outputs to anon;
