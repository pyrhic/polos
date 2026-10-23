// storyboard/05-settings.js — 개요 박스, 전체 설정 카드, 부분별 설정 저장, 요약 줄 바로 고치기(휠), 채널 카드 목소리, 기본값
// storyboard.html에서 순서 그대로 잘라낸 파일. 일반 <script>로 차례대로 불러오므로 앞 파일의 전역(let/const/function)을 그대로 쓴다.
  // ───── 개요 박스: 전체 길이 + 구성(묶음 머리글과 같은 묶음) ─────
  function fmtDur(secs) {
    const r = Math.round(secs);
    return r < 60 ? `${r}초` : `${Math.floor(r / 60)}분` + (r % 60 ? ` ${r % 60}초` : "");
  }
  let ovRuns = [];
  function updateOverview(runs, total) {
    ovRuns = runs;
    $("ovTotal").textContent = `약 ${fmtDur(total)}`;
    // "이름 00초", 구독/좋아요 묶음은 "채널 카드"
    $("ovParts").innerHTML = runs.length ? runs.map((r, i) => {
      const label = r.part === SUBSCRIBE_PART ? "채널 카드"
        : `${r.part} ${fmtDur(r.secs)}`;
      return `<button type="button" class="tok" data-run="${i}">${escapeHtml(label)}</button>`;
    }).join(' <span class="ov-sep">/</span> ') : "-";
  }

  // ───── 전체 설정 카드 (자막 크기 / 배경음악 / 분위기 / 화면 전환) ─────
  const MOODS = [
    { id: "neutral", label: "기본", desc: "" },
    { id: "mystery", label: "어둡고 미스터리", desc: "어둡고 긴장감 있는 미스터리 분위기" },
    { id: "bright", label: "밝고 경쾌", desc: "밝고 경쾌한 분위기" },
    { id: "calm", label: "차분한 다큐", desc: "차분하고 담담한 다큐멘터리 분위기" },
  ];
  const DEFAULT_SETTINGS = {
    caption_font_size: 80, bgm_path: null, bgm_volume: 0.15, mood: "neutral", transition: "cut",
    tts_voice: "ko-KR-InJoonNeural", tts_rate: -3, tts_pitch: -5, name: "",
    caption_weight: 0, caption_position_pct: 7,
    layout: "framed", title1: "", title2: "", source_text: "",
  };
  // 이 콘티 화면(뉴스·위키 등)에서 만드는 영상은 늘 "제목 + 영상 + 출처"(framed). Pexels 슬라이드쇼(pexels-edit.html)는 따로라 영향 없음
  // 폰트 두께 단계 (영상 쪽 02_tts.py의 WEIGHT_FONTS와 같은 순서)
  const WEIGHTS = [
    { label: "가늘게", family: "'IBM Plex Sans KR'", weight: 300 },
    { label: "보통", family: "'IBM Plex Sans KR'", weight: 400 },
    { label: "중간", family: "'IBM Plex Sans KR'", weight: 500 },
    { label: "굵게", family: "'IBM Plex Sans KR'", weight: 700 },
    { label: "아주 굵게", family: "'Black Han Sans'", weight: 400 },
  ];
  const VOICES = GEN_VOICES;   // 성우 목록은 generate.js (채널 화면 카드 목소리와 같은 목록)
  let currentSettings = { ...DEFAULT_SETTINGS };
  let savedBgmPath = null;
  const $ = (id) => document.getElementById(id);

  // ───── 설정 저장: 부분(카드)별로 따로 ─────
  // main = 첫 카드(제목·출처·분위기·메모), sound = 음향 카드, cap = 미리보기 자막 조작(자동 저장), name = 카드 머리 이름(바로 저장).
  // 저장할 때는 마지막으로 저장된 video_settings 위에 그 부분의 키만 덮어쓴다(다른 카드의 아직 저장 안 한 값은 섞이지 않는다).
  const PART_KEYS = {
    main: ["title1", "title2", "source_text"],   // 분위기 메모(mood_note)는 화면에서 없앴다. 예전 값은 저장된 그대로 둔다
    mood: ["mood"],   // 개요 박스의 분위기: 고르면 바로(잠깐 모아서) 이 키만 저장
    sound: ["tts_voice", "tts_rate", "tts_pitch", "bgm_path", "bgm_volume"],
    cap: ["caption_font_size", "caption_weight", "caption_position_pct"],
    name: ["name"],
    card: ["subscribe_card_id", "channel_slot"],   // 채널 카드 불러오기: 고른 카드와 그 채널만
    voice: ["tts_voice", "tts_rate", "tts_pitch", "voice_name", "voice_sync"],   // 채널 카드 목소리 동기화(켜기·끄기·카드 목소리 반영): 바로 저장
    autoup: ["auto_upload"],   // 영상 생성 버튼 아래 "생성되면 자동으로 비공개 업로드": 바로 저장
  };
  const PART_BTN = { main: "settingsSaveBtn", sound: "soundSaveBtn" };
  const dirtyParts = new Set();
  const savingParts = new Set();
  const partEdits = { main: 0, sound: 0, cap: 0, name: 0, mood: 0, card: 0, voice: 0, autoup: 0 };   // 저장하는 동안 또 고쳤는지 알기 위한 수정 횟수
  const justSavedParts = new Set();
  let saveChain = Promise.resolve();   // 저장은 하나씩 차례로(앞 저장 결과 위에 다음 저장을 덮어쓰도록)

  // 두 카드 중 하나라도 저장 안 됐으면 true. 장면 카드는 카드에서 빠져나오면 자동 저장된다
  function hasDirty() {
    return dirtyParts.has("main") || dirtyParts.has("sound");
  }
  // 자막 조작은 잠시 뒤 자동 저장된다. 그 전에 나가거나 영상을 만들면 바로 저장한다
  // 분위기도 고르면 자동 저장이라 같은 취급(나가기·영상 생성 전에 바로 저장)
  function capPending() { return dirtyParts.has("cap") || dirtyParts.has("mood"); }
  function flushCapSave() {
    clearTimeout(capSaveTimer);
    clearTimeout(moodSaveTimer);
    if (dirtyParts.has("cap")) savePart("cap");
    if (dirtyParts.has("mood")) savePart("mood");
    return saveChain;
  }
  function cardsDirty() {
    return !!document.querySelector(".seg-item[data-dirty]");
  }
  // 아직 저장 안 된 장면 카드를 모두 저장한다
  function flushDirtyCards() {
    const saves = Array.from(document.querySelectorAll(".seg-item[data-dirty]")).map((el) => saveSegmentCard(el.dataset.id, el));
    return Promise.all(saves);
  }

  function markPartDirty(part) {
    dirtyParts.add(part);
    partEdits[part]++;
    justSavedParts.delete(part);
    updateSettingsSummary();
  }

  // ───── 요약 줄에서 바로 고치기 ─────
  // 실제 값은 화면 밖 입력들(#settingsBody)이 들고 있고, 요약 줄은 그 값을 읽어 보여 주고 바꿀 때 같은 이벤트를 쏜다.
  function range(a, b, step) { const o = []; for (let n = a; n <= b; n += step) o.push(n); return o; }
  const WHEELS = {
    voice: { ctl: "voiceSel", opts: () => VOICES.map((v) => [v.id, v.label.replace(/ — .*/, "")]) },
    rate: { ctl: "ttsRate", opts: () => range(-30, 30, 1).map((n) => [String(n), `속도 ${n > 0 ? "+" : ""}${n}%`]) },
    pitch: { ctl: "ttsPitch", opts: () => range(-20, 20, 1).map((n) => [String(n), `높낮이 ${n > 0 ? "+" : ""}${n}Hz`]) },
    bgmVol: { ctl: "bgmVol", opts: () => range(0, 100, 5).map((n) => [String(n), `볼륨 ${n}%`]) },
    mood: { ctl: "moodSel", opts: () => MOODS.map((m) => [m.id, m.label]) },
  };

  function fireCtl(el) {
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  }

  let openWheel = null; // { key, tok, wrap }
  function closeWheel() {
    if (!openWheel) return;
    openWheel.wrap.remove();
    openWheel = null;
    $("pickModal").classList.remove("open");
  }
  const WHEEL_TITLES = { voice: "목소리", rate: "말하기 속도", pitch: "목소리 높낮이", bgmVol: "배경음악 볼륨", mood: "영상 분위기" };
  function openWheelFor(tok) {
    const key = tok.dataset.wheel;
    closeWheel();
    const cfg = WHEELS[key];
    const ctl = $(cfg.ctl);
    const opts = cfg.opts();
    // 숫자 목록은 현재 값에 가장 가까운 칸, 문자 목록은 같은 값의 칸을 고른다
    const numeric = !Number.isNaN(Number(ctl.value)) && ctl.value !== "";
    let idx = numeric
      ? opts.reduce((best, o, i) => Math.abs(Number(o[0]) - Number(ctl.value)) < Math.abs(Number(opts[best][0]) - Number(ctl.value)) ? i : best, 0)
      : opts.findIndex((o) => o[0] === ctl.value);
    if (idx < 0) idx = 0;
    const wrap = document.createElement("div");
    wrap.className = "wheel-wrap";
    wrap.innerHTML = `<div class="wheel">${opts.map((o, i) => `<div class="wheel-item" data-i="${i}">${escapeHtml(o[1])}</div>`).join("")}</div><div class="wheel-band"></div>`;
    $("pickHost").appendChild(wrap);
    $("pickTitle").textContent = WHEEL_TITLES[key] || "";
    openWheel = { key, tok, wrap };
    $("pickModal").classList.add("open"); // 보이게 한 뒤에 스크롤 위치를 맞춘다
    const wheel = wrap.querySelector(".wheel");
    const mark = (i) => wheel.querySelectorAll(".wheel-item").forEach((el, n) => el.classList.toggle("sel", n === i));
    mark(idx);
    wheel.scrollTop = idx * 44;
    let timer = null, lastIdx = idx;
    wheel.addEventListener("scroll", () => {
      const i = Math.max(0, Math.min(opts.length - 1, Math.round(wheel.scrollTop / 44)));
      mark(i);
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (i === lastIdx) return;
        lastIdx = i;
        ctl.value = opts[i][0];
        fireCtl(ctl);
      }, 90);
    });
    wheel.addEventListener("click", (e) => {
      const it = e.target.closest(".wheel-item");
      if (!it) return;
      const i = Number(it.dataset.i);
      if (i === Math.round(wheel.scrollTop / 44)) { closeWheel(); return; } // 가운데 칸을 다시 누르면 닫기
      wheel.scrollTo({ top: i * 44, behavior: "smooth" });
    });
  }

  let bgmPlayer = null;
  function stopBgmPlayer() { if (bgmPlayer) { bgmPlayer.pause(); bgmPlayer = null; } }

  function updateSettingsSummary() {
    const mirror = (srId, ctlId) => { const el = $(srId); if (document.activeElement !== el) el.value = $(ctlId).value; };
    mirror("srT1", "title1"); mirror("srT2", "title2"); mirror("srSrc", "sourceText");
    const label = (key) => {
      const cfg = WHEELS[key], v = $(cfg.ctl).value;
      const hit = cfg.opts().find((o) => o[0] === v);
      return hit ? hit[1] : v;
    };
    $("contiName").textContent = contiDisplayName();
    $("tokVoice").textContent = label("voice");
    const r = Number($("ttsRate").value), p = Number($("ttsPitch").value);
    $("tokRate").textContent = `속도 ${r > 0 ? "+" : ""}${r}%`;
    $("tokPitch").textContent = `높낮이 ${p > 0 ? "+" : ""}${p}Hz`;
    // 채널 카드 목소리와 동기화 중이면 이름으로(읽기 전용), 아니면 고칠 수 있는 성우·속도·높낮이
    const synced = !!(currentSettings.voice_sync && currentSettings.voice_name);
    $("tokVoiceName").style.display = synced ? "" : "none";
    $("voiceTokens").style.display = synced ? "none" : "";
    if (synced) $("tokVoiceName").textContent = genVoiceLabel(currentSettings.voice_name, currentSettings.tts_voice, currentSettings.tts_rate, currentSettings.tts_pitch);
    const cv = contiCardVoice();
    $("voiceSyncRow").style.display = cv ? "" : "none";
    $("voiceSyncChk").checked = synced;
    $("voiceSyncChk").parentElement.title = cv ? `카드 목소리: ${genVoiceLabel(cv.name, cv.voice, cv.rate, cv.pitch)}` : "";
    const hasBgm = !!currentSettings.bgm_path;
    $("tokBgm").textContent = hasBgm ? (bgmPlayer && !bgmPlayer.paused ? "■ 정지" : "▶ 듣기") : "+ 음악 올리기";
    $("bgmExtra").style.display = hasBgm ? "inline" : "none";
    $("tokBgmVol").textContent = `볼륨 ${$("bgmVol").value}%`;
    $("tokMood").textContent = label("mood");
    // 카드마다 저장 버튼과 "저장 안 됨" 표시를 따로 보여 준다
    [["main", "settingsDirtyBadge"], ["sound", "soundDirtyBadge"]].forEach(([part, badgeId]) => {
      const btn = $(PART_BTN[part]);
      const dirty = dirtyParts.has(part), saving = savingParts.has(part);
      btn.classList.toggle("dirty", dirty);
      btn.disabled = saving;
      btn.textContent = saving ? "저장 중..." : "저장";
      btn.style.display = dirty || saving ? "inline" : "none";
      // 저장할 게 없으면 버튼 줄 자체를 숨겨 카드 아래 빈 공간이 생기지 않게 한다
      btn.parentElement.style.display = btn.style.display === "none" ? "none" : "flex";
      const badgeText = dirty ? "저장 안 됨" : (justSavedParts.has(part) ? "저장됨 ✓" : "");
      const badge = $(badgeId);
      badge.textContent = badgeText;
      badge.style.display = badgeText ? "inline-block" : "none";
    });
    $("soundHead").classList.toggle("show", $("soundDirtyBadge").style.display !== "none");
    $("settingsHead").classList.toggle("show", $("settingsDirtyBadge").style.display !== "none");
  }

  // 카드 머리에 보이는 이름: 정한 이름, 없으면 대본 후킹 앞부분
  function contiDisplayName() {
    const row = scripts.find((r) => String(r.id) === String($("scriptSelect").value));
    return currentSettings.name || (row ? (row.hook || "").slice(0, 20) : "") || "(이름 없음)";
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeWheel(); });

  document.querySelectorAll(".tok[data-wheel]").forEach((t) => t.addEventListener("click", () => openWheelFor(t)));
  $("tokBgm").addEventListener("click", () => {
    if (!currentSettings.bgm_path) { $("bgmFile").click(); return; }
    if (bgmPlayer && !bgmPlayer.paused) { stopBgmPlayer(); updateSettingsSummary(); return; }
    bgmPlayer = new Audio(assetUrl(currentSettings.bgm_path));
    bgmPlayer.addEventListener("ended", () => { stopBgmPlayer(); updateSettingsSummary(); });
    bgmPlayer.play().then(updateSettingsSummary).catch(() => showMsg("음악을 재생할 수 없습니다.", false));
  });
  $("tokBgmUp").addEventListener("click", () => $("bgmFile").click());
  $("tokBgmDel").addEventListener("click", () => {
    stopBgmPlayer();
    currentSettings.bgm_path = null;
    renderBgm();
    markPartDirty("sound");
  });
  [["srT1", "title1"], ["srT2", "title2"], ["srSrc", "sourceText"]].forEach(([sr, ctl]) => {
    $(sr).addEventListener("input", () => { $(ctl).value = $(sr).value; fireCtl($(ctl)); });
  });
  $("pickClose").addEventListener("click", closeWheel);
  $("pickModal").addEventListener("click", (e) => { if (e.target === $("pickModal")) closeWheel(); });

  function updateSettingsPreview() {
    pvSyncAll();   // 장면 카드의 미리보기에도 화면 구성·제목·자막 모양을 반영
  }

  function renderBgm() {
    const row = $("bgmRow");
    const p = currentSettings.bgm_path;
    if (!p) { row.innerHTML = '<span class="settings-note" style="margin:0;">배경음악 없음</span>'; return; }
    row.innerHTML = `<audio controls preload="none" src="${assetUrl(p)}"></audio>
      <button type="button" id="bgmRemove" style="background:var(--danger-bg);color:var(--danger);">삭제</button>`;
    $("bgmRemove").addEventListener("click", () => {
      currentSettings.bgm_path = null;
      renderBgm();
      markPartDirty("sound");
    });
  }

  function loadSettingsCard(scriptId) {
    const card = $("settingsCard");
    const row = scripts.find((r) => String(r.id) === String(scriptId));
    if (!row) { card.style.display = "none"; $("contiNameWrap").style.display = "none"; $("soundCard").style.display = "none"; $("overviewCard").style.display = "none"; return; }
    currentSettings = { ...DEFAULT_SETTINGS, ...(row.video_settings || {}) };
    savedBgmPath = currentSettings.bgm_path || null;
    // 이름을 따로 안 정했으면 카드 머리에는 대본 후킹 앞부분을 보여 준다(contiDisplayName). 저장값은 그대로 둔다
    currentSettings.name = currentSettings.name || "";
    // 예전에 "전체 화면"(full)으로 저장됐거나 layout이 없는 콘티는 framed로 바꾼다. 자막 위치는 예전 화면 구성 전환 규칙 그대로
    // (전체 화면 기본 위치 7 → 영상 영역 아래쪽 안 22). 바뀐 값(layout + 자막 키)은 자막 자동 저장으로 바로 저장한다
    const needFramed = (row.video_settings || {}).layout !== "framed";
    currentSettings.layout = "framed";
    if (needFramed && Number(currentSettings.caption_position_pct) === 7) currentSettings.caption_position_pct = 22;
    dirtyParts.clear(); justSavedParts.clear();
    $("contiNameInput").style.display = "none"; $("contiName").style.display = "";
    $("capSize").value = currentSettings.caption_font_size;
    $("title1").value = currentSettings.title1 || "";
    $("title2").value = currentSettings.title2 || "";
    $("sourceText").value = currentSettings.source_text || "";
    $("capWeight").value = currentSettings.caption_weight;
    $("capPos").value = currentSettings.caption_position_pct;
    $("bgmVol").value = Math.round(currentSettings.bgm_volume * 100);
    $("bgmVolVal").textContent = $("bgmVol").value + "%";
    $("moodSel").value = currentSettings.mood;
    currentSettings.transition = "cut";   // 화면 전환 설정은 없앴다. 늘 컷 (예전 fade 콘티도 컷)
    $("voiceSel").value = currentSettings.tts_voice;
    $("ttsRate").value = currentSettings.tts_rate;
    $("ttsPitch").value = currentSettings.tts_pitch;
    updateVoiceLabels();
    renderAutoUpload();
    card.style.display = "block";
    $("contiNameWrap").style.display = "block";
    $("soundCard").style.display = "block";
    $("overviewCard").style.display = "block";
    closeWheel();
    stopBgmPlayer();
    renderBgm();
    updateSettingsPreview();
    updateSettingsSummary();
    if (needFramed) { markPartDirty("cap"); capScheduleSave(); }
    loadContiCard(scriptId);
  }

  // ───── 채널 카드 목소리 ─────
  // 카드(youtube_subscribe_cards.voice = { name, voice, rate, pitch })에 이름 붙은 목소리가 있으면 콘티 전체 목소리(tts_voice/rate/pitch)가 그 목소리.
  // voice_sync = true면 콘티를 열 때 카드의 지금 목소리를 다시 읽어 바뀌었으면 반영·저장한다. 끄면 직접 설정(voice_name 비움).
  let contiCard = null;      // 지금 콘티의 채널 카드 (목소리 확인용)
  let contiCardSeq = 0;
  function contiCardVoice() {
    const v = contiCard && contiCard.voice;
    return v && typeof v === "object" && String(v.name || "").trim() && v.voice ? v : null;
  }
  function refreshVoiceControls() {
    $("voiceSel").value = currentSettings.tts_voice;
    $("ttsRate").value = currentSettings.tts_rate;
    $("ttsPitch").value = currentSettings.tts_pitch;
    updateVoiceLabels();
    updateSettingsSummary();
    updateRuntimeSummary();   // 속도가 바뀌면 자막 줄 예상 길이도 바뀐다
  }
  const voiceKeysOf = (o) => JSON.stringify(["tts_voice", "tts_rate", "tts_pitch", "voice_name", "voice_sync"].map((k) => (o[k] === undefined ? null : o[k])));
  // 카드 목소리를 콘티에 반영(없으면 동기화만 끈다). 바뀐 게 있으면 바로 저장
  function applyCardVoice(card) {
    contiCard = card || null;
    const vset = ContiCore.cardVoiceSettings(card, currentSettings);
    if (!Object.keys(vset).length || voiceKeysOf({ ...currentSettings, ...vset }) === voiceKeysOf(currentSettings)) { updateSettingsSummary(); return Promise.resolve(true); }
    Object.assign(currentSettings, vset);
    refreshVoiceControls();
    partEdits.voice++;
    return savePart("voice");
  }
  async function loadContiCard(scriptId) {
    const seq = ++contiCardSeq;
    contiCard = null;
    const id = currentSettings.subscribe_card_id;
    if (id == null || id === "") { updateSettingsSummary(); return; }
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_subscribe_cards?select=*&id=eq.${encodeURIComponent(id)}`, { headers });
      if (!res.ok) return;
      const card = (await res.json())[0] || null;
      if (seq !== contiCardSeq || String($("scriptSelect").value) !== String(scriptId)) return;
      contiCard = card;
      if (!card) { updateSettingsSummary(); return; }
      // 동기화 중이면 카드의 지금 목소리로 (채널 화면에서 바뀌었을 수 있다). 카드 목소리가 없어졌으면 동기화만 끈다.
      // 목소리 칸이 아직 없는 카드(SQL 실행 전)는 건드리지 않는다
      if (currentSettings.voice_sync && Object.prototype.hasOwnProperty.call(card, "voice")) await applyCardVoice(card);
      else updateSettingsSummary();
    } catch { /* 카드를 못 읽으면 저장된 목소리 그대로 */ }
  }
  $("voiceSyncChk").addEventListener("change", () => {
    const cv = contiCardVoice();
    if ($("voiceSyncChk").checked) {
      if (!cv) { $("voiceSyncChk").checked = false; return; }
      applyCardVoice(contiCard);
      return;
    }
    // 끄기: 목소리 값은 그대로 두고 직접 고칠 수 있게
    currentSettings.voice_sync = false;
    currentSettings.voice_name = null;
    refreshVoiceControls();
    partEdits.voice++;
    savePart("voice");
  });

  function updateVoiceLabels() {
    const r = Number($("ttsRate").value), p = Number($("ttsPitch").value);
    $("ttsRateVal").textContent = `${r > 0 ? "+" : ""}${r}%`;
    $("ttsPitchVal").textContent = `${p > 0 ? "+" : ""}${p}Hz`;
  }

  async function uploadBgm(file) {
    const scriptId = $("scriptSelect").value;
    const safeName = file.name.replace(/[^\w.\-]/g, "_");
    const path = `${scriptId}/bgm_${Date.now()}_${safeName}`;
    try {
      const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": file.type || "audio/mpeg" },
        body: file,
      });
      if (!upRes.ok) throw new Error(await upRes.text());
      currentSettings.bgm_path = path;
      renderBgm();
      markPartDirty("sound");
      showMsg("음악을 올렸습니다. '저장'을 눌러야 적용됩니다.", true);
    } catch (err) {
      showMsg("음악 업로드 실패: " + err.message, false);
    }
  }

  // 한 부분(main/sound/cap/name)만 저장한다. 값은 부른 그 순간의 것을 쓰고, 저장은 차례로 해서
  // 늘 "마지막으로 저장된 video_settings + 이 부분의 키"만 PATCH한다. layout은 늘 framed로 같이 쓴다.
  function savePart(part) {
    const scriptId = $("scriptSelect").value;
    const row = scripts.find((r) => String(r.id) === String(scriptId));
    if (!row) return Promise.resolve(false);
    const vals = {};
    PART_KEYS[part].forEach((k) => { vals[k] = currentSettings[k]; });
    const edit = partEdits[part];
    const prevBgm = part === "sound" ? savedBgmPath : null;
    savingParts.add(part);
    updateSettingsSummary();
    const run = saveChain.then(async () => {
      const same = () => String($("scriptSelect").value) === String(scriptId);
      try {
        const next = { ...(row.video_settings || {}), ...vals, layout: "framed" };
        const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_scripts?id=eq.${scriptId}`, {
          method: "PATCH", headers: jsonHeaders,
          body: JSON.stringify({ video_settings: next }),
        });
        if (!res.ok) throw new Error(await res.text());
        row.video_settings = next;
        if (part === "sound") {
          if (prevBgm && prevBgm !== next.bgm_path && !isExternalUrl(prevBgm)) {
            await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${prevBgm}`, { method: "DELETE", headers });
          }
          if (same()) savedBgmPath = next.bgm_path || null;
        }
        if (part === "name") renderScriptList();   // 콘티 목록·선택 칸의 이름도 같이 바뀐다
        if (part === "card" && same()) renderAutoUpload();   // 채널이 바뀌면 자동 업로드 채널 표시도 바뀐다
        scheduleDefaultsSave(next);   // 마지막으로 저장한 설정이 곧 기본값
        if (same()) {
          if (partEdits[part] === edit) dirtyParts.delete(part);   // 저장하는 동안 또 고쳤으면 "저장 안 됨" 유지
          if (PART_BTN[part]) {
            justSavedParts.add(part);
            setTimeout(() => { justSavedParts.delete(part); updateSettingsSummary(); }, 1800);
          }
        }
        return true;
      } catch (err) {
        const what = { main: "설정", sound: "음향", cap: "자막", name: "이름", mood: "분위기", card: "채널 카드 설정", voice: "목소리", autoup: "자동 업로드 설정" }[part];
        showMsg(`${what} 저장 실패: ${err.message}`, false);
        if (same()) dirtyParts.add(part);
        return false;
      } finally {
        savingParts.delete(part);
        if (same()) updateSettingsSummary();
      }
    });
    saveChain = run.catch(() => false);
    return run;
  }

  // ───── 기본값: 항상 마지막으로 저장한 설정이 기본값이고, 새 콘티가 그 값으로 시작한다 ─────
  // 서버(youtube_default_settings, 기기를 바꿔도 유지)에 저장하고, 이 기기에도 복사본을 둔다. 서버 표가 아직 없거나 연결이 안 되면
  // 이 기기 복사본으로 동작한다. 콘티마다 다른 값(이름, 제목 1·2줄, 출처 문구, 직접 올린 배경음악)은 기본값에서 뺀다.
  const DEFAULTS_LS_KEY = "polos_youtube_default_settings";
  const DEFAULT_KEYS = ["caption_font_size", "bgm_volume", "mood", "tts_voice", "tts_rate", "tts_pitch", "caption_weight", "caption_position_pct"];   // layout은 콘티 화면에서 늘 framed라 기본값에서 뺐다
  function pickDefaults(settings) {
    const o = {};
    DEFAULT_KEYS.forEach((k) => { if (settings[k] !== undefined) o[k] = settings[k]; });
    if (settings.bgm_path && isExternalUrl(settings.bgm_path)) o.bgm_path = settings.bgm_path;
    return o;
  }
  let userDefaults = null;
  const userDefaultsReady = (async () => {
    let remote = null;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_default_settings?select=settings&id=eq.1`, { headers });
      if (res.ok) { const rows = await res.json(); remote = rows[0] ? rows[0].settings : null; }
    } catch { /* 서버를 못 읽으면 이 기기 복사본으로 */ }
    let local = null;
    try { local = JSON.parse(localStorage.getItem(DEFAULTS_LS_KEY)); } catch { /* 없음 */ }
    userDefaults = remote && Object.keys(remote).length ? remote : local;
    if (userDefaults) { try { localStorage.setItem(DEFAULTS_LS_KEY, JSON.stringify(userDefaults)); } catch { /* 무시 */ } }
  })();

  async function saveUserDefaults(obj) {
    userDefaults = obj;
    try { localStorage.setItem(DEFAULTS_LS_KEY, JSON.stringify(obj)); } catch { /* 무시 */ }
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_default_settings`, {
        method: "POST",
        headers: { ...jsonHeaders, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ id: 1, settings: obj, updated_at: new Date().toISOString() }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // 콘티 설정이 저장될 때마다 부른다. 자막 조작처럼 저장이 잦을 수 있어 잠시 모아서 한 번만 쓰고,
  // 지난번에 쓴 기본값과 같으면 서버에 다시 쓰지 않는다.
  const DEFAULTS_SAVE_DELAY = 1500;
  let defaultsSaveTimer = 0;
  function scheduleDefaultsSave(savedSettings) {
    const snapshot = pickDefaults(savedSettings);   // 저장된 그 순간의 값(아직 저장 안 한 다른 카드 값이나 다른 콘티 값이 섞이지 않게)
    clearTimeout(defaultsSaveTimer);
    defaultsSaveTimer = setTimeout(async () => {
      defaultsSaveTimer = 0;
      await userDefaultsReady;
      if (userDefaults && JSON.stringify(userDefaults) === JSON.stringify(snapshot)) return;
      const savedOnServer = await saveUserDefaults(snapshot);
      if (!savedOnServer) console.warn("기본값을 서버에 저장하지 못해 이 기기에만 저장했어요.");
    }, DEFAULTS_SAVE_DELAY);
  }

  // 어떤 설정을 바꿔도(다른 핸들러가 값을 갱신한 뒤) 요약을 새로 그린다
  $("settingsBody").addEventListener("input", () => setTimeout(updateSettingsSummary, 0));
  $("settingsBody").addEventListener("change", () => setTimeout(updateSettingsSummary, 0));
  MOODS.forEach((m) => $("moodSel").add(new Option(m.label, m.id)));
  VOICES.forEach((v) => $("voiceSel").add(new Option(v.label, v.id)));
  $("voiceSel").addEventListener("change", () => {
    currentSettings.tts_voice = $("voiceSel").value;
    markPartDirty("sound");
  });
  $("ttsRate").addEventListener("input", () => {
    currentSettings.tts_rate = Number($("ttsRate").value);
    updateVoiceLabels();
    markPartDirty("sound");
    updateRuntimeSummary();   // 목소리 속도가 바뀌면 자막 줄 예상 길이(=장면 길이)도 바뀐다
  });
  $("ttsPitch").addEventListener("input", () => {
    currentSettings.tts_pitch = Number($("ttsPitch").value);
    updateVoiceLabels();
    markPartDirty("sound");
  });
  $("capSize").addEventListener("input", () => {
    currentSettings.caption_font_size = Number($("capSize").value);
    updateSettingsPreview();
    markPartDirty("cap");
  });
  [["title1", "title1"], ["title2", "title2"], ["sourceText", "source_text"]].forEach(([id, key]) => {
    $(id).addEventListener("input", () => {
      currentSettings[key] = $(id).value;
      updateSettingsPreview();
      markPartDirty("main");
    });
  });
  $("capWeight").addEventListener("input", () => {
    currentSettings.caption_weight = Number($("capWeight").value);
    updateSettingsPreview();
    markPartDirty("cap");
  });
  $("capPos").addEventListener("input", () => {
    currentSettings.caption_position_pct = Number($("capPos").value);
    updateSettingsPreview();
    markPartDirty("cap");
  });
  $("bgmVol").addEventListener("input", () => {
    currentSettings.bgm_volume = Number($("bgmVol").value) / 100;
    $("bgmVolVal").textContent = $("bgmVol").value + "%";
    markPartDirty("sound");
  });
  // 분위기는 휠에서 고르면 바로 저장한다(휠을 굴리는 동안 여러 번 바뀌므로 잠깐 모아서 mood 키만 PATCH)
  let moodSaveTimer = 0;
  function moodScheduleSave() {
    clearTimeout(moodSaveTimer);
    moodSaveTimer = setTimeout(() => {
      if (!$("scriptSelect").value || !dirtyParts.has("mood")) return;
      if (savingParts.has("mood")) { moodScheduleSave(); return; }
      savePart("mood");
    }, 500);
  }
  $("moodSel").addEventListener("change", () => { currentSettings.mood = $("moodSel").value; markPartDirty("mood"); moodScheduleSave(); });
  // 개요 박스 "구성": 묶음을 누르면 그 묶음 머리글로 스크롤
  $("ovParts").addEventListener("click", (e) => {
    const b = e.target.closest("[data-run]");
    const r = b && ovRuns[Number(b.dataset.run)];
    if (r && document.body.contains(r.head)) r.head.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("bgmFile").addEventListener("change", (e) => { if (e.target.files[0]) uploadBgm(e.target.files[0]); e.target.value = ""; });
  $("settingsSaveBtn").addEventListener("click", () => { if (!savingParts.has("main")) savePart("main"); });
  $("soundSaveBtn").addEventListener("click", () => { if (!savingParts.has("sound")) savePart("sound"); });

