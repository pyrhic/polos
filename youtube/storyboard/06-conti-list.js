// storyboard/06-conti-list.js — 콘티 이름 편집, 콘티 목록(loadScripts)·만드는 중 콘티, 새 콘티 만들기, 기사 사진·영상 가져오기
// storyboard.html에서 순서 그대로 잘라낸 파일. 일반 <script>로 차례대로 불러오므로 앞 파일의 전역(let/const/function)을 그대로 쓴다.
  // ───── 카드 머리의 콘티 이름: 누르면 그 자리에서 고침. Enter/바깥 누르기 = 저장, Esc = 취소 ─────
  function startNameEdit() {
    const inp = $("contiNameInput");
    inp.value = currentSettings.name || "";
    $("contiName").style.display = "none";
    inp.style.display = "";
    inp.focus();
    inp.select();
  }
  function endNameEdit(commit) {
    const inp = $("contiNameInput");
    if (inp.style.display === "none") return;
    inp.style.display = "none";
    $("contiName").style.display = "";
    const v = inp.value.trim();
    if (commit && v !== (currentSettings.name || "")) {
      currentSettings.name = v;
      partEdits.name++;
      updateSettingsSummary();
      savePart("name");
    }
  }
  $("contiName").addEventListener("click", startNameEdit);
  $("contiName").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startNameEdit(); } });
  $("contiNameInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); endNameEdit(true); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); endNameEdit(false); }
  });
  $("contiNameInput").addEventListener("blur", () => endNameEdit(true));

  // 콘티 목록과 (숨은) 선택 칸을 지금 scripts로 다시 그린다. 이름을 바꾼 뒤에도 부른다(고른 값은 그대로 둔다)
  function renderScriptList() {
    const sel = $("scriptSelect");
    const keep = sel.value;
    const nameOf = (r) => (r.video_settings && r.video_settings.name) || (r.hook || "").slice(0, 30) || "(이름 없음)";
    sel.innerHTML = '<option value="">선택하세요</option>' +
      scripts.map((r) => `<option value="${r.id}">${escapeHtml(nameOf(r))}</option>`).join("");
    sel.value = keep;
    // Pexels 슬라이드쇼도 같은 목록에 "슬라이드쇼" 표시로 섞어 보여 준다 (만든 날짜 순). 편집 화면이 달라서 누르면 pexels-edit.html로 간다
    const all = [...scripts, ...slideshows].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    $("contiList").innerHTML = all.length
      ? all.map((r) => isSlideshowRow(r)
        ? `<div class="conti-item" role="button" tabindex="0" data-id="${r.id}" data-slideshow="1">
          <div class="title">${escapeHtml(nameOf(r))} <span class="cj-badge ss">슬라이드쇼${(r.video_settings || {}).pexels_format === "long" || (r.video_settings || {}).orientation === "landscape" ? " · 롱폼" : ""}</span></div>
          <div class="meta">${escapeHtml((r.created_at || "").slice(0, 10))}</div>
        </div>`
        : `<div class="conti-item${contiIncomplete(r) ? " cj-pending" : ""}" role="button" tabindex="0" data-id="${r.id}">
          <div class="title">${escapeHtml(nameOf(r))}${contiBadge(r)}</div>
          <div class="meta">${escapeHtml((r.created_at || "").slice(0, 10))}</div>${contiErrorBox(r)}
        </div>`).join("")
      : '<div class="empty" style="margin:20px 0;">아직 콘티가 없습니다</div>';
  }

  async function loadScripts() {
    const sel = document.getElementById("scriptSelect");
    try {
      // 슬라이드쇼(Pexels)는 목록에만 보이고 콘티 편집·자동 채우기 등에는 쓰지 않는다 → scripts와 따로 둔다
      const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_scripts?select=*&status=eq.approved&order=created_at.desc`, { headers });
      if (!res.ok) throw new Error(await res.text());
      const rows = await res.json();
      scripts = rows.filter((r) => !isSlideshowRow(r));
      slideshows = rows.filter(isSlideshowRow);
      renderScriptList();
      schedulePendingRefresh();
    } catch (err) {
      sel.innerHTML = '<option value="">불러오기 실패</option>';
      $("contiList").innerHTML = '<div class="empty" style="margin:20px 0;">불러오기 실패</div>';
    }
  }


  // ───── 서버가 만드는 중인 콘티 (create_status: queued·running = 만드는 중, error = 실패, 비어 있음·done = 완성) ─────
  // 만드는 중인 콘티는 열 수 없고, 8초마다 그 행들만 다시 읽어 목록을 고친다 (다른 콘티를 편집 중인 값은 건드리지 않는다)
  const contiPending = (r) => !!r && (r.create_status === "queued" || r.create_status === "running");
  const contiIncomplete = (r) => !!r && (contiPending(r) || r.create_status === "error");
  function contiBadge(r) {
    if (!contiIncomplete(r)) return "";
    if (r.create_status === "error") return ' <span class="cj-badge err">실패</span>';
    if (ContiCore.isStale(r)) return ' <span class="cj-badge err">시간 초과</span>';
    return r.create_status === "queued" ? ' <span class="cj-badge">대기 중</span>' : ' <span class="cj-badge run">만드는 중…</span>';
  }
  function contiErrorBox(r) {
    const err = r.create_status === "error", stale = ContiCore.isStale(r);
    if (!err && !stale) return "";
    const why = err ? (r.create_error || "알 수 없는 오류") : "시간이 너무 오래 걸려 멈춘 것 같아요 (15분 넘음).";
    return `<div class="cj-err-text">${escapeHtml(why)}</div><div class="cj-actions">
      <button type="button" data-act="retry">다시 만들기</button><button type="button" data-act="browser">브라우저에서 만들기</button><button type="button" data-act="del" class="del">삭제</button></div>`;
  }
  let pendingTimer = 0;
  function schedulePendingRefresh() {
    clearTimeout(pendingTimer);
    if (scripts.some(contiPending)) pendingTimer = setTimeout(refreshPending, 8000);
  }
  async function refreshPending() {
    const ids = scripts.filter(contiIncomplete).map((r) => r.id);
    if (ids.length) {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_scripts?select=*&id=in.(${ids.join(",")})`, { headers });
        if (res.ok) {
          const rows = await res.json();
          scripts = scripts.filter((r) => !ids.includes(r.id) || rows.some((x) => x.id === r.id));
          rows.forEach((x) => { const r = scripts.find((y) => y.id === x.id); if (r) Object.assign(r, x); });
          renderScriptList();
        }
      } catch { /* 다음에 다시 */ }
    }
    schedulePendingRefresh();
  }
  window.addEventListener("contijob", () => refreshPending());
  // 실패·시간 초과한 콘티 다시 만들기: browser=true면 이 브라우저에서 (화면을 나가면 멈춤)
  async function retryConti(id, browser) {
    const r = scripts.find((x) => String(x.id) === String(id));
    if (!r) return;
    const name = (r.video_settings && r.video_settings.name) || (r.hook || "").slice(0, 30);
    try {
      // 먼저 "대기 중"으로 되돌린다 (감시가 옛 실패 상태를 보고 바로 실패 알림을 띄우지 않게)
      const patch = { create_status: "queued", create_error: null, create_started_at: new Date().toISOString() };
      const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_scripts?id=eq.${r.id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(patch) });
      if (!res.ok) throw new Error(await res.text());
      Object.assign(r, patch);
      renderScriptList();
      $("listMsg").className = "msg"; $("listMsg").textContent = "";
      ContiJob.launch([{ id: r.id, name }], { browser, onOpen: (x) => openConti(x) }).then(() => refreshPending());
      schedulePendingRefresh();
    } catch (err) {
      showListMsg("다시 만들기를 시작하지 못했어요: " + err.message, false);
    }
  }

  // ───── 새 콘티 만들기: Trend와 같은 팝업(conti-create-modal.js) ─────
  // 기사를 고르면 서버 작업(ContiJob)으로 Gemini가 대본·장면을 쓰고, 기사 없이 만들면 Gemini 없이 빈 장면 5개짜리 콘티를 바로 연다
  function openNewConti(prefill) {
    ContiCreateModal.open({
      ...(prefill || {}),
      getDefaults: async () => { await userDefaultsReady; return userDefaults; },
      onOpenConti: (id) => openConti(id),
      onCreated: async () => { $("listMsg").className = "msg"; $("listMsg").textContent = ""; await loadScripts(); },
      onAfterJob: () => refreshPending(),
    });
  }
  $("newContiBtn").addEventListener("click", () => openNewConti());

  // 채널 카드 소재 개수 글자: "사진 2장 · 영상 1개"
  function cardMediaText(paths) {
    const list = paths || [];
    const v = list.filter((p) => isVideo(p)).length, ph = list.length - v;
    if (!list.length) return "소재 없음";
    return [ph ? `사진 ${ph}장` : "", v ? `영상 ${v}개` : ""].filter(Boolean).join(" · ");
  }
  // 카드 소재(사진 또는 영상) 중 하나: 그 카드로 이미 만든 콘티 수 기준으로 돌아가며 (못 세면 무작위). 소재가 없으면 빈 배열
  // 영상도 스토리지 경로라서 장면 asset_paths에 그대로 들어가고, 콘티 미리보기·파이프라인이 직접 올린 영상과 똑같이 다룬다
  // excludeId: 이미 있는 콘티에 불러올 때 그 콘티 자신은 세지 않는다 (새 콘티 만들 때와 같은 순번이 되게)
  async function pickCardPhoto(card, excludeId) {
    const list = card.image_paths || [];
    if (!list.length) return [];
    let n = Math.floor(Math.random() * list.length);
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/youtube_scripts?select=id&video_settings->>subscribe_card_id=eq.${card.id}${excludeId != null ? `&id=neq.${excludeId}` : ""}`, { headers });
      if (r.ok) n = (await r.json()).length;
    } catch { /* 무작위 */ }
    return [list[n % list.length]];
  }
  // 예전 Trend 화면(세션에 trendDraft를 남기고 넘어옴)에서 온 경우에도 팝업을 연다
  function openNewContiFromTrend() {
    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem("trendDraft") || "null");
      sessionStorage.removeItem("trendDraft");
    } catch {}
    if (!saved || !saved.topic) return;
    openNewConti({ topic: saved.topic, articles: saved.articles || [], traffic: saved.traffic || "", geo: saved.geo || "" });
  }

  // 기사 사진/영상을 장면에 돌아가며 나눠 담는다(이미 있는 소재는 그대로 두고 뒤에 추가).
  // 출처는 asset_notes에 같이 저장해 장면에서 확인/삭제할 수 있게 한다.
  async function importArticleImages(scriptId, targetSegs, items, btn) {
    const colCheck = await fetch(`${SUPABASE_URL}/rest/v1/youtube_segments?select=asset_notes&limit=1`, { headers });
    if (!colCheck.ok) {
      return " (기사 사진·영상은 건너뜀: 출처를 저장할 asset_notes 컬럼이 없습니다 — youtube_tables_11_asset_notes.sql 실행 필요)";
    }
    const bySeg = new Map(targetSegs.map((sg) => [sg.id, { paths: [...(sg.asset_paths || [])], notes: { ...(sg.asset_notes || {}) }, added: 0 }]));
    // 같은 사진이 CDN 서버 번호(img1/img4 등)만 달라지는 경우가 있어 번호를 빼고 비교한다
    const normUrl = (u) => String(u).replace(/^(https?:\/\/[a-z]+)\d+\./i, "$1.");
    const already = new Set(targetSegs.flatMap((sg) => Object.values(sg.asset_notes || {}).map((n) => n && n.origUrl).filter(Boolean)).map(normUrl));
    let ok = 0, videos = 0, skipped = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (already.has(normUrl(it.url))) { skipped++; continue; }
      const seg = targetSegs[i % targetSegs.length];
      btn.textContent = `기사 사진·영상 가져오는 중... (${i + 1}/${items.length})`;
      try {
        const r = await fetch("/api/save-article-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: it.url, referer: it.articleUrl, scriptId: scriptId, segId: seg.id, n: i }),
        });
        const d = await r.json();
        if (!r.ok) continue;
        const entry = bySeg.get(seg.id);
        entry.paths.push(d.path);
        entry.notes[d.path] = { source: it.source, articleUrl: it.articleUrl, articleTitle: it.articleTitle, caption: it.caption, origUrl: it.url };
        entry.added++;
        ok++;
        if (it.type === "video") videos++;
      } catch { /* 하나 실패해도 나머지는 계속 */ }
    }
    for (const [segId, entry] of bySeg) {
      if (!entry.added) continue;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/youtube_segments?id=eq.${segId}`, {
        method: "PATCH", headers: jsonHeaders,
        body: JSON.stringify({ asset_paths: entry.paths, asset_notes: entry.notes }),
      });
      if (!r.ok) throw new Error("소재 연결 저장 실패: " + await r.text());
    }
    if (!ok) return skipped ? " (새로 가져올 사진·영상이 없습니다 — 이미 다 가져왔어요)" : " (기사 사진·영상을 가져오지 못했습니다)";
    return ` 기사 사진 ${ok - videos}장${videos ? `, 영상 ${videos}개` : ""}를 장면에 가져왔습니다 — 저작권 확인 후 문제 있는 건 × 로 삭제하세요.`;
  }

  function embedNote(embeds) {
    if (!embeds || !embeds.length) return "";
    return ` 기사 속 유튜브 영상 ${embeds.length}개는 내려받지 않고 링크만 알려요: ${embeds.map((e) => e.link).join(" , ")}`;
  }

  // 이미 만든 콘티에도 기사 사진/영상을 가져올 수 있게: 콘티에 저장된 기사 주소(fact_sources)에서 찾는다
  async function addArticleMedia() {
    const scriptId = $("scriptSelect").value;
    const row = scripts.find((r) => String(r.id) === String(scriptId));
    if (!row || !segments.length) return;
    await flushDirtyCards();
    const urls = (row.fact_sources || "").split("\n").map((l) => l.trim()).filter((l) => /^https?:\/\/\S+$/.test(l));
    if (!urls.length) { showMsg("이 콘티에 저장된 기사 주소가 없습니다.", false); return; }
    const btn = $("addMediaBtn");
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "기사에서 사진·영상 찾는 중...";
    try {
      const res = await fetch("/api/article-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articles: urls.map((u) => ({ url: u, source: new URL(u).hostname.replace(/^www\./, "") })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "찾기 실패");
      const items = [...data.media.filter((m) => m.type === "image").slice(0, 8), ...data.media.filter((m) => m.type === "video").slice(0, 3)];
      let text = "";
      if (items.length) text = await importArticleImages(Number(scriptId), segments, items, btn);
      else text = " 기사에서 가져올 수 있는 사진·영상을 찾지 못했습니다.";
      showMsg(text.trim() + embedNote(data.embeds), true);
      await refreshSegments(scriptId);
    } catch (err) {
      showMsg("기사 사진·영상 가져오기 실패: " + err.message, false);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

