// 콘티 자동 생성 — 브라우저 쪽 도구 (Scenes·Wikipedia 화면이 같이 쓴다). /config.js, generate.js, conti-core.js 다음에 불러온다.
//  1) 빈 콘티 행(create_status='queued')을 만들고  2) Supabase Edge Function create-conti를 부른다 (사용자가 화면을 나가도 서버가 계속)
//  3) 함수를 못 부르면(아직 배포 안 함·네트워크) 같은 행을 이 브라우저에서 만든다 (ContiCore.runAll — 화면을 나가면 멈춤)
//  4) 서버에서 만들면 알림창만 띄우고(다 되면 알림), 브라우저에서 만들 때만 "생성 중" 화면(나가지 말라는 안내, 광고 자리 #contiAdSlot)
// 끝났는지 확인·알림은 generate.js의 contiJobWatch가 한다 (window "contijob" 이벤트)
const ContiJob = (() => {
  const SB = POLOS_CONFIG.SUPABASE_URL, KEY = POLOS_CONFIG.SUPABASE_ANON_KEY;
  const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const FN_URL = `${SB}/functions/v1/create-conti`;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const BROWSER_MSG = "서버 생성을 못 써서 브라우저에서 만들어요 — 화면을 나가지 마세요";
  const BROWSER_CHOSEN_MSG = "브라우저에서 만들고 있어요 — 다 될 때까지 화면을 나가지 마세요";

  function rest(path, init) {
    init = init || {};
    return fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, "Content-Type": "application/json", ...(init.headers || {}) } });
  }

  // 빈 콘티 행: 목록에 "대기 중"으로 바로 보인다. request = 서버/브라우저가 대본을 만들 때 쓸 입력값 전부
  async function createPlaceholder({ category, name, slug, video_settings, request }) {
    const r = await rest("youtube_scripts", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        category, hook: name, story: "", closing: "", fact_sources: "", status: "approved", slug,
        video_settings: { ...(video_settings || {}), name: String(name || "").slice(0, 40) },
        create_status: "queued", create_request: request,
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      if (/create_status|create_request|create_error|create_started_at/.test(t)) throw new Error("콘티 생성 상태 칸이 아직 없어요 — Supabase SQL Editor에서 youtube_tables_16_create_status.sql을 먼저 실행하세요");
      throw new Error("콘티 행을 만들지 못했어요: " + t.slice(0, 200));
    }
    return (await r.json())[0];
  }

  // 서버에 맡긴다. { state: "started" | "busy" | "unavailable" | "refused", error }
  async function startServer(id) {
    if (window.__contiForceBrowser) return { state: "unavailable" };
    let res, data = null;
    try {
      res = await fetch(FN_URL, {
        method: "POST", headers: { ...H, "Content-Type": "application/json" },
        body: JSON.stringify({ script_id: Number(id) }), signal: AbortSignal.timeout(20000),
      });
      try { data = await res.json(); } catch { /* 함수가 아닌 곳의 답 */ }
    } catch (e) {
      return { state: "unavailable", error: e.message };
    }
    if (res.status === 202) return { state: "started" };
    const ours = data && data.from === "create-conti";
    if (!ours || res.status >= 500) return { state: "unavailable", error: (data && (data.error || data.message)) || `HTTP ${res.status}` };   // 배포 전(404)·JWT 검사(401) 등
    if (res.status === 409) return { state: "busy", error: data.error };
    return { state: "refused", error: data.error || `HTTP ${res.status}` };
  }

  // 브라우저에서 만들기 (같은 행을 채운다)
  async function runInBrowser(id, onProgress) {
    const r = await rest(`youtube_scripts?select=*&id=eq.${Number(id)}`);
    if (!r.ok) throw new Error("콘티를 읽지 못했어요: " + (await r.text()).slice(0, 200));
    const row = (await r.json())[0];
    if (!row) throw new Error("콘티를 찾을 수 없어요 (지워졌을 수 있어요)");
    const deps = {
      rest: (path, init) => rest(path, init),
      api: async (name, body) => {
        const res = await fetch(`/api/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        let data = null;
        try { data = await res.json(); } catch { /* JSON 아님 */ }
        return { ok: res.ok, status: res.status, data };
      },
      timeLeft: () => Infinity,
      progress: onProgress,
    };
    const leave = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", leave);
    try { await ContiCore.runAll(deps, row); }
    finally { window.removeEventListener("beforeunload", leave); }
  }

  // jobs = [{ id, name }]. 서버에 차례로 맡기고(제미나이 분당 한도 때문에 2초 간격), 못 맡기면 브라우저에서 하나씩.
  // opts: { browser: true면 처음부터 브라우저에서, onOpen(id): 완료 화면의 "열기" }
  async function launch(jobs, opts) {
    opts = opts || {};
    try { genRequestPermission(); } catch { /* 무시 */ }
    jobs.forEach((j) => contiJobsAdd(j.id, j.name));
    // 서버에서 만들면 영상 생성처럼 알림창만 띄우고 끝(다 되면 contiJobWatch가 알림). "생성 중" 화면은 브라우저에서 만들 때만
    let ov = null;
    const getOv = () => ov || (ov = overlay(jobs, opts));
    const local = [], started = [], refused = [];
    let serverOk = !opts.browser;
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i];
      if (!serverOk) { local.push(j); continue; }
      if (i) await sleep(window.__contiSpacingMs != null ? window.__contiSpacingMs : 2000);
      const s = await startServer(j.id);
      if (s.state === "unavailable") { serverOk = false; local.push(j); console.warn("create-conti 함수를 못 써서 브라우저에서 만듭니다:", s.error); }
      else if (s.state === "refused") refused.push(`${j.name || "콘티"}: ${s.error || "실패"}`);
      else started.push(j);
    }
    if (refused.length) genToast(`콘티 생성을 시작하지 못했어요 — ${refused.join(" / ")}`, false, null);
    else if (started.length) genToast(`콘티 생성을 시작했어요${started.length > 1 ? ` (${started.length}개)` : ""}. 다른 화면으로 가도 되고, 다 만들어지면 알려 드릴게요.`, true, null);
    if (local.length) {
      getOv().browserMode(opts.browser ? BROWSER_CHOSEN_MSG : BROWSER_MSG);
      for (const j of local) {
        try { await runInBrowser(j.id, (t) => getOv().progress(j.id, t)); }
        catch (e) { getOv().fail(j.id, e.message); }
        await contiJobCheckNow();
      }
    }
    contiJobCheckNow();
    return ov;
  }

  // ───── "생성 중" 화면 ─────
  let styleDone = false;
  function addStyle() {
    if (styleDone) return;
    styleDone = true;
    const st = document.createElement("style");
    st.textContent = `
      .cj-ov { position:fixed; inset:0; z-index:70; background:rgba(0,0,0,0.88); display:flex; align-items:center; justify-content:center; padding:16px; }
      .cj-box { width:100%; max-width:440px; max-height:100%; overflow:auto; background:var(--card,#141414); color:var(--text,#fff); border:1px solid var(--line-strong,#333); border-radius:6px; padding:20px 18px; text-align:center; }
      .cj-spin { width:34px; height:34px; margin:4px auto 12px; border:3px solid var(--line-strong,#333); border-top-color:var(--accent,#4fc3f7); border-radius:50%; animation:cjspin 0.9s linear infinite; }
      .cj-box.fin .cj-spin { display:none; }
      @keyframes cjspin { to { transform:rotate(360deg); } }
      .cj-title { font-weight:800; font-size:1.1rem; margin-bottom:6px; }
      .cj-msg { color:var(--text-2,#d0d0d0); font-size:0.88rem; line-height:1.5; margin:8px 0; }
      .cj-msg.warn { color:var(--point,#ff7a1a); font-weight:700; }
      .cj-jobs { text-align:left; margin:12px 0; font-size:0.85rem; }
      .cj-job { padding:6px 0; border-top:1px solid var(--line,#2a2a2a); }
      .cj-job .s { color:var(--muted,#9a9a9a); font-size:0.78rem; margin-top:2px; }
      .cj-job.done .s { color:var(--accent,#4fc3f7); }
      .cj-job.err .s { color:var(--danger,#ff6b6b); }
      .cj-job a { color:var(--accent,#4fc3f7); }
      #contiAdSlot { margin:12px 0; }
      #contiAdSlot:empty { display:none; }
      .cj-btns { display:flex; gap:8px; margin-top:12px; }
      .cj-btns button { flex:1; margin:0; }
    `;
    document.head.appendChild(st);
  }

  function overlay(jobs, opts) {
    addStyle();
    const old = document.getElementById("contiOverlay");
    if (old) old.remove();
    const el = document.createElement("div");
    el.className = "cj-ov";
    el.id = "contiOverlay";
    el.innerHTML = `<div class="cj-box" role="dialog" aria-modal="true" aria-labelledby="cjTitle">
      <div class="cj-spin"></div>
      <div class="cj-title" id="cjTitle">콘티를 만들고 있어요</div>
      <div class="cj-msg" id="cjStay"></div>
      <!-- 광고 자리: 나중에 광고 코드를 이 칸 안에 넣는다 (비어 있으면 안 보임) -->
      <div id="contiAdSlot"></div>
      <div class="cj-jobs">${jobs.map((j) => `<div class="cj-job" data-id="${j.id}"><div>${esc(j.name || "(이름 없음)")}</div><div class="s">대기 중…</div></div>`).join("")}</div>
      <div class="cj-btns"><button type="button" id="cjClose" disabled>닫기</button></div>
    </div>`;
    document.body.appendChild(el);
    const $ = (s) => el.querySelector(s);
    const state = new Map(jobs.map((j) => [String(j.id), "wait"]));
    let browser = "", closed = false;

    function allFinished() { return [...state.values()].every((v) => v === "done" || v === "err"); }
    function render() {
      const fin = allFinished();
      el.querySelector(".cj-box").classList.toggle("fin", fin);
      const stay = $("#cjStay");
      if (fin) {
        const ok = [...state.values()].filter((v) => v === "done").length;
        $("#cjTitle").textContent = ok === state.size ? "콘티가 만들어졌어요" : ok ? `콘티 ${ok}/${state.size}개가 만들어졌어요` : "콘티를 만들지 못했어요";
        stay.className = "cj-msg"; stay.textContent = ok ? "Scenes에서 열어 확인하세요." : "Scenes 목록에서 다시 만들기를 눌러 주세요.";
      } else if (browser) {
        stay.className = "cj-msg warn"; stay.textContent = browser;
      } else {
        stay.className = "cj-msg"; stay.textContent = "이제 다른 화면으로 가도 괜찮아요. 다 만들어지면 알림으로 알려 드릴게요.";
      }
      const btn = $("#cjClose");
      btn.disabled = !fin && !!browser;
      btn.textContent = fin ? "닫기" : browser ? "만드는 중…" : "닫고 계속 둘러보기";
    }
    function setJob(id, cls, html) {
      const row = el.querySelector(`.cj-job[data-id="${Number(id)}"]`);
      if (!row) return;
      row.classList.remove("done", "err");
      if (cls) row.classList.add(cls);
      row.querySelector(".s").innerHTML = html;
    }
    const poll = setInterval(() => { if (!document.hidden) contiJobCheckNow(); }, 4000);   // 열려 있는 동안은 더 자주 확인
    function onEvent(e) {
      const { id, status, row } = e.detail || {};
      if (!state.has(String(id))) return;
      const nm = row && row.video_settings && row.video_settings.name;
      if (nm && (status === "done" || status === "running")) { const t = el.querySelector(`.cj-job[data-id="${Number(id)}"] > div:first-child`); if (t) t.textContent = nm; }
      if (status === "done") {
        state.set(String(id), "done");
        setJob(id, "done", `다 만들었어요 · <a href="${contiJobUrl(id)}" class="cj-open" data-id="${Number(id)}">열기 →</a>`);
      } else if (status === "error" || status === "timeout") {
        state.set(String(id), "err");
        setJob(id, "err", esc(status === "timeout" ? "시간이 너무 오래 걸려 멈췄어요" : (row && row.create_error) || "실패"));
      } else if (status === "running" && state.get(String(id)) === "wait" && /대기 중/.test((el.querySelector(`.cj-job[data-id="${Number(id)}"] .s`) || {}).textContent || "")) {
        setJob(id, "", "만드는 중…");   // 브라우저에서 만들 땐 진행 글(대본 쓰는 중…)을 그대로 둔다
      }
      render();
    }
    window.addEventListener("contijob", onEvent);
    el.addEventListener("click", (e) => {
      const a = e.target.closest(".cj-open");
      if (a && opts.onOpen) { e.preventDefault(); close(); opts.onOpen(a.dataset.id); }
    });
    $("#cjClose").addEventListener("click", () => close());
    function close() {
      if (closed) return;
      closed = true;
      clearInterval(poll);
      window.removeEventListener("contijob", onEvent);
      el.remove();
      if (opts.onClose) opts.onClose();
    }
    render();
    return {
      el, close,
      browserMode(text) { browser = text || BROWSER_MSG; render(); },
      progress(id, text) { if (state.get(String(id)) === "wait") setJob(id, "", esc(text)); },
      fail(id, msg) { state.set(String(id), "err"); setJob(id, "err", esc(msg || "실패")); render(); },
    };
  }

  return { FN_URL, BROWSER_MSG, createPlaceholder, startServer, runInBrowser, launch, overlay };
})();
