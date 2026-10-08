// 롱폼 영상의 대사(번호/시각/문장)를 읽고 쇼츠로 만들 핵심 구간 후보를 제안한다.
// 내 PC의 longform 도구(youtube-automation/longform)가 호출한다. 제미나이 호출은 영상 하나에 1번.
import { callGemini } from "../_lib/gemini.js";

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json" },
});

function buildPrompt({ name, lines, maxShorts, minSec, maxSec, note }) {
  const text = lines.map((l) => `[${l.i}] ${l.t} ${l.text}`).join("\n");
  return `너는 유튜브 쇼츠 편집자다. 아래는 긴 영상 "${name || "(제목 없음)"}"의 대사다. 각 줄은 [번호] 시각 대사 형식이다.
이 대사를 읽고, 쇼츠 하나로 독립해서 볼 만한 핵심 구간을 최대 ${maxShorts}개 골라라.

[규칙]
- 구간은 연속된 줄 번호 범위(start_index~end_index)다. 모든 번호는 아래 대사에 실제로 있는 번호만 쓴다.
- 구간 길이는 ${minSec}~${maxSec}초가 되게 한다 (줄의 시각을 보고 계산).
- 서로 겹치면 안 되고, 서로 다른 주제여야 한다. 억지로 개수를 채우지 말고 좋은 구간이 적으면 적게 준다.
- 첫 줄은 앞 맥락 없이도 이해되고 흥미를 끌어야 한다. "그래서", "이게", "그런데"처럼 앞 내용을 가리키는 말로 시작하는 줄은 피한다.
- 마지막 줄은 이야기가 완결되는 문장이어야 한다. 말이 중간에 끊기면 안 된다.
- title: 쇼츠 제목, 20자 이내. 대사에 있는 내용만 쓰고 과장이나 없는 사실을 만들지 않는다.
- hook: 화면 위쪽에 크게 넣을 한 줄, 15자 안팎.
- reason: 이 구간을 고른 이유 한 줄.
- 결과는 영상 시간순으로 정렬한다.
${note ? `\n[작성자 요청]\n${note}\n` : ""}
[대사]
${text}`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다" }, 500);

  try {
    const body = await request.json();
    const lines = (Array.isArray(body.lines) ? body.lines : []).filter((l) => l && Number.isInteger(l.i) && l.text);
    if (lines.length < 3) return json({ error: "대사가 너무 적습니다" }, 400);
    if (lines.length > 4000) return json({ error: "대사가 너무 깁니다 (4000줄 이하)" }, 400);
    const maxShorts = Math.max(1, Math.min(10, Number(body.maxShorts) || 5));
    const minSec = Math.max(10, Number(body.minSec) || 25);
    const maxSec = Math.max(minSec + 5, Math.min(120, Number(body.maxSec) || 60));
    const valid = new Set(lines.map((l) => l.i));

    const r = await callGemini(apiKey, {
      contents: [{ parts: [{ text: buildPrompt({ name: String(body.name || "").slice(0, 100), lines, maxShorts, minSec, maxSec, note: String(body.note || "").slice(0, 300) }) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            shorts: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  start_index: { type: "INTEGER" },
                  end_index: { type: "INTEGER" },
                  title: { type: "STRING" },
                  hook: { type: "STRING" },
                  reason: { type: "STRING" },
                },
                required: ["start_index", "end_index", "title", "hook", "reason"],
              },
            },
          },
          required: ["shorts"],
        },
      },
    });
    if (!r.ok) {
      const message = r.quotaExceeded
        ? "제미나이 무료 사용량을 오늘 다 썼습니다 (하루 20회 제한). 내일 다시 시도하세요."
        : "제미나이 호출 실패 (일시적 혼잡일 수 있음, 잠시 후 다시 시도해주세요)";
      return json({ error: message, quotaExceeded: r.quotaExceeded, detail: r.errText }, 502);
    }
    const text = r.data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return json({ error: "제미나이 응답을 이해할 수 없습니다" }, 502);
    const parsed = JSON.parse(text);

    // 실제 있는 번호만, 앞뒤가 뒤집힌 건 바로잡고, 겹치는 구간은 앞의 것을 남긴다
    const shorts = [];
    let lastEnd = -1;
    for (const s of (parsed.shorts || []).sort((a, b) => a.start_index - b.start_index)) {
      let a = s.start_index, b = s.end_index;
      if (a > b) [a, b] = [b, a];
      if (!valid.has(a) || !valid.has(b) || a <= lastEnd) continue;
      shorts.push({ start_index: a, end_index: b, title: String(s.title || "").slice(0, 40), hook: String(s.hook || "").slice(0, 40), reason: String(s.reason || "").slice(0, 200) });
      lastEnd = b;
    }
    if (!shorts.length) return json({ error: "쓸 만한 구간이 만들어지지 않았습니다. 다시 시도해주세요" }, 502);
    return json({ shorts: shorts.slice(0, maxShorts) }, 200);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
