// storyboard/04-captions.js — 장면 길이 계산, SCRIPT/SUBTITLE 분리(계약 16절), 자막 줄(계약 6절), 긴 자막 줄 자동 끊기
// storyboard.html에서 순서 그대로 잘라낸 파일. 일반 <script>로 차례대로 불러오므로 앞 파일의 전역(let/const/function)을 그대로 쓴다.
  // 한국어 내레이션 기준 대략적인 발화 속도 추정치(초당 글자 수) — 정확한 값은
  // 실제 TTS가 돌아야 알 수 있어서, 어디까지나 대략적인 예측용.
  const CHARS_PER_SEC = 4.3;

  function estimateSeconds(text) {
    const len = (text || "").replace(/\*\*/g, "").replace(/(^|\s)\/(?=\s|$)/g, "").replace(/\s+/g, "").length;   // 자막 끊김 표시(/)는 읽지 않는다
    return Math.max(1, len / CHARS_PER_SEC);
  }

  // 장면 길이 = 자막 줄 길이 합 (자막이 없는 장면만 노출 시간 target_seconds, 그것도 없으면 1초)
  // 새 장면(SUBTITLE 칸을 쓰는 장면, 계약서 16절)은 읽는 문장의 예상 길이 합 (읽을 문장이 없으면 같은 규칙)
  function effectiveSeconds(el, seg) {
    const text = el.querySelector(".seg-script").value;
    const st = capState(text, seg, capLiveOf(el), subOf(el, seg));
    if (st.isNew) return st.total;
    if (st.lines.length) return st.total;
    if (seg && seg.target_seconds > 0) return Number(seg.target_seconds);
    return estimateSeconds(text);
  }
  // 미리보기·타임라인 시간축 길이 (자막이 없는 장면은 미리보기 최소 2초)
  function pvSecsOf(el, seg) {
    const secs = effectiveSeconds(el, seg);
    return hasCaps(el) ? secs : Math.max(2, secs);
  }
  // 읽는 글(목소리)이 있는 장면인지. 옛 장면은 자막 줄 = 읽는 줄, 새 장면은 SCRIPT 문장
  function hasCaps(el) {
    const text = el.querySelector(".seg-script").value;
    return subOf(el, segOfEl(el)) != null ? genScriptSentences(text).length > 0 : genCaptionLines(text).length > 0;
  }
  // ───── SCRIPT / SUBTITLE 분리 (계약서 16절) ─────
  // 이 장면의 SUBTITLE(문자열 = 새 장면, "" = 자막 없음) 또는 null(옛 장면: SCRIPT 줄이 그대로 자막, 6~11절 규칙).
  // 카드에 입력 중인 값 기준. 옛 장면은 SUBTITLE 칸에 글을 쓰는 순간부터 새 장면으로 본다
  function subOf(el, seg) {
    const f = el && el.querySelector(".seg-subtitle");
    const v = f ? f.value : seg ? seg.subtitle_text : null;
    if (seg && seg.subtitle_text != null) return v == null ? "" : String(v);
    return v != null && String(v).trim() ? String(v) : null;
  }
  // DB에 subtitle_text 칸이 있는지 (youtube_tables_18_subtitle.sql 실행 전이면 장면 행에 칸 자체가 없다)
  let subColMissing = false;
  // 새 장면이 하나라도 있는 콘티 (새로 넣는 빈 장면도 새 장면으로)
  function contiIsNew() {
    return segments.some((sg) => sg.subtitle_text != null);
  }

  // ───── 자막 줄 = 화면 단위 (docs/storyboard-contract.md 6절). 식은 generate.js의 genCaption* 를 같이 쓴다 ─────
  // 옛 표시 " / "는 화면에 보여줄 때 줄바꿈으로 (저장하면 줄바꿈으로 저장된다)
  function normalizeScript(text) {
    return String(text || "").replace(/\r/g, "").replace(/[ \t]+\/[ \t]+/g, "\n");
  }
  function ttsRateNow() {
    return Number(currentSettings.tts_rate) || 0;
  }
  // 줄, 줄별 길이, 최소(예상 목소리) 길이, 직접 정한 줄인지. live: 끄는 중인 값 배열(없으면 저장된 __cap_secs)
  // sub: 새 장면의 SUBTITLE(문자열). 이때 lines = 자막 줄, 시각은 genSubtitleTimes(문장 예상 길이 기준), sents/spans = 읽는 문장
  function capState(text, seg, live, sub) {
    if (sub != null) {
      const rate = ttsRateNow();
      const sents = genScriptSentences(text);
      const spans = genSentenceSpansEst(sents, rate);
      const total = sents.length ? spans[spans.length - 1][1] : (seg && seg.target_seconds > 0 ? Number(seg.target_seconds) : estimateSeconds(text));
      const subs = genSubtitleLines(sub);
      const times = genSubtitleTimes(subs, spans, total);
      const secs = times.map((t) => t.s1 - t.s0);
      return { isNew: true, sents, spans, lines: subs, secs, est: secs, custom: subs.map(() => false), muteOnly: subs.map(() => false),
        starts: times.map((t) => t.s0), total, spoken: sents.length > 0 };
    }
    const lines = genCaptionLines(text);
    const src = live || ((seg && seg.asset_trims) || {}).__cap_secs || [];
    const rate = ttsRateNow();
    const secs = genCaptionSecs(lines, src, rate);
    const est = lines.map((l) => genCaptionEst(l, rate));
    // 길이를 직접 정할 수 있는 줄은 읽을 글자가 없는 { } 전용 줄뿐 (계약서 11절). 읽는 줄의 옛 저장값은 무시
    const muteOnly = lines.map((l) => genCaptionIsMuteOnly(l));
    const custom = lines.map((l, i) => genCaptionSetValue(l, src, i) != null);
    const starts = [];
    let acc = 0;
    secs.forEach((s) => { starts.push(acc); acc += s; });
    return { lines, secs, est, custom, muteOnly, starts, total: acc };
  }
  function capStateOf(el, seg) {
    return capState(el.querySelector(".seg-script").value, seg, capLiveOf(el), subOf(el, seg));
  }
  // 줄별 길이 원본: 끄는 중인 값 > 아직 저장 전인 초안(자동 끊기 직후) > 저장된 값(null을 돌려주면 capState가 저장된 값을 쓴다)
  function capLiveOf(el) {
    if (el._capLive) return el._capLive;
    if (el._trimsDraft) return el._trimsDraft.__cap_secs || [];
    return null;
  }
  function capPlainText(line) {
    return String(line || "").replace(/\*\*/g, "");
  }
  // 자막 트랙 블록 글자: [숨김]은 연한 기울임, {자막만}은 다른 색 점선 밑줄로(기호 없이) 보여 구분한다
  // 쉼 표시(-, 계약서 10절)는 글자 대신 작은 점(·)으로 자리만 보인다
  function capTrackHtml(line) {
    const pz = (t) => t.replace(/\u0002+/g, (m) => `<span class="pz" title="쉼 ${(m.length * GEN_CAP_PAUSE_SEC).toFixed(1)}초">${"·".repeat(m.length)}</span>`);
    const marked = String(line || "").replace(GEN_CAP_PAUSE_RE, (_, a, d) => a + "\u0002".repeat(d.length));
    return marked.split(/(\[[^\[\]]*\]|\{[^{}]*\})/).map((part) => {
      const inner = pz(escapeHtml(capPlainText(part.slice(1, -1))));
      if (/^\[[^\[\]]*\]$/.test(part)) return inner ? `<span class="hid" title="읽기만 (자막 숨김)">${inner}</span>` : "";
      if (/^\{[^{}]*\}$/.test(part)) return inner ? `<span class="mute" title="자막만 (읽지 않음)">${inner}</span>` : "";
      return pz(escapeHtml(capPlainText(part)));
    }).join("");
  }
  // 자막 한 줄을 화면용 HTML로 (**글자** → 노란 강조). [숨김]은 미리 빼고 넘긴다(genCaptionShown)
  function capLineHtml(line) {
    return String(line || "").split(/(\*\*[^*]+\*\*)/).map((part) =>
      /^\*\*[^*]+\*\*$/.test(part) ? `<span class="pv-emph">${escapeHtml(part.slice(2, -2))}</span>` : escapeHtml(part.replace(/\*\*/g, ""))
    ).join("");
  }

  // 자막 트랙 그리기: 블록 폭 = 줄 길이 비율 (영상 트랙과 같은 시간축). 끄는 중에는 다시 만들지 않고 위치만 고친다
  function updateCapView(el, seg) {
    const host = el.querySelector(".seg-cap-area");
    if (!host || !seg) return;
    const st = capStateOf(el, seg);
    if (!st.lines.length) {
      if (host.innerHTML) { host.innerHTML = ""; host._sig = null; }
      return;
    }
    const anyCustom = st.custom.some(Boolean);
    const sig = JSON.stringify([!!st.isNew, st.lines, st.custom, st.muteOnly, anyCustom]);
    if (host._sig !== sig && !host.dataset.dragging) {
      host._sig = sig;
      host.innerHTML = `
        ${anyCustom ? '<div class="seg-cap-head" style="justify-content:flex-end;"><button type="button" class="seg-cap-reset">자동으로</button></div>' : ""}
        <div class="seg-tl-row">
          <div class="seg-tl-col">
            <div class="seg-cap-track">
              ${st.lines.map((l, i) => `<div class="seg-cap-blk${st.custom[i] ? " set" : ""}" data-i="${i}"><div class="seg-cap-in"><span class="t">${st.isNew ? escapeHtml(capPlainText(l)) : capTrackHtml(l)}</span><span class="s"></span></div>${st.muteOnly[i] ? `<div class="seg-cap-handle" data-i="${i}"></div>` : ""}</div>`).join("")}
              <div class="seg-cap-play"></div>
            </div>
          </div>
        </div>`;
    }
    paintCapTrack(el, st);
  }
  function paintCapTrack(el, st) {
    const host = el.querySelector(".seg-cap-area");
    const blks = host ? host.querySelectorAll(".seg-cap-blk") : [];
    const axis = st.total || 1;
    blks.forEach((b, i) => {
      if (st.secs[i] == null) return;
      b.style.left = st.starts[i] / axis * 100 + "%";
      b.style.width = st.secs[i] / axis * 100 + "%";
      b.classList.toggle("set", st.custom[i]);
      const s = b.querySelector(".s");
      if (s) s.textContent = st.secs[i].toFixed(1) + "초";
    });
  }
  // 블록 오른쪽 끝 손잡이를 끌어 그 줄 길이를 바꾼다 (최소 = 예상 목소리 길이). 장면 길이가 바뀌므로 영상 트랙·전체 길이도 같이 다시 그린다
  let capPaintRaf = 0;
  function startCapDrag(e, el, i) {
    const seg = segOfEl(el);
    const host = el.querySelector(".seg-cap-area");
    const track = host && host.querySelector(".seg-cap-track");
    if (!seg || !track) return;
    const st = capStateOf(el, seg);
    if (!st.lines[i] || !st.muteOnly[i]) return;   // 읽는 줄은 길이를 정하지 않는다 (계약서 11절)
    e.preventDefault();
    e.stopPropagation();
    closeAddMenus();
    const handle = e.target.closest(".seg-cap-handle");
    try { handle.setPointerCapture(e.pointerId); } catch {}
    handle.classList.add("drag");
    host.dataset.dragging = "1";
    const stored = ((el._trimsDraft || seg.asset_trims || {}).__cap_secs || []);
    el._capLive = st.lines.map((_, k) => (stored[k] != null && Number(stored[k]) > 0 ? Number(stored[k]) : null));
    const pps = (track.clientWidth || 1) / (st.total || 1);   // 끄는 동안 손가락 1px = 시작할 때 축 기준 초
    const x0 = e.clientX, len0 = st.secs[i], est = st.est[i];
    let moved = false;
    const move = (ev) => {
      if (Math.abs(ev.clientX - x0) > 2) moved = true;
      if (!moved) return;
      const v = Math.min(60, Math.max(est, len0 + (ev.clientX - x0) / pps));
      el._capLive[i] = v <= est + 0.005 ? est : Math.round(v * 20) / 20;   // 0.05초 단위 (최소는 예상 길이 그대로)
      paintCapTrack(el, capStateOf(el, seg));
      if (!capPaintRaf) capPaintRaf = requestAnimationFrame(() => { capPaintRaf = 0; updateRuntimeSummary(); });
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.classList.remove("drag");
      delete host.dataset.dragging;
      if (moved) saveCapSecs(String(seg.id), el._capLive.slice());
      else { el._capLive = null; updateRuntimeSummary(); }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  // 줄별 길이를 asset_trims.__cap_secs에 저장 (null = 자동). 전부 자동이면 칸을 지운다
  async function saveCapSecs(id, arr) {
    const seg = segments.find((s) => String(s.id) === String(id));
    const el = document.querySelector(`.seg-item[data-id="${id}"]`);
    if (!seg) return;
    const next = { ...((el && el._trimsDraft) || seg.asset_trims || {}) };
    if (el && el._trimsDraft) el._trimsDraft = next;   // 저장 전 초안이 있으면 초안도 같이 고친다 (카드 저장 때 덮어쓰지 않게)
    const vals = (arr || []).map((v) => (v != null && Number(v) > 0 ? Number(Number(v).toFixed(2)) : null));
    if (vals.some((v) => v != null)) next.__cap_secs = vals; else delete next.__cap_secs;
    try {
      await saveField(id, "asset_trims", next);
    } catch (err) {
      showMsg("자막 길이 저장 실패: " + err.message, false);
    } finally {
      if (el) el._capLive = null;
    }
    updateRuntimeSummary();
    pvRefreshCard(id);   // 자막 구간·장면 길이가 바뀌었으니 미리보기도 다시
  }
  function bindCapGestures(el) {
    const host = el.querySelector(".seg-cap-area");
    host.addEventListener("contextmenu", (e) => e.preventDefault());
    host.addEventListener("pointerdown", (e) => {
      const h = e.target.closest(".seg-cap-handle");
      if (h && e.button <= 0) startCapDrag(e, el, Number(h.dataset.i));
    });
    host.addEventListener("click", (e) => {
      if (e.target.closest(".seg-cap-reset")) { saveCapSecs(el.dataset.id, null); return; }
      if (e.target.closest(".seg-cap-handle")) return;
      const b = e.target.closest(".seg-cap-blk");
      if (!b) return;
      const seg = segOfEl(el);
      if (!seg) return;
      const st = capStateOf(el, seg);
      const i = Number(b.dataset.i);
      if (st.starts[i] != null) pvSeek(el, st.starts[i] + 0.02);   // 미리보기가 그 줄 시작으로
      capEditToggle(el, i);
    });
  }

  // 자막 블록을 누르면 미리보기 옆 SCRIPT 칸(새 장면은 SUBTITLE 칸)에서 그 줄을 선택해 바로 고칠 수 있게 한다
  function capEditToggle(el, i) {
    const ta = el.querySelector(subOf(el, segOfEl(el)) != null ? ".seg-subtitle" : ".seg-script");
    if (!ta) return;
    let pos = 0, n = -1;
    for (const line of ta.value.split("\n")) {   // i번째 자막 줄(빈 줄 제외)
      if (line.trim() && ++n === i) { ta.focus({ preventScroll: true }); ta.setSelectionRange(pos, pos + line.length); break; }
      pos += line.length + 1;
    }
  }

  // ───── 긴 자막 줄 자동 끊기 ─────
  // 줄바꿈이 없는 옛 대사(한 장면이 긴 한 줄)는 화면에 통째로 나와 버린다. 화면 폭(전체 설정의 자막 글자 크기)을 넘는 줄만
  // 예전 자동 끊기 규칙(영상 쪽 02_tts.py의 group_words / _split_run_by_width / CaptionFit)으로 나눠 실제 줄바꿈으로 써 넣는다.
  // 사용자는 그 줄을 보고 줄바꿈을 지우거나 넣어서 고친다. 직접 합친 긴 줄은 다시 끊지 않는다(asset_trims.__cap_manual).
  function capMeasurer() {
    const size = Number($("capSize").value) || Number(currentSettings.caption_font_size) || 80;
    const wt = WEIGHTS[Number($("capWeight").value)] || WEIGHTS[0];
    capMeasurer.ctx = capMeasurer.ctx || document.createElement("canvas").getContext("2d");
    const ctx = capMeasurer.ctx;
    const font = `${wt.weight} ${size}px ${wt.family}, sans-serif`;
    ctx.font = font;
    return { size, font, avail: (1080 - 40 - 2 * 3) * 0.98, width: (t) => ctx.measureText(t).width };
  }
  // 한 줄에 들어가는지 (조금 넘치면 자간 7%·장평 85%까지 줄여 한 줄로 넣는 영상 쪽 규칙과 같다)
  function capFits(m, text) {
    const w = m.width(text);
    if (w <= m.avail) return true;
    const n = Math.max(1, text.length);
    if ((w - m.avail) / n * 1.05 <= 0.07 * m.size) return true;
    const w2 = w - 0.07 * m.size * n;
    return w2 > 0 && m.avail / w2 >= 0.85;
  }
  // 글꼴 폭을 못 잴 때: 6단어/18자 기준으로 비슷한 길이로 (02_tts.py의 _split_run)
  function capSplitRun(run, maxWords, maxChars) {
    const n = run.length;
    if (n <= 1) return n ? [run] : [];
    const total = run.reduce((a, x) => a + x.p.length + 1, 0);
    const k = Math.min(n, Math.max(Math.ceil(n / maxWords), Math.ceil(total / maxChars)));
    if (k <= 1) return [run];
    const out = [];
    let start = 0;
    for (let part = 1; part < k; part++) {
      const left = k - part + 1;
      const rest = run.slice(start).reduce((a, x) => a + x.p.length + 1, 0);
      const target = rest / left;
      let best = null, acc = 0;
      for (let j = start; j < n - (left - 1); j++) {
        acc += run[j].p.length + 1;
        const cost = Math.abs(acc - target) - (/[,，]$/.test(run[j].p) ? 3 : 0);
        if (!best || cost < best.cost) best = { cost, j };
        if (acc > target * 1.6) break;
      }
      out.push(run.slice(start, best.j + 1));
      start = best.j + 1;
    }
    out.push(run.slice(start));
    return out;
  }
  // 화면 폭 기준: 덩어리마다 한 줄에 들어가도록 폭이 고르게 나눈다 (02_tts.py의 _split_run_by_width)
  function capSplitRunWidth(run, m) {
    const n = run.length;
    if (n <= 1) return n ? [run] : [];
    const textOf = (ws) => ws.map((x) => x.p).filter(Boolean).join(" ");
    const total = m.width(textOf(run));
    for (let k = Math.max(1, Math.ceil(total / (m.avail * 1.06))); k <= n; k++) {
      const out = [];
      let start = 0;
      for (let part = 1; part < k; part++) {
        const left = k - part + 1;
        const target = m.width(textOf(run.slice(start))) / left;
        let best = null;
        for (let j = start; j < n - (left - 1); j++) {
          const w = m.width(textOf(run.slice(start, j + 1)));
          const cost = Math.abs(w - target) - (/[,，]$/.test(run[j].p) ? 0.6 * m.size : 0);
          if (!best || cost < best.cost) best = { cost, j };
          if (w > target * 1.6) break;
        }
        out.push(run.slice(start, best.j + 1));
        start = best.j + 1;
      }
      out.push(run.slice(start));
      if (out.every((g) => capFits(m, textOf(g)))) return out;
    }
    return run.map((x) => [x]);
  }
  // 지금 콘티의 "붙여 둘 말"(keep_together_terms, 쉼표 구분)
  function capKeepTerms() {
    const row = scripts.find((r) => String(r.id) === String($("scriptSelect").value));
    return String((row && row.keep_together_terms) || "").split(",").map((t) => t.replace(/\s+/g, "")).filter(Boolean);
  }
  // 한 줄을 단어로. **강조**는 (여러 단어여도, 뒤에 붙은 조사·문장부호까지) 한 단어로 묶고 단독 자막으로 둔다.
  // 붙여 둘 말은 이어붙인 글자가 그 말로 시작하면 한 단어로 묶는다 (02_tts.py의 merge_matching_phrases)
  function capTokens(line, terms) {
    const raw = [];
    let acc = null;
    // [숨김]·{자막만} 구간은 한 덩어리 (안의 공백을 잠시 \u0001로 바꿔 쪼개지 않게)
    const glued = String(line).replace(/\[[^\[\]]*\]|\{[^{}]*\}/g, (s) => s.replace(/\s/g, "\u0001"));
    glued.split(/\s+/).filter(Boolean).forEach((w) => {
      acc = acc == null ? w : acc + " " + w;
      if (((acc.match(/\*\*/g) || []).length % 2) === 0) { raw.push(acc); acc = null; }
    });
    if (acc != null) raw.push(acc);
    // p = 화면에 보이는 글자(폭 재기용, [숨김] 제외), w = 원문(대괄호 그대로)
    const toks = raw.map((w0) => { const w = w0.replace(/\u0001/g, " "); return { w, p: capPlainText(genCaptionShown(w)), solo: /\*\*/.test(w) }; });
    if (!terms.length) return toks;
    const out = [];
    for (let i = 0; i < toks.length; ) {
      let len = 0;
      if (!toks[i].solo) {
        for (const term of terms) {
          let concat = "";
          for (let j = i; j < toks.length && !toks[j].solo; j++) {
            concat += toks[j].p;
            if (concat.startsWith(term)) { len = j - i + 1; break; }
            if (!term.startsWith(concat)) break;
          }
          if (len) break;
        }
      }
      if (len > 1) {
        const g = toks.slice(i, i + len);
        out.push({ w: g.map((x) => x.w).join(" "), p: g.map((x) => x.p).join(" "), solo: false });
        i += len;
      } else { out.push(toks[i]); i += 1; }
    }
    return out;
  }
  function capLineFits(m, line) {
    const vis = capPlainText(genCaptionShown(line)).trim();   // [숨김] 글자는 화면에 없으니 폭에서 뺀다
    return m ? capFits(m, vis) : vis.replace(/\s+/g, "").length <= 18;
  }
  // 긴 한 줄 → 여러 줄. 문장 끝(. ? ! 등)에서 먼저 끊고, 그래도 넘치면 단어 경계에서 고르게 나눈다
  function capSplitLine(line, m, terms) {
    if (capLineFits(m, line)) return [line.trim()];
    const lines = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const parts = m ? capSplitRunWidth(run, m) : capSplitRun(run, 6, 18);
      parts.forEach((g) => lines.push(g.map((x) => x.w).join(" ")));
      run = [];
    };
    capTokens(line, terms).forEach((t) => {
      if (t.solo) { flush(); lines.push(t.w); return; }
      run.push(t);
      if (/[.?!。…？！]["'”’)\]]*$/.test(t.p)) flush();
    });
    flush();
    return lines.length ? lines : [line.trim()];
  }
  function capMeasurerSafe() {
    try { return capMeasurer(); } catch { return null; }
  }
  // 대사 전체에서 화면 폭을 넘는 줄만 나눈다. 나눈 줄의 __cap_secs는 null(자동)로, 뒤 줄의 값은 인덱스를 밀어 그대로 둔다
  function capAutoSplit(text, capSecs, m) {
    const terms = capKeepTerms();
    const src = Array.isArray(capSecs) ? capSecs : null;
    const outRows = [], secs = [];
    let idx = 0, changed = false;
    normalizeScript(text).split("\n").forEach((row) => {
      if (!row.trim()) { outRows.push(row); return; }
      const parts = capSplitLine(row, m, terms);
      if (parts.length > 1) {
        changed = true;
        parts.forEach((p) => { outRows.push(p); secs.push(null); });
      } else {
        outRows.push(row);
        secs.push(src && src[idx] != null ? src[idx] : null);
      }
      idx++;
    });
    if (!changed) return { changed: false, text, capSecs };
    return { changed: true, text: outRows.join("\n"), capSecs: src && secs.some((v) => v != null) ? secs : null };
  }
  function capHasLong(text, m) {
    return genCaptionLines(text).some((l) => !capLineFits(m, l));
  }
  // 긴 줄이 이전 값의 이웃한 두 줄을 이어붙인 것이면 = 사용자가 줄바꿈을 지워서 직접 합친 줄
  function capIsMerged(text, beforeText) {
    const prev = genCaptionLines(beforeText).map((l) => l.replace(/\s+/g, ""));
    if (prev.length < 2) return false;
    const m = capMeasurerSafe();
    return genCaptionLines(text).filter((l) => !capLineFits(m, l)).some((l) => {
      const c = l.replace(/\s+/g, "");
      for (let i = 0; i + 1 < prev.length; i++) if (prev[i] && prev[i + 1] && c.includes(prev[i] + prev[i + 1])) return true;
      return false;
    });
  }
  // 칸에서 나갈 때. 바뀐 게 있으면 true (저장 전 초안 el._trimsDraft에 __cap_secs / __cap_manual을 담는다)
  function capBlurSplit(el, beforeText) {
    const seg = segOfEl(el);
    const ta = el.querySelector(".seg-script");
    if (!seg || !ta) return false;
    if (subOf(el, seg) != null) return false;   // 새 장면: SCRIPT는 읽기만 하고 화면에 안 나온다
    const now = ta.value;
    if (beforeText != null && now === beforeText) return false;   // 고친 게 없으면 그대로
    const trims = el._trimsDraft || seg.asset_trims || {};
    const m = capMeasurerSafe();
    if (!capHasLong(now, m)) {
      // 긴 줄이 없어졌으면 "직접 정함" 표시도 푼다 (다음에 긴 글을 붙여 넣으면 다시 자동으로 끊긴다)
      if (!trims.__cap_manual) return false;
      const next = { ...trims };
      delete next.__cap_manual;
      el._trimsDraft = next;
      return true;
    }
    if (trims.__cap_manual || capIsMerged(now, beforeText || "")) {
      if (trims.__cap_manual) return false;
      el._trimsDraft = { ...trims, __cap_manual: true };
      return true;
    }
    const r = capAutoSplit(now, trims.__cap_secs, m);
    if (!r.changed) return false;
    const next = { ...trims };
    if (r.capSecs) next.__cap_secs = r.capSecs; else delete next.__cap_secs;
    ta.value = r.text;
    el._trimsDraft = next;
    return true;
  }
  // 콘티를 열 때: 화면 폭을 넘는 줄이 있는 장면만 그 줄을 나눠 바로 저장한다 (짧은 줄·직접 정한 장면은 건드리지 않는다)
  async function capAutoSplitOnOpen(scriptId) {
    let m = capMeasurerSafe();
    if (m && document.fonts && document.fonts.load) {
      // 글꼴이 아직 안 내려왔으면 폭이 틀리게 재진다. 기다린 뒤 다시 잰다 (최대 3초)
      try { await Promise.race([document.fonts.load(m.font, "가나다"), new Promise((r) => setTimeout(r, 3000))]); } catch {}
      m = capMeasurerSafe();
    }
    let done = 0;
    for (const seg of segments.slice()) {
      if (String($("scriptSelect").value) !== String(scriptId)) return;   // 그 사이 다른 콘티로 넘어갔다
      const trims = seg.asset_trims || {};
      if (trims.__cap_manual || seg.subtitle_text != null) continue;   // 새 장면은 SCRIPT를 화면에 안 보여서 끊지 않는다
      const el = document.querySelector(`.seg-item[data-id="${seg.id}"]`);
      if (!el || el.dataset.dirty || el._trimsDraft || el.contains(document.activeElement)) continue;   // 고치는 중인 카드는 건드리지 않는다
      const ta = el.querySelector(".seg-script");
      const r = capAutoSplit(ta.value, trims.__cap_secs, m);
      if (!r.changed) continue;
      const fields = { script_text: r.text };
      if (r.capSecs || trims.__cap_secs) {
        const next = { ...trims };
        if (r.capSecs) next.__cap_secs = r.capSecs; else delete next.__cap_secs;
        fields.asset_trims = next;
      }
      ta.value = r.text;
      try {
        await saveFields(seg.id, fields);
        done++;
      } catch (err) {
        el.dataset.dirty = "1";   // 저장 실패: 카드에서 나갈 때 다시 저장한다
        if (fields.asset_trims) el._trimsDraft = fields.asset_trims;
        showMsg("자막 줄 자동 나누기 저장 실패: " + err.message, false);
      }
      if (pvActive && pvActive.el === el) pvRefreshCard(String(seg.id)); else pvIdle(el, seg);
    }
    if (done) updateRuntimeSummary();
  }

  // 장면이 길어서 사진 하나가 오래 머물면 지루하다. 콘티를 열 때 모자란 컷을 키워드로 Pexels 영상으로 자동 배치하지만
  // (영상 생성 때는 더 채우지 않는다), 그래도 모자라면 카드에 알려준다. (기준은 4.5초당 1컷, 7초 넘는 장면부터)
  function updateMediaHints(perCard) {
    perCard.forEach(({ el, seconds }) => {
      const seg = segments.find((s) => String(s.id) === el.dataset.id);
      const hint = el.querySelector(".seg-media-hint");
      if (!hint || !seg) return;
      updateClipView(el, seg, seconds);
      const have = (seg.asset_paths || []).length;
      const need = needClips(seconds);
      const af = (seg.asset_trims || {}).__autofill;
      if (partOf(el.querySelector(".seg-section").value) === SUBSCRIBE_PART) {
        // 구독 안내 카드는 사진을 안 넣으면 영상 만들 때 마녀 사진이 자동으로 들어간다
        hint.style.display = have ? "none" : "block";
        hint.textContent = "사진을 따로 넣지 않으면 마녀 사진이 영상마다 하나씩 자동으로 들어가요. 원하는 사진을 넣으면 그 사진을 써요.";
      } else if (have > 0 && seconds > 7 && have < need && !autofillBusy.has(String(seg.id))) {
        const why = af && af.status === "quota" ? " Pexels 한도 초과로 자동 배치를 못 했어요."
          : af && af.status === "no_results" ? " 키워드 검색 결과가 없어 자동 배치를 못 했어요."
          : af && af.status === "error" ? " 자동 배치에 실패했어요." : "";
        hint.style.display = "block";
        hint.textContent = `약 ${Math.round(seconds)}초 장면인데 사진·영상이 ${have}개예요. ${need - have}개 이상 더 넣으면 화면이 자주 바뀌어 덜 지루해요.${why} (영상 생성 때 따로 채워지지 않고, 지금 클립들이 비중대로 나뉘어요)`;
      } else {
        hint.style.display = "none";
      }
    });
  }

  function updateRuntimeSummary() {
    const box = document.getElementById("runtimeSummary");
    const cards = Array.from(document.querySelectorAll(".seg-item"));
    if (!cards.length) { box.style.display = "none"; $("fullPvBox").style.display = "none"; updateOverview([], 0); return; }

    const perCard = cards.map((el) => ({
      el, seconds: effectiveSeconds(el, segments.find((s) => String(s.id) === el.dataset.id)),
    }));
    updateMediaHints(perCard);
    const total = perCard.reduce((sum, c) => sum + c.seconds, 0);

    perCard.forEach(({ el, seconds }) => {
      const pct = total > 0 ? (seconds / total) * 100 : 0;
      const display = el.querySelector(".seg-duration-display");
      if (display) display.textContent = `${seconds.toFixed(1)}초 (${pct.toFixed(0)}%)`;
      // 자막 줄이 있는 장면은 자막 트랙이 길이를 정한다 → 노출 시간 "수정"은 자막이 없는 장면에서만
      updateCapView(el, segOfEl(el));
      const editBtn = el.querySelector(".seg-duration-edit");
      const durIn = el.querySelector(".seg-duration-input");
      if (editBtn && !(durIn && durIn.style.display !== "none")) editBtn.style.display = hasCaps(el) ? "none" : "inline-block";
    });

    box.style.display = "block";
    $("fullPvBox").style.display = "block";
    updateOverview(refreshGroupHeaders(), total);
  }

