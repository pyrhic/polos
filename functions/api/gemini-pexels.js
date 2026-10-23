// Pexels 슬라이드쇼의 기획을 AI가 한다: 주제와 사진 수까지 AI가 정하고, 제목(후킹)과 항목(이름·설명 자막, 선정 이유, Pexels 사진 검색어)을 만든다.
// 사용자는 첨삭·피드백만 한다. 제미나이 하루 한도가 작아서 모드마다 호출은 딱 1번.
// POST /api/gemini-pexels
//   { mode: "plan",    format: "short"|"long", secs, note, past: [string] }
//        -> { topic, title, subject, items: [item × N], range: {min, max} }   N은 AI가 정한다 (숏폼: 10~12장, 롱폼: 기획에 맞게)
//        past = 지금까지 만든 슬라이드쇼 주제·제목 (최근 50개) — 이것들과 분명히 다른 주제를 고른다
//   { mode: "revise",  topic, note, title, subject, format, feedback, count, keep: [{name, keyword}], previous: [{name, keyword, desc}] }
//        -> { title, subject, items: [item × count] }  (keep은 그대로 두는 항목이라 결과에 넣지 않는다)
//   { mode: "replace", topic, note, title, subject, format, feedback, others: [name], target: {name, keyword, desc} } -> { item }
//   item = { name, desc, why, keyword }   name·desc는 영상 사진 밑 자막, why는 화면에만 보이는 메모
//   subject = "people"|"animal"|"place"|"thing"|"food"|"nature"|"other" — 사진 주인공 (people이 아니면 사진 자동 선택에서 사람 사진을 감점)
import { callGemini } from "../_lib/gemini.js";
import { HookKit, hookPromptBlock } from "../_lib/hooks.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
const str = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const MAX_ITEMS = 40;
const SUBJECTS = ["people", "animal", "place", "thing", "food", "nature", "other"];

// 사진 수 범위: 숏폼은 10~12장, 롱폼은 길이 제한 없이 기획에 맞게
function countRange(format, secs) {
  if (format === "long") return { min: 8, max: MAX_ITEMS };
  // 숏폼은 사진 10~12장으로 고정 (사진 한 장당 5초 기본이면 약 1분)
  const min = 10, max = 12;
  return { min: Math.min(min, max), max };
}

const RULES = `[규칙]
- 사실만 쓴다. 실제로 존재하는 장소·대상·현상만. 장소라면 실제 지명. 확인되지 않은 사실, 지어낸 숫자·기록·전설을 쓰지 않는다. 널리 알려진 사실만 쓰고, 확실하지 않으면 사실 대신 눈에 보이는 모습을 묘사한다.
- 항목끼리 겹치지 않게 다양하게 고른다 (같은 대상을 다른 이름으로 반복 금지, 한 나라·한 종류에 몰리지 않게. 작성자 요청이 있으면 그 안에서 다양하게).
- 무료 스톡 사진 사이트(Pexels)에 사진이 있을 만한 대상·장면이어야 한다. 특정 상표·유명인·작품(캐릭터)이 필요한 항목은 쓰지 않는다.
- 사람이 주인공인 주제도 된다 (예: 독특한 피부, 전통 의상, 아름다운 풍경 속 인물). 이때 사진 속 사람은 이름 모를 모델이므로 특정 인물인 것처럼 쓰지 않는다 — name·desc는 그 사람이 아니라 특징·문화·현상을 설명한다. 사람의 외모·몸·질환을 놀리거나 깎아내리거나 구경거리처럼 쓰지 않는다 ("기괴한", "이상한", "충격적인" 같은 말 금지). 존중하는 말투로, 의학적 내용은 널리 알려진 사실만.
- name: 영상 자막에 나오는 이름 (한국어, 20자 이내. 장소면 "지명, 나라" 형태. 예: "살라르 데 우유니, 볼리비아" / 사람 주제면 특징 이름. 예: "백반증, 피부의 무늬")
- desc: 사진 밑에 나오는 한 줄 설명 (한국어, 35자 이내, 사실에 근거해 담백하고 구체적으로. 과장·광고 문구·물음표·느낌표 금지)
- why: 이 항목을 고른 이유 메모 (한국어, 40자 이내. 영상에는 안 나온다)
- keyword: Pexels 사진 검색어 (영어 3~6단어. 대상 + 보이는 모습을 구체적으로. 예: "Salar de Uyuni salt flat reflection"). 사람이 주인공인 주제(subject가 people)라면 사람을 가리키는 단어(woman, man, portrait, skin close up 등)를 넣어도 된다. 그 밖의 주제라면 사람이 주인공인 사진이 나오지 않게 풍경·건물·자연·사물을 가리키는 단어를 쓴다 (person, woman, man, people, portrait 같은 단어 금지).`;
const TITLE_RULE = `- title: 영상 첫 화면 제목. 끝까지 보고 싶게 만드는 후킹이되 내용과 맞고 과장 없이 정직하게 (한국어, 28자 이내. 항목 수가 들어가면 실제 개수와 맞춘다).`;
// 제목(첫 화면)은 후킹 공식 하나를 따르고, 따른 공식 id를 hook_formula로 돌려준다 (plan·revise만. replace는 제목을 안 쓴다)
const HOOK_RULE = hookPromptBlock("pexels", "title(영상 첫 화면 제목)");
const SUBJECT_RULE = `- subject: 이 영상 사진의 주인공 하나 — people(사람이 주인공), animal, place, thing, food, nature, other.`;

