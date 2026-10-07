// Trend에서 고른 주제 + 관련 기사로 한국어 쇼츠 대본을 쓰고, 한 번의 제미나이 호출로 3~5개 장면(콘티)까지 나눠준다.
// 하루 20회 무료 쿼터는 gemini-storyboard.js와 공유한다.
const CLICHES = [
  "안녕하세요 여러분, 오늘은 ~에 대해 알아보겠습니다", "결론적으로", "다양한 이야기가 있습니다",
  "이처럼", "정리해보겠습니다", "여러분들도 알다시피",
];

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json" },
});

const decode = (s) => String(s || "")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

function isAllowedUrl(u) {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return false;
    const h = url.hostname;
    return !(h === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || h.endsWith(".local") || h.endsWith(".internal"));
  } catch {
    return false;
  }
}

// 기사 페이지의 대표 사진(og:image)과 본문 속 사진(figure)을 찾는다. 아이콘/로고/광고로 보이는 건 거른다.
function extractImages(rawHtml, pageUrl) {
  const found = [];
  const add = (src, caption) => {
    try {
      const u = new URL(decode(src), pageUrl).href;
      if (!/^https?:/.test(u)) return;
      if (/\.(svg|gif)(\?|$)/i.test(u)) return;
      if (/logo|icon|sprite|banner|btn|button|\/ads?[\/_-]|profile|avatar|blank|pixel|emoticon/i.test(u)) return;
      if (found.some((f) => f.url === u)) return;
      found.push({ url: u, caption: decode(String(caption || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 120) });
    } catch { /* 잘못된 주소는 무시 */ }
  };
  const og = rawHtml.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
    || rawHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (og) add(og[1]);
  const body = rawHtml.match(/<article[\s\S]*?<\/article>/i)?.[0] || rawHtml;
  for (const m of body.matchAll(/<figure[\s\S]*?<\/figure>/gi)) {
    const img = m[0].match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i);
    const cap = m[0].match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
    if (img) add(img[1], cap ? cap[1] : "");
  }
  return found.slice(0, 3);
}

// 기사 본문에서 문단 텍스트와 사진 주소를 뽑는다 (본문은 사실 확인용 참고 자료. 실패하면 제목만 쓴다)
async function fetchArticle(url) {
  const empty = { text: "", images: [] };
  if (!isAllowedUrl(url)) return empty;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return empty;
    const raw = await res.text();
    const images = extractImages(raw, res.url || url);
    let html = raw.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
    const article = html.match(/<article[\s\S]*?<\/article>/i);
    if (article) html = article[0];
    const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => decode(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
      .filter((p) => p.length > 30);
    return { text: paras.join("\n").slice(0, 1800), images };
  } catch {
    return empty;
  } finally {
    clearTimeout(timer);
  }
}

