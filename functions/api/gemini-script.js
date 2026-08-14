// 제미나이(Gemini) API로 쇼츠 대본 초안(후킹/스토리/클로징)을 생성한다.
const CLICHES = [
  "안녕하세요 여러분, 오늘은 ~에 대해 알아보겠습니다", "결론적으로", "다양한 이야기가 있습니다",
  "이처럼", "정리해보겠습니다", "여러분들도 알다시피",
];

function buildPrompt(category, topic, isConspiracy) {
  return `아래 조건에 맞춰 한국어 유튜브 쇼츠 대본을 써줘.

[카테고리] ${category}
[주제] ${topic}

[형식 — 반드시 지킬 것]
- 유튜브 쇼츠, 전체 40~50초 분량
- 후킹(0~2초): 충격적 반전/의외의 사실 한 줄. "안녕하세요 여러분" 같은 인사말 금지
- 스토리(2~40초): 기승전결로 하나의 이야기만, 여러 일화 나열 금지. 클라이맥스에서 끝나도 됨
- 클로징: "구독과 좋아요 눌러주세요" 정도로 아주 짧게 한 줄만

[금지 사항]
- 확인 안 된 사실을 단정적으로 서술하지 말 것 — 구체적 수치/연도/인용문은 "~로 알려져 있다", "~라고 전해진다" 식으로 표현
- 실존 인물·기업에 대한 명예훼손성 표현이나 조롱 금지
- 다음 AI 상투어 사용 금지: ${CLICHES.join(", ")}
${isConspiracy ? '- 이 주제는 음모론/미검증설이다. 반드시 "~라는 설이 있다/논란이 있다"로 사실과 구분하고, 가능하면 반박 시각도 한 문장 넣을 것' : ""}

hook, story, closing 세 개 필드로만 응답해줘.`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await request.json();
    const { category, topic, isConspiracy } = body;
    if (!category || !topic) {
      return new Response(JSON.stringify({ error: "category, topic이 필요합니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(category, topic, isConspiracy) }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                hook: { type: "STRING" },
                story: { type: "STRING" },
                closing: { type: "STRING" },
              },
              required: ["hook", "story", "closing"],
            },
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      return new Response(JSON.stringify({ error: "제미나이 호출 실패", detail: await geminiRes.text() }), {
        status: 502, headers: { "Content-Type": "application/json" },
      });
    }

    const data = await geminiRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return new Response(JSON.stringify({ error: "제미나이 응답을 이해할 수 없습니다", detail: JSON.stringify(data) }), {
        status: 502, headers: { "Content-Type": "application/json" },
      });
    }

    const parsed = JSON.parse(text);
    return new Response(JSON.stringify(parsed), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
