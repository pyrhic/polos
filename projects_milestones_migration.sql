-- 프로젝트 타임라인(마일스톤) 추가 마이그레이션 (Supabase SQL Editor에서 직접 실행)

create table if not exists project_milestones (
  id bigint generated always as identity primary key,
  project_id bigint references projects(id) on delete cascade,
  title text not null,
  milestone_date date not null,
  created_at timestamptz default now()
);
alter table project_milestones enable row level security;
create policy "project_milestones_all" on project_milestones for all using (true) with check (true);
grant select, insert, update, delete on public.project_milestones to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- 할일이 특정 마일스톤(WBS)에 속할 수 있도록 컬럼 추가 (null이면 일반 할일)
alter table project_todos add column if not exists milestone_id bigint references project_milestones(id) on delete cascade;
