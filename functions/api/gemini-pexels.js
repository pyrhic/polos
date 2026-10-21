// Pexels 슬라이드쇼의 기획을 AI가 한다: 주제를 받아 제목(후킹)과 항목(이름·설명 자막, 선정 이유, Pexels 사진 검색어)을 만든다.
// 사용자는 첨삭·피드백하고 결재만 한다. 제미나이 하루 한도가 작아서 모드마다 호출은 딱 1번.
// POST /api/gemini-pexels
//   { mode: "plan",    topic, count, note }                                        -> { title, items: [item × count] }
//   { mode: "revise",  topic, note, title, feedback, count, keep: [{name, keyword}], previous: [{name, keyword, desc}] }
//                                                                                   -> { title, items: [item × count] }  (keep은 그대로 두는 항목이라 결과에 넣지 않는다)
//   { mode: "replace", topic, note, title, feedback, others: [name], target: {name, keyword, desc} } -> { item }
//   item = { name, desc, why, keyword }   name·desc는 영상 사진 밑 자막, why는 화면에만 보이는 메모
import { callGemini } from "../_lib/gemini.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
const str = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

const RULES = `[규칙]
- 실제로 존재하는 장소·대상만 쓴다. 장소라면 실제 지명. 확인되지 않은 사실, 지어낸 숫자·기록·전설을 쓰지 않는다. 널리 알려진 사실만 쓰고, 확실하지 않으면 사실 대신 눈에 보이는 모습을 묘사한다.
- 항목끼리 겹치지 않게 다양하게 고른다 (같은 장소를 다른 이름으로 반복 금지, 한 나라·한 종류에 몰리지 않게. 작성자 요청이 있으면 그 안에서 다양하게).
- 무료 스톡 사진 사이트(Pexels)에 사진이 있을 만한 풍경·장면이어야 한다. 특정 상표·유명인·작품(캐릭터)이 필요한 항목은 쓰지 않는다.
- name: 영상 자막에 나오는 이름 (한국어, 20자 이내. 장소면 "지명, 나라" 형태. 예: "살라르 데 우유니, 볼리비아")
- desc: 사진 밑에 나오는 한 줄 설명 (한국어, 35자 이내, 사실에 근거해 담백하고 구체적으로. 과장·광고 문구·물음표·느낌표 금지)
- why: 이 항목을 고른 이유 메모 (한국어, 40자 이내. 영상에는 안 나온다)
- keyword: Pexels 사진 검색어 (영어 3~6단어. 지명 + 보이는 모습을 구체적으로. 예: "Salar de Uyuni salt flat reflection"). 장소·사물 주제라면 사람이 주인공인 사진이 나오지 않게 풍경·건물·자연을 가리키는 단어를 쓴다 (person, woman, man, people, portrait 같은 단어 금지).`;
const TITLE_RULE = `- title: 영상 첫 화면 제목. 끝까지 보고 싶게 만드는 후킹이되 내용과 맞고 과장 없이 정직하게 (한국어, 28자 이내. 항목 수가 들어가면 실제 개수와 맞춘다).`;

const ITEM = { type: "OBJECT", properties: { name: { type: "STRING" }, desc: { type: "STRING" }, why: { type: "STRING" }, keyword: { type: "STRING" } }, required: ["name", "desc", "why", "keyword"] };
const listSchema = (count) => ({
  type: "OBJECT",
  properties: { title: { type: "STRING" }, items: { type: "ARRAY", minItems: count, maxItems: count, items: ITEM } },
  required: ["title", "items"],
});

const head = (topic, note) => `너는 사진 슬라이드쇼 쇼츠 영상의 기획자다. 사용자는 기획을 검토·결재하는 편집자다.

[주제] ${topic}
${note ? `[작성자 요청] ${note}\n` : ""}`;

function planPrompt(topic, count, note) {
  return `${head(topic, note)}
주제에 맞는 항목 ${count}개(사진 한 장씩)와 제목을 기획해라.
${RULES}
${TITLE_RULE}
- 시청자가 끝까지 넘겨 보고 싶어지도록 순서를 구성한다 (가장 인상적인 항목을 맨 앞이나 맨 끝에).`;
}

