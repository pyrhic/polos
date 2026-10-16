// 콘티 자동 생성의 "순서" — 브라우저(youtube/conti-job.js)와 Supabase Edge Function(supabase/functions/create-conti/index.ts)이 똑같이 쓴다.
// ※ 이 파일의 ContiCore 블록은 index.ts 안에 글자 그대로 복사돼 있다. 여기를 고치면 index.ts의 같은 블록도 똑같이 고칠 것.
//    (Edge Function은 대시보드 편집기에 파일 하나로 붙여 넣어야 해서 import를 쓸 수 없다)
// 화면(DOM)·주소·키는 모른다. 바깥에서 deps로 넘겨 준다:
//   deps.rest(path, init)  Supabase REST (path 예: "youtube_scripts?id=eq.1") — 인증 머리말은 deps가 붙인다. Response를 돌려준다
//   deps.api(name, body)   Cloudflare /api/<name> 에 POST — { ok, status, data } 를 돌려준다
//   deps.timeLeft()        남은 시간(ms). 브라우저는 Infinity
//   deps.progress(text)    (선택) 진행 상황 글
// ==== BEGIN ContiCore ====
const ContiCore = (() => {
  const SUB_SECTION = "구독/좋아요";
  const STALE_MS = 15 * 60 * 1000;   // 대기·만드는 중이 이보다 오래면 멈춘 것으로 본다
  const TIME_LIMIT_MSG = "서버 시간 제한(150초)에 걸렸어요 — 브라우저에서 다시 만들기를 눌러 주세요";

  async function restJson(deps, path, init, what) {
    const r = await deps.rest(path, init || {});
    const t = await r.text();
    if (!r.ok) throw new Error(`${what} 실패: ${t.slice(0, 300)}`);
    return t ? JSON.parse(t) : null;
  }
  const say = (deps, t) => { try { if (deps.progress) deps.progress(t); } catch { /* 무시 */ } };

  // 대기·만드는 중인데 너무 오래된 행(멈춤)인지
  function isStale(row, now) {
    if (!row || (row.create_status !== "queued" && row.create_status !== "running")) return false;
    const t = Date.parse(row.create_started_at || row.created_at || "");
    return !!t && (now || Date.now()) - t > STALE_MS;
  }

  // "제목 + 영상 + 출처" 화면 문구: 제목 두 줄은 AI 제안, 출처는 참고한 기사의 매체명
  function screenText(data, articles) {
    const out = {};
    if (data.title1) out.title1 = String(data.title1).slice(0, 20);
    if (data.title2) out.title2 = String(data.title2).slice(0, 20);
    const names = [];
    [...((data.usedArticles || []).map((a) => a.source)), ...(articles || []).map((a) => a.source)].forEach((n) => {
      n = String(n || "").trim();
      if (n && !/^[\w.-]+\.[a-z]{2,}$/i.test(n) && !names.includes(n)) names.push(n);   // 주소(도메인)만 있는 건 매체명이 아니라서 뺀다
    });
    if (names.length) out.source_text = ("출처: " + names.join(", ")).slice(0, 60);
    return out;
  }

  // 채널 카드 소재 한 개: 그 카드로 이 콘티보다 먼저 만든 콘티 수 기준으로 돌아가며 (못 세면 무작위).
  // 자기 자신과 뒤에 만든 행은 세지 않는다 — 여러 편을 한꺼번에 맡겨도(빈 행들이 먼저 생김) 차례대로 다른 소재가 되게
  async function pickCardMedia(deps, card, beforeId) {
    const list = card.image_paths || [];
    if (!list.length) return [];
    let n = Math.floor(Math.random() * list.length);
    try {
      const r = await deps.rest(`youtube_scripts?select=id&video_settings->>subscribe_card_id=eq.${card.id}${beforeId != null ? `&id=lt.${beforeId}` : ""}`, {});
      if (r.ok) n = (await r.json()).length;
    } catch { /* 무작위 */ }
    return [list[n % list.length]];
  }

  // 채널 카드의 이름 붙은 목소리(youtube_subscribe_cards.voice = { name, voice, rate, pitch }) → 콘티 video_settings 키.
  // 영상은 콘티 전체를 목소리 하나로 읽으므로(tts_voice/tts_rate/tts_pitch) 카드 목소리 = 콘티 전체 목소리. voice_name·voice_sync는 화면 표시용.
  // 카드에 목소리가 없으면 {} (목소리 설정은 그대로). prev = 지금 video_settings: 예전에 동기화 중이었으면 동기화만 끈다
  function cardVoiceSettings(card, prev) {
    const v = card && card.voice;
    const name = v && typeof v === "object" ? String(v.name || "").trim() : "";
    if (name && v.voice) return { tts_voice: String(v.voice), tts_rate: Number(v.rate) || 0, tts_pitch: Number(v.pitch) || 0, voice_name: name.slice(0, 20), voice_sync: true };
    return prev && (prev.voice_sync || prev.voice_name) ? { voice_sync: false, voice_name: null } : {};
  }

  function applyCard(segs, card, photo) {
    if (!card) return segs;
    return segs.map((s) => s.section === SUB_SECTION
      ? { ...s, script_text: card.script_text || s.script_text, direction: card.direction || s.direction, asset_paths: photo }
      : s);
  }

  // 뉴스: 기사 사진 8장 + 영상 3개를 구독/좋아요가 아닌 장면에 돌아가며
  function planNews(d, segs) {
    const targets = segs.filter((s) => s.section !== SUB_SECTION);
    const imgs = d.images || [];
    const items = [...imgs.filter((m) => m.type !== "video").slice(0, 8), ...imgs.filter((m) => m.type === "video").slice(0, 3)];
    if (!targets.length) return [];
    return items.map((it, i) => ({
      segId: targets[i % targets.length].id, url: it.url, referer: it.articleUrl, n: i, video: it.type === "video",
      note: { source: it.source, articleUrl: it.articleUrl, articleTitle: it.articleTitle, caption: it.caption, origUrl: it.url },
    }));
  }

  // 위키: 제미나이가 고른 사진 번호 우선, 남는 사진은 사진 없는 장면에 차례로 (마지막 구독/좋아요 장면은 빼고)
  function planWiki(d, segs) {
    const images = d.images || [];
    const assign = new Map();
    const used = new Set();
    d.segments.forEach((s, i) => { if (s.image >= 0 && s.image < images.length && !used.has(s.image)) { assign.set(i, s.image); used.add(s.image); } });
    const free = images.map((_, k) => k).filter((k) => !used.has(k));
    for (let i = 0; i < d.segments.length - 1 && free.length; i++) { if (!assign.has(i)) assign.set(i, free.shift()); }
    const out = [];
    let n = 0;
    for (const [i, k] of assign) {
      const seg = segs[i], im = images[k];
      if (!seg || !im) continue;
      out.push({
        segId: seg.id, url: im.url, referer: im.page, n: n++, video: false,
        note: { source: "위키미디어 커먼즈", license: im.license, artist: im.artist, articleUrl: im.page, articleTitle: im.file, caption: im.caption, origUrl: im.url },
      });
    }
    return out;
  }

  async function setStatus(deps, id, status, extra) {
    await restJson(deps, `youtube_scripts?id=eq.${id}`, {
      method: "PATCH", body: JSON.stringify({ create_status: status, ...(extra || {}) }),
    }, "상태 저장");
  }

  // 1단계: 대본(제미나이) → 채널 카드 → 콘티 내용 저장 → 장면 저장. 가져올 사진 목록(pending)을 create_request에 남긴다
  async function phaseDraft(deps, row) {
    const req = row.create_request || {};
    if (req.kind !== "news" && req.kind !== "wiki") throw new Error("알 수 없는 콘티 요청이에요");
    const isNews = req.kind === "news";
    say(deps, "대본을 쓰는 중… (10~40초)");
    const r = isNews
      ? await deps.api("gemini-draft", { topic: req.topic, articles: req.articles || [], note: req.note || "", traffic: req.traffic || "", geo: req.geo || "" })
      : await deps.api("gemini-wiki-draft", { lang: req.lang, title: req.title, idea: req.idea, seconds: req.seconds, personName: req.personName, kind: req.wiki_kind });
    if (!r.ok) throw new Error((r.data && r.data.error) || `대본 생성 실패 (${r.status})`);
    const d = r.data;
    if (!d || !Array.isArray(d.segments) || !d.segments.length) throw new Error("대본이 비어 있어요. 다시 만들어 주세요");

    say(deps, "장면을 저장하는 중…");
    let card = null;
    if (req.card_id != null && req.card_id !== "") {
      try {
        const rows = await restJson(deps, `youtube_subscribe_cards?select=*&id=eq.${encodeURIComponent(req.card_id)}`, {}, "채널 카드 읽기");
        if (rows && rows[0]) card = { ...rows[0], image_paths: Array.isArray(rows[0].image_paths) ? rows[0].image_paths : [] };
      } catch { /* 카드를 못 읽으면 기본 문구 그대로 */ }
    }
    const photo = card ? await pickCardMedia(deps, card, row.id) : [];
    const segs = applyCard(d.segments, card, photo);
    const mood = req.mood || d.mood;   // 직접 고른 분위기 > 제미나이 판단
    const vs0 = row.video_settings || {};
    const cardSettings = card ? { subscribe_card_id: card.id, channel_slot: card.channel_slot, ...cardVoiceSettings(card, vs0) } : (req.channel_slot != null ? { channel_slot: req.channel_slot } : {});
    const texts = segs.map((s) => s.script_text || "");
    let patch, note = "";
    if (isNews) {
      const articles = req.articles || [];
      patch = {
        hook: texts[0], story: texts.slice(1).join("\n") || texts[0],
        fact_sources: [
          ...articles.map((a) => a.url).filter(Boolean),
          ...((d.research && d.research.sources) || []).slice(0, 4).map((s) => `${s.title} — ${s.url}`),
        ].join("\n"),
        video_settings: { ...vs0, name: String(d.name || req.topic || "").slice(0, 40), ...screenText(d, articles), ...(mood ? { mood } : {}), ...cardSettings },
      };
      note = d.research && d.research.ok
        ? `관점 자료로 관련 칼럼·분석 기사 ${d.research.sources.length}건을 참고했습니다.`
        : "관련 칼럼·분석 기사를 찾지 못해 관점 정리 없이 기사 중심으로 썼습니다.";
      if (d.embeds && d.embeds.length) note += ` 기사 속 유튜브 영상 ${d.embeds.length}개는 내려받지 않고 링크만 알려요: ${d.embeds.map((e) => e.link).join(" , ")}`;
    } else {
      const sourceLines = [...(d.sources || []).map((s) => `${s.title} (CC BY-SA 4.0) ${s.url}`), ...(d.credits || [])];
      patch = {
        hook: texts[0], story: texts.slice(1).join("\n"), fact_sources: sourceLines.join("\n"),
        video_settings: { ...vs0, name: String(d.name || (req.idea && req.idea.title) || "").slice(0, 40), title1: d.title1, title2: d.title2, source_text: "출처: 위키백과", ...(mood ? { mood } : {}), ...cardSettings },
      };
      note = `카드 ${d.segments.length}장 · 글자 ${d.totalChars || 0}자`;
    }

    // 다시 만들기라면 지난번 장면을 먼저 지운다
    await restJson(deps, `youtube_segments?script_id=eq.${row.id}`, { method: "DELETE" }, "이전 장면 정리");
    const created = await restJson(deps, "youtube_segments", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify(segs.map((s, i) => ({
        // 여러 행을 한 번에 넣을 땐 모든 행의 칸 이름이 같아야 한다 (PGRST102). undefined 칸은 JSON에서 빠지므로 모두 문자열/배열로 채운다
        script_id: row.id, order_no: i + 1, section: s.section || "", script_text: s.script_text || "", keyword: s.keyword || "", direction: s.direction || "",
        asset_paths: (s.asset_paths && s.asset_paths.length) ? s.asset_paths : [],
      }))),
    }, "장면 저장");
    created.sort((a, b) => a.order_no - b.order_no);
    const pending = isNews ? planNews(d, created) : planWiki(d, created);
    const req2 = { ...req, pending_images: pending, images_total: pending.length, images_ok: 0, videos_ok: 0, result_note: note };
    await restJson(deps, `youtube_scripts?id=eq.${row.id}`, { method: "PATCH", body: JSON.stringify({ ...patch, create_request: req2 }) }, "콘티 저장");
    return { req: req2, pending };
  }

  // 2단계: 사진·영상을 /api/save-article-image로 저장해 장면에 붙인다. 남은 시간이 minLeftMs보다 적으면 멈추고 남은 목록을 돌려준다
  async function phaseImages(deps, scriptId, pending, minLeftMs) {
    const bySeg = new Map();
    let ok = 0, videos = 0, i = 0;
    for (; i < pending.length; i++) {
      if (deps.timeLeft() < (minLeftMs || 0)) break;
      const it = pending[i];
      say(deps, `사진·영상 가져오는 중… (${i + 1}/${pending.length})`);
      let r;
      try {
        r = await deps.api("save-article-image", { url: it.url, referer: it.referer, scriptId: Number(scriptId), segId: Number(it.segId), n: it.n });
      } catch (e) {
        if (e && e.timeLimit) break;   // 시간이 다 됐으면 이 사진부터 다음 차례로
        continue;   // 한 장 실패해도 계속
      }
      if (!r.ok || !r.data || !r.data.path) continue;
      const e = bySeg.get(it.segId) || { paths: [], notes: {} };
      e.paths.push(r.data.path);
      e.notes[r.data.path] = it.note || {};
      bySeg.set(it.segId, e);
      ok++;
      if (it.video) videos++;
    }
    if (bySeg.size) {
      const rows = await restJson(deps, `youtube_segments?select=id,asset_paths,asset_notes&id=in.(${[...bySeg.keys()].join(",")})`, {}, "장면 읽기");
      for (const sg of rows || []) {
        const e = bySeg.get(sg.id);
        if (!e) continue;
        await restJson(deps, `youtube_segments?id=eq.${sg.id}`, {
          method: "PATCH",
          body: JSON.stringify({ asset_paths: [...(sg.asset_paths || []), ...e.paths], asset_notes: { ...(sg.asset_notes || {}), ...e.notes } }),
        }, "소재 연결 저장");
      }
    }
    return { remaining: pending.slice(i), ok, videos };
  }

  function imageNote(req) {
    const total = req.images_total || 0, ok = req.images_ok || 0, v = req.videos_ok || 0;
    if (!total) return "";
    if (req.kind === "wiki") return `(사진 ${ok}/${total}장)`;
    if (!ok) return "기사 사진·영상을 가져오지 못했습니다.";
    return `기사 사진 ${ok - v}장${v ? `, 영상 ${v}개` : ""}를 장면에 가져왔습니다 — 저작권 확인 후 문제 있는 건 × 로 삭제하세요.`;
  }

  // 마지막: 완료 표시. skipped = 시간이 모자라 못 가져온 사진 수
  async function finish(deps, id, req, skipped) {
    const parts = [req.result_note || "", imageNote(req), skipped ? `사진·영상 ${skipped}개는 시간이 모자라 가져오지 못했어요.` : ""].filter(Boolean);
    const { pending_images, ...rest } = req;
    await setStatus(deps, id, "done", { create_error: null, create_request: { ...rest, result_note: parts.join(" ") } });
  }

  function errorText(e) {
    if (e && e.timeLimit) return TIME_LIMIT_MSG;
    return String((e && e.message) || e || "알 수 없는 오류").slice(0, 500);
  }

  // 브라우저에서 처음부터 끝까지 (서버를 못 쓸 때, 또는 "브라우저에서 만들기")
  async function runAll(deps, row) {
    try {
      await setStatus(deps, row.id, "running", { create_started_at: new Date().toISOString(), create_error: null });
      const { req, pending } = await phaseDraft(deps, row);
      const res = await phaseImages(deps, row.id, pending, 0);
      await finish(deps, row.id, { ...req, images_ok: res.ok, videos_ok: res.videos }, res.remaining.length);
      return true;
    } catch (e) {
      try { await setStatus(deps, row.id, "error", { create_error: errorText(e) }); } catch { /* 상태도 못 쓰면 시간 초과로 보인다 */ }
      throw e;
    }
  }

  return { STALE_MS, TIME_LIMIT_MSG, isStale, screenText, cardVoiceSettings, setStatus, phaseDraft, phaseImages, finish, errorText, runAll };
})();
// ==== END ContiCore ====
