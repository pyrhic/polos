-- WBS 항목에 시작일을 추가해서 기간(줄)으로 표시할 수 있게 함 (Supabase SQL Editor에서 직접 실행)
alter table project_todos add column if not exists start_date date;
