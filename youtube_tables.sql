-- 유튜브(Wicked Wiki) 자동화 전용 테이블 (Supabase, sakyowon-wiki-db 프로젝트 재사용)
-- 다른 identity 테이블과는 완전히 분리된 신규 테이블

create table youtube_scripts (
  id bigint generated always as identity primary key,
  channel text not null default 'wicked-wiki',
  category text,
  hook text,
  story text,
  closing text,
  fact_sources text,
  emphasize_terms text,
  keep_together_terms text,
  is_conspiracy_or_unverified boolean not null default false,
  status text not null default 'draft',
  slug text,
  created_at timestamp with time zone default now()
);

alter table youtube_scripts enable row level security;
create policy "anon_all_youtube_scripts" on youtube_scripts for all using (true) with check (true);
grant select, insert, update, delete on public.youtube_scripts to anon;