function revisePrompt(b) {
  return `${head(b.topic, b.note)}
지금 기획안의 제목: ${b.title || "(없음)"}
${b.keep.length ? `[그대로 두는 항목 — 결과에 넣지 말고, 이것들과 겹치지 않게]\n${b.keep.map((k) => `- ${k.name} (${k.keyword})`).join("\n")}\n` : ""}${b.previous.length ? `[지금 바꿀 수 있는 항목들 — 피드백에 맞으면 그대로 다시 써도 된다]\n${b.previous.map((k) => `- ${k.name} (${k.keyword}): ${k.desc}`).join("\n")}\n` : ""}
[편집자 피드백] ${b.feedback || "(없음 — 더 좋게 다듬어라)"}

피드백을 반영해 새 항목 ${b.count}개와 제목을 써라. 제목은 그대로 두는 항목까지 합친 전체 영상(${b.count + b.keep.length}장)의 제목이다.
${RULES}
${TITLE_RULE}`;
}

function replacePrompt(b) {
  return `${head(b.topic, b.note)}
영상 제목: ${b.title || "(없음)"}
[다른 항목들 — 이것들과 겹치면 안 된다]
${b.others.map((n) => `- ${n}`).join("\n") || "(없음)"}

[바꿀 항목] ${b.target.name || "(빈 항목)"}${b.target.keyword ? ` (${b.target.keyword})` : ""}
[편집자 피드백] ${b.feedback || "(없음 — 주제에 더 잘 맞는 다른 항목으로)"}

이 항목 하나를 피드백에 맞는 새 항목(바꿀 항목과 다른 장소·대상)으로 바꿔라. 항목 1개만 쓴다.
${RULES}`;
}

const cleanItem = (i) => ({
  name: str(i && i.name, 30),
  desc: str(i && i.desc, 60).replace(/[?!？！]/g, ""),
  why: str(i && i.why, 60),
  keyword: str(i && i.keyword, 80),
});

export async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다" }, 500);
  try {
    const body = await request.json();
    const mode = ["plan", "revise", "replace"].includes(body.mode) ? body.mode : "plan";
    const topic = str(body.topic || body.title, 100);
    if (!topic) return json({ error: "주제를 입력하세요" }, 400);
    const note = str(body.note, 300);
    const title = str(body.title, 60);
    const feedback = str(body.feedback, 300);
    const pair = (k) => ({ name: str(k && k.name, 30), keyword: str(k && k.keyword, 80), desc: str(k && k.desc, 60) });

    let prompt, schema, count = 1;
    if (mode === "replace") {
      const others = (Array.isArray(body.others) ? body.others : []).slice(0, 30).map((n) => str(n, 30)).filter(Boolean);
      prompt = replacePrompt({ topic, note, title, feedback, others, target: pair(body.target) });
      schema = { type: "OBJECT", properties: { item: ITEM }, required: ["item"] };
    } else if (mode === "revise") {
      const keep = (Array.isArray(body.keep) ? body.keep : []).slice(0, 30).map(pair).filter((k) => k.name);
      const previous = (Array.isArray(body.previous) ? body.previous : []).slice(0, 30).map(pair).filter((k) => k.name);
      count = Math.max(1, Math.min(30 - keep.length, Number(body.count) || 1));
      if (count < 1) return json({ error: "바꿀 항목이 없습니다 (모두 잠겨 있어요)" }, 400);
      prompt = revisePrompt({ topic, note, title, feedback, keep, previous, count });
      schema = listSchema(count);
    } else {
      count = Math.max(3, Math.min(30, Number(body.count) || 10));
      prompt = planPrompt(topic, count, note);
      schema = listSchema(count);
    }

    const r = await callGemini(apiKey, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema },
    });
    if (!r.ok) return json({ error: r.message, quotaExceeded: r.quotaExceeded, detail: r.errText }, 502);
    const text = r.data.candidates?.[0]?.content?.parts?.[0]?.text;
    let parsed;
    try { parsed = JSON.parse(text); } catch { return json({ error: "제미나이 응답을 해석하지 못했습니다. 다시 시도해주세요" }, 502); }

    if (mode === "replace") {
      const item = cleanItem(parsed.item);
      if (!item.name || !item.keyword) return json({ error: "새 항목이 만들어지지 않았습니다. 다시 시도해주세요" }, 502);
      return json({ item });
    }
    const items = (parsed.items || []).map(cleanItem).filter((i) => i.name && i.keyword).slice(0, count);
    if (!items.length) return json({ error: "항목이 만들어지지 않았습니다. 다시 시도해주세요" }, 502);
    return json({ title: str(parsed.title, 60) || title || topic.slice(0, 60), items });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
