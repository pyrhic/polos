-- 유튜브 대본에 첨부하는 영상/사진 소재 저장용 (Supabase Storage + 메타데이터 테이블)
-- youtube_tables.sql 실행 후 추가로 실행

insert into storage.buckets (id, name, public)
values ('youtube-assets', 'youtube-assets', true)
on conflict (id) do nothing;

create policy "anon_all_youtube_assets_storage" on storage.objects for all
using (bucket_id = 'youtube-assets') with check (bucket_id = 'youtube-assets');

create table youtube_assets (
  id bigint generated always as identity primary key,
  script_id bigint references youtube_scripts(id) on delete cascade,
  storage_path text not null,
  file_name text,
  created_at timestamp with time zone default now()
);

alter table youtube_assets enable row level security;
create policy "anon_all_youtube_assets" on youtube_assets for all using (true) with check (true);
grant select, insert, update, delete on public.youtube_assets to anon;
