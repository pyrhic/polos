-- 채널 카드 목소리 (Supabase > SQL Editor > New query 에 붙여넣고 Run). 여러 번 실행해도 안전합니다.
-- 채널 카드마다 이름 붙은 성우 목소리를 하나 둘 수 있다 (선택). 비어 있으면(null) 카드 목소리 없음.
--   voice  { "name": "Bam", "voice": "ko-KR-SunHiNeural", "rate": 12, "pitch": -14 }
--          voice = Edge TTS 목소리 이름, rate = 말하기 속도 %, pitch = 높낮이 Hz (콘티 video_settings의 tts_voice / tts_rate / tts_pitch와 같은 값)
-- 이 카드를 콘티에 적용하면 콘티 전체 목소리(video_settings.tts_voice/tts_rate/tts_pitch)가 이 값이 되고,
-- 화면 표시용으로 video_settings.voice_name(이름)과 voice_sync(동기화 켬)가 붙는다. 영상 생성 쪽은 바뀌지 않는다.
alter table youtube_subscribe_cards add column if not exists voice jsonb;

-- 새 칸을 REST(PostgREST)가 바로 알아보게
notify pgrst, 'reload schema';
