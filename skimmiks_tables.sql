-- 스킴밐스(polos/skimmiks) 전용 테이블 (Supabase, sakyowon-wiki-db 프로젝트 재사용)
-- 사교원/트레이딩 테이블과는 완전히 분리된 신규 테이블

-- Q&A 게시판: 이름+비밀번호로 질문 등록, 관리자가 답변 + FAQ 그룹 지정
create table skimmiks_questions (
  id bigint generated always as identity primary key,
  name text not null,
  password text not null,
  question text not null,
  answer text,
  faq_group text,
  created_at timestamp with time zone default now()
);

alter table skimmiks_questions enable row level security;
create policy "anon_all_skimmiks_questions" on skimmiks_questions for all using (true) with check (true);
grant select, insert, update, delete on public.skimmiks_questions to anon;

-- Skim Jam 잼데이 (관리자만 등록/수정)
create table skimmiks_jam_events (
  id bigint generated always as identity primary key,
  event_date date not null,
  wave_condition text,
  location text,
  description text,
  created_at timestamp with time zone default now()
);

alter table skimmiks_jam_events enable row level security;
create policy "anon_all_skimmiks_jam_events" on skimmiks_jam_events for all using (true) with check (true);
grant select, insert, update, delete on public.skimmiks_jam_events to anon;

-- Skim Jam 참석자 (누구나 참석 등록)
create table skimmiks_jam_attendees (
  id bigint generated always as identity primary key,
  event_id bigint references skimmiks_jam_events(id) on delete cascade,
  name text not null,
  created_at timestamp with time zone default now()
);

alter table skimmiks_jam_attendees enable row level security;
create policy "anon_all_skimmiks_jam_attendees" on skimmiks_jam_attendees for all using (true) with check (true);
grant select, insert, update, delete on public.skimmiks_jam_attendees to anon;
