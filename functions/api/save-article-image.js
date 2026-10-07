// 기사에서 찾은 사진 한 장을 내려받아 Supabase Storage(youtube-assets)에 저장하고 경로를 돌려준다.
// 저작권 문제가 있는지는 사용자가 콘티에서 사진별 출처를 보고 직접 판단해 삭제한다.
const SUPABASE_URL = "https://oenqrlgmnkpzxsavnfyo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_sZ4wQgaC5f-i40pVzf0vIA_R7iJWDf5";
const MAX_BYTES = 8 * 1024 * 1024;
const MIN_BYTES = 8 * 1024; // 아이콘/픽셀 같은 너무 작은 파일은 사진이 아니므로 제외

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json" },
});

function isAllowedUrl(u) {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return false;
    const h = url.hostname;
    return !(h === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || h.endsWith(".local") || h.endsWith(".internal"));
  } catch {
    return false;
  }
}

const EXT = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp" };

export async function onRequestPost(context) {
  try {
    const { url, referer, scriptId, segId, n } = await context.request.json();
    if (!isAllowedUrl(url)) return json({ error: "허용되지 않은 주소입니다" }, 400);
    if (!Number.isInteger(scriptId) || !Number.isInteger(segId)) return json({ error: "scriptId, segId가 필요합니다" }, 400);

    const headers = { "User-Agent": "Mozilla/5.0", Accept: "image/*" };
    if (isAllowedUrl(referer)) headers.Referer = referer; // 일부 언론사는 기사 페이지가 아닌 곳의 요청을 막는다

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    let res;
    try {
      res = await fetch(url, { headers, signal: ctrl.signal, redirect: "follow" });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return json({ error: `사진을 받을 수 없습니다 (${res.status})` }, 502);
    const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const ext = EXT[type];
    if (!ext) return json({ error: "지원하지 않는 사진 형식입니다 (" + type + ")" }, 415);

    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) return json({ error: "사진이 너무 큽니다" }, 413);
    if (bytes.byteLength < MIN_BYTES) return json({ error: "너무 작은 이미지라 건너뜁니다" }, 422);

    const path = `${scriptId}/seg${segId}_news_${Date.now()}_${Number(n) || 0}.${ext}`;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/youtube-assets/${path}`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": type },
      body: bytes,
    });
    if (!up.ok) return json({ error: "저장 실패: " + (await up.text()) }, 502);
    return json({ path, bytes: bytes.byteLength }, 200);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
