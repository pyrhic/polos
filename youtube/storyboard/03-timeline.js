// storyboard/03-timeline.js — 타임라인 한 줄(클립 폭·경계 끌기), 손가락 동작(고르기/길게 눌러 순서 바꾸기), 소재 추가 메뉴
// storyboard.html에서 순서 그대로 잘라낸 파일. 일반 <script>로 차례대로 불러오므로 앞 파일의 전역(let/const/function)을 그대로 쓴다.
  // ───── 타임라인 한 줄: 클립들이 비중 폭대로 나란히, 경계를 끌어 비율을 바꾼다 ─────
  function refreshClipView(id) {
    const el = document.querySelector(`.seg-item[data-id="${id}"]`);
    const seg = segments.find((s) => String(s.id) === String(id));
    if (el && seg) updateClipView(el, seg, effectiveSeconds(el, seg));
  }
  function updateClipView(el, seg, secs) {
    const host = el.querySelector(".seg-tl-area");
    if (!host || host.dataset.dragging) return;
    const id = String(seg.id);
    const paths = seg.asset_paths || [];
    if (el._selPath && !paths.includes(el._selPath)) el._selPath = null;
    // 미리보기와 같은 길이 기준 (미리보기는 최소 2초)
    const pvSecs = hasCaps(el) ? secs : Math.max(2, secs);
    const plan = clipPlan(seg, pvSecs);
    const stageRow = el.querySelector(".seg-stage-row");
    if (stageRow) {
      stageRow.style.display = "flex";
      stageRow.querySelector(".seg-stage-box").style.display = paths.length ? "" : "none";
    }
    const custom = Object.keys((seg.asset_trims || {}).__weights || {}).length > 0;
    const sig = JSON.stringify([paths, paths.map((p) => thumbNow(p) === undefined ? "?" : thumbNow(p) ? "t" : "v"), el._selPath, custom,
      plan.map((c) => c.short), paths.length ? "" : emptyThumbsHtml(seg), ((seg.asset_trims || {}).__focus || {})]);

    if (!paths.length) {
      if (host._sig !== sig) {
        host._sig = sig;
        host.innerHTML = `<div class="seg-tl-head"><span>클립이 없어요 — 오른쪽 + 로 넣어요</span></div>
          <div class="seg-tl-row"><div class="seg-tl-empty">빈 장면<button type="button" class="seg-tl-add" title="사진/영상/빈 화면 추가">+</button></div></div>
          <div style="margin-top:8px;">${emptyThumbsHtml(seg)}</div>`;
      }
      return;
    }

    if (host._sig !== sig) {
      host._sig = sig;
      const tlW = host.clientWidth || 280;
      const tiles = Math.min(14, Math.ceil(tlW / 26) + 1);
      host.innerHTML = `
        ${custom ? '<div class="seg-tl-head" style="justify-content:flex-end;"><button type="button" class="seg-tl-reset">균등하게</button></div>' : ""}
        <div class="seg-tl-row">
          <div class="seg-tl-col">
            <div class="seg-tl-ruler" title="눌러서 그 시점 보기"></div>
            <div class="seg-tl">
              ${plan.map((c, i) => `<div class="seg-tl-clip ${clipKind(c.path)}${c.short ? " short" : ""}${c.path === el._selPath ? " sel" : ""}${i === plan.length - 1 ? " last" : ""}" data-i="${i}" style="flex:0 0 ${c.frac * 100}%;">${clipFillHtml(seg, c.path, tiles)}${clipLabHtml(i, c)}</div>`).join("")}
              ${plan.slice(0, -1).map((c, k) => `<div class="seg-tl-handle" data-k="${k}"></div>`).join("")}
              <div class="seg-tl-play"></div>
              <button type="button" class="seg-tl-add" title="사진/영상/빈 화면 추가">+</button>
            </div>
          </div>
        </div>
        <div class="seg-tools-host"></div>
        <div class="seg-short-host"></div>`;
      host.querySelectorAll(".seg-tl-handle").forEach((h) =>
        h.addEventListener("pointerdown", (e) => startTimelineDrag(e, el, id, Number(h.dataset.k)))
      );
      host.querySelectorAll("video.seg-tl-vid").forEach((v) =>
        v.addEventListener("loadedmetadata", () => noteDuration(v.dataset.path, v.duration))
      );
      // 아직 썸네일이 없는 영상은 구해 둔다 (구하면 다시 그려진다)
      paths.forEach((p) => { if (thumbNow(p) === undefined) clipThumb(p, seg); });
    }
    // 길이·비중에 따라 바뀌는 부분은 그 자리에서 고친다
    const clips = host.querySelectorAll(".seg-tl-clip");
    let acc = 0;
    plan.forEach((c, i) => {
      if (!clips[i]) return;
      clips[i].style.flex = `0 0 ${c.frac * 100}%`;
      const s = clips[i].querySelector(".seg-tl-sec");
      if (s) s.textContent = c.alloc.toFixed(1) + "초";
    });
    host.querySelectorAll(".seg-tl-handle").forEach((h, k) => {
      acc += plan[k].frac;
      h.style.left = acc * 100 + "%";
    });
    const ruler = host.querySelector(".seg-tl-ruler");
    if (ruler && ruler.dataset.secs !== pvSecs.toFixed(1)) { ruler.dataset.secs = pvSecs.toFixed(1); ruler.innerHTML = rulerHtml(pvSecs); }
    host.querySelector(".seg-tools-host").innerHTML = el._selPath ? toolsHtml(seg, el._selPath, plan) : "";
    const shorts = plan.map((c, i) => ({ c, i })).filter(({ c }) => c.short);
    host.querySelector(".seg-short-host").innerHTML = shorts.length ? `<div class="seg-short-list">${shorts.map(({ c, i }) =>
      `<div>⚠ ${i + 1}번 클립: ${SHORT_CLIP_TEXT} (영상 ${c.src.toFixed(1)}초 / 배정 ${c.alloc.toFixed(1)}초)</div>`).join("")}</div>` : "";
    // 미리보기 옆 시간·안내도 장면 길이를 따라간다 (살아 있는 미리보기는 길이가 바뀌면 잠시 뒤 다시 만든다)
    if (pvActive && pvActive.el === el) {
      if (Math.abs(pvActive.secs - pvSecs) > 0.01 && !pvActive.playing) {
        clearTimeout(el._pvTimer);
        el._pvTimer = setTimeout(() => { if (pvActive && pvActive.el === el && !pvActive.playing) pvRefreshCard(id); }, 400);
      }
      pvPlayhead(pvActive);
    } else if (el.querySelector(".seg-pv-time")) {
      el.querySelector(".seg-pv-time").textContent = pvTimeText(0, pvSecs);
      el.querySelector(".seg-pv-info").innerHTML = pvInfoHtml(seg, plan, pvSecs);
    }
  }
  function startTimelineDrag(e, el, id, k) {
    const seg = segments.find((s) => String(s.id) === id);
    const host = el.querySelector(".seg-tl-area");
    const bar = host && host.querySelector(".seg-tl");
    if (!seg || !bar) return;
    e.preventDefault();
    e.stopPropagation();
    closeAddMenus();
    const handle = e.currentTarget;
    try { handle.setPointerCapture(e.pointerId); } catch {}
    handle.classList.add("drag");
    host.dataset.dragging = "1";
    const secs = pvSecsOf(el, seg);
    const ws = clipWeights(seg);
    const sum = ws.reduce((a, b) => a + b, 0) || 1;
    const fr = ws.map((w) => w / sum);
    const pair = fr[k] + fr[k + 1];
    const minF = Math.min(pair / 2, Math.max(0.03, 0.5 / Math.max(secs, 0.1)));   // 클립 하나가 0.5초(또는 3%)보다 짧아지지 않게
    const width = bar.clientWidth || 1;
    const x0 = e.clientX, a0 = fr[k];
    const clips = bar.querySelectorAll(".seg-tl-clip");
    let moved = false;
    const paint = () => {
      [k, k + 1].forEach((i) => {
        clips[i].style.flex = `0 0 ${fr[i] * 100}%`;
        const s = clips[i].querySelector(".seg-tl-sec");
        if (s) s.textContent = (secs * fr[i]).toFixed(1) + "초";
      });
      handle.style.left = fr.slice(0, k + 1).reduce((a, b) => a + b, 0) * 100 + "%";
    };
    const move = (ev) => {
      if (Math.abs(ev.clientX - x0) > 2) moved = true;
      fr[k] = Math.max(minF, Math.min(pair - minF, a0 + (ev.clientX - x0) / width));
      fr[k + 1] = pair - fr[k];
      paint();
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.classList.remove("drag");
      delete host.dataset.dragging;
      if (moved) saveWeights(id, fr); else refreshClipView(id);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  // fr: 클립별 비율 배열 (null이면 균등으로 되돌림). 평균이 1이 되게 바꿔 asset_trims.__weights에 저장한다
  async function saveWeights(id, fr) {
    const seg = segments.find((s) => String(s.id) === id);
    if (!seg) return;
    const paths = seg.asset_paths || [];
    const next = { ...(seg.asset_trims || {}) };
    if (fr && paths.length > 1) {
      const w = {};
      paths.forEach((p, i) => { w[p] = Number((fr[i] * paths.length).toFixed(3)); });
      if (Object.values(w).every((v) => Math.abs(v - 1) < 0.02)) delete next.__weights; else next.__weights = w;
    } else {
      delete next.__weights;
    }
    try {
      await saveField(id, "asset_trims", next);
    } catch (err) {
      showMsg("비중 저장 실패: " + err.message, false);
    }
    refreshClipView(id);
    pvRefreshCard(id);   // 비중이 바뀌면 미리보기의 클립 전환 시점도 바뀐다
  }

  // ───── 타임라인 손가락 동작: 짧게 누르기 = 고르기, 길게(0.4초) = 순서 바꾸기, 가로로 끌기/눈금 = 미리보기 이동 ─────
  // (경계 손잡이는 startTimelineDrag가 따로 받는다)
  const LONG_PRESS_MS = 400, MOVE_SLOP = 8;
  function bindTimelineGestures(el) {
    const host = el.querySelector(".seg-tl-area");
    const id = el.dataset.id;
    let g = null;   // 지금 손가락 동작 { mode: "wait" | "scrub" | "ro", ... }
    host.addEventListener("contextmenu", (e) => e.preventDefault());   // 길게 누를 때 폰 메뉴/이미지 저장 팝업 막기
    host.addEventListener("dragstart", (e) => e.preventDefault());
    // 순서 바꾸기·미리보기 이동 중에는 화면이 같이 스크롤되지 않게
    host.addEventListener("touchmove", (e) => { if (g && (g.mode === "scrub" || g.mode === "ro") && e.cancelable) e.preventDefault(); }, { passive: false });
    host.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const seg = segOfEl(el);
      if (b.classList.contains("seg-tl-add")) { toggleAddMenu(el, b); return; }
      if (b.classList.contains("seg-tl-reset")) { saveWeights(id, null); return; }
      if (!el._selPath || !seg) return;
      if (b.classList.contains("seg-tool-trim")) openTrimModal(id, el._selPath);
      else if (b.classList.contains("seg-tool-pos")) openPosModal(id, el._selPath);
      else if (b.classList.contains("seg-tool-del")) removeSegmentAsset(id, el._selPath);
    });
    host.addEventListener("pointerdown", (e) => {
      if (g || e.button > 0) return;
      if (e.target.closest(".seg-tl-handle, button, a")) return;
      const ruler = e.target.closest(".seg-tl-ruler");
      const clip = e.target.closest(".seg-tl-clip");
      if (!ruler && !clip) return;
      closeAddMenus();
      host.dataset.dragging = "1";   // 손가락을 뗄 때까지 타임라인을 다시 그리지 않는다
      if (ruler) {
        g = { mode: "scrub", pid: e.pointerId };
        try { host.setPointerCapture(e.pointerId); } catch {}
        scrubAt(el, e.clientX);
        return;
      }
      clip.classList.add("pressing");
      g = { mode: "wait", pid: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, idx: Number(clip.dataset.i), clip };
      const cur = g;
      g.timer = setTimeout(() => { if (g === cur && g.mode === "wait") startReorder(el, g); }, LONG_PRESS_MS);
    });
    host.addEventListener("pointermove", (e) => {
      if (!g || e.pointerId !== g.pid) return;
      g.lastX = e.clientX;
      if (g.mode === "wait") {
        const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
        if (Math.abs(dx) > MOVE_SLOP && Math.abs(dx) > Math.abs(dy)) {
          // 가로로 끌면 미리보기를 그 시점으로 옮긴다
          clearTimeout(g.timer);
          g.clip.classList.remove("pressing");
          g.mode = "scrub";
          try { host.setPointerCapture(e.pointerId); } catch {}
          scrubAt(el, e.clientX);
        } else if (Math.abs(dy) > MOVE_SLOP) {
          end(false);   // 세로로 움직이면 화면 스크롤로 본다
        }
      } else if (g.mode === "scrub") {
        scrubAt(el, e.clientX);
      } else if (g.mode === "ro") {
        moveReorder(el, g, e.clientX);
      }
    });
    const end = (ok) => {
      if (!g) return;
      const cur = g;
      g = null;
      clearTimeout(cur.timer);
      if (cur.clip) cur.clip.classList.remove("pressing");
      try { if (host.hasPointerCapture(cur.pid)) host.releasePointerCapture(cur.pid); } catch {}
      delete host.dataset.dragging;
      if (cur.mode === "ro") finishReorder(el, cur, ok);
      else if (cur.mode === "wait" && ok) selectClip(el, cur.idx);
      else refreshClipView(id);
    };
    host.addEventListener("pointerup", (e) => { if (g && e.pointerId === g.pid) end(true); });
    host.addEventListener("pointercancel", (e) => { if (g && e.pointerId === g.pid) end(false); });
  }
  // 탭: 클립 고르기(다시 탭하면 해제). 고르면 미리보기가 그 클립 시작 화면으로 간다
  function selectClip(el, idx) {
    const seg = segOfEl(el);
    const p = seg && (seg.asset_paths || [])[idx];
    if (p == null) return;
    el._selPath = el._selPath === p ? null : p;
    refreshClipView(el.dataset.id);
    if (el._selPath) pvSeekClip(el, idx);
  }
  // 미리보기를 idx번 클립의 시작 화면으로
  function pvSeekClip(el, idx) {
    const seg = segOfEl(el);
    if (!seg || idx < 0) return;
    const plan = clipPlan(seg, pvSecsOf(el, seg));
    if (!plan[idx]) return;
    pvSeek(el, plan.slice(0, idx).reduce((a, c) => a + c.alloc, 0) + 0.02);
  }
  function scrubAt(el, clientX) {
    const bar = el.querySelector(".seg-tl");
    if (!bar) return;
    const r = bar.getBoundingClientRect();
    const left = r.left + bar.clientLeft;
    const f = Math.min(1, Math.max(0, (clientX - left) / (bar.clientWidth || 1)));
    const ctx = pvActivate(el);
    if (ctx) pvSeek(el, f * ctx.secs);
  }

  // 길게 누르기: 클립들을 같은 크기의 세로 카드로 늘어놓고, 손을 떼지 않고 좌우로 끌어 순서를 바꾼다
  function roFillHtml(seg, p) {
    if (isBlank(p)) return "";
    const u = thumbNow(p);
    if (u) return `<img src="${escapeAttr(u)}" alt="" draggable="false" style="object-position:${clipFocusPos(seg, p)};">`;
    if (isVideo(p)) return `<video src="${escapeAttr(assetUrl(p))}#t=0.1" muted playsinline preload="metadata"></video>`;
    return "";
  }
  function startReorder(el, g) {
    const seg = segOfEl(el);
    const host = el.querySelector(".seg-tl-area");
    const paths = [...((seg && seg.asset_paths) || [])];
    if (!seg || paths.length < 2) return;   // 클립이 1개면 순서 바꿀 게 없다 (손을 떼면 그냥 고르기)
    g.mode = "ro";
    g.clip.classList.remove("pressing");
    // 손가락을 계속 받도록 붙잡는다 (원래 클립 칸은 지우지 않고 숨겨 둔다 — 지우면 폰에서 터치가 끊긴다)
    try { host.setPointerCapture(g.pid); } catch {}
    if (navigator.vibrate) { try { navigator.vibrate(20); } catch {} }
    if (pvActive && pvActive.el === el && pvActive.playing) pvStop(pvActive);
    const n = paths.length, gap = 6;
    const avail = host.clientWidth || 280;
    const w = Math.max(18, Math.min(56, Math.floor((avail - gap * (n - 1)) / n)));
    const h = Math.round(w * 16 / 9);
    const plan = clipPlan(seg, pvSecsOf(el, seg));
    Object.assign(g, { paths, step: w + gap, to: g.idx, rx0: g.lastX });
    const wrap = document.createElement("div");
    wrap.className = "seg-ro-wrap";
    wrap.innerHTML = `<div class="seg-ro-head">순서 바꾸기 — 좌우로 끌고 손을 떼세요</div>
      <div class="seg-ro">${paths.map((p, i) =>
        `<div class="seg-ro-card ${clipKind(p)}${i === g.idx ? " held" : ""}" style="width:${w}px;height:${h}px;">${roFillHtml(seg, p)}${clipLabHtml(i, plan[i])}</div>`).join("")}</div>`;
    host.classList.add("ro-on");
    host.appendChild(wrap);
    g.wrap = wrap;
    g.cards = [...wrap.querySelectorAll(".seg-ro-card")];
    g.cards[g.idx].style.transform = "scale(1.08)";
    // 미리보기 자리에는 잡고 있는 클립을 크게
    const p = paths[g.idx];
    const ro = el.querySelector(".seg-stage-ro");
    const big = isBlank(p) ? `<div class="ro-big ${blankClass(p)}"></div>`
      : isImage(p) ? `<img class="ro-big" src="${escapeAttr(assetUrl(p))}" alt="" draggable="false" style="object-position:${clipFocusPos(seg, p)};">`
      : thumbNow(p) ? `<img class="ro-big" src="${escapeAttr(thumbNow(p))}" alt="" draggable="false">`
      : `<video class="ro-big" src="${escapeAttr(assetUrl(p))}#t=0.1" muted playsinline preload="metadata"></video>`;
    ro.innerHTML = `${big}${isPexels(p) ? `<div class="pv-ref">${PV_REF_TEXT}</div>` : ""}<div class="ro-hint">${g.idx + 1}번 클립<br>순서를 바꾸려면 끌어다 놓으세요</div>`;
    ro.classList.add("on");
  }
  function moveReorder(el, g, x) {
    const n = g.cards.length;
    const dx = Math.max(-g.idx * g.step, Math.min((n - 1 - g.idx) * g.step, x - g.rx0));
    const to = Math.max(0, Math.min(n - 1, Math.round(g.idx + dx / g.step)));
    g.to = to;
    g.cards.forEach((c, i) => {
      if (i === g.idx) { c.style.transform = `translateX(${dx}px) scale(1.08)`; return; }
      let shift = 0;
      if (g.idx < to && i > g.idx && i <= to) shift = -g.step;
      if (g.idx > to && i < g.idx && i >= to) shift = g.step;
      c.style.transform = shift ? `translateX(${shift}px)` : "";
    });
    const hint = el.querySelector(".seg-stage-ro .ro-hint");
    if (hint) hint.innerHTML = to === g.idx ? `${g.idx + 1}번 클립<br>순서를 바꾸려면 끌어다 놓으세요` : `${g.idx + 1}번 → ${to + 1}번 자리로<br>손을 떼면 바뀌어요`;
  }
  async function finishReorder(el, g, ok) {
    const host = el.querySelector(".seg-tl-area");
    host.classList.remove("ro-on");
    if (g.wrap) g.wrap.remove();
    const ro = el.querySelector(".seg-stage-ro");
    ro.classList.remove("on");
    ro.innerHTML = "";
    const id = el.dataset.id;
    const seg = segOfEl(el);
    if (!ok || !seg || g.to === g.idx) { refreshClipView(id); return; }
    if ((seg.asset_paths || []).join("\n") !== g.paths.join("\n")) {   // 끄는 사이 소재가 바뀌었다 (자동 배치 등)
      showMsg("그 사이 소재가 바뀌어서 순서를 바꾸지 않았어요. 다시 해 주세요.", false);
      refreshThumbs(id);
      return;
    }
    const next = [...g.paths];
    const [moved] = next.splice(g.idx, 1);
    next.splice(g.to, 0, moved);
    el._selPath = moved;
    try {
      // 순서만 바뀐다 (__weights·구간·위치는 소재 경로가 키라 그대로 따라간다)
      await saveField(id, "asset_paths", next);
    } catch (err) {
      showMsg("순서 저장 실패: " + err.message, false);
    }
    refreshThumbs(id);
    pvSeekClip(el, (seg.asset_paths || []).indexOf(moved));   // 미리보기는 옮긴 클립의 시작 화면으로
  }

  // + 메뉴: 내 사진/영상 · Pexels에서 찾기 · 빈 화면 (무엇이든 맨 뒤에 추가)
  function closeAddMenus() {
    document.querySelectorAll(".seg-add-menu.open").forEach((m) => m.classList.remove("open"));
    document.querySelectorAll(".seg-tl-add.on").forEach((b) => b.classList.remove("on"));
  }
  function toggleAddMenu(el, btn) {
    const menu = el.querySelector(".seg-add-menu");
    const open = !menu.classList.contains("open");
    closeAddMenus();
    if (!open) return;
    const mr = el.querySelector(".seg-media").getBoundingClientRect(), br = btn.getBoundingClientRect();
    menu.style.top = (br.bottom - mr.top + 6) + "px";
    menu.querySelector(".seg-add-blanks").style.display = "none";
    menu.classList.add("open");
    btn.classList.add("on");
  }
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".seg-add-menu, .seg-tl-add")) closeAddMenus();
  });

