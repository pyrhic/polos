import { fetchArticle } from "../_lib/article.js";

// Trend에서 고른 주제 + 관련 기사로 대본과 장면(콘티)을 만든다.
// 1) 구글 검색으로 배경·관점 조사  2) 기사 + 조사 자료로 대본/장면 작성 (제미나이 2회 호출, 하루 20회 무료 쿼터 공유)
const CLICHES = [
  "안녕하세요 여러분, 오늘은 ~에 대해 알아보겠습니다", "결론적으로", "다양한 이야기가 있습니다",
  "이처럼", "정리해보겠습니다", "여러분들도 알다시피",
];

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json" },
});

const CARD_SCHEMA = {
  type: "OBJECT",
  properties: { script_text: { type: "STRING" }, keyword: { type: "STRING" }, direction: { type: "STRING" } },
  required: ["script_text", "keyword", "direction"],
};

const MODEL_URL = (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`;

// 제미나이 호출: 과부하(503/5xx)는 재시도하고, 하루 무료 한도 초과(429)는 재시도 없이 구분해서 알려준다
async function callGemini(apiKey, body) {
  const MAX_ATTEMPTS = 4;
  const BACKOFF_MS = [1000, 2500, 5000];
  let res, errText = "", quotaExceeded = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    res = await fetch(MODEL_URL(apiKey), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) break;
    errText = await res.text();
    if (res.status === 429 && errText.includes("RESOURCE_EXHAUSTED")) { quotaExceeded = true; break; }
    const retriable = res.status === 503 || res.status >= 500;
    if (!retriable || attempt === MAX_ATTEMPTS - 1) break;
    await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt] ?? 5000));
  }
  if (res.ok) return { ok: true, data: await res.json() };
  return { ok: false, status: res.status, errText, quotaExceeded };
}

// 1단계: 구글 검색으로 이슈의 배경과 철학/정치/종교/역사적 관점(전문가·연구·논문의 주류 해석, 대립 의견)을 조사한다.
// (검색 도구는 JSON 구조 출력과 같이 못 쓰는 경우가 있어 조사와 작성을 두 번으로 나눈다)
async function research(apiKey, topic, articles) {
  const titles = articles.map((a) => `- [${a.source || "출처 미상"}] ${a.title}`).join("\n") || "(없음)";
  const prompt = `"${topic}"는 지금 한국에서 구글 급상승 검색어다. 관련 기사 제목:
${titles}

구글 검색으로 다음을 조사해서 한국어로 정리해줘.
1) 이 주제가 왜 지금 이슈가 되고 있는지, 핵심 배경
2) 이 이슈에 해당하는 철학적·정치적·종교적·역사적 관점이 있다면, 전문가·연구기관·학술 논문·주요 언론 논평의 주류 해석과 의견. 대립하는 의견이 있으면 양쪽 모두 (누가/어느 기관·매체가 그렇게 말했는지 함께)

규칙:
- 검색으로 실제 확인한 내용만 쓰고, 확인하지 못했으면 "확인된 자료 없음"이라고 쓸 것. 추측·창작 금지
- 해당하지 않는 관점은 쓰지 말 것 (예: 단순 연예 이슈에 철학적 관점을 억지로 만들지 말 것)
- 정치적으로 민감하면 어느 한쪽 편을 들지 말고 각 입장을 있는 그대로 전달
- 간결한 불릿으로`;
  const r = await callGemini(apiKey, { contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] });
  if (!r.ok) return { ok: false, quotaExceeded: r.quotaExceeded, text: "", sources: [] };
  const cand = r.data.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || "").join("").trim();
  const seen = new Set();
  const sources = [];
  for (const c of cand?.groundingMetadata?.groundingChunks || []) {
    const uri = c.web?.uri;
    if (uri && !seen.has(uri)) { seen.add(uri); sources.push({ title: c.web.title || "", url: uri }); }
  }
  return { ok: !!text, text, sources: sources.slice(0, 5) };
}

const researchUsable = (text) => !!text && !/확인된 자료 없음\s*$/.test(text.trim());

function buildPrompt(topic, articles, researchText, note, traffic) {
  const refs = articles.length
    ? articles.map((a, i) => `(${i + 1}) [${a.source || "출처 미상"}] ${a.title}\n${a.text || "(본문을 가져오지 못해 제목만 참고)"}`).join("\n\n")
    : "(참고 기사 없음 — 주제만으로 작성하되, 구체적 수치/날짜/인용은 쓰지 말 것)";
  const hasResearch = researchUsable(researchText);
  return `너는 한국어 유튜브 정보 채널의 대본 작가다. 이 채널은 "지금 인기 검색어가 왜 이슈인지"를 차분하고 균형 있게 설명한다. 자극적인 후킹, 과장, 인사말("안녕하세요 여러분")은 쓰지 않는다.

