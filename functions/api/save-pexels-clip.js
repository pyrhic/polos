// Pexels 영상(또는 사진) 한 개를 받아 Supabase Storage(youtube-assets)의 채널 카드 보관함 subscribe/<채널>/에 저장하고 경로를 돌려준다.
// 콘티의 "이 카드를 채널 카드로 등록"에서 쓴다. Pexels 서버는 브라우저의 교차 출처(CORS) 다운로드를 막을 수 있어서 서버가 대신 받는다.
//   POST /api/save-pexels-clip  { url: "https://videos.pexels.com/...", slot: 2 }
//   → 200 { path: "subscribe/2/1792..._pexels_123.mp4", bytes }
//   → 400 허용되지 않은 주소 / 413 너무 큼(50MB 초과) / 415 형식 / 502 받기·저장 실패
// 보안: 받을 수 있는 주소는 Pexels(및 Pexels 영상이 넘겨주는 Vimeo 배포 서버)뿐이다(허용 목록). 넘겨주기(redirect)도 매번 같은 목록으로 다시 확인한다.
import "../../config.js"; // 주소/키는 루트의 config.js 한 곳에서 관리한다 (anon 공개 키, 콘티 화면의 업로드와 같은 권한)

const MAX_BYTES = 50 * 1024 * 1024;   // Supabase 무료 요금제의 파일 업로드 한도(50MB)
const TIMEOUT_MS = 60000;   // 받기부터 저장까지
const MAX_REDIRECTS = 4;

// 처음 주소로 받는 곳: Pexels 영상·사진 서버, 옛 Pexels 영상 주소(player.vimeo.com/external/...)
const START_HOSTS = ["videos.pexels.com", "images.pexels.com", "player.vimeo.com"];
// 넘겨주기로 갈 수 있는 곳: 위 + Vimeo 배포 서버
const REDIRECT_HOSTS = [...START_HOSTS, "vod-progressive.akamaized.net"];
const REDIRECT_SUFFIXES = [".vimeocdn.com"];

const EXT = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const TYPE_BY_EXT = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

const json = (obj, status) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export function allowedUrl(u, start) {
  let url;
  try { url = new URL(u); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
  const h = url.hostname.toLowerCase();
  if (START_HOSTS.includes(h)) {
    if (h === "player.vimeo.com" && !url.pathname.startsWith("/external/")) return null;   // Vimeo는 Pexels가 쓰는 /external/ 영상 주소만
    return url;
  }
  if (start) return null;
  if (REDIRECT_HOSTS.includes(h) || REDIRECT_SUFFIXES.some((s) => h.endsWith(s))) return url;
  return null;
}

// 넘겨주기를 직접 따라가며 매 단계 주소를 허용 목록으로 확인한다
async function fetchAllowed(startUrl, signal) {
  let url = allowedUrl(startUrl, true);
  if (!url) return { error: json({ error: "Pexels 주소만 저장할 수 있어요" }, 400) };
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url.toString(), { headers: { "User-Agent": "Mozilla/5.0", Accept: "video/*,image/*" }, redirect: "manual", signal });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      const next = loc ? allowedUrl(new URL(loc, url).toString(), false) : null;
      if (!next) return { error: json({ error: "허용되지 않은 곳으로 넘겨줘서 멈췄어요" }, 400) };
      url = next;
      continue;
    }
    return { res, url };
  }
  return { error: json({ error: "넘겨주기가 너무 많아요" }, 502) };
}

// 크기 한도를 지키며 본문을 읽는다 (넘으면 바로 끊는다)
async function readLimited(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) { try { await reader.cancel(); } catch { /* 넘어간다 */ } return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

export async function onRequestPost(context) {
  const env = context.env || {};
  const C = globalThis.POLOS_CONFIG || {};
  // 시험용으로 저장소 주소·키를 환경변수로 바꿀 수 있다 (평소엔 config.js 값)
  const SB = String(env.SUPABASE_URL || C.SUPABASE_URL || "").replace(/\/$/, "");
  const KEY = env.SUPABASE_ANON_KEY || C.SUPABASE_ANON_KEY;
  if (!SB || !KEY) return json({ error: "저장소 설정이 없어요" }, 500);
  let body;
  try { body = await context.request.json(); } catch { return json({ error: "요청 형식이 잘못됐어요" }, 400); }
  const slot = Number(body && body.slot);
  if (!Number.isInteger(slot) || slot < 1 || slot > 99) return json({ error: "채널 번호(slot)가 필요해요" }, 400);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const got = await fetchAllowed(body && body.url, ctrl.signal);
    if (got.error) return got.error;
    const { res, url } = got;
    if (!res.ok || !res.body) return json({ error: `Pexels에서 받을 수 없어요 (${res.status})` }, 502);
    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_BYTES) return json({ error: `파일이 ${Math.round(len / 1048576)}MB라서 저장할 수 없어요 (최대 50MB)` }, 413);
    let type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!EXT[type]) {
      const urlExt = ((url.pathname.match(/\.(\w+)$/) || [])[1] || "").toLowerCase();
      if (TYPE_BY_EXT[urlExt] && (!type || type === "application/octet-stream" || type === "binary/octet-stream")) type = TYPE_BY_EXT[urlExt];
    }
    const ext = EXT[type];
    if (!ext) return json({ error: `지원하지 않는 형식이에요 (${type || "알 수 없음"})` }, 415);
    // 길이를 알면 메모리에 모으지 않고 그대로 흘려 보낸다(FixedLengthStream: 선언한 길이와 다르면 업로드가 실패한다).
    // 길이를 모르거나 Workers 밖(시험)이면 한도를 지키며 다 읽은 뒤 올린다.
    let upBody, size;
    if (len > 0 && typeof FixedLengthStream === "function") {
      const { readable, writable } = new FixedLengthStream(len);
      res.body.pipeTo(writable).catch(() => { /* 업로드 쪽에서 실패로 드러난다 */ });
      upBody = readable;
      size = len;
    } else {
      const bytes = await readLimited(res);
      if (!bytes) return json({ error: "파일이 50MB를 넘어서 저장할 수 없어요" }, 413);
      if (!bytes.byteLength) return json({ error: "빈 파일이에요" }, 502);
      upBody = bytes;
      size = bytes.byteLength;
    }

    const id = ((String(body.url).match(/\/(\d+)\//) || [])[1]) || "clip";
    const path = `subscribe/${slot}/${Date.now()}_pexels_${id}.${ext}`;
    const up = await fetch(`${SB}/storage/v1/object/youtube-assets/${path}`, {
      method: "POST",
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": type },
      body: upBody,
    });
    if (!up.ok) return json({ error: "저장 실패: " + (await up.text()).slice(0, 300) }, 502);
    return json({ path, bytes: size }, 200);
  } catch (err) {
    return json({ error: err.name === "AbortError" ? "Pexels에서 받는 시간이 너무 오래 걸려요" : err.message }, 502);
  } finally {
    clearTimeout(timer);
  }
}
