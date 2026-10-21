// 영상 생성 시작(콘티 페이지)과 완료 알림(콘티/Studio 페이지)에 같이 쓰는 도구.
// 주소/키는 /config.js 에서 읽는다 (이 파일을 쓰는 페이지에서 config.js를 먼저 불러와야 한다)
const GEN_SUPABASE_URL = POLOS_CONFIG.SUPABASE_URL;
const GEN_SUPABASE_KEY = POLOS_CONFIG.SUPABASE_ANON_KEY;
const genHeaders = { apikey: GEN_SUPABASE_KEY, Authorization: `Bearer ${GEN_SUPABASE_KEY}` };

// 성우 목록 (Edge TTS 목소리). 콘티 화면의 음향 카드와 채널 화면의 채널 카드 목소리가 같이 쓴다
const GEN_VOICES = [
  { id: "ko-KR-InJoonNeural", label: "인준 (남성) — 현재 기본" },
  { id: "ko-KR-HyunsuMultilingualNeural", label: "현수 (남성)" },
  { id: "ko-KR-SunHiNeural", label: "선희 (여성)" },
];
// 목소리 짧은 이름 (예: "선희")
function genVoiceShort(id) {
  const v = GEN_VOICES.find((x) => x.id === id);
  return v ? v.label.replace(/ \(.*$/, "") : String(id || "");
}
// 채널 카드 목소리 표시: "Bam (선희 · +12% · -14Hz)"
function genVoiceLabel(name, voice, rate, pitch) {
  const sg = (n) => `${Number(n) > 0 ? "+" : ""}${Number(n) || 0}`;
  return `${name} (${genVoiceShort(voice)} · ${sg(rate)}% · ${sg(pitch)}Hz)`;
}

function genAssetUrl(path) {
  // 전체 주소(Pexels 등)와 빈 화면 토큰(blank:black / blank:white / blank:bars)은 그대로 넘긴다
  if (/^https?:\/\//.test(path) || /^blank:/.test(path)) return path;
  return `${GEN_SUPABASE_URL}/storage/v1/object/public/youtube-assets/${path}`;
}

// 콘티 페이지와 같은 기준(초당 4.3자) — 노출 시간을 직접 안 정했으면 대사 길이로 추정. (자막 줄이 없는 장면용)
function genEstimateSeconds(text) {
  const len = (text || "").replace(/\*\*/g, "").replace(/(^|\s)\/(?=\s|$)/g, "").replace(/\s+/g, "").length;   // 자막 끊김 표시(/)는 읽지 않는다
  return Math.max(1, len / 4.3);
}

// ───── 자막 줄 = 화면 단위 (youtube-automation docs/storyboard-contract.md 6절) ─────
// 콘티 화면(storyboard.html)도 이 함수들을 그대로 써서, 콘티의 길이 = 생성 요청의 길이가 되게 한다.
// 줄바꿈 = 자막 한 줄. 빈 줄은 무시. 옛 표시 " / "(앞뒤 공백 있는 /)도 줄바꿈으로 본다. **강조**는 그대로 둔다
function genCaptionLines(text) {
  return String(text || "").replace(/\r/g, "").replace(/[ \t]+\/[ \t]+/g, "\n")
    .split("\n").map((l) => l.trim()).filter(Boolean);
}
// [ ... ] = 목소리로는 읽고 화면 자막에서는 뺀다 (계약서 8절)
// { ... } = 화면 자막에는 보이고 목소리로는 읽지 않는다 (계약서 8-2절). 짝이 맞는 기호만, 짝 없는 기호는 일반 글자
const GEN_CAP_HIDE_RE = /\[([^\[\]]*)\]/g;
const GEN_CAP_MUTE_RE = /\{([^{}]*)\}/g;
// 쉼 표시 (계약서 10절): 따로 떨어진 -(앞뒤가 공백·줄 시작·줄 끝). 하나마다 0.3초. --처럼 붙은 덩어리는 개수만큼.
// 단어 안 하이픈(K-pop, 1-2위, 코로나-19)은 일반 글자. 쉼 표시는 읽지도 보이지도 않는다
const GEN_CAP_PAUSE_RE = /(^|\s)(-+)(?=\s|$)/g;
const GEN_CAP_PAUSE_SEC = 0.3;
function genCaptionPauseCount(line) {
  let n = 0;
  String(line || "").replace(GEN_CAP_PAUSE_RE, (_, a, d) => { n += d.length; return a; });
  return n;
}
function genCaptionStripPause(line) {
  return String(line || "").replace(GEN_CAP_PAUSE_RE, " ").replace(/\s+/g, " ").trim();
}
// 읽는 글자: {..}는 통째로 빼고, [..]는 기호만 뗀다. 쉼 표시(-)도 뺀다
function genCaptionSpoken(line) {
  return genCaptionStripPause(String(line || "").replace(GEN_CAP_MUTE_RE, " ").replace(GEN_CAP_HIDE_RE, "$1"));
}
// 화면에 보이는 글자: [..]는 통째로 빼고, {..}는 기호만 뗀다 (전부 숨김이면 ""). 쉼 표시(-)도 뺀다
function genCaptionShown(line) {
  return genCaptionStripPause(String(line || "").replace(GEN_CAP_HIDE_RE, " ").replace(GEN_CAP_MUTE_RE, "$1"));
}
// 예상 목소리 길이(초) = max(0.6, 글자수 / 4.3 / (1 + tts_rate/100)) + 쉼 개수 × 0.3. 글자수는 읽는 글자(공백·**·/·기호·쉼 표시 제외, [ ] 안 포함, { } 안 제외).
// 읽을 글자가 없는 줄(전부 { })은 보이는 글자수로 같은 식 — 자막이 너무 빨리 사라지지 않게
function genCaptionEst(line, ttsRate) {
  const cnt = (t) => t.replace(/\*\*/g, "").replace(/\//g, "").replace(/\s+/g, "").length;
  const len = cnt(genCaptionSpoken(line)) || cnt(genCaptionShown(line));
  const rate = 1 + (Number(ttsRate) || 0) / 100;
  return Math.max(0.6, len / 4.3 / (rate > 0 ? rate : 1)) + genCaptionPauseCount(line) * GEN_CAP_PAUSE_SEC;
}
// 읽을 글자가 없는 줄(전부 { } 자막만)인지. 이런 줄만 길이를 직접 정할 수 있다 (계약서 11절)
function genCaptionIsMuteOnly(line) {
  return genCaptionSpoken(line).replace(/\*\*/g, "").replace(/\//g, "").replace(/\s+/g, "").length === 0;
}
// 그 줄에 쓸 정한 값: { } 전용 줄의 숫자만. 읽는 줄의 옛 저장값(__cap_secs)은 무시한다 (계약서 11절)
function genCaptionSetValue(line, arr, i) {
  const v = Number(arr[i]);
  return arr[i] != null && v > 0 && genCaptionIsMuteOnly(line) ? v : null;
}
// 줄별 길이: { } 전용 줄에 정한 값이 있으면 그 값(단, 예상 길이보다 짧을 수 없다), 그 밖에는 예상 길이(est, 쉼 포함) 그대로
// 콘티 화면(자막 트랙·장면 길이·미리보기)이 이 값을 쓴다
function genCaptionSecs(lines, capSecs, ttsRate) {
  const arr = Array.isArray(capSecs) ? capSecs : [];
  return lines.map((l, i) => {
    const est = genCaptionEst(l, ttsRate);
    const v = genCaptionSetValue(l, arr, i);
    return v != null ? Math.max(est, v) : est;
  });
}
// 생성 요청용 줄별 길이 (계약서 11절): { } 전용 줄에 정한 값만 숫자(최소 est 보정), 읽는 줄은 늘 null — 파이프라인이 자연 길이로 읽는다
function genCaptionSecsForRequest(lines, capSecs, ttsRate) {
  const arr = Array.isArray(capSecs) ? capSecs : [];
  return lines.map((l, i) => {
    const v = genCaptionSetValue(l, arr, i);
    return v != null ? Number(Math.max(genCaptionEst(l, ttsRate), v).toFixed(2)) : null;
  });
}

// 콘티(장면)의 대사를 이어붙인 것이 실제 음성/자막의 원본이 된다. 대사에서 **글자**로 표시한 부분은 강조 자막이 된다.
function genToMarkdown(r, segRows) {
  const baseTerms = (r.emphasize_terms || "").split(",").map((s) => s.trim()).filter(Boolean);
  const markedTerms = [];
  // 장면 안의 자막 줄(줄바꿈)은 그대로 줄로 넣는다 (빈 줄만 뺀다)
  const lines = (segRows || [])
    .map((s) => (s.script_text || "").replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean).join("\n"))
    .filter(Boolean)
    .map((t) => t.replace(/\*\*(.+?)\*\*/g, (_, term) => { markedTerms.push(term.trim()); return term; }));
  const terms = [...new Set([...baseTerms, ...markedTerms])];

  const body = lines.length
    ? `## 스토리\n${lines.join("\n")}`
    : `## 후킹 (0~2초)\n${r.hook}\n\n## 스토리 (2~40초)\n${r.story}\n\n## 클로징 (짧게, 2~5초)\n${r.closing || ""}`;

  return `---
category: "${r.category}"
format: shorts
fact_sources:
${(r.fact_sources || "").split("\n").filter(Boolean).map((s) => `  - "${s.trim()}"`).join("\n")}
is_conspiracy_or_unverified: ${r.is_conspiracy_or_unverified}
emphasize_terms: [${terms.map((s) => `"${s.replace(/"/g, "")}"`).join(", ")}]
keep_together_terms: [${(r.keep_together_terms || "").split(",").filter(Boolean).map((s) => `"${s.trim()}"`).join(", ")}]
status: approved
revision_log:
  - "폰 앱에서 생성"
---

# 대본

${body}
`;
}

// Pexels 슬라이드쇼(사진+제목+음악). 예전 이름("curation"/"큐레이션")으로 저장된 행도 같은 것으로 본다.
const PEXELS_CATEGORY = "Pexels";
const PEXELS_CATEGORIES = [PEXELS_CATEGORY, "큐레이션"];   // 두 번째는 옛 카테고리 값(호환용)
function isPexelsMode(mode) { return mode === "pexels" || mode === "curation"; }
function isPexelsCategory(category) { return PEXELS_CATEGORIES.includes(category); }

// videoSettings: youtube_scripts.video_settings. tts_rate로 자막 줄 예상 길이를 계산한다.
// Pexels 슬라이드쇼(mode=pexels)는 옛 방식 그대로라 자막 줄(caption_lines)을 보내지 않는다 (계약서 6-4 마지막 줄)
function genBuildSegments(segRows, videoSettings) {
  const vs = videoSettings || {};
  const lineMode = !isPexelsMode(vs.mode);
  return [...segRows].sort((a, b) => a.order_no - b.order_no).map((s) => {
    const trims = s.asset_trims || {};
    const weights = trims.__weights || {};
    // 자막 줄과 줄별 길이 (계약서 11절). { } 전용 줄에 정한 값만 숫자, 읽는 줄은 null. weight_seconds는 콘티 화면 예상 합계(그 밖의 줄 = est)
    const capLines = lineMode ? genCaptionLines(s.script_text) : [];
    const capSecs = genCaptionSecsForRequest(capLines, trims.__cap_secs, vs.tts_rate);
    const capSum = Number(genCaptionSecs(capLines, trims.__cap_secs, vs.tts_rate).reduce((a, b) => a + b, 0).toFixed(2));
    return {
      section: s.section,
      script_text: s.script_text,
      keyword: s.keyword,
      direction: s.direction,
      ...(lineMode ? { caption_lines: capLines, caption_secs: capSecs } : {}),
      // 자막 줄이 있으면 줄 길이 합. 없으면(빈 "내 의견" 등) 노출 시간(target_seconds), 그것도 없으면 대사 길이 추정(빈 대사면 1)
      weight_seconds: capLines.length ? capSum : s.target_seconds > 0 ? Number(s.target_seconds) : genEstimateSeconds(s.script_text),
      asset_urls: (s.asset_paths || []).map(genAssetUrl),
      // 영상/GIF 소재별 사용 구간 (소재 주소 -> {start, end}). __focus/__weights/__autofill/__cleared/__pexels/__cap_secs 같은 "__" 칸은 소재가 아니라서 뺀다
      asset_trims: Object.fromEntries(Object.entries(trims).filter(([k]) => !k.startsWith("__")).map(([path, t]) => [genAssetUrl(path), t])),
      // 사진/영상을 화면 비율로 자를 때 남길 부분 (asset_trims.__focus에 소재별로 저장됨)
      asset_focus: Object.fromEntries(Object.entries(trims.__focus || {}).filter(([k]) => !k.startsWith("__")).map(([path, f]) => [genAssetUrl(path), f])),
      // 장면 안 클립별 비중 (asset_trims.__weights, 없으면 1 = 균등). 키는 asset_urls 값과 같은 문자열
      asset_weights: Object.fromEntries((s.asset_paths || []).map((path) => [genAssetUrl(path), Number(weights[path]) > 0 ? Number(weights[path]) : 1])),
    };
  });
}

// 다음에 만들 영상 버전 번호
async function genNextVersion(scriptId) {
  const res = await fetch(`${GEN_SUPABASE_URL}/rest/v1/youtube_outputs?select=version&script_id=eq.${scriptId}&order=version.desc&limit=1`, { headers: genHeaders });
  if (!res.ok) return 1;
  const rows = await res.json();
  return (rows[0] ? rows[0].version : 0) + 1;
}

// 상태와 마지막 실패 정보(어느 단계에서, 언제, 실행 기록 주소)
async function genFetchInfo(scriptId) {
  const res = await fetch(`${GEN_SUPABASE_URL}/rest/v1/youtube_scripts?select=generation_status,video_settings,hook&id=eq.${scriptId}`, { headers: genHeaders });
  if (!res.ok) return null;
  const rows = await res.json();
  if (!rows[0]) return null;
  return { status: rows[0].generation_status || "idle", lastError: (rows[0].video_settings || {}).last_error || null, name: genVideoName(rows[0]) };
}

// 알림·실패 안내에 쓰는 영상 이름 (정한 이름이 없으면 후킹 앞 20자)
function genVideoName(r) {
  return (r && ((r.video_settings && r.video_settings.name) || (r.hook || "").slice(0, 20))) || "";
}

// 예: "이병철 영상생성이 소재부족으로 실패했습니다. (2번, 4번 비어있음)"
// message(파이프라인이 남긴 실패 이유)가 없으면 실패 단계를 알려준다.
function genErrorText(le, name) {
  const who = name ? `${name} ` : "";
  if (!le) return `${who}영상생성이 실패했습니다.`;
  if (le.message) return `${who}영상생성이 ${le.message}`;
  const when = le.at ? new Date(le.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }) : "";
  return `${who}영상생성이 실패했습니다 — 실패 단계: ${le.step}${when ? " (" + when + ")" : ""}`;
}

async function genFetchStatus(scriptId) {
  const res = await fetch(`${GEN_SUPABASE_URL}/rest/v1/youtube_scripts?select=generation_status&id=eq.${scriptId}`, { headers: genHeaders });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] ? rows[0].generation_status || "idle" : null;
}

// 깃허브 액션에 영상 생성을 시킨다. 실패하면 Error를 던진다.
async function genStart(row, segRows, version) {
  const vs = row.video_settings || {};
  const segments = genBuildSegments(segRows, vs);
  const settings = {
    caption_font_size: vs.caption_font_size,
    layout: vs.layout,
    title1: vs.title1,
    title2: vs.title2,
    source_text: vs.source_text,
    caption_weight: vs.caption_weight,
    caption_position_pct: vs.caption_position_pct,
    bgm_url: vs.bgm_path ? genAssetUrl(vs.bgm_path) : null,
    bgm_volume: vs.bgm_volume,
    mood: vs.mood,
    transition: "cut",   // 화면 전환은 늘 컷 (예전에 fade로 저장된 콘티도 컷으로 만든다)
    tts_voice: vs.tts_voice,
    tts_rate: vs.tts_rate,
    tts_pitch: vs.tts_pitch,
    // Pexels 슬라이드쇼(사진+제목+음악, 음성·자막 없음)용. 옛 값 "curation"도 "pexels"로 보낸다
    mode: isPexelsMode(vs.mode) ? "pexels" : vs.mode,
    title_text: vs.title_text,
    secs_per_photo: vs.secs_per_photo,
    caption_mode: vs.caption_mode,   // off / name / name_desc
    caption_font: vs.caption_font,   // sans(고딕) / serif(명조)
    // Pexels 슬라이드쇼 화면 방향: 숏폼 portrait(1080x1920) / 롱폼 landscape(1920x1080). 다른 영상은 보내지 않는다
    ...(isPexelsMode(vs.mode) ? { orientation: vs.orientation === "landscape" || vs.pexels_format === "long" ? "landscape" : "portrait" } : {}),
  };
  const res = await fetch("/api/trigger-generation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scriptId: row.id, scriptContent: genToMarkdown(row, segRows), segments, settings, channel: "wizard-yt", version }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "알 수 없는 오류");
}

// ───── 완료 알림: 화면 안 알림창 + (허용했다면) 기기 알림 ─────
function genRequestPermission() {
  try {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  } catch { /* 알림을 못 쓰는 환경이면 화면 안 알림창만 쓴다 */ }
}

// link: { href, text } — 알림창 오른쪽 링크. 안 주면(undefined) 성공 알림에 "Studio 열기"(영상 생성 알림의 옛 동작), null이면 링크 없음
function genToast(text, ok, link) {
  let box = document.getElementById("genToast");
  if (!box) {
    box = document.createElement("div");
    box.id = "genToast";
    box.style.cssText = "position:fixed;left:12px;right:12px;bottom:14px;z-index:60;max-width:436px;margin:0 auto;padding:12px 14px;border-radius:6px;font-size:0.9rem;font-weight:700;display:flex;gap:10px;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,0.5);";
    document.body.appendChild(box);
  }
  box.style.background = ok ? "#1c1c1c" : "#ff6b6b"; box.style.border = ok ? "1px solid #444" : "none";
  box.style.color = ok ? "#ffffff" : "#000000";
  box.innerHTML = "";
  const span = document.createElement("span");
  span.style.flex = "1";
  span.textContent = text;
  box.appendChild(span);
  if (link === undefined && ok) link = { href: "/youtube/review.html", text: "Studio 열기" };
  if (link && link.href) {
    const a = document.createElement("a");
    a.href = link.href;
    a.textContent = link.text || "열기";
    a.style.cssText = `color:${ok ? "#ffffff" : "#000000"};text-decoration:underline;white-space:nowrap;`;
    box.appendChild(a);
  }
  const x = document.createElement("button");
  x.type = "button";
  x.textContent = "×";
  x.style.cssText = "width:auto;padding:0 6px;margin:0;background:none;box-shadow:none;color:inherit;font-size:1.2rem;";
  x.addEventListener("click", () => box.remove());
  box.appendChild(x);
}

// opts(선택): { title, body, url, linkText } — 안 주면 영상 생성 알림(옛 동작)
async function genNotify(name, ok, opts) {
  const o = opts || {};
  const title = o.title || (ok ? "영상이 완성되었습니다" : "영상 생성에 실패했습니다");
  const url = o.url || "/youtube/review.html";
  genToast(name ? `${title} — ${name}` : title, ok, o.url ? { href: o.url, text: o.linkText || "열기" } : undefined);
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      const body = o.body || (name + (ok ? " · Studio에서 확인하세요" : " · Studio에서 상태를 확인하세요"));
      const nopts = { body, icon: "/icon-192.png", data: { url } };
      // ready는 서비스 워커가 없는 화면에서 끝나지 않으므로 getRegistration으로 (없으면 일반 알림)
      const reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
      if (reg && reg.showNotification) reg.showNotification(title, nopts);
      else new Notification(title, nopts);
    }
  } catch { /* 기기 알림이 안 되면 화면 알림창만 */ }
}

// ───── 콘티 자동 생성 감시: 서버(Supabase Edge Function create-conti)가 만드는 콘티가 끝나면 알린다 ─────
// 만들기를 시작한 콘티 번호를 이 기기 localStorage "contiJobs"에 적어 두고, 이 파일을 불러오는 모든 유튜브 화면이 확인한다.
// 앱을 닫아 둔 사이에 끝난 것도 다음에 열 때 알린다. 끝나거나(done/error) 15분 넘게 멈추면 목록에서 뺀다.
// 결과는 window에 "contijob" 이벤트({detail:{id, status, row}})로도 알린다 (콘티 목록·위키 화면이 다시 그릴 때 씀)
const CONTI_JOBS_KEY = "contiJobs";
const CONTI_JOB_POLL_MS = 8000;
const CONTI_JOB_STALE_MS = 15 * 60 * 1000;
function contiJobsGet() {
  try { const v = JSON.parse(localStorage.getItem(CONTI_JOBS_KEY) || "[]"); return Array.isArray(v) ? v.filter((j) => j && j.id != null) : []; } catch { return []; }
}
function contiJobsSet(list) {
  try { if (list.length) localStorage.setItem(CONTI_JOBS_KEY, JSON.stringify(list)); else localStorage.removeItem(CONTI_JOBS_KEY); } catch { /* 저장 못 하면 알림만 못 받는다 */ }
}
function contiJobsAdd(id, name) {
  const list = contiJobsGet().filter((j) => String(j.id) !== String(id));
  list.push({ id: Number(id), name: name || "", at: Date.now() });
  contiJobsSet(list);
  contiJobWatch();
}
function contiJobsRemove(id) {
  contiJobsSet(contiJobsGet().filter((j) => String(j.id) !== String(id)));
}
function contiJobUrl(id) { return `/youtube/storyboard.html?open=${encodeURIComponent(id)}`; }

let contiJobChecking = null;
function contiJobCheckNow() {
  if (!contiJobChecking) contiJobChecking = contiJobCheck().finally(() => { contiJobChecking = null; });
  return contiJobChecking;
}
async function contiJobCheck() {
  const jobs = contiJobsGet();
  if (!jobs.length) return;
  let rows;
  try {
    const res = await fetch(`${GEN_SUPABASE_URL}/rest/v1/youtube_scripts?select=id,create_status,create_error,create_started_at,created_at,video_settings,hook&id=in.(${jobs.map((j) => Number(j.id)).join(",")})`, { headers: genHeaders });
    if (!res.ok) return;   // 표에 칸이 아직 없거나 서버 오류 — 다음에 다시
    rows = await res.json();
  } catch { return; }
  const now = Date.now();
  for (const j of jobs) {
    const r = rows.find((x) => String(x.id) === String(j.id));
    // 다른 탭이 먼저 알렸으면 건너뛴다
    if (!contiJobsGet().some((x) => String(x.id) === String(j.id))) continue;
    if (!r) { contiJobsRemove(j.id); continue; }   // 지운 콘티
    const name = (r.video_settings && r.video_settings.name) || j.name || (r.hook || "").slice(0, 20);
    let st = r.create_status;
    if (st === "queued" || st === "running") {
      const t = Date.parse(r.create_started_at || r.created_at || "") || j.at;
      if (now - t <= CONTI_JOB_STALE_MS) { contiJobEvent(j.id, st, r); continue; }
      st = "timeout";
    }
    contiJobsRemove(j.id);
    if (st === "done" || st == null) {
      genNotify(name, true, { title: "콘티가 만들어졌습니다", body: name + " · Scenes에서 열어 보세요", url: contiJobUrl(j.id), linkText: "열기" });
      contiJobEvent(j.id, "done", r);
    } else {
      const why = st === "timeout" ? "시간이 너무 오래 걸려 멈춘 것 같아요" : (r.create_error || "");
      genNotify(name, false, { title: "콘티 생성에 실패했습니다", body: `${name}${why ? " · " + why : ""}`, url: contiJobUrl(j.id), linkText: "확인" });
      contiJobEvent(j.id, st === "timeout" ? "timeout" : "error", r);
    }
  }
}
function contiJobEvent(id, status, row) {
  try { window.dispatchEvent(new CustomEvent("contijob", { detail: { id: Number(id), status, row } })); } catch { /* 무시 */ }
}
let contiJobTimer = null;
function contiJobWatch() {
  if (contiJobTimer) return;
  contiJobTimer = setInterval(() => { if (!document.hidden && contiJobsGet().length) contiJobCheckNow(); }, CONTI_JOB_POLL_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && contiJobsGet().length) contiJobCheckNow(); });
  if (contiJobsGet().length) contiJobCheckNow();   // 화면을 열 때 한 번 (앱을 닫아 둔 사이 끝난 것)
}
contiJobWatch();
