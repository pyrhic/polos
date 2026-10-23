// storyboard/08-trim-pos.js — 구간 지정 팝업(영상·GIF 시작 위치), 사진 위치 팝업
// storyboard.html에서 순서 그대로 잘라낸 파일. 일반 <script>로 차례대로 불러오므로 앞 파일의 전역(let/const/function)을 그대로 쓴다.
  // ───── 구간 지정 팝업 ─────
  // 영상은 이 클립의 배정 시간(장면초 × 비중)만큼 화면에 나온다. 그래서 길이는 고정이고, 영상의 어느 부분을 쓸지만 고른다.
  // 고정 길이 구간을 손가락으로 좌우로 밀어 고르고, 시작 위치만 저장한다({start, end:null}) — 나중에 비중/대사가 바뀌어도 그대로 맞는다.
  // 길이를 알 수 없는 GIF만 예전처럼 시작/끝 초를 직접 입력한다.
  let trimState = null; // { id, path, isGif, duration, alloc }
  function trimClamp() {
    const st = trimState;
    if (!st) return null;
    let start = parseFloat($("trimStart").value);
    let end = parseFloat($("trimEnd").value);
    if (Number.isNaN(start) || start < 0) start = 0;
    if (Number.isNaN(end)) end = null;
    if (st.duration) {
      if (!st.isGif && st.alloc) {
        start = Math.min(start, Math.max(0, st.duration - st.alloc));
        end = Math.min(st.duration, start + st.alloc);
      } else {
        start = Math.min(start, st.duration);
        if (end !== null) end = Math.min(end, st.duration);
      }
    }
    return { start, end };
  }
  function updateTrimBar() {
    const t = trimClamp();
    if (!t) return;
    const st = trimState;
    const dur = st.duration;
    if (!dur) { $("trimSel").style.left = "0"; $("trimSel").style.width = "100%"; $("trimInfo").textContent = st.isGif ? "GIF는 미리보기 없이 시작/끝 초를 직접 입력하세요. 끝을 비우면 끝까지 씁니다." : "영상 길이를 읽는 중…"; return; }
    const end = t.end == null ? dur : t.end;
    $("trimSel").style.left = (t.start / dur * 100) + "%";
    $("trimSel").style.width = (Math.max(0, end - t.start) / dur * 100) + "%";
    $("trimHS").style.left = (t.start / dur * 100) + "%";
    $("trimHE").style.left = (end / dur * 100) + "%";
    $("trimHSLab").textContent = t.start.toFixed(1) + "s";
    $("trimHELab").textContent = end.toFixed(1) + "s";
    if (st.isGif || !st.alloc) {
      $("trimInfo").textContent = end > t.start ? `사용 구간 ${t.start.toFixed(1)}~${end.toFixed(1)}초 (${(end - t.start).toFixed(1)}초) / 전체 ${dur.toFixed(1)}초` : "끝이 시작보다 뒤여야 합니다";
    } else if (st.alloc > dur + 0.05) {
      $("trimInfo").textContent = `이 클립은 ${st.alloc.toFixed(1)}초 동안 나와요. ${SHORT_CLIP_TEXT} (영상 ${dur.toFixed(1)}초)`;
    } else {
      $("trimInfo").textContent = `이 클립은 ${st.alloc.toFixed(1)}초 동안 나와요 — 구간을 좌우로 밀어 쓸 부분을 고르세요 (${t.start.toFixed(1)}~${end.toFixed(1)}초 / 전체 ${dur.toFixed(1)}초)`;
    }
  }
  function openTrimModal(id, path) {
    const seg = segments.find((s) => String(s.id) === id);
    if (!seg) return;
    const cur = (seg.asset_trims || {})[path];
    const isGif = /\.gif(\?|$)/i.test(path);
    const plan = clipPlan(seg, segSecondsOf(seg)).find((c) => c.path === path);
    trimState = { id, path, isGif, duration: null, alloc: plan ? plan.alloc : null };
    const host = $("trimMediaHost");
    host.innerHTML = isGif
      ? `<img src="${escapeAttr(assetUrl(path))}" alt="">`
      : `<video id="trimVideo" src="${escapeAttr(assetUrl(path))}" controls playsinline preload="metadata"></video>`;
    $("trimStart").value = cur ? Number(cur.start || 0).toFixed(2) : "0";
    $("trimEnd").value = cur && cur.end != null ? Number(cur.end).toFixed(2) : "";
    $("trimPreview").style.display = isGif ? "none" : "block";
    $("trimNums").style.display = isGif ? "grid" : "none";
    $("trimBar").classList.toggle("gif", isGif);
    $("trimPlay").style.display = "none";
    $("trimModal").classList.add("open");
    updateTrimBar();
    const v = $("trimVideo");
    if (v) {
      v.addEventListener("loadedmetadata", () => {
        trimState.duration = v.duration;
        clipDurCache[path] = v.duration;
        v.currentTime = trimClamp().start;
        updateTrimBar();
      });
      // 재생 위치(흰 선)를 막대 위에 보여준다
      const movePlay = () => {
        if (!trimState || !trimState.duration) return;
        $("trimPlay").style.display = "block";
        $("trimPlay").style.left = (v.currentTime / trimState.duration * 100) + "%";
      };
      v.addEventListener("timeupdate", movePlay);
      v.addEventListener("seeked", movePlay);
    }
  }
  function closeTrimModal() {
    const v = $("trimVideo");
    if (v) v.pause();
    $("trimModal").classList.remove("open");
    $("trimMediaHost").innerHTML = "";
    trimState = null;
  }
  async function saveTrim(reset) {
    const st = trimState;
    if (!st) return;
    const seg = segments.find((s) => String(s.id) === st.id);
    const next = { ...(seg.asset_trims || {}) };
    const t = trimClamp();
    const dur = st.duration;
    let full;
    if (st.isGif) {
      full = reset || (t.start <= 0.05 && (t.end == null || (dur && t.end >= dur - 0.05)));
      if (!full && t.end !== null && t.end <= t.start) { $("trimInfo").textContent = "끝이 시작보다 뒤여야 합니다"; return; }
      if (!full) next[st.path] = { start: Number(t.start.toFixed(2)), end: t.end == null ? null : Number(t.end.toFixed(2)) };
    } else {
      // 영상: 시작 위치만 저장한다 (길이는 배정 시간이 정한다)
      full = reset || t.start <= 0.05;
      if (!full) next[st.path] = { start: Number(t.start.toFixed(2)), end: null };
    }
    if (full) delete next[st.path];
    try {
      await saveField(st.id, "asset_trims", next);
      const id = st.id;
      closeTrimModal();
      refreshThumbs(id);
    } catch (err) {
      const needSql = /asset_trims/.test(err.message);
      $("trimInfo").textContent = needSql ? "저장 실패: Supabase에 구간 저장용 칸(asset_trims)이 아직 없어요. youtube_tables_12_asset_trims.sql을 SQL Editor에서 한 번 실행해야 해요. 그때까지는 '닫기'로 나가세요." : "저장 실패: " + err.message;
    }
  }
  ["trimStart", "trimEnd"].forEach((k) => $(k).addEventListener("input", updateTrimBar));

  // 구간 밀기: 막대 어디를 잡든 고정 길이 구간이 통째로 따라 움직이고, 영상은 구간 시작 장면을 보여준다.
  // 구간 밖을 누르면 그 위치가 구간 가운데가 되게 옮긴 뒤 이어서 밀 수 있다.
  function trimTimeAt(clientX) {
    const r = $("trimBar").getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * trimState.duration;
  }
  function trimSeek(sec) {
    const v = $("trimVideo");
    if (v) { v.pause(); v.currentTime = sec; }
  }
  let trimGrab = null;   // 누른 위치와 구간 시작의 차이(초)
  function trimMoveTo(start) {
    const st = trimState;
    start = Math.max(0, Math.min(start, Math.max(0, st.duration - st.alloc)));
    $("trimStart").value = start.toFixed(2);
    $("trimEnd").value = Math.min(st.duration, start + st.alloc).toFixed(2);
    trimSeek(start);
    updateTrimBar();
  }
  const trimBarEl = $("trimBar");
  trimBarEl.addEventListener("pointerdown", (e) => {
    const st = trimState;
    if (!st || !st.duration || st.isGif || !st.alloc) return;
    e.preventDefault();
    const t = trimClamp();
    const at = trimTimeAt(e.clientX);
    if (at < t.start || at > t.start + st.alloc) trimMoveTo(at - st.alloc / 2);
    trimGrab = at - trimClamp().start;
    trimBarEl.setPointerCapture(e.pointerId);
    trimBarEl.classList.add("drag");
  });
  trimBarEl.addEventListener("pointermove", (e) => {
    if (trimGrab === null || !trimBarEl.hasPointerCapture(e.pointerId)) return;
    trimMoveTo(trimTimeAt(e.clientX) - trimGrab);
  });
  const trimRelease = (e) => {
    if (trimBarEl.hasPointerCapture(e.pointerId)) trimBarEl.releasePointerCapture(e.pointerId);
    trimGrab = null;
    trimBarEl.classList.remove("drag");
  };
  trimBarEl.addEventListener("pointerup", trimRelease);
  trimBarEl.addEventListener("pointercancel", trimRelease);
  $("trimPreview").addEventListener("click", () => {
    const v = $("trimVideo");
    const t = trimClamp();
    if (!v || !t) return;
    const end = t.end == null ? v.duration : t.end;
    v.currentTime = t.start;
    v.play();
    const stop = () => { if (v.currentTime >= end) { v.pause(); v.removeEventListener("timeupdate", stop); } };
    v.addEventListener("timeupdate", stop);
  });
  $("trimReset").addEventListener("click", () => saveTrim(true));
  $("trimDone").addEventListener("click", () => saveTrim(false));
  $("trimClose").addEventListener("click", closeTrimModal);
  $("trimX").addEventListener("click", closeTrimModal);
  $("trimModal").addEventListener("click", (e) => { if (e.target === $("trimModal")) closeTrimModal(); });

  // ───── 사진 위치 팝업 ─────
  // 소재를 화면 비율로 자를 때 남길 부분. asset_trims.__focus[경로] = {x, y} (0~1, 0.5가 가운데). 영상 만들 때 그대로 쓴다.
  let posState = null;
  // "제목+영상+출처" 구성에서 세로/가로 1.3 이상인 소재는 영상 영역이 화면 맨 아래까지(1080x1500), 그 밖은 1080x1280 (영상 만들기와 같은 규칙)
  function posAspect(iw, ih) {
    return iw && ih && ih / iw >= 1.3 ? 1080 / 1500 : 1080 / 1280;
  }
  function layoutPos() {
    const st = posState;
    if (!st || !st.iw) return;
    const stage = $("posStage");
    const W = stage.clientWidth, H = W * st.ih / st.iw;
    stage.style.height = H + "px";
    const a = posAspect(st.iw, st.ih);
    let ww, wh;
    if (st.iw / st.ih > a) { wh = H; ww = H * a; } else { ww = W; wh = W / a; }
    st.slackX = Math.max(0, W - ww); st.slackY = Math.max(0, H - wh);
    const win = stage.querySelector(".pos-win");
    win.style.width = ww + "px"; win.style.height = wh + "px";
    win.style.left = (st.slackX * st.x) + "px"; win.style.top = (st.slackY * st.y) + "px";
    $("posInfo").textContent = st.slackX < 2 && st.slackY < 2
      ? "이 소재는 화면 비율과 거의 같아서 위치를 바꿀 부분이 없어요"
      : `가로 ${Math.round(st.x * 100)}% · 세로 ${Math.round(st.y * 100)}%`;
  }
  function openPosModal(id, path) {
    const seg = segments.find((s) => String(s.id) === id);
    if (!seg) return;
    const f = ((seg.asset_trims || {}).__focus || {})[path];
    posState = { id, path, x: f ? f.x : 0.5, y: f ? f.y : 0.5, iw: 0, ih: 0, slackX: 0, slackY: 0 };
    const stage = $("posStage");
    stage.innerHTML = "";
    stage.style.height = "160px";
    const video = !isImage(path);
    const media = document.createElement(video ? "video" : "img");
    media.className = "pos-media";
    if (video) { media.muted = true; media.preload = "auto"; media.playsInline = true; media.src = assetUrl(path) + "#t=0.1"; }
    else media.src = assetUrl(path);
    const win = document.createElement("div");
    win.className = "pos-win";
    stage.append(media, win);
    const ready = () => { posState.iw = media.naturalWidth || media.videoWidth; posState.ih = media.naturalHeight || media.videoHeight; layoutPos(); };
    if (video) media.addEventListener("loadeddata", ready); else media.addEventListener("load", ready);
    $("posModal").classList.add("open");
  }
  function closePosModal() { $("posModal").classList.remove("open"); $("posStage").innerHTML = ""; posState = null; }
  async function savePos(reset) {
    const st = posState;
    if (!st) return;
    const seg = segments.find((s) => String(s.id) === st.id);
    const trims = { ...(seg.asset_trims || {}) };
    const focus = { ...(trims.__focus || {}) };
    if (reset || (Math.abs(st.x - 0.5) < 0.01 && Math.abs(st.y - 0.5) < 0.01)) delete focus[st.path];
    else focus[st.path] = { x: Number(st.x.toFixed(3)), y: Number(st.y.toFixed(3)) };
    if (Object.keys(focus).length) trims.__focus = focus; else delete trims.__focus;
    try {
      await saveField(st.id, "asset_trims", trims);
      const id = st.id;
      closePosModal();
      refreshThumbs(id);
    } catch (err) {
      $("posInfo").textContent = "저장 실패: " + err.message;
    }
  }
  (function initPosDrag() {
    const stage = $("posStage");
    let drag = false;
    const move = (e) => {
      const st = posState;
      if (!st || !st.iw) return;
      const r = stage.getBoundingClientRect();
      const win = stage.querySelector(".pos-win");
      const ww = parseFloat(win.style.width), wh = parseFloat(win.style.height);
      // 손가락 위치가 테두리의 가운데가 되도록 옮긴다
      if (st.slackX > 1) st.x = Math.max(0, Math.min(1, (e.clientX - r.left - ww / 2) / st.slackX));
      if (st.slackY > 1) st.y = Math.max(0, Math.min(1, (e.clientY - r.top - wh / 2) / st.slackY));
      layoutPos();
    };
    stage.addEventListener("pointerdown", (e) => { drag = true; stage.setPointerCapture(e.pointerId); move(e); });
    stage.addEventListener("pointermove", (e) => { if (drag) move(e); });
    ["pointerup", "pointercancel"].forEach((t) => stage.addEventListener(t, () => { drag = false; }));
    window.addEventListener("resize", layoutPos);
  })();
  $("posSave").addEventListener("click", () => savePos(false));
  $("posReset").addEventListener("click", () => savePos(true));
  $("posClose").addEventListener("click", closePosModal);
  $("posX").addEventListener("click", closePosModal);
  $("posModal").addEventListener("click", (e) => { if (e.target === $("posModal")) closePosModal(); });

