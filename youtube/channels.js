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
  let openId = null;       // 펼친 채널 카드 id
  let draft = null;        // 펼친 카드의 저장 전 값 { name, script_text, direction, voice }
  // 채널 카드 목소리(youtube_subscribe_cards.voice jsonb { name, voice, rate, pitch }). 칸이 아직 없으면(youtube_tables_17_card_voice.sql 실행 전) false
  let voiceColumn = null;  // null = 모름(카드가 없음), true/false
  const VOICE_SQL_HINT = "목소리 칸이 아직 없어요 — Supabase에서 youtube_tables_17_card_voice.sql을 실행하면 저장돼요.";
  // 들어보기 글: 윤동주 「별 헤는 밤」 (공유 저작물). 줄바꿈 그대로 두고, 읽을 때 연(빈 줄) 단위로 나눠 차례로 합성·재생한다
  const VOICE_SAMPLE = `계절이 지나가는 하늘에는
가을로 가득 차 있습니다.

나는 아무 걱정도 없이
가을 속의 별들을 다 헤일 듯합니다.

가슴속에 하나둘 새겨지는 별을
이제 다 못 헤는 것은
쉬이 아침이 오는 까닭이요,
내일 밤이 남은 까닭이요,
아직 나의 청춘이 다하지 않은 까닭입니다.

별 하나에 추억과
별 하나에 사랑과
별 하나에 쓸쓸함과
별 하나에 동경과
별 하나에 시와
별 하나에 어머니, 어머니,

어머님, 나는 별 하나에 아름다운 말 한마디씩 불러 봅니다. 소학교 때 책상을 같이 했던 아이들의 이름과, 패, 경, 옥, 이런 이국 소녀들의 이름과, 벌써 아기 어머니 된 계집애들의 이름과, 가난한 이웃 사람들의 이름과, 비둘기, 강아지, 토끼, 노새, 노루, ‘프랑시스 잠’, ‘라이너 마리아 릴케’ 이런 시인의 이름을 불러 봅니다.

이네들은 너무나 멀리 있습니다.
별이 아스라이 멀듯이.

어머님,
그리고 당신은 멀리 북간도에 계십니다.

나는 무엇인지 그리워
이 많은 별빛이 내린 언덕 위에
내 이름자를 써 보고
흙으로 덮어 버리었습니다.

딴은 밤을 새워 우는 벌레는
부끄러운 이름을 슬퍼하는 까닭입니다.

그러나 겨울이 지나고 나의 별에도 봄이 오면
무덤 위에 파란 잔디가 피어나듯이
내 이름자 묻힌 언덕 위에도
자랑처럼 풀이 무성할 거외다.`;
  let pvIndex = 0;         // 미리보기에서 보고 있는 자막 줄
  let pvMedia = 0;         // 미리보기에서 보고 있는 소재(사진·영상) 번호
  let busy = false;

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const publicUrl = (p) => `${SB}/storage/v1/object/public/${BUCKET}/${p}`;
  const nowIso = () => new Date().toISOString();
  // 카드 소재는 사진과 영상(mp4/mov/webm). 경로 확장자로 구분한다 (콘티 화면·파이프라인도 확장자로 판단)
  const VIDEO_EXT_RE = /\.(mp4|mov|webm|m4v)$/i;
  const isVideoPath = (p) => VIDEO_EXT_RE.test(String(p || "").split("?")[0]);
  // 파일 한 개 최대 크기: Supabase 무료 요금제의 파일 업로드 한도(50MB)에 맞춘다
  const MAX_FILE_MB = 50;
  const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
  function mediaCountText(paths) {
    const v = paths.filter(isVideoPath).length, ph = paths.length - v;
    if (!paths.length) return "소재 없음";
    return [ph ? `사진 ${ph}장` : "", v ? `영상 ${v}개` : ""].filter(Boolean).join(" · ");
  }

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
    if (cards.length) voiceColumn = cards.some((c) => Object.prototype.hasOwnProperty.call(c, "voice"));
  }
  // 목소리 값 정리: 이름이 비면 null(카드 목소리 없음). 값 모양은 콘티 video_settings와 같다(voice = Edge 목소리 id, rate %, pitch Hz 숫자)
  function normVoice(v) {
    if (!v || typeof v !== "object") return null;
    const name = String(v.name || "").trim();
    if (!name) return null;
    return { name: name.slice(0, 20), voice: String(v.voice || GEN_VOICES[0].id), rate: Number(v.rate) || 0, pitch: Number(v.pitch) || 0 };
  }
  // 편집 칸 값(이름이 비어도 성우·속도·높낮이는 들고 있는다)
  function voiceDraftOf(k) {
    const v = normVoice(k.voice);
    return v || { name: "", voice: GEN_VOICES[0].id, rate: 0, pitch: 0 };
  }
  const draftOf = (k) => ({ name: k.name, script_text: k.script_text, direction: k.direction, voice: voiceDraftOf(k) });
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
        <div class="sc-title"><span class="k">채널 카드</span>
          <button type="button" class="btn-sm" data-act="new" data-slot="${c.slot}">+ 새 카드</button></div>
        ${cardsOf(c.slot).map(cardHtml).join("") || `<div class="ch-note" style="padding:6px 0;">아직 카드가 없습니다. "+ 새 카드"로 만드세요.</div>`}
      </div>`).join("");
    if (openId != null) bindPreview();
  }

  // 카드 줄의 상태 글자: 고치는 중이면 "저장 안 됨", 접힌 카드는 소재 개수 (펼친 카드는 아래에 개수가 보이니 이름 칸을 넓게 비운다)
  function stateHtml(k, open, dirty) {
    if (dirty) return `<span class="sc-dirty sc-state">저장 안 됨</span>`;
    return `<span class="sc-meta sc-state">${open ? "" : mediaCountText(k.image_paths)}</span>`;
  }

  function cardHtml(k) {
    const open = String(k.id) === String(openId);
    const dirty = open && isDirty();
    return `<div class="sc-item${open ? " open" : ""}" data-card="${k.id}">
      <div class="sc-bar" data-act="toggle" data-card="${k.id}" role="button" tabindex="0" aria-expanded="${open}">
        <button type="button" class="sc-star${k.is_default ? " on" : ""}" data-act="star" data-card="${k.id}" title="${k.is_default ? "기본 카드" : "눌러서 기본 카드로"}" aria-label="${k.is_default ? "기본 카드" : "기본 카드로 설정"}">${k.is_default ? "★" : "☆"}</button>
        ${open
          ? `<input type="text" class="sc-name-in" maxlength="40" value="${esc(k.name)}" data-card="${k.id}" aria-label="카드 이름" title="눌러서 이름 바꾸기 (Enter로 저장)">`
          : `<span class="sc-name">${esc(k.name)}</span>`}
        ${stateHtml(k, open, dirty)}
        <span class="sc-meta">${open ? "▲" : "▼"}</span>
        <button type="button" class="sc-x" data-act="del" data-card="${k.id}" title="카드 삭제" aria-label="카드 삭제">×</button>
      </div>
      ${open ? editHtml(k) : ""}
    </div>`;
  }

  function editHtml(k) {
    const n = k.image_paths.length;
    return `<div class="sc-edit">
        <label>자막 문구</label>
        <textarea class="f-script" placeholder="내 알고리즘 밖의 이야기가 궁금하다면&#10;구독 좋아요 해주시면 **나도 좋아요**">${esc(draft.script_text)}</textarea>
        <label>사진·영상 (${n}개)</label>
        <div class="ph-grid">
          ${k.image_paths.map((p, i) => {
            const url = esc(publicUrl(p));
            const vid = isVideoPath(p);
            return `<div class="ph"${vid ? "" : ` style="background-image:url('${url}')"`}>${vid ? `<video src="${url}#t=0.1" muted playsinline preload="metadata"></video><span class="vid">영상</span>` : ""}
              <span class="no">${i + 1}</span>
              <div class="ph-tools">
                <button type="button" data-act="ph-left" data-i="${i}" aria-label="앞으로"${i === 0 ? " disabled" : ""}>◀</button>
                <button type="button" class="del" data-act="ph-del" data-i="${i}" aria-label="삭제">✕</button>
                <button type="button" data-act="ph-right" data-i="${i}" aria-label="뒤로"${i === n - 1 ? " disabled" : ""}>▶</button>
              </div></div>`;
          }).join("")}
          <label class="ph-add"><span class="plus">+</span>사진·영상 추가<span class="sub">끌어다 놓기 · Ctrl+V</span><input type="file" class="f-files" accept="image/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" multiple></label>
        </div>
        <div class="sc-hint">사진·영상은 영상마다 돌아가며 하나씩 쓰입니다. 추가·삭제·순서는 바로 저장돼요. 파일 하나는 ${MAX_FILE_MB}MB까지.</div>
        <label>카메라 연출</label>
        <select class="f-dir">${DIRECTIONS.map((d) => `<option${d === draft.direction ? " selected" : ""}>${d}</option>`).join("")}
          ${DIRECTIONS.includes(draft.direction) ? "" : `<option selected>${esc(draft.direction)}</option>`}</select>
        ${voiceHtml()}
        <button type="button" class="sc-pv-btn" data-act="pv-open">▶ 미리보기</button>
        <div class="sc-save-row">
          <button type="button" class="sc-save${isDirty() ? " dirty" : ""}" data-act="save" data-card="${k.id}" style="flex:2;">${isDirty() ? "저장" : "저장됨"}</button>
          <button type="button" data-act="revert" style="flex:1;"${isDirty() ? "" : " disabled"}>되돌리기</button>
        </div>
        <div class="sc-msg"></div>
      </div>`;
  }

  // 목소리: 이름을 쓰면 이 카드를 쓰는 콘티 전체의 성우가 이 목소리(이름으로 표시)가 된다. 이름을 비우면 카드 목소리 없음
  function voiceHtml() {
    const v = draft.voice;
    const sg = (n) => `${n > 0 ? "+" : ""}${n}`;
    const opts = (a, b, unit, cur) => { const o = []; for (let n = a; n <= b; n++) o.push(`<option value="${n}"${n === cur ? " selected" : ""}>${sg(n)}${unit}</option>`); return o.join(""); };
    const off = !v.name.trim();
    return `<label>목소리 <span style="font-weight:400;color:var(--muted);">(선택)</span></label>
        <div class="sc-voice">
          <input type="text" class="f-vname" maxlength="20" placeholder="이름 (예: Bam) — 비우면 카드 목소리 없음" value="${esc(v.name)}" aria-label="목소리 이름">
          <div class="sc-voice-row"${off ? ' style="opacity:.55;"' : ""}>
            <select class="f-vvoice" aria-label="성우">${GEN_VOICES.map((o) => `<option value="${esc(o.id)}"${o.id === v.voice ? " selected" : ""}>${esc(o.label.replace(/ — .*/, ""))}</option>`).join("")}</select>
            <select class="f-vrate" aria-label="속도">${opts(-30, 30, "%", v.rate)}</select>
            <select class="f-vpitch" aria-label="높낮이">${opts(-20, 20, "Hz", v.pitch)}</select>
            <button type="button" class="btn-sm" data-act="v-play">▶ 들어보기</button>
          </div>
        </div>
        <div class="sc-hint">${voiceColumn === false ? esc(VOICE_SQL_HINT)
          : "이름을 붙이면 이 카드로 만든 콘티 전체의 성우가 이 목소리가 돼요 (영상은 목소리 하나로 읽어요). 콘티에서 동기화를 끌 수 있어요."}</div>`;
  }
  // 들어보기: 콘티 미리보기와 같은 /api/tts (Edge TTS 실제 목소리)로 VOICE_SAMPLE을 읽는다.
  // /api/tts는 한 번에 3000바이트까지라(한글 약 1000자) 시 전체(약 3700바이트)를 연 단위 묶음으로 나눈다.
  // 첫 묶음은 첫 연 하나만이라 빨리 시작하고, 한 묶음을 재생하는 동안 다음 묶음을 미리 받는다. 같은 글·목소리는 서버 캐시에서 바로 온다.
  // 줄 끝에 문장부호가 없으면 쉼표를 붙여 줄바꿈 자리에서 살짝 쉬게 읽는다
  const VOICE_CHUNK_BYTES = 900;
  function sampleChunks() {
    const enc = new TextEncoder();
    const stanzas = VOICE_SAMPLE.split(/\n\s*\n/).map((st) => st.split("\n").map((l) => l.trim()).filter(Boolean)
      .map((l, i, a) => (i < a.length - 1 && !/[.,?!…]$/.test(l) ? l + "," : l)).join(" ")).filter(Boolean);
    const out = [];
    stanzas.forEach((st, i) => {
      const last = out[out.length - 1];
      if (i > 1 && last && enc.encode(last + " " + st).length <= VOICE_CHUNK_BYTES) out[out.length - 1] = last + " " + st;
      else out.push(st);
    });
    return out;
  }
  let vAudio = null, vGen = 0;   // vGen: 들어보기를 멈추거나 다시 시작하면 늘어나, 받는 중이던 묶음은 버린다
  function stopVoice() {
    vGen++;
    if (vAudio) { vAudio.pause(); vAudio = null; }
    const b = document.querySelector('[data-act="v-play"]');
    if (b) { b.disabled = false; b.textContent = "▶ 들어보기"; }
  }
  function ttsChunk(text, v) {
    return fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice: v.voice, rate: v.rate, pitch: v.pitch }) })
      .then(async (r) => {
        let j = null;
        try { j = await r.json(); } catch { /* 아래에서 */ }
        if (!r.ok || !j || j.error || !j.audio) throw new Error((j && j.error) || `HTTP ${r.status}`);
        return `data:audio/mpeg;base64,${j.audio}`;
      });
  }
  async function playVoice(btn) {
    if (vAudio || btn.dataset.loading) { delete btn.dataset.loading; stopVoice(); return; }   // 재생·준비 중에 다시 누르면 멈춘다
    const gen = ++vGen;
    const v = { ...draft.voice };
    const chunks = sampleChunks();
    const label = () => document.querySelector('[data-act="v-play"]');
    const set = (t) => { const b = label(); if (b) b.textContent = t; };
    btn.dataset.loading = "1";
    set("준비 중… (■ 멈춤)");
    let next = ttsChunk(chunks[0], v);
    next.catch(() => {});
    try {
      for (let i = 0; i < chunks.length; i++) {
        const src = await next;
        if (gen !== vGen) return;
        if (i + 1 < chunks.length) { next = ttsChunk(chunks[i + 1], v); next.catch(() => {}); }   // 재생하는 동안 다음 묶음
        const a = new Audio(src);
        vAudio = a;
        const b = label(); if (b) delete b.dataset.loading;
        set("■ 정지");
        await new Promise((res, rej) => {
          a.addEventListener("ended", res);
          a.addEventListener("pause", res);
          a.addEventListener("error", () => rej(new Error("소리를 재생하지 못함")));
          a.play().catch(rej);
        });
        if (gen !== vGen) return;
        vAudio = null;
        if (i + 1 < chunks.length) { const b2 = label(); if (b2) b2.dataset.loading = "1"; set("■ 정지"); }
      }
      stopVoice();
    } catch (err) {
      if (gen !== vGen) return;
      stopVoice();
      cardMsg("목소리를 들을 수 없어요: " + err.message, false);
    }
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
    const box = document.querySelector("#pvModal.open");
    if (!box || !draft) return;
    const lines = capLines(draft.script_text);
    if (pvIndex >= lines.length) pvIndex = Math.max(0, lines.length - 1);
    $(".pv-cap", box).innerHTML = lines.length ? capHtml(lines[pvIndex]) : "";
    $(".pv-count", box).textContent = lines.length ? `${pvIndex + 1}/${lines.length}` : "0/0";
    $(".pv-lines", box).innerHTML = lines.map((l, i) => `<li data-i="${i}" class="${i === pvIndex ? "on" : ""}">${i + 1}. ${lineListHtml(l)}</li>`).join("");
    const photo = $(".pv-photo", box);
    // 연출(켄번즈)은 사진에만. 영상은 파이프라인에서도 연출 없이 그대로 나온다
    if (photo && photo.tagName !== "VIDEO") photo.className = "pv-photo " + (DIR_CLASS[draft.direction] || "");
  }

  // 미리보기 팝업: 펼친 카드의 저장 전 문구·연출 + 고른 소재 하나(사진은 연출로 움직이고, 영상은 소리 없이 반복 재생)
  const openCardObj = () => cards.find((c) => String(c.id) === String(openId));
  function openPreview() {
    const k = openCardObj();
    if (!k || !draft) return;
    pvMedia = 0;
    $("#pvModalTitle").textContent = `미리보기 · ${draft.name || k.name}`;
    $("#pvModalBody").innerHTML = `<div class="pv-wrap">
        <div class="pv" title="눌러서 다음 자막 줄">
          <div class="pv-t pv-t1">제목 칸</div><div class="pv-t pv-t2">(영상 제목)</div>
          <div class="pv-media"></div>
          <div class="pv-cap"></div>
          <div class="pv-src">출처 칸</div>
        </div>
        <div class="pv-side">
          <div class="pv-media-nav"></div>
          <div class="pv-nav"><button type="button" data-act="pv-prev" aria-label="이전 줄">◀</button><span class="pv-count"></span><button type="button" data-act="pv-next" aria-label="다음 줄">▶</button></div>
          <ol class="pv-lines"></ol>
          <div class="sc-hint" style="margin:0;">화면을 누르면 다음 자막 줄. 실제 영상에선 사진·영상이 영상마다 돌아가며 하나씩 쓰이고, 영상 소재엔 연출이 붙지 않아요.</div>
        </div>
      </div>`;
    openModal("pvModal");
    renderPvMedia();
  }
  function renderPvMedia() {
    const k = openCardObj();
    const box = $("#pvModal .pv-media");
    if (!k || !box) return;
    const list = k.image_paths, n = list.length;
    if (pvMedia >= n) pvMedia = 0;
    const p = list[pvMedia];
    box.innerHTML = !n ? `<div class="pv-empty">사진·영상을 추가하면<br>여기에 보여요</div>`
      : isVideoPath(p) ? `<video class="pv-photo" src="${esc(publicUrl(p))}" autoplay muted loop playsinline preload="auto"></video>`
      : `<div class="pv-photo" style="background-image:url('${esc(publicUrl(p))}')"></div>`;
    const nav = $("#pvModal .pv-media-nav");
    nav.innerHTML = n > 1 ? `<button type="button" data-act="pv-mprev" aria-label="이전 소재">◀</button><span>${isVideoPath(p) ? "영상" : "사진"} ${pvMedia + 1}/${n}</span><button type="button" data-act="pv-mnext" aria-label="다음 소재">▶</button>` : "";
    updatePreview();
  }
  function bindPreview() { updatePreview(); }

  // ───── 팝업 · 알림 ─────
  function openModal(id) { document.getElementById(id).classList.add("open"); }
  function closeModal(id) {
    const m = document.getElementById(id);
    if (!m || !m.classList.contains("open")) return;
    m.classList.remove("open");
    if (id === "pvModal") $("#pvModalBody").innerHTML = "";   // 영상 재생을 멈춘다
  }
  function showInfo(title, text) {
    $("#infoModalTitle").textContent = title;
    $("#infoModalText").textContent = text;
    openModal("infoModal");
  }
  function toast(text) {
    const t = $("#toast");
    t.textContent = text;
    t.classList.add("on");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("on"), 2600);
  }
  // ☆를 처음 눌렀을 때만 별표 뜻을 팝업으로 알려 주고, 그 뒤로는 짧은 알림만
  let starTipShown = false;
  function starTipSeen() {
    if (starTipShown) return true;
    starTipShown = true;
    let seen = false;
    try { seen = localStorage.getItem("scStarTipSeen") === "1"; localStorage.setItem("scStarTipSeen", "1"); } catch { /* 저장 못 해도 이번엔 보여 준다 */ }
    return seen;
  }

  function isDirty() {
    const k = cards.find((c) => String(c.id) === String(openId));
    return !!(k && draft && (draft.name !== k.name || draft.script_text !== k.script_text || draft.direction !== k.direction
      || JSON.stringify(normVoice(draft.voice)) !== JSON.stringify(normVoice(k.voice))));
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
    const k = cards.find((c) => String(c.id) === String(openId));
    bar.querySelector(".sc-state").outerHTML = stateHtml(k, true, d);
  }
  function cardMsg(text, ok) {
    const m = document.querySelector(".sc-item.open .sc-msg");
    if (!m) return showMsg(text, ok);
    m.className = "sc-msg" + (ok ? "" : " err");
    m.textContent = text;
  }

  function openCard(id) {
    if (openId != null && String(openId) !== String(id) && isDirty() && !confirm("저장하지 않은 채널 카드 수정이 있어요. 버리고 다른 카드를 열까요?")) return;
    if (String(openId) === String(id)) {
      if (isDirty() && !confirm("저장하지 않은 수정이 있어요. 버리고 닫을까요?")) return;
      openId = null; draft = null;
    } else {
      const k = cards.find((c) => String(c.id) === String(id));
      openId = k.id;
      draft = draftOf(k);
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
  async function createCard(slot) {
    const mine = cardsOf(slot);
    const body = {
      channel_slot: Number(slot),
      name: "새 채널 카드",
      script_text: "",
      image_paths: [],
      direction: DIRECTIONS[0],
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

  // 예전에 복제한 카드끼리는 같은 파일을 함께 쓸 수 있으므로, 다른 카드가 안 쓰는 파일만 스토리지에서 지운다
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
    if (k.is_default) { showInfo("기본 카드는 지울 수 없어요", "다른 카드를 ★로 기본으로 정한 뒤 지우세요."); return; }
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
      if (!confirm(`이 카드로 만든 콘티가 ${usage.scriptCount}개 있어요. 카드를 지워도 이미 만든 콘티의 구독 장면은 그대로 남아요(사진·영상 파일도 남겨요). 지울까요?`)) return;
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
    const voice = normVoice(draft.voice);
    const voiceChanged = JSON.stringify(voice) !== JSON.stringify(normVoice(k.voice));
    let note = "";
    if (voiceColumn !== false) body.voice = voice;
    else if (voiceChanged) note = " " + VOICE_SQL_HINT;
    try {
      await patch("youtube_subscribe_cards", `id=eq.${k.id}`, body);
    } catch (err) {
      // 목소리 칸이 아직 없으면(SQL 실행 전) 목소리만 빼고 저장한다
      if (!("voice" in body) || !/voice/i.test(err.message) || !/column|PGRST204|schema/i.test(err.message)) throw err;
      voiceColumn = false;
      delete body.voice;
      await patch("youtube_subscribe_cards", `id=eq.${k.id}`, body);
      if (voice || voiceChanged) note = " " + VOICE_SQL_HINT;
    }
    if ("voice" in body) voiceColumn = true;
    Object.assign(k, body);
    draft.name = name;
    draft.voice = voiceDraftOf(k);   // 목소리 칸이 없으면 저장 못 한 목소리는 버린다(안내는 아래 글)
    stopVoice();
    render();
    cardMsg("저장했습니다." + note, !note);
  }

  // ───── 카드 이름: 펼친 카드의 ★ 줄에서 바로 바꾸고, Enter나 바깥을 누르면 이름만 바로 저장 (Esc는 취소) ─────
  async function saveCardName(input) {
    const k = cards.find((c) => String(c.id) === String(input.dataset.card));
    if (!k) return;
    const name = input.value.trim();
    if (!name) { input.value = k.name; showMsg("카드 이름을 입력하세요.", false); return; }
    if (name === k.name) return;
    const body = { name, updated_at: nowIso() };
    await patch("youtube_subscribe_cards", `id=eq.${k.id}`, body);
    Object.assign(k, body);
    if (draft && String(openId) === String(k.id)) draft.name = name;
    cardMsg("이름을 바꿨습니다.", true);
  }
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (!t.matches || !t.matches(".sc-name-in")) return;
    if (e.key === "Enter") { e.preventDefault(); t.blur(); }
    else if (e.key === "Escape") {
      const k = cards.find((c) => String(c.id) === String(t.dataset.card));
      if (k) t.value = k.name;
      t.dataset.cancel = "1"; t.blur();
    }
  });
  document.addEventListener("focusout", (e) => {
    const t = e.target;
    if (!t.matches || !t.matches(".sc-name-in")) return;
    if (t.dataset.cancel) { delete t.dataset.cancel; return; }
    guarded(() => saveCardName(t));
  });

  async function saveImages(k, paths) {
    const body = { image_paths: paths, updated_at: nowIso() };
    await patch("youtube_subscribe_cards", `id=eq.${k.id}`, body);
    Object.assign(k, body);
  }

  // 영상 파일 확장자: 이름에 없으면 형식으로 붙인다 (콘티·파이프라인이 확장자로 사진/영상을 가른다)
  const VIDEO_TYPE_EXT = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-m4v": "m4v" };
  async function uploadPhotos(fileList) {
    const k = cards.find((c) => String(c.id) === String(openId));
    const all = Array.from(fileList || []).filter(isMedia);
    if (!k || !all.length) return;
    const tooBig = all.filter((f) => f.size > MAX_FILE_BYTES);
    const files = all.filter((f) => f.size <= MAX_FILE_BYTES);
    const bigText = tooBig.length ? ` ${tooBig.map((f) => `"${f.name || "붙여넣은 파일"}"(${Math.round(f.size / 1048576)}MB)`).join(", ")}은(는) 한 개 ${MAX_FILE_MB}MB를 넘어서 올리지 못했어요.` : "";
    if (!files.length) { cardMsg(bigText.trim(), false); return; }
    const paths = [...k.image_paths];
    let uploaded = 0;
    cardMsg(`올리는 중... (0/${files.length})`, true);
    for (const file of files) {
      const isVid = isVideoFile(file);
      let rawName = file.name || `pasted_${Date.now()}.${isVid ? (VIDEO_TYPE_EXT[file.type] || "mp4") : (file.type.split("/")[1] || "png")}`;
      if (isVid && !VIDEO_EXT_RE.test(rawName)) rawName += "." + (VIDEO_TYPE_EXT[file.type] || "mp4");
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
        cardMsg(`올리는 중... (${uploaded}/${files.length})`, true);
      } catch (err) {
        cardMsg(`"${file.name}" 업로드 실패: ${err.message}`, false);
      }
    }
    if (uploaded) {
      await saveImages(k, paths);
      render();
      cardMsg(`${uploaded}개 추가했습니다.${bigText}`, !bigText);
    } else if (bigText) cardMsg(bigText.trim(), false);
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
        if (!confirm(`이 ${isVideoPath(target) ? "영상" : "사진"}을 쓰는 콘티가 ${usage.scriptIds.size}개 있어요. 지우면 이 카드에서만 빠지고, 이미 만든 콘티의 소재는 그대로 남아요. 다음에 만드는 콘티부터 안 쓰여요. 지울까요?`)) return;
      } else if (!confirm(`${i + 1}번 ${isVideoPath(target) ? "영상" : "사진"}을 삭제할까요?`)) return;
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
      if (act === "toggle") { if (e.target.closest(".sc-name-in")) return; return openCard(t.dataset.card); }
      if (act === "check") return checkChannel(t.dataset.slot, t);
      if (act === "new") return guarded(async () => {
        if (openId != null && isDirty() && !confirm("저장하지 않은 채널 카드 수정이 있어요. 버리고 새 카드를 만들까요?")) return;
        const row = await createCard(t.dataset.slot);
        openId = null; draft = null;
        openCard(row.id);
        cardMsg("새 카드를 만들었습니다. 문구와 사진을 넣고 저장하세요.", true);
      }, t);
      if (act === "star") return guarded(async () => {
        const k = cards.find((c) => String(c.id) === String(t.dataset.card));
        if (!k) return;
        if (k.is_default) { toast("이미 기본 카드예요. 다른 카드의 ☆를 누르면 그 카드가 기본이 돼요."); return; }
        await makeDefault(k.id);
        render();
        if (!starTipSeen()) showInfo("기본 카드로 설정했어요", "별표(☆)를 누르면 그 카드가 기본 카드로 설정됩니다. 채널마다 기본 카드는 하나이고, 새 콘티를 만들 때 기본 카드가 먼저 골라져요.");
        else toast("★ 기본 카드로 설정했어요");
      });
      if (act === "del") return guarded(() => deleteCard(t.dataset.card), t);
      if (act === "save") return guarded(() => saveCard(t.dataset.card), t);
      if (act === "revert") {
        const k = cards.find((c) => String(c.id) === String(openId));
        draft = draftOf(k);
        stopVoice();
        render();
        return;
      }
      if (act === "ph-left" || act === "ph-right" || act === "ph-del") return guarded(() => photoAction(act, Number(t.dataset.i)), t);
      if (act === "pv-open") { pvIndex = 0; return openPreview(); }
      if (act === "v-play") return playVoice(t);
    }
    if (t && t.closest("#pvModal")) {
      const act = t.dataset.act;
      if (act === "pv-prev" || act === "pv-next") {
        const n = capLines(draft && draft.script_text).length;
        if (n) pvIndex = (pvIndex + (act === "pv-next" ? 1 : n - 1)) % n;
        return updatePreview();
      }
      if (act === "pv-mprev" || act === "pv-mnext") {
        const k = openCardObj();
        const n = k ? k.image_paths.length : 0;
        if (n) pvMedia = (pvMedia + (act === "pv-mnext" ? 1 : n - 1)) % n;
        return renderPvMedia();
      }
    }
    // 팝업: ✕·확인 버튼이나 바깥(어두운 곳)을 누르면 닫는다
    const closer = e.target.closest("[data-close]");
    if (closer) return closeModal(closer.dataset.close);
    if (e.target.classList && e.target.classList.contains("ch-modal")) return closeModal(e.target.id);
    if (e.target.closest(".pv")) {
      const n = capLines(draft && draft.script_text).length;
      if (n) { pvIndex = (pvIndex + 1) % n; updatePreview(); }
      return;
    }
    const li = e.target.closest(".pv-lines li");
    if (li) { pvIndex = Number(li.dataset.i); updatePreview(); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.matches && e.target.matches(".sc-name-in")) return;   // 이름 칸에서 Enter·스페이스는 카드 접기가 아니라 입력
    if (e.key === "Escape" && document.querySelector(".ch-modal.open")) { document.querySelectorAll(".ch-modal.open").forEach((m) => closeModal(m.id)); return; }
    if (e.target.closest && e.target.closest("button")) return;   // ☆·× 버튼은 제 동작대로
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
    if (t.matches(".f-vvoice, .f-vrate, .f-vpitch") && draft) {
      if (t.matches(".f-vvoice")) draft.voice.voice = t.value;
      else if (t.matches(".f-vrate")) draft.voice.rate = Number(t.value);
      else draft.voice.pitch = Number(t.value);
      stopVoice();
      refreshDirty();
    }
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (!draft) return;
    if (t.matches(".f-name")) { draft.name = t.value; refreshDirty(); }
    else if (t.matches(".f-vname")) {
      draft.voice.name = t.value;
      const row = t.parentElement.querySelector(".sc-voice-row");
      if (row) row.style.opacity = t.value.trim() ? "" : ".55";
      refreshDirty();
    }
    else if (t.matches(".f-script")) {
      draft.script_text = t.value;
      // 커서가 있는 줄을 미리보기에 띄운다
      const before = t.value.slice(0, t.selectionStart);
      const idx = capLines(before).length - (/(\r?\n| \/ )\s*$/.test(before) || !before.trim() ? 0 : 1);
      pvIndex = Math.max(0, idx);
      updatePreview(); refreshDirty();
    }
  });
  // ───── 사진 끌어다 놓기 · 붙여넣기 ─────
  // 파일을 끌 때만(dataTransfer.types에 'Files') 반응한다. 열린 카드 안에 놓으면 "+ 사진 추가"와 같은 길로 올린다.
  const hasFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files"));
  const isImage = (f) => (f.type ? f.type.startsWith("image/") : /\.(jpe?g|png|gif|webp|avif|bmp|heic|heif)$/i.test(f.name || ""));
  // 영상: mp4·mov·webm만 (형식이 비어 있으면 이름의 확장자로)
  const isVideoFile = (f) => (f.type ? !!VIDEO_TYPE_EXT[f.type] : VIDEO_EXT_RE.test(f.name || ""));
  const isMedia = (f) => isImage(f) || isVideoFile(f);
  const dropZone = (e) => {
    const box = e.target && e.target.closest ? e.target.closest(".sc-item.open") : null;
    return box ? box.querySelector(".ph-grid") : null;
  };
  let dropTimer = null;
  // dragover는 끄는 동안 계속 오므로, 잠깐 끊기면(창 밖으로 나감 등) 표시를 지운다
  function markDrop(zone) {
    document.querySelectorAll(".ph-grid.drop-on").forEach((g) => { if (g !== zone) g.classList.remove("drop-on"); });
    clearTimeout(dropTimer);
    if (zone) { zone.classList.add("drop-on"); dropTimer = setTimeout(() => markDrop(null), 250); }
  }
  function addImageFiles(list) {
    const all = Array.from(list || []);
    const imgs = all.filter(isMedia);
    const skipped = all.length - imgs.length;
    if (!imgs.length) { if (all.length) cardMsg("사진이나 영상(mp4·mov·webm) 파일만 올릴 수 있어요.", false); return; }
    if (busy) { cardMsg("다른 작업이 끝난 뒤 다시 올려 주세요.", false); return; }
    guarded(async () => {
      await uploadPhotos(imgs);
      const m = document.querySelector(".sc-item.open .sc-msg");
      if (skipped && m) m.textContent += ` (사진·영상이 아닌 파일 ${skipped}개는 건너뜀)`;
    });
  }
  document.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();   // 브라우저가 파일을 여는 것을 막는다
    const zone = dropZone(e);
    e.dataTransfer.dropEffect = zone ? "copy" : "none";
    markDrop(zone);
  });
  document.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const zone = dropZone(e);
    markDrop(null);
    if (zone && openId != null) addImageFiles(e.dataTransfer.files);
  });
  // Ctrl+V: 카드가 열려 있고 클립보드에 사진·영상 파일이 있으면 올린다 (글자 붙여넣기는 그대로)
  document.addEventListener("paste", (e) => {
    if (openId == null || !e.clipboardData) return;
    let files = Array.from(e.clipboardData.files || []);
    if (!files.length) files = Array.from(e.clipboardData.items || []).filter((it) => it.kind === "file").map((it) => it.getAsFile()).filter(Boolean);
    const imgs = files.filter(isMedia);
    if (!imgs.length) return;
    e.preventDefault();
    addImageFiles(imgs);
  });

  // 이름 칸에서 Enter = 저장
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches && e.target.matches(".ch-label")) e.target.blur(); });

  window.addEventListener("beforeunload", (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });

  init();
})();