[주제] ${topic}
[트렌드 정보] 구글 급상승 검색어${traffic ? ` (검색량 ${traffic})` : ""}

[참고 기사 — 이 기사들에 실린 내용이 중심 자료다]
${refs}

[검색으로 조사한 배경·관점 자료]
${hasResearch ? researchText : "(조사 자료 없음 — 관점 정리 장면은 만들지 말 것)"}
${note ? `\n[작성자 방향 메모 — 반드시 반영]\n${note}\n` : ""}
[대본 구조 — 카드(장면)를 아래 구분으로 나눠서 쓴다. 카드 하나는 1~3문장, 공백 제외 약 60~130자이고, 카드마다 서로 다른 내용(한 가지 사실·측면)만 담는다]
- trend_summary (1~2장): "지금 '${topic}'가 급상승 검색어입니다"처럼 시작해, 기사들이 전한 핵심을 요약한다. "○○ 보도에 따르면"처럼 기사가 보도한 내용임을 밝힌다
- issue (3~6장, 반드시 3장 이상): 이 사건/이슈가 무엇이고 왜 지금 화제인지를 카드마다 한 측면씩 나눠 설명한다. 예) 무슨 일이 있었나 → 관련된 사람·기관과 경과 → 구체적 수치·발언·날짜 → 쟁점이나 논란 → 앞으로의 계획·일정·방향(기사에 있으면 반드시). 같은 내용을 반복하거나 말을 늘려 채우지 말고, 기사에 정보가 모자라면 조사 자료에서 확인된 사실로 보충한다
- perspectives (${hasResearch ? "1~3장" : "0장 — 조사 자료가 없으니 빈 배열"}): 철학·정치·종교·역사 등 해당되는 관점에서 전문가·연구의 주류 해석을 전하고, 대립하는 의견이 있으면 양쪽 모두 각각 누구(기관·매체)의 의견인지 밝혀 균형 있게 전한다. 해당 없는 관점은 억지로 만들지 않는다
- closing (정확히 1장): 위 내용을 한두 문장으로 정리하고 시청자가 생각해볼 질문 하나로 끝낸다. 마지막에 "구독과 좋아요" 한 줄
(작성자가 직접 쓸 "내 의견" 카드는 시스템이 따로 넣으니 만들지 않는다)

[대본 규칙]
- 사실은 기사와 조사 자료에 있는 것만 쓴다. 기사에 있는 구체적 정보(이름·날짜·장소·수치·발언)는 빠뜨리지 말고 담는다. 내용은 기사에 충실하게, 문장은 기사 문장을 그대로 복사하지 않고 새로 쓴다
- 정치적으로 민감한 내용은 편향 없이: 당사자의 주장은 "~라고 주장했다/밝혔다"로 출처와 함께 전하고, 평가·형용사·추측을 붙이지 않으며, 서로 다른 주장은 균형 있게 다룬다
- 확인되지 않은 내용은 "~라고 보도됐다"로 표현. 실존 인물·기업에 대한 명예훼손성 표현/조롱 금지
- 다음 AI 상투어 사용 금지: ${CLICHES.join(", ")}
- 분량: 전체 카드 합쳐 공백 제외 약 600~900자

