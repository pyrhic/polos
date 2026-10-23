// storyboard/02-media.js — 클립 비중·원본 길이(asset_trims.__weights/__pexels), Pexels 영상 겹침 확인, 장면 카드 소재 영역·썸네일
// storyboard.html에서 순서 그대로 잘라낸 파일. 일반 <script>로 차례대로 불러오므로 앞 파일의 전역(let/const/function)을 그대로 쓴다.
  // ───── 클립 비중 / 원본 길이 (asset_trims.__weights / __pexels) ─────
  const SHORT_CLIP_TEXT = "이 클립에 배정된 시간보다 영상의 길이가 짧아 마지막 장면이 지속 노출됩니다.";
  const clipDurCache = {};   // 직접 올린 영상 등: 화면의 video 요소가 읽은 원본 길이 (소재 경로 -> 초)
  const autofillBusy = new Set();   // 지금 Pexels 자동 배치 검색 중인 장면 id
  function needClips(secs) {
    return Math.max(2, Math.round(secs / 4.5));   // 영상 만들기 단계와 같은 기준 (4.5초당 1컷, 최소 2컷)
  }
  function isSubscribeSeg(seg) {
    return partOf(seg.section) === SUBSCRIBE_PART;
  }
  // 장면 길이: 카드가 화면에 있으면 입력 중인 자막 기준, 없으면 저장된 값 기준 (자막 줄이 있으면 줄 길이 합)
  function segSecondsOf(seg) {
    const el = document.querySelector(`.seg-item[data-id="${seg.id}"]`);
    if (el) return effectiveSeconds(el, seg);
    const st = capState(seg.script_text, seg, null, seg.subtitle_text != null ? seg.subtitle_text : null);
    if (st.isNew || st.lines.length) return st.total;
    return seg.target_seconds > 0 ? Number(seg.target_seconds) : estimateSeconds(seg.script_text);
  }
  function clipWeights(seg) {
    const w = (seg.asset_trims || {}).__weights || {};
    return (seg.asset_paths || []).map((p) => (Number(w[p]) > 0 ? Number(w[p]) : 1));
  }
  // 영상 클립이 실제로 쓸 수 있는 길이(초). 구간을 지정했으면 그 구간 길이. 모르면 null
  function clipSourceSeconds(seg, path) {
    if (!isVideo(path)) return null;
    const trims = seg.asset_trims || {};
    const px = trims.__pexels || {};
    let d = Number(px[path]) > 0 ? Number(px[path]) : clipDurCache[path];
    if (!(d > 0)) return null;
    const t = trims[path];
    if (t) {
      const end = t.end == null ? d : Math.min(d, Number(t.end));
      d = Math.max(0, end - Number(t.start || 0));
    }
    return d;
  }
  // 클립별 배정 시간(장면초 × 비중비율)과 짧은 클립 여부
  function clipPlan(seg, secs) {
    const paths = seg.asset_paths || [];
    const ws = clipWeights(seg);
    const sum = ws.reduce((a, b) => a + b, 0) || 1;
    return paths.map((p, i) => {
      const alloc = secs * ws[i] / sum;
      const src = clipSourceSeconds(seg, p);
      return { path: p, weight: ws[i], frac: ws[i] / sum, alloc, src, short: src != null && src + 0.05 < alloc };
    });
  }

  function blankButtonsHtml(seg) {
    const have = new Set(seg.asset_paths || []);
    return `<div class="blank-pick-row">${BLANKS.map((b) =>
      `<button type="button" class="blank-pick-btn" data-token="${b.token}" ${have.has(b.token) ? "disabled" : ""}><i class="${blankClass(b.token)}"></i>${b.label}</button>`
    ).join("")}</div>`;
  }

  // 장면에 클립이 하나도 없을 때: 자동 배치 상태 + 빈 화면 고르기
  function emptyThumbsHtml(seg) {
    if (isSubscribeSeg(seg)) return '<div class="seg-thumb-empty">비어있음 — 영상 생성 때 마녀 사진이 하나 자동으로 들어가요</div>';
    if (autofillBusy.has(String(seg.id))) return '<div class="seg-thumb-empty">키워드로 Pexels 영상을 찾아 채우는 중…</div>';
    const trims = seg.asset_trims || {};
    const af = trims.__autofill;
    let why;
    if (trims.__cleared) why = "클립을 모두 지웠어요.";
    else if (af && af.status === "quota") why = "Pexels 한도 초과입니다. 소재를 채워주세요.";
    else if (af && af.status === "no_results") why = `'${af.query || ""}' 검색 결과가 없습니다. 소재를 채워주세요.`;
    else if (af && af.status === "error") why = "Pexels 자동 배치에 실패했어요. 소재를 채워주세요.";
    else if (!(seg.keyword || "").trim()) why = "검색 키워드가 없어서 자동 배치를 못 했어요.";
    else why = "소재가 없어요.";
    return `<div class="blank-pick">
      <div class="blank-pick-title">${escapeHtml(why)}<br>빈 화면 종류를 고르세요 (검정 / 흰색 / 화면조정)<br><span style="color:var(--muted);font-size:0.72rem;">사진·영상을 넣어도 돼요. 이대로는 영상을 생성할 수 없어요.</span></div>
      ${blankButtonsHtml(seg)}
    </div>`;
  }
  function trimLabel(t) {
    return `${Number(t.start || 0).toFixed(1)}~${t.end == null ? "끝" : Number(t.end).toFixed(1)}초`;
  }
  function segOfEl(el) {
    return segments.find((s) => String(s.id) === String(el.dataset.id));
  }

  // ───── 장면 카드 소재 영역 (릴스 EDITS 앱처럼): 미리보기 + 타임라인 한 줄 + 도구줄 ─────
  // 타임라인 클립 칸에 깔 대표 썸네일. 사진은 그 사진, 영상은 Pexels 썸네일 또는 첫 프레임을 뜬 그림, 빈 화면은 색.
  const pexelsThumbMem = {};   // Pexels 영상 주소 -> 검색 결과의 썸네일 주소 (이번 화면에서 검색/자동 배치한 것만. DB에는 저장하지 않는다)
  // ── Pexels 영상 겹침 확인 (docs/storyboard-contract.md 2절) ──
  // 같은 영상이라도 검색마다 고른 파일(hd_url)이 다를 수 있어서, 주소의 /video-files/<영상 id>/ 로 비교한다 (id가 없는 옛 주소는 주소 그대로)
  function pexelsVideoKey(u) {
    const m = /^https?:\/\/(?:[\w-]+\.)*pexels\.com\/video-files\/(\d+)\//i.exec(String(u || ""));
    return m ? "pxv:" + m[1] : String(u || "");
  }
  function pexelsKeySet(paths) {
    const set = new Set();
    for (const p of paths) { set.add(String(p)); set.add(pexelsVideoKey(p)); }
    return set;
  }
  function pexelsResultIn(set, r) {
    return (r.id != null && set.has("pxv:" + r.id)) || set.has(r.hd_url) || set.has(pexelsVideoKey(r.hd_url));
  }
  function shuffled(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  // 다른 콘티(이전 영상)에 이미 들어간 영상 주소: 화면을 연 뒤 처음 필요할 때 한 번만 읽어 콘티별로 들고 있는다.
  // 지금 콘티의 몫은 매번 화면의 최신 소재로 바꿔 둔다 (다른 콘티로 넘어가도 방금 넣은 영상이 "사용함"으로 잡히게)
  let otherUsedLoad = null;
  async function loadUsedPathsByScript() {
    const byScript = new Map();
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_segments?select=script_id,asset_paths&order=id.asc&limit=${PAGE}&offset=${offset}`, { headers });
      if (!res.ok) throw new Error(await res.text());
      const rows = await res.json();
      for (const r of rows) {
        const urls = (r.asset_paths || []).filter((p) => /^https?:\/\//i.test(String(p)));   // 직접 올린 파일(스토리지 경로)은 상관없다
        if (!urls.length) continue;
        const k = String(r.script_id);
        byScript.set(k, [...(byScript.get(k) || []), ...urls]);
      }
      if (rows.length < PAGE) break;
    }
    return byScript;
  }
  async function otherScriptsUsedKeys() {
    let byScript;
    try {
      byScript = await (otherUsedLoad || (otherUsedLoad = loadUsedPathsByScript()));
    } catch {
      otherUsedLoad = null;   // 다음 검색 때 다시 읽는다 (못 읽어도 검색은 그대로 한다)
      return new Set();
    }
    const cur = String($("scriptSelect").value);
    if (cur) byScript.set(cur, segments.flatMap((s) => s.asset_paths || []));
    return pexelsKeySet([...byScript].filter(([k]) => k !== cur).flatMap(([, v]) => v));
  }
  const thumbDone = {};        // 소재 경로 -> 썸네일 주소 (null이면 못 구함)
  const thumbWait = {};        // 소재 경로 -> 구하는 중인 Promise
  let grabRunning = 0;
  const grabQueue = [];
  function pexelsThumbGuess(url) {
    const m = /videos\.pexels\.com\/video-files\/(\d+)\//.exec(url || "");
    return m ? `https://images.pexels.com/videos/${m[1]}/pictures/preview-0.jpg` : null;
  }
  function probeImage(url) {
    return new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im.naturalWidth ? url : null);
      im.onerror = () => res(null);
      setTimeout(() => res(null), 8000);
      im.src = url;
    });
  }
  // 영상 원본 길이를 알게 되면 기록하고 짧은 클립 경고를 다시 계산한다 (직접 올린 영상은 __pexels에 길이가 없다)
  function noteDuration(path, d) {
    if (!(d > 0) || !isFinite(d) || clipDurCache[path] === d) return;
    clipDurCache[path] = d;
    segments.filter((s) => (s.asset_paths || []).includes(path)).forEach((s) => refreshClipView(String(s.id)));
  }
  // 영상의 첫 프레임(구간을 정했으면 그 시작)을 9:16 그림으로 뜬다. 동시에 2개까지만.
  function grabFrame(path, start) {
    return new Promise((resolve) => {
      const run = () => {
        grabRunning++;
        const v = document.createElement("video");
        let done = false;
        const finish = (url) => {
          if (done) return;
          done = true;
          grabRunning--;
          v.removeAttribute("src");
          try { v.load(); } catch {}
          resolve(url);
          const next = grabQueue.shift();
          if (next) next();
        };
        v.muted = true; v.playsInline = true; v.preload = "auto"; v.crossOrigin = "anonymous";
        v.addEventListener("loadedmetadata", () => {
          noteDuration(path, v.duration);
          try { v.currentTime = Math.min(Math.max(0.05, start || 0), Math.max(0, v.duration - 0.1)); } catch { finish(null); }
        });
        v.addEventListener("seeked", () => {
          try {
            const W = 180, H = 320, vw = v.videoWidth, vh = v.videoHeight;
            if (!vw || !vh) { finish(null); return; }
            const c = document.createElement("canvas");
            c.width = W; c.height = H;
            const sc = Math.max(W / vw, H / vh);
            c.getContext("2d").drawImage(v, (W - vw * sc) / 2, (H - vh * sc) / 2, vw * sc, vh * sc);
            finish(c.toDataURL("image/jpeg", 0.72));
          } catch { finish(null); }   // 다른 사이트 영상이라 그림을 뜰 수 없는 경우 → 칸에 영상 요소를 그대로 둔다
        });
        v.addEventListener("error", () => finish(null));
        setTimeout(() => finish(null), 15000);
        v.src = assetUrl(path);
      };
      if (grabRunning < 2) run(); else grabQueue.push(run);
    });
  }
  // 지금 바로 쓸 수 있는 썸네일 (undefined = 아직 구하는 중)
  function thumbNow(path) {
    if (isBlank(path)) return null;
    if (isImage(path)) return assetUrl(path);
    return thumbDone[path];
  }
  function clipThumb(path, seg) {
    if (path in thumbDone) return Promise.resolve(thumbDone[path]);
    if (thumbWait[path]) return thumbWait[path];
    const t = ((seg && seg.asset_trims) || {})[path];
    const p = (async () => {
      for (const u of [pexelsThumbMem[path], pexelsThumbGuess(path)]) {
        if (u && await probeImage(u)) return u;
      }
      return grabFrame(path, t ? Number(t.start) || 0 : 0);
    })().then((u) => {
      thumbDone[path] = u || null;
      delete thumbWait[path];
      // 썸네일이 생기면 그 소재를 쓰는 카드의 타임라인과 정지 화면을 다시 그린다
      segments.filter((s) => (s.asset_paths || []).includes(path)).forEach((s) => {
        refreshClipView(String(s.id));
        const el = document.querySelector(`.seg-item[data-id="${s.id}"]`);
        if (el) pvIdle(el, s);
      });
      return thumbDone[path];
    });
    thumbWait[path] = p;
    return p;
  }

  function clipKind(p) {
    return isBlank(p) ? blankClass(p) : isImage(p) ? "img" : "vid";
  }
  function clipFocusPos(seg, p) {
    const f = ((seg.asset_trims || {}).__focus || {})[p];
    return f ? `${f.x * 100}% ${f.y * 100}%` : "50% 50%";
  }
  // 클립 칸 안: 대표 썸네일 한 장을 9:16 조각으로 반복해 필름줄처럼 채운다
  function clipFillHtml(seg, p, count) {
    if (isBlank(p)) return "";
    const u = thumbNow(p);
    if (u) {
      return Array.from({ length: count }, () =>
        `<img class="seg-tl-tile" src="${escapeAttr(u)}" alt="" draggable="false" style="object-position:${clipFocusPos(seg, p)};">`).join("");
    }
    if (u === null) return `<video class="seg-tl-vid" src="${escapeAttr(assetUrl(p))}#t=0.1" muted playsinline preload="metadata" data-path="${escapeAttr(p)}"></video>`;
    return "";   // 아직 구하는 중: 칸 색만
  }
  function clipLabHtml(i, c) {
    return `<div class="seg-tl-lab"><b>${i + 1}</b><span class="seg-tl-sec">${c ? c.alloc.toFixed(1) + "초" : ""}</span>${c && c.short ? '<span class="w">⚠</span>' : ""}</div>`;
  }
  function rulerHtml(secs) {
    const step = secs <= 8 ? 1 : secs <= 20 ? 2 : 5;
    let h = "";
    for (let s = 0, k = 0; s <= secs + 1e-6; s += step, k++) {
      const x = s / secs * 100;
      h += `<i style="left:${x}%;"></i>`;
      if (k % 2 === 0 && x < 90) h += `<span style="left:${x}%;">${s}s</span>`;
    }
    return h;
  }
  // 고른 클립의 도구줄: ✂ 구간(영상/GIF) · ⌖ 위치 · 🗑 삭제 + 출처 배지
  function toolsHtml(seg, p, plan) {
    const i = (seg.asset_paths || []).indexOf(p);
    const c = plan[i];
    if (i < 0 || !c) return "";
    const trims = seg.asset_trims || {};
    const focus = trims.__focus || {};
    const n = (seg.asset_notes || {})[p];
    const tip = n ? `${n.articleTitle || ""}${n.caption ? " / 사진 설명: " + n.caption : ""}` : "";
    const badge = !n ? "" : n.license
      ? `<a class="seg-news-badge" style="color:var(--accent);" href="${escapeAttr(n.articleUrl || "#")}" target="_blank" rel="noopener" title="${escapeAttr((n.artist || "") + " / " + n.license)}">위키 · ${escapeHtml(n.license)} · 출처는 설명에 자동 표기</a>`
      : `<a class="seg-news-badge" href="${escapeAttr(n.articleUrl || "#")}" target="_blank" rel="noopener" title="${escapeAttr(tip)}">뉴스 · ${escapeHtml(n.source || "")} · 저작권 확인 필요</a>`;
    return `<div class="seg-tools">
      ${isTrimmable(p) ? `<button type="button" class="seg-tool-trim${trims[p] ? " set" : ""}">✂ ${trims[p] ? trimLabel(trims[p]) : "구간"}</button>` : ""}
      ${!isBlank(p) ? `<button type="button" class="seg-tool-pos${focus[p] ? " set" : ""}">⌖ ${focus[p] ? "위치 조정됨" : "위치"}</button>` : ""}
      <button type="button" class="seg-tool-del del">🗑 삭제</button>
      ${badge}
    </div>`;
  }

  // 다른 칸에 입력 중이던 내용을 날리지 않도록, 소재 영역(타임라인·미리보기)만 다시 그린다.
  function refreshThumbs(id) {
    const el = document.querySelector(`.seg-item[data-id="${id}"]`);
    const seg = segments.find((s) => String(s.id) === String(id));
    if (!el || !seg) return;
    const host = el.querySelector(".seg-tl-area");
    if (host) host._sig = null;   // 타임라인을 처음부터 다시 그리게
    const blanks = el.querySelector(".seg-add-blanks");
    if (blanks && blanks.style.display !== "none") blanks.innerHTML = blankButtonsHtml(seg);
    pvRefreshCard(String(id));
    updateSettingsPreview();
    updateRuntimeSummary();   // 안내 문구·타임라인·짧은 클립 경고도 다시 그린다
  }

