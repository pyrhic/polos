// storyboard/13-autofill.js — Pexels 자동 배치(빈/모자란 장면을 키워드로 채움, asset_trims.__autofill 기록)
// storyboard.html에서 순서 그대로 잘라낸 파일. 일반 <script>로 차례대로 불러오므로 앞 파일의 전역(let/const/function)을 그대로 쓴다.
  // ───── 자동 배치: 비었거나 모자란 장면을 키워드로 Pexels 영상으로 채운다 (콘티를 열 때, 한 장면씩 순서대로) ─────
  // 결과는 asset_trims.__autofill = {status: ok|quota|no_results|error, at, query} 로 남긴다 (생성 전 검사가 이 값을 읽는다)
  let autofillQueue = [];
  let autofillScript = null;
  let autofillWorking = false;
  function autofillWanted(seg) {
    if (!seg || isSubscribeSeg(seg)) return false;   // 구독/좋아요 장면은 파이프라인이 사진을 고른다
    const trims = seg.asset_trims || {};
    if (trims.__cleared) return false;
    const q = (seg.keyword || "").trim();
    if (!q) return false;
    if ((seg.asset_paths || []).length >= needClips(segSecondsOf(seg))) return false;
    // 같은 검색어로 이미 찾아봤는데 결과가 없었거나 더 넣을 게 없었으면 다시 부르지 않는다 (무료 API 한도 보호)
    const af = trims.__autofill;
    if (af && af.query === q && (af.status === "ok" || af.status === "no_results")) return false;
    return true;
  }
  function startAutofill(scriptId) {
    autofillScript = String(scriptId);
    autofillQueue = [...segments].sort((a, b) => a.order_no - b.order_no).filter(autofillWanted).map((s) => String(s.id));
    runAutofillQueue();
  }
  function enqueueAutofill(id) {
    if (autofillScript !== String($("scriptSelect").value)) return;
    if (!autofillQueue.includes(String(id))) autofillQueue.push(String(id));
    runAutofillQueue();
  }
  function autofillPending() {
    return autofillWorking || autofillQueue.length > 0;
  }
  async function runAutofillQueue() {
    if (autofillWorking) return;
    autofillWorking = true;
    try {
      while (autofillQueue.length) {
        if (autofillScript !== String($("scriptSelect").value)) { autofillQueue = []; break; }
        const seg = segments.find((s) => String(s.id) === autofillQueue[0]);
        autofillQueue.shift();
        if (!autofillWanted(seg)) continue;
        const status = await autofillSegment(seg);
        if (status === "quota") {
          // 한도가 찼으면 남은 장면은 부르지 않고 "한도 초과"로만 기록한다
          const rest = autofillQueue.splice(0).map((id) => segments.find((s) => String(s.id) === id)).filter(autofillWanted);
          for (const s of rest) await recordAutofill(s, "quota");
          break;
        }
        await new Promise((r) => setTimeout(r, 400));   // 장면 사이에 잠깐 쉰다
      }
    } finally {
      autofillWorking = false;
    }
  }
  async function recordAutofill(seg, status) {
    const trims = { ...(seg.asset_trims || {}) };
    trims.__autofill = { status, at: new Date().toISOString(), query: (seg.keyword || "").trim() };
    try { await saveField(String(seg.id), "asset_trims", trims); } catch { /* 기록 실패는 생성 전 검사에서 "콘티를 확인해주세요"로 잡힌다 */ }
    refreshThumbs(String(seg.id));
  }
  async function autofillSegment(seg) {
    const id = String(seg.id);
    const q = (seg.keyword || "").trim();
    autofillBusy.add(id);
    refreshThumbs(id);
    let status = "error", results = [];
    const otherUsedP = otherScriptsUsedKeys();   // 다른 콘티(이전 영상)에서 쓴 영상은 넣지 않는다
    try {
      const res = await fetch(`/api/pexels-search?q=${encodeURIComponent(q)}&orientation=portrait`);
      if (res.status === 429) status = "quota";
      else {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) status = data.quota ? "quota" : "error";
        else {
          results = (data.results || []).filter((r) => r.hd_url);
          results.forEach((r) => { if (r.thumbnail) pexelsThumbMem[r.hd_url] = r.thumbnail; });   // 타임라인 썸네일용
          status = results.length ? "ok" : "no_results";
        }
      }
    } catch {
      status = "error";
    }
    const otherUsed = await otherUsedP;
    autofillBusy.delete(id);
    if (!segments.includes(seg)) return status;   // 그 사이 다른 콘티로 넘어갔다
    const trims = { ...(seg.asset_trims || {}) };
    if (trims.__cleared) { refreshThumbs(id); return status; }   // 검색하는 사이 사용자가 직접 지웠다
    // 저장 직전의 최신 소재 목록에 더한다 (검색하는 사이 올린 사진이 있어도 지워지지 않게)
    const paths = [...(seg.asset_paths || [])];
    const used = pexelsKeySet(segments.flatMap((s) => s.asset_paths || []));   // 이 장면·다른 장면에 이미 있는 영상은 넣지 않는다
    const pex = { ...(trims.__pexels || {}) };
    let want = needClips(segSecondsOf(seg)) - paths.length;
    let added = 0;
    // 맞는 후보 중에서 무작위로 고른다. 모자라면 그대로 두고 짧은/빈 장면 안내가 알려준다
    for (const r of shuffled(results.filter((r) => !pexelsResultIn(otherUsed, r)))) {
      if (want <= 0) break;
      if (pexelsResultIn(used, r)) continue;
      paths.push(r.hd_url);
      used.add(r.hd_url);
      used.add(pexelsVideoKey(r.hd_url));
      if (r.id != null) used.add("pxv:" + r.id);
      if (Number(r.duration) > 0) pex[r.hd_url] = Number(r.duration);
      want--; added++;
    }
    if (added) trims.__pexels = pex;
    trims.__autofill = { status, at: new Date().toISOString(), query: q };
    try {
      await saveFields(id, added ? { asset_paths: paths, asset_trims: trims } : { asset_trims: trims });
    } catch (err) {
      showMsg(`${seg.order_no}번 장면 자동 배치 저장 실패: ${err.message}`, false);
    }
    refreshThumbs(id);
    return status;
  }

