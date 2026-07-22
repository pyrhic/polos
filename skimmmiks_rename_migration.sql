-- 이미 만들어진 skimmiks_* 테이블 이름을 skimmmiks_*(m 3개)로 정정
-- Supabase SQL Editor에서 한 번만 실행하면 됨 (데이터 보존됨)

alter table skimmiks_questions rename to skimmmiks_questions;
alter table skimmiks_jam_events rename to skimmmiks_jam_events;
alter table skimmiks_jam_attendees rename to skimmmiks_jam_attendees;
