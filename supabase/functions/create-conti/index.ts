// @ts-nocheck
// Supabase Edge Function "create-conti" — 콘티(뉴스·위키) 자동 생성을 서버에서 끝까지 한다. 사용자가 화면을 나가도 계속된다.
//
// 흐름: 브라우저가 youtube_scripts에 빈 콘티 행(create_status='queued', create_request=입력값)을 만들고
//       이 함수를 {script_id}로 부른다 → 바로 202로 답하고 EdgeRuntime.waitUntil 안에서 계속:
//       1단계(draft)  Cloudflare /api/gemini-draft 또는 /api/gemini-wiki-draft → 채널 카드 → 콘티·장면 저장
//       2단계(images) 자기 자신을 {script_id, phase:'images'}로 다시 불러 새 150초를 받아 /api/save-article-image로 사진·영상 저장
//       끝나면 create_status='done', 실패하면 'error' + create_error(사용자에게 보여 줄 문구)
// 무료 요금제 한도: 한 번 부를 때 150초(벽시계), CPU 2초(기다리는 시간 제외). 시간을 재다가 모자라면 멈추고 안내한다.
//
// 환경변수 (Supabase가 자동으로 넣어 줌): SUPABASE_URL, SUPABASE_ANON_KEY
// 선택 환경변수: POLOS_BASE_URL  (기본 https://polos-cxn.pages.dev — Cloudflare 주소)
//               POLOS_SUPABASE_KEY (SUPABASE_ANON_KEY 대신 쓸 anon/publishable 키, 보통 필요 없음)
// 배포: 대시보드 Edge Functions → 이름 create-conti → 이 파일 전체를 붙여 넣고 Deploy.
//       브라우저가 publishable 키로 부르므로 함수 설정에서 "Verify JWT"(Enforce JWT verification)를 끈다.
//
// 아래 ContiCore 블록은 polos/youtube/conti-core.js 와 글자 그대로 같아야 한다 (브라우저의 "브라우저에서 만들기"가 같은 순서를 쓴다).

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
const SB_KEY = Deno.env.get("POLOS_SUPABASE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const BASE_URL = (Deno.env.get("POLOS_BASE_URL") || "https://polos-cxn.pages.dev").replace(/\/$/, "");
const SELF_URL = `${SUPABASE_URL}/functions/v1/create-conti`;
const BUDGET_MS = 140 * 1000;      // 150초 한도에서 여유 10초
const MAX_HOPS = 3;                // 사진 단계를 이어서 부르는 최대 횟수
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (obj, status) => new Response(JSON.stringify({ from: "create-conti", ...obj }), {
  status, headers: { ...CORS, "Content-Type": "application/json" },
});

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
      ? { ...s, script_text: card.script_text || s.script_text, subtitle_text: null, direction: card.direction || s.direction, asset_paths: photo }
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
    const hookFormula = { hook_formula: d.hook_formula || null };   // 첫 문장이 따른 후킹 공식 id (다시 만들면 새 값으로 바뀐다)
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
        video_settings: { ...vs0, name: String(d.name || req.topic || "").slice(0, 40), ...screenText(d, articles), ...(mood ? { mood } : {}), ...hookFormula, ...cardSettings },
      };
      note = d.research && d.research.ok
        ? `관점 자료로 관련 칼럼·분석 기사 ${d.research.sources.length}건을 참고했습니다.`
        : "관련 칼럼·분석 기사를 찾지 못해 관점 정리 없이 기사 중심으로 썼습니다.";
      if (d.embeds && d.embeds.length) note += ` 기사 속 유튜브 영상 ${d.embeds.length}개는 내려받지 않고 링크만 알려요: ${d.embeds.map((e) => e.link).join(" , ")}`;
    } else {
      const sourceLines = [...(d.sources || []).map((s) => `${s.title} (CC BY-SA 4.0) ${s.url}`), ...(d.credits || [])];
      patch = {
        hook: texts[0], story: texts.slice(1).join("\n"), fact_sources: sourceLines.join("\n"),
        video_settings: { ...vs0, name: String(d.name || (req.idea && req.idea.title) || "").slice(0, 40), title1: d.title1, title2: d.title2, source_text: "출처: 위키백과", ...(mood ? { mood } : {}), ...hookFormula, ...cardSettings },
      };
      note = `카드 ${d.segments.length}장 · 글자 ${d.totalChars || 0}자`;
    }

    // 다시 만들기라면 지난번 장면을 먼저 지운다
    await restJson(deps, `youtube_segments?script_id=eq.${row.id}`, { method: "DELETE" }, "이전 장면 정리");
    const segRows = segs.map((s, i) => ({
      // 여러 행을 한 번에 넣을 땐 모든 행의 칸 이름이 같아야 한다 (PGRST102). undefined 칸은 JSON에서 빠지므로 모두 문자열/배열/null로 채운다
      // subtitle_text: 화면 자막(문자열 = 새 장면). 채널 카드·구독 장면처럼 값이 없으면 null = SCRIPT 줄이 그대로 자막 (계약서 16절)
      script_id: row.id, order_no: i + 1, section: s.section || "", script_text: s.script_text || "",
      subtitle_text: typeof s.subtitle_text === "string" ? s.subtitle_text : null, keyword: s.keyword || "", direction: s.direction || "",
      asset_paths: (s.asset_paths && s.asset_paths.length) ? s.asset_paths : [],
    }));
    const saveSegs = (rows) => restJson(deps, "youtube_segments", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(rows) }, "장면 저장");
    let created;
    try {
      created = await saveSegs(segRows);
    } catch (e) {
      // subtitle_text 칸이 아직 없는 DB(youtube_tables_18_subtitle.sql 실행 전, PGRST204): 그 칸만 빼고 다시 (자막 = SCRIPT 줄인 옛 장면이 된다)
      if (!/subtitle_text/.test(String(e && e.message)) || !/PGRST204|column|schema/i.test(String(e && e.message))) throw e;
      created = await saveSegs(segRows.map(({ subtitle_text, ...r }) => r));
      note = (note ? note + " " : "") + "※ 화면 자막(SUBTITLE) 칸이 DB에 아직 없어 자막을 저장하지 못했어요 — youtube_tables_18_subtitle.sql을 실행해 주세요.";
    }
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

