-- 프로젝트 관리 페이지용 테이블 (Supabase SQL Editor에서 직접 실행)

create table if not exists projects (
  id bigint generated always as identity primary key,
  name text not null,
  description text default '',
  status text default '진행중', -- 진행중 / 완료 / 보류
  start_date date,
  due_date date,
  created_at timestamptz default now()
);
alter table projects enable row level security;
create policy "projects_all" on projects for all using (true) with check (true);

create table if not exists project_todos (
  id bigint generated always as identity primary key,
  project_id bigint references projects(id) on delete cascade,
  text text not null,
  completed boolean default false,
  due_date date,
  created_at timestamptz default now()
);
alter table project_todos enable row level security;
create policy "project_todos_all" on project_todos for all using (true) with check (true);

create table if not exists project_notes (
  id bigint generated always as identity primary key,
  project_id bigint references projects(id) on delete cascade,
  content text not null, -- 메모 텍스트 또는 링크(구글드라이브 등 외부 문서 URL)
  created_at timestamptz default now()
);
alter table project_notes enable row level security;
create policy "project_notes_all" on project_notes for all using (true) with check (true);
