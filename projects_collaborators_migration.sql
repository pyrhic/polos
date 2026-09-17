-- 프로젝트별 접근 권한 - "로그인한 이 사람이 이 프로젝트를 볼 자격이 있는가"를 기록하는 테이블.
-- 지금까지 projects/project_todos/project_notes/project_milestones/project_wbs_tasks/
-- project_team_members는 RLS는 켜져 있었지만 정책이 전부 using(true)라 사실상 잠금이 없었음.
-- 이 마이그레이션은 그 정책들을 "이 테이블에 멤버로 등록된 사람만" 기준으로 교체한다.
--
-- 실행 전 필수: Supabase Dashboard > Authentication > Sign In / Providers 에서
-- Email 로그인(매직 링크)이 켜져 있는지 확인. 그리고 Authentication > URL Configuration >
-- Redirect URLs에 https://<배포도메인>/projects/list.html , /projects/detail.html 을
-- (혹은 와일드카드로 https://<배포도메인>/*) 추가해야 로그인 링크 클릭 후 정상적으로 돌아온다.

create table if not exists project_collaborators (
  id bigint generated always as identity primary key,
  project_id bigint references projects(id) on delete cascade,
  email text not null,
  role text default 'collaborator', -- owner / collaborator
  created_at timestamptz default now(),
  unique(project_id, email)
);
alter table project_collaborators enable row level security;
grant select, insert, update, delete on public.project_collaborators to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- 프로젝트 생성자를 추적하기 위한 컬럼 (기본값 = 요청 보낸 로그인 사용자의 이메일)
alter table projects add column if not exists created_by text;
alter table projects alter column created_by set default (auth.jwt() ->> 'email');

-- 헬퍼 함수: 로그인한 사람이 해당 프로젝트의 멤버/오너인지
create or replace function public.is_project_member(pid bigint)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from project_collaborators
    where project_id = pid and email = (auth.jwt() ->> 'email')
  );
$$;

create or replace function public.is_project_owner(pid bigint)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from project_collaborators
    where project_id = pid and email = (auth.jwt() ->> 'email') and role = 'owner'
  );
$$;

-- 프로젝트가 생성되면 생성자를 자동으로 owner로 등록 (security definer라 RLS 우회)
create or replace function public.handle_new_project()
returns trigger language plpgsql security definer as $$
begin
  insert into project_collaborators(project_id, email, role)
  values (new.id, coalesce(new.created_by, auth.jwt() ->> 'email'), 'owner')
  on conflict (project_id, email) do nothing;
  return new;
end;
$$;

drop trigger if exists on_project_created on projects;
create trigger on_project_created
  after insert on projects
  for each row execute function public.handle_new_project();

-- 기존 프로젝트 전부에 나(소유자)를 owner로 소급 등록 - 아래 이메일을 본인 것으로 바꿔서 실행
insert into project_collaborators (project_id, email, role)
select id, 'pyrhic@sakyowon.co.kr', 'owner' from projects
on conflict (project_id, email) do nothing;

-- project_collaborators 자체 정책: 멤버는 명단을 볼 수 있고, owner만 초대/변경/삭제 가능
drop policy if exists "project_collaborators_all" on project_collaborators;
create policy "project_collaborators_select" on project_collaborators for select
  using (is_project_member(project_id));
create policy "project_collaborators_insert" on project_collaborators for insert
  with check (is_project_owner(project_id));
create policy "project_collaborators_update" on project_collaborators for update
  using (is_project_owner(project_id));
create policy "project_collaborators_delete" on project_collaborators for delete
  using (is_project_owner(project_id));

-- projects: 기존 "누구나 가능" 정책 제거 후 멤버십 기반으로 교체
drop policy if exists "projects_all" on projects;
create policy "projects_select" on projects for select using (is_project_member(id));
create policy "projects_insert" on projects for insert with check (auth.role() = 'authenticated');
create policy "projects_update" on projects for update using (is_project_member(id));
create policy "projects_delete" on projects for delete using (is_project_owner(id));

-- 프로젝트에 딸린 하위 테이블들도 전부 멤버십 기준으로 교체
drop policy if exists "project_todos_all" on project_todos;
create policy "project_todos_all" on project_todos for all
  using (is_project_member(project_id)) with check (is_project_member(project_id));

drop policy if exists "project_notes_all" on project_notes;
create policy "project_notes_all" on project_notes for all
  using (is_project_member(project_id)) with check (is_project_member(project_id));

drop policy if exists "project_milestones_all" on project_milestones;
create policy "project_milestones_all" on project_milestones for all
  using (is_project_member(project_id)) with check (is_project_member(project_id));

drop policy if exists "project_wbs_tasks_all" on project_wbs_tasks;
create policy "project_wbs_tasks_all" on project_wbs_tasks for all
  using (is_project_member(project_id)) with check (is_project_member(project_id));

drop policy if exists "project_team_members_all" on project_team_members;
create policy "project_team_members_all" on project_team_members for all
  using (is_project_member(project_id)) with check (is_project_member(project_id));
