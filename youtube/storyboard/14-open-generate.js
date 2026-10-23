// storyboard/14-open-generate.js — 생성 전 검사(소재 없는 장면), 콘티 열기/목록 전환, 길게 눌러 삭제, 콘티 통째 삭제, 생성 후 자동 업로드 체크, 영상 생성 버튼·생성 상태 감시, 장면 추가
// storyboard.html에서 순서 그대로 잘라낸 파일. 일반 <script>로 차례대로 불러오므로 앞 파일의 전역(let/const/function)을 그대로 쓴다.
  // ───── 생성 전 검사: 소재가 하나도 없는 장면이 있으면 생성하지 않는다 (구독/좋아요 장면 제외) ─────
  function emptySceneProblems() {
    return [...segments].sort((a, b) => a.order_no - b.order_no)
      .filter((s) => !isSubscribeSeg(s) && !(s.asset_paths || []).length)
      .map((s) => {
        const af = (s.asset_trims || {}).__autofill;
        const why = af && af.status === "quota" ? "Pexels 한도 초과입니다. 소재를 채워주세요."
          : af && af.status === "no_results" ? "검색 결과가 없습니다. 소재를 채워주세요."
          : "콘티를 확인해주세요.";
        return `${s.order_no}번 장면: ${why}`;
      });
  }

  let lastScriptId = "";
  document.getElementById("scriptSelect").addEventListener("change", (e) => {
    if (hasDirty() && !confirm("설정 카드에 저장 안 한 수정사항이 있습니다. 그래도 넘어갈까요?")) {
      e.target.value = lastScriptId;
      return;
    }
    flushCapSave();   // 자막 조작은 기다리지 않고 바로 저장(값은 지금 콘티 것으로 잡아 둔다)
    if (cardsDirty()) flushDirtyCards(); // 장면 카드는 자동 저장
    lastScriptId = e.target.value;
    const inDetail = !!e.target.value;
    $("listView").style.display = inDetail ? "none" : "block";
    $("detailView").style.display = inDetail ? "block" : "none";
    if (inDetail) window.scrollTo(0, 0);
    loadSettingsCard(e.target.value);
    loadSegments(e.target.value);
    if (inDetail) refreshGenState(e.target.value);
  });
  function openConti(id) {
    const row = id ? scripts.find((r) => String(r.id) === String(id)) : null;
    if (row && contiIncomplete(row)) {   // 아직 만드는 중이거나 실패한 콘티는 열지 않는다
      if ($("scriptSelect").value) { $("scriptSelect").value = ""; $("scriptSelect").dispatchEvent(new Event("change", { bubbles: true })); }
      showListMsg(row.create_status === "error" ? "만들기에 실패한 콘티예요. 아래 버튼으로 다시 만들거나 삭제하세요." : "아직 만드는 중인 콘티예요. 다 만들어지면 알려 드릴게요.", row.create_status !== "error");
      const el = document.querySelector(`.conti-item[data-id="${row.id}"]`);
      if (el) el.scrollIntoView({ block: "center" });
      return;
    }
    if (row && row.create_request && row.create_request.result_note && !row.create_request.note_shown) {   // 자동 생성 결과 안내(처음 열 때 한 번)
      showMsg(`"${(row.video_settings && row.video_settings.name) || ""}" 콘티가 만들어졌습니다. ${row.create_request.result_note}`, true);
      row.create_request.note_shown = true;
      fetch(`${SUPABASE_URL}/rest/v1/youtube_scripts?id=eq.${row.id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ create_request: row.create_request }) }).catch(() => {});
    }
    const sel = $("scriptSelect");
    sel.value = String(id);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }
  // 카드를 길게 누르면(0.6초) 삭제 확인이 뜬다. 스크롤하려고 손가락을 움직이면 취소하고,
  // 길게 눌러서 확인창이 뜬 뒤에 이어지는 클릭은 카드를 열지 않게 막는다.
  function bindLongPress(listEl, itemSel, onLong) {
    let timer = null, startX = 0, startY = 0, fired = false;
    const clear = () => {
      clearTimeout(timer); timer = null;
      listEl.querySelectorAll(itemSel + ".pressing").forEach((e) => e.classList.remove("pressing"));
    };
    listEl.addEventListener("pointerdown", (e) => {
      const item = e.target.closest(itemSel);
      if (!item || e.button > 0) return;
      fired = false; startX = e.clientX; startY = e.clientY;
      item.classList.add("pressing");
      timer = setTimeout(() => {
        fired = true; clear();
        if (navigator.vibrate) navigator.vibrate(30);
        onLong(item.dataset.id);
      }, 600);
    });
    listEl.addEventListener("pointermove", (e) => { if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 10) clear(); });
    ["pointerup", "pointercancel", "pointerleave"].forEach((t) => listEl.addEventListener(t, () => { if (timer) clear(); }));
    listEl.addEventListener("contextmenu", (e) => { if (e.target.closest(itemSel)) e.preventDefault(); });
    listEl.addEventListener("click", (e) => { if (fired) { fired = false; e.stopPropagation(); e.preventDefault(); } }, true);
  }
  bindLongPress($("contiList"), ".conti-item", (id) => deleteConti(id));
  $("contiList").addEventListener("click", (e) => {
    const item = e.target.closest(".conti-item");
    if (!item) return;
    const act = e.target.closest("[data-act]");
    if (act) {   // 실패한 콘티의 버튼: 다시 만들기 / 브라우저에서 만들기 / 삭제
      e.stopPropagation();
      if (act.dataset.act === "del") deleteConti(item.dataset.id);
      else retryConti(item.dataset.id, act.dataset.act === "browser");
      return;
    }
    if (item.dataset.slideshow) { openSlideshow(item.dataset.id); return; }
    openConti(item.dataset.id);
  });
  $("contiList").addEventListener("keydown", (e) => {
    if (e.target.closest("[data-act]")) return;
    const item = e.target.closest(".conti-item");
    if (item && e.key === "Enter") { if (item.dataset.slideshow) openSlideshow(item.dataset.id); else openConti(item.dataset.id); }
  });

  function showListMsg(text, ok) {
    const m = $("listMsg");
    m.className = "msg " + (ok ? "ok" : "err");
    m.textContent = text;
  }

  // 콘티 하나를 통째로 지운다: 만든 영상(파일+기록), 올려둔 사진/음악, 장면, 콘티 순서.
  // 유튜브에 이미 올린 영상은 유튜브에 그대로 남는다(여기서는 지울 수 없다).
  async function deleteConti(id) {
    const row = scripts.find((r) => String(r.id) === String(id)) || slideshows.find((r) => String(r.id) === String(id));
    if (!row) return;
    if (row.generation_status === "running") { showListMsg("영상 생성 중인 콘티는 끝난 뒤에 삭제할 수 있습니다.", false); return; }
    if (contiPending(row) && !ContiCore.isStale(row)) { showListMsg("콘티를 만드는 중이라 다 만든 뒤에 삭제할 수 있어요.", false); return; }
    const name = (row.video_settings && row.video_settings.name) || (row.hook || "").slice(0, 30) || "(이름 없음)";
    try {
      const [segRes, outRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/youtube_segments?select=id&script_id=eq.${id}`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/youtube_outputs?select=id,storage_path,youtube_status&script_id=eq.${id}`, { headers }),
      ]);
      const segCount = segRes.ok ? (await segRes.json()).length : 0;
      const outputs = outRes.ok ? await outRes.json() : [];
      const onYoutube = outputs.filter((o) => o.youtube_status === "done").length;
      const lines = [`"${name}" 콘티를 삭제할까요?`, "", `· 장면 ${segCount}개와 올려둔 사진·영상·음악`, `· 만든 영상 ${outputs.length}개`];
      if (onYoutube) lines.push("", `※ 유튜브에 이미 올린 영상 ${onYoutube}개는 유튜브에 그대로 남습니다 (유튜브 스튜디오에서 직접 삭제해야 합니다).`);
      lines.push("", "되돌릴 수 없습니다.");
      if (!confirm(lines.join("\n"))) return;

      showListMsg("삭제하는 중...", true);
      // 1) 만든 영상
      for (const o of outputs) {
        const r = await fetch(`${SUPABASE_URL}/storage/v1/object/youtube-outputs/${o.storage_path}`, { method: "DELETE", headers });
        if (!r.ok && r.status !== 404) { const t = await r.text(); if (!/not_found|Object not found/i.test(t)) throw new Error("영상 파일 삭제 실패: " + t); }
      }
      if (outputs.length) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/youtube_outputs?script_id=eq.${id}`, { method: "DELETE", headers });
        if (!r.ok) throw new Error("영상 기록 삭제 실패: " + await r.text());
      }
      // 2) 올려둔 사진/영상/음악 (콘티 번호 폴더에 모여 있다)
      const listRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
        method: "POST", headers: jsonHeaders, body: JSON.stringify({ prefix: `${id}/`, limit: 1000 }),
      });
      if (listRes.ok) {
        const files = (await listRes.json()).filter((f) => f.name).map((f) => `${id}/${f.name}`);
        if (files.length) {
          await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, { method: "DELETE", headers: jsonHeaders, body: JSON.stringify({ prefixes: files }) });
        }
      }
      // 3) 장면, 그리고 콘티
      let r = await fetch(`${SUPABASE_URL}/rest/v1/youtube_segments?script_id=eq.${id}`, { method: "DELETE", headers });
      if (!r.ok) throw new Error("장면 삭제 실패: " + await r.text());
      r = await fetch(`${SUPABASE_URL}/rest/v1/youtube_scripts?id=eq.${id}`, { method: "DELETE", headers });
      if (!r.ok) throw new Error("콘티 삭제 실패: " + await r.text());

      if (genWatch.has(String(id))) { clearInterval(genWatch.get(String(id))); genWatch.delete(String(id)); }
      contiJobsRemove(id);
      await loadScripts();
      showListMsg(`"${name}" 콘티를 삭제했습니다.`, true);
    } catch (err) {
      showListMsg("삭제 실패: " + err.message, false);
      await loadScripts();
    }
  }
  $("backToList").addEventListener("click", () => openConti(""));

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && cardsDirty()) flushDirtyCards(); });
  window.addEventListener("beforeunload", (e) => {
    if (cardsDirty()) flushDirtyCards();
    if (capPending()) flushCapSave();
    if (hasDirty() || capPending() || cardsDirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  $("addMediaBtn").addEventListener("click", addArticleMedia);

  // ───── 생성 후 자동 업로드 (video_settings.auto_upload, 콘티마다): 켜면 완성 영상이 콘티의 채널에 비공개로 올라간다 ─────
  // 제목·설명·태그·채널은 Studio 업로드 폼의 처음 값과 같다 (upload.js ytAutoUploadPayload). 체크는 바꾸는 즉시 저장한다
  let autoUpSeq = 0;
  let ytChannelsReady = null;   // 채널 표는 화면을 열고 한 번만 읽는다
  const primeYtChannels = () => ytChannelsReady || (ytChannelsReady = ytPrimeChannels());
  async function renderAutoUpload() {
    const seq = ++autoUpSeq;
    $("autoUpChk").checked = currentSettings.auto_upload === true;
    $("autoUpCh").textContent = "";
    const row = scripts.find((r) => String(r.id) === String($("scriptSelect").value));
    if (!row) return;
    await primeYtChannels();
    if (seq !== autoUpSeq) return;
    const slot = ytDefaultSlot({ ...row, video_settings: { ...(row.video_settings || {}), channel_slot: currentSettings.channel_slot } });
    const ch = ytChannels().find((c) => c.slot === slot);
    $("autoUpCh").textContent = ch ? `→ ${ch.label}` : "";
  }
  $("autoUpChk").addEventListener("change", () => {
    if (!scripts.some((r) => String(r.id) === String($("scriptSelect").value))) return;
    currentSettings.auto_upload = $("autoUpChk").checked;
    partEdits.autoup++;
    savePart("autoup");
  });

  // ───── 영상 생성: 시작하면 "생성 중"으로 바뀌고, 끝나면 알림. 완성 영상은 Studio에서 확인 ─────
  const genWatch = new Map(); // scriptId -> 타이머
  async function refreshGenState(scriptId) {
    const btn = $("genBtn");
    const info = await genFetchInfo(scriptId);
    const status = info ? info.status : null;
    if (String($("scriptSelect").value) !== String(scriptId)) return status;
    const noteEl = $("genNote");
    if (status === "error") {
      noteEl.innerHTML = `${escapeHtml(genErrorText(info.lastError, info.name))}${info.lastError && info.lastError.url ? ` · <a href="${escapeAttr(info.lastError.url)}" target="_blank" rel="noopener" style="color:var(--accent);">실행 기록 보기</a>` : ""}<br>버튼을 다시 누르면 재시도합니다 (일시적인 서버 오류는 재시도로 해결되는 경우가 많습니다).`;
      noteEl.style.display = "block";
    } else {
      noteEl.style.display = "none";
    }
    if (status === "running") {
      btn.disabled = true;
      btn.textContent = "영상 생성 중... (몇 분 걸려요)";
      watchGeneration(scriptId);
    } else {
      btn.disabled = false;
      btn.textContent = `영상 생성 (v${await genNextVersion(scriptId)})`;
    }
    return status;
  }

  function watchGeneration(scriptId) {
    if (genWatch.has(String(scriptId))) return;
    const timer = setInterval(async () => {
      const status = await genFetchStatus(scriptId);
      if (status === "running" || status === null) return;
      clearInterval(timer);
      genWatch.delete(String(scriptId));
      const row = scripts.find((r) => String(r.id) === String(scriptId));
      if (row) row.generation_status = status;
      // 워크플로우가 video_settings에 쓴 값(자동 업로드 기록 youtube_last·youtube_history, 실패 정보 last_error)을 받아 둔다.
      // 옛 값 위에 설정을 저장하면 이 기록이 지워지기 때문
      if (row) {
        try {
          const fr = await fetch(`${SUPABASE_URL}/rest/v1/youtube_scripts?select=video_settings&id=eq.${encodeURIComponent(scriptId)}`, { headers });
          const fresh = fr.ok ? (((await fr.json())[0] || {}).video_settings || {}) : null;
          if (fresh) row.video_settings = { ...(row.video_settings || {}), youtube_last: fresh.youtube_last, youtube_history: fresh.youtube_history, last_error: fresh.last_error };
        } catch { /* 못 읽으면 그대로 */ }
      }
      const name = row ? ((row.video_settings && row.video_settings.name) || (row.hook || "").slice(0, 20)) : "";
      genNotify(name, status === "done");
      if (String($("scriptSelect").value) === String(scriptId)) refreshGenState(scriptId);
    }, 8000);
    genWatch.set(String(scriptId), timer);
  }

  $("genBtn").addEventListener("click", async () => {
    const scriptId = $("scriptSelect").value;
    const row = scripts.find((r) => String(r.id) === String(scriptId));
    if (!row) return;
    if (hasDirty()) { showMsg("설정 카드에 저장 안 한 수정사항이 있습니다. 먼저 저장한 뒤 영상을 생성하세요.", false); return; }
    const btn = $("genBtn");
    btn.disabled = true;
    try {
      await flushDirtyCards();
      await flushCapSave();
      if (capPending()) throw new Error("자막·분위기 설정 저장이 끝나지 않았습니다. 잠시 후 다시 눌러주세요.");
      if (cardsDirty()) throw new Error("장면 저장이 끝나지 않았습니다. 잠시 후 다시 눌러주세요.");
      // 콘티에서 보이는 것 = 생성되는 영상: 자동 배치가 끝나기 전이거나 빈 장면이 있으면 생성하지 않는다
      if (autofillPending()) throw new Error("Pexels 자동 배치가 아직 진행 중입니다. 끝난 뒤 다시 눌러주세요.");
      const problems = emptySceneProblems();
      if (problems.length) {
        const noteEl = $("genNote");
        noteEl.innerHTML = problems.map(escapeHtml).join("<br>");
        noteEl.style.display = "block";
        btn.disabled = false;
        showMsg("소재가 없는 장면이 있어 영상을 생성하지 않았습니다. " + problems.join(" / "), false);
        return;
      }
      const version = await genNextVersion(scriptId);
      // 자막 줄 길이를 계산한 목소리 속도(화면에 보이는 값)를 그대로 넘긴다 — 저장된 설정에 tts_rate가 없을 때도 콘티 길이 = 요청 길이
      // 콘티 화면의 영상은 늘 "제목 + 영상 + 출처"(framed). Pexels 슬라이드쇼는 pexels-edit.html에서 따로 genStart를 부르므로 영향 없음
      const genRow = { ...row, video_settings: { ...(row.video_settings || {}), layout: "framed", tts_rate: ttsRateNow() } };
      // 생성되면 자동으로 비공개 업로드: Studio에서 이 버전을 올릴 때의 처음 값(제목·설명·태그·채널)을 지금 만들어 같이 보낸다
      let autoUpload = null, autoUpText = "";
      if ($("autoUpChk").checked) {
        await primeYtChannels();
        autoUpload = ytAutoUploadPayload(genRow, version);
        if (!autoUpload.title) throw new Error("자동 업로드 제목이 비어 있어요 — 콘티 이름을 정하거나 자동 업로드를 끄세요.");
        const ch = ytChannels().find((c) => c.slot === autoUpload.channelSlot);
        autoUpText = `\n\n완성되면 "${ch ? ch.label : `채널 ${autoUpload.channelSlot}`}" 채널에 비공개로 자동 업로드합니다 (제목: ${autoUpload.title}).`;
      }
      if (!confirm(`v${version} 영상 생성을 시작할까요? 몇 분 걸리고, 완성되면 알려드립니다. 영상은 Studio에서 확인하세요.${autoUpText}`)) { btn.disabled = false; return; }
      genRequestPermission();
      await genStart(genRow, segments, version, autoUpload ? { autoUpload } : undefined);
      row.generation_status = "running";
      btn.textContent = "영상 생성 중... (몇 분 걸려요)";
      watchGeneration(scriptId);
      showMsg(autoUpload ? "영상 생성을 시작했습니다. 완성되면 유튜브에 비공개로 자동 업로드하고 알려 드려요." : "영상 생성을 시작했습니다. 완성되면 알림이 뜹니다.", true);
    } catch (err) {
      btn.disabled = false;
      showMsg("영상 생성 실패: " + err.message, false);
    }
  });

  document.getElementById("addSegBtn").addEventListener("click", async () => {
    const scriptId = document.getElementById("scriptSelect").value;
    if (!scriptId) return;
    const nextOrder = segments.length ? Math.max(...segments.map((s) => s.order_no)) + 1 : 1;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_segments`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          script_id: Number(scriptId), order_no: nextOrder,
          section: "", script_text: "", keyword: "", direction: "", asset_paths: [],
          ...(contiIsNew() ? { subtitle_text: "" } : {}),   // 새 콘티(SUBTITLE을 쓰는 콘티)면 새 장면으로, 옛 콘티는 옛 장면 그대로
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      showMsg("장면을 추가했습니다.", true);
      await refreshSegments(scriptId);
      const list = document.getElementById("segList");
      list.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      showMsg("장면 추가 실패: " + err.message, false);
    }
  });

