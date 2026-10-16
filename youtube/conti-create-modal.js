// "콘티 만들기" 팝업 — Trend와 Scenes가 같이 쓴다. /config.js, generate.js, conti-core.js, conti-job.js 다음에 불러온다.
//  · 주제 + Search(구글 뉴스 /api/news-search, 최대 5건, 처음엔 전부 체크) + 분위기·방향 메모·채널 카드
//  · 콘티 생성: 체크한 기사가 있으면 → 서버 작업(ContiJob: 빈 행 → create-conti → Gemini가 대본·장면·기사 사진)
//               기사가 하나도 없으면 → Gemini 없이 빈 장면 5개 + 채널 카드 장면짜리 콘티를 바로 만든다
// 사용: ContiCreateModal.open({ topic, articles, traffic, geo, getDefaults, onOpenConti(id), onCreated(id, kind) })
//   getDefaults()  (선택) 새 콘티의 기본 설정을 돌려주는 async 함수. 없으면 youtube_default_settings·이 기기 복사본을 직접 읽는다
//   onOpenConti(id) (선택) "열기"를 누를 때 (Scenes는 그 자리에서 연다). 없으면 Scenes 주소로 이동
//   onCreated(id, kind) (선택) 콘티 행이 생긴 뒤 (kind: "job" | "empty")
const ContiCreateModal = (() => {
  const SB = POLOS_CONFIG.SUPABASE_URL, KEY = POLOS_CONFIG.SUPABASE_ANON_KEY;
  const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const JH = { ...H, "Content-Type": "application/json" };
  const MAX_ARTICLES = 5;
  const EMPTY_SCENES = 5;
  const SUB_SECTION = "구독/좋아요";
  // 기사로 만들 때 gemini-draft가 넣는 구독 안내 장면과 같은 기본값 (채널 카드를 못 읽었을 때)
  const SUBSCRIBE_TEXT = "내 알고리즘 밖의 이야기가 궁금하다면 구독 좋아요 해주시면 나도 좋아요";
  const SUBSCRIBE_KEYWORD = "sexy witch";
  const SUBSCRIBE_DIRECTION = "천천히 줌인";
  // storyboard.html의 MOODS와 같은 목록
  const MOODS = [
    { id: "neutral", label: "기본" }, { id: "mystery", label: "어둡고 미스터리" },
    { id: "bright", label: "밝고 경쾌" }, { id: "calm", label: "차분한 다큐" },
  ];
  const DEFAULTS_LS_KEY = "polos_youtube_default_settings";   // storyboard.html과 같은 키
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const safeUrl = (u) => (/^https?:\/\//.test(String(u || "")) ? u : "#");

  let el = null, opts = {}, cands = [], traffic = "", geo = "", cards = [], channelSlot = null, cardsLoaded = null, busy = false;
  const $ = (id) => el.querySelector("#" + id);

  function addStyle() {
    const st = document.createElement("style");
    st.textContent = `
      .ccm-ov { position:fixed; inset:0; z-index:60; background:rgba(0,0,0,0.8); display:flex; align-items:flex-start; justify-content:center; padding:16px; overflow:auto; }
      .ccm-box { width:100%; max-width:480px; margin:auto 0; background:var(--card,#141414); color:var(--text,#fff); border:1px solid var(--line-strong,#333); border-radius:6px; padding:16px; box-sizing:border-box; }
      .ccm-head { display:flex; justify-content:space-between; align-items:center; gap:10px; }
      .ccm-head h2 { margin:0; font-size:1.15rem; }
      .ccm-x { width:auto; padding:4px 10px; font-size:1rem; margin:0; }
      .ccm-row { display:flex; gap:8px; }
      .ccm-row input { flex:1; min-width:0; }
      .ccm-row button { width:auto; flex-shrink:0; padding:0 16px; margin:0; }
      .ccm-hint { font-size:0.75rem; font-weight:400; color:var(--muted,#9a9a9a); line-height:1.45; margin-top:6px; }
      .ccm-list { margin:6px 0 0; padding:0; list-style:none; }
      .ccm-list li { display:flex; gap:8px; align-items:flex-start; padding:8px 0; border-top:1px solid var(--line,#2a2a2a); }
      .ccm-list li:first-child { border-top:none; }
      .ccm-list input[type=checkbox] { width:18px; height:18px; flex-shrink:0; margin:2px 0 0; padding:0; accent-color:var(--accent,#4fc3f7); }
      .ccm-list label { margin:0; color:var(--text-2,#d0d0d0); font-size:0.84rem; font-weight:400; line-height:1.4; overflow-wrap:anywhere; cursor:pointer; flex:1; }
      .ccm-list .src { color:var(--muted,#9a9a9a); font-size:0.75rem; display:block; margin-top:2px; }
      .ccm-list .src a { color:var(--muted,#9a9a9a); }
      .ccm-empty { color:var(--muted,#9a9a9a); font-size:0.8rem; padding:6px 0; }
      .ccm-count { font-size:0.8rem; color:var(--accent,#4fc3f7); margin-top:12px; }
      #ccmCreate { margin-top:10px; }
      .ccm-msg a { color:var(--accent,#4fc3f7); font-weight:700; }
    `;
    document.head.appendChild(st);
  }

  function build() {
    addStyle();
    el = document.createElement("div");
    el.className = "ccm-ov";
    el.id = "contiCreateModal";
    el.style.display = "none";
    el.innerHTML = `<div class="ccm-box" role="dialog" aria-modal="true" aria-labelledby="ccmTitle">
      <div class="ccm-head"><h2 id="ccmTitle">콘티 만들기</h2><button type="button" class="ccm-x" id="ccmClose" aria-label="닫기">×</button></div>
      <label for="ccmTopic">주제</label>
      <div class="ccm-row">
        <input type="text" id="ccmTopic" maxlength="100" placeholder="예: 태풍 경로, 신작 게임 출시">
        <button type="button" id="ccmSearch">Search</button>
      </div>
      <div class="ccm-hint">Search를 누르면 이 주제의 최근 뉴스 기사를 찾아요 (최대 ${MAX_ARTICLES}건).</div>
      <label>참고 기사</label>
      <ul class="ccm-list" id="ccmList"></ul>
      <label for="ccmMood">분위기</label>
      <select id="ccmMood"><option value="">자동 (Gemini가 판단)</option>${MOODS.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join("")}</select>
      <label for="ccmNote">방향 메모 (선택)</label>
      <input type="text" id="ccmNote" maxlength="300" placeholder="예: 경제 영향 위주로 / 찬반 입장 균형 있게">
      <label for="ccmCard">채널 카드</label>
      <select id="ccmCard"><option value="">불러오는 중...</option></select>
      <div class="ccm-hint" id="ccmCardHint"></div>
      <div class="ccm-count" id="ccmCount"></div>
      <button type="button" id="ccmCreate">콘티 생성</button>
      <div class="msg ccm-msg" id="ccmMsg"></div>
    </div>`;
    document.body.appendChild(el);
    $("ccmClose").addEventListener("click", close);
    el.addEventListener("click", (e) => { if (e.target === el && !busy) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && el.style.display !== "none" && !busy) close(); });
    $("ccmSearch").addEventListener("click", search);
    $("ccmTopic").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });
    $("ccmList").addEventListener("change", updateCount);
    $("ccmCreate").addEventListener("click", create);
  }

  function showMsg(html, ok) {
    const m = $("ccmMsg");
    m.className = "msg ccm-msg " + (ok ? "ok" : "err");
    m.innerHTML = html;
  }
  function clearMsg() { const m = $("ccmMsg"); m.className = "msg ccm-msg"; m.innerHTML = ""; }

  function dateText(s) {
    const t = Date.parse(s || "");
    if (!t) return "";
    const d = new Date(t);
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  }

  function renderList() {
    const box = $("ccmList");
    if (!cands.length) {
      box.innerHTML = '<li class="ccm-empty">아직 고른 기사가 없어요.</li>';
    } else {
      box.innerHTML = cands.map((a, i) => `<li>
        <input type="checkbox" id="ccmA${i}" data-i="${i}"${a.checked ? " checked" : ""}>
        <label for="ccmA${i}">${esc(a.title)}<span class="src">${esc([a.source, dateText(a.date)].filter(Boolean).join(" · "))}${a.url ? ` · <a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener">기사 ↗</a>` : ""}</span></label>
      </li>`).join("");
    }
    updateCount();
  }

  function selected() {
    return [...$("ccmList").querySelectorAll("input[type=checkbox]")].filter((c) => c.checked).map((c) => cands[Number(c.dataset.i)]).filter(Boolean);
  }
  function updateCount() {
    const n = selected().length;
    $("ccmCount").textContent = n
      ? `체크한 기사 ${n}건으로 Gemini가 대본과 장면을 써요 (사진은 기사에서 가져와요).`
      : `기사 없이 만들면 Gemini 없이 빈 장면 ${EMPTY_SCENES}개짜리 콘티가 돼요. 대본은 직접 써요.`;
  }

  async function search() {
    const q = $("ccmTopic").value.trim();
    if (!q) { showMsg("주제를 입력하세요.", false); return; }
    const btn = $("ccmSearch");
    btn.disabled = true; btn.textContent = "찾는 중…";
    clearMsg();
    try {
      const res = await fetch("/api/news-search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q }) });
      let data = null;
      try { data = await res.json(); } catch { /* JSON 아님 */ }
      if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
      const items = (data.items || []).slice(0, MAX_ARTICLES);
      cands = items.map((a) => ({ title: a.title, url: a.url, source: a.source || "", date: a.date || "", checked: true }));
      renderList();
      if (!items.length) showMsg("기사를 찾지 못했어요. 다른 말로 찾아보거나, 그대로 콘티 생성을 누르면 빈 콘티를 만들어요.", false);
    } catch (err) {
      showMsg("기사를 찾지 못했어요: " + esc(err.message), false);
    } finally {
      btn.disabled = false; btn.textContent = "Search";
    }
  }

  // 트렌드 채널(youtube_channels.source = trend)의 채널 카드 — 한 번만 읽는다
  function loadCards() {
    if (cardsLoaded) return cardsLoaded;
    cardsLoaded = (async () => {
      const sel = $("ccmCard"), hint = $("ccmCardHint");
      try {
        const chRes = await fetch(`${SB}/rest/v1/youtube_channels?select=slot,label&source=eq.trend&order=sort_order.asc,slot.asc&limit=1`, { headers: H });
        if (!chRes.ok) throw new Error("채널 표를 읽지 못함");
        const ch = (await chRes.json())[0];
        if (!ch) throw new Error("트렌드 채널이 정해지지 않음");
        channelSlot = ch.slot;
        const res = await fetch(`${SB}/rest/v1/youtube_subscribe_cards?select=*&channel_slot=eq.${ch.slot}&order=sort_order.asc,id.asc`, { headers: H });
        if (!res.ok) throw new Error("구독 카드 표를 읽지 못함");
        cards = (await res.json()).map((c) => ({ ...c, image_paths: Array.isArray(c.image_paths) ? c.image_paths : [] }));
        if (!cards.length) throw new Error(`${ch.label} 채널에 채널 카드가 없음`);
        sel.innerHTML = cards.map((c) => `<option value="${c.id}"${c.is_default ? " selected" : ""}>${esc(c.name)}${c.is_default ? " (기본)" : ""} · ${mediaText(c.image_paths)}</option>`).join("");
        hint.textContent = `${ch.label} 채널의 카드예요. 카드 문구·사진·영상은 채널 화면에서 고쳐요.`;
      } catch (err) {
        cards = [];
        sel.innerHTML = '<option value="">기본 문구 (카드를 못 읽음)</option>';
        hint.textContent = `채널 카드를 불러오지 못해 기본 문구를 써요 (${err.message}).`;
      }
    })();
    return cardsLoaded;
  }
  function mediaText(paths) {
    const list = paths || [];
    if (!list.length) return "소재 없음";
    const v = list.filter((p) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(String(p))).length, ph = list.length - v;
    return [ph ? `사진 ${ph}장` : "", v ? `영상 ${v}개` : ""].filter(Boolean).join(" · ");
  }

  // 새 콘티의 기본 설정 (Scenes의 "기본값으로 저장" 값)
  async function defaults() {
    if (opts.getDefaults) { try { return (await opts.getDefaults()) || null; } catch { return null; } }
    let remote = null, local = null;
    try {
      const res = await fetch(`${SB}/rest/v1/youtube_default_settings?select=settings&id=eq.1`, { headers: H });
      if (res.ok) { const rows = await res.json(); remote = rows[0] ? rows[0].settings : null; }
    } catch { /* 이 기기 복사본으로 */ }
    try { local = JSON.parse(localStorage.getItem(DEFAULTS_LS_KEY)); } catch { /* 없음 */ }
    return remote && Object.keys(remote).length ? remote : local;
  }
  // storyboard.html createDraft와 같은 규칙: 기본값의 자막 위치가 framed 기준이면 framed로 만든다
  function baseSettings(d) {
    return { ...(d || {}), ...(d && d.caption_position_pct != null && d.layout !== "full" ? { layout: "framed" } : {}) };
  }

  // 채널 카드 소재 한 개: 그 카드로 이 콘티보다 먼저 만든 콘티 수 기준으로 돌아가며 (ContiCore와 같은 규칙)
  async function pickCardMedia(card, beforeId) {
    const list = card.image_paths || [];
    if (!list.length) return [];
    let n = Math.floor(Math.random() * list.length);
    try {
      const r = await fetch(`${SB}/rest/v1/youtube_scripts?select=id&video_settings->>subscribe_card_id=eq.${card.id}&id=lt.${beforeId}`, { headers: H });
      if (r.ok) n = (await r.json()).length;
    } catch { /* 무작위 */ }
    return [list[n % list.length]];
  }

  const slugOf = (topic) => `${new Date().toISOString().slice(0, 10)}_${topic.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 20)}`;

  // 기사 없이: Gemini 없이 빈 장면 5개 + 채널 카드(구독/좋아요) 장면
  async function createEmpty(name, card, settings, mood) {
    const r = await fetch(`${SB}/rest/v1/youtube_scripts`, {
      method: "POST", headers: { ...JH, Prefer: "return=representation" },
      body: JSON.stringify({
        category: "뉴스/이슈", hook: "", story: "", closing: "", fact_sources: "", status: "approved", slug: slugOf(name),
        video_settings: { ...settings, ...(mood ? { mood } : {}), name: name.slice(0, 40) },
      }),
    });
    if (!r.ok) throw new Error("콘티를 만들지 못했어요: " + (await r.text()).slice(0, 200));
    const row = (await r.json())[0];
    const photo = card ? await pickCardMedia(card, row.id) : [];
    // 여러 행을 한 번에 넣을 땐 모든 행의 칸 이름이 같아야 한다 (PGRST102) — 모든 칸을 채운다
    const rows = [];
    for (let i = 0; i < EMPTY_SCENES; i++) rows.push({ script_id: row.id, order_no: i + 1, section: "", script_text: "", keyword: "", direction: "", asset_paths: [] });
    rows.push({
      script_id: row.id, order_no: EMPTY_SCENES + 1, section: SUB_SECTION,
      script_text: (card && card.script_text) || SUBSCRIBE_TEXT, keyword: SUBSCRIBE_KEYWORD,
      direction: (card && card.direction) || SUBSCRIBE_DIRECTION, asset_paths: photo,
    });
    const s = await fetch(`${SB}/rest/v1/youtube_segments`, { method: "POST", headers: JH, body: JSON.stringify(rows) });
    if (!s.ok) {
      const t = await s.text();
      fetch(`${SB}/rest/v1/youtube_scripts?id=eq.${row.id}`, { method: "DELETE", headers: H }).catch(() => {});   // 장면 없는 콘티는 남기지 않는다
      throw new Error("장면을 만들지 못했어요: " + t.slice(0, 200));
    }
    return row;
  }

  async function create() {
    if (busy) return;
    const topic = $("ccmTopic").value.trim();
    const articles = selected().map((a) => ({ title: a.title, url: a.url, source: a.source }));
    if (!topic && articles.length) { showMsg("주제를 입력하세요.", false); return; }
    const name = topic || "새 콘티";
    await loadCards();
    const card = cards.find((c) => String(c.id) === $("ccmCard").value) || null;
    const mood = $("ccmMood").value;
    const btn = $("ccmCreate");
    busy = true; btn.disabled = true; btn.textContent = "콘티 만들기를 시작하는 중...";
    clearMsg();
    try {
      // 구독 카드와 채널: 카드를 골랐으면 그 카드의 채널, 못 읽었으면 트렌드 채널만 (업로드 기본 채널로 쓴다)
      const cardSettings = card ? { subscribe_card_id: card.id, channel_slot: card.channel_slot } : (channelSlot != null ? { channel_slot: channelSlot } : {});
      const settings = { ...baseSettings(await defaults()), ...cardSettings };
      if (!articles.length) {
        const row = await createEmpty(name, card, settings, mood);
        if (opts.onCreated) { try { await opts.onCreated(row.id, "empty"); } catch { /* 무시 */ } }
        if (opts.onOpenConti) { close(); opts.onOpenConti(row.id); return; }
        showMsg(`빈 콘티 "${esc(name)}"를 만들었어요 (장면 ${EMPTY_SCENES}개). <a href="${contiJobUrl(row.id)}">Scenes에서 열기 →</a>`, true);
        return;
      }
      const row = await ContiJob.createPlaceholder({
        category: "뉴스/이슈", name, slug: slugOf(name), video_settings: settings,
        request: {
          kind: "news", topic, articles, note: $("ccmNote").value.trim(), traffic, geo,
          mood,   // 직접 고른 분위기가 Gemini 판단보다 우선 (""이면 Gemini 값)
          card_id: card ? card.id : null, channel_slot: card ? card.channel_slot : channelSlot,
        },
      });
      close();
      if (opts.onCreated) { try { await opts.onCreated(row.id, "job"); } catch { /* 무시 */ } }
      const after = opts.onAfterJob;
      ContiJob.launch([{ id: row.id, name }], opts.onOpenConti ? { onOpen: (id) => opts.onOpenConti(id) } : {}).then(() => { if (after) after(); });
    } catch (err) {
      showMsg("생성 실패: " + esc(err.message), false);
    } finally {
      busy = false; btn.disabled = false; btn.textContent = "콘티 생성";
    }
  }

  // o: { topic, articles, traffic, geo, getDefaults, onOpenConti, onCreated, onAfterJob }
  function open(o) {
    if (!el) build();
    opts = o || {};
    traffic = opts.traffic || "";
    geo = opts.geo || "";
    cands = (opts.articles || []).filter((a) => a && a.title).slice(0, MAX_ARTICLES)
      .map((a) => ({ title: a.title, url: a.url || "", source: a.source || "", date: a.date || "", checked: true }));
    $("ccmTopic").value = opts.topic || "";
    $("ccmNote").value = "";
    $("ccmMood").value = "";
    clearMsg();
    renderList();
    el.style.display = "";
    document.body.style.overflow = "hidden";
    loadCards();
    if (!opts.topic) setTimeout(() => $("ccmTopic").focus(), 0);
  }
  function close() {
    if (!el) return;
    el.style.display = "none";
    document.body.style.overflow = "";
  }

  return { open, close };
})();
