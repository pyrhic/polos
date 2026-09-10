-- WBS 엔진 4단계: 'public_fund'(공공사업) 모듈 시드 데이터 (Supabase SQL Editor에서 직접 실행)
-- is_public_fund=true인 프로젝트에서만 이 모듈이 활성화되어 base(+event/promotion) 위에 추가로 생성됨

delete from wbs_master_tasks where module = 'public_fund';

do $$
declare
  v_stage_id bigint;
begin
  -- 협약·승인 절차 (행사 시작 45일 전)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('F1', '협약·승인 절차', 'public_fund', 0, false, true, 'start', -45, 301)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, evidence_required, sort_order)
  values
    (v_stage_id, '지원사업 협약서 검토·체결', 'public_fund', 1, false, '협약서', 'PM', true, 1),
    (v_stage_id, '사업계획서 승인 신청', 'public_fund', 1, false, '승인신청서', 'PM', true, 2),
    (v_stage_id, '예산 항목별 승인 확인', 'public_fund', 1, false, '승인예산안', '행정', true, 3);

  -- 증빙 체계 구축 (20일 전)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('F2', '증빙 체계 구축', 'public_fund', 0, false, true, 'start', -20, 302)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, evidence_required, sort_order)
  values
    (v_stage_id, '증빙 항목·양식 정리', 'public_fund', 1, false, '증빙양식집', '행정', true, 1),
    (v_stage_id, '회계 처리 기준 확인', 'public_fund', 1, false, '회계기준 메모', '행정', false, 2),
    (v_stage_id, '현장 증빙(사진·서명부 등) 수집 계획 수립', 'public_fund', 1, false, '증빙수집계획', '담당자', true, 3);

  -- 중간보고 (12일 전)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('F3', '중간보고', 'public_fund', 0, false, true, 'start', -12, 303)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, evidence_required, sort_order)
  values
    (v_stage_id, '중간 실적·집행 현황 정리', 'public_fund', 1, false, '중간실적표', 'PM', true, 1),
    (v_stage_id, '중간보고서 작성·제출', 'public_fund', 1, false, '중간보고서', 'PM', true, 2),
    (v_stage_id, '지원기관 피드백 반영', 'public_fund', 1, false, '반영계획', 'PM', false, 3);

  -- 정산·결과보고 제출 (행사 종료 10일 후)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('F4', '정산·결과보고 제출', 'public_fund', 0, false, true, 'end', 10, 304)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, evidence_required, sort_order)
  values
    (v_stage_id, '지출 증빙 최종 정리', 'public_fund', 1, false, '증빙서류철', '행정', true, 1),
    (v_stage_id, '정산보고서 작성·제출', 'public_fund', 1, false, '정산보고서', '행정', true, 2),
    (v_stage_id, '결과보고서 지원기관 제출', 'public_fund', 1, false, '결과보고서', 'PM', true, 3);
end $$;
