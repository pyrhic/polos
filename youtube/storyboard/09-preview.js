// storyboard/09-preview.js — 장면 미리보기(화면 전환), 카드 안 미리보기 엔진
// storyboard.html에서 순서 그대로 잘라낸 파일. 일반 <script>로 차례대로 불러오므로 앞 파일의 전역(let/const/function)을 그대로 쓴다.
  // ───── 장면 미리보기 (간이) ─────
  // 영상 쪽(03_build_visuals/04_assemble/05)과 같은 규칙을 브라우저에서 흉내낸다: 컷 수는 4.5초당 1컷, 연출 키워드, 자막은 6단어/18자 단위.
  const PV_DIRECTIONS = [
    ["zoom_out", ["줌아웃", "줌 아웃", "zoom out", "축소"]],
    ["pan_right", ["좌에서 우", "왼쪽에서 오른쪽", "오른쪽으로", "pan right"]],
    ["pan_left", ["우에서 좌", "오른쪽에서 왼쪽", "왼쪽으로", "pan left"]],
    ["tilt_down", ["틸트 다운", "위에서 아래", "아래로", "tilt down"]],
    ["tilt_up", ["틸트 업", "틸트", "아래에서 위", "위로", "tilt up"]],
    ["zoom_in", ["줌인", "줌 인", "zoom in", "확대"]],
  ];
  function pvMode(direction, idx) {
    const t = (direction || "").toLowerCase();
    for (const [mode, words] of PV_DIRECTIONS) if (words.some((w) => t.includes(w.toLowerCase()))) return mode;
    return idx % 2 === 0 ? "zoom_in" : "zoom_out";
  }
  function pvKenBurns(img, mode, len) {
    const zin = Math.min(1 + 0.024 * len, 1.35), zout = Math.max(1.15 - 0.024 * len, 1);
    const f = {
      zoom_in: [{ transform: "scale(1)" }, { transform: `scale(${zin})` }],
      zoom_out: [{ transform: "scale(1.15)" }, { transform: `scale(${zout})` }],
      pan_right: [{ transform: "translateX(15%) scale(1.3)" }, { transform: "translateX(-15%) scale(1.3)" }],
      pan_left: [{ transform: "translateX(-15%) scale(1.3)" }, { transform: "translateX(15%) scale(1.3)" }],
      tilt_down: [{ transform: "translateY(15%) scale(1.3)" }, { transform: "translateY(-15%) scale(1.3)" }],
      tilt_up: [{ transform: "translateY(-15%) scale(1.3)" }, { transform: "translateY(15%) scale(1.3)" }],
    }[mode];
    return img.animate(f, { duration: len * 1000, fill: "forwards", easing: "linear" });
  }
  // 자막 구간: 자막 한 줄 = 화면 한 번. 줄마다 정확한 시작·끝(초)을 자막 트랙과 같은 값으로 (영상 생성과 같은 규칙, 계약서 6절)
  // 새 장면(계약서 16절)은 SUBTITLE 줄을 genSubtitleTimes 시각으로 (show = 화면에 그대로 보일 글)
  function capGroups(el, seg) {
    const st = capStateOf(el, seg);
    if (st.isNew) return st.lines.map((l, i) => ({ raw: l, show: l, text: capPlainText(l), s0: st.starts[i], s1: st.starts[i] + st.secs[i] }));
    return st.lines.map((l, i) => ({ raw: l, text: capPlainText(genCaptionSpoken(l)), s0: st.starts[i], s1: st.starts[i] + st.secs[i] }));
  }
  // 휴대폰 목소리로 읽을 구간: 옛 장면은 자막 줄 그대로, 새 장면은 SCRIPT 문장(예상 길이)
  function capSpeechItems(el, seg) {
    const st = capStateOf(el, seg);
    if (st.isNew) return st.sents.map((t, i) => ({ raw: t, s0: st.spans[i][0], s1: st.spans[i][1] }));
    return capGroups(el, seg);
  }
  // 그 줄이 화면에 보일 글 (옛 장면은 [숨김]을 빼고 { }는 기호만 뗀다)
  function capShownOf(g) {
    return g ? (g.show != null ? g.show : genCaptionShown(g.raw)) : "";
  }
  // 정지 화면에 잡아 둘 줄: 처음으로 화면에 보이는 줄 (전부 [숨김]이면 첫 줄 → 자리 표시)
  function pvFirstVisible(groups) {
    return groups.find((g) => capPlainText(capShownOf(g)).trim()) || groups[0] || null;
  }

  // ───── 카드 안 미리보기 ─────
  // 평소엔 첫 클립의 정지 화면(가벼운 썸네일). ▶ 또는 화면을 누르면 재생, 타임라인을 누르거나 끌면 그 시점 화면.
  // 한 번에 한 카드만 살아 있다(pvActive). 다른 카드를 재생/선택하면 이전 카드는 멈추고 정지 화면으로 돌아간다.
  let pvActive = null;   // { el, id, P, secs, cuts, cutEnds, groups, size, wt, framed, t, playing, ... }
  const pvVoiceOn = true;   // 미리보기는 실제 성우 목소리(/api/tts)로, 못 불러오면 휴대폰 목소리로 읽는다 (처음 한 번 안내 팝업으로 알려준다)

  function pvParts(el) {
    const st = el.querySelector(".seg-stage");
    return {
      stage: st, media: st.querySelector(".pv-layer"),
      t1: st.querySelector(".cap-t1"), t2: st.querySelector(".cap-t2"), src: st.querySelector(".cap-src"),
      lines: st.querySelector(".cap-lines"), cap: st.querySelector(".cap-normal"), ref: st.querySelector(".pv-ref"),
      play: el.querySelector(".seg-play"), time: el.querySelector(".seg-pv-time"), info: el.querySelector(".seg-pv-info"),
    };
  }
  function fmtTime(s) {
    s = Math.max(0, Math.floor(s + 1e-6));
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }
  function pvTimeText(t, secs) {
    const total = Math.round(secs);
    return `${fmtTime(Math.min(Math.floor(t + 1e-6), total))} / ${fmtTime(total)}`;
  }
  // 화면 구성 / 제목 / 자막 모양: 지금 설정 그대로
  // P: 그릴 무대(없으면 카드 자신의 무대). 전체 미리보기는 자기 무대를 넘긴다
  function pvDecor(el, P) {
    P = P || pvParts(el);
    const framed = true;   // 콘티 화면의 영상은 늘 제목 + 영상 + 출처
    P.media.style.cssText = framed ? "top:105px;height:375px;bottom:auto;" : "";
    [[P.t1, "title1"], [P.t2, "title2"], [P.src, "sourceText"]].forEach(([node, src]) => {
      const v = $(src).value.trim();
      node.style.display = framed && v ? "block" : "none";
      node.textContent = v;
    });
    const size = Number($("capSize").value) || 80;
    const wt = WEIGHTS[Number($("capWeight").value)] || WEIGHTS[0];
    P.lines.style.bottom = (Number($("capPos").value) / 100 * 480) + "px";
    return { P, framed, size, wt };
  }
  // 자막 한 줄을 한 번에 보여준다. **강조** 부분만 노란색(강조 글꼴)
  // [숨김] 부분은 빼고 보여준다. 줄 전체가 숨김이면 재생 중엔 비우고, 멈춘 화면(still)에선 잡을 수 있게 자리 표시만
  function pvCapShow(cap, g, size, wt, still) {
    cap._g = g || null;
    const shown = g && capPlainText(capShownOf(g)).trim() ? capShownOf(g) : "";
    cap.innerHTML = shown ? capLineHtml(shown) : "";   // 숨김 줄은 실제 영상처럼 미리보기에도 아무것도 안 보인다
    cap.style.fontFamily = `${wt.family}, sans-serif`;
    cap.style.fontWeight = wt.weight;
    cap.style.color = "#fff";
    cap.style.fontSize = (size * 0.25) + "px";
  }
  // 지금 보이는 클립이 Pexels면 영상 칸 왼쪽 위에 참고 표시, 아니면 숨김
  function pvRefMark(P, p) {
    if (P.ref) P.ref.style.display = p != null && isPexels(p) ? "block" : "none";
  }
  // 클립 하나의 화면 요소. light=true면 정지 화면용(영상은 썸네일 그림으로 대신)
  function pvCutNode(seg, p, framed, light) {
    let node;
    const tr = (seg.asset_trims || {})[p];
    const start = tr && tr.start ? Number(tr.start) : 0;
    const video = isVideo(p);
    if (isBlank(p)) {
      node = document.createElement("div");
      node.classList.add(blankClass(p));
    } else if (video && !(light && thumbNow(p))) {
      node = document.createElement("video");
      node.muted = true; node.playsInline = true;
      node.preload = light ? "metadata" : "auto";
      node.src = assetUrl(p) + (light ? `#t=${(start + 0.05).toFixed(2)}` : "");
      node.dataset.start = start;
      node.addEventListener("loadedmetadata", () => noteDuration(p, node.duration));
    } else {
      node = document.createElement("img");
      node.src = video ? thumbNow(p) : assetUrl(p);
      node.alt = "";
      node.draggable = false;
    }
    node.classList.add("pv-cut");
    if (framed && isBlank(p)) {
      node.style.bottom = "auto"; node.style.height = "320px";
    } else if (framed) {
      // 세로로 긴 소재는 맨 아래까지(375px), 그 밖은 320px. 크기를 알게 되면 정한다
      const fit = () => {
        const w = node.naturalWidth || node.videoWidth, h = node.naturalHeight || node.videoHeight;
        node.style.height = (w && h && h / w >= 1.3 ? 375 : 320) + "px";
        node.style.bottom = "auto";
      };
      node.style.bottom = "auto"; node.style.height = "320px";
      node.addEventListener(node.tagName === "VIDEO" ? "loadedmetadata" : "load", fit);
    }
    const fc = ((seg.asset_trims || {}).__focus || {})[p];
    if (fc) node.style.objectPosition = `${fc.x * 100}% ${fc.y * 100}%`;
    return node;
  }
  function pvEmptyNode(el, seg) {
    const empty = document.createElement("div");
    empty.className = "pv-empty";
    const keyword = el.querySelector(".seg-keyword").value.trim();
    empty.textContent = isSubscribeSeg(seg)
      ? "사진을 넣지 않아서 영상 생성 때 마녀 사진이 하나 자동으로 들어가요"
      : `사진·영상이 없어요 — 이대로는 영상을 생성할 수 없어요. 소재나 빈 화면을 넣어주세요${keyword ? ` (키워드: '${keyword}')` : ""}`;
    return empty;
  }
  function pvInfoHtml(seg, plan, secs) {
    const shortCnt = plan.filter((c) => c.short).length;
    return `약 ${secs.toFixed(0)}초 · 컷 ${plan.length}개` + (shortCnt ? `<br><span class="warn">⚠ 짧은 영상 ${shortCnt}개(마지막 장면이 이어져요)</span>` : "");
  }

  // 정지 화면: 첫 클립 + 첫 자막. 살아 있는 카드는 건드리지 않는다. 바뀐 게 없으면 화면 요소를 다시 만들지 않는다
  function pvIdle(el, seg) {
    if (!el || !seg || !el.querySelector(".seg-stage")) return;
    if (pvActive && pvActive.el === el) return;
    const { P, framed, size, wt } = pvDecor(el);
    const paths = seg.asset_paths || [];
    const secs = pvSecsOf(el, seg);
    const p = paths[0];
    const direction = el.querySelector(".seg-direction").value;
    const key = JSON.stringify([p, framed, p ? thumbNow(p) : 0, p ? ((seg.asset_trims || {}).__focus || {})[p] : 0, p ? (seg.asset_trims || {})[p] : 0, pvMode(direction, 0)]);
    if (el._idleKey !== key) {
      el._idleKey = key;
      P.media.innerHTML = "";
      if (p == null) {
        P.media.appendChild(pvEmptyNode(el, seg));
      } else {
        const node = pvCutNode(seg, p, framed, true);
        node.style.display = "block";
        P.media.appendChild(node);
        if (!isBlank(p) && !isVideo(p)) {   // 사진은 연출(켄번즈)의 첫 모습으로 멈춰 둔다
          try { const a = pvKenBurns(node, pvMode(direction, 0), 1); a.pause(); a.currentTime = 0; } catch {}
        }
      }
    }
    pvRefMark(P, p);
    pvCapShow(P.cap, pvFirstVisible(capGroups(el, seg)), size, wt, true);
    P.play.textContent = "▶";
    P.play.classList.remove("on");
    P.time.textContent = pvTimeText(0, secs);
    P.info.innerHTML = pvInfoHtml(seg, clipPlan(seg, secs), secs);
    const ph = el.querySelector(".seg-tl-play");
    if (ph) ph.classList.remove("on");
    const cp = el.querySelector(".seg-cap-play");
    if (cp) cp.classList.remove("on");
    el.querySelectorAll(".seg-cap-blk.on").forEach((b) => b.classList.remove("on"));
  }

  // 미리보기를 살린다: 장면의 클립을 전부 순서대로, 비중(__weights)만큼 나눠 보여줄 준비 (영상 생성과 같은 규칙)
  // stage/secsOver: 전체 미리보기용 (다른 무대에 그리고, 장면 길이는 영상과 같은 effectiveSeconds)
  // groupsOver: 실제 성우 목소리로 정한 자막 줄 구간(장면 안 초). 없으면 콘티 예상 길이(est)
  function pvBuild(el, seg, stage, secsOver, groupsOver) {
    const { P, framed, size, wt } = pvDecor(el, stage);
    const direction = el.querySelector(".seg-direction").value;
    const secs = secsOver != null ? secsOver : pvSecsOf(el, seg);
    const paths = seg.asset_paths || [];
    const plan = clipPlan(seg, secs);
    el._idleKey = null;
    P.media.innerHTML = "";
    const cuts = [], cutEnds = [];
    let acc = 0;
    paths.forEach((p, k) => {
      const node = pvCutNode(seg, p, framed, false);
      P.media.appendChild(node);
      cuts.push({ node, video: isVideo(p), blank: isBlank(p), pexels: isPexels(p), mode: pvMode(direction, k), len: plan[k].alloc, t0: acc });
      acc += plan[k].alloc;
      cutEnds.push(acc);
    });
    if (!paths.length && !stage) P.media.appendChild(pvEmptyNode(el, seg));   // 전체 미리보기는 검은 화면 + 자막만
    P.ref.style.display = "none";   // pvShow가 지금 클립에 맞춰 켠다
    const groups = groupsOver || capGroups(el, seg);
    const spItems = groupsOver ? null : capSpeechItems(el, seg);   // 휴대폰 목소리용 (실제 목소리를 쓰면 필요 없다)
    P.info.innerHTML = pvInfoHtml(seg, plan, secs);
    return { el, id: String(seg.id), P, secs, cuts, cutEnds, groups, spItems, size, wt, framed,
      t: 0, playing: false, cutIdx: -1, shown: -2, raf: 0, t0: 0 };
  }
  function pvActivate(el) {
    if (pvActive && pvActive.el === el) return pvActive;
    pvDeactivate();
    const seg = segOfEl(el);
    if (!seg || !el.querySelector(".seg-stage")) return null;
    pvActive = pvBuild(el, seg);
    return pvActive;
  }
  // 살아 있던 카드를 멈추고 정지 화면으로
  function pvDeactivate() {
    const a = pvActive;
    if (!a) return;
    pvStop(a);
    pvActive = null;
    if (document.body.contains(a.el)) {
      const seg = segOfEl(a.el);
      a.el._idleKey = null;
      if (seg) pvIdle(a.el, seg);
    }
  }
  // 재생만 멈춘다 (화면은 그 자리에 둔다)
  function pvStop(ctx) {
    if (!ctx) return;
    cancelAnimationFrame(ctx.raf);
    ctx.playing = false;
    if (ctx.voiceLoading) { ctx.voiceLoading = null; vaNoteDone(); }   // 목소리 준비 중에 멈추면 준비가 끝나도 재생하지 않는다
    if (!ctx.full) { spStop(); vpStop(); }
    ctx.cuts.forEach((c) => {
      if (c.video) c.node.pause();
      else if (c.node.getAnimations) c.node.getAnimations().forEach((a) => a.pause());
    });
    ctx.P.play.textContent = "▶";
    ctx.P.play.classList.remove("on");
    if (ctx.groups.length) pvCapShow(ctx.P.cap, ctx.P.cap._g || pvFirstVisible(ctx.groups), ctx.size, ctx.wt, true);   // 멈췄는데 자막이 비었으면 첫 보이는 줄
  }
  function pvVideoAt(v, sec, play) {
    const go = () => {
      try {
        const d = v.duration;
        v.currentTime = d > 0 && isFinite(d) ? Math.min(sec, Math.max(0, d - 0.05)) : sec;
      } catch {}
      if (play) v.play().catch(() => {}); else v.pause();
    };
    if (v.readyState >= 1) go(); else v.addEventListener("loadedmetadata", go, { once: true });
  }
  function pvPlayhead(ctx) {
    if (ctx.full) return;   // 전체 미리보기는 카드 타임라인을 건드리지 않는다 (진행 막대는 fpv가 그린다)
    const ph = ctx.el.querySelector(".seg-tl-play");
    if (ph) { ph.classList.add("on"); ph.style.left = Math.min(100, ctx.t / ctx.secs * 100) + "%"; }
    // 자막 트랙도 같은 시점 (지금 나오는 줄 블록을 밝게)
    const cp = ctx.el.querySelector(".seg-cap-play");
    if (cp) { cp.classList.add("on"); cp.style.left = Math.min(100, ctx.t / ctx.secs * 100) + "%"; }
    ctx.el.querySelectorAll(".seg-cap-blk").forEach((b, i) => b.classList.toggle("on", i === ctx.shown));
    ctx.P.time.textContent = pvTimeText(ctx.t, ctx.secs);
  }
  // t초 시점 화면. seek=true면 그 시점으로 맞춘다(재생 중이 아니면 멈춘 화면)
  function pvShow(ctx, t, seek) {
    const { cuts, cutEnds } = ctx;
    if (cuts.length) {
      const tt = Math.max(0, Math.min(t, ctx.secs - 0.001));
      let ci = cutEnds.findIndex((e) => tt < e);
      if (ci < 0) ci = cuts.length - 1;
      if (ci !== ctx.cutIdx || seek) {
        ctx.cutIdx = ci;
        cuts.forEach((c, i) => {
          c.node.style.display = i === ci ? "block" : "none";
          if (i !== ci && c.video) c.node.pause();
        });
        const c = cuts[ci];
        ctx.P.ref.style.display = c.pexels ? "block" : "none";   // 그 클립이 보이는 동안 내내 (계약서 7절)
        const off = seek ? Math.max(0, tt - c.t0) : 0;
        if (c.video) {
          pvVideoAt(c.node, (Number(c.node.dataset.start) || 0) + off, ctx.playing);
        } else if (!c.blank) {
          c.node.getAnimations().forEach((a) => a.cancel());
          const a = pvKenBurns(c.node, c.mode, c.len);
          a.currentTime = off * 1000;
          if (!ctx.playing) a.pause();
        }
      }
    }
    // 자막: 그 줄의 구간(자막 트랙과 같은 시작·끝) 동안 그 줄 전체를 보여준다. 목소리는 자막 줄과 따로 이어 읽는다(spStart/spTick)
    let gi = -1;
    if (t < ctx.secs || !ctx.playing) {
      const tt = Math.max(0, Math.min(t, ctx.secs - 0.001));   // 첫 프레임 시각이 시작 시각보다 살짝 앞설 수 있다
      gi = ctx.groups.findIndex((g) => tt >= g.s0 && tt < g.s1);
    }
    if (gi !== ctx.shown) {
      ctx.shown = gi;
      // 멈춘 화면에서 자막이 비면(끝난 뒤 등) 첫 줄을 보여 둔다 — 잡아서 위치·크기·굵기를 바꿀 수 있게
      pvCapShow(ctx.P.cap, ctx.groups[gi] || (ctx.playing ? null : pvFirstVisible(ctx.groups)), ctx.size, ctx.wt, !ctx.playing);
    }
    if (ctx.playing && !ctx.full && !ctx.voice) spTick(Math.min(Math.max(0, t), ctx.secs));
    ctx.t = Math.min(Math.max(0, t), ctx.secs);
    pvPlayhead(ctx);
  }