const ITEM = { type: "OBJECT", properties: { name: { type: "STRING" }, desc: { type: "STRING" }, why: { type: "STRING" }, keyword: { type: "STRING" } }, required: ["name", "desc", "why", "keyword"] };
const listSchema = (min, max, withTopic) => ({
  type: "OBJECT",
  properties: {
    ...(withTopic ? { topic: { type: "STRING" } } : {}),
    title: { type: "STRING" },
    subject: { type: "STRING", enum: SUBJECTS },
    hook_formula: { type: "STRING", enum: HookKit.formulaIdsFor("pexels") },
    items: { type: "ARRAY", minItems: min, maxItems: max, items: ITEM },
  },
  required: [...(withTopic ? ["topic"] : []), "title", "subject", "hook_formula", "items"],
});

const formatLine = (format) => format === "long"
  ? "[형식] 롱폼 — 가로(16:9) 영상, 길이 제한 없음"
  : "[형식] 숏폼 — 세로(9:16) 쇼츠, 약 1분";

const head = (topic, note, format, subject) => `너는 사진 슬라이드쇼 유튜브 영상의 기획자다. 사용자는 기획을 검토하고 고치는 편집자다.

${formatLine(format)}
${topic ? `[주제] ${topic}\n` : ""}${subject ? `[사진 주인공] ${subject}\n` : ""}${note ? `[작성자 요청] ${note}\n` : ""}`;

function planPrompt(b) {
  const range = b.min === b.max ? `${b.min}개` : `${b.min}~${b.max}개`;
  const howMany = b.format === "long"
    ? `사진 수는 기획에 맞게 네가 정한다 (${range}). 주제를 충분히 보여 줄 만큼만, 억지로 늘리지 않는다.`
    : `사진 한 장이 ${b.secs}초씩 나온다. 사진 수는 ${range} 안에서 네가 정한다.`;
  return `${head("", b.note, b.format, "")}
[할 일] 주제도 네가 정한다. 무료 스톡 사진(Pexels)만으로 충분히 채울 수 있고, 시청자가 끝까지 넘겨 보고 싶은 사진 슬라이드쇼 주제를 하나 골라라.${b.note ? " 작성자 요청을 따른다." : ""}
${b.past.length ? `[이미 만든 주제·제목 — 이것들과 분명히 다른 주제를 골라라. 표현만 바꾼 같은 주제(예: "이색적인 장소" ↔ "독특한 장소")도 안 된다]\n${b.past.map((p) => `- ${p}`).join("\n")}\n` : ""}
그 주제로 항목(사진 한 장씩)과 제목을 기획해라. ${howMany}
- topic: 고른 주제 (한국어, 30자 이내. 예: "세상에서 가장 이색적인 소금 사막")
${RULES}
${TITLE_RULE}
${SUBJECT_RULE}
${HOOK_RULE}
- 시청자가 끝까지 넘겨 보고 싶어지도록 순서를 구성한다 (가장 인상적인 항목을 맨 앞이나 맨 끝에).`;
}

function revisePrompt(b) {
  return `${head(b.topic, b.note, b.format, b.subject)}
지금 기획안의 제목: ${b.title || "(없음)"}
${b.keep.length ? `[그대로 두는 항목 — 결과에 넣지 말고, 이것들과 겹치지 않게]\n${b.keep.map((k) => `- ${k.name} (${k.keyword})`).join("\n")}\n` : ""}${b.previous.length ? `[지금 바꿀 수 있는 항목들 — 피드백에 맞으면 그대로 다시 써도 된다]\n${b.previous.map((k) => `- ${k.name} (${k.keyword}): ${k.desc}`).join("\n")}\n` : ""}
[편집자 피드백] ${b.feedback || "(없음 — 더 좋게 다듬어라)"}

피드백을 반영해 새 항목 ${b.count}개와 제목을 써라. 제목은 그대로 두는 항목까지 합친 전체 영상(${b.count + b.keep.length}장)의 제목이다. subject는 피드백까지 반영한 전체 영상 사진의 주인공이다.
${RULES}
${TITLE_RULE}
${SUBJECT_RULE}
${HOOK_RULE}`;
}

