// storyboard/16-boot.js — 파일 끌어다 놓기·붙여넣기 업로드, 시작(loadScripts→?open=, Trend에서 온 경우, 서비스 워커)
// storyboard.html에서 순서 그대로 잘라낸 파일. 일반 <script>로 차례대로 불러오므로 앞 파일의 전역(let/const/function)을 그대로 쓴다.
  // ───── PC: 사진·영상 파일을 장면 카드에 끌어다 놓기 (붙여넣기와 같은 업로드 경로, 맨 뒤에 추가) ─────
  // 파일을 끄는 경우(dataTransfer.types에 "Files")에만 반응하므로 클립 순서 바꾸기·자막 끌기 같은 포인터 조작과 겹치지 않는다.
  // 카드 밖에 떨어뜨려도 브라우저가 파일을 열어 버리지 않게 기본 동작은 늘 막는다.
  const dragHasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  const dropCardOf = (e) => (e.target && e.target.closest ? e.target.closest(".seg-item") : null);
  let fileOverCard = null;
  function setFileOverCard(el) {
    if (fileOverCard === el) return;
    if (fileOverCard) fileOverCard.classList.remove("file-over");
    fileOverCard = el;
    if (el) el.classList.add("file-over");
  }
  document.addEventListener("dragover", (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    const card = dropCardOf(e);
    e.dataTransfer.dropEffect = card ? "copy" : "none";
    setFileOverCard(card);
  });
  document.addEventListener("dragleave", (e) => {
    if (!dragHasFiles(e) || !fileOverCard) return;
    if (!e.relatedTarget || !fileOverCard.contains(e.relatedTarget)) setFileOverCard(null);   // 카드 밖(또는 창 밖)으로 나감
  });
  document.addEventListener("drop", (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    const card = dropCardOf(e);
    setFileOverCard(null);
    if (!card) return;
    const all = Array.from(e.dataTransfer.files || []);
    const ok = all.filter((f) => /^(image|video)\//.test(f.type));
    if (!ok.length) { showMsg("사진·영상 파일만 올릴 수 있어요.", false); return; }
    if (ok.length < all.length) showMsg(`사진·영상이 아닌 파일 ${all.length - ok.length}개는 빼고 올려요.`, false);
    uploadSegmentAssets(card.dataset.id, ok);
  });
  document.addEventListener("dragend", () => setFileOverCard(null));

  document.addEventListener("paste", (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const files = Array.from(items)
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter(Boolean);
    if (!files.length) return;

    const segEl = document.activeElement && document.activeElement.closest(".seg-item");
    if (!segEl) return;

    e.preventDefault();
    uploadSegmentAssets(segEl.dataset.id, files);
  });

  loadScripts().then(() => {
    // 다른 페이지(Wikipedia 등)에서 만든 콘티를 바로 열어 준다
    let id = null;
    try { id = sessionStorage.getItem("openConti"); sessionStorage.removeItem("openConti"); } catch { /* 무시 */ }
    // 알림의 "열기" 링크: ?open=<콘티 번호>
    const params = new URLSearchParams(location.search);
    if (params.get("open")) {
      id = params.get("open");
      params.delete("open");
      history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params : "") + location.hash);
      if (slideshows.some((r) => String(r.id) === String(id))) { openSlideshow(id); return; }   // 슬라이드쇼는 편집 화면이 따로다
      if (!scripts.some((r) => String(r.id) === String(id))) { showListMsg("그 콘티를 찾을 수 없어요 (삭제됐을 수 있어요).", false); id = null; }
    }
    if (id && slideshows.some((r) => String(r.id) === String(id))) { openSlideshow(id); return; }
    if (id) openConti(id);
  });
  openNewContiFromTrend();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js");
  }
