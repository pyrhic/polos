// storyboard/12-full-preview.js — 미리보기 전부 멈추기(화면 숨김 시), 전체 미리보기(모든 장면 이어 재생)
// storyboard.html에서 순서 그대로 잘라낸 파일. 일반 <script>로 차례대로 불러오므로 앞 파일의 전역(let/const/function)을 그대로 쓴다.
  function pvStopAll() {
    if (pvActive) { pvStop(pvActive); pvActive = null; }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    if (pvActive) pvStop(pvActive);
    if (fpv.open) fpvPause();
  });

  // ───── 전체 미리보기: 모든 장면을 순서대로 한 무대에서 이어 재생 ─────
  // 장면 길이 = effectiveSeconds(영상 생성의 weight_seconds와 같은 값). 지금 장면만 카드 엔진(pvBuild/pvShow)으로 무대에 만든다.
  // 시계는 전체 시각 하나(fpv.t0)이고, 장면이 바뀌는 순간 그 장면을 새로 만들어 이어 붙인다.
  // 실제 성우 목소리(voice)가 준비되면 장면 길이·자막 줄 구간을 그 목소리의 실제 시각으로 바꾼다(fpvApplyVoice).
  // voiceState: "loading" | "ready" | "failed"(휴대폰 목소리로). wantPlay: 준비 중에 재생을 눌러 둔 상태
  const fpv = { open: false, scenes: [], items: [], total: 0, si: -1, ctx: null, playing: false, t: 0, t0: 0, raf: 0,
    voice: null, voiceState: "", vgen: 0, wantPlay: false };
  function fpvParts() {
    const st = $("fpvStage");
    return {
      stage: st, media: st.querySelector(".pv-layer"),
      t1: st.querySelector(".cap-t1"), t2: st.querySelector(".cap-t2"), src: st.querySelector(".cap-src"),
      lines: st.querySelector(".cap-lines"), cap: st.querySelector(".cap-normal"), ref: st.querySelector(".pv-ref"),
      play: $("fpvPlay"), time: document.createElement("div"), info: document.createElement("div"),
    };
  }
  // 화면 높이에 맞춰 9:16 무대를 최대한 크게 (아래 진행 막대 자리는 남긴다)
  function fpvLayout() {
    const ctlH = $("fpvCtl").offsetHeight || 56;
    const w = Math.floor(Math.min(window.innerWidth, (window.innerHeight - ctlH) * 9 / 16));
    const box = $("fpvBox");
    box.style.width = w + "px";
    box.style.height = Math.round(w * 16 / 9) + "px";
    $("fpvStage").style.transform = `scale(${w / 270})`;
    $("fpvCtl").style.maxWidth = Math.max(w, 280) + "px";
  }
  function fpvSceneAt(T) {
    const i = fpv.scenes.findIndex((s) => T < s.s0 + s.secs);
    return i < 0 ? fpv.scenes.length - 1 : i;
  }
  // 그 장면을 무대에 만들고 장면 안 local초 화면으로
  function fpvEnter(si, local) {
    if (fpv.ctx) pvStop(fpv.ctx);
    const sc = fpv.scenes[si];
    fpv.si = si;
    const ctx = pvBuild(sc.el, sc.seg, fpvParts(), sc.secs, sc.groups);
    ctx.full = true;
    ctx.playing = fpv.playing;
    ctx.shown = -2;
    fpv.ctx = ctx;
    pvShow(ctx, local, true);
  }
  function fpvUi() {
    const pct = fpv.total > 0 ? Math.min(100, fpv.t / fpv.total * 100) : 0;
    $("fpvFill").style.width = pct + "%";
    $("fpvKnob").style.left = pct + "%";
    $("fpvScene").textContent = `${Math.max(0, fpv.si) + 1}/${fpv.scenes.length} 장면`;
    $("fpvTime").textContent = pvTimeText(fpv.t, fpv.total);
    $("fpvPlay").textContent = fpv.playing ? "❚❚" : "▶";
    $("fpvPlay").classList.toggle("on", fpv.playing);
  }
  // 전체 T초 시점으로 (재생 중이면 거기서 이어서)
  function fpvSeek(T) {
    if (!fpv.scenes.length) return;
    T = Math.max(0, Math.min(fpv.total, T));
    fpv.t = T;
    if (fpv.playing) fpv.t0 = performance.now() - T * 1000;
    const si = fpvSceneAt(Math.min(T, fpv.total - 0.001));
    const local = T - fpv.scenes[si].s0;
    if (si !== fpv.si || !fpv.ctx) fpvEnter(si, local);
    else {
      if (fpv.playing) fpv.ctx.shown = -2;
      pvShow(fpv.ctx, local, true);
    }
    if (fpv.playing) fpvVoiceAt(T);   // 옮긴 자리부터 다시 (휴대폰 목소리는 그 줄부터 이어 읽는다)
    fpvUi();
  }
  function fpvVoiceAt(T) {
    if (fpv.voice) vpStart(fpv.voice.buffer, 0, T, fpv.total);
    else spStart(fpv.items, T);
  }
  function fpvTick(now) {
    if (!fpv.open || !fpv.playing) return;
    const vt = fpv.voice ? vpNow() : null;   // 실제 목소리면 소리 장치 시계를 따른다
    const T = vt != null ? vt : (now - fpv.t0) / 1000;
    if (T >= fpv.total) {   // 끝: 마지막 장면 끝 화면에서 멈춘다
      const last = fpv.scenes.length - 1;
      if (fpv.si !== last) fpvEnter(last, fpv.scenes[last].secs);
      pvShow(fpv.ctx, fpv.ctx.secs, false);
      fpv.t = fpv.total;
      fpvPause();
      return;
    }
    fpv.t = T;
    const si = fpvSceneAt(T);
    if (si !== fpv.si) fpvEnter(si, T - fpv.scenes[si].s0);
    else pvShow(fpv.ctx, T - fpv.scenes[si].s0, false);
    if (!fpv.voice) spTick(T);   // 휴대폰 목소리는 장면 경계에서도 끊지 않고 전체 시간축으로 이어 읽는다
    fpvUi();
    fpv.raf = requestAnimationFrame(fpvTick);
  }
  function fpvPlay() {
    if (!fpv.open || !fpv.scenes.length) return;
    if (fpv.voiceState === "loading") {   // 성우 목소리가 오면 그때 재생한다 (fpvVoicePrepare)
      fpv.wantPlay = true;
      $("fpvPlay").textContent = "…";
      vaNote(VA_LOADING, true);
      return;
    }
    fpv.wantPlay = false;
    if (fpv.t >= fpv.total - 0.05) fpv.t = 0;
    fpv.playing = true;
    fpv.t0 = performance.now() - fpv.t * 1000;
    const si = fpvSceneAt(fpv.t);
    const local = fpv.t - fpv.scenes[si].s0;
    if (si !== fpv.si || !fpv.ctx) fpvEnter(si, local);
    else { fpv.ctx.playing = true; fpv.ctx.shown = -2; pvShow(fpv.ctx, local, true); }
    fpvVoiceAt(fpv.t);
    fpvUi();
    cancelAnimationFrame(fpv.raf);
    fpv.raf = requestAnimationFrame(fpvTick);
  }
  function fpvPause() {
    fpv.playing = false;
    if (fpv.wantPlay) { fpv.wantPlay = false; vaNoteDone(); }
    cancelAnimationFrame(fpv.raf);
    if (fpv.ctx) pvStop(fpv.ctx);
    spStop();
    vpStop();
    fpvUi();
  }
  function fpvToggle() {
    vaAudio();   // 누른 순간에 소리 장치를 깨워 둔다
    if (fpv.playing || fpv.wantPlay) fpvPause();
    else if (pvGuideNeeded()) pvShowGuide(fpvPlay);
    else fpvPlay();
  }
  // 영상 전체의 읽을 문장을 /api/tts로 받아 실제 목소리 흐름을 만든다 (파이프라인과 같은 규칙, vaBuild)
  function fpvVoicePrepare() {
    const gen = ++fpv.vgen;
    fpv.voice = null;
    const input = fpv.scenes.map((sc) => vaSceneInput(sc.el, sc.seg, sc.secs));
    if (!input.some(vaHasVoice)) { fpv.voiceState = "failed"; return; }   // 읽을 글자가 없으면 목소리 없이 (예상 길이)
    fpv.voiceState = "loading";
    vaBuild(input).then((res) => {
      if (gen !== fpv.vgen || !fpv.open) return;
      // 장면별 결과를 카드 미리보기가 다시 쓸 수 있게 남긴다
      input.forEach((inp, i) => {
        if (vaHasVoice(inp)) vaRemember(vaSceneKey(inp), { buffer: res.buffer, off: res.scenes[i].s0, secs: res.scenes[i].secs, groups: res.scenes[i].groups });
      });
      fpv.voiceState = "ready";
      fpvApplyVoice(res);
    }).catch((err) => {
      if (gen !== fpv.vgen || !fpv.open) return;
      console.warn("실제 성우 목소리 실패:", err);
      fpv.voiceState = "failed";
      const waiting = fpv.wantPlay;
      vaNote(VA_FALLBACK);
      if (waiting) fpvPlay();
    });
  }
  // 실제 목소리의 장면 길이·자막 줄 구간으로 시간축을 바꾼다 (지금 자리는 같은 장면 안 같은 비율 자리로)
  function fpvApplyVoice(res) {
    const T = fpv.t;
    const si = fpv.scenes.length ? fpvSceneAt(Math.min(T, fpv.total - 0.001)) : 0;
    const old = fpv.scenes[si];
    const frac = old && old.secs > 0 ? Math.max(0, Math.min(1, (T - old.s0) / old.secs)) : 0;
    fpv.scenes.forEach((sc, i) => { sc.s0 = res.scenes[i].s0; sc.secs = res.scenes[i].secs; sc.groups = res.scenes[i].groups; });
    fpv.total = res.total;
    fpv.voice = res;
    fpvTicks();
    if (fpv.ctx) pvStop(fpv.ctx);
    fpv.ctx = null; fpv.si = -1;
    const nt = old ? fpv.scenes[si].s0 + frac * fpv.scenes[si].secs : 0;
    const waiting = fpv.wantPlay;
    fpv.wantPlay = false;
    fpvSeek(nt);
    if (waiting) { vaNoteHide(); fpvPlay(); }
  }
  // 진행 막대의 장면 경계 눈금
  function fpvTicks() {
    const bar = $("fpvBar");
    bar.querySelectorAll(".fpv-tick").forEach((n) => n.remove());
    fpv.scenes.slice(1).forEach((s) => {
      const k = document.createElement("div");
      k.className = "fpv-tick";
      k.style.left = s.s0 / fpv.total * 100 + "%";
      bar.appendChild(k);
    });
  }
  function fpvOpen() {
    vaAudio();   // 누른 순간에 소리 장치를 깨워 둔다
    pvDeactivate();   // 카드 미리보기는 멈추고 정지 화면으로
    const cards = Array.from(document.querySelectorAll(".seg-item"));
    let acc = 0;
    fpv.scenes = [];
    cards.forEach((el) => {
      const seg = segOfEl(el);
      if (!seg) return;
      const secs = effectiveSeconds(el, seg);
      if (!(secs > 0)) return;
      fpv.scenes.push({ el, seg, s0: acc, secs });
      acc += secs;
    });
    fpv.total = acc;
    // 목소리용: 모든 장면의 자막 줄을 전체 시간축으로 이어 붙인다
    fpv.items = [];
    fpv.scenes.forEach((sc) => capSpeechItems(sc.el, sc.seg).forEach((g) => fpv.items.push({ raw: g.raw, s0: sc.s0 + g.s0, s1: sc.s0 + g.s1 })));
    if (!fpv.scenes.length) { showMsg("미리볼 장면이 없어요.", false); return; }
    fpv.open = true;
    fpv.playing = false;
    fpv.si = -1; fpv.ctx = null; fpv.t = 0;
    const m = $("fpv");
    m.classList.add("open");
    m.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    fpvTicks();
    fpvLayout();
    fpv.wantPlay = false;
    fpvVoicePrepare();
    fpvSeek(0);
    if (pvGuideNeeded()) pvShowGuide(fpvPlay); else fpvPlay();
  }
  function fpvClose() {
    if (!fpv.open) return;
    fpvPause();
    fpv.open = false;
    fpv.ctx = null; fpv.si = -1;
    fpv.vgen++; fpv.voice = null; fpv.voiceState = ""; fpv.wantPlay = false;
    vaNoteHide();
    spStop();
    vpStop();
    $("fpvStage").querySelector(".pv-layer").innerHTML = "";   // 영상 요소를 치워 내려받기를 멈춘다
    const m = $("fpv");
    m.classList.remove("open");
    m.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }
  (function bindFpv() {
    $("fullPvBtn").addEventListener("click", fpvOpen);
    $("fpvX").addEventListener("click", (e) => { e.stopPropagation(); fpvClose(); });
    $("fpvStage").addEventListener("click", fpvToggle);
    const bar = $("fpvBar");
    const at = (e) => {
      const r = bar.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / (r.width || 1))) * fpv.total;
    };
    bar.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      try { bar.setPointerCapture(e.pointerId); } catch {}
      fpvSeek(at(e));
      const move = (ev) => fpvSeek(at(ev));
      const end = () => {
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", end);
        bar.removeEventListener("pointercancel", end);
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", end);
      bar.addEventListener("pointercancel", end);
    });
    window.addEventListener("resize", () => { if (fpv.open) fpvLayout(); });
    document.addEventListener("keydown", (e) => {
      if (!fpv.open) return;
      if (e.key === "Escape") fpvClose();
      else if (e.key === " ") { e.preventDefault(); fpvToggle(); }
    });
  })();

  async function removeSegmentAsset(id, path) {
    if (!confirm("이 소재를 삭제할까요?")) return;
    const seg = segments.find((s) => String(s.id) === id);
    const paths = (seg.asset_paths || []).filter((p) => p !== path);
    try {
      if (isOwnStoragePath(path)) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, { method: "DELETE", headers });
      }
      // 이 소재의 구간/위치/비중/원본 길이 기록도 같이 지운다
      const next = { ...(seg.asset_trims || {}) };
      delete next[path];
      ["__focus", "__weights", "__pexels"].forEach((key) => {
        if (!next[key] || next[key][path] === undefined) return;
        const { [path]: _x, ...rest } = next[key];
        if (Object.keys(rest).length) next[key] = rest; else delete next[key];
      });
      // X로 직접 지운 장면은 다시 자동 배치하지 않는다 (docs/storyboard-contract.md 2절 3)
      next.__cleared = true;
      await saveFields(id, { asset_paths: paths, asset_trims: next });
      if (seg.asset_notes && seg.asset_notes[path]) {
        const { [path]: _removed, ...rest } = seg.asset_notes;
        await saveField(id, "asset_notes", rest);
      }
    } catch (err) {
      showMsg("소재 삭제 실패: " + err.message, false);
    }
    refreshThumbs(id);
  }

  // 장면에 빈 화면 클립(blank:black / blank:white / blank:bars) 1개를 맨 뒤에 넣는다
  async function addBlankClip(id, token) {
    const seg = segments.find((s) => String(s.id) === String(id));
    if (!seg || !BLANKS.some((b) => b.token === token)) return;
    const paths = seg.asset_paths || [];
    if (paths.includes(token)) { showMsg("이 장면에 이미 같은 빈 화면이 있어요. (한 장면에 같은 빈 화면은 하나만 넣을 수 있어요)", false); return; }
    try {
      await saveField(String(id), "asset_paths", [...paths, token]);
      closeAddMenus();
      refreshThumbs(String(id));
      showMsg(`빈 화면(${blankLabel(token)})을 추가했습니다.`, true);
    } catch (err) {
      showMsg("빈 화면 추가 실패: " + err.message, false);
    }
  }
  $("segList").addEventListener("click", (e) => {
    const b = e.target.closest(".blank-pick-btn");
    const card = b && b.closest(".seg-item");
    if (card && !b.disabled) addBlankClip(card.dataset.id, b.dataset.token);
  });

