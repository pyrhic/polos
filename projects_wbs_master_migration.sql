-- WBS 엔진 도입 1단계: 마스터 템플릿 + 프로젝트별 실데이터 테이블 (Supabase SQL Editor에서 직접 실행)
-- project_todos/project_milestones는 이번 마이그레이션에서 건드리지 않음(당분간 병행 운영, 나중에 전환)

-- ---- 1. projects 테이블에 유형/조건 플래그 추가 ----
alter table projects add column if not exists project_types text[];
alter table projects add column if not exists requires_recruitment boolean;
alter table projects add column if not exists requires_onsite boolean;
alter table projects add column if not exists is_public_fund boolean;
alter table projects add column if not exists requires_accommodation boolean;
alter table projects add column if not exists budget_estimate numeric;

-- ---- 2. 마스터 WBS 템플릿 (전역, 프로젝트 무관 - 이 테이블에서 조건에 맞는 걸 골라 복제해서 씀) ----
create table if not exists wbs_master_tasks (
  id bigint generated always as identity primary key,
  parent_id bigint references wbs_master_tasks(id) on delete cascade,
  code text,                     -- '01' 같은 표시/참조용 코드 (단계 노드만 사용)
  name text not null,
  description text,
  module text not null,          -- 'base' | 'event' | 'education' | 'public_fund' | 'promotion' | 'research' | 'accommodation'
  level int not null default 0,  -- 0 = 단계(마일스톤), 1 = 세부 업무
  required boolean default false,
  is_milestone boolean default false,
  anchor text,                   -- 'start' | 'end' (행사 시작일/종료일 기준)
  offset_days int,
  deliverables_template text,
  completion_criteria_template text,
  default_assignee text,
  evidence_required boolean default false,
  sort_order int,
  created_at timestamptz default now()
);
alter table wbs_master_tasks enable row level security;
create policy "wbs_master_tasks_all" on wbs_master_tasks for all using (true) with check (true);
grant select, insert, update, delete on public.wbs_master_tasks to anon, authenticated;

-- ---- 3. 프로젝트별 실제 WBS 데이터 (project_todos + project_milestones를 나중에 흡수할 목적지) ----
create table if not exists project_wbs_tasks (
  id bigint generated always as identity primary key,
  project_id bigint references projects(id) on delete cascade,
  master_task_id bigint references wbs_master_tasks(id),
  parent_id bigint references project_wbs_tasks(id) on delete cascade,
  level int not null default 0,
  name text not null,
  description text,
  status text default '예정',   -- 예정 / 진행 / 검토 / 완료
  progress int default 0,
  priority text,
  assignee text,
  start_date date,
  due_date date,
  is_milestone boolean default false,
  dependencies bigint[],
  deliverables text,
  completion_criteria text,
  budget_planned numeric,
  budget_actual numeric,
  approval_required boolean default false,
  evidence_required boolean default false,
  risk_note text,
  tags text[],
  sort_order int,
  created_at timestamptz default now()
);
alter table project_wbs_tasks enable row level security;
create policy "project_wbs_tasks_all" on project_wbs_tasks for all using (true) with check (true);
grant select, insert, update, delete on public.project_wbs_tasks to anon, authenticated;

grant usage, select on all sequences in schema public to anon, authenticated;

-- ---- 4. 시드 데이터: 지금 만든 12단계 템플릿을 'base' 모듈로 이관 ----
-- 재실행해도 중복되지 않도록 기존 base 모듈 데이터를 먼저 지움
delete from wbs_master_tasks where module = 'base';

do $$
declare
  v_stage_id bigint;
