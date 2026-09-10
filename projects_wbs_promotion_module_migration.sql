-- WBS 엔진 3단계: 'promotion'(참가자 모집) 모듈 시드 데이터 (Supabase SQL Editor에서 직접 실행)
-- requires_recruitment=true인 프로젝트에서만 이 모듈이 활성화되어 base(+event) 위에 추가로 생성됨

delete from wbs_master_tasks where module = 'promotion';

do $$
declare
  v_stage_id bigint;
begin
  -- 모집 전략·홍보물 기획 (행사 시작 35일 전)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('P1', '모집 전략·홍보물 기획', 'promotion', 0, false, true, 'start', -35, 201)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '모집 대상·핵심 메시지 설정', 'promotion', 1, false, '모집 기획안', '홍보담당', 1),
    (v_stage_id, '홍보 채널·일정 계획', 'promotion', 1, false, '홍보 일정표', '홍보담당', 2),
    (v_stage_id, '모집 정원·선발 기준 확정', 'promotion', 1, false, '선발기준표', 'PM', 3);

  -- 모집 개시 (24일 전)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('P2', '모집 개시', 'promotion', 0, false, true, 'start', -24, 202)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '모집 페이지·신청서 개설', 'promotion', 1, false, '모집페이지', '홍보담당', 1),
    (v_stage_id, 'SNS·채널별 홍보 게시', 'promotion', 1, false, '게시 이력', '홍보담당', 2),
    (v_stage_id, '문의 대응 채널 운영', 'promotion', 1, false, '문의응답 기록', '홍보담당', 3);

  -- 신청자 관리 (17일 전)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('P3', '신청자 관리', 'promotion', 0, false, true, 'start', -17, 203)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '신청 접수·정리', 'promotion', 1, false, '신청자 명단', '홍보담당', 1),
    (v_stage_id, '선발·대기자 관리', 'promotion', 1, false, '선발결과표', 'PM', 2),
    (v_stage_id, '참가 확정 안내 발송', 'promotion', 1, false, '확정 안내문', '홍보담당', 3);

  -- 사전 안내 (5일 전)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('P4', '참가자 사전 안내', 'promotion', 0, false, true, 'start', -5, 204)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '일정·장소·준비물 안내', 'promotion', 1, false, '사전 안내문', '담당자', 1),
    (v_stage_id, '사전 설문(식이·특이사항 등) 수집', 'promotion', 1, false, '사전설문 결과', '담당자', 2),
    (v_stage_id, '최종 참가 인원 확정 공유', 'promotion', 1, false, '최종 참가자 명단', 'PM', 3);
end $$;
