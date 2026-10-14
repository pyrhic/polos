// Pexels에서 고른 사진들에 붙일 한국어 이름과 한 줄 설명을 만든다 (영상의 사진 밑 자막으로 나온다).
// POST /api/gemini-photo-captions  { theme, photos: [{ alt }] }  ->  { items: [{ name, comment }] }  (photos와 같은 순서·같은 개수)
import { callGemini } from "../_lib/gemini.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export async function onRequestPost(context) {
  const apiKey = context.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다" }, 500);
  try {
    const body = await context.request.json();
    const theme = String(body.theme || "").trim().slice(0, 100);
    const photos = (Array.isArray(body.photos) ? body.photos : []).slice(0, 30).map((p) => String((p && p.alt) || "").slice(0, 200));
    if (!photos.length) return json({ error: "사진 정보가 없습니다" }, 400);

    const prompt = `너는 사진 소개 채널 "OUTSTAGRAM"의 작가다. 아래 사진들 각각에 영상 자막으로 쓸 한국어 이름과 한 줄 설명을 붙여라.
주제: ${theme || "(없음)"}

사진 목록 (번호: 사진 설명(영어, 없을 수 있음)):
${photos.map((a, i) => `${i + 1}: ${a || "(설명 없음)"}`).join("\n")}

규칙:
- 사진 설명에 적힌 내용만 근거로 삼는다. 설명에 없는 지명·나라·인물·사건을 지어내지 않는다. 장소가 분명히 적혀 있을 때만 "지명, 나라" 형태로 쓰고, 아니면 장면의 분위기를 담은 이름을 쓴다.
- name: 사진의 이름 (한국어, 20자 이내)
- comment: 사진을 소개하는 감성적인 한 줄 (한국어, 35자 이내, 구체적이고 담백하게. 과장·광고 문구·물음표·느낌표 금지)
- 항목은 사진 번호 순서대로, 사진 수와 같은 개수로 쓴다.`;

    const r = await callGemini(apiKey, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            items: {
              type: "ARRAY", minItems: photos.length, maxItems: photos.length,
              items: { type: "OBJECT", properties: { name: { type: "STRING" }, comment: { type: "STRING" } }, required: ["name", "comment"] },
            },
          },
          required: ["items"],
        },
      },
    });
    if (!r.ok) return json({ error: r.message, quotaExceeded: r.quotaExceeded }, 502);
    const text = r.data.candidates?.[0]?.content?.parts?.[0]?.text;
    let parsed;
    try { parsed = JSON.parse(text); } catch { return json({ error: "제미나이 응답을 해석하지 못했습니다. 다시 시도해주세요" }, 502); }
    const clean = (s, n) => String(s || "").replace(/[?!？！]/g, "").trim().slice(0, n);
    const items = (parsed.items || []).slice(0, photos.length).map((i) => ({ name: clean(i.name, 24), comment: clean(i.comment, 40) }));
    while (items.length < photos.length) items.push({ name: "", comment: "" });
    return json({ items }, 200);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
