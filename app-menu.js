(function () {
  // 허브 홈(/)과 4개 섹션 메인 화면에서 같이 쓰는 공통 스크립트
  // 1) 오른쪽 위 "⋯" 버튼 + 작은 드롭다운 메뉴 (앱 설치하기 / 앱 정보)
  // 2) 섹션 메인 화면 맨 아래 스킴밐스 로고 - 누르면 허브 홈의 로고 캐러셀로 바로 돌아감

  // 홈 화면 설치 이벤트는 페이지마다 따로 잡아둔다 (브라우저가 설치 가능하다고 판단할 때만 발생)
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });
  window.addEventListener("appinstalled", () => { deferredPrompt = null; });

  async function installApp() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
    } else if (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone) {
      showInfo("이미 앱으로 설치되어 있어요.");
    } else if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
      showInfo("아이폰: 하단 공유 버튼(□↑) → \"홈 화면에 추가\"를 눌러주세요.");
    } else {
      showInfo("이 브라우저는 자동 설치를 지원하지 않아요. 브라우저 메뉴에서 \"앱 설치\" 또는 \"홈 화면에 추가\"를 찾아주세요.");
    }
  }

  // 메뉴 항목 - 나중에 항목(예: 로그아웃)이 생기면 여기에 한 줄 추가
  const MENU_ITEMS = [
    { label: "앱 설치하기", action: installApp },
    { label: "앱 정보", action: () => showInfo("폴로스 · Cloudflare Pages + Supabase") },
  ];

  const css = `
    .app-menu-btn {
      position: fixed;
      top: 10px;
      right: 10px;
      z-index: 1000;
      width: 40px;
      height: 40px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--muted, #9a9a9a);
      font-size: 1.4rem;
      line-height: 40px;
      text-align: center;
      cursor: pointer;
      box-shadow: none;
    }
    .app-menu-btn:hover, .app-menu-btn.open { color: var(--accent, #4fc3f7); }
    .app-menu {
      position: fixed;
      top: 54px;
      right: 10px;
      z-index: 1001;
      min-width: 160px;
      max-width: calc(100vw - 20px);
      padding: 6px 0;
      background: var(--bg, #000000);
      box-shadow: inset 0 0 0 1px var(--btn-ring, #444444);
      border-radius: 6px;
      font-family: -apple-system, "Malgun Gothic", sans-serif;
    }
    .app-menu[hidden] { display: none; }
    .app-menu-item {
      display: block;
      width: 100%;
      margin: 0;
      padding: 11px 16px;
      border: none;
      border-radius: 0;
      background: transparent;
      color: var(--text, #ffffff);
      font: inherit;
      font-size: 0.92rem;
      text-align: left;
      cursor: pointer;
      box-shadow: none;
    }
    .app-menu-item:hover, .app-menu-item:active { color: var(--accent, #4fc3f7); background: transparent; }
    .app-menu-info {
      padding: 8px 16px 10px;
      font-size: 0.8rem;
      line-height: 1.5;
      color: var(--muted, #9a9a9a);
      border-top: 1px solid var(--line, #2a2a2a);
    }
    .app-menu-info[hidden] { display: none; }
    .app-home-logo {
      position: fixed;
      bottom: 14px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 20;
      display: block;
      padding: 6px;
      line-height: 0;
    }
    .app-home-logo:active { transform: translateX(-50%) scale(0.94); }
    .app-home-logo img { width: 64px; height: auto; display: block; }
    body.has-home-logo { padding-bottom: 80px; }
  `;

  let btn, menu, info;

  function showInfo(text) {
    info.textContent = text;
    info.hidden = false;
  }

  function setOpen(open) {
    menu.hidden = !open;
    btn.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", String(open));
    if (!open) info.hidden = true;
  }

  function renderMenu() {
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "app-menu-btn";
    btn.textContent = "⋯";
    btn.setAttribute("aria-label", "메뉴");
    btn.setAttribute("aria-haspopup", "true");

    menu = document.createElement("div");
    menu.className = "app-menu";
    menu.hidden = true;
    MENU_ITEMS.forEach((item) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "app-menu-item";
      el.textContent = item.label;
      el.addEventListener("click", () => item.action());
      menu.appendChild(el);
    });
    info = document.createElement("div");
    info.className = "app-menu-info";
    info.hidden = true;
    menu.appendChild(info);

    btn.addEventListener("click", () => setOpen(menu.hidden));
    // 바깥을 누르거나 Esc를 누르면 닫힘
    document.addEventListener("click", (e) => {
      if (menu.hidden || btn.contains(e.target) || menu.contains(e.target)) return;
      setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !menu.hidden) setOpen(false);
    });

    document.body.appendChild(btn);
    document.body.appendChild(menu);
  }

  // 섹션 메인 화면(/todo, /todo/, /todo/index.html 등)에서만 하단 스킴밐스 로고를 붙인다
  const MAIN_RE = /^\/(skimmmiks|todo|trading|youtube)(\/(index(\.html)?)?)?$/;
  function renderHomeLogo() {
    const m = location.pathname.match(MAIN_RE);
    if (!m) return;
    const a = document.createElement("a");
    a.className = "app-home-logo";
    a.href = "/?carousel=" + m[1]; // 허브를 문구 화면이 아니라 캐러셀(이 섹션 로고가 가운데)로 바로 연다
    a.setAttribute("aria-label", "홈으로");
    a.innerHTML = '<img src="/skimmmiks/logo.png" alt="">';
    document.body.classList.add("has-home-logo");
    document.body.appendChild(a);
  }

  function init() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    renderMenu();
    renderHomeLogo();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // 업데이트 알림(update.js)도 여기서 같이 불러온다 - 이 스크립트가 도는 모든 화면(홈 + 섹션 메인)에서 동작
  // (update.js 안에 중복 로드 가드가 있어 띠가 두 번 뜨지 않음)
  if (!window.__polosUpdateLoaded && !document.querySelector('script[src="/update.js"]')) {
    const s = document.createElement("script");
    s.src = "/update.js";
    s.defer = true;
    document.head.appendChild(s);
  }
})();