[카드 규칙]
- 카드의 script_text를 구분 순서대로(trend_summary → issue → perspectives → closing) 이어 붙이면 전체 대본이 되어야 함
- keyword: Pexels 스톡 영상 검색용 영어 단어 2~4개. 실존 인물 이름이나 한국어 고유명사는 쓰지 말고 카드 내용의 분위기/사물/상황을 묘사. 카드마다 다르게
- direction: 카메라 연출 한 가지, 반드시 다음 중에서: "천천히 줌인", "줌아웃", "좌에서 우로 패닝", "우에서 좌로 패닝", "틸트업", "틸트다운" (같은 연출이 연속되지 않게)
- name: 이 콘티의 이름, 주제를 20자 이내로 요약`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다" }, 500);

  try {
    const { topic, articles, note, traffic } = await request.json();
    if (!topic || !String(topic).trim()) return json({ error: "주제가 필요합니다" }, 400);
    const cleanTopic = String(topic).trim().slice(0, 100);

    const picked = (Array.isArray(articles) ? articles : []).slice(0, 3).map((a) => ({
      title: String(a.title || "").slice(0, 200), url: String(a.url || ""), source: String(a.source || "").slice(0, 60),
    }));
    const fetched = await Promise.all(picked.map((a) => fetchArticle(a.url)));
    picked.forEach((a, i) => { a.text = fetched[i].text; a.media = [...fetched[i].images, ...fetched[i].videos]; a.embeds = fetched[i].embeds; });

    const researched = await research(apiKey, cleanTopic, picked);
    if (!researched.ok && researched.quotaExceeded) {
      return json({ error: "제미나이 무료 사용량을 오늘 다 썼습니다 (하루 20회 제한). 내일 다시 시도하세요.", quotaExceeded: true }, 502);
    }

    const written = await callGemini(apiKey, {
      contents: [{ parts: [{ text: buildPrompt(cleanTopic, picked, researched.text, String(note || "").trim().slice(0, 300), String(traffic || "").slice(0, 20)) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            trend_summary: { type: "ARRAY", minItems: 1, maxItems: 2, items: CARD_SCHEMA },
            issue: { type: "ARRAY", minItems: 3, maxItems: 6, items: CARD_SCHEMA },
            perspectives: { type: "ARRAY", maxItems: 3, items: CARD_SCHEMA },
            closing: { type: "ARRAY", minItems: 1, maxItems: 1, items: CARD_SCHEMA },
          },
          required: ["name", "trend_summary", "issue", "perspectives", "closing"],
        },
      },
    });

    if (!written.ok) {
      const message = written.quotaExceeded
        ? "제미나이 무료 사용량을 오늘 다 썼습니다 (하루 20회 제한). 내일 다시 시도하세요."
        : "제미나이 호출 실패 (일시적 혼잡일 수 있음, 잠시 후 다시 시도해주세요)";
      return json({ error: message, quotaExceeded: written.quotaExceeded, detail: written.errText }, 502);
    }

    const text = written.data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return json({ error: "제미나이 응답을 이해할 수 없습니다", detail: JSON.stringify(written.data) }, 502);

    const parsed = JSON.parse(text);
    const usePerspectives = researchUsable(researched.text);
    const card = (part) => (c) => ({ section: part, script_text: String(c.script_text || "").trim(), keyword: c.keyword || "", direction: c.direction || "" });
    parsed.segments = [
      ...(parsed.trend_summary || []).map(card("트렌드 요약")),
      ...(parsed.issue || []).map(card("이슈 설명")),
      ...(usePerspectives ? (parsed.perspectives || []).map(card("관점 정리")) : []),
      // 작성자가 직접 쓸 자리: 항상 빈 대사로 넣는다
      { section: "내 의견", script_text: "", keyword: "person thinking window", direction: "천천히 줌인" },
      ...(parsed.closing || []).map(card("마무리")),
    ];
    if (parsed.segments.filter((c) => c.script_text).length < 4) return json({ error: "대본이 충분히 만들어지지 않았습니다. 다시 시도해주세요" }, 502);
    delete parsed.trend_summary; delete parsed.issue; delete parsed.perspectives; delete parsed.closing;

    parsed.usedArticles = picked.map((a) => ({ title: a.title, url: a.url, source: a.source, hadText: !!a.text }));
    parsed.research = { ok: researched.ok, sources: researched.sources };
    // 기사에서 찾은 사진 후보 (저작권 확인은 사용자가 콘티에서 직접 한다)
    parsed.images = picked.flatMap((a) => a.media.map((m) => ({
      type: m.type, url: m.url, caption: m.caption, source: a.source, articleUrl: a.url, articleTitle: a.title,
    })));
    // 유튜브 등 외부 플레이어 영상은 내려받지 않고 링크만 알려준다
    parsed.embeds = picked.flatMap((a) => a.embeds.map((link) => ({ link, source: a.source, articleUrl: a.url })));
    return json(parsed, 200);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