function replacePrompt(b) {
  return `${head(b.topic, b.note, b.format, b.subject)}
영상 제목: ${b.title || "(없음)"}
[다른 항목들 — 이것들과 겹치면 안 된다]
${b.others.map((n) => `- ${n}`).join("\n") || "(없음)"}

[바꿀 항목] ${b.target.name || "(빈 항목)"}${b.target.keyword ? ` (${b.target.keyword})` : ""}
[편집자 피드백] ${b.feedback || "(없음 — 주제에 더 잘 맞는 다른 항목으로)"}

이 항목 하나를 피드백에 맞는 새 항목(바꿀 항목과 다른 대상)으로 바꿔라. 항목 1개만 쓴다.
${RULES}`;
}

const cleanItem = (i) => ({
  name: str(i && i.name, 30),
  desc: str(i && i.desc, 60).replace(/[?!？！]/g, ""),
  why: str(i && i.why, 60),
  keyword: str(i && i.keyword, 80),
});
const cleanSubject = (v, fallback) => (SUBJECTS.includes(v) ? v : fallback || "other");

export async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다" }, 500);
  try {
    const body = await request.json();
    const mode = ["plan", "revise", "replace"].includes(body.mode) ? body.mode : "plan";
    const format = body.format === "long" ? "long" : "short";
    const topic = str(body.topic, 100);
    if (mode !== "plan" && !topic) return json({ error: "주제가 없습니다" }, 400);
    const note = str(body.note, 300);
    const title = str(body.title, 60);
    const feedback = str(body.feedback, 300);
    const subject = SUBJECTS.includes(body.subject) ? body.subject : "";
    const pair = (k) => ({ name: str(k && k.name, 30), keyword: str(k && k.keyword, 80), desc: str(k && k.desc, 60) });

    let prompt, schema, min = 1, max = 1;
    if (mode === "replace") {
      const others = (Array.isArray(body.others) ? body.others : []).slice(0, MAX_ITEMS).map((n) => str(n, 30)).filter(Boolean);
      prompt = replacePrompt({ topic, note, title, subject, format, feedback, others, target: pair(body.target) });
      schema = { type: "OBJECT", properties: { item: ITEM }, required: ["item"] };
    } else if (mode === "revise") {
      const keep = (Array.isArray(body.keep) ? body.keep : []).slice(0, MAX_ITEMS).map(pair).filter((k) => k.name);
      const previous = (Array.isArray(body.previous) ? body.previous : []).slice(0, MAX_ITEMS).map(pair).filter((k) => k.name);
      if (keep.length >= MAX_ITEMS) return json({ error: "바꿀 항목이 없습니다 (모두 잠겨 있어요)" }, 400);
      min = max = Math.max(1, Math.min(MAX_ITEMS - keep.length, Number(body.count) || 1));
      prompt = revisePrompt({ topic, note, title, subject, format, feedback, keep, previous, count: min });
      schema = listSchema(min, max, false);
    } else {
      const secs = Math.max(1.5, Math.min(10, Number(body.secs) || 5));
      ({ min, max } = countRange(format, secs));
      const past = (Array.isArray(body.past) ? body.past : []).slice(0, 50).map((p) => str(p, 80)).filter(Boolean);
      prompt = planPrompt({ format, secs, note, past, min, max });
      schema = listSchema(min, max, true);
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
    const items = (parsed.items || []).map(cleanItem).filter((i) => i.name && i.keyword).slice(0, max);
    if (!items.length) return json({ error: "항목이 만들어지지 않았습니다. 다시 시도해주세요" }, 502);
    const outTitle = str(parsed.title, 60) || title;
    if (mode === "plan") {
      const outTopic = str(parsed.topic, 60) || outTitle;
      if (!outTopic) return json({ error: "주제가 정해지지 않았습니다. 다시 시도해주세요" }, 502);
      return json({ topic: outTopic, title: outTitle || outTopic, subject: cleanSubject(parsed.subject), hook_formula: HookKit.normalizeFormula(parsed.hook_formula), items, range: { min, max } });
    }
    return json({ title: outTitle || topic.slice(0, 60), subject: cleanSubject(parsed.subject, subject), hook_formula: HookKit.normalizeFormula(parsed.hook_formula), items });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