// ───── 서버용 deps: Supabase REST + Cloudflare /api, 남은 시간을 재며 넘치면 끊는다 ─────
function makeDeps(startedAt) {
  const timeLeft = () => BUDGET_MS - (Date.now() - startedAt);
  const timeLimitError = () => { const e = new Error("time limit"); e.timeLimit = true; return e; };
  // strict = 대본·사진처럼 오래 걸리는 Cloudflare 호출: 남은 시간 안에서만. DB 쓰기는 150초 한도의 여유(10초) 안에서 끝까지 쓰게 8초를 더 준다
  async function timed(url, init, strict) {
    const left = timeLeft();
    if (strict && left < 5000) throw timeLimitError();
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(strict ? left : Math.max(left, 0) + 8000) });
    } catch (e) {
      if (e && (e.name === "TimeoutError" || e.name === "AbortError")) throw timeLimitError();
      throw e;
    }
  }
  return {
    timeLeft,
    rest: (path, init) => timed(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...((init && init.headers) || {}) },
    }),
    api: async (name, body) => {
      const r = await timed(`${BASE_URL}/api/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, true);
      if (timeLeft() < 0) throw timeLimitError();   // 한도를 넘겨 돌아왔으면 (실제 서버라면 이미 끊겼을 시간) 더 진행하지 않는다
      let data = null;
      try { data = await r.json(); } catch { /* JSON이 아니면 null */ }
      return { ok: r.ok, status: r.status, data };
    },
  };
}

// 다음 단계를 새 호출로 넘긴다 (새 150초). 202를 받으면 true
async function invokeSelf(scriptId, phase, hop) {
  try {
    const r = await fetch(SELF_URL, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ script_id: scriptId, phase, hop }),
      signal: AbortSignal.timeout(15000),
    });
    return r.status === 202;
  } catch {
    return false;
  }
}

async function fail(deps, id, e) {
  console.error("create-conti", id, e);
  try {
    // 시간이 다 돼도 상태는 꼭 남긴다 (남은 시간과 상관없이 짧게 한 번)
    await fetch(`${SUPABASE_URL}/rest/v1/youtube_scripts?id=eq.${id}`, {
      method: "PATCH",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ create_status: "error", create_error: ContiCore.errorText(e) }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* 못 쓰면 15분 뒤 화면에 "시간 초과"로 보인다 */ }
}

// 1단계: 대본 → 장면. 사진이 있으면 다음 호출로 넘긴다
async function runDraft(row, startedAt) {
  const deps = makeDeps(startedAt);
  try {
    const { req, pending } = await ContiCore.phaseDraft(deps, row);
    if (!pending.length) { await ContiCore.finish(deps, row.id, req, 0); return; }
    if (await invokeSelf(row.id, "images", 1)) return;
    // 이어 부르기를 못 하면 남은 시간 안에서 직접
    await runImagesWith(deps, row.id, req, 1, false);
  } catch (e) {
    await fail(deps, row.id, e);
  }
}

// 2단계: 사진·영상. 시간이 모자라면 남은 목록을 저장하고 다시 이어 부른다 (최대 MAX_HOPS번)
async function runImages(row, hop, startedAt) {
  const deps = makeDeps(startedAt);
  try {
    await runImagesWith(deps, row.id, row.create_request || {}, hop, true);
  } catch (e) {
    await fail(deps, row.id, e);
  }
}

async function runImagesWith(deps, id, req, hop, canChain) {
  const res = await ContiCore.phaseImages(deps, id, req.pending_images || [], 20000);
  const req2 = { ...req, images_ok: (req.images_ok || 0) + res.ok, videos_ok: (req.videos_ok || 0) + res.videos, pending_images: res.remaining };
  if (res.remaining.length && canChain && hop < MAX_HOPS) {
    await deps.rest(`youtube_scripts?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ create_request: req2 }) });
    if (await invokeSelf(id, "images", hop + 1)) return;
  }
  // 사진을 다 못 가져와도 콘티는 쓸 수 있으니 완료로 둔다 (안내 문구만 남김)
  await ContiCore.finish(deps, id, req2, res.remaining.length);
}

