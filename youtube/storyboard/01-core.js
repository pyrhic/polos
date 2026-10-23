// storyboard/01-core.js — Supabase 설정·공통 상태(scripts/segments)·문자열 이스케이프·소재 종류 판별(사진/영상/빈 화면/Pexels)
// storyboard.html에서 순서 그대로 잘라낸 파일. 일반 <script>로 차례대로 불러오므로 앞 파일의 전역(let/const/function)을 그대로 쓴다.
  const SUPABASE_URL = POLOS_CONFIG.SUPABASE_URL;
  const SUPABASE_ANON_KEY = POLOS_CONFIG.SUPABASE_ANON_KEY;
  const BUCKET = "youtube-assets";
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  };
  const jsonHeaders = { ...headers, "Content-Type": "application/json" };
  let scripts = [];
  let slideshows = [];   // Pexels 슬라이드쇼 행 (목록에만 보이고, 열면 pexels-edit.html)
  const isSlideshowRow = (r) => !!r && (isPexelsCategory(r.category) || isPexelsMode((r.video_settings || {}).mode));
  const openSlideshow = (id) => { location.href = `/youtube/pexels-edit.html?id=${encodeURIComponent(id)}`; };
  let segments = [];

  function escapeAttr(s) {
    return String(s ?? "").replace(/"/g, "&quot;");
  }
  // 줄바꿈을 공백으로 (한 줄 칸용)
  function oneLine(s) {
    return String(s || "").replace(/\s*[\r\n]+\s*/g, " ");
  }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  function showMsg(text, ok) {
    const msg = document.getElementById("msg");
    msg.className = "msg " + (ok ? "ok" : "err");
    msg.textContent = text;
  }

  function publicUrl(path) {
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  }

  function isImage(path) {
    return /\.(jpe?g|png|gif|webp)$/i.test(path);
  }

  // asset_paths에는 직접 올린 파일의 스토리지 경로 또는 Pexels에서 고른 영상의 전체 URL이 섞여 들어간다.
  function isExternalUrl(path) {
    return /^https?:\/\//.test(path);
  }
  function assetUrl(path) {
    return isExternalUrl(path) ? path : publicUrl(path);
  }
  // Pexels 소재 (호스트가 pexels.com으로 끝남, 사진·영상 모두) → 미리보기에 "참고 영상" 표시 (계약서 7절. 주소만 보고 판단)
  const PV_REF_TEXT = "참고 영상";
  function isPexels(path) {
    if (!path || !isExternalUrl(path)) return false;
    try { const h = new URL(path).hostname.toLowerCase(); return h === "pexels.com" || h.endsWith(".pexels.com"); } catch { return false; }
  }

  // 빈 화면 토큰: asset_paths 안에 일반 소재처럼 들어간다 (영상 생성 때 ffmpeg가 직접 만든다. docs/storyboard-contract.md 1절)
  const BLANKS = [
    { token: "blank:black", label: "검정" },
    { token: "blank:white", label: "흰색" },
    { token: "blank:bars", label: "화면조정" },
  ];
  function isBlank(path) {
    return /^blank:/.test(path || "");
  }
  function blankClass(path) {
    return "blank-" + String(path).slice(6).replace(/[^a-z]/g, "");
  }
  function blankLabel(path) {
    return (BLANKS.find((b) => b.token === path) || {}).label || "빈 화면";
  }
  // 영상 소재 (사진·GIF·빈 화면이 아닌 것)
  function isVideo(path) {
    return !isBlank(path) && !isImage(path);
  }
  // 스토리지에 실제 파일이 있는 소재 (지울 때 파일도 같이 지운다)
  function isStoragePath(path) {
    return !isExternalUrl(path) && !isBlank(path);
  }
  // 이 콘티만 쓰는 스토리지 파일인지: 구독 카드 사진(subscribe/...)은 여러 콘티가 같이 쓰므로 콘티에서 지우지 않는다
  function isOwnStoragePath(path) {
    return isStoragePath(path) && !String(path).startsWith("subscribe/");
  }

  // 구간을 고를 수 있는 소재: 영상과 GIF (사진·빈 화면은 해당 없음)
  function isTrimmable(path) {
    if (isBlank(path)) return false;
    return !isImage(path) || /\.gif(\?|$)/i.test(path);
  }

