-- WBS 엔진 6단계: 'education'(교육) 모듈 시드 데이터 (Supabase SQL Editor에서 직접 실행)
-- 프로젝트 유형에 '교육'을 선택한 경우에만 이 모듈이 활성화되어 base(+event/promotion/...) 위에 추가로 생성됨

delete from wbs_master_tasks where module = 'education';

do $$
declare
  v_stage_id bigint;
begin
  -- 교육과정 설계 (행사 시작 33일 전)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('D1', '교육과정 설계', 'education', 0, false, true, 'start', -33, 501)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '교육목표·커리큘럼 설계', 'education', 1, false, '커리큘럼', 'PM', 1),
    (v_stage_id, '회차별 교육계획 수립', 'education', 1, false, '회차별 계획표', 'PM', 2),
    (v_stage_id, '평가 기준·수료 기준 수립', 'education', 1, false, '평가기준표', 'PM', 3);

  -- 강사·교재 준비 (18일 전)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('D2', '강사·교재 준비', 'education', 0, false, true, 'start', -18, 502)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '강사 섭외·계약', 'education', 1, false, '강사계약서', '담당자', 1),
    (v_stage_id, '교육자료·교재 제작', 'education', 1, false, '교재', '담당자', 2),
    (v_stage_id, '실습 장비·자료 준비', 'education', 1, false, '준비물 목록', '담당자', 3);

  -- 출석·운영 체계 구축 (9일 전)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('D3', '출석·운영 체계 구축', 'education', 0, false, true, 'start', -9, 503)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '출석부·출결 기준 마련', 'education', 1, false, '출석부', '담당자', 1),
    (v_stage_id, '교육생 명단·연락처 정리', 'education', 1, false, '교육생 명단', '담당자', 2),
    (v_stage_id, '교육 현장 운영계획 수립', 'education', 1, false, '운영계획서', 'PM', 3);

  -- 교육 평가·수료 처리 (행사 종료 5일 후)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('D4', '교육 평가·수료 처리', 'education', 0, false, true, 'end', 5, 504)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '교육 만족도·성취도 평가', 'education', 1, false, '평가결과', 'PM', 1),
    (v_stage_id, '수료 기준 충족 확인', 'education', 1, false, '수료대상자 명단', '담당자', 2),
    (v_stage_id, '수료증 발급', 'education', 1, false, '수료증', '담당자', 3);
end $$;
