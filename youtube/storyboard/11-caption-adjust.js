// storyboard/11-caption-adjust.js — 미리보기에서 자막 직접 조정(끌기=위치, 두 손가락=크기, 두 번 탭=굵기)
// storyboard.html에서 순서 그대로 잘라낸 파일. 일반 <script>로 차례대로 불러오므로 앞 파일의 전역(let/const/function)을 그대로 쓴다.
  // ───── 미리보기에서 자막 직접 조정 ─────
  // 자막을 위아래로 끌면 위치(caption_position_pct), 두 손가락 벌리기/오므리기(PC는 자막 위 마우스 휠)로 크기(caption_font_size),
  // 자막을 두 번 탭하면 굵기(caption_weight, WEIGHTS 순서로 순환). 전체 설정 값이라 모든 장면 미리보기에 같이 적용되고,
  // 조작이 멈추면 잠시 뒤 자막 키만 자동 저장(savePart("cap"))된다. 숫자는 보여주지 않는다.
  // 화면 숨은 값 칸(capSize/capWeight/capPos)에 넣고 원래 이벤트를 쏘므로 currentSettings·미리보기 갱신·저장 표시는 기존 경로 그대로다.
  // 자막 위: 한 번 탭 = (두 번 탭이 아니면) 재생/멈춤, 두 번 탭 = 굵기, 끌기 = 위치. 자막 밖 탭 = 재생/멈춤. 두 손가락 = 어디서든 크기.
  const CAP_DBL_MS = 280;
  let capFireRaf = 0, capSaveTimer = 0;
  const capFirePending = new Set();
  function capSet(id, v) {
    const ctl = $(id);
    const before = ctl.value;
    ctl.value = v;   // range 칸이 min/max/step에 맞춰 준다
    if (ctl.value === before) return;
    capFirePending.add(ctl);
    if (!capFireRaf) capFireRaf = requestAnimationFrame(() => {   // 연속 조작 중엔 한 화면에 한 번만 갱신
      capFireRaf = 0;
      const list = [...capFirePending]; capFirePending.clear();
      list.forEach(fireCtl);
    });
    capScheduleSave();
  }
  function capScheduleSave() {
    clearTimeout(capSaveTimer);
    capSaveTimer = setTimeout(() => {
      if (!$("scriptSelect").value || !dirtyParts.has("cap")) return;
      if (savingParts.has("cap")) { capScheduleSave(); return; }   // 저장 중이면 끝난 뒤 다시
      savePart("cap");   // 자막 키(caption_*)만 덮어쓴다. 카드의 아직 저장 안 한 값은 섞이지 않는다
    }, 900);
  }
  function capCycleWeight() {
    capSet("capWeight", (Number($("capWeight").value) + 1) % WEIGHTS.length);
  }
  function bindStageCapGestures(el) {
    const stage = el.querySelector(".seg-stage");
    const lines = stage.querySelector(".cap-lines");
    const pointers = new Map();
    let drag = null, pinch = null, adjTimer = 0;
    const adj = (on) => {
      clearTimeout(adjTimer);
      if (on) lines.classList.add("cap-adj");
      else adjTimer = setTimeout(() => lines.classList.remove("cap-adj"), 450);
    };
    const pinchStart = (d, touch) => { if (d > 0) { pinch = { d, size: Number($("capSize").value), touch }; drag = null; adj(true); } };
    const pinchMove = (d) => {
      if (!pinch || !(d > 0)) return;
      capSet("capSize", Math.round(pinch.size * d / pinch.d / 2) * 2);
    };
    const pinchEnd = () => { if (pinch) { pinch = null; el._capNoClick = Date.now() + 450; adj(false); } };
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    stage.addEventListener("pointerdown", (e) => {
      const onCap = !!e.target.closest(".cap-lines");
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType || "" });
      if (pointers.size >= 2) {
        drag = null;
        // 터치 두 손가락은 아래 touch 이벤트가 맡는다(자막 밖에서도 스크롤/확대보다 먼저 잡으려고). 그 밖(펜·합성 이벤트)은 여기서
        const ps = [...pointers.values()];
        if (!ps.some((q) => q.type === "touch")) pinchStart(dist(ps[0], ps[1]), false);
        return;
      }
      if (!onCap || e.button > 0) return;
      e.preventDefault();   // 글자 선택 막기
      try { lines.setPointerCapture(e.pointerId); } catch {}
      drag = { id: e.pointerId, y: e.clientY, pos: Number($("capPos").value), moved: false, t: Date.now(),
        h: stage.getBoundingClientRect().height || 250 };
      adj(true);
    });
    stage.addEventListener("pointermove", (e) => {
      const q = pointers.get(e.pointerId);
      if (!q) return;
      q.x = e.clientX; q.y = e.clientY;
      if (pinch && !pinch.touch && pointers.size >= 2) {
        const ps = [...pointers.values()];
        pinchMove(dist(ps[0], ps[1]));
      } else if (drag && drag.id === e.pointerId) {
        const dy = e.clientY - drag.y;
        if (!drag.moved && Math.abs(dy) > 4) drag.moved = true;
        // 화면 높이 기준, 자막 위치는 화면 아래에서 띄운 비율 (예전 자막 팝업과 같은 계산·범위 3~85)
        if (drag.moved) capSet("capPos", Math.round(drag.pos - dy / drag.h * 100));
      }
    });
    const end = (e) => {
      if (!pointers.has(e.pointerId)) return;
      const d = drag;
      pointers.delete(e.pointerId);
      if (pointers.size < 2 && pinch && !pinch.touch) pinchEnd();
      if (d && d.id === e.pointerId) {
        drag = null;
        adj(false);
        if (e.type === "pointerup" && !d.moved && Date.now() - d.t < 400) {
          // 자막 위 탭: 두 번째 탭이면 굵기, 아니면 잠깐 기다렸다가 재생/멈춤
          if (el._capTapTimer) { clearTimeout(el._capTapTimer); el._capTapTimer = 0; capCycleWeight(); adj(true); adj(false); }
          else el._capTapTimer = setTimeout(() => { el._capTapTimer = 0; pvToggle(el); }, CAP_DBL_MS);
        }
      }
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    // 실제 손가락 두 개: 미리보기 어디서든 크기. 두 손가락일 때만 브라우저 스크롤/확대를 막는다 (한 손가락 스크롤은 그대로)
    const tdist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    stage.addEventListener("touchstart", (e) => {
      if (e.targetTouches.length === 2) pinchStart(tdist(e.targetTouches), true);
    }, { passive: true });
    stage.addEventListener("touchmove", (e) => {
      if (!pinch || !pinch.touch || e.targetTouches.length < 2) return;
      if (e.cancelable) e.preventDefault();
      pinchMove(tdist(e.targetTouches));
    }, { passive: false });
    const tend = (e) => { if (pinch && pinch.touch && e.targetTouches.length < 2) pinchEnd(); };
    stage.addEventListener("touchend", tend);
    stage.addEventListener("touchcancel", tend);
    // PC: 자막 위 마우스 휠로 크기
    lines.addEventListener("wheel", (e) => {
      e.preventDefault();
      capSet("capSize", Number($("capSize").value) + (e.deltaY < 0 ? 2 : -2));
      adj(true); adj(false);
    }, { passive: false });
  }

