// 유튜브에 올릴 수 있는 채널 목록 (서버 함수 공용).
// 1순위 Supabase 표 youtube_channels(있고 비어 있지 않을 때) > 2순위 config.js의 YT_CHANNELS > 3순위 1번 채널 하나.
import "../../config.js";

const C = globalThis.POLOS_CONFIG;

const norm = (c) => ({ slot: String(c.slot), label: String(c.label || `채널 ${c.slot}`), ready: c.ready !== false });

export async function loadChannels() {
  try {
    const res = await fetch(`${C.SUPABASE_URL}/rest/v1/youtube_channels?select=slot,label,ready&order=sort_order.asc,slot.asc`, {
      headers: { apikey: C.SUPABASE_ANON_KEY, Authorization: `Bearer ${C.SUPABASE_ANON_KEY}` },
    });
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length) return rows.map(norm);
    }
  } catch { /* 표가 없거나 연결이 안 되면 아래 기본 목록을 쓴다 */ }
  const list = C.YT_CHANNELS;
  return Array.isArray(list) && list.length ? list.map(norm) : [{ slot: "1", label: "기본 채널", ready: true }];
}

// 채널 번호는 1~99의 숫자만 허용한다 (GitHub 비밀값 이름 YOUTUBE_OAUTH_TOKEN_N의 일부가 되므로 엄격하게).
export const isValidSlot = (s) => /^[0-9]{1,2}$/.test(String(s)) && Number(s) >= 1;
