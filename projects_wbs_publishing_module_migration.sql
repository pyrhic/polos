-- WBS 엔진 7단계: 'publishing'(출판) 모듈 시드 데이터 (Supabase SQL Editor에서 직접 실행)
-- 프로젝트 유형에 '출판'을 선택한 경우에만 이 모듈이 활성화되어 base 위에 추가로 생성됨
-- (출판 프로젝트는 행사(실행) 날짜 = 출간일로 해석해서 앵커링)

delete from wbs_master_tasks where module = 'publishing';

do $$
declare
  v_stage_id bigint;
begin
  -- 원고 기획 (출간일 60일 전)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('B1', '원고 기획', 'publishing', 0, false, true, 'start', -60, 601)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '목차·구성안 작성', 'publishing', 1, false, '목차구성안', '저자', 1),
    (v_stage_id, '참고자료·자료조사', 'publishing', 1, false, '자료조사 목록', '저자', 2),
    (v_stage_id, '출간 일정·예산 계획', 'publishing', 1, false, '출간계획서', 'PM', 3);

  -- 원고 집필·편집 (35일 전)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('B2', '원고 집필·편집', 'publishing', 0, false, true, 'start', -35, 602)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '초고 작성', 'publishing', 1, false, '초고', '저자', 1),
    (v_stage_id, '편집·교정', 'publishing', 1, false, '편집본', '편집자', 2),
    (v_stage_id, '감수·피드백 반영', 'publishing', 1, false, '최종원고', '저자', 3);

  -- 디자인·조판 (14일 전)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('B3', '디자인·조판', 'publishing', 0, false, true, 'start', -14, 603)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '표지 디자인', 'publishing', 1, false, '표지시안', '디자이너', 1),
    (v_stage_id, '내지 조판·레이아웃', 'publishing', 1, false, '조판본', '디자이너', 2),
    (v_stage_id, '최종 교정·인쇄 준비', 'publishing', 1, false, '인쇄용 파일', '편집자', 3);

  -- 인쇄·유통 (출간일)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('B4', '인쇄·유통', 'publishing', 0, false, true, 'start', 0, 604)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '인쇄·제본', 'publishing', 1, false, '완성본', '인쇄소', 1),
    (v_stage_id, '유통·서점 입고', 'publishing', 1, false, '입고확인서', '담당자', 2),
    (v_stage_id, '홍보·출간 알림', 'publishing', 1, false, '보도자료', '홍보담당', 3);
end $$;
