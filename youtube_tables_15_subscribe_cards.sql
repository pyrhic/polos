-- 채널별 구독 카드 + 채널의 "콘티 출처" (Supabase > SQL Editor > New query 에 붙여넣고 Run)
-- youtube_tables_14_channels.sql 실행 후에 실행. 여러 번 실행해도 안전합니다.

-- 1) 채널마다 어디서 만든 콘티인지: trend(트렌드·뉴스) / wiki(위키피디아) / pexels(Pexels 슬라이드쇼)
alter table youtube_channels add column if not exists source text
  check (source is null or source in ('trend', 'wiki', 'pexels'));

-- 2) 지금 쓰는 세 채널을 표에 넣는다 (이미 있으면 콘티 출처만 채움). slot은 GitHub 비밀값과 짝:
--    1번 -> YOUTUBE_OAUTH_TOKEN, N번 -> YOUTUBE_OAUTH_TOKEN_N
insert into youtube_channels (slot, label, ready, sort_order, source) values
  (1, 'Wicked Wiki', true, 1, 'wiki'),
  (2, '연예계중개', true, 2, 'trend'),
  (3, 'OUTSTAGRAM', false, 3, 'pexels')
on conflict (slot) do update set source = coalesce(youtube_channels.source, excluded.source);

-- 3) 구독 카드: 채널마다 여러 개, 그중 하나가 기본
create table if not exists youtube_subscribe_cards (
  id bigserial primary key,
  channel_slot integer not null references youtube_channels(slot) on delete cascade,
  name text not null default '기본 구독 카드',           -- 카드 이름 (고를 때 보이는 이름)
  script_text text not null default '',                  -- 자막·음성 문구 (줄바꿈 = 자막 한 줄)
  image_paths jsonb not null default '[]'::jsonb,        -- 사진 여러 장 (youtube-assets 스토리지 경로), 영상마다 돌아가며 사용
  direction text not null default '천천히 줌인',           -- 사진 카메라 연출
  is_default boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 채널마다 기본 카드는 하나만
create unique index if not exists youtube_subscribe_cards_one_default
  on youtube_subscribe_cards (channel_slot) where is_default;

alter table youtube_subscribe_cards enable row level security;
drop policy if exists "anon_all_youtube_subscribe_cards" on youtube_subscribe_cards;
create policy "anon_all_youtube_subscribe_cards" on youtube_subscribe_cards for all using (true) with check (true);
grant select, insert, update, delete on public.youtube_subscribe_cards to anon;
grant usage, select on sequence youtube_subscribe_cards_id_seq to anon;

-- 4) 채널마다 지금 쓰는 문구로 기본 카드를 하나씩 만들어 둔다 (이미 기본 카드가 있으면 건너뜀)
insert into youtube_subscribe_cards (channel_slot, name, script_text, is_default)
select c.slot, '기본 구독 카드', '내 알고리즘 밖의 이야기가 궁금하다면 구독 좋아요 해주시면 나도 좋아요', true
from youtube_channels c
where not exists (select 1 from youtube_subscribe_cards s where s.channel_slot = c.slot and s.is_default);