begin
  -- ① 프로젝트 기획
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('01', '① 프로젝트 기획', 'base', 0, true, true, 'start', -56, 1)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '프로젝트 목표 설정', 'base', 1, true, '프로젝트 기획안', 'PM', 1),
    (v_stage_id, '프로젝트 범위 설정', 'base', 1, true, '업무범위', 'PM', 2),
    (v_stage_id, '핵심 이해관계자 파악', 'base', 1, true, '이해관계자 목록', 'PM', 3);

  -- ② 프로젝트 설계
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('02', '② 프로젝트 설계', 'base', 0, true, true, 'start', -49, 2)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '세부 프로그램 설계', 'base', 1, true, '프로그램 구성안', 'PM', 1),
    (v_stage_id, '일정 설계', 'base', 1, true, '일정표', 'PM', 2),
    (v_stage_id, '예산 설계', 'base', 1, true, '예산안', 'PM', 3),
    (v_stage_id, '역할 분담', 'base', 1, true, 'R&R', 'PM', 4);

  -- ③ 실행 준비
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('03', '③ 실행 준비', 'base', 0, true, true, 'start', -42, 3)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '외부 인력 섭외', 'base', 1, true, '섭외 리스트', '담당자', 1),
    (v_stage_id, '장소·자원 확보', 'base', 1, true, '확보 목록', '담당자', 2),
    (v_stage_id, '계약·행정', 'base', 1, true, '계약·행정서류', '행정', 3);

  -- ④ 실행계획 확정
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('04', '④ 실행계획 확정', 'base', 0, true, true, 'start', -35, 4)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '세부 실행계획 작성', 'base', 1, true, '실행계획서', 'PM', 1),
    (v_stage_id, '위험요소 점검', 'base', 1, true, '리스크 리스트', 'PM', 2),
    (v_stage_id, '커뮤니케이션 체계 구축', 'base', 1, true, '커뮤니케이션 계획', 'PM', 3);

  -- ⑤ 실행 착수
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('05', '⑤ 실행 착수', 'base', 0, true, true, 'start', -28, 5)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '실제 업무 시작', 'base', 1, true, '중간 결과물', '각 담당', 1),
    (v_stage_id, '진행상황 점검', 'base', 1, true, '진행상황표', 'PM', 2),
    (v_stage_id, '문제사항 해결', 'base', 1, true, '이슈 리스트', 'PM', 3);

  -- ⑥ 중간 점검
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('06', '⑥ 중간 점검', 'base', 0, true, true, 'start', -21, 6)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '프로젝트 중간평가', 'base', 1, true, '중간점검표', 'PM', 1),
    (v_stage_id, '계획 수정', 'base', 1, true, '수정계획', 'PM', 2),
    (v_stage_id, '부족한 자원 보완', 'base', 1, true, '보완계획', '담당자', 3);

  -- ⑦ 최종 준비
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('07', '⑦ 최종 준비', 'base', 0, true, true, 'start', -14, 7)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '결과물 완성도 점검', 'base', 1, true, '최종본 1차', '각 담당', 1),
    (v_stage_id, '세부 일정 확정', 'base', 1, true, '최종 일정표', 'PM', 2),
    (v_stage_id, '최종 리스크 점검', 'base', 1, true, '대응 매뉴얼', 'PM', 3);

  -- ⑧ 최종 점검
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('08', '⑧ 최종 점검', 'base', 0, true, true, 'start', -7, 8)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '전체 리허설 / 검수', 'base', 1, true, '체크리스트', '전원', 1),
    (v_stage_id, '최종 확정', 'base', 1, true, '최종 실행안', 'PM', 2),
    (v_stage_id, '관계자 공유', 'base', 1, true, '공유자료', 'PM', 3);

  -- ⑨ 실행
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('09', '⑨ 실행', 'base', 0, true, true, 'start', 0, 9)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '프로젝트 실행', 'base', 1, true, '실행 결과물', '전원', 1),
    (v_stage_id, '기록', 'base', 1, true, '기록자료', '기록', 2),
    (v_stage_id, '이슈 대응', 'base', 1, true, '이슈 기록', 'PM', 3);

  -- ⑩ 사후 정리
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('10', '⑩ 사후 정리', 'base', 0, true, true, 'end', 2, 10)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '결과물 정리', 'base', 1, true, '결과자료', '담당자', 1),
    (v_stage_id, '비용 정산', 'base', 1, true, '정산서', '행정', 2),
    (v_stage_id, '참여자 피드백', 'base', 1, true, '설문 결과', '담당자', 3);

  -- ⑪ 평가
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('11', '⑪ 평가', 'base', 0, true, true, 'end', 7, 11)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '성과 분석', 'base', 1, true, '성과분석', 'PM', 1),
    (v_stage_id, '문제점 분석', 'base', 1, true, '평가표', '전원', 2),
    (v_stage_id, '개선안 도출', 'base', 1, true, '개선안', 'PM', 3);

  -- ⑫ 결과보고·확산
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('12', '⑫ 결과보고·확산', 'base', 0, true, true, 'end', 14, 12)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '결과보고서 작성', 'base', 1, true, '결과보고서', 'PM', 1),
    (v_stage_id, '결과 공유', 'base', 1, true, '발표자료', 'PM', 2),
    (v_stage_id, '기록·아카이빙', 'base', 1, true, '프로젝트 아카이브', '담당자', 3);
end $$;
