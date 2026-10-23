// storyboard/10-voice.js — 미리보기 음성: 실제 성우 TTS(/api/tts, 싱크), 대체 휴대폰 목소리, 미리보기·자막 안내 팝업
// storyboard.html에서 순서 그대로 잘라낸 파일. 일반 <script>로 차례대로 불러오므로 앞 파일의 전역(let/const/function)을 그대로 쓴다.
  // ───── 음성 1: 실제 성우 목소리 (영상과 같은 TTS, /api/tts) ─────
  // 영상 생성 파이프라인(youtube-automation core/02_tts.py run_line_mode / synthesize_voice_stream, 계약서 8~11절)을 그대로 흉내낸다.
  //   1. 읽을 줄 전체를 이어 TTS 한 번(3,000바이트를 넘으면 문장 끝에서 나눔) → 소리 + 단어 시각(WordBoundary)
  //   2. 묶음 앞뒤 무음 자르기(소리 시작 0.05초 전 ~ 소리 끝 0.15초 뒤)
  //   3. 줄 경계·쉼 자리는 단어 시각(글자 누적 정렬)으로 찾는다
  //   4. 무음은 ' - ' 쉼(개수 × 0.3초)과 { } 전용 줄(정한 길이, 없으면 est)에만 넣는다. 자막 없는 장면은 그 장면 길이만큼 무음
  //   5. 잘라 이어 붙인 소리 하나(AudioBuffer)를 재생하고, 줄·장면의 실제 시각으로 자막·장면 전환·진행 막대를 그린다
  // 화면은 TTS 제공자(Edge 등)와 서버 캐시를 모른다. /api/tts에 글자를 주고 {audio, words}만 받는다.
  // 실패하면 아래 휴대폰 목소리(sp*)로 돌아간다.
  const VA = { TRIM_LEAD: 0.05, TRIM_TAIL: 0.15, CUT_LEAD: 0.05, PEAK: 184 / 32768, CHUNK_GAP: 0.3, MAX_BYTES: 3000 };
  const VA_STRIP = /["'“”‘’()*]/g;                 // 파이프라인 TTS_STRIP_CHARS: 소리 내어 읽지 않는 기호
  const VA_SENT_END = /[.!?…。！？~]["'”’)\]]*$/;   // 파이프라인 SENTENCE_END_RE
  const vaCountW = (t) => (String(t || "").match(/[\p{L}\p{N}_]/gu) || []).length;   // 파이썬 \w 글자 수
  let vaCtx = null;
  // 소리 장치 (누른 순간에 만들어/깨워 둬야 나중에 소리가 난다)
  function vaAudio() {
    if (!vaCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { vaCtx = new AC({ sampleRate: 24000 }); } catch { try { vaCtx = new AC(); } catch { return null; } }
    }
    if (vaCtx.state === "suspended") vaCtx.resume().catch(() => {});
    return vaCtx;
  }
  function vaSettings() {
    return { voice: currentSettings.tts_voice || "ko-KR-InJoonNeural", rate: Number(currentSettings.tts_rate) || 0, pitch: Number(currentSettings.tts_pitch) || 0 };
  }
  // 글자 한 묶음 → { buf: AudioBuffer, words }. 같은 글자·설정은 브라우저 메모리에 둔다(서버 쪽 캐시는 /api/tts가 따로 한다)
  const vaMem = new Map();
  function vaFetch(text, s) {
    const key = JSON.stringify([text, s.voice, s.rate, s.pitch]);
    if (vaMem.has(key)) return vaMem.get(key);
    const p = (async () => {
      const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice: s.voice, rate: s.rate, pitch: s.pitch }) });
      let j = null;
      try { j = await r.json(); } catch {}
      if (!r.ok || !j || j.error || !j.audio) throw new Error((j && j.error) || `HTTP ${r.status}`);
      const bin = atob(j.audio);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const ctx = vaAudio();
      if (!ctx) throw new Error("이 브라우저는 소리 재생(Web Audio)을 못 해요");
      const buf = await new Promise((res, rej) => { const q = ctx.decodeAudioData(u8.buffer, res, rej); if (q && q.catch) q.catch(rej); });
      return { buf, words: Array.isArray(j.words) ? j.words : [] };
    })();
    vaMem.set(key, p);
    p.catch(() => vaMem.delete(key));
    while (vaMem.size > 40) vaMem.delete(vaMem.keys().next().value);
    return p;
  }
  // 자막 한 줄 → 읽을 글자(speak)·쉼 자리·글자 수 (파이프라인 split_hidden + strip_pauses + tts_text_of)
  function vaLine(raw) {
    const spoken = String(raw || "").replace(GEN_CAP_HIDE_RE, (_, a) => ` ${a} `).replace(GEN_CAP_MUTE_RE, " ").replace(/\s{2,}/g, " ").trim();
    const out = [], pauses = [];
    let chars = 0;
    spoken.split(/\s+/).filter(Boolean).forEach((tok) => {
      if (/^-+$/.test(tok)) {
        const last = pauses[pauses.length - 1];
        if (last && last[0] === chars) last[1] += tok.length; else pauses.push([chars, tok.length]);
        return;
      }
      out.push(tok);
      chars += vaCountW(tok);
    });
    const speak = out.join(" ").replace(/\*\*/g, "").replace(/(^|\s)\/(?=\s|$)/g, "$1 ").replace(/[{}\\]/g, "")
      .replace(VA_STRIP, "").replace(/\s{2,}/g, " ").trim();
    const nchars = vaCountW(speak);
    return { speak, pauses, nchars, hasVoice: nchars > 0 };
  }
  // 장면 입력: { lines, secs(줄별 콘티 길이 — { } 전용 줄의 무음 길이로 쓴다), empty(자막 없는 장면 길이) }
  // 새 장면(계약서 16절): lines = 읽는 문장(쉼·무음 없음), sub = SUBTITLE 줄 → 목소리를 만든 뒤 문장 구간으로 자막 시각을 정한다
  function vaSceneInput(el, seg, emptySecs) {
    const st = capStateOf(el, seg);
    if (st.isNew) return { lines: st.sents, secs: st.sents.map(() => 0), empty: st.sents.length ? null : emptySecs, sub: st.lines };
    return { lines: st.lines, secs: st.secs, empty: st.lines.length ? null : emptySecs };
  }
  function vaSceneKey(input) {
    const s = vaSettings();
    return JSON.stringify([s.voice, s.rate, s.pitch, input.lines, input.lines.map((l, i) => (!input.sub && genCaptionIsMuteOnly(l) ? input.secs[i] : 0)), input.sub || null]);
  }
  function vaHasVoice(input) {
    return input.lines.some((l) => vaLine(l).hasVoice);
  }
  // 읽을 줄 묶음 나누기 (파이프라인 _plan_tts_chunks): 3,000바이트를 넘을 때만, 문장부호로 끝나는 줄 뒤에서
  function vaChunks(items) {
    const enc = new TextEncoder();
    const nb = (it) => enc.encode(it.speak).length + 1;
    const chunks = [];
    let cur = [], bytes = 0;
    items.forEach((it) => {
      const b = nb(it);
      while (cur.length && bytes + b > VA.MAX_BYTES) {
        let k = -1;
        cur.forEach((x, i) => { if (VA_SENT_END.test(x.speak)) k = i; });
        if (k < 0) k = cur.length - 1;
        chunks.push(cur.slice(0, k + 1));
        cur = cur.slice(k + 1);
        bytes = cur.reduce((a, x) => a + nb(x), 0);
      }
      cur.push(it);
      bytes += b;
    });
    if (cur.length) chunks.push(cur);
    return chunks;
  }
  // 앞뒤 무음 자르기 (파이프라인 trim_bounds): 10ms 창의 최대 진폭이 -45dB를 넘는 첫/마지막 창 기준
  function vaTrim(d, sr, words) {
    const n = d.length, win = Math.max(1, Math.round(sr / 100));
    let on = -1, off = -1;
    for (let i = 0; i < n; i += win) {
      const e = Math.min(n, i + win);
      let m = 0;
      for (let k = i; k < e; k++) { const v = d[k] < 0 ? -d[k] : d[k]; if (v > m) m = v; }
      if (m > VA.PEAK) { if (on < 0) on = i; off = e; }
    }
    if (on < 0) {
      if (!words.length) return [0, n];
      on = Math.round(words[0].start * sr); off = Math.round(words[words.length - 1].end * sr);
    }
    const s = Math.max(0, on - Math.round(VA.TRIM_LEAD * sr)), e = Math.min(n, off + Math.round(VA.TRIM_TAIL * sr));
    return e > s ? [s, e] : [0, n];
  }
  // 글자 누적 위치 → 소리 시각 (파이프라인 make_time_at)
  function vaTimeAt(words, totalChars, audioEnd) {
    const spans = [];
    let cum = 0;
    words.forEach((w) => {
      const n = vaCountW(w.text);
      if (n <= 0) return;
      spans.push([cum, n, w.start, w.end]);
      cum += n;
    });
    const totalW = cum;
    return (pos) => {
      if (pos <= 0) return 0;
      if (pos >= totalChars) return audioEnd;
      if (totalW <= 0 || totalChars <= 0) return audioEnd * pos / Math.max(1, totalChars);
      const sw = pos * totalW / totalChars;
      let prevEnd = 0;
      for (const [c0, n, st, en] of spans) {
        if (sw < c0 + n - 1e-9) {
          if (sw <= c0 + 1e-9) return Math.min(st, Math.max(prevEnd, st - VA.CUT_LEAD));
          return st + (en - st) * (sw - c0) / n;
        }
        prevEnd = en;
      }
      return audioEnd;
    };
  }
  // 장면들 → { buffer, total, scenes: [{ s0, secs, groups: [{raw, text, s0, s1}] }] } (groups 시각은 장면 안 초)
  async function vaBuild(scenes) {
    const s = vaSettings();
    const items = [];
    const plans = scenes.map((sc) => {
      if (!sc.lines.length) return { empty: Math.max(0, Number(sc.empty) || 0), sub: sc.sub || null };
      const its = sc.lines.map((raw, li) => {
        const L = vaLine(raw);
        let mute = Number(sc.secs[li]) || 0;
        // 쉼 표시만 있는 줄(보이는 글자도 없음)은 쉼 길이만 (파이프라인과 같다)
        if (!L.hasVoice && !capPlainText(genCaptionShown(raw)).trim() && L.pauses.length) mute = L.pauses.reduce((a, p) => a + p[1], 0) * GEN_CAP_PAUSE_SEC;
        return { raw, ...L, mute };
      });
      its.forEach((it) => { if (it.hasVoice) items.push(it); });
      return { lines: its, sub: sc.sub || null };
    });
    if (!items.length) throw new Error("읽을 글자가 없어요");
    const chunks = vaChunks(items);
    const res = await Promise.all(chunks.map((ch) => vaFetch(ch.map((it) => it.speak).join(" "), s)));
    const sr = res[0].buf.sampleRate;

    // 1) 목소리 흐름: 묶음마다 앞뒤 무음을 자르고 이어 붙인다. 줄마다 흐름 안의 범위 a~b와 쉼 자리
    const parts = [];
    let streamLen = 0;
    chunks.forEach((chunk, ci) => {
      const data = res[ci].buf.getChannelData(0);
      const [t0, t1] = vaTrim(data, sr, res[ci].words);
      const pcm = data.subarray(t0, t1);
      const words = res[ci].words.map((w) => ({ text: w.text, start: w.start - t0 / sr, end: w.end - t0 / sr }));
      const n = pcm.length;
      const timeAt = vaTimeAt(words, chunk.reduce((a, it) => a + it.nchars, 0), n / sr);
      if (ci > 0) {
        const gap = Math.round(Math.max(0, VA.CHUNK_GAP - VA.TRIM_TAIL - VA.TRIM_LEAD) * sr);
        parts.push({ n: gap, data: null });
        const last = chunks[ci - 1][chunks[ci - 1].length - 1];
        const oldB = last.b;
        last.b = streamLen + gap;
        last.pts = last.pts.map(([p, d]) => [p === oldB ? last.b : p, d]);
        streamLen += gap;
      }
      const base = streamLen;
      const starts = [];
      let pos = 0;
      chunk.forEach((it) => { starts.push(pos); pos += it.nchars; });
      const cuts = [0, ...starts.slice(1).map((p) => Math.round(timeAt(p) * sr)), n];
      for (let k = 1; k < cuts.length; k++) cuts[k] = Math.min(Math.max(cuts[k], cuts[k - 1]), n);
      chunk.forEach((it, j) => {
        const a = cuts[j], b = cuts[j + 1];
        it.pts = it.pauses.map(([p, cnt]) => {
          const at = p <= 0 ? a : p >= it.nchars ? b : Math.min(Math.max(Math.round(timeAt(starts[j] + p) * sr), a), b);
          return [base + at, cnt * GEN_CAP_PAUSE_SEC];
        });
        it.a = base + a; it.b = base + b;
      });
      parts.push({ n, data: pcm });
      streamLen += n;
    });
    const stream = new Float32Array(streamLen);
    let o = 0;
    parts.forEach((p) => { if (p.data) stream.set(p.data, o); o += p.n; });

    // 2) 장면 순서대로 이어 붙이고, 정해진 자리에만 무음
    const pieces = [];
    let outLen = 0;
    const take = (a, b) => { if (b > a) { pieces.push([a, b]); outLen += b - a; } };
    const sil = (sec) => { const n = Math.max(0, Math.round(sec * sr)); if (n) { pieces.push([-1, n]); outLen += n; } };
    const cur = () => outLen / sr;
    const outScenes = plans.map((plan) => {
      const s0 = cur();
      let groups = [];
      if (plan.empty != null) sil(plan.empty);
      else plan.lines.forEach((it) => {
        const ls = cur();
        if (!it.hasVoice) sil(it.mute);
        else {
          let prev = it.a;
          it.pts.forEach(([p, d]) => { take(prev, p); sil(d); prev = p; });
          take(prev, it.b);
        }
        groups.push({ raw: it.raw, text: capPlainText(genCaptionSpoken(it.raw)), s0: ls - s0, s1: cur() - s0 });
      });
      // 새 장면: 문장 구간(실제 목소리)으로 SUBTITLE 줄 시각을 정한다 — 파이프라인 subtitle_times와 같은 규칙
      if (plan.sub) groups = genSubtitleTimes(plan.sub, groups.map((g) => [g.s0, g.s1]), cur() - s0)
        .map((t) => ({ raw: t.line, show: t.line, text: capPlainText(t.line), s0: t.s0, s1: t.s1 }));
      return { s0, secs: cur() - s0, groups };
    });
    const ctx = vaAudio();
    const buffer = ctx.createBuffer(1, Math.max(1, outLen), sr);
    const ch = buffer.getChannelData(0);
    o = 0;
    pieces.forEach(([a, b]) => {
      if (a < 0) { o += b; return; }
      ch.set(stream.subarray(a, b), o);
      o += b - a;
    });
    return { buffer, total: outLen / sr, scenes: outScenes, calls: chunks.length };
  }
  // 장면별 결과 (카드 미리보기가 전체 미리보기 결과를 다시 쓴다): key → { buffer, off, secs, groups }
  const vaSceneMem = new Map();
  function vaRemember(key, v) {
    vaSceneMem.delete(key);
    vaSceneMem.set(key, v);
    while (vaSceneMem.size > 60) vaSceneMem.delete(vaSceneMem.keys().next().value);
  }
  const vaFailed = new Map();   // key → 실패 시각 (1분 동안은 다시 부르지 않고 휴대폰 목소리로)
  function vaFailedRecently(key) {
    const t = vaFailed.get(key);
    return t != null && performance.now() - t < 60000;
  }
  // 재생기: 한 번에 하나 (카드 또는 전체 미리보기)
  const vp = { src: null, at: 0, t: 0 };
  function vpStart(buffer, off, t, end) {
    vpStop();
    const ctx = vaAudio();
    if (!ctx || !buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const dur = Math.max(0, end - t);
    if (dur <= 0.001) return;
    try { src.start(0, Math.max(0, off + t), dur); } catch { return; }
    vp.src = src; vp.at = ctx.currentTime; vp.t = t;
  }
  function vpStop() {
    if (vp.src) {
      try { vp.src.stop(); } catch {}
      try { vp.src.disconnect(); } catch {}
      vp.src = null;
    }
  }
  // 지금 재생 위치(초) — 소리 장치 시계를 기준으로 (없거나 멈춰 있으면 null → 화면 시계)
  function vpNow() {
    if (!vp.src || !vaCtx || vaCtx.state !== "running") return null;
    return vp.t + (vaCtx.currentTime - vp.at);
  }
  // 짧은 안내 (준비 중 / 대체 안내)
  let vaNoteTimer = 0;
  function vaNote(text, keep) {
    let n = $("vaNote");
    if (!n) {
      n = document.createElement("div");
      n.id = "vaNote";
      n.style.cssText = "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:70;max-width:min(92vw,420px);padding:9px 14px;border-radius:6px;background:rgba(20,20,20,0.92);border:1px solid #444;color:#fff;font-size:0.85rem;font-weight:700;text-align:center;pointer-events:none;";
      document.body.appendChild(n);
    }
    clearTimeout(vaNoteTimer);
    n.textContent = text;
    n.style.display = "block";
    if (!keep) vaNoteTimer = setTimeout(vaNoteHide, 3500);
  }
  // "준비 중" 안내를 기다리는 곳이 더 없으면 닫는다
  function vaNoteDone() {
    const n = $("vaNote");
    if (!n || n.textContent !== VA_LOADING) return;
    if ((pvActive && pvActive.voiceLoading) || (fpv.open && fpv.voiceState === "loading" && fpv.wantPlay)) return;
    vaNoteHide();
  }
  function vaNoteHide() {
    clearTimeout(vaNoteTimer);
    const n = $("vaNote");
    if (n) n.style.display = "none";
  }
  const VA_LOADING = "실제 성우 목소리 준비 중…";
  const VA_FALLBACK = "실제 목소리를 못 불러와 휴대폰 목소리로 들려줘요";

  // ───── 음성 2 (대체): 휴대폰 목소리 (실제 영상의 목소리와 다르다) ─────
  // 영상처럼 줄을 끊지 않고 이어 읽는다(계약서 11절). 읽는 글자 = 줄의 spoken([ ] 안 포함, { }·쉼 표시 제외).
  // 쉼(-)이나 { } 전용 줄에서만 말(utterance)을 나누고, 그 쉼 길이만큼 기다렸다가 다음 말을 읽는다.
  // 너무 긴 말은 브라우저 한계 때문에 문장 끝에서 나눠 차례로 읽는다. 자막은 지금처럼 시각 기준이라 조금 어긋날 수 있다.
  // items: [{ raw, s0, s1 }] (시간축 초). 카드 미리보기는 그 장면 줄들, 전체 미리보기는 모든 장면 줄을 이어 붙인 것
  const SP_MAX = 220;
  const sp = { gen: 0, on: false, chunks: [], i: 0, busy: false, readyAt: 0 };
  function spSplitLong(t) {
    if (t.length <= SP_MAX) return [t];
    const out = [];
    let cur = "";
    t.split(/(?<=[.!?。…])\s+/).forEach((sent) => {
      while (sent.length > SP_MAX) {   // 한 문장이 너무 길면 띄어쓰기에서 자른다
        let cut = sent.lastIndexOf(" ", SP_MAX);
        if (cut < SP_MAX / 2) cut = SP_MAX;
        if (cur) { out.push(cur); cur = ""; }
        out.push(sent.slice(0, cut).trim());
        sent = sent.slice(cut).trim();
      }
      if (cur && (cur + " " + sent).length > SP_MAX) { out.push(cur); cur = sent; }
      else cur = cur ? cur + " " + sent : sent;
    });
    if (cur) out.push(cur);
    return out.filter(Boolean);
  }
  // 말 목록 [{ text, at, wait }]: at = 시간축에서 이 말이 시작될 시각(줄 시작이 아니면 -1), wait = 앞 말이 끝난 뒤 쉴 초
  function spBuild(items, k, fromT) {
    const chunks = [];
    let cur = "", at = fromT, wait = 0, pend = 0;
    const flush = () => {
      const t = cur.replace(/\s+/g, " ").trim();
      if (t) spSplitLong(t).forEach((piece, j) => chunks.push({ text: piece, at: j ? -1 : at, wait: j ? 0 : wait }));
      if (t) { pend = 0; }
      cur = ""; at = -1;
    };
    const add = (txt, lineAt) => {
      txt = capPlainText(txt);
      if (!txt.replace(/\s+/g, "")) return;
      if (!cur.trim()) { at = lineAt; wait = pend; }
      cur += " " + txt;
    };
    for (let i = k; i < items.length; i++) {
      const g = items[i];
      const lineAt = i === k ? fromT : g.s0;
      if (genCaptionIsMuteOnly(g.raw)) { flush(); pend += Math.max(0, g.s1 - Math.max(g.s0, lineAt)); continue; }
      // { }는 빼고 [ ]는 기호만 떼고, 쉼 표시(-)에서 나눈다
      const spoken = String(g.raw || "").replace(GEN_CAP_MUTE_RE, " ").replace(GEN_CAP_HIDE_RE, "$1");
      let last = 0, first = true;
      spoken.replace(GEN_CAP_PAUSE_RE, (m, a, d, off) => {
        add(spoken.slice(last, off + a.length), first ? lineAt : -1);
        first = false;
        flush();
        pend += d.length * GEN_CAP_PAUSE_SEC;
        last = off + m.length;
        return m;
      });
      add(spoken.slice(last), first ? lineAt : -1);
    }
    flush();
    return chunks;
  }
  function spStop() {
    sp.gen++;
    sp.on = false; sp.busy = false; sp.chunks = []; sp.i = 0;
    try { window.speechSynthesis.cancel(); } catch {}
  }
  // fromT초부터 이어 읽기 시작 (그 시각이 들어 있는 줄의 처음부터)
  function spStart(items, fromT) {
    spStop();
    if (!pvVoiceOn || !("speechSynthesis" in window)) return;
    const k = items.findIndex((g) => fromT < g.s1 - 0.001);
    if (k < 0) return;
    sp.chunks = spBuild(items, k, fromT);
    sp.i = 0; sp.readyAt = 0; sp.on = sp.chunks.length > 0;
  }
  // 재생 중 매 화면마다: 앞 말이 끝났고 쉼도 지났고 시간축이 그 말의 줄에 왔으면 다음 말을 읽는다
  function spTick(t) {
    if (!sp.on || sp.busy || sp.i >= sp.chunks.length) return;
    const c = sp.chunks[sp.i];
    if (performance.now() < sp.readyAt) return;
    if (c.at >= 0 && t < c.at - 0.05) return;
    const gen = sp.gen;
    try {
      const u = new SpeechSynthesisUtterance(c.text);
      u.lang = "ko-KR";
      const ko = (speechSynthesis.getVoices() || []).find((v) => /^ko/i.test(v.lang));
      if (ko) u.voice = ko;
      u.rate = Math.max(0.5, Math.min(2, 1 + (Number(currentSettings.tts_rate) || 0) / 100));
      u.pitch = Math.max(0.5, Math.min(2, 1 + (Number(currentSettings.tts_pitch) || 0) / 100));
      u.onend = u.onerror = () => {
        if (gen !== sp.gen) return;   // 멈추거나 옮긴 뒤에 끝난 옛 말
        sp.busy = false;
        sp.i++;
        const n = sp.chunks[sp.i];
        sp.readyAt = performance.now() + (n ? n.wait * 1000 : 0);
      };
      sp.busy = true;
      speechSynthesis.speak(u);
    } catch { sp.on = false; }
  }
  // 카드 재생: 그 장면 문장만 실제 성우 목소리로 (전체 미리보기에서 받은 결과가 있으면 그것을 다시 쓴다)
  // 준비되는 동안은 "준비 중" 안내, 실패하면 휴대폰 목소리로
  function pvPlay(el) {
    let ctx = pvActivate(el);
    if (!ctx) return;
    const seg = segOfEl(el);
    const input = seg ? vaSceneInput(el, seg, ctx.secs) : null;
    if (input && vaHasVoice(input)) {
      const key = vaSceneKey(input);
      const v = vaSceneMem.get(key);
      if (v) {
        if (ctx.voiceKey !== key) ctx = pvVoiceCard(ctx, seg, key, v);
      } else if (!vaFailedRecently(key)) {
        if (ctx.voiceLoading === key) return;   // 이미 받는 중
        ctx.voiceLoading = key;
        ctx.P.play.textContent = "…";
        vaNote(VA_LOADING, true);
        vaBuild([input]).then((res) => {
          const sc = res.scenes[0];
          vaRemember(key, { buffer: res.buffer, off: 0, secs: sc.secs, groups: sc.groups });
          if (pvActive !== ctx || ctx.voiceLoading !== key) { vaNoteDone(); return; }   // 그 사이 다른 카드로 옮겼거나 멈췄다
          ctx.voiceLoading = null;
          vaNoteHide();
          pvPlay(el);
        }).catch((err) => {
          console.warn("실제 성우 목소리 실패:", err);
          vaFailed.set(key, performance.now());
          if (pvActive !== ctx || ctx.voiceLoading !== key) { vaNoteDone(); return; }
          ctx.voiceLoading = null;
          vaNote(VA_FALLBACK);
          pvPlay(el);
        });
        return;
      } else if (ctx.voice) {
        ctx = pvVoiceCard(ctx, seg, null, null);   // 실패한 설정으로 돌아왔다: 예상 길이로 다시
      }
    }
    pvPlayGo(ctx);
  }
  // 카드 무대를 실제 목소리 길이(v)로 다시 만든다 (같은 비율 자리에서). v가 null이면 콘티 예상 길이로
  function pvVoiceCard(ctx, seg, key, v) {
    const frac = ctx.secs > 0 ? ctx.t / ctx.secs : 0;
    pvStop(ctx);
    const nc = v ? pvBuild(ctx.el, seg, null, v.secs, v.groups) : pvBuild(ctx.el, seg);
    nc.voice = v; nc.voiceKey = key;
    nc.t = Math.min(nc.secs, frac * nc.secs);
    pvActive = nc;
    pvShow(nc, nc.t, true);
    return nc;
  }
  function pvPlayGo(ctx) {
    if (ctx.t >= ctx.secs - 0.05) ctx.t = 0;
    ctx.playing = true;
    ctx.shown = -2;
    if (ctx.voice) vpStart(ctx.voice.buffer, ctx.voice.off, ctx.t, ctx.secs);   // 실제 목소리: 그 시점부터
    else spStart(ctx.spItems || ctx.groups, ctx.t);   // 휴대폰 목소리: 재생을 시작한 그 줄부터 장면 끝까지 이어 읽는다
    ctx.P.play.textContent = "❚❚";
    ctx.P.play.classList.add("on");
    ctx.t0 = performance.now() - ctx.t * 1000;
    pvShow(ctx, ctx.t, true);
    const tick = (now) => {
      if (pvActive !== ctx || !ctx.playing) return;
      const vt = ctx.voice ? vpNow() : null;
      const t = vt != null ? vt : (now - ctx.t0) / 1000;
      if (t < ctx.secs) {   // 장면 길이(자막 줄 길이 합)에서 끝난다 — 영상과 같다
        pvShow(ctx, t, false);
        ctx.raf = requestAnimationFrame(tick);
      } else {
        pvShow(ctx, ctx.secs, false);
        pvStop(ctx);
        ctx.t = ctx.secs;
        pvCapShow(ctx.P.cap, pvFirstVisible(ctx.groups), ctx.size, ctx.wt, true);   // 끝난 화면에도 첫 줄(잡을 수 있게)
        ctx.shown = -1;
        pvPlayhead(ctx);
      }
    };
    ctx.raf = requestAnimationFrame(tick);
  }
  function pvToggle(el) {
    vaAudio();   // 누른 순간에 소리 장치를 깨워 둔다 (나중에 목소리가 준비돼도 소리가 나게)
    if (pvActive && pvActive.el === el && pvActive.voiceLoading) { pvActive.voiceLoading = null; vaNoteHide(); pvStop(pvActive); return; }   // 준비 중에 다시 누르면 취소
    if (pvActive && pvActive.el === el && pvActive.playing) pvStop(pvActive);
    else if (pvGuideNeeded()) pvShowGuide(() => pvPlay(el));
    else pvPlay(el);
  }
  // 미리보기 첫 재생 안내: "다시 알림 보지 않기"를 누르기 전까지는 화면을 열 때마다 첫 재생에서 한 번 보여준다
  let pvGuideShownThisVisit = false;
  function pvGuideNeeded() {
    if (pvGuideShownThisVisit) return false;
    try { return localStorage.getItem("pvGuideOff") !== "1"; } catch { return true; }
  }
  function pvShowGuide(then) {
    pvGuideShownThisVisit = true;
    const m = $("pvGuideModal");
    const close = (never) => {
      if (never) { try { localStorage.setItem("pvGuideOff", "1"); } catch {} }
      m.classList.remove("open");
      then();
    };
    $("pvGuideOk").onclick = () => close(false);
    $("pvGuideNever").onclick = () => close(true);
    m.classList.add("open");
  }
  // SCRIPT·SUBTITLE 칸을 처음 누르면 두 칸의 차이를 한 번 보여준다. "다시 보지 않기"를 체크하고 닫기 전까지는 화면을 열 때마다 한 번
  // (예전 "자막 쓰는 법" 안내와 다른 내용이라 저장 키도 새로: subGuideOff)
  let capGuideShownThisVisit = false;
  function capGuideNeeded() {
    if (capGuideShownThisVisit) return false;
    try { return localStorage.getItem("subGuideOff") !== "1"; } catch { return true; }
  }
  function capShowGuide(field) {
    capGuideShownThisVisit = true;
    const m = $("capGuideModal");
    $("capGuideNever").checked = false;
    const close = () => {
      if ($("capGuideNever").checked) { try { localStorage.setItem("subGuideOff", "1"); } catch { /* 저장 못 하면 다음에 또 보인다 */ } }
      m.classList.remove("open");
      document.removeEventListener("keydown", onKey, true);
      if (field && field.isConnected) field.focus();   // 쓰던 자막 칸으로 돌아간다
    };
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    $("capGuideOk").onclick = close;
    $("capGuideX").onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); };
    document.addEventListener("keydown", onKey, true);
    if (field) field.blur();
    m.classList.add("open");
  }
  document.addEventListener("focusin", (e) => {
    const t = e.target;
    if (t && t.matches && t.matches(".seg-script, .seg-subtitle") && capGuideNeeded()) capShowGuide(t);
  });
  // 그 시점으로 이동 (재생 중이면 거기서 이어서, 목소리는 끊고 그 줄부터 다시 이어 읽는다)
  function pvSeek(el, t) {
    const ctx = pvActivate(el);
    if (!ctx) return;
    t = Math.max(0, Math.min(ctx.secs, t));
    if (ctx.playing) {
      ctx.t0 = performance.now() - t * 1000;
      ctx.shown = -2;
      if (ctx.voice) vpStart(ctx.voice.buffer, ctx.voice.off, t, ctx.secs);
      else spStart(ctx.spItems || ctx.groups, t);   // 옮긴 자리의 줄부터 다시 읽는다
    }
    pvShow(ctx, t, true);
  }
  // 소재·비중·구간 등이 바뀌었을 때: 살아 있던 카드면 같은 시점에서 다시 만들고(멈춘 상태), 아니면 정지 화면만 고친다
  function pvRefreshCard(id) {
    const el = document.querySelector(`.seg-item[data-id="${id}"]`);
    const seg = segments.find((s) => String(s.id) === String(id));
    if (!el || !seg) return;
    if (pvActive && pvActive.el === el) {
      const t = pvActive.t;
      pvStop(pvActive);
      pvActive = null;
      el._idleKey = null;
      pvActive = pvBuild(el, seg);
      pvShow(pvActive, Math.min(t, pvActive.secs), true);
    } else {
      el._idleKey = null;
      pvIdle(el, seg);
    }
  }
  // 설정(제목·자막)이 바뀌면 모든 카드의 미리보기에 반영
  function pvSyncAll() {
    document.querySelectorAll(".seg-item").forEach((el) => {
      const seg = segOfEl(el);
      if (!seg || !el.querySelector(".seg-stage")) return;
      if (pvActive && pvActive.el === el) {
        const framed = true;
        if (framed !== pvActive.framed && !pvActive.playing) { pvRefreshCard(el.dataset.id); return; }
        const d = pvDecor(el);
        pvActive.size = d.size; pvActive.wt = d.wt;
        pvCapShow(pvActive.P.cap, pvActive.P.cap._g, d.size, d.wt, !pvActive.playing);   // 지금 줄 그대로 모양만 바꾼다 (목소리를 다시 읽지 않게)
      } else {
        pvIdle(el, seg);
      }
    });
  }
