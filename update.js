(function () {
  // 앱 업데이트 알림 + 적용 (자동 새로고침 아님 - 사용자가 [업데이트]를 눌러야 덮어쓴다)
  //
  // 동작 요약
  //  1) 배포된 핵심 파일 내용을 받아 해시(지문)를 만든다. 빌드 단계/버전 번호가 없으므로 "내용이 바뀌었나"로 판단.
  //  2) 저장된 지문(localStorage)과 다르면 화면 아래에 "새 버전이 있어요" 띠를 띄운다.
  //  3) [업데이트] → 서비스워커 갱신 + Cache API 비우기 + 지문 갱신 + 새로고침.
  //     localStorage 전체는 지우지 않는다 (로그인 세션 유지). 지문 키만 갱신.
  //
  // 이 파일은 app-menu.js가 동적으로 불러온다 (홈 + 섹션 메인 화면). 중복 로드 가드 있음.
  if (window.__polosUpdateLoaded) return;
  window.__polosUpdateLoaded = true;

  // ── 설정: 감지 대상 파일 (여기만 고치면 된다) ──────────────────────────
  // 이 목록에 없는 파일만 바뀌면 새 버전을 감지하지 못한다. 새 섹션/공통 파일이 생기면 추가할 것.
  const WATCH_FILES = [
    "/",                    // 허브 홈 (index.html)
    "/style.css",
    "/app-menu.js",
    "/theme.js",
    "/update.js",
    "/manifest.json",
    "/sw.js",
    "/skimmmiks/",          // 섹션 메인 화면
    "/skimmmiks/style.css",
    "/todo/",
    "/todo/style.css",
    "/trading/",
    "/trading/style.css",
  ];
  const FP_KEY = "polos_applied_fp";        // localStorage: 지금 적용된 버전 지문
  const PENDING_KEY = "polos_pending_fp";   // localStorage: 검사에서 발견한 새 지문 (페이지 이동 후에도 띠 복원용)
  const LAST_CHECK_KEY = "polos_update_last_check"; // localStorage: 마지막 검사 시각(ms)
  const DISMISS_KEY = "polos_update_dismissed";     // sessionStorage: 이번 실행에서 [나중에] 누른 지문
  const MIN_INTERVAL_MS = 60 * 1000;        // 마지막 검사 후 1분 이내면 건너뜀
  const POLL_MS = 10 * 60 * 1000;           // 보이는 동안 10분마다 검사

  // ── 저장소 헬퍼 (막혀 있어도 조용히) ────────────────────────────────────
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

  // ── 해시 ───────────────────────────────────────────────────────────────
  async function hashText(text) {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    // SubtleCrypto가 없는 환경(비보안 컨텍스트)용 단순 해시
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return "d" + (h >>> 0).toString(16);
  }

  // 감지 대상 전체의 지문. 하나라도 못 받으면 null (오프라인/오류 → 조용히 건너뜀)
  async function computeFingerprint() {
    const parts = [];
    for (const url of WATCH_FILES) {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      parts.push(url + "=" + (await hashText(await res.text())));
    }
    return hashText(parts.join("\n"));
  }

  // ── 띠 UI ──────────────────────────────────────────────────────────────
  const css = `
    /* 색은 페이지의 테마 변수(--card, --btn 등)를 따름 — 괄호 안은 변수가 없을 때의 어두운 값 */
    .upd-bar {
      position: fixed;
      left: 50%;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 150px);
      transform: translateX(-50%);
      z-index: 2000;
      box-sizing: border-box;
      width: calc(100vw - 24px);
      max-width: 420px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: var(--card, #141414);
      color: var(--text, #ffffff);
      border: 1px solid var(--btn-ring, #444444);
      border-radius: 6px;
      font-family: -apple-system, "Malgun Gothic", sans-serif;
      font-size: 0.9rem;
      font-weight: 400;
      line-height: 1.3;
      letter-spacing: normal;
      text-transform: none;
    }
    .upd-bar[hidden] { display: none; }
    .upd-msg { flex: 1; min-width: 0; }
    /* 각 페이지의 전역 button 규칙(width:100%, 대문자 등)에 영향받지 않도록 속성을 명시 */
    .upd-bar .upd-btn {
      display: inline-block;
      flex: none;
      width: auto;
      margin: 0;
      padding: 7px 12px;
      background: var(--btn, #000000);
      color: var(--text, #ffffff);
      border: none;
      border-radius: 4px;
      box-shadow: inset 0 0 0 1px var(--btn-ring, #444444);
      font-family: inherit;
      font-size: 0.85rem;
      font-weight: 400;
      line-height: 1.3;
      letter-spacing: normal;
      text-transform: none;
      text-align: center;
      white-space: nowrap;
      cursor: pointer;
    }
    .upd-bar .upd-btn:hover, .upd-bar .upd-btn:active { background: var(--hover, #a8dcf6); color: var(--on-accent, #000000); }
    .upd-bar .upd-btn:disabled { opacity: 0.5; cursor: default; background: var(--btn, #000000); color: var(--text, #ffffff); box-shadow: inset 0 0 0 1px var(--btn-ring, #444444); }
  `;

  let bar = null, msgEl, okBtn, laterBtn, styleAdded = false;
  let currentNewFp = null;   // 지금 띠가 가리키는 새 지문
  let applying = false;

  function ensureBar() {
    if (bar) return;
    if (!styleAdded) {
      const st = document.createElement("style");
      st.textContent = css;
      document.head.appendChild(st);
      styleAdded = true;
    }
    bar = document.createElement("div");
    bar.className = "upd-bar";
    bar.setAttribute("role", "status");
    bar.hidden = true;
    msgEl = document.createElement("span");
    msgEl.className = "upd-msg";
    msgEl.textContent = "새 버전이 있어요";
    okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "upd-btn";
    okBtn.textContent = "업데이트";
    laterBtn = document.createElement("button");
    laterBtn.type = "button";
    laterBtn.className = "upd-btn";
    laterBtn.textContent = "나중에";
    okBtn.addEventListener("click", applyUpdate);
    laterBtn.addEventListener("click", () => {
      if (currentNewFp) ssSet(DISMISS_KEY, currentNewFp);
      hideBar();
    });
    bar.append(msgEl, okBtn, laterBtn);
    document.body.appendChild(bar);
  }

  function showBar(newFp) {
    if (applying) return;
    if (ssGet(DISMISS_KEY) === newFp) return; // 이번 실행에서 이미 [나중에] 누른 버전
    currentNewFp = newFp;
    ensureBar();
    bar.hidden = false;
  }

  function hideBar() {
    if (bar) bar.hidden = true;
  }

  // ── 적용(덮어쓰기) ─────────────────────────────────────────────────────
  async function applyUpdate() {
    if (applying || !currentNewFp) return;
    applying = true;
    msgEl.textContent = "업데이트 중...";
    okBtn.disabled = true;
    laterBtn.disabled = true;
    const newFp = currentNewFp;
    try {
      // ① 서비스워커 갱신 시도 + 대기 중인 워커 즉시 활성화
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          try { await reg.update(); } catch (e) {}
          if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }
      }
      // ② Cache API 전부 삭제 (localStorage/sessionStorage는 건드리지 않음)
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) {
      // 일부 단계가 실패해도 새로고침은 진행 (네트워크 우선 구조라 새로고침만으로도 대부분 갱신됨)
    }
    // ③ 새 지문 저장 (이 키만 갱신)
    lsSet(FP_KEY, newFp);
    lsDel(PENDING_KEY);
    // ④ 새로고침
    location.reload();
  }

  // ── 검사 ───────────────────────────────────────────────────────────────
  let checking = false;

  // force=true면 1분 제한 무시 (테스트/수동 호출용)
  async function check(force) {
    if (checking || applying) return;
    try {
      const applied = lsGet(FP_KEY);
      const pending = lsGet(PENDING_KEY);
      const last = parseInt(lsGet(LAST_CHECK_KEY) || "0", 10) || 0;
      if (!force && Date.now() - last < MIN_INTERVAL_MS) {
        // 너무 최근에 검사함: 요청은 건너뛰되, 직전 검사에서 발견한 새 버전이 있으면 띠는 복원
        if (applied && pending && pending !== applied) showBarSafe(pending);
        return;
      }
      checking = true;
      const fp = await computeFingerprint();
      if (!fp) return; // 오프라인/오류 → 조용히 건너뜀 (검사 시각도 기록 안 함)
      lsSet(LAST_CHECK_KEY, String(Date.now()));
      if (!applied) {
        lsSet(FP_KEY, fp); // 첫 실행: 지문만 저장, 알림 없음
        lsDel(PENDING_KEY);
        return;
      }
      if (fp === applied) {
        lsDel(PENDING_KEY);
        hideBar(); // 다른 탭에서 이미 업데이트했을 수 있음
        return;
      }
      lsSet(PENDING_KEY, fp);
      showBarSafe(fp);
    } catch (e) {
      // 네트워크 실패 등: 조용히 무시
    } finally {
      checking = false;
    }
  }

  function showBarSafe(fp) {
    if (document.body) showBar(fp);
    else document.addEventListener("DOMContentLoaded", () => showBar(fp));
  }

  // ── 시작 + 검사 시점 ───────────────────────────────────────────────────
  let timer = null;
  function startTimer() {
    if (timer) return;
    timer = setInterval(() => { if (document.visibilityState === "visible") check(false); }, POLL_MS);
  }

  function start() {
    check(false); // 앱 시작 시
    startTimer();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check(false); // 다시 보이게 될 때
    });
  }

  // 수동 호출/테스트용
  window.polosUpdate = { check: check, files: WATCH_FILES.slice() };

  start();
})();
