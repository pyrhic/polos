// 영상 생성 시작(콘티 페이지)과 완료 알림(콘티/Studio 페이지)에 같이 쓰는 도구.
const GEN_SUPABASE_URL = "https://oenqrlgmnkpzxsavnfyo.supabase.co";
const GEN_SUPABASE_KEY = "sb_publishable_sZ4wQgaC5f-i40pVzf0vIA_R7iJWDf5";
const genHeaders = { apikey: GEN_SUPABASE_KEY, Authorization: `Bearer ${GEN_SUPABASE_KEY}` };

function genAssetUrl(path) {
  if (/^https?:\/\//.test(path)) return path;
  return `${GEN_SUPABASE_URL}/storage/v1/object/public/youtube-assets/${path}`;
}

// 콘티 페이지와 같은 기준(초당 4.3자) — 노출 시간을 직접 안 정했으면 대사 길이로 추정.
function genEstimateSeconds(text) {
  const len = (text || "").replace(/\*\*/g, "").replace(/\s+/g, "").length;
  return Math.max(1, len / 4.3);
}

// 콘티(장면)의 대사를 이어붙인 것이 실제 음성/자막의 원본이 된다. 대사에서 **글자**로 표시한 부분은 강조 자막이 된다.
function genToMarkdown(r, segRows) {
  const baseTerms = (r.emphasize_terms || "").split(",").map((s) => s.trim()).filter(Boolean);
  const markedTerms = [];
  const lines = (segRows || [])
    .map((s) => (s.script_text || "").trim())
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

function genBuildSegments(segRows) {
  return [...segRows].sort((a, b) => a.order_no - b.order_no).map((s) => ({
    section: s.section,
    script_text: s.script_text,
    keyword: s.keyword,
    direction: s.direction,
    weight_seconds: s.target_seconds > 0 ? Number(s.target_seconds) : genEstimateSeconds(s.script_text),
    asset_urls: (s.asset_paths || []).map(genAssetUrl),
    // 영상/GIF 소재별 사용 구간 (소재 주소 -> {start, end})
    asset_trims: Object.fromEntries(Object.entries(s.asset_trims || {}).map(([path, t]) => [genAssetUrl(path), t])),
  }));
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
  const res = await fetch(`${GEN_SUPABASE_URL}/rest/v1/youtube_scripts?select=generation_status,video_settings&id=eq.${scriptId}`, { headers: genHeaders });
  if (!res.ok) return null;
  const rows = await res.json();
  if (!rows[0]) return null;
  return { status: rows[0].generation_status || "idle", lastError: (rows[0].video_settings || {}).last_error || null };
}

function genErrorText(le) {
  if (!le) return "지난 영상 생성이 실패했습니다.";
  const when = le.at ? new Date(le.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }) : "";
  return `지난 영상 생성이 실패했습니다 — 실패 단계: ${le.step}${when ? " (" + when + ")" : ""}`;
}

async function genFetchStatus(scriptId) {
  const res = await fetch(`${GEN_SUPABASE_URL}/rest/v1/youtube_scripts?select=generation_status&id=eq.${scriptId}`, { headers: genHeaders });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] ? rows[0].generation_status || "idle" : null;
}

// 깃허브 액션에 영상 생성을 시킨다. 실패하면 Error를 던진다.
async function genStart(row, segRows, version) {
  const segments = genBuildSegments(segRows);
  const vs = row.video_settings || {};
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
    transition: vs.transition,
    tts_voice: vs.tts_voice,
    tts_rate: vs.tts_rate,
    tts_pitch: vs.tts_pitch,
  };
  const res = await fetch("/api/trigger-generation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scriptId: row.id, scriptContent: genToMarkdown(row, segRows), segments, settings, channel: "wicked-wiki", version }),
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

function genToast(text, ok) {
  let box = document.getElementById("genToast");
  if (!box) {
    box = document.createElement("div");
    box.id = "genToast";
    box.style.cssText = "position:fixed;left:12px;right:12px;bottom:14px;z-index:60;max-width:436px;margin:0 auto;padding:12px 14px;border-radius:6px;font-size:0.9rem;font-weight:700;display:flex;gap:10px;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,0.5);";
    document.body.appendChild(box);
  }
  box.style.background = ok ? "#7cff4a" : "#ff8a80";
  box.style.color = "#0f0a14";
  box.innerHTML = "";
  const span = document.createElement("span");
  span.style.flex = "1";
  span.textContent = text;
  box.appendChild(span);
  if (ok) {
    const a = document.createElement("a");
    a.href = "/youtube/review.html";
    a.textContent = "Studio 열기";
    a.style.cssText = "color:#0f0a14;text-decoration:underline;white-space:nowrap;";
    box.appendChild(a);
  }
  const x = document.createElement("button");
  x.type = "button";
  x.textContent = "×";
  x.style.cssText = "width:auto;padding:0 6px;margin:0;background:none;color:#0f0a14;font-size:1.2rem;";
  x.addEventListener("click", () => box.remove());
  box.appendChild(x);
}

async function genNotify(name, ok) {
  const title = ok ? "영상이 완성되었습니다" : "영상 생성에 실패했습니다";
  genToast(`${title} — ${name}`, ok);
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      const opts = { body: name + (ok ? " · Studio에서 확인하세요" : " · Studio에서 상태를 확인하세요"), icon: "/icon-192.png", data: { url: "/youtube/review.html" } };
      const reg = navigator.serviceWorker ? await navigator.serviceWorker.ready : null;
      if (reg && reg.showNotification) reg.showNotification(title, opts);
      else new Notification(title, opts);
    }
  } catch { /* 기기 알림이 안 되면 화면 알림창만 */ }
}
