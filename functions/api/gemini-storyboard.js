// 승인된 대본을 제미나이로 3~5개 장면 구간으로 나누고, 구간마다 Pexels 영어 검색
// 키워드를 뽑아준다 (콘티 페이지의 "콘티 다시 생성"에서 사용). gemini-draft.js와 같은 쿼터(하루 20회)를 공유한다.
function buildPrompt(category, hook, story, closing, mood, moodNote) {
  const body = `${hook}\n\n${story}\n\n${closing || ""}`.trim();
  const moodLines = [mood ? `[영상 분위기] ${mood}` : "", moodNote ? `[분위기 메모] ${moodNote}` : ""]
    .filter(Boolean).join("\n");
  return `아래는 한국어 유튜브 쇼츠 대본이다. 이 대본을 읽고, Pexels(스톡 영상 사이트)에서
배경 영상을 찾기 위한 3~5개의 "장면 구간"으로 나눠줘.

[카테고리] ${category}
${moodLines}

[대본]
${body}

[규칙]
- 각 구간의 direction은 그 장면의 카메라 연출 지시를 짧게 한 가지로, 반드시 다음 중에서 고를 것: "천천히 줌인", "줌아웃", "좌에서 우로 패닝", "우에서 좌로 패닝", "틸트업", "틸트다운" (분위기에 어울리게 고르고, 같은 연출이 연속되지 않게)
- 대본 전체 문장을 빠짐없이, 겹치지 않게 구간들에 나눠 담을 것 (이어 붙이면 원래 대본과 똑같아야 함)
- 각 구간의 script_text는 그 구간에 해당하는 대본 원문을 한 글자도 바꾸지 말고 그대로 가져올 것
- 각 구간의 section은 한국어로 짧게 (예: "후킹 (숨겨진 과거)")
- 각 구간의 keyword는 Pexels 검색에 쓸 영어 단어 2~4개 (예: "vintage old photograph")
- 실존 인물 이름이나 한국어 고유명사를 keyword에 쓰지 말 것 — 장면의 분위기/사물/상황을 묘사하는 일반 영어 단어로
- segments 배열로만 응답`;
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
    const { category, hook, story, closing, mood, moodNote } = body;
    if (!category || !hook || !story) {
      return new Response(JSON.stringify({ error: "category, hook, story가 필요합니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const requestBody = JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(category, hook, story, closing, mood, moodNote) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
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
          required: ["segments"],
        },
      },
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
    const MAX_ATTEMPTS = 4;
    const BACKOFF_MS = [1000, 2500, 5000];
    let geminiRes, lastErrText = "", quotaExceeded = false;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      geminiRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });
      if (geminiRes.ok) break;
      lastErrText = await geminiRes.text();

      if (geminiRes.status === 429 && lastErrText.includes("RESOURCE_EXHAUSTED")) {
        quotaExceeded = true;
        break;
      }
      const retriable = geminiRes.status === 503 || geminiRes.status >= 500;
      if (!retriable || attempt === MAX_ATTEMPTS - 1) break;
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt] ?? 5000));
    }

    if (!geminiRes.ok) {
      const message = quotaExceeded
        ? "제미나이 무료 사용량을 오늘 다 썼습니다 (하루 20회 제한). 내일 다시 시도하거나, 콘티 페이지에서 구간을 직접 입력하세요."
        : "제미나이 호출 실패 (일시적 혼잡일 수 있음, 잠시 후 다시 시도해주세요)";
      return new Response(JSON.stringify({ error: message, quotaExceeded, detail: lastErrText }), {
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
