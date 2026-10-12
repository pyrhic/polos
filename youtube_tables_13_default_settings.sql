-- 콘티 페이지 "전체 설정"을 기본값으로 저장해두고, 새 콘티를 만들 때 그 값으로 시작하게 하기 위함
-- youtube_tables_12_asset_trims.sql 실행 후 추가로 실행 (Supabase > SQL Editor)
-- 한 줄(id=1)만 쓰는 표. settings 형식은 youtube_scripts.video_settings와 같되, 콘티마다 다른 값
-- (콘티 이름, 제목 1·2줄, 출처 문구, 직접 올린 배경음악)은 빠져 있음

create table if not exists youtube_default_settings (
  id integer primary key default 1 check (id = 1),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone default now()
);

alter table youtube_default_settings enable row level security;
create policy "anon_all_youtube_default_settings" on youtube_default_settings for all using (true) with check (true);
grant select, insert, update, delete on public.youtube_default_settings to anon;
