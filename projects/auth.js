// 프로젝트 페이지 전용 로그인 게이트 - 매직링크(이메일 링크) 로그인
// 로그인한 사용자의 access_token을 페이지의 headers.Authorization에 넣어야
// Supabase RLS(project_collaborators 기반)가 "이 사람이 이 프로젝트 멤버인지"를 판단할 수 있다.
(function () {
  const SUPABASE_URL = "https://oenqrlgmnkpzxsavnfyo.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_sZ4wQgaC5f-i40pVzf0vIA_R7iJWDf5";
  const SESSION_KEY = "polos_projects_session";

  function saveSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
  }
  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function parseHashTokens() {
    if (!location.hash || location.hash.length < 2) return null;
    const params = new URLSearchParams(location.hash.slice(1));
    const access_token = params.get("access_token");
    if (!access_token) return null;
    const refresh_token = params.get("refresh_token");
    const expires_in = parseInt(params.get("expires_in") || "3600", 10);
    history.replaceState(null, "", location.pathname + location.search);
    return { access_token, refresh_token, expires_in };
  }

  async function fetchUserEmail(access_token) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${access_token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.email || null;
  }

  async function refreshSession(refresh_token) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.access_token) return null;
    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refresh_token,
      email: data.user?.email || null,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    };
    saveSession(session);
    return session;
  }

  function showLogoutBar(email) {
    if (document.getElementById("authBar")) return;
    const bar = document.createElement("div");
    bar.id = "authBar";
    bar.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:9998;display:flex;justify-content:flex-end;" +
      "gap:8px;align-items:center;padding:6px 12px;font-size:0.7rem;color:#8fa3b8;" +
      "background:rgba(13,27,42,0.9);backdrop-filter:blur(4px);";
    bar.innerHTML = `<span>${email || ""}</span><a href="#" id="authLogoutLink" style="color:#8fa3b8;text-decoration:underline;">로그아웃</a>`;
    document.body.appendChild(bar);
    document.body.style.paddingTop = "34px";
    bar.querySelector("#authLogoutLink").addEventListener("click", (e) => {
      e.preventDefault();
      clearSession();
      location.reload();
    });
  }

  // 로그인 링크는 이메일 클릭 시 이 페이지로 되돌아오면서 #access_token=... 을 달고 오고,
  // 그 시점에 requireProjectAuth()가 처음부터 다시 실행되며 parseHashTokens()가 바로 잡아낸다.
  // 즉 이 화면 자체는 로그인을 기다리는 동안 계속 떠 있기만 하면 되고, 별도로 resolve할 필요가 없다.
  function showLoginGate() {
    return new Promise(() => {
      const overlay = document.createElement("div");
      overlay.id = "authGateOverlay";
      overlay.style.cssText =
        "position:fixed;inset:0;background:#0d1b2a;z-index:9999;display:flex;" +
        "align-items:center;justify-content:center;padding:20px;";
      overlay.innerHTML = `
        <div class="card" style="width:100%;">
          <h1 style="font-size:1.5rem;">프로젝트</h1>
          <p class="role">로그인한 이메일로 초대된 프로젝트만 볼 수 있어요.</p>
          <input id="authEmailInput" type="email" placeholder="이메일" autocomplete="email"
            style="width:100%;padding:12px;margin-bottom:10px;border-radius:8px;border:none;font-size:1rem;">
          <button id="authSendBtn" type="button" style="width:100%;">로그인 링크 받기</button>
          <div id="authMsg" class="msg"></div>
        </div>`;
      document.body.appendChild(overlay);

      const emailInput = overlay.querySelector("#authEmailInput");
      const sendBtn = overlay.querySelector("#authSendBtn");
      const msg = overlay.querySelector("#authMsg");

      async function send() {
        const email = emailInput.value.trim();
        if (!email) return;
        sendBtn.disabled = true;
        sendBtn.textContent = "보내는 중...";
        try {
          // redirect_to는 JSON 바디가 아니라 쿼리 파라미터로 받아야 GoTrue가 인식함(바디는 form 파싱 대상이 아님)
          const redirectTo = encodeURIComponent(location.href.split("#")[0]);
          const res = await fetch(`${SUPABASE_URL}/auth/v1/otp?redirect_to=${redirectTo}`, {
            method: "POST",
            headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ email, create_user: true }),
          });
          if (!res.ok) throw new Error(await res.text());
          msg.className = "msg ok";
          msg.textContent = "이메일을 확인하세요 - 로그인 링크를 보냈어요.";
        } catch (err) {
          msg.className = "msg err";
          msg.textContent = "실패: " + err.message;
        } finally {
          sendBtn.disabled = false;
          sendBtn.textContent = "로그인 링크 받기";
        }
      }
      sendBtn.addEventListener("click", send);
      emailInput.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
    });
  }

  // 페이지 스크립트에서 await requireProjectAuth() 로 호출.
  // 로그인 세션이 있으면 즉시 반환, 없으면 로그인 화면을 띄우고 로그인될 때까지 대기.
  window.requireProjectAuth = async function () {
    const tokens = parseHashTokens();
    if (tokens) {
      const email = await fetchUserEmail(tokens.access_token);
      const session = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        email,
        expires_at: Date.now() + tokens.expires_in * 1000,
      };
      saveSession(session);
      showLogoutBar(session.email);
      return session;
    }

    let session = loadSession();
    if (session && session.expires_at > Date.now() + 30000) {
      showLogoutBar(session.email);
      return session;
    }
    if (session && session.refresh_token) {
      const refreshed = await refreshSession(session.refresh_token);
      if (refreshed) {
        showLogoutBar(refreshed.email);
        return refreshed;
      }
    }
    clearSession();
    await showLoginGate(); // 이메일 링크를 눌러 페이지가 새로 로드될 때까지 여기서 계속 대기
  };
})();
