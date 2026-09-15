-- 간트차트 "시트에서 가져오기" 기능용 - 여러 업무의 상태를 한 번의 호출로 일괄 갱신
-- (Cloudflare Worker의 하위요청 개수 제한 때문에 업무마다 개별 요청을 못 보내서 필요함.
--  project_wbs_tasks.id가 identity 컬럼이라 upsert로 직접 값을 못 넣어서, 순수 UPDATE로 처리)
create or replace function bulk_update_task_status(updates jsonb)
returns void
language plpgsql
as $$
begin
  update project_wbs_tasks t
  set status = u.status
  from jsonb_to_recordset(updates) as u(id bigint, status text)
  where t.id = u.id;
end;
$$;

grant execute on function bulk_update_task_status(jsonb) to anon, authenticated;
