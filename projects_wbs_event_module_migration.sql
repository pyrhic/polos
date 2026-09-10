-- WBS 엔진 2단계: 'event'(행사) 모듈 시드 데이터 (Supabase SQL Editor에서 직접 실행)
-- requires_onsite=true인 프로젝트에서만 이 모듈이 활성화되어 base 12단계 위에 추가로 생성됨

delete from wbs_master_tasks where module = 'event';

do $$
declare
  v_stage_id bigint;
begin
  -- 장소·자원 확보 (행사 시작 38일 전)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('E1', '장소·자원 확보', 'event', 0, false, true, 'start', -38, 101)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '장소 섭외 및 대관', 'event', 1, false, '대관계약서', '담당자', 1),
    (v_stage_id, '공간 배치·동선 설계', 'event', 1, false, '배치도', '담당자', 2),
    (v_stage_id, '필요 장비·물품 확보 계획', 'event', 1, false, '장비 리스트', '담당자', 3);

  -- 홍보·모집 착수 (31일 전)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('E2', '홍보·모집 착수', 'event', 0, false, true, 'start', -31, 102)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '홍보 콘텐츠 제작', 'event', 1, false, '홍보물(포스터·카드뉴스)', '홍보담당', 1),
    (v_stage_id, '모집 페이지 개설', 'event', 1, false, '모집페이지', '홍보담당', 2),
    (v_stage_id, '참가 신청 접수 시작', 'event', 1, false, '접수현황표', '홍보담당', 3);

  -- 참가자 모집 마감 (10일 전)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('E3', '참가자 모집 마감', 'event', 0, false, true, 'start', -10, 103)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '참가자 명단 확정', 'event', 1, false, '참가자 명단', 'PM', 1),
    (v_stage_id, '식사·숙박 인원 확정', 'event', 1, false, '인원 확정표', '담당자', 2),
    (v_stage_id, '참가자 사전 안내문 발송', 'event', 1, false, '사전 안내문', '담당자', 3);

  -- 현장 세팅·최종 안전점검 (전날)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('E4', '현장 세팅·최종 안전점검', 'event', 0, false, true, 'start', -1, 104)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '현장 공간·장비 설치', 'event', 1, false, '설치완료 확인서', '담당자', 1),
    (v_stage_id, '안전계획·비상연락망 최종 점검', 'event', 1, false, '안전점검표', '안전담당', 2),
    (v_stage_id, '스태프 역할·동선 브리핑', 'event', 1, false, '브리핑자료', 'PM', 3);

  -- 현장 철수·정산 (종료 다음날)
  insert into wbs_master_tasks (code, name, module, level, required, is_milestone, anchor, offset_days, sort_order)
  values ('E5', '현장 철수·정산', 'event', 0, false, true, 'end', 1, 105)
  returning id into v_stage_id;
  insert into wbs_master_tasks (parent_id, name, module, level, required, deliverables_template, default_assignee, sort_order)
  values
    (v_stage_id, '장비·물품 철수 및 반납', 'event', 1, false, '반납확인서', '담당자', 1),
    (v_stage_id, '분실물·안전사고 확인', 'event', 1, false, '점검기록', '안전담당', 2),
    (v_stage_id, '참가자 만족도 조사 배부', 'event', 1, false, '설문지', '담당자', 3);
end $$;
