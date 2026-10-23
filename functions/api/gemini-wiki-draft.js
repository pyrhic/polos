// 고른 이야기 하나로 영상 한 편의 대본과 장면(콘티)을 만들고, 위키 문서의 자유 라이선스 사진 후보를 함께 돌려준다.
// POST /api/gemini-wiki-draft  { lang, title, idea: {title, hook, facts[]}, seconds: 60|120|180, personName, kind: "person"|"event"|"thing" }
//  personName은 문서 주제의 한국어 이름(인물 이름·사건명·개념명). kind가 없으면 person
import { getArticle, getFreeImages, creditLine } from "../_lib/wiki.js";
import { callGemini } from "../_lib/gemini.js";
import { HookKit, hookPromptBlock } from "../_lib/hooks.js";

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json" },
});

const KIND_NAME = { person: "인물", event: "사건", thing: "주제" };
const KIND_STORY = { person: "인물", event: "사건", thing: "지식" };
const KIND_RULE = {
  person: "- 사망한 인물이지만 평가·조롱·추측을 붙이지 않는다. 논란은 사실만 담담하게.",
  event: "- 사건은 원인 → 전개 → 결과 순서로 쉽게 풀고, 사망자 수·날짜·장소는 문서 그대로 쓴다. 해석이 갈리는 부분은 \"~라는 해석도 있다\"로 균형 있게 전하고, 어느 한쪽 편을 들거나 평가·조롱하지 않는다. 특정 개인·집단을 비난하는 표현은 쓰지 않는다. 희생자와 유가족을 가볍게 다루거나 비극을 구경거리처럼 쓰지 않는다.",
  thing: "- 처음 듣는 사람도 이해하도록 쉬운 말로 풀되, 용어는 한 번에 하나씩 소개한다. 비유는 사실을 바꾸지 않는 선에서만 쓰고, 문서에 없는 원리·수치를 덧붙이지 않는다.",
};
// 대본 구성 (person은 예전 문구 그대로)
const KIND_STRUCTURE = {
  person: "도입 1~2장(궁금하게 시작) → 전개 여러 장(시간 순으로 한 가지씩) → 의미 1~2장(이 이야기가 남기는 것) → 마무리 1장(시청자가 생각해볼 질문 한 줄)",
  event: "도입 1~2장(결정적 장면이나 의외의 사실로 궁금하게 시작) → 전개 여러 장(원인·배경부터, 사건이 벌어진 순서대로 한 가지씩) → 의미 1~2장(여파: 이후 무엇이 바뀌었나, 잘 알려지지 않은 사실) → 마무리 1장(시청자가 생각해볼 질문 한 줄)",
  thing: "도입 1~2장(시청자가 멈출 궁금증 질문 하나로 시작) → 전개 여러 장(그 답을 쉬운 말로 한 단계씩, 의외의 사실 포함) → 의미 1~2장(일상과의 연결이나 흔한 오해 바로잡기) → 마무리 1장(시청자가 생각해볼 질문 한 줄)",
};
const KIND_LEAD_IMAGE = { person: "인물 대표 사진", event: "사건을 대표하는 사진", thing: "주제를 대표하는 사진" };
const KIND_CONTI_NAME = { person: "인물과 주제", event: "사건과 주제", thing: "주제와 이야기" };
const SUBSCRIBE_TEXT = "내 알고리즘 밖의 이야기가 궁금하다면 구독 좋아요 해주시면 나도 좋아요";
// 영상 분위기(색감 필터) id — storyboard.html의 MOODS, youtube-automation 04_assemble.py의 MOOD_FILTERS와 같은 목록
const MOOD_IDS = ["neutral", "mystery", "bright", "calm"];
const normalizeMood = (m) => { const v = String(m || "").trim().toLowerCase(); return MOOD_IDS.includes(v) ? v : "neutral"; };
const DIRECTIONS = ["천천히 줌인", "줌아웃", "좌에서 우로 패닝", "우에서 좌로 패닝", "틸트업", "틸트다운"];

