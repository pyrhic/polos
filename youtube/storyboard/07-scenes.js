// storyboard/07-scenes.js — 장면 불러오기(loadSegments)·장면 구분 묶음·render(), Pexels 검색 팝업, 장면 저장/삭제/되돌리기/업로드
// storyboard.html에서 순서 그대로 잘라낸 파일. 일반 <script>로 차례대로 불러오므로 앞 파일의 전역(let/const/function)을 그대로 쓴다.
  async function loadSegments(scriptId) {
    pvStopAll();
    const list = document.getElementById("segList");
    const regenWrap = document.getElementById("regenWrap");
    if (!scriptId) {
      list.innerHTML = '<div class="empty">대본을 먼저 선택하세요.</div>';
      regenWrap.style.display = "none";
      return;
    }
    list.innerHTML = '<div class="empty">불러오는 중...</div>';
    const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_segments?select=*&script_id=eq.${scriptId}&order=order_no.asc`, { headers });
    segments = await res.json();
    subColMissing = segments.length > 0 && !segments.some((sg) => "subtitle_text" in sg);   // SQL 실행 전 DB: SUBTITLE 칸을 잠그고 안내
    regenWrap.style.display = "block";
    render();
    updateSettingsPreview();
    capAutoSplitOnOpen(scriptId);   // 화면 폭을 넘는 긴 자막 줄은 자동으로 나눠 저장 (사용자가 SCRIPT 칸에서 고친다)
    startAutofill(scriptId);   // 비었거나 모자란 장면을 키워드로 Pexels 영상 자동 배치 (한 장면씩 순서대로)
  }

  // 장면 구분(대본 구조). section 칸에 구분 이름을 저장하고, 옛 콘티의 "트렌드 요약 (설명)" 같은 값은 앞부분으로 묶어 본다.
  const PARTS = ["트렌드 요약", "이슈 설명", "관점 정리", "내 의견", "도입", "전개", "의미", "마무리", "구독/좋아요"];
  const SUBSCRIBE_PART = "구독/좋아요";
  function partOf(section) {
    const t = (section || "").trim();
    return PARTS.find((k) => t.includes(k)) || t;
  }

  // 이어지는 같은 구분의 카드들을 묶어서 "트렌드 요약 · 카드 2개 · 약 14초" 머리글을 카드 사이에 넣는다
  // 묶음 목록 [{ part, els, secs, head }]을 돌려준다 (개요 박스의 "구성"이 같은 묶음을 쓴다)
  function refreshGroupHeaders() {
    const list = document.getElementById("segList");
    list.querySelectorAll(".seg-group").forEach((el) => el.remove());
    const runs = [];
    let prev = null, run = [];
    const flush = () => {
      if (!run.length || !prev) { run = []; return; }
      const secs = run.reduce((sum, el) => sum + effectiveSeconds(el, segments.find((x) => String(x.id) === el.dataset.id)), 0);
      const h = document.createElement("div");
      h.className = "seg-group";
      h.innerHTML = `<span>${escapeHtml(prev)}</span><span class="cnt">카드 ${run.length}개 · 약 ${secs.toFixed(0)}초</span>`;
      run[0].before(h);
      runs.push({ part: prev, els: run, secs, head: h });
      run = [];
    };
    list.querySelectorAll(".seg-item").forEach((el) => {
      const part = partOf(el.querySelector(".seg-section").value);
      if (part !== prev) { flush(); prev = part; }
      run.push(el);
    });
    flush();
    return runs;
  }

  // 옛 콘티용 보충 버튼들: 이미 기사 사진을 가져왔거나(또는 기사 주소가 없거나), 이미 내 의견 카드가 있으면 숨긴다
  function updateHelperButtons() {
    const row = scripts.find((r) => String($("scriptSelect").value) === String(r.id));
    const hasArticleUrls = !!row && (row.fact_sources || "").split("\n").some((l) => /^https?:\/\/\S+$/.test(l.trim()));
    const hasNewsMedia = segments.some((sg) => Object.keys(sg.asset_notes || {}).length > 0);
    $("addMediaBtn").style.display = hasArticleUrls && !hasNewsMedia && segments.length ? "block" : "none";
    // 채널 카드 장면이 없는 옛 콘티: 맨 끝에 채널 카드 장면을 붙이는 버튼
    $("addCardSegBtn").style.display = row && !segments.some(isSubscribeSeg) ? "block" : "none";
  }

  // SCRIPT / SUBTITLE 칸 안내 (계약서 16절)
  function scriptPlaceholder(seg) {
    const mine = /내 의견/.test(seg.section || "");
    if (seg.subtitle_text != null) return mine ? "내 의견을 말하듯 써 넣으세요 (성우가 읽는 말, 화면엔 안 나와요). 비워두면 이 장면은 1초만 나와요" : "성우가 읽는 말 (화면엔 안 나와요)";
    return mine ? "내 의견을 직접 써 넣으세요. 한 줄 = 자막 한 번 (줄을 바꾸면 다음 자막). 비워두면 이 장면은 1초만 나와요" : "한 줄 = 자막 한 번 (줄을 바꾸면 다음 자막)";
  }
  function subtitlePlaceholder(seg) {
    if (subColMissing) return "SUBTITLE 칸이 DB에 아직 없어요 — youtube_tables_18_subtitle.sql을 실행하세요";
    if (seg.subtitle_text != null) return "화면 자막 — 한 줄 = 자막 한 번 (예: 5위 류수영). 비우면 자막 없음";
    return isSubscribeSeg(seg) ? "비우면 채널 카드 문구(SCRIPT 줄)가 그대로 자막" : "비우면 예전처럼 SCRIPT 줄이 자막. 쓰면 이 칸만 자막이 돼요";
  }

  function render() {
    pvStopAll();   // 카드를 새로 그리면 재생 중이던 미리보기는 멈춘다
    updateHelperButtons();
    const list = document.getElementById("segList");
    if (!segments.length) {
      list.innerHTML = '<div class="empty">이 대본에는 장면 카드가 없습니다. 새 콘티는 콘티 목록의 "+ 새 콘티 만들기"나 Trend·Wikipedia 화면에서 만들어 주세요.</div>';
      return;
    }
    list.innerHTML = segments.map((seg) => {
      return `
      <div class="card-box seg-item" data-id="${seg.id}" tabindex="0">
        <div class="seg-head">
          <div class="seg-no">${seg.order_no}</div>
          ${isSubscribeSeg(seg) ? '<button type="button" class="seg-card-set" title="채널 카드 불러오기 / 지금 장면을 채널 카드로 등록">채널 카드 설정</button>' : ""}
          <div class="seg-duration">
            <span class="seg-duration-display"></span>
            <input type="number" class="seg-duration-input" step="0.1" min="0" style="display:none;">
            <button type="button" class="seg-duration-edit">수정</button>
            <button type="button" class="seg-duration-save" style="display:none;">저장</button>
          </div>
          <span class="seg-save-state"></span>
          <button type="button" class="seg-icon-btn seg-revert-btn" title="마지막 저장 상태로 되돌리기">↺</button>
          <button type="button" class="seg-icon-btn seg-delete-btn" title="이 장면 삭제">×</button>
        </div>
        <div class="seg-media">
          <div class="seg-stage-row">
            <div class="seg-stage-box">
              <div class="cap-preview seg-stage" title="눌러서 재생 / 멈춤">
                <div class="pv-layer"></div>
                <div class="pv-ref">참고 영상</div>
                <div class="cap-t1"></div>
                <div class="cap-t2"></div>
                <div class="cap-src"></div>
                <div class="cap-lines"><div class="cap-normal"></div></div>
              </div>
              <div class="seg-play" aria-hidden="true">▶</div>
              <div class="seg-stage-ro"></div>
            </div>
            <div class="seg-stage-side">
              <div class="seg-pv-time">00:00 / 00:00</div>
              <div class="seg-pv-info"></div>
              <div class="seg-side-lab">SCRIPT</div>
              <textarea class="seg-script" placeholder="${escapeAttr(scriptPlaceholder(seg))}">${escapeHtml(seg.subtitle_text != null ? String(seg.script_text || "").replace(/\r/g, "") : normalizeScript(seg.script_text))}</textarea>
              <div class="seg-side-lab">SUBTITLE</div>
              <textarea class="seg-subtitle"${subColMissing ? " disabled" : ""} placeholder="${escapeAttr(subtitlePlaceholder(seg))}">${escapeHtml(String(seg.subtitle_text || "").replace(/\r/g, ""))}</textarea>
              <div class="seg-side-lab">ACTION</div>
              <textarea class="seg-direction" rows="1" wrap="off" placeholder="예: 천천히 줌인">${escapeHtml(oneLine(seg.direction))}</textarea>
              <div class="seg-side-lab">SEARCHING KEY WORD</div>
              <div class="seg-kw-row">
                <input type="text" class="seg-keyword" value="${escapeAttr(seg.keyword)}" placeholder="영어로 (예: city night)">
                <button type="button" class="seg-kw-search" title="Pexels에서 후보 찾기">SEARCH</button>
              </div>
            </div>
          </div>
          <div class="seg-tl-area"></div>
          <div class="seg-cap-area"></div>
          <div class="seg-add-menu">
            <button type="button" class="seg-add-file">📁 내 사진/영상 (여러 개)</button>
            <button type="button" class="seg-add-pexels">🔎 Pexels에서 찾기</button>
            <button type="button" class="seg-add-blank">⬛ 빈 화면 (검정 / 흰색 / 화면조정)</button>
            <div class="seg-add-blanks blank-pick" style="display:none;"></div>
            <div class="seg-add-note">맨 뒤에 추가돼요 · PC에선 카드를 누르고 Ctrl+V로 이미지 붙여넣기</div>
          </div>
          <input type="file" class="seg-file-input" accept="image/*,video/*" multiple>
        </div>
        <div class="seg-media-hint" style="display:none;color:var(--point);font-size:0.78rem;margin:2px 0 8px;"></div>
        <input type="hidden" class="seg-section" value="${escapeAttr(seg.section)}">
      </div>
    `;
    }).join("");

    document.querySelectorAll(".seg-item").forEach((el) => {
      const id = el.dataset.id;
      const stateEl = el.querySelector(".seg-save-state");
      const markDirty = () => { el.dataset.dirty = "1"; stateEl.className = "seg-save-state"; stateEl.textContent = "수정됨"; };
      // 카드 선택이 풀리면(다른 곳을 누르거나 다른 카드로 이동) 자동 저장. 되돌리기/삭제 같은 카드 안 버튼을 누르는 경우는 건너뛴다.
      el.addEventListener("focusout", (e) => {
        if (e.relatedTarget && el.contains(e.relatedTarget)) return;
        clearTimeout(el._autoTimer);
        el._autoTimer = setTimeout(() => {
          if (el.dataset.dirty && !el.contains(document.activeElement)) saveSegmentCard(id, el);
        }, 400);
      });

      const scriptEl = el.querySelector(".seg-script");
      // 자막·연출이 바뀌면 미리보기도 따라간다 (정지 화면은 바로, 살아 있는 미리보기는 입력이 멈추면 다시 만든다)
      const pvTextChanged = () => {
        const seg = segOfEl(el);
        if (!seg) return;
        if (!(pvActive && pvActive.el === el)) { pvIdle(el, seg); return; }
        clearTimeout(el._pvTimer);
        el._pvTimer = setTimeout(() => { if (pvActive && pvActive.el === el && !pvActive.playing) pvRefreshCard(id); }, 500);
      };
      scriptEl.addEventListener("input", () => { autoGrow(scriptEl); markDirty(); updateRuntimeSummary(); pvTextChanged(); });
      autoGrow(scriptEl);
      // SUBTITLE(화면 자막): SCRIPT처럼 고치면 미리보기·자막 트랙·장면 길이를 바로 다시 그리고, 카드에서 나가면 자동 저장
      const subEl = el.querySelector(".seg-subtitle");
      subEl.addEventListener("input", () => { autoGrow(subEl); markDirty(); updateRuntimeSummary(); pvTextChanged(); });
      autoGrow(subEl);
      // 입력 중에는 끊지 않고, 칸에서 나갈 때 화면 폭을 넘는 줄만 자동으로 나눈다 (직접 합친 줄은 그대로)
      scriptEl.addEventListener("focus", () => { el._capFocusText = scriptEl.value; });
      scriptEl.addEventListener("blur", () => {
        const before = el._capFocusText;
        el._capFocusText = null;
        if (capBlurSplit(el, before)) { markDirty(); updateRuntimeSummary(); pvTextChanged(); }
      });
      const directionEl = el.querySelector(".seg-direction");
      // ACTION은 한 줄 칸: Enter는 막고, 붙여넣은 줄바꿈은 공백으로
      directionEl.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
      directionEl.addEventListener("input", () => {
        if (/[\r\n]/.test(directionEl.value)) {
          const pos = directionEl.selectionStart;
          directionEl.value = oneLine(directionEl.value);
          try { directionEl.setSelectionRange(pos, pos); } catch {}
        }
        autoGrow(directionEl); markDirty(); pvTextChanged();
      });
      autoGrow(directionEl);
      const keywordEl = el.querySelector(".seg-keyword");
      keywordEl.addEventListener("input", markDirty);

      const triggerPexelsSearch = () => {
        const q = keywordEl.value.trim();
        if (!q) { showMsg("검색어를 먼저 입력하세요.", false); return; }
        searchPexelsPreview($("pexelsPickBody"), q, id);
      };
      el.querySelector(".seg-kw-search").addEventListener("click", triggerPexelsSearch);
      keywordEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); triggerPexelsSearch(); }
      });

      // 소재 영역: + 메뉴 / 미리보기 / 타임라인 손가락 동작
      const fileInput = el.querySelector(".seg-file-input");
      fileInput.addEventListener("change", (e) => { uploadSegmentAssets(id, e.target.files); e.target.value = ""; });
      el.querySelector(".seg-add-file").addEventListener("click", () => { closeAddMenus(); fileInput.click(); });
      el.querySelector(".seg-add-pexels").addEventListener("click", () => {
        closeAddMenus();
        if (!keywordEl.value.trim()) {
          showMsg("미리보기 옆 'SEARCHING KEY WORD' 칸에 영어 검색어를 먼저 쓰세요.", false);
          keywordEl.scrollIntoView({ behavior: "smooth", block: "center" });
          keywordEl.focus();
          return;
        }
        triggerPexelsSearch();
      });
      el.querySelector(".seg-add-blank").addEventListener("click", () => {
        const box = el.querySelector(".seg-add-blanks");
        const open = box.style.display === "none";
        box.style.display = open ? "block" : "none";
        if (open) box.innerHTML = blankButtonsHtml(segOfEl(el) || {});
      });
      el.querySelector(".seg-stage").addEventListener("click", (e) => {
        if (e.target.closest(".cap-lines") || Date.now() < (el._capNoClick || 0)) return;   // 자막 위 탭은 아래 제스처가 처리
        pvToggle(el);
      });
      bindStageCapGestures(el);
      el.querySelector(".seg-media").addEventListener("contextmenu", (e) => { if (e.target.closest(".seg-stage-box, .seg-tl-area")) e.preventDefault(); });
      bindTimelineGestures(el);
      bindCapGestures(el);
      el.querySelector(".seg-revert-btn").addEventListener("click", () => { clearTimeout(el._autoTimer); revertSegmentCard(id, el); });
      const cardSetBtn = el.querySelector(".seg-card-set");
      if (cardSetBtn) cardSetBtn.addEventListener("click", () => openCardPick(id));
      el.querySelector(".seg-delete-btn").addEventListener("click", () => { clearTimeout(el._autoTimer); deleteSegmentCard(id, el); });

      const durDisplay = el.querySelector(".seg-duration-display");
      const durInput = el.querySelector(".seg-duration-input");
      const durEditBtn = el.querySelector(".seg-duration-edit");
      const durSaveBtn = el.querySelector(".seg-duration-save");

      durEditBtn.addEventListener("click", () => {
        const seg = segments.find((s) => String(s.id) === id);
        durInput.value = effectiveSeconds(el, seg).toFixed(1);
        durDisplay.style.display = "none";
        durEditBtn.style.display = "none";
        durInput.style.display = "inline-block";
        durSaveBtn.style.display = "inline-block";
        durInput.focus();
        durInput.select();
      });

      durInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") durSaveBtn.click();
      });

      durSaveBtn.addEventListener("click", async () => {
        const raw = durInput.value;
        const value = raw === "" ? null : parseFloat(raw);
        durSaveBtn.disabled = true;
        try {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_segments?id=eq.${id}`, {
            method: "PATCH", headers: jsonHeaders,
            body: JSON.stringify({ target_seconds: value }),
          });
          if (!res.ok) throw new Error(await res.text());
          const seg = segments.find((s) => String(s.id) === id);
          if (seg) seg.target_seconds = value;
          durInput.style.display = "none";
          durSaveBtn.style.display = "none";
          durDisplay.style.display = "inline";
          durEditBtn.style.display = "inline-block";
          updateRuntimeSummary();
          showMsg("노출 시간을 저장했습니다.", true);
        } catch (err) {
          showMsg("노출 시간 저장 실패: " + err.message, false);
        } finally {
          durSaveBtn.disabled = false;
        }
      });
    });

    updateRuntimeSummary();
    // 카드마다 첫 클립의 정지 화면
    document.querySelectorAll(".seg-item").forEach((el) => { const seg = segOfEl(el); if (seg) pvIdle(el, seg); });
  }

  function autoGrow(el) {
    if (el.closest(".seg-stage-side")) return;   // 미리보기 옆 칸은 높이가 고정이다 (칸 안에서 스크롤)
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  async function selectPexelsResult(id, hdUrl, btn, duration) {
    const seg = segments.find((s) => String(s.id) === id);
    if (!seg || !hdUrl) return;
    const paths = seg.asset_paths || [];
    if (paths.includes(hdUrl)) { showMsg("이미 이 장면에 추가된 영상입니다.", false); return; }
    btn.disabled = true;
    try {
      // 원본 길이는 짧은 클립 경고용으로 asset_trims.__pexels에 같이 저장한다
      const trims = { ...(seg.asset_trims || {}) };
      if (Number(duration) > 0) trims.__pexels = { ...(trims.__pexels || {}), [hdUrl]: Number(duration) };
      await saveFields(id, { asset_paths: [...paths, hdUrl], asset_trims: trims });
      refreshThumbs(id);
      btn.textContent = "추가됨 ✓";
      showMsg("선택한 영상을 이 장면 소재로 추가했습니다.", true);
    } catch (err) {
      btn.disabled = false;
      showMsg("영상 추가 실패: " + err.message, false);
    }
  }

  // 검색 후보는 팝업으로 띄운다 (box = 팝업 안 내용 칸). 선택하면 그 장면 맨 뒤에 추가되고 팝업은 열린 채로 남아 여러 개 고를 수 있다
  function closePexelsPick() {
    $("pexelsPickModal").classList.remove("open");
    $("pexelsPickBody").innerHTML = "";
  }
  $("pexelsPickModal").addEventListener("click", (e) => { if (e.target.id === "pexelsPickModal") closePexelsPick(); });   // 바깥을 누르면 닫힘
  async function searchPexelsPreview(box, query, id) {
    $("pexelsPickModal").classList.add("open");
    // 머리줄(검색어 + 닫기)은 결과가 바뀌어도 그대로 둔다
    const head = `<div class="seg-pexels-head"><span>Pexels · '${escapeHtml(query)}'</span><button type="button" class="seg-pexels-close" title="닫기">✕</button></div>`;
    const setBody = (html) => {
      box.innerHTML = head + html;
      box.querySelector(".seg-pexels-close").addEventListener("click", closePexelsPick);
    };
    setBody('<div class="seg-pexels-loading">Pexels에서 검색 중...</div>');
    try {
      const otherUsedP = otherScriptsUsedKeys();   // Pexels 검색과 같이 읽는다 (처음 한 번만 DB를 부른다)
      const res = await fetch(`/api/pexels-search?q=${encodeURIComponent(query)}&orientation=portrait`);
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) throw new Error("Pexels 한도 초과입니다. 잠시 뒤에 다시 검색하세요.");
      if (!res.ok) throw new Error(data.error || "검색 실패");
      if (!data.results.length) {
        setBody('<div class="seg-pexels-loading">검색 결과가 없습니다.</div>');
        return;
      }
      const otherUsed = await otherUsedP;
      const seg = segments.find((s) => String(s.id) === id);
      const already = pexelsKeySet((seg && seg.asset_paths) || []);   // 같은 영상의 다른 파일이 들어 있어도 "추가됨"
      data.results.forEach((r) => { if (r.hd_url && r.thumbnail) pexelsThumbMem[r.hd_url] = r.thumbnail; });   // 타임라인 썸네일용
      // 순서는 매번 섞는다. 다른 콘티에서 쓴 영상은 "사용함"을 달아 뒤로 보낸다 (고를 수는 있다)
      const usedElsewhere = (r) => pexelsResultIn(otherUsed, r);
      const ordered = [...shuffled(data.results.filter((r) => !usedElsewhere(r))), ...shuffled(data.results.filter(usedElsewhere))];
      setBody(`<div class="seg-pexels-grid">${ordered.map((r) => `
        <div class="seg-pexels-item">
          <div class="seg-pexels-thumb-wrap" data-preview="${escapeAttr(r.preview_url)}">
            <img src="${r.thumbnail}?w=200" alt="" loading="lazy">
            <span class="seg-pexels-dur">${Math.round(r.duration)}s</span>
            ${usedElsewhere(r) ? '<span class="seg-pexels-used" title="다른 콘티에서 이미 쓴 영상입니다">사용함</span>' : ""}
          </div>
          <button type="button" class="seg-pexels-pick" data-hd="${escapeAttr(r.hd_url)}" data-dur="${Number(r.duration) || ""}" ${pexelsResultIn(already, r) ? "disabled" : ""}>
            ${pexelsResultIn(already, r) ? "추가됨 ✓" : "선택"}
          </button>
        </div>
      `).join("")}</div>
      <div class="seg-pexels-loading">썸네일을 누르면 미리 재생, "선택"을 누르면 이 장면 맨 뒤에 추가됩니다.</div>`);
      box.querySelectorAll(".seg-pexels-thumb-wrap").forEach((wrap) => {
        wrap.addEventListener("click", () => {
          const url = wrap.dataset.preview;
          if (!url || wrap.querySelector("video")) return;
          wrap.innerHTML = `<video src="${url}" autoplay muted loop playsinline></video>`;
        });
      });
      box.querySelectorAll(".seg-pexels-pick").forEach((btn) =>
        btn.addEventListener("click", () => selectPexelsResult(id, btn.dataset.hd, btn, btn.dataset.dur))
      );
    } catch (err) {
      setBody(`<div class="seg-pexels-loading">미리보기 실패: ${escapeHtml(err.message)}</div>`);
    }
  }

  async function refreshSegments(scriptId) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_segments?select=*&script_id=eq.${scriptId}&order=order_no.asc`, { headers });
    segments = await res.json();
    subColMissing = segments.length > 0 && !segments.some((sg) => "subtitle_text" in sg);
    const scrollY = window.scrollY;
    render();
    updateSettingsPreview();
    window.scrollTo(0, scrollY);
  }

  async function saveField(id, field, value) {
    return saveFields(id, { [field]: value });
  }
  // 여러 칸을 한 번에 저장 (소재 목록과 asset_trims를 같이 바꿀 때 중간 상태가 남지 않게)
  async function saveFields(id, fields) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_segments?id=eq.${id}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(fields),
    });
    if (!res.ok) throw new Error(await res.text());
    const seg = segments.find((s) => String(s.id) === String(id));
    if (seg) Object.assign(seg, fields);
    if ("asset_paths" in fields) updateRuntimeSummary();   // 사진 개수가 바뀌면 "사진을 더 넣으세요" 안내도 갱신
  }

  async function saveSegmentCard(id, el) {
    if (!el.dataset.dirty) return;
    const stateEl = el.querySelector(".seg-save-state");
    // 값은 저장을 시작하는 순간 읽어 둔다 (곧바로 다른 화면으로 넘어가도 이 값으로 저장된다)
    const scriptText = el.querySelector(".seg-script").value;
    const direction = el.querySelector(".seg-direction").value;
    const section = el.querySelector(".seg-section").value;
    const keyword = el.querySelector(".seg-keyword").value;
    // 화면 자막: 새 장면은 늘 저장(""도), 옛 장면은 글을 썼을 때만 (비워 두면 null 그대로 = SCRIPT 줄이 자막)
    const subText = subOf(el, segments.find((s) => String(s.id) === id));
    delete el.dataset.dirty;
    stateEl.className = "seg-save-state";
    stateEl.textContent = "저장 중…";
    // 자막 줄이 줄었으면 줄별 길이(__cap_secs)도 줄 수만큼만 남긴다 (인덱스 기준 유지, 넘치는 건 버림)
    const seg0 = segments.find((s) => String(s.id) === id);
    const fields = { script_text: scriptText, direction, section, keyword };
    if (subText != null && !subColMissing) fields.subtitle_text = subText;
    // 자동 끊기로 줄이 늘었으면(또는 직접 합친 줄 표시) asset_trims 초안이 있다. 대사와 같이 저장한다
    const draft = el._trimsDraft || null;
    const baseTrims = draft || (seg0 && seg0.asset_trims) || {};
    if (draft) fields.asset_trims = { ...draft };
    const capSecs = baseTrims.__cap_secs;
    const lineCount = genCaptionLines(scriptText).length;
    if (Array.isArray(capSecs) && capSecs.length > lineCount) {
      const nextTrims = { ...baseTrims };
      const kept = capSecs.slice(0, lineCount);
      if (kept.some((v) => v != null)) nextTrims.__cap_secs = kept; else delete nextTrims.__cap_secs;
      fields.asset_trims = nextTrims;
    }
    try {
      const patch = (f) => fetch(`${SUPABASE_URL}/rest/v1/youtube_segments?id=eq.${id}`, {
        method: "PATCH",
        headers: jsonHeaders,
        keepalive: true,
        body: JSON.stringify(f),
      });
      let res = await patch(fields);
      if (!res.ok) {
        const t = await res.text();
        // subtitle_text 칸이 아직 없는 DB(PGRST204): 자막 칸만 빼고 다시 저장하고 SQL 실행을 안내한다
        if (!("subtitle_text" in fields) || !/subtitle_text/.test(t) || !/PGRST204|column|schema/i.test(t)) throw new Error(t);
        delete fields.subtitle_text;
        subColMissing = true;
        res = await patch(fields);
        if (!res.ok) throw new Error(await res.text());
        showMsg("SUBTITLE(화면 자막)은 저장하지 못했어요 — DB에 칸이 없어요. Supabase에서 youtube_tables_18_subtitle.sql을 실행해 주세요.", false);
      }
      const seg = segments.find((s) => String(s.id) === id);
      const keywordChanged = seg && (seg.keyword || "").trim() !== keyword.trim();
      if (seg) { seg.script_text = scriptText; seg.direction = direction; seg.section = section; seg.keyword = keyword; }
      if (seg && "subtitle_text" in fields) seg.subtitle_text = fields.subtitle_text;
      if (seg && fields.asset_trims) seg.asset_trims = fields.asset_trims;
      if (draft && el._trimsDraft === draft) el._trimsDraft = null;
      if (keywordChanged) enqueueAutofill(id);   // 키워드를 바꿨으면 (모자란 장면이고 직접 지운 적 없으면) 새 키워드로 자동 배치
      // 저장하는 동안 또 고쳤다면 다시 수정됨 상태로 둔다
      if (el.dataset.dirty) { stateEl.textContent = "수정됨"; return; }
      stateEl.className = "seg-save-state ok";
      stateEl.textContent = "저장됨 ✓";
      setTimeout(() => { if (!el.dataset.dirty && stateEl.textContent === "저장됨 ✓") stateEl.textContent = ""; }, 1500);
    } catch (err) {
      el.dataset.dirty = "1";
      stateEl.className = "seg-save-state";
      stateEl.textContent = "저장 실패";
      showMsg("장면 자동 저장 실패: " + err.message, false);
    }
  }

  async function deleteSegmentCard(id, el) {
    const seg = segments.find((s) => String(s.id) === id);
    if (!seg) return;
    if (!confirm(`${seg.order_no}번 장면을 삭제할까요? 직접 올린 사진/영상도 함께 지워집니다.`)) return;

    try {
      for (const path of (seg.asset_paths || []).filter(isOwnStoragePath)) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, { method: "DELETE", headers });
      }
      const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_segments?id=eq.${id}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error(await res.text());

      segments = segments.filter((s) => String(s.id) !== id);
      if (pvActive && pvActive.el === el) pvStopAll();   // 지운 카드의 미리보기가 재생 중이면 멈춘다
      el.remove();

      // 번호 빈틈이 생기지 않게 1부터 다시 매긴다 (다른 카드의 입력 중 내용은 건드리지 않고 번호만 갱신)
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (s.order_no === i + 1) continue;
        const r = await fetch(`${SUPABASE_URL}/rest/v1/youtube_segments?id=eq.${s.id}`, {
          method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ order_no: i + 1 }),
        });
        if (!r.ok) throw new Error(await r.text());
        s.order_no = i + 1;
        const card = document.querySelector(`.seg-item[data-id="${s.id}"]`);
        if (card) card.querySelector(".seg-no").textContent = i + 1;
      }

      if (!segments.length) render();
      updateRuntimeSummary();
      showMsg("장면을 삭제했습니다.", true);
    } catch (err) {
      showMsg("장면 삭제 실패: " + err.message, false);
    }
  }

  function revertSegmentCard(id, el) {
    const seg = segments.find((s) => String(s.id) === id);
    if (!seg) return;
    if (!el.dataset.dirty) { showMsg("되돌릴 수정 내용이 없습니다 (이미 저장된 상태입니다).", false); return; }
    if (!confirm("마지막으로 저장된 상태로 되돌릴까요? 지금 수정한 내용은 사라집니다.")) return;

    const scriptEl = el.querySelector(".seg-script");
    const directionEl = el.querySelector(".seg-direction");
    scriptEl.value = seg.subtitle_text != null ? String(seg.script_text || "").replace(/\r/g, "") : normalizeScript(seg.script_text);
    directionEl.value = oneLine(seg.direction);
    const subEl = el.querySelector(".seg-subtitle");
    subEl.value = String(seg.subtitle_text || "").replace(/\r/g, "");
    autoGrow(subEl);
    el._trimsDraft = null;
    el.querySelector(".seg-section").value = seg.section || "";
    el.querySelector(".seg-keyword").value = seg.keyword || "";
    autoGrow(scriptEl);
    autoGrow(directionEl);

    delete el.dataset.dirty;
    el.querySelector(".seg-save-state").textContent = "";
    updateRuntimeSummary();
    pvRefreshCard(id);   // 미리보기의 자막·연출도 되돌린 내용으로
    showMsg("마지막 저장 상태로 되돌렸습니다.", true);
  }

  async function uploadSegmentAssets(id, fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const scriptId = document.getElementById("scriptSelect").value;
    const seg = segments.find((s) => String(s.id) === id);
    const paths = [...(seg.asset_paths || [])];

    let uploaded = 0;
    for (const file of files) {
      const rawName = file.name || `pasted_${Date.now()}.${(file.type.split("/")[1] || "png")}`;
      const safeName = rawName.replace(/[^\w.\-]/g, "_");
      const path = `${scriptId}/seg${id}_${Date.now()}_${safeName}`;
      try {
        const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
          method: "POST",
          headers: { ...headers, "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!upRes.ok) throw new Error(await upRes.text());
        paths.push(path);
        uploaded++;
      } catch (err) {
        showMsg(`"${file.name}" 업로드 실패: ${err.message}`, false);
      }
    }
    if (uploaded > 0) {
      await saveField(id, "asset_paths", paths);
      showMsg(`${uploaded}개 업로드 완료.`, true);
      refreshThumbs(id);
    }
  }

