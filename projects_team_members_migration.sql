-- 프로젝트 팀 구성(담당자 명단) 테이블 (Supabase SQL Editor에서 직접 실행)
-- 여기 등록한 이름이 업무 편집 화면의 "담당자" 자동완성 목록으로 쓰임

create table if not exists project_team_members (
  id bigint generated always as identity primary key,
  project_id bigint references projects(id) on delete cascade,
  name text not null,
  role text,
  sort_order int,
  created_at timestamptz default now()
);
alter table project_team_members enable row level security;
create policy "project_team_members_all" on project_team_members for all using (true) with check (true);
grant select, insert, update, delete on public.project_team_members to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