export async function onRequestPost(context) {
  const apiKey = context.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다" }, 500);
  try {
    const body = await context.request.json();
    const { lang, title, idea, seconds, personName } = body;
    const kind = ["person", "event", "thing"].includes(body.kind) ? body.kind : "person";
    if (!["ko", "en"].includes(lang) || !title || !idea || !idea.title) return json({ error: "lang, title, idea가 필요합니다" }, 400);
    const secs = [60, 120, 180].includes(Number(seconds)) ? Number(seconds) : 120;
    const targetChars = Math.round(secs * 4.3);                 // 내레이션 초당 약 4.3자 (앱의 길이 추정과 같은 기준)
    const nCards = Math.max(5, Math.min(14, Math.round(targetChars / 55)));

    const main = await getArticle(lang, String(title), 14000);
    if (!main || !main.text) return json({ error: "문서를 읽지 못했습니다" }, 404);
    let second = null;
    if (main.otherTitle) { try { second = await getArticle(main.otherLang, main.otherTitle, 8000); } catch { /* 한 언어만으로 진행 */ } }
    const images = await getFreeImages(lang, main.title, 10).catch(() => []);

    const imgList = images.length
      ? images.map((im, i) => `[${i}] ${im.file}${im.caption ? " — " + im.caption : ""}`).join("\n")
      : "(사용할 수 있는 사진 없음)";
    const prompt = `너는 한국어 유튜브 채널 "Wicked Wiki"의 작가다. 위키피디아의 신선하고 재미있는 ${KIND_STORY[kind]} 이야기를 차분하지만 흥미롭게 들려준다. 인사말("안녕하세요")과 자극적인 후킹, 과장은 쓰지 않는다.

[${KIND_NAME[kind]}] ${personName || main.title}
[이 영상의 주제] ${idea.title}
[첫 문장 후보] ${idea.hook || ""}
[핵심 사실] ${(idea.facts || []).join(" / ")}

[위키피디아 문서 1: ${main.lang === "ko" ? "한국어" : "영어"} 「${main.title}」]
${main.text}
${second ? `\n[위키피디아 문서 2: ${second.lang === "ko" ? "한국어" : "영어"} 「${second.title}」]\n${second.text}\n` : ""}
[쓸 수 있는 사진 목록 (번호로 고른다)]
${imgList}

[대본 규칙]
- 사실은 위 문서에 있는 것만 쓴다. 날짜·이름·숫자는 문서 그대로. 없는 일화, 지어낸 대사·인용은 절대 쓰지 않는다. 문서에서 불확실하게 적힌 것은 "~라고 전해진다", "~로 알려져 있다"로 표현한다.
${KIND_RULE[kind]}
- 입으로 읽는 대본이다. 한 문장은 짧게, 한 카드에 1~2문장, 공백 제외 약 40~70자. 외국어 이름은 한글로 쓰고 처음 한 번만 괄호로 원어를 병기한다.
- 전체 분량: 카드 합쳐 공백 제외 약 ${targetChars}자 (영상 약 ${secs}초), 카드는 ${nCards}장 안팎.
- 구성: ${KIND_STRUCTURE[kind]}. "구독", "좋아요"라는 말은 쓰지 않는다.
- 카드마다 section은 "도입", "전개", "의미", "마무리" 중 하나. 위 순서대로.
- keyword: Pexels 검색용 영어 단어 2~4개 (사진이 없을 때 쓰는 분위기 영상 검색어). 실존 인물 이름·한국어 고유명사는 쓰지 말고 분위기/사물/장소를 묘사. 카드마다 다르게.
- direction: 카메라 연출 하나, 반드시 다음 중에서: ${DIRECTIONS.map((d) => `"${d}"`).join(", ")} (같은 연출이 연속되지 않게)
- image: 이 카드에 어울리는 사진 번호(위 목록). 적당한 사진이 없으면 -1. 같은 사진을 너무 반복해서 쓰지 말고, 첫 카드에는 ${KIND_LEAD_IMAGE[kind]}이 있으면 쓴다.
- name: 콘티 이름 (${KIND_CONTI_NAME[kind]}, 20자 이내). title1: ${KIND_NAME[kind]} 이름(또는 핵심 키워드) 공백 포함 12자 이내, title2: 이 이야기를 한 줄로 14자 이내. 궁금증을 불러일으키는 낚시성 표현과 물음표·느낌표는 써도 되지만, 위키백과에 있는 사실만 쓰고 실존 인물을 조롱·비방하지 않는다.
- mood: 문서 내용의 분위기를 판단해 영상 색감 분위기를 다음 id 중 하나로 고른다: "neutral"(기본), "mystery"(어둡고 긴장감 있는 미스터리 — 미제 사건·의문의 죽음·괴담·수수께끼 등), "bright"(밝고 경쾌 — 유쾌한 일화·발명·성공담 등), "calm"(차분하고 담담한 다큐 — 생애·역사·참사·과학 지식 등). 판단이 어렵거나 애매하면 "neutral".

${hookPromptBlock("wiki", "첫 카드(도입 첫 장)의 첫 문장(후킹)")}
- [첫 문장 후보]가 있으면 그 사실을 살리되, 문장 모양은 고른 공식에 맞춘다`;

    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" }, title1: { type: "STRING" }, title2: { type: "STRING" },
            cards: {
              type: "ARRAY", minItems: 4, maxItems: 16,
              items: {
                type: "OBJECT",
                properties: {
                  section: { type: "STRING" }, script_text: { type: "STRING" }, keyword: { type: "STRING" },
                  direction: { type: "STRING" }, image: { type: "INTEGER" },
                },
                required: ["section", "script_text", "keyword", "direction", "image"],
              },
            },
            mood: { type: "STRING", enum: MOOD_IDS },
            hook_formula: { type: "STRING", enum: HookKit.formulaIdsFor("wiki") },
          },
          required: ["name", "title1", "title2", "cards", "mood", "hook_formula"],
        },
      },
    };

    let parsed = null, lastProblem = "";
    for (let pass = 0; pass < 2 && !parsed; pass++) {
      const r = await callGemini(apiKey, requestBody);
      if (!r.ok) return json({ error: r.message, quotaExceeded: r.quotaExceeded }, 502);
      const text = r.data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
      if (!text) { lastProblem = "제미나이 응답이 비어 있습니다"; continue; }
      let cand;
      try { cand = JSON.parse(text); } catch { lastProblem = "제미나이 응답이 중간에 끊겨 해석하지 못했습니다"; continue; }
      if ((cand.cards || []).filter((c) => c.script_text && c.script_text.trim()).length < 4) { lastProblem = "대본이 충분히 만들어지지 않았습니다"; continue; }
      parsed = cand;
    }
    if (!parsed) return json({ error: lastProblem + " (두 번 시도했어요). 잠시 뒤 다시 시도해주세요" }, 502);

    const clean20 = (s) => String(s || "").replace(/[?!？！]/g, "").trim().slice(0, 20);   // 콘티 이름용
    const title20 = (s) => String(s || "").trim().slice(0, 20);   // 화면 제목은 물음표·느낌표 허용
    const segments = parsed.cards.filter((c) => c.script_text && c.script_text.trim()).map((c) => ({
      section: ["도입", "전개", "의미", "마무리"].includes(c.section) ? c.section : "전개",
      script_text: c.script_text.trim(), keyword: c.keyword || "", direction: DIRECTIONS.includes(c.direction) ? c.direction : "천천히 줌인",
      image: Number.isInteger(c.image) && c.image >= 0 && c.image < images.length ? c.image : -1,
    }));
    // 구독/좋아요 안내 카드는 항상 마지막에 (사진은 영상 만들 때 자동으로 들어간다)
    segments.push({ section: "구독/좋아요", script_text: SUBSCRIBE_TEXT, keyword: "sexy witch", direction: "천천히 줌인", image: -1 });

    const sources = [{ title: `위키백과 「${main.title}」 (${main.lang})`, url: main.url }];
    if (second) sources.push({ title: `위키백과 「${second.title}」 (${second.lang})`, url: second.url });
    return json({
      name: clean20(parsed.name), title1: title20(parsed.title1), title2: title20(parsed.title2),
      mood: normalizeMood(parsed.mood),   // 영상 분위기(색감 필터): 4개 외 값이거나 없으면 neutral
      hook_formula: HookKit.normalizeFormula(parsed.hook_formula),   // 첫 문장이 따른 후킹 공식 id (없거나 목록 밖이면 null)
      segments, images, sources, credits: images.map(creditLine),
      targetChars, totalChars: segments.reduce((n, s) => n + s.script_text.replace(/\s+/g, "").length, 0),
    }, 200);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
