// 콘티 미리보기용 실제 성우 목소리 (영상 생성 파이프라인 youtube-automation/core/02_tts.py와 같은 목소리·같은 방식)
//   POST /api/tts  {text, voice, rate, pitch}
//     voice: 기본 "ko-KR-InJoonNeural"
//     rate : 콘티 설정 값(숫자 -3 → "-3%") 또는 "+10%" 같은 글자
//     pitch: 콘티 설정 값(숫자 -5 → "-5Hz") 또는 "+0Hz" 같은 글자
//   → 200 { audio: base64 mp3, words: [{text, start, end}] (초), cached: true|false }
//   → 400/502 { error }
//
// 구조
//   1. 제공자(provider): 글자 → {mp3 bytes, words}. 지금은 Microsoft Edge 온라인 TTS 하나(edgeSynthesize).
//      나중에 Google Cloud TTS나 MeloTTS 등으로 바꾸려면 PROVIDERS에 같은 모양의 함수를 넣고 PROVIDER만 바꾸면 된다.
//      응답 형식과 캐시는 제공자와 무관하다(캐시 키에 제공자 이름이 들어가서 바꾸면 자동으로 새로 만든다).
//   2. 캐시: Supabase Storage youtube-assets/tts-cache/<sha256>.mp3 + .json(words).
//      같은 (제공자, text, voice, rate, pitch)는 다시 만들지 않는다. 화면(storyboard.html)은 제공자도 캐시도 모른다.
import "../../config.js";

const PROVIDER = "edge";
const MAX_TEXT_BYTES = 3000;      // 파이프라인 TTS_MAX_BYTES와 같다. 넘으면 화면이 문장 끝에서 나눠 여러 번 부른다
const DEFAULT_VOICE = "ko-KR-InJoonNeural";
const TIMEOUT_MS = 25000;

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch { return json({ error: "요청 형식이 잘못됐어요 (JSON 아님)" }, 400); }

  const text = String((body && body.text) || "").replace(/\s+/g, " ").trim();
  if (!text) return json({ error: "읽을 글자가 없어요" }, 400);
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_TEXT_BYTES) return json({ error: `글자가 너무 길어요 (${bytes}바이트, 최대 ${MAX_TEXT_BYTES}바이트). 문장 끝에서 나눠 보내 주세요` }, 400);
  const voice = String((body && body.voice) || DEFAULT_VOICE);
  if (!/^[a-z]{2,3}-[A-Z]{2,4}-[A-Za-z0-9]+Neural$/.test(voice)) return json({ error: "목소리 이름이 잘못됐어요" }, 400);
  const rate = fmtSigned(body && body.rate, "%");
  const pitch = fmtSigned(body && body.pitch, "Hz");
  if (!rate || !pitch) return json({ error: "속도/높낮이 값이 잘못됐어요" }, 400);

  const cache = cacheOf(env);
  const key = await sha256Hex(JSON.stringify([PROVIDER, voice, rate, pitch, text]));

  // 1) 캐시에 있으면 그대로
  const hit = cache ? await cacheGet(cache, key) : null;
  if (hit) return json({ audio: toBase64(hit.mp3), words: hit.words, cached: true });

  // 2) 제공자로 합성
  let out;
  try {
    out = await PROVIDERS[PROVIDER]({ text, voice, rate, pitch });
  } catch (e) {
    const msg = String((e && e.message) || e);
    return json({ error: /403/.test(msg) ? `Microsoft가 요청을 막음 (403): ${msg}` : `음성 합성 실패: ${msg}` }, 502);
  }

  // 3) 캐시에 저장 (응답을 늦추지 않게 뒤에서)
  if (cache) {
    const save = cachePut(cache, key, out).catch(() => {});
    if (context.waitUntil) context.waitUntil(save);
  }
  return json({ audio: toBase64(out.mp3), words: out.words, cached: false });
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ error: "POST로 보내 주세요" }, 405);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

