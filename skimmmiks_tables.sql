-- 스킴밐스(polos/skimmmiks) 전용 테이블 (Supabase, sakyowon-wiki-db 프로젝트 재사용)
-- 사교원/트레이딩 테이블과는 완전히 분리된 신규 테이블

-- Q&A 게시판: 이름+비밀번호로 질문 등록, 관리자가 답변 + FAQ 그룹 지정
create table skimmmiks_questions (
  id bigint generated always as identity primary key,
  name text not null,
  password text not null,
  question text not null,
  answer text,
  faq_group text,
  created_at timestamp with time zone default now()
);

alter table skimmmiks_questions enable row level security;
create policy "anon_all_skimmmiks_questions" on skimmmiks_questions for all using (true) with check (true);
grant select, insert, update, delete on public.skimmmiks_questions to anon;

-- Skim Jam 잼데이 (관리자만 등록/수정)
create table skimmmiks_jam_events (
  id bigint generated always as identity primary key,
  event_date date not null,
  wave_condition text,
  location text,
  description text,
  created_at timestamp with time zone default now()
);

alter table skimmmiks_jam_events enable row level security;
create policy "anon_all_skimmmiks_jam_events" on skimmmiks_jam_events for all using (true) with check (true);
grant select, insert, update, delete on public.skimmmiks_jam_events to anon;

-- Skim Jam 참석자 (누구나 참석 등록)
create table skimmmiks_jam_attendees (
  id bigint generated always as identity primary key,
  event_id bigint references skimmmiks_jam_events(id) on delete cascade,
  name text not null,
  created_at timestamp with time zone default now()
);

alter table skimmmiks_jam_attendees enable row level security;
create policy "anon_all_skimmmiks_jam_attendees" on skimmmiks_jam_attendees for all using (true) with check (true);
grant select, insert, update, delete on public.skimmmiks_jam_attendees to anon;