const isoMinus = (ms) => new Date(Date.now() - ms).toISOString();

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return reply({ error: "POST만 받아요" }, 405);
  const startedAt = Date.now();
  if (!SUPABASE_URL || !SB_KEY) return reply({ error: "SUPABASE_URL / SUPABASE_ANON_KEY 환경변수가 없어요" }, 500);
  let body;
  try {
    const text = await request.text();
    if (text.length > 1000) return reply({ error: "요청이 너무 커요" }, 413);
    body = JSON.parse(text || "{}");
  } catch {
    return reply({ error: "요청 형식이 잘못됐어요" }, 400);
  }
  const id = Number(body.script_id);
  if (!Number.isInteger(id) || id <= 0) return reply({ error: "script_id가 필요해요" }, 400);
  const phase = body.phase === "images" ? "images" : "draft";
  const hop = Math.max(1, Math.min(MAX_HOPS, Number(body.hop) || 1));
  const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
  const COLS = "id,create_status,create_request,create_started_at,created_at,video_settings";

  let row;
  if (phase === "images") {
    // 사진 단계는 "만드는 중"이고 가져올 목록이 남은 행만
    const r = await fetch(`${SUPABASE_URL}/rest/v1/youtube_scripts?select=${COLS}&id=eq.${id}&create_status=eq.running`, { headers: H });
    if (!r.ok) return reply({ error: "콘티를 읽지 못했어요: " + (await r.text()).slice(0, 200) }, 502);
    row = (await r.json())[0];
    if (!row || !Array.isArray(row.create_request && row.create_request.pending_images)) return reply({ error: "사진 단계를 진행할 콘티가 아니에요" }, 409);
  } else {
    // 대기·실패, 또는 15분 넘게 멈춘 "만드는 중" 행만 집는다. 조건부 수정이라 두 번 눌러도 한 번만 돈다
    const stale = `"${isoMinus(ContiCore.STALE_MS)}"`;
    const cond = `or=(create_status.in.(queued,error),and(create_status.eq.running,create_started_at.lt.${stale}),and(create_status.eq.running,create_started_at.is.null))`;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/youtube_scripts?id=eq.${id}&${cond}&select=${COLS}`, {
      method: "PATCH", headers: { ...H, Prefer: "return=representation" },
      body: JSON.stringify({ create_status: "running", create_started_at: new Date().toISOString(), create_error: null }),
    });
    if (!r.ok) return reply({ error: "콘티 상태를 바꾸지 못했어요: " + (await r.text()).slice(0, 200) }, 502);
    row = (await r.json())[0];
    if (!row) {
      const chk = await fetch(`${SUPABASE_URL}/rest/v1/youtube_scripts?select=id,create_status&id=eq.${id}`, { headers: H });
      const now = chk.ok ? (await chk.json())[0] : null;
      if (!now) return reply({ error: "콘티를 찾을 수 없어요" }, 404);
      return reply({ error: "이미 만드는 중이거나 다 만든 콘티예요", status: now.create_status }, 409);
    }
  }

  const job = phase === "images" ? runImages(row, hop, startedAt) : runDraft(row, startedAt);
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(job);
  return reply({ ok: true, script_id: id, phase }, 202);
});
