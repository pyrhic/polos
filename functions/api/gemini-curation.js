// 큐레이션 영상의 구성안을 만든다: 제목/주제와 개수를 받아 항목(이름, 선정 이유 메모, Pexels 사진 검색어)을 제안한다.
// 제미나이 호출은 1번. 구성안은 초안일 뿐이고, 사용자가 항목을 고르고 고치는 것이 큐레이션의 핵심이다.
import { callGemini } from "../_lib/gemini.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

function buildPrompt(title, count, note) {
  return `너는 사진 큐레이션 영상 기획자다. 주제에 맞는 사진 ${count}장을 고르기 위한 항목 ${count}개를 제안해라.

[주제/제목] ${title}
${note ? `[작성자 요청] ${note}\n` : ""}
[규칙]
- 항목은 서로 겹치지 않는 ${count}개. 같은 장소/대상을 다른 이름으로 반복하지 않는다.
- 실제로 존재하는 장소·대상·상황만 쓰고, 없는 사실을 만들지 않는다 (장소라면 실제 지명).
- 무료 스톡 사진 사이트(Pexels)에서 찾을 수 있는 풍경·장면이어야 한다. 특정 상표·유명인·작품(캐릭터)이 필요한 항목은 쓰지 않는다.
- name: 항목 이름 (한국어, 20자 이내. 장소면 "지명, 나라" 형태)
- comment: 이 항목을 고른 이유 한 줄 (한국어, 40자 이내, 개성 있고 구체적으로. 영상에는 표시되지 않는 메모다)
- keyword: Pexels 사진 검색어 (영어 3~6단어, 구체적으로. 예: "Maldives overwater bungalow turquoise lagoon")
- title: 영상 첫 화면에 보여줄 제목. 입력 제목이 이미 좋으면 그대로 두고, 개수에 맞게 다듬는다 (한국어, 28자 이내)
- 시청자가 끝까지 넘겨 보고 싶어지도록 순서를 구성한다 (가장 인상적인 항목을 끝이나 앞에 배치).`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다" }, 500);
  try {
    const body = await request.json();
    const title = String(body.title || "").trim().slice(0, 100);
    if (!title) return json({ error: "주제(제목)를 입력하세요" }, 400);
    const count = Math.max(3, Math.min(30, Number(body.count) || 10));
    const r = await callGemini(apiKey, {
      contents: [{ parts: [{ text: buildPrompt(title, count, String(body.note || "").trim().slice(0, 300)) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING" },
            items: {
              type: "ARRAY", minItems: Math.min(count, 3), maxItems: count,
              items: { type: "OBJECT", properties: { name: { type: "STRING" }, comment: { type: "STRING" }, keyword: { type: "STRING" } }, required: ["name", "comment", "keyword"] },
            },
          },
          required: ["title", "items"],
        },
      },
    });
    if (!r.ok) {
      const message = r.message;
      return json({ error: message, quotaExceeded: r.quotaExceeded, detail: r.errText }, 502);
    }
    const text = r.data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return json({ error: "제미나이 응답을 이해할 수 없습니다" }, 502);
    const parsed = JSON.parse(text);
    const items = (parsed.items || []).filter((i) => i.name && i.keyword).slice(0, count);
    if (!items.length) return json({ error: "항목이 만들어지지 않았습니다. 다시 시도해주세요" }, 502);
    return json({ title: String(parsed.title || title).slice(0, 60), items }, 200);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
