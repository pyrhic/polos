-- 영상 생성 결과(완성 mp4) 저장 + 진행상태 추적
-- youtube_tables.sql, youtube_tables_2_assets.sql 실행 후 추가로 실행

insert into storage.buckets (id, name, public)
values ('youtube-outputs', 'youtube-outputs', true)
on conflict (id) do nothing;

create policy "anon_all_youtube_outputs_storage" on storage.objects for all
using (bucket_id = 'youtube-outputs') with check (bucket_id = 'youtube-outputs');

alter table youtube_scripts add column if not exists video_url text;
alter table youtube_scripts add column if not exists generation_status text not null default 'idle';
-- generation_status: idle | running | done | error
