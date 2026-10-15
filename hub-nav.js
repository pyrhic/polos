(function () {
  // 순서: 스킴밐스 - 투두 - 트레이딩 - 유튜브 (전부 같은 도메인 아래 경로)
  // 프로젝트 관리(polos-projects.pages.dev), 글쓰기(polos-writing.pages.dev)는
  // 별도 앱으로 분리되어 이 스와이프 허브에서 빠짐
  // 모든 페이지 배경이 검정(#000000)으로 통일되어 점 색깔도 하나로 맞춤
  // 스와이프 이동과 하단 점은 각 섹션의 "메인 화면"(/todo, /todo/, /todo/index.html 등)에서만 켠다.
  // 서브 페이지(투두 목록, 콘티 편집 등)에서 작업하다가 실수로 다른 섹션으로 넘어가지 않도록 아무것도 붙이지 않는다.
  const PAGES = [
    { url: "/skimmmiks/index.html", color: "#ffffff" },
    { url: "/todo/index.html", color: "#ffffff" },
    { url: "/trading/index.html", color: "#ffffff" },
    { url: "/youtube/index.html", color: "#ffffff" },
  ];

  // 메인 화면: 섹션 폴더 자체이거나 그 안의 index (확장자 유무 모두)
  const MAIN_RE = /^\/(skimmmiks|todo|trading|youtube)(\/(index(\.html)?)?)?$/;
  if (!MAIN_RE.test(location.pathname)) return;

  function getSection() {
    if (location.pathname.startsWith("/skimmmiks")) return 0;
    if (location.pathname.startsWith("/todo")) return 1;
    if (location.pathname.startsWith("/trading")) return 2;
    if (location.pathname.startsWith("/youtube")) return 3;
    return -1;
  }

  const section = getSection();
  if (section === -1) return;
  const color = PAGES[section].color;

  // 스와이프로 인정하는 기준: 가로로 충분히 멀리(100px 이상), 세로보다 확실히 가로(2배 넘게)
  const MIN_DX = 100;
  const H_RATIO = 2;

  function goTo(idx) {
    location.href = PAGES[idx].url;
  }

  // 인스타그램 사진 넘기기처럼, 지금 몇 번째 화면인지만 보여주는 점 - 누르면 그 페이지로 이동
  function renderDots() {
    const wrap = document.createElement("div");
    wrap.style.cssText = `
      position: fixed;
      bottom: 14px;
      left: 0;
      right: 0;
      display: flex;
      justify-content: center;
      gap: 10px;
      z-index: 10;
    `;
    PAGES.forEach((_, i) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.style.cssText = `
        width: 7px;
        height: 7px;
        padding: 0;
        border: none;
        border-radius: 50%;
        box-shadow: none;
        background: ${color};
        opacity: ${i === section ? 0.9 : 0.25};
        cursor: pointer;
      `;
      if (i !== section) dot.addEventListener("click", () => goTo(i));
      wrap.appendChild(dot);
    });
    document.body.appendChild(wrap);
  }

  // 입력칸 안이나 가로로 스크롤되는 영역 안에서 시작한 터치는 화면 전환으로 보지 않는다
  function shouldIgnore(target) {
    for (let el = target; el && el.nodeType === 1; el = el.parentElement) {
      if (el.matches("input, textarea, select, [contenteditable]")) return true;
      if (el.scrollWidth > el.clientWidth + 1) {
        const ox = getComputedStyle(el).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
      }
    }
    return false;
  }

  function setupSwipe() {
    let startX = null;
    let startY = null;
    document.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1 || shouldIgnore(e.target)) { startX = startY = null; return; }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener("touchend", (e) => {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      startX = startY = null;
      if (Math.abs(dx) < MIN_DX || Math.abs(dx) <= H_RATIO * Math.abs(dy)) return;
      if (dx < 0 && section < PAGES.length - 1) goTo(section + 1);
      else if (dx > 0 && section > 0) goTo(section - 1);
    }, { passive: true });
    document.addEventListener("touchcancel", () => { startX = startY = null; }, { passive: true });
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderDots();
    setupSwipe();
  });
})();
