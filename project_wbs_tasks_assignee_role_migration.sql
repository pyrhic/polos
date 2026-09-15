-- 업무의 "역할(직책)"과 "실제 담당자 이름"을 분리 - WBS 마스터 템플릿의 default_assignee는
-- "PM"/"홍보담당" 같은 역할 라벨이지 사람 이름이 아닌데, 지금까지는 그대로 assignee(담당자)에
-- 복사돼서 마치 역할이 사람 이름인 것처럼 보였음. 이제부터는 role은 assignee_role에 남기고,
-- 조직도(팀 구성)에 그 역할의 사람이 등록되면 그 사람 이름으로 assignee를 자동으로 채움.
alter table project_wbs_tasks add column if not exists assignee_role text;

-- 이미 생성된 프로젝트들의 기존 데이터 정리: assignee 값이 실제로는 역할 라벨이었던 경우
-- (마스터 템플릿에 등장하는 라벨 목록과 일치하는 경우) assignee_role로 옮기고,
-- 그 프로젝트에 이미 그 역할의 팀원이 등록돼 있으면 그 사람 이름으로, 없으면 미지정으로 정리
update project_wbs_tasks t
set assignee_role = t.assignee,
    assignee = null
where t.assignee in (select distinct default_assignee from wbs_master_tasks where default_assignee is not null)
  and not exists (
    select 1 from project_team_members tm
    where tm.project_id = t.project_id and tm.role = t.assignee
  );

update project_wbs_tasks t
set assignee_role = t.assignee,
    assignee = tm.name
from project_team_members tm
where t.assignee in (select distinct default_assignee from wbs_master_tasks where default_assignee is not null)
  and tm.project_id = t.project_id and tm.role = t.assignee;