// 숫자 -3 → "-3%", "+10%" → "+10%" (파이프라인: f"{int(v):+d}%", f"{int(v):+d}Hz")
function fmtSigned(v, unit) {
  if (v == null || v === "") return `+0${unit}`;
  if (typeof v === "number" || /^\s*[+-]?\d+(\.\d+)?\s*$/.test(String(v))) {
    const n = Math.trunc(Number(v));
    if (!isFinite(n) || Math.abs(n) > 100) return null;
    return `${n >= 0 ? "+" : "-"}${Math.abs(n)}${unit}`;
  }
  const m = new RegExp(`^([+-])(\\d{1,3})${unit}$`).exec(String(v).trim());
  return m ? `${m[1]}${m[2]}${unit}` : null;
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

// ───── 캐시 (Supabase Storage, anon 키 — 콘티 화면의 소재 업로드와 같은 방식) ─────
// TTS_CACHE=off 면 끈다. TTS_CACHE_BASE는 시험용(로컬 가짜 스토리지 주소). 평소엔 config.js의 Supabase 주소
function cacheOf(env) {
  if (env && String(env.TTS_CACHE || "").toLowerCase() === "off") return null;
  const C = globalThis.POLOS_CONFIG || {};
  const base = (env && env.TTS_CACHE_BASE) || C.SUPABASE_URL;
  if (!base || !C.SUPABASE_ANON_KEY) return null;
  return { base: String(base).replace(/\/$/, ""), anon: C.SUPABASE_ANON_KEY, bucket: "youtube-assets", dir: "tts-cache" };
}
// 연결이 끊기면 한 번만 다시 (캐시는 실패해도 합성으로 넘어가면 되니 가볍게)
async function fetchRetry(url, init) {
  try { return await fetch(url, init); } catch { return await fetch(url, init); }
}
async function cacheGet(c, key) {
  try {
    const pub = `${c.base}/storage/v1/object/public/${c.bucket}/${c.dir}/${key}`;
    const jr = await fetchRetry(`${pub}.json`);   // json은 mp3 다음에 올리므로, json이 있으면 mp3도 있다
    if (!jr.ok) return null;
    const words = await jr.json();
    const ar = await fetchRetry(`${pub}.mp3`);
    if (!ar.ok || !Array.isArray(words)) return null;
    const mp3 = new Uint8Array(await ar.arrayBuffer());
    return mp3.length ? { mp3, words } : null;
  } catch { return null; }
}
async function cachePut(c, key, out) {
  const h = { apikey: c.anon, Authorization: `Bearer ${c.anon}` };
  const up = (name, type, data) => fetch(`${c.base}/storage/v1/object/${c.bucket}/${c.dir}/${key}.${name}`, {
    method: "POST", headers: { ...h, "Content-Type": type }, body: data,
  });
  const r1 = await up("mp3", "audio/mpeg", out.mp3);
  if (!r1.ok) return;
  await up("json", "application/json", JSON.stringify(out.words));
}

// ───── 제공자 ─────
// 모양: async ({text, voice, rate, pitch}) => ({ mp3: Uint8Array, words: [{text, start, end}] (초) })
const PROVIDERS = { edge: edgeSynthesize };

// Microsoft Edge 온라인 TTS (edge-tts 파이썬 패키지와 같은 프로토콜: constants.py / drm.py / communicate.py)
const EDGE_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_CHROMIUM = "143.0.3650.75";
const EDGE_GEC_VERSION = `1-${EDGE_CHROMIUM}`;
// 2026-10부터 예전 주소가 403을 주기 시작해 새 주소를 먼저 쓴다 (파이프라인 _WSS_HOSTS와 같은 순서)
const EDGE_HOSTS = [
  `https://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key=${EDGE_TOKEN}`,
  `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${EDGE_TOKEN}`,
];
const EDGE_MAJOR = EDGE_CHROMIUM.split(".")[0];
const EDGE_HEADERS = {
  "Pragma": "no-cache",
  "Cache-Control": "no-cache",
  "Origin": "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
  "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EDGE_MAJOR}.0.0.0 Safari/537.36 Edg/${EDGE_MAJOR}.0.0.0`,
  "Accept-Language": "en-US,en;q=0.9",
};
let edgeSkewSec = 0;   // 서버 시계와 차이 (403일 때 응답 Date로 고친다, drm.py와 같음)

async function edgeSecMsGec() {
  // Windows 파일 시각(1601년부터 100나노초) → 5분 단위로 내림 → "숫자+토큰"의 SHA-256 대문자 hex
  let sec = Math.floor(Date.now() / 1000 + edgeSkewSec) + 11644473600;
  sec -= sec % 300;
  const ticks = (BigInt(sec) * 10000000n).toString();
  return (await sha256Hex(ticks + EDGE_TOKEN)).toUpperCase();
}
function hex32() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function edgeDate() {
  // 자바스크립트 Date.toString() 모양 (UTC)
  const d = new Date();
  const D = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const p = (n) => String(n).padStart(2, "0");
  return `${D} ${M} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
}
function xmlEscape(s) {
  // 서비스가 못 받는 제어 문자는 공백으로 (communicate.py remove_incompatible_characters), & < > 이스케이프
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function htmlUnescape(s) {
  return String(s || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

async function edgeSynthesize({ text, voice, rate, pitch }) {
  let lastErr = null;
  // 새 주소 → (잠깐 쉬고, 시계 보정해서) 새 주소 한 번 더 → 예전 주소. 403은 가끔 한 번씩 섞여 나온다
  const order = [0, 0, 1];
  for (let attempt = 0; attempt < order.length; attempt++) {
    const host = EDGE_HOSTS[order[attempt]];
    if (attempt) await new Promise((r) => setTimeout(r, 400 * attempt));
    try {
      return await edgeOnce(host, { text, voice, rate, pitch });
    } catch (e) {
      lastErr = e;
      if (!e || !e.status) break;          // 403 등 연결 거절일 때만 다른 주소/시계 보정으로 다시
    }
  }
  throw lastErr || new Error("알 수 없는 오류");
}

async function edgeOnce(host, { text, voice, rate, pitch }) {
  const url = `${host}&ConnectionId=${hex32()}&Sec-MS-GEC=${await edgeSecMsGec()}&Sec-MS-GEC-Version=${EDGE_GEC_VERSION}`;
  const resp = await fetch(url, { headers: { ...EDGE_HEADERS, Upgrade: "websocket", Cookie: `muid=${hex32().toUpperCase()};` } });
  const ws = resp.webSocket;
  if (!ws) {
    // 시계가 틀려 거절됐을 수 있으니 서버 시각으로 맞춰 둔다 (다음 시도에 반영)
    const sd = Date.parse(resp.headers.get("Date") || "");
    if (isFinite(sd)) edgeSkewSec += sd / 1000 - (Date.now() / 1000 + edgeSkewSec);
    const err = new Error(`음성 서버 연결 거절 (${resp.status})`);
    err.status = resp.status;
    throw err;
  }
  ws.accept();

  const chunks = [];
  const words = [];
  let audioBytes = 0;
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("음성 서버 응답 시간 초과")); }, TIMEOUT_MS);
    const finish = (err) => { clearTimeout(timer); try { ws.close(1000); } catch {} if (err) reject(err); else resolve(); };
    ws.addEventListener("message", (ev) => {
      try {
        if (typeof ev.data === "string") {
          const sep = ev.data.indexOf("\r\n\r\n");
          const head = ev.data.slice(0, sep);
          const data = ev.data.slice(sep + 4);
          const path = (/^Path:(.*)$/mi.exec(head) || [])[1];
          if (path === "audio.metadata") {
            for (const m of JSON.parse(data).Metadata || []) {
              if (m.Type !== "WordBoundary") continue;
              const off = m.Data.Offset, dur = m.Data.Duration;
              words.push({ text: htmlUnescape(m.Data.text && m.Data.text.Text), start: off / 1e7, end: (off + dur) / 1e7 });
            }
          } else if (path === "turn.end") {
            finish();
          }
          return;
        }
        // 바이너리: 앞 2바이트 = 헤더 길이(big-endian), 그 뒤 헤더, 그 뒤 mp3
        const u8 = new Uint8Array(ev.data);
        if (u8.length < 2) return;
        const hl = (u8[0] << 8) | u8[1];
        const head = new TextDecoder().decode(u8.subarray(2, 2 + hl));
        if (!/Path:audio/i.test(head)) return;
        const audio = u8.subarray(2 + hl);
        if (audio.length && /Content-Type:audio\/mpeg/i.test(head)) { chunks.push(audio.slice()); audioBytes += audio.length; }
      } catch (e) { finish(e); }
    });
    ws.addEventListener("close", () => finish(audioBytes ? null : new Error("음성 서버가 소리 없이 연결을 끊음")));
    ws.addEventListener("error", () => finish(new Error("음성 서버 연결 오류")));
  });

  const wd = "true", sq = "false";   // 단어 경계(WordBoundary)만 받는다
  ws.send(`X-Timestamp:${edgeDate()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
    `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"${sq}","wordBoundaryEnabled":"${wd}"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`);
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'>` +
    `<prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${xmlEscape(text)}</prosody></voice></speak>`;
  ws.send(`X-RequestId:${hex32()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${edgeDate()}Z\r\nPath:ssml\r\n\r\n${ssml}`);

  await done;
  if (!audioBytes) throw new Error("소리를 받지 못했어요");
  const mp3 = new Uint8Array(audioBytes);
  let o = 0;
  for (const c of chunks) { mp3.set(c, o); o += c.length; }
  return { mp3, words };
}