function buildPrompt(topic, articles) {
  const refs = articles.length
    ? articles.map((a, i) => `(${i + 1}) [${a.source || "출처 미상"}] ${a.title}\n${a.text || "(본문을 가져오지 못해 제목만 참고)"}`).join("\n\n")
    : "(참고 기사 없음 — 주제만으로 작성하되, 구체적 수치/날짜/인용은 쓰지 말 것)";
  return `너는 한국어 유튜브 쇼츠 대본 작가다. 아래 [주제]와 [참고 기사]를 바탕으로 대본을 쓰고, 그 대본을 3~5개의 "장면"으로 나눠줘.

[주제] ${topic}

[참고 기사 — 사실 확인용 자료]
${refs}

[대본 규칙]
- 전체 길이는 읽었을 때 40~50초: 공백 제외 약 200~260자
- 첫 장면 첫 문장은 후킹: 충격적 반전/의외의 사실 한 줄. "안녕하세요 여러분" 같은 인사말 금지
- 하나의 이야기만 기승전결로. 마지막 장면은 "구독과 좋아요" 정도의 아주 짧은 한 줄로 마무리
- 기사에 있는 사실만 사용하고, 기사에 없는 내용을 지어내지 말 것. 기사 문장을 그대로 베끼지 말고 자신의 말로 다시 쓸 것
- 확인되지 않은 내용은 "~로 알려져 있다", "~라고 보도됐다"처럼 표현. 실존 인물·기업에 대한 명예훼손성 표현/조롱 금지
- 다음 AI 상투어 사용 금지: ${CLICHES.join(", ")}

[장면 규칙]
- 모든 장면의 script_text를 순서대로 이어 붙이면 전체 대본이 되어야 함 (대본 문장을 빠짐없이, 겹치지 않게 배분)
- section: 장면을 한국어로 짧게 설명 (예: "후킹 (폐건물의 반전)")
- keyword: Pexels 스톡 영상 검색용 영어 단어 2~4개. 실존 인물 이름이나 한국어 고유명사는 쓰지 말고 장면의 분위기/사물/상황을 묘사
- direction: 카메라 연출 한 가지, 반드시 다음 중에서: "천천히 줌인", "줌아웃", "좌에서 우로 패닝", "우에서 좌로 패닝", "틸트업", "틸트다운" (같은 연출이 연속되지 않게)
- name: 이 콘티의 이름, 주제를 20자 이내로 요약`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다" }, 500);

  try {
    const { topic, articles } = await request.json();
    if (!topic || !String(topic).trim()) return json({ error: "주제가 필요합니다" }, 400);

    const picked = (Array.isArray(articles) ? articles : []).slice(0, 3).map((a) => ({
      title: String(a.title || "").slice(0, 200), url: String(a.url || ""), source: String(a.source || "").slice(0, 60),
    }));
    const fetched = await Promise.all(picked.map((a) => fetchArticle(a.url)));
    picked.forEach((a, i) => { a.text = fetched[i].text; a.images = fetched[i].images; });

    const requestBody = JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(String(topic).trim().slice(0, 100), picked) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            segments: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  section: { type: "STRING" },
                  script_text: { type: "STRING" },
                  keyword: { type: "STRING" },
                  direction: { type: "STRING" },
                },
                required: ["section", "script_text", "keyword", "direction"],
              },
            },
          },
          required: ["name", "segments"],
        },
      },
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
    const MAX_ATTEMPTS = 4;
    const BACKOFF_MS = [1000, 2500, 5000];
    let geminiRes, lastErrText = "", quotaExceeded = false;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      geminiRes = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: requestBody });
      if (geminiRes.ok) break;
      lastErrText = await geminiRes.text();
      if (geminiRes.status === 429 && lastErrText.includes("RESOURCE_EXHAUSTED")) { quotaExceeded = true; break; }
      const retriable = geminiRes.status === 503 || geminiRes.status >= 500;
      if (!retriable || attempt === MAX_ATTEMPTS - 1) break;
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt] ?? 5000));
    }

    if (!geminiRes.ok) {
      const message = quotaExceeded
        ? "제미나이 무료 사용량을 오늘 다 썼습니다 (하루 20회 제한). 내일 다시 시도하세요."
        : "제미나이 호출 실패 (일시적 혼잡일 수 있음, 잠시 후 다시 시도해주세요)";
      return json({ error: message, quotaExceeded, detail: lastErrText }, 502);
    }

    const data = await geminiRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return json({ error: "제미나이 응답을 이해할 수 없습니다", detail: JSON.stringify(data) }, 502);

    const parsed = JSON.parse(text);
    if (!parsed.segments || !parsed.segments.length) return json({ error: "장면이 만들어지지 않았습니다. 다시 시도해주세요" }, 502);
    parsed.usedArticles = picked.map((a) => ({ title: a.title, url: a.url, source: a.source, hadText: !!a.text }));
    // 기사에서 찾은 사진 후보 (저작권 확인은 사용자가 콘티에서 직접 한다)
    parsed.images = picked.flatMap((a) => a.images.map((img) => ({
      url: img.url, caption: img.caption, source: a.source, articleUrl: a.url, articleTitle: a.title,
    })));
    return json(parsed, 200);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
