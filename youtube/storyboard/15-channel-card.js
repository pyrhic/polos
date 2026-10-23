// storyboard/15-channel-card.js — 채널 카드(구독/좋아요) 고르기·등록·적용
// storyboard.html에서 순서 그대로 잘라낸 파일. 일반 <script>로 차례대로 불러오므로 앞 파일의 전역(let/const/function)을 그대로 쓴다.
  // ───── 채널 카드 설정: 이미 있는 콘티의 채널 카드 장면(구독/좋아요)을 채널 화면에서 만든 카드로 바꾸거나, 지금 장면을 새 카드로 등록한다 ─────
  // 채널은 콘티에 저장된 channel_slot, 없으면 출처 규칙(위키 콘티 → source=wiki 채널, 그 밖 → trend 채널).
  // 채널 카드 장면이 없는 옛 콘티는 같은 팝업으로 맨 끝에 채널 카드 장면을 새로 붙인다 (segId = null, 등록 칸 없음).
  let cardPickCards = [];
  let cardPickBusy = false;   // 등록 중에는 팝업을 닫지 않는다
  function closeCardPick() {
    if (cardPickBusy) return;
    $("cardPickModal").classList.remove("open");
    $("cardPickBody").innerHTML = "";
    cardPickCards = [];
  }
  $("cardPickModal").addEventListener("click", (e) => { if (e.target.id === "cardPickModal") closeCardPick(); });
  async function contiChannel(row) {
    const vs = row.video_settings || {};
    const q = vs.channel_slot != null
      ? `slot=eq.${encodeURIComponent(vs.channel_slot)}`
      : `source=eq.${/^위키/.test(row.category || "") ? "wiki" : "trend"}&order=sort_order.asc,slot.asc&limit=1`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_channels?select=slot,label&${q}`, { headers });
    if (!res.ok) throw new Error("채널 표를 읽지 못함");
    const ch = (await res.json())[0];
    if (ch) return ch;
    if (vs.channel_slot != null) return { slot: vs.channel_slot, label: `채널 ${vs.channel_slot}` };
    throw new Error("이 콘티의 채널이 정해지지 않음");
  }
  // note: 목록 위에 띄울 짧은 안내 { text, ok } (등록 직후 다시 그릴 때)
  async function openCardPick(segId, note) {
    const scriptId = $("scriptSelect").value;
    const row = scripts.find((r) => String(r.id) === String(scriptId));
    if (!row) return;
    const body = $("cardPickBody");
    const head = (title) => `<div class="seg-pexels-head"><span>${escapeHtml(title)}</span><button type="button" class="seg-pexels-close" title="닫기">✕</button></div>`;
    const noteHtml = note ? `<div class="cardpick-note${note.ok ? " ok" : ""}">${escapeHtml(note.text)}</div>` : "";
    const setBody = (title, html) => {
      body.innerHTML = head(title) + noteHtml + html;
      body.querySelector(".seg-pexels-close").addEventListener("click", closeCardPick);
    };
    $("cardPickModal").classList.add("open");
    if (!note) setBody("채널 카드 설정", '<div class="empty" style="margin:16px 0;">불러오는 중...</div>');
    try {
      const ch = await contiChannel(row);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_subscribe_cards?select=*&channel_slot=eq.${ch.slot}&order=sort_order.asc,id.asc`, { headers });
      if (!res.ok) throw new Error("채널 카드 표를 읽지 못함");
      if (String($("scriptSelect").value) !== String(scriptId)) return;   // 그 사이 다른 콘티로 넘어갔다
      cardPickCards = (await res.json()).map((c) => ({ ...c, image_paths: Array.isArray(c.image_paths) ? c.image_paths : [] }));
      const curId = currentSettings.subscribe_card_id != null ? currentSettings.subscribe_card_id : (row.video_settings || {}).subscribe_card_id;
      const title = `${ch.label} 채널 카드 · ${segId ? "고르면 이 장면에 적용" : "고르면 맨 끝에 추가"}`;
      const listHtml = cardPickCards.length
        ? `<div class="cardpick-list">${cardPickCards.map((c, i) => {
          const first = (normalizeScript(c.script_text || "").split("\n").find((l) => l.trim()) || "(문구 없음)").trim();
          const img = c.image_paths[0];
          return `<button type="button" class="cardpick-item" data-i="${i}">
          <span class="cardpick-thumb">${!img ? "소재 없음" : isVideo(img) ? `<video src="${escapeAttr(assetUrl(img))}#t=0.1" muted playsinline preload="metadata"></video>` : `<img src="${escapeAttr(assetUrl(img))}" alt="" loading="lazy" onerror="this.remove()">`}</span>
          <span class="cardpick-txt">
            <span class="cardpick-name" style="display:block;">${escapeHtml(c.name || "(이름 없음)")}${c.is_default ? '<span class="def">★기본</span>' : ""}${String(c.id) === String(curId) ? ' <span style="color:var(--muted);font-weight:700;">· 지금 카드</span>' : ""}</span>
            <span class="cardpick-line" style="display:block;">${escapeHtml(first)}</span>
            <span class="cardpick-line" style="display:block;">${cardMediaText(c.image_paths)}${c.direction ? " · " + escapeHtml(oneLine(c.direction)) : ""}</span>
          </span>
        </button>`;
        }).join("")}</div>`
        : `<div class="empty" style="margin:16px 0;">${escapeHtml(ch.label)} 채널에 채널 카드가 없어요.${segId ? " 아래에서 지금 장면을 카드로 등록하거나" : ""} 채널 화면에서 만들어 주세요.</div>`;
      // 등록 칸: 채널 카드 장면이 있을 때만 (지금 장면의 문구·연출·사진을 이 채널의 새 카드로)
      const t = currentSettings.name || "";
      const regHtml = segId ? `<div class="cardpick-reg">
          <div class="cardpick-reg-title">이 카드를 채널 카드로 등록</div>
          <div class="cardpick-reg-hint">지금 장면의 문구·연출·사진·영상을 ${escapeHtml(ch.label)} 채널의 새 카드로 저장해요. 사진·영상(Pexels 영상 포함)은 채널 카드 보관함으로 복사되고, 빈 화면은 빠져요.</div>
          <div class="cardpick-reg-row">
            <input type="text" class="cardpick-reg-name" maxlength="40" placeholder="카드 이름" value="${escapeAttr(t ? `${t} 카드`.slice(0, 40) : "새 채널 카드")}">
            <button type="button" class="cardpick-reg-btn">등록</button>
          </div>
        </div>` : "";
      setBody(title, listHtml + regHtml);
      body.querySelectorAll(".cardpick-item").forEach((b) => b.addEventListener("click", () => {
        const card = cardPickCards[Number(b.dataset.i)];
        if (card) applyCardToConti(scriptId, segId, card);
      }));
      const regBtn = body.querySelector(".cardpick-reg-btn");
      if (regBtn) regBtn.addEventListener("click", () => registerSceneAsCard(scriptId, segId, ch, body.querySelector(".cardpick-reg-name").value.trim()));
    } catch (err) {
      setBody("채널 카드 설정", `<div class="empty" style="margin:16px 0;">채널 카드를 불러오지 못했어요 (${escapeHtml(err.message)})</div>`);
    }
  }
  // 지금 채널 카드 장면을 이 채널의 새 카드(youtube_subscribe_cards)로 저장한다.
  // 장면 소재는 콘티에서 지우면 스토리지에서도 지워지는 파일일 수 있으므로 subscribe/<채널>/ 아래로 복사해서 쓴다 (채널 화면 업로드와 같은 이름 규칙).
  //  - 우리 스토리지의 사진·영상: 내려받아 subscribe/로 복사
  //  - Pexels 영상·사진(외부 주소): 브라우저가 Pexels 서버에서 직접 못 받을 수 있어(CORS) /api/save-pexels-clip이 받아서 subscribe/에 저장
  //  - 빈 화면(blank:*)과 그 밖의 외부 주소는 카드 소재가 될 수 없어 빼고 알려 준다
  const CARD_MAX_MB = 50;   // 파일 한 개 최대 (Supabase 무료 요금제 업로드 한도. 채널 화면·서버 함수와 같다)
  async function registerSceneAsCard(scriptId, segId, ch, name) {
    if (cardPickBusy) return;
    const seg = segments.find((s) => String(s.id) === String(segId));
    if (!seg) { closeCardPick(); return; }
    if (!name) { alert("카드 이름을 써 주세요."); return; }
    const btn = $("cardPickBody").querySelector(".cardpick-reg-btn");
    const el = document.querySelector(`.seg-item[data-id="${seg.id}"]`);
    // 문구·연출은 화면에 보이는 값 그대로 (아직 자동 저장 전이어도)
    const scriptText = el ? el.querySelector(".seg-script").value : (seg.script_text || "");
    const direction = el ? el.querySelector(".seg-direction").value : (seg.direction || "");
    const assets = seg.asset_paths || [];
    const items = assets.filter((p) => isStoragePath(p) || isPexels(p));
    const blanks = assets.filter(isBlank).length;
    const others = assets.length - items.length - blanks;
    let tooBig = 0;
    cardPickBusy = true;
    if (btn) { btn.disabled = true; btn.textContent = "등록 중…"; }
    const copied = [];
    try {
      for (const [i, p] of items.entries()) {
        if (btn) btn.textContent = `등록 중… (${i + 1}/${items.length})`;
        const kind = isVideo(p) ? "영상" : "사진";
        if (isPexels(p)) {
          const r = await fetch("/api/save-pexels-clip", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: p, slot: Number(ch.slot) }),
          });
          const data = await r.json().catch(() => ({}));
          if (r.status === 413) { tooBig++; continue; }
          if (!r.ok || !data.path) throw new Error(`Pexels ${kind}을 저장하지 못함 (${data.error || r.status})`);
          copied.push(data.path);
          continue;
        }
        const r = await fetch(publicUrl(p));
        if (!r.ok) throw new Error(`${kind}을 읽지 못함 (${p.split("/").pop()})`);
        const blob = await r.blob();
        if (blob.size > CARD_MAX_MB * 1024 * 1024) { tooBig++; continue; }
        const safeName = (p.split("/").pop() || (isVideo(p) ? "clip.mp4" : "photo.jpg")).replace(/[^\w.\-]/g, "_");
        const dest = `subscribe/${ch.slot}/${Date.now()}_${safeName}`;
        const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${dest}`, {
          method: "POST",
          headers: { ...headers, "Content-Type": blob.type || "application/octet-stream" },
          body: blob,
        });
        if (!up.ok) throw new Error(`${kind} 복사 실패: ${await up.text()}`);
        copied.push(dest);
      }
      const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_subscribe_cards`, {
        method: "POST",
        headers: { ...jsonHeaders, Prefer: "return=representation" },
        body: JSON.stringify({
          channel_slot: Number(ch.slot), name: name.slice(0, 40), script_text: scriptText, image_paths: copied, direction,
          is_default: false, sort_order: cardPickCards.reduce((m, c) => Math.max(m, c.sort_order || 0), 0) + 1,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const rows = await res.json();
      const card = Array.isArray(rows) ? rows[0] : rows;
      cardPickBusy = false;
      if (String($("scriptSelect").value) !== String(scriptId)) return;
      // 새 카드를 이 콘티의 지금 카드로 (savePart 규칙: 고른 카드와 그 채널만 덮어쓴다)
      currentSettings.subscribe_card_id = card.id;
      currentSettings.channel_slot = card.channel_slot;
      partEdits.card++;
      const saved = await savePart("card");
      applyCardVoice(card);   // 새 카드엔 목소리가 없다 → 동기화 중이었으면 끈다
      const skipText = [
        blanks ? ` 빈 화면 ${blanks}개는 카드 소재가 될 수 없어 뺐어요.` : "",
        others ? ` 외부 주소 소재 ${others}개는 뺐어요.` : "",
        tooBig ? ` ${CARD_MAX_MB}MB가 넘는 파일 ${tooBig}개는 뺐어요.` : "",
      ].join("");
      const text = `"${card.name}" 카드를 등록했어요 (${cardMediaText(copied)}).${skipText}`;
      if (saved) showMsg(text, true);
      openCardPick(segId, { text, ok: true });
    } catch (err) {
      cardPickBusy = false;
      // 카드를 못 만들었으면 복사해 둔 사진·영상도 지운다
      for (const p of copied) { try { await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${p}`, { method: "DELETE", headers }); } catch { /* 넘어간다 */ } }
      if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = "등록"; }
      showMsg(`채널 카드 등록 실패: ${err.message}`, false);
      alert(`채널 카드 등록 실패: ${err.message}`);
    }
  }
  async function applyCardToConti(scriptId, segId, card) {
    const seg = segId ? segments.find((s) => String(s.id) === String(segId)) : null;
    if (segId && !seg) { closeCardPick(); return; }
    if (seg && !confirm("지금 채널 카드 장면의 문구와 사진이 바뀌어요. 바꿀까요?")) return;
    closeCardPick();
    try {
      // 다른 카드에서 고치던 내용은 먼저 저장한다 (다시 그릴 때 잃지 않게). 바꿀 장면의 고치던 내용은 카드 값으로 덮인다
      const el = seg ? document.querySelector(`.seg-item[data-id="${seg.id}"]`) : null;
      if (el) { clearTimeout(el._autoTimer); delete el.dataset.dirty; el._trimsDraft = null; }
      await flushDirtyCards();
      const photo = await pickCardPhoto(card, scriptId);
      if (seg) {
        const oldPaths = seg.asset_paths || [];
        const paths = photo.length ? photo : oldPaths;   // 카드 사진이 없으면 지금 소재 그대로
        // 자막 줄 길이·직접 정한 줄 표시는 새 문구에 맞지 않으므로 비운다. 빠진 소재의 구간/위치/비중 기록도 지운다
        const trims = { ...(seg.asset_trims || {}) };
        delete trims.__cap_secs;
        delete trims.__cap_manual;
        const dropped = oldPaths.filter((p) => !paths.includes(p));
        dropped.forEach((p) => {
          delete trims[p];
          ["__focus", "__weights", "__pexels"].forEach((key) => {
            if (!trims[key] || trims[key][p] === undefined) return;
            const { [p]: _x, ...rest } = trims[key];
            if (Object.keys(rest).length) trims[key] = rest; else delete trims[key];
          });
        });
        const fields = { script_text: card.script_text || "", direction: card.direction || "", asset_paths: paths, asset_trims: trims };
        const notes = seg.asset_notes || {};
        if (dropped.some((p) => notes[p] !== undefined)) {
          fields.asset_notes = Object.fromEntries(Object.entries(notes).filter(([k]) => !dropped.includes(k)));
        }
        await saveFields(seg.id, fields);
        // 이 콘티만 쓰던 파일은 스토리지에서도 지운다 (채널 카드 사진 subscribe/...는 여러 콘티가 같이 써서 둔다)
        for (const p of dropped) {
          if (isOwnStoragePath(p)) { try { await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${p}`, { method: "DELETE", headers }); } catch { /* 파일 정리는 실패해도 넘어간다 */ } }
        }
      } else {
        const nextOrder = segments.length ? Math.max(...segments.map((s) => s.order_no)) + 1 : 1;
        const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_segments`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            script_id: Number(scriptId), order_no: nextOrder,
            section: SUBSCRIBE_PART, script_text: card.script_text || "", keyword: "", direction: card.direction || "", asset_paths: photo,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
      }
      if (String($("scriptSelect").value) !== String(scriptId)) return;
      // 콘티 설정에는 고른 카드와 그 채널만 덮어쓴다 (savePart 규칙)
      currentSettings.subscribe_card_id = card.id;
      currentSettings.channel_slot = card.channel_slot;
      partEdits.card++;
      const saved = savePart("card");
      applyCardVoice(card);   // 카드에 이름 붙은 목소리가 있으면 콘티 전체 목소리도 그 목소리로 (없으면 지금 목소리 그대로, 동기화만 끔)
      await refreshSegments(scriptId);
      capAutoSplitOnOpen(scriptId);   // 새 문구에서 화면 폭을 넘는 줄은 자동으로 나눈다
      const target = seg ? document.querySelector(`.seg-item[data-id="${seg.id}"]`)
        : Array.from(document.querySelectorAll(".seg-item")).reverse().find((x) => isSubscribeSeg(segOfEl(x) || {}));
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      if (await saved) showMsg(`"${card.name}" 채널 카드를 ${seg ? "적용" : "추가"}했습니다.`, true);
    } catch (err) {
      showMsg(`채널 카드 ${seg ? "적용" : "추가"} 실패: ${err.message}`, false);
      refreshSegments(scriptId).catch(() => {});
    }
  }
  $("addCardSegBtn").addEventListener("click", () => openCardPick(null));

