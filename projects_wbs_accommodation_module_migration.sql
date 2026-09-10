-- WBS 엔진 5단계: 'accommodation'(숙박) 모듈 시드 데이터 (Supabase SQL Editor에서 직접 실행)
-- requires_accommodation=true인 프로젝트에서만 이 모듈이 활성화되어 base(+event/promotion/public_fund) 위에 추가로 생성됨

delete from wbs_master_tasks where module = 'accommodation';

do $$
declare
  v_stage_id bigint;
begin
  -- 숙박·이동 계획 (행사 시작 25일 전)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('A1', '숙박·이동 계획', 'accommodation', 0, false, true, 'start', -25, 401)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '숙소 섭외·예약', 'accommodation', 1, false, '숙박 계약서', '담당자', 1),
    (v_stage_id, '이동 수단·픽업 계획 수립', 'accommodation', 1, false, '이동계획서', '담당자', 2),
    (v_stage_id, '객실 배정 기준 수립', 'accommodation', 1, false, '배정기준표', '담당자', 3);

  -- 숙박·이동 확정 (13일 전)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('A2', '숙박·이동 확정', 'accommodation', 0, false, true, 'start', -13, 402)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '객실 배정 확정', 'accommodation', 1, false, '배정표', '담당자', 1),
    (v_stage_id, '이동 인원·시간표 확정', 'accommodation', 1, false, '이동시간표', '담당자', 2),
    (v_stage_id, '식이·알레르기 등 특이사항 반영', 'accommodation', 1, false, '특이사항 목록', '담당자', 3);

  -- 숙박 현장 운영 준비 (2일 전)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('A3', '숙박 현장 운영 준비', 'accommodation', 0, false, true, 'start', -2, 403)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '체크인 안내·동선 준비', 'accommodation', 1, false, '체크인 안내문', '담당자', 1),
    (v_stage_id, '야간 안전관리 계획 수립', 'accommodation', 1, false, '안전관리계획', '안전담당', 2),
    (v_stage_id, '체크아웃 절차·정산 준비', 'accommodation', 1, false, '체크아웃 안내문', '담당자', 3);
end $$;
