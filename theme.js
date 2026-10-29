(function () {
  // 테마(어둡게/밝게) 적용 — 모든 페이지 <head>에서 동기로 불러와 화면이 그려지기 전에 <html data-theme>을 붙인다(깜빡임 방지).
  // 고른 값은 기기마다 localStorage에 저장: "auto"(기기 설정 따라감, 기본) / "dark" / "light".
  // 색 값 자체는 각 style.css의 :root(어두움)와 :root[data-theme="light"](밝음) 변수에 있다.
  var KEY = "polos_theme";
  var META_COLOR = { dark: "#000000", light: "#ffffff" }; // 주소창·상태바 색(meta theme-color) — --bg와 같게
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

  function getChoice() {
    try {
      var v = localStorage.getItem(KEY);
      return v === "dark" || v === "light" ? v : "auto";
    } catch (e) {
      return "auto";
    }
  }

  function resolve(choice) {
    if (choice === "dark" || choice === "light") return choice;
    return mq && mq.matches ? "light" : "dark";
  }

  function apply() {
    var theme = resolve(getChoice());
    var root = document.documentElement;
    var changed = root.getAttribute("data-theme") !== theme;
    root.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", META_COLOR[theme]);
    if (changed) {
      try { window.dispatchEvent(new CustomEvent("polos-theme", { detail: { theme: theme } })); } catch (e) {}
    }
    return theme;
  }

  function setChoice(choice) {
    try {
      if (choice === "dark" || choice === "light") localStorage.setItem(KEY, choice);
      else localStorage.removeItem(KEY);
    } catch (e) {}
    return apply();
  }

  // 자동일 때 기기 설정이 바뀌면 따라감
  if (mq) {
    var onChange = function () { if (getChoice() === "auto") apply(); };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
  // 다른 탭에서 바꾸면 이 탭도 따라감
  window.addEventListener("storage", function (e) { if (e.key === KEY) apply(); });
  // meta theme-color가 이 스크립트보다 뒤에 있는 페이지 대비 — 문서를 다 읽은 뒤 한 번 더 맞춤
  document.addEventListener("DOMContentLoaded", apply);

  window.polosTheme = { get: getChoice, set: setChoice, current: function () { return resolve(getChoice()); } };
  apply();
})();
