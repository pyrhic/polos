// 위키피디아 인물 문서를 읽고, 영상 한 편이 될 만한 "이야기 후보"를 뽑아준다.
// POST /api/wiki-ideas  { lang: "ko"|"en", title }
import { getArticle } from "../_lib/wiki.js";
import { callGemini } from "../_lib/gemini.js";

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json" },
});

// 소재 종류별 안내: 인물 / 사건 / 지식
const KIND_LABEL = { person: "한 인물", event: "한 사건", thing: "한 가지 지식(개념·사물·장소 등)" };
const KIND_IDEAS_GUIDE = {
  person: `좋은 후보의 조건:
- 잘 알려진 약력 요약이 아니라 "이런 일이 있었다니" 싶은 일화, 전환점, 의외의 사실, 반전, 인간적인 면
- 사망한 인물만 다룬다. 논란이 있는 부분은 사실만 담담하게, 평가·조롱 없이`,
  event: `좋은 후보의 조건:
- 사건의 단순 연표가 아니라, 배경의 의외의 사실, 결정적인 순간, 뜻밖의 인물이나 우연, 여파와 결과, 흔히 오해되는 부분
- 사건의 원인과 결과를 잇는 이야기, 당시 사람들이 몰랐던 것, 이후 세상이 어떻게 바뀌었는지
- 사망자 수·날짜·장소는 문서 그대로. 해석이 갈리는 부분은 "~라는 해석도 있다"로 균형 있게, 어느 한쪽 편을 들지 않는다`,
  thing: `좋은 후보의 조건:
- 정의를 읊는 설명이 아니라 "이게 이런 거였어?" 싶은 의외의 원리, 발견·발명의 뒷이야기, 흔한 오해 바로잡기, 일상과의 연결
- 처음 듣는 사람도 이해하도록 쉬운 말로 풀 수 있는 것
- 어려운 용어는 한 번에 하나씩, 비유는 사실을 바꾸지 않는 선에서`,
};

export async function onRequestPost(context) {
  const apiKey = context.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다" }, 500);
  try {
    const body = await context.request.json();
    const { lang, title } = body;
    if (!["ko", "en"].includes(lang) || !title) return json({ error: "lang, title이 필요합니다" }, 400);

    const main = await getArticle(lang, String(title), 14000);
    if (!main || !main.text) return json({ error: "문서를 읽지 못했습니다" }, 404);
    // 다른 언어판이 있으면 함께 읽어 이야기를 더 풍부하게 한다 (영어판에만 있는 일화가 많다)
    let second = null;
    if (main.otherTitle) { try { second = await getArticle(main.otherLang, main.otherTitle, 8000); } catch { /* 한 언어만으로 진행 */ } }

    const kind = ["person", "event", "thing"].includes(body.kind) ? body.kind : "person";
    const prompt = `너는 한국어 유튜브 채널 "Wicked Wiki"의 작가다. 이 채널은 위키피디아에서 신선하고 재미있는 이야기를 골라, 차분하지만 흥미롭게 들려준다.
아래는 ${KIND_LABEL[kind]}의 위키피디아 문서다. 이 문서에서 **영상 한 편(1~3분)이 될 만한 서로 다른 이야기 후보 4~6개**를 뽑아라.

${KIND_IDEAS_GUIDE[kind]}

공통 조건:
- 문서에 실제로 적힌 내용만 근거로 삼는다 (없는 내용을 지어내지 말 것)
- 후보끼리 겹치지 않게, 시기나 주제가 다르게
- 생존 인물이 얽힌 부분은 사실만 담담하게, 평가·조롱·추측 없이

각 후보 필드:
- title: 영상 주제를 한 줄로, 25자 이내, 낚시성 과장 금지
- hook: 시청자가 궁금해할 첫 문장 1개 (40자 이내)
- facts: 이 이야기에 쓸 문서 속 핵심 사실 3~5개 (날짜·이름·숫자는 문서 그대로)

또한 person에 주제의 한국어 이름(name_ko)과 한 줄 소개(one_line, 30자 이내)를 적어라.

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
