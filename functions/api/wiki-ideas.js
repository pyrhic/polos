// 위키피디아 인물 문서를 읽고, 영상 한 편이 될 만한 "이야기 후보"를 뽑아준다.
// POST /api/wiki-ideas  { lang: "ko"|"en", title }
import { getArticle } from "../_lib/wiki.js";
import { callGemini } from "../_lib/gemini.js";

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json" },
});

export async function onRequestPost(context) {
  const apiKey = context.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다" }, 500);
  try {
    const { lang, title } = await context.request.json();
    if (!["ko", "en"].includes(lang) || !title) return json({ error: "lang, title이 필요합니다" }, 400);

    const main = await getArticle(lang, String(title), 14000);
    if (!main || !main.text) return json({ error: "문서를 읽지 못했습니다" }, 404);
    // 다른 언어판이 있으면 함께 읽어 이야기를 더 풍부하게 한다 (영어판에만 있는 일화가 많다)
    let second = null;
    if (main.otherTitle) { try { second = await getArticle(main.otherLang, main.otherTitle, 8000); } catch { /* 한 언어만으로 진행 */ } }

    const prompt = `너는 한국어 유튜브 채널 "Wicked Wiki"의 작가다. 이 채널은 위키피디아에서 신선하고 재미있는 인물 이야기를 골라, 차분하지만 흥미롭게 들려준다.
아래는 한 인물의 위키피디아 문서다. 이 문서에서 **영상 한 편(1~3분)이 될 만한 서로 다른 이야기 후보 4~6개**를 뽑아라.

좋은 후보의 조건:
- 잘 알려진 약력 요약이 아니라 "이런 일이 있었다니" 싶은 일화, 전환점, 의외의 사실, 반전, 인간적인 면
- 문서에 실제로 적힌 내용만 근거로 삼는다 (없는 일화를 지어내지 말 것)
- 후보끼리 겹치지 않게, 시기나 주제가 다르게
- 사망한 인물만 다룬다. 논란이 있는 부분은 사실만 담담하게, 평가·조롱 없이

각 후보 필드:
- title: 영상 주제를 한 줄로 (예: "노벨상 두 번, 그러나 ○○은 거절당했다") 25자 이내, 낚시성 과장 금지
- hook: 시청자가 궁금해할 첫 문장 1개 (40자 이내)
- facts: 이 이야기에 쓸 문서 속 핵심 사실 3~5개 (날짜·이름·숫자는 문서 그대로)

또한 person에 한국어 이름(name_ko)과 한 줄 소개(one_line, 30자 이내)를 적어라.

[문서 1: ${main.lang === "ko" ? "한국어" : "영어"} 위키피디아 「${main.title}」]
${main.text}
${second ? `\n[문서 2: ${second.lang === "ko" ? "한국어" : "영어"} 위키피디아 「${second.title}」 — 보충 자료]\n${second.text}\n` : ""}`;

    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            person: { type: "OBJECT", properties: { name_ko: { type: "STRING" }, one_line: { type: "STRING" } }, required: ["name_ko", "one_line"] },
            ideas: {
              type: "ARRAY", minItems: 3, maxItems: 6,
              items: {
                type: "OBJECT",
                properties: { title: { type: "STRING" }, hook: { type: "STRING" }, facts: { type: "ARRAY", items: { type: "STRING" } } },
                required: ["title", "hook", "facts"],
              },
            },
          },
          required: ["person", "ideas"],
        },
      },
    };
    const r = await callGemini(apiKey, requestBody);
    if (!r.ok) return json({ error: r.message, quotaExceeded: r.quotaExceeded }, 502);
    const text = r.data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
    let parsed;
    try { parsed = JSON.parse(text); } catch { return json({ error: "제미나이 응답을 해석하지 못했습니다. 다시 시도해주세요" }, 502); }
    return json({
      person: parsed.person, ideas: parsed.ideas || [],
      article: { lang: main.lang, title: main.title, url: main.url, otherLang: second ? second.lang : null, otherTitle: second ? second.title : null, otherUrl: second ? second.url : null },
    }, 200);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
