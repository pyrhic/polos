// Channels 화면: 채널(youtube_channels) 설정 + 채널별 구독 카드(youtube_subscribe_cards) 디자인.
// 채널 표는 anon 공개라 비밀값(토큰·키)은 절대 저장·표시하지 않는다. 연결 "상태"만 다룬다.
(function () {
  const SB = POLOS_CONFIG.SUPABASE_URL;
  const KEY = POLOS_CONFIG.SUPABASE_ANON_KEY;
  const BUCKET = "youtube-assets";
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const jsonHeaders = { ...headers, "Content-Type": "application/json" };
  const SOURCES = [["trend", "Trend"], ["wiki", "Wikipedia"], ["pexels", "Pexels"]];
  const DIRECTIONS = ["천천히 줌인", "천천히 줌아웃", "좌에서 우로 패닝", "우에서 좌로 패닝", "틸트업", "틸트다운"];
  const DIR_CLASS = { "천천히 줌인": "dir-zin", "천천히 줌아웃": "dir-zout", "좌에서 우로 패닝": "dir-lr", "우에서 좌로 패닝": "dir-rl", "틸트업": "dir-tu", "틸트다운": "dir-td" };

  let channels = [];
  let cards = [];
  let openId = null;       // 펼친 구독 카드 id
  let draft = null;        // 펼친 카드의 저장 전 값 { name, script_text, direction }
  let pvIndex = 0;         // 미리보기에서 보고 있는 자막 줄
  let busy = false;

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const publicUrl = (p) => `${SB}/storage/v1/object/public/${BUCKET}/${p}`;
  const nowIso = () => new Date().toISOString();

  function showMsg(text, ok) {
    const m = $("#msg");
    m.className = "msg " + (ok ? "ok" : "err");
    m.textContent = text;
    clearTimeout(showMsg.t);
    if (ok) showMsg.t = setTimeout(() => { m.className = "msg"; }, 3500);
  }

  async function rest(path, opt = {}) {
    const res = await fetch(`${SB}/rest/v1/${path}`, opt);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new Error((data && (data.message || data.error)) || `요청 실패 (${res.status})`);
    return data;
  }
  const patch = (table, filter, body) => rest(`${table}?${filter}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(body) });

  // ───── 불러오기 ─────
  async function loadAll() {
    const [ch, sc] = await Promise.all([
      rest("youtube_channels?select=slot,label,ready,sort_order,check_status,check_message,checked_at,source&order=sort_order.asc,slot.asc", { headers }),
      rest("youtube_subscribe_cards?select=*&order=sort_order.asc,id.asc", { headers }),
    ]);
    channels = ch || [];
    cards = (sc || []).map(normCard);
  }
  function normCard(c) {
    return { ...c, image_paths: Array.isArray(c.image_paths) ? c.image_paths : [] };
  }
  const cardsOf = (slot) => cards.filter((c) => String(c.channel_slot) === String(slot))
    .sort((a, b) => (b.is_default - a.is_default) || (a.sort_order - b.sort_order) || (a.id - b.id));

  async function init() {
    try {
      await loadAll();
      render();
      if (channels.some((c) => c.check_status === "checking")) startPoll();
    } catch (err) {
      $("#list").innerHTML = `<div class="empty">불러오기 실패: ${esc(err.message)}<br><span style="font-size:0.8rem;">(youtube_tables_14_channels.sql, youtube_tables_15_subscribe_cards.sql을 실행했는지 확인하세요)</span></div>`;
    }
  }

  // ───── 그리기 ─────
  function connHtml(c) {
    const st = c.check_status;
    const tag = st === "ok" ? `<span class="tag tag-ok">연결됨 ✓</span>`
      : st === "error" ? `<span class="tag tag-error">오류</span>`
      : st === "checking" ? `<span class="tag tag-checking"><span class="spinner" style="width:10px;height:10px;margin-right:4px;"></span>확인 중</span>`
      : `<span class="tag tag-none">확인 안 함</span>`;
    const when = c.checked_at ? new Date(c.checked_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    const msg = st === "checking" ? "깃허브 액션이 업로드 없이 로그인 허가증만 확인하고 있어요 (1~2분)."
      : [c.check_message, when && `마지막 확인 ${when}`].filter(Boolean).join(" · ");
    return `<div class="conn-top"><span class="k">연결 상태</span>${tag}
        <button type="button" class="btn-sm" data-act="check" data-slot="${c.slot}"${st === "checking" ? " disabled" : ""}>연결 확인</button></div>
      ${msg ? `<div class="conn-msg">${esc(msg)}</div>` : ""}`;
  }

  function render() {
    const list = $("#list");
    if (!channels.length) {
      list.innerHTML = `<div class="empty">채널 표(youtube_channels)가 비어 있습니다. 지금은 config.js의 기본 목록으로 업로드합니다.</div>`;
      return;
    }
    list.innerHTML = channels.map((c) => `
      <div class="card-box" data-slot="${c.slot}">
        <div class="ch-head">
          <input class="ch-label" type="text" maxlength="40" value="${esc(c.label)}" data-slot="${c.slot}" aria-label="채널 이름">
          <span class="ch-slot" title="GitHub 비밀값과 짝인 업로드 번호">업로드 #${c.slot}</span>
        </div>
        <div class="ch-saved" data-saved="${c.slot}"></div>
        <div class="ch-row"><span class="k">콘티 출처</span><span class="v">
          <select data-act="source" data-slot="${c.slot}" aria-label="콘티 출처">
            <option value=""${c.source ? "" : " selected"}>정하지 않음</option>
            ${SOURCES.map(([v, l]) => `<option value="${v}"${c.source === v ? " selected" : ""}>${l}</option>`).join("")}
          </select></span></div>
        <div class="ch-row"><span class="k">사용 상태</span><span class="v">
          <label class="sw"><input type="checkbox" data-act="ready" data-slot="${c.slot}"${c.ready ? " checked" : ""}><i></i><span>${c.ready ? "로그인 승인됨" : "승인 전 (숨김)"}</span></label>
        </span></div>
        ${c.ready ? "" : `<div class="ch-note" style="margin:-4px 0 6px;">끄면 업로드 화면의 채널 목록에 보이지 않습니다.</div>`}
        <div class="conn" data-conn="${c.slot}">${connHtml(c)}</div>
        <div class="sc-title"><span class="k">구독 카드</span>
          <button type="button" class="btn-sm" data-act="new" data-slot="${c.slot}">+ 새 카드</button></div>
        ${cardsOf(c.slot).map(cardHtml).join("") || `<div class="ch-note" style="padding:6px 0;">아직 카드가 없습니다. "+ 새 카드"로 만드세요.</div>`}
      </div>`).join("");
    if (openId != null) bindPreview();
  }

  function cardHtml(k) {
    const open = String(k.id) === String(openId);
    const dirty = open && isDirty();
    return `<div class="sc-item${open ? " open" : ""}" data-card="${k.id}">
      <div class="sc-bar" data-act="toggle" data-card="${k.id}" role="button" tabindex="0" aria-expanded="${open}">
        <span class="sc-star${k.is_default ? " on" : ""}" title="${k.is_default ? "기본 카드" : ""}">${k.is_default ? "★" : "☆"}</span>
        <span class="sc-name">${esc(open ? draft.name : k.name)}</span>
        ${dirty ? `<span class="sc-dirty">저장 안 됨</span>` : `<span class="sc-meta">사진 ${k.image_paths.length}장</span>`}
        <span class="sc-meta">${open ? "▲" : "▼"}</span>
      </div>
      ${open ? editHtml(k) : ""}
    </div>`;
  }

  function editHtml(k) {
    const n = k.image_paths.length;
    return `<div class="sc-tools" style="padding-top:2px;">
        <button type="button" data-act="default" data-card="${k.id}"${k.is_default ? " disabled" : ""}>${k.is_default ? "★ 기본 카드" : "기본으로"}</button>
        <button type="button" data-act="dup" data-card="${k.id}">복제</button>
        <button type="button" class="danger" data-act="del" data-card="${k.id}"${k.is_default ? " disabled title=\"다른 카드를 기본으로 지정한 뒤 삭제할 수 있어요\"" : ""}>삭제</button>
      </div>
      ${k.is_default ? `<div class="sc-hint" style="padding:0 10px;margin-top:-4px;">기본 카드는 지울 수 없어요. 다른 카드를 "기본으로" 지정한 뒤 지우세요.</div>` : ""}
      <div class="sc-edit">
        <label>카드 이름</label>
        <input type="text" class="f-name" maxlength="40" value="${esc(draft.name)}">
        <label>자막 문구</label>
        <textarea class="f-script" placeholder="내 알고리즘 밖의 이야기가 궁금하다면&#10;구독 좋아요 해주시면 **나도 좋아요**">${esc(draft.script_text)}</textarea>
        <div class="sc-hint">줄바꿈 = 자막 한 줄 · <b>[ ]</b> 안은 읽기만 하고 자막엔 숨김 · <b>{ }</b> 안은 자막에만 보이고 읽지 않음 · <b>**글자**</b> = 노란 강조</div>
        <label>사진 (${n}장)</label>
        <div class="ph-grid">
          ${k.image_paths.map((p, i) => `<div class="ph" style="background-image:url('${esc(publicUrl(p))}')">
              <span class="no">${i + 1}</span>
              <div class="ph-tools">
                <button type="button" data-act="ph-left" data-i="${i}" aria-label="앞으로"${i === 0 ? " disabled" : ""}>◀</button>
                <button type="button" class="del" data-act="ph-del" data-i="${i}" aria-label="사진 삭제">✕</button>
                <button type="button" data-act="ph-right" data-i="${i}" aria-label="뒤로"${i === n - 1 ? " disabled" : ""}>▶</button>
              </div></div>`).join("")}
          <label class="ph-add"><span class="plus">+</span>사진 추가<input type="file" class="f-files" accept="image/*" multiple></label>
        </div>
        <div class="sc-hint">사진은 영상마다 돌아가며 한 장씩 쓰입니다. 사진 추가·삭제·순서는 바로 저장돼요.</div>
        <label>카메라 연출</label>
        <select class="f-dir">${DIRECTIONS.map((d) => `<option${d === draft.direction ? " selected" : ""}>${d}</option>`).join("")}
          ${DIRECTIONS.includes(draft.direction) ? "" : `<option selected>${esc(draft.direction)}</option>`}</select>
        <label>미리보기</label>
        <div class="pv-wrap">
          <div class="pv" title="눌러서 다음 자막 줄">
            <div class="pv-t pv-t1">제목 칸</div><div class="pv-t pv-t2">(영상 제목)</div>
            <div class="pv-media">${n ? `<div class="pv-photo" style="background-image:url('${esc(publicUrl(k.image_paths[0]))}')"></div>` : `<div class="pv-empty">사진을 추가하면<br>여기에 보여요</div>`}</div>
            <div class="pv-cap"></div>
            <div class="pv-src">출처 칸</div>
          </div>
          <div class="pv-side">
            <div class="pv-nav"><button type="button" data-act="pv-prev" aria-label="이전 줄">◀</button><span class="pv-count"></span><button type="button" data-act="pv-next" aria-label="다음 줄">▶</button></div>
            <ol class="pv-lines"></ol>
            <div class="sc-hint" style="margin:0;">첫 사진 + 고른 연출로 보여줘요. 실제 영상에선 사진이 영상마다 돌아가며 바뀝니다.</div>
          </div>
        </div>
        <div class="sc-save-row">
          <button type="button" class="sc-save${isDirty() ? " dirty" : ""}" data-act="save" data-card="${k.id}" style="flex:2;">${isDirty() ? "저장" : "저장됨"}</button>
          <button type="button" data-act="revert" style="flex:1;"${isDirty() ? "" : " disabled"}>되돌리기</button>
        </div>
        <div class="sc-msg"></div>
      </div>`;
  }

  // ───── 미리보기 ─────
  // generate.js와 같은 규칙: 줄바꿈(그리고 옛 표시 " / ")마다 자막 한 줄.
  // [ ]는 읽기만 하고 자막에서 숨김, { }는 자막에만 보이고 읽지 않음, **글자**는 강조(노랑)
  const HIDE_RE = /\[([^\[\]]*)\]/g;
  const MUTE_RE = /\{([^{}]*)\}/g;
  function capLines(text) {
    return String(text || "").replace(/\r/g, "").replace(/[ \t]+\/[ \t]+/g, "\n")
      .split("\n").map((s) => s.trim()).filter(Boolean);
  }
  function capHtml(line) {
    const shown = line.replace(HIDE_RE, " ").replace(MUTE_RE, "$1").replace(/\s+/g, " ").trim();
    if (!shown.replace(/\*\*/g, "").trim()) return `<span class="hid">(읽기만 · 자막 없음)</span>`;
    return esc(shown).replace(/\*\*(.+?)\*\*/g, '<span class="em">$1</span>').replace(/\*\*/g, "");
  }
  // 오른쪽 줄 목록: [숨김]은 연한 기울임, {자막만}은 점선 밑줄로 구분해 보여 준다
  function lineListHtml(line) {
    return String(line || "").split(/(\[[^\[\]]*\]|\{[^{}]*\})/).map((part) => {
      const inner = esc(part.slice(1, -1).replace(/\*\*/g, ""));
      if (/^\[[^\[\]]*\]$/.test(part)) return inner ? `<span class="ln-hid" title="읽기만 (자막 숨김)">${inner}</span>` : "";
      if (/^\{[^{}]*\}$/.test(part)) return inner ? `<span class="ln-mute" title="자막만 (읽지 않음)">${inner}</span>` : "";
      return esc(part.replace(/\*\*/g, ""));
    }).join("");
  }
  function updatePreview() {
    const box = document.querySelector(".sc-item.open");
    if (!box || !draft) return;
    const lines = capLines(draft.script_text);
    if (pvIndex >= lines.length) pvIndex = Math.max(0, lines.length - 1);
    $(".pv-cap", box).innerHTML = lines.length ? capHtml(lines[pvIndex]) : "";
    $(".pv-count", box).textContent = lines.length ? `${pvIndex + 1}/${lines.length}` : "0/0";
    $(".pv-lines", box).innerHTML = lines.map((l, i) => `<li data-i="${i}" class="${i === pvIndex ? "on" : ""}">${i + 1}. ${lineListHtml(l)}</li>`).join("");
    const photo = $(".pv-photo", box);
    if (photo) photo.className = "pv-photo " + (DIR_CLASS[draft.direction] || "");
  }
  function bindPreview() { updatePreview(); }

  function isDirty() {
    const k = cards.find((c) => String(c.id) === String(openId));
    return !!(k && draft && (draft.name !== k.name || draft.script_text !== k.script_text || draft.direction !== k.direction));
  }
  function refreshDirty() {
    const box = document.querySelector(".sc-item.open");
    if (!box) return;
    const d = isDirty();
    const save = $(".sc-save", box);
    save.classList.toggle("dirty", d);
    save.textContent = d ? "저장" : "저장됨";
    $('[data-act="revert"]', box).disabled = !d;
    const bar = $(".sc-bar", box);
    $(".sc-name", bar).textContent = draft.name;
    const meta = bar.querySelector(".sc-dirty, .sc-meta");
    const k = cards.find((c) => String(c.id) === String(openId));
    meta.outerHTML = d ? `<span class="sc-dirty">저장 안 됨</span>` : `<span class="sc-meta">사진 ${k.image_paths.length}장</span>`;
  }
  function cardMsg(text, ok) {
    const m = document.querySelector(".sc-item.open .sc-msg");
    if (!m) return showMsg(text, ok);
    m.className = "sc-msg" + (ok ? "" : " err");
    m.textContent = text;
  }

  function openCard(id) {
    if (openId != null && String(openId) !== String(id) && isDirty() && !confirm("저장하지 않은 구독 카드 수정이 있어요. 버리고 다른 카드를 열까요?")) return;
    if (String(openId) === String(id)) {
      if (isDirty() && !confirm("저장하지 않은 수정이 있어요. 버리고 닫을까요?")) return;
      openId = null; draft = null;
    } else {
      const k = cards.find((c) => String(c.id) === String(id));
      openId = k.id;
      draft = { name: k.name, script_text: k.script_text, direction: k.direction };
      pvIndex = 0;
    }
    render();
    if (openId != null) document.querySelector(".sc-item.open")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // ───── 채널 저장 ─────
  function savedNote(slot, text, ok = true) {
    const el = document.querySelector(`[data-saved="${slot}"]`);
    if (!el) return;
    el.className = "ch-saved" + (ok ? "" : " err");
    el.textContent = text;
    clearTimeout(el._t);
    if (ok) el._t = setTimeout(() => { el.textContent = ""; }, 2500);
  }
  async function patchChannel(slot, body, okText) {
    const c = channels.find((x) => String(x.slot) === String(slot));
    const before = { ...c };
    try {
      await patch("youtube_channels", `slot=eq.${encodeURIComponent(slot)}`, body);
      Object.assign(c, body);
      savedNote(slot, okText);
      return true;
    } catch (err) {
      Object.assign(c, before);
      savedNote(slot, "저장 실패: " + err.message, false);
      return false;
    }
  }

  async function checkChannel(slot, btn) {
    btn.disabled = true;
    btn.textContent = "요청 중...";
    try {
      const res = await fetch("/api/check-channel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channelSlot: String(slot) }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
      const c = channels.find((x) => String(x.slot) === String(slot));
      Object.assign(c, { check_status: "checking", check_message: null });
      updateConn(slot);
      startPoll();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "연결 확인";
      showMsg("연결 확인 실패: " + err.message, false);
    }
  }
  function updateConn(slot) {
    const el = document.querySelector(`[data-conn="${slot}"]`);
    const c = channels.find((x) => String(x.slot) === String(slot));
    if (el && c) el.innerHTML = connHtml(c);
  }
  // 확인 중인 채널이 있으면 상태 칸만 새로 읽는다 (편집 중인 카드는 건드리지 않음). 최대 5분.
  let pollTimer = null, pollUntil = 0;
  function startPoll() {
    pollUntil = Date.now() + 5 * 60 * 1000;
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      try {
        const rows = await rest("youtube_channels?select=slot,check_status,check_message,checked_at", { headers });
        (rows || []).forEach((r) => {
          const c = channels.find((x) => String(x.slot) === String(r.slot));
          if (c && (c.check_status !== r.check_status || c.checked_at !== r.checked_at)) { Object.assign(c, r); updateConn(c.slot); }
        });
      } catch { /* 다음 차례에 다시 */ }
      if (!channels.some((c) => c.check_status === "checking") || Date.now() > pollUntil) { clearInterval(pollTimer); pollTimer = null; }
    }, 6000);
  }

  // ───── 구독 카드 저장 ─────
  async function createCard(slot, from) {
    const mine = cardsOf(slot);
    const body = {
      channel_slot: Number(slot),
      name: from ? `${from.name} (복사)`.slice(0, 40) : "새 구독 카드",
      script_text: from ? from.script_text : "",
      image_paths: from ? [...from.image_paths] : [],
      direction: from ? from.direction : DIRECTIONS[0],
      is_default: !mine.some((c) => c.is_default),
      sort_order: mine.reduce((m, c) => Math.max(m, c.sort_order || 0), 0) + 1,
    };
    const rows = await rest("youtube_subscribe_cards", { method: "POST", headers: { ...jsonHeaders, Prefer: "return=representation" }, body: JSON.stringify(body) });
    const row = normCard(Array.isArray(rows) ? rows[0] : rows);
    cards.push(row);
    return row;
  }

  // 기본 카드는 채널마다 하나(부분 유니크 인덱스)라서, 먼저 기존 기본을 끄고 새 카드를 켠다. 실패하면 되돌린다.
  async function makeDefault(id) {
    const k = cards.find((c) => String(c.id) === String(id));
    const prev = cardsOf(k.channel_slot).find((c) => c.is_default);
    if (prev) await patch("youtube_subscribe_cards", `id=eq.${prev.id}`, { is_default: false });
    try {
      await patch("youtube_subscribe_cards", `id=eq.${k.id}`, { is_default: true });
    } catch (err) {
      if (prev) await patch("youtube_subscribe_cards", `id=eq.${prev.id}`, { is_default: true }).catch(() => {});
      throw err;
    }
    if (prev) prev.is_default = false;
    k.is_default = true;
  }

  // 복제한 카드끼리는 같은 사진 파일을 함께 쓰므로, 다른 카드가 안 쓰는 사진만 스토리지에서 지운다
  // keep: 이미 만든 콘티가 쓰고 있어서 남겨야 하는 경로
  async function removeUnusedFiles(paths, exceptId, keep = new Set()) {
    const used = new Set(cards.filter((c) => String(c.id) !== String(exceptId)).flatMap((c) => c.image_paths));
    for (const p of paths) {
      if (used.has(p) || keep.has(p) || /^https?:/.test(p)) continue;
      await fetch(`${SB}/storage/v1/object/${BUCKET}/${p}`, { method: "DELETE", headers }).catch(() => {});
    }
  }

  // 이미 만든 콘티가 이 사진들을 쓰는지 센다. asset_paths는 jsonb 배열이라 cs.["경로"]로 포함 여부를 묻는다.
  // 반환: { usedPaths: Set(쓰이는 경로), sceneIds: Set, scriptIds: Set }. 요청이 실패하면 throw.
  async function findSceneUsage(paths) {
    const usedPaths = new Set(), sceneIds = new Set(), scriptIds = new Set();
    const targets = paths.filter((p) => p && !/^https?:/.test(p));
    const results = await Promise.all(targets.map((p) =>
      rest(`youtube_segments?select=id,script_id&asset_paths=cs.${encodeURIComponent(JSON.stringify([p]))}`, { headers })));
    results.forEach((rows, i) => {
      if (!Array.isArray(rows) || !rows.length) return;
      usedPaths.add(targets[i]);
      for (const r of rows) { sceneIds.add(String(r.id)); scriptIds.add(String(r.script_id)); }
    });
    return { usedPaths, sceneIds, scriptIds };
  }

  async function deleteCard(id) {
    const k = cards.find((c) => String(c.id) === String(id));
    if (k.is_default) { alert("기본 카드는 지울 수 없어요. 다른 카드를 먼저 \"기본으로\" 지정하세요."); return; }
    // 이 카드로 만든 콘티(video_settings.subscribe_card_id)와 이 카드 사진을 쓰는 장면을 센다
    let usage = null;
    try {
      const [scripts, scenes] = await Promise.all([
        rest(`youtube_scripts?select=id&video_settings->>subscribe_card_id=eq.${encodeURIComponent(k.id)}`, { headers }),
        findSceneUsage(k.image_paths),
      ]);
      const scriptIds = new Set([...(scripts || []).map((r) => String(r.id)), ...scenes.scriptIds]);
      usage = { scriptCount: scriptIds.size, usedPaths: scenes.usedPaths };
    } catch (err) {
      usage = null;
    }
    if (!usage) {
      if (!confirm("사용 중인지 확인하지 못했어요. 그래도 지울까요?")) return;
    } else if (usage.scriptCount > 0) {
      if (!confirm(`이 카드로 만든 콘티가 ${usage.scriptCount}개 있어요. 카드를 지워도 이미 만든 콘티의 구독 장면은 그대로 남아요(사진 파일도 남겨요). 지울까요?`)) return;
    } else if (!confirm(`"${k.name}" 카드를 삭제할까요?`)) return;
    await rest(`youtube_subscribe_cards?id=eq.${k.id}`, { method: "DELETE", headers });
    cards = cards.filter((c) => c !== k);
    // 확인 실패 시엔 어떤 사진이 쓰이는지 모르니 스토리지 파일은 하나도 지우지 않는다
    if (usage) await removeUnusedFiles(k.image_paths, k.id, usage.usedPaths);
    if (String(openId) === String(id)) { openId = null; draft = null; }
    render();
    showMsg("카드를 삭제했습니다.", true);
  }

  async function saveCard(id) {
    const k = cards.find((c) => String(c.id) === String(id));
    const name = draft.name.trim();
    if (!name) { cardMsg("카드 이름을 입력하세요.", false); return; }
    const body = { name, script_text: draft.script_text, direction: draft.direction, updated_at: nowIso() };
    await patch("youtube_subscribe_cards", `id=eq.${k.id}`, body);
    Object.assign(k, body);
    draft.name = name;
    render();
    cardMsg("저장했습니다.", true);
  }

  async function saveImages(k, paths) {
    const body = { image_paths: paths, updated_at: nowIso() };
    await patch("youtube_subscribe_cards", `id=eq.${k.id}`, body);
    Object.assign(k, body);
  }

  async function uploadPhotos(fileList) {
    const k = cards.find((c) => String(c.id) === String(openId));
    const files = Array.from(fileList || []).filter((f) => !f.type || f.type.startsWith("image/"));
    if (!k || !files.length) return;
    const paths = [...k.image_paths];
    let uploaded = 0;
    cardMsg(`사진 올리는 중... (0/${files.length})`, true);
    for (const file of files) {
      const rawName = file.name || `pasted_${Date.now()}.${(file.type.split("/")[1] || "png")}`;
      const safeName = rawName.replace(/[^\w.\-]/g, "_");
      const path = `subscribe/${k.channel_slot}/${Date.now()}_${safeName}`;
      try {
        const upRes = await fetch(`${SB}/storage/v1/object/${BUCKET}/${path}`, {
          method: "POST",
          headers: { ...headers, "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!upRes.ok) throw new Error(await upRes.text());
        paths.push(path);
        uploaded++;
        cardMsg(`사진 올리는 중... (${uploaded}/${files.length})`, true);
      } catch (err) {
        cardMsg(`"${file.name}" 업로드 실패: ${err.message}`, false);
      }
    }
    if (uploaded) {
      await saveImages(k, paths);
      render();
      cardMsg(`사진 ${uploaded}장 추가했습니다.`, true);
    }
  }

  async function photoAction(act, i) {
    const k = cards.find((c) => String(c.id) === String(openId));
    const paths = [...k.image_paths];
    if (act === "ph-del") {
      const target = paths[i];
      let usage = null;
      try { usage = await findSceneUsage([target]); } catch (err) { usage = null; }
      if (!usage) {
        if (!confirm("사용 중인지 확인하지 못했어요. 그래도 지울까요?")) return;
      } else if (usage.scriptIds.size > 0) {
        if (!confirm(`이 사진을 쓰는 콘티가 ${usage.scriptIds.size}개 있어요. 지우면 이 카드에서만 빠지고, 이미 만든 콘티의 사진은 그대로 남아요. 다음에 만드는 콘티부터 이 사진이 안 쓰여요. 지울까요?`)) return;
      } else if (!confirm(`${i + 1}번 사진을 삭제할까요?`)) return;
      const [gone] = paths.splice(i, 1);
      await saveImages(k, paths);
      // 콘티가 쓰는 사진(또는 확인 실패)이면 카드 목록에서만 빼고 스토리지 파일은 남긴다(콘티 사진이 깨지지 않게)
      if (usage && !usage.usedPaths.has(gone)) await removeUnusedFiles([gone], null);
    } else {
      const j = act === "ph-left" ? i - 1 : i + 1;
      if (j < 0 || j >= paths.length) return;
      [paths[i], paths[j]] = [paths[j], paths[i]];
      await saveImages(k, paths);
    }
    render();
  }

  // ───── 이벤트 ─────
  async function guarded(fn, btn) {
    if (busy) return;
    busy = true;
    if (btn) btn.disabled = true;
    try { await fn(); } catch (err) { showMsg("실패: " + err.message, false); render(); }
    finally { busy = false; if (btn && btn.isConnected) btn.disabled = false; }
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    if (t && t.closest("#list")) {
      const act = t.dataset.act;
      if (act === "toggle") return openCard(t.dataset.card);
      if (act === "check") return checkChannel(t.dataset.slot, t);
      if (act === "new") return guarded(async () => {
        if (openId != null && isDirty() && !confirm("저장하지 않은 구독 카드 수정이 있어요. 버리고 새 카드를 만들까요?")) return;
        const row = await createCard(t.dataset.slot, null);
        openId = null; draft = null;
        openCard(row.id);
        cardMsg("새 카드를 만들었습니다. 문구와 사진을 넣고 저장하세요.", true);
      }, t);
      if (act === "dup") return guarded(async () => {
        if (isDirty() && !confirm("저장하지 않은 수정은 복제되지 않아요. 저장된 내용으로 복제할까요?")) return;
        const src = cards.find((c) => String(c.id) === String(t.dataset.card));
        const row = await createCard(src.channel_slot, src);
        openId = null; draft = null;
        openCard(row.id);
        cardMsg("복제했습니다.", true);
      }, t);
      if (act === "default") return guarded(async () => { await makeDefault(t.dataset.card); render(); cardMsg("기본 카드로 지정했습니다.", true); }, t);
      if (act === "del") return guarded(() => deleteCard(t.dataset.card), t);
      if (act === "save") return guarded(() => saveCard(t.dataset.card), t);
      if (act === "revert") {
        const k = cards.find((c) => String(c.id) === String(openId));
        draft = { name: k.name, script_text: k.script_text, direction: k.direction };
        render();
        return;
      }
      if (act === "ph-left" || act === "ph-right" || act === "ph-del") return guarded(() => photoAction(act, Number(t.dataset.i)), t);
      if (act === "pv-prev" || act === "pv-next") {
        const n = capLines(draft.script_text).length;
        if (n) pvIndex = (pvIndex + (act === "pv-next" ? 1 : n - 1)) % n;
        return updatePreview();
      }
    }
    if (e.target.closest(".pv")) {
      const n = capLines(draft && draft.script_text).length;
      if (n) { pvIndex = (pvIndex + 1) % n; updatePreview(); }
      return;
    }
    const li = e.target.closest(".pv-lines li");
    if (li) { pvIndex = Number(li.dataset.i); updatePreview(); }
  });
  document.addEventListener("keydown", (e) => {
    const bar = e.target.closest && e.target.closest(".sc-bar");
    if (bar && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openCard(bar.dataset.card); }
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches('select[data-act="source"]')) {
      const c = channels.find((x) => String(x.slot) === String(t.dataset.slot));
      return patchChannel(c.slot, { source: t.value || null }, "콘티 출처 저장됨").then((ok) => { if (!ok) t.value = c.source || ""; });
    }
    if (t.matches('input[data-act="ready"]')) {
      const on = t.checked;
      if (!on && !confirm("끄면 업로드 화면의 채널 목록에서 이 채널이 사라집니다. 끌까요?")) { t.checked = true; return; }
      return patchChannel(t.dataset.slot, { ready: on }, on ? "사용 켬 — 업로드 목록에 보입니다" : "사용 끔 — 업로드 목록에서 숨김").then((ok) => {
        if (!ok) { t.checked = !on; return; }
        const keep = openId != null && isDirty() ? null : true;   // 편집 중이면 전체를 다시 그리지 않고 글자만 바꾼다
        if (keep) render(); else t.nextElementSibling.nextElementSibling.textContent = on ? "로그인 승인됨" : "승인 전 (숨김)";
      });
    }
    if (t.matches(".ch-label")) {
      const v = t.value.trim();
      const c = channels.find((x) => String(x.slot) === String(t.dataset.slot));
      if (!v) { t.value = c.label; savedNote(c.slot, "이름은 비워 둘 수 없어요.", false); return; }
      if (v === c.label) return;
      return patchChannel(c.slot, { label: v }, "이름 저장됨").then((ok) => { if (!ok) t.value = c.label; });
    }
    if (t.matches(".f-files")) { const files = t.files; guarded(() => uploadPhotos(files)); t.value = ""; return; }
    if (t.matches(".f-dir")) { draft.direction = t.value; updatePreview(); refreshDirty(); }
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (!draft) return;
    if (t.matches(".f-name")) { draft.name = t.value; refreshDirty(); }
    else if (t.matches(".f-script")) {
      draft.script_text = t.value;
      // 커서가 있는 줄을 미리보기에 띄운다
      const before = t.value.slice(0, t.selectionStart);
      const idx = capLines(before).length - (/(\r?\n| \/ )\s*$/.test(before) || !before.trim() ? 0 : 1);
      pvIndex = Math.max(0, idx);
      updatePreview(); refreshDirty();
    }
  });
  // 이름 칸에서 Enter = 저장
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches && e.target.matches(".ch-label")) e.target.blur(); });

  window.addEventListener("beforeunload", (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });

  init();
})();
