-- 유튜브에 올릴 수 있는 채널 목록 (Supabase > SQL Editor > New query 에 붙여넣고 Run)
-- 여러 번 실행해도 안전합니다. 채널 번호(slot)는 GitHub 비밀값 이름과 짝입니다:
--   1번 -> YOUTUBE_OAUTH_TOKEN, 그 밖의 번호 N -> YOUTUBE_OAUTH_TOKEN_N
-- 이 표가 비어 있으면 앱은 config.js의 YT_CHANNELS 목록을 대신 씁니다.

create table if not exists youtube_channels (
  slot integer primary key check (slot >= 1 and slot <= 99),
  label text not null,
  ready boolean not null default true,        -- false면 로그인 승인 전이라 업로드 목록에 안 보임
  sort_order integer not null default 0,
  check_status text,                          -- 마지막 "연결 확인" 결과: ok / error
  check_message text,
  checked_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

alter table youtube_channels enable row level security;
drop policy if exists "anon_all_youtube_channels" on youtube_channels;
create policy "anon_all_youtube_channels" on youtube_channels for all using (true) with check (true);
grant select, insert, update, delete on public.youtube_channels to anon;
