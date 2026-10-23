import { fetchArticle } from "../_lib/article.js";
import { findPerspectiveArticles } from "../_lib/news.js";
import { callGemini } from "../_lib/gemini.js";
import { HookKit, hookPromptBlock } from "../_lib/hooks.js";
import { subtitlePromptBlock, SUBTITLE_SCHEMA, cleanScript, cleanSubtitle } from "../_lib/subtitle.js";

// Trend에서 고른 주제 + 관련 기사로 대본과 장면(콘티)을 만든다.
// 1) 구글 뉴스 검색(무료)으로 관련 칼럼·분석 기사 수집  2) 기사 + 관점 자료로 대본/장면 작성 (제미나이 호출은 1번)
const CLICHES = [
  "안녕하세요 여러분, 오늘은 ~에 대해 알아보겠습니다", "결론적으로", "다양한 이야기가 있습니다",
  "이처럼", "정리해보겠습니다", "여러분들도 알다시피",
];

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json" },
});

const CARD_SCHEMA = {
  type: "OBJECT",
  properties: { script_text: { type: "STRING" }, subtitle: SUBTITLE_SCHEMA, keyword: { type: "STRING" }, direction: { type: "STRING" } },
  required: ["script_text", "subtitle", "keyword", "direction"],
};

const researchUsable = (text) => !!text && text.trim().length > 0;

// 트렌드 화면의 나라 선택 목록과 같은 코드(KR이면 국내). 모르는 코드는 국내처럼 처리한다
const COUNTRY_NAMES = { US: "미국", JP: "일본", GB: "영국", DE: "독일", FR: "프랑스", IN: "인도", BR: "브라질", AU: "호주", CA: "캐나다", TW: "대만" };

// 영상 분위기(색감 필터) id — storyboard.html의 MOODS, youtube-automation 04_assemble.py의 MOOD_FILTERS와 같은 목록
const MOOD_IDS = ["neutral", "mystery", "bright", "calm"];
const normalizeMood = (m) => { const v = String(m || "").trim().toLowerCase(); return MOOD_IDS.includes(v) ? v : "neutral"; };

// 참고 기사는 최대 5건. 기사 본문은 전체 약 10,500자(예전 3건 × 3,500자)를 기사 수로 나눠 읽는다 (프롬프트 크기·응답 시간이 예전과 비슷하게)
const MAX_ARTICLES = 5;
const ARTICLE_TEXT_BUDGET = 10500;

const SUBSCRIBE_TEXT = "내 알고리즘 밖의 이야기가 궁금하다면 구독 좋아요 해주시면 나도 좋아요";

function buildPrompt(topic, articles, researchText, note, traffic, country) {
  const refs = articles.map((a, i) => `(${i + 1}) [${a.source || "출처 미상"}] ${a.title}\n${a.text || "(본문을 가져오지 못해 제목만 참고)"}`).join("\n\n");
  const hasResearch = researchUsable(researchText);
  // 해외 트렌드(미국·일본 등)로 만들 때는 "한국 시청자에게 외국 소식을 전해주는" 방식으로 쓴다. 국내 트렌드는 기존 그대로.
  // 대본이 1분(약 250자)으로 짧아서, 도입 카드는 한 문장 + 한국 시청자용 배경 한 문장만 넣는다.
  const trendLine = country
    ? `[트렌드 정보] ${country} 구글 급상승 검색어${traffic ? ` (검색량 ${traffic})` : ""} — 한국이 아닌 해외 트렌드다`
    : `[트렌드 정보] 구글 급상승 검색어${traffic ? ` (검색량 ${traffic})` : ""} — 참고용이다. 대본에 급상승·검색어 이야기는 쓰지 않는다`;
  const summaryRule = country
    ? `- trend_summary (1~2장): 이슈의 핵심, 즉 무슨 일이 있었는지를 바로 말하며 시작한다. 한국 시청자가 모를 수 있는 배경(이게 무엇이고 현지에서 왜 화제인지)은 기사에 있는 내용만으로 한 문장 덧붙인다. 기사에 언제 일어난 일인지(날짜·요일·현지 시간)가 나와 있으면 그 시점도 밝히고, 없으면 시점을 추측하지 않는다. 기사가 전한 핵심은 "○○ 보도에 따르면"처럼 기사가 보도한 내용임을 밝힌다`
    : `- trend_summary (1~2장): 이슈의 핵심, 즉 무슨 일이 있었는지를 바로 말하며 시작한다. "급상승 검색어", "실시간 검색어", "지금 화제입니다" 같은 트렌드 소개 문구는 쓰지 않는다. "○○ 보도에 따르면"처럼 기사가 보도한 내용임을 밝힌다`;
  const overseasRule = country
    ? `\n- 이 영상은 ${country} 소식을 한국 시청자에게 소개하는 영상이다. 인물·단체·작품·지명 등 외국어 고유명사는 한글 표기로 쓰고 처음 한 번만 괄호로 원어를 병기한다. 외국어 기사는 번역해서 새 문장으로 쓰되, 기사에 없는 현지 배경·평가·한국과의 관련을 덧붙이지 않는다`
    : "";
  const hookRule = hookPromptBlock("news", "첫 카드(trend_summary 첫 장)의 첫 문장(후킹)");
  return `너는 한국어 유튜브 정보 채널의 대본 작가다. 이 채널은 "지금 인기 검색어가 왜 이슈인지"를 차분하고 균형 있게 설명한다. 자극적인 후킹, 과장, 인사말("안녕하세요 여러분")은 쓰지 않는다.

[주제] ${topic}
${trendLine}

[참고 기사 — 이 기사들에 실린 내용이 중심 자료다]
${refs}

[관련 칼럼·분석 기사 — 구글 뉴스 검색 결과]
${hasResearch ? researchText : "(관련 칼럼·분석 기사를 찾지 못함 — 관점 정리 장면은 만들지 말 것)"}
${note ? `\n[작성자 방향 메모 — 반드시 반영]\n${note}\n` : ""}
[대본 구조 — 카드(장면)를 아래 구분으로 나눠서 쓴다. 카드 하나는 1~2문장, 공백 제외 약 30~60자이고, 카드마다 서로 다른 내용(한 가지 사실·측면)만 담는다]
${summaryRule}
- issue (3~5장, 반드시 3장 이상): 이 사건/이슈가 무엇이고 왜 지금 화제인지를 카드마다 한 측면씩 나눠 설명한다. 예) 무슨 일이 있었나 → 관련된 사람·기관과 경과 → 구체적 수치·발언·날짜 → 쟁점이나 논란 → 앞으로의 계획·일정·방향(기사에 있으면 반드시). 같은 내용을 반복하거나 말을 늘려 채우지 말고, 기사에 정보가 모자라면 관련 기사 자료에서 확인된 사실로 보충한다
- perspectives (${hasResearch ? "0~2장" : "0장 — 자료가 없으니 빈 배열"}): 위 관련 칼럼·분석 기사에 **실제로 담긴 의견·해석**만 전한다. 각 의견은 어느 매체의 기사·칼럼인지 밝히고("○○ 분석에 따르면"), 대립하는 의견이 있으면 양쪽 모두 균형 있게 전한다. 기사에 의견이나 해석 없이 사실 전달뿐이면 억지로 만들지 말고 0장으로 둔다. 문장은 새로 쓰고 길게 인용하지 않는다
- closing (정확히 1장): 위 내용을 한두 문장으로 정리하고 시청자가 생각해볼 질문 하나로 끝낸다. "구독", "좋아요" 같은 말은 쓰지 않는다(구독 안내 카드는 시스템이 따로 넣는다)

[대본 규칙]
- 사실은 참고 기사와 관련 기사 자료에 있는 것만 쓴다. 기사에 있는 구체적 정보(이름·날짜·장소·수치·발언)는 빠뜨리지 말고 담는다. 내용은 기사에 충실하게, 문장은 기사 문장을 그대로 복사하지 않고 새로 쓴다
- 정치적으로 민감한 내용은 편향 없이: 당사자의 주장은 "~라고 주장했다/밝혔다"로 출처와 함께 전하고, 평가·형용사·추측을 붙이지 않으며, 서로 다른 주장은 균형 있게 다룬다
- 확인되지 않은 내용은 "~라고 보도됐다"로 표현. 실존 인물·기업에 대한 명예훼손성 표현/조롱 금지
- 다음 AI 상투어 사용 금지: ${CLICHES.join(", ")}
- 분량 가이드: 영상 길이는 1분 안팎이 목표다(내레이션 초당 약 4.3자). 전체 카드 합쳐 공백 제외 약 250자를 기준으로, 이슈를 설명하는 데 꼭 필요한 만큼만 쓴다. 카드는 설명과 장면 전환이 필요한 만큼 쓰되 전체 최대 10장을 넘기지 않는다${overseasRule}

[카드 규칙]
- 카드의 script_text를 구분 순서대로(trend_summary → issue → perspectives → closing) 이어 붙이면 전체 대본이 되어야 함
- keyword: Pexels 스톡 영상 검색용 영어 단어 2~4개. 실존 인물 이름이나 한국어 고유명사는 쓰지 말고 카드 내용의 분위기/사물/상황을 묘사. 카드마다 다르게
- direction: 카메라 연출 한 가지, 반드시 다음 중에서: "천천히 줌인", "줌아웃", "좌에서 우로 패닝", "우에서 좌로 패닝", "틸트업", "틸트다운" (같은 연출이 연속되지 않게)
- name: 이 콘티의 이름, 주제를 20자 이내로 요약
- title1, title2: "제목 + 영상 + 출처" 화면 구성에서 영상 위에 크게 나오는 제목 두 줄이다. title1은 노란 글씨로, 이슈의 핵심 키워드나 사건을 공백 포함 12자 이내로(예: "대법원장 격려금 논란"). title2는 흰 글씨로, title1을 보충해 무엇이 쟁점인지 공백 포함 14자 이내로. 둘 다 기사에 있는 사실만 쓴다. 궁금증을 불러일으키는 낚시성 표현과 물음표·느낌표는 써도 되지만, 기사에 없는 내용을 지어내거나 실존 인물을 조롱·비방하는 표현은 쓰지 않는다
${subtitlePromptBlock("인물·단체·작품·장소")}
- mood: 기사 내용의 분위기를 판단해 영상 색감 분위기를 다음 id 중 하나로 고른다: "neutral"(기본·일반 소식), "mystery"(어둡고 긴장감 있는 미스터리 — 미제 사건·의문사·수사 중인 사건 등), "bright"(밝고 경쾌 — 축제·수상·스포츠 승리·좋은 소식 등), "calm"(차분하고 담담한 다큐 — 사고·재난·추모·역사·사회 문제 등). 판단이 어렵거나 애매하면 "neutral"

${hookRule}
- 후킹 문장도 trend_summary 규칙대로 이슈의 핵심 사실(무슨 일이 있었나)을 담는다`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다" }, 500);

  try {
    const { topic, articles, note, traffic, geo } = await request.json();
    const country = COUNTRY_NAMES[String(geo || "").toUpperCase()] || "";
    if (!topic || !String(topic).trim()) return json({ error: "주제가 필요합니다" }, 400);
    const cleanTopic = String(topic).trim().slice(0, 100);

    // 기사 없이 주제만으로 쓰는 길은 없앴다 (사실 확인이 안 되는 대본이 나와서). 기사 없이 만들면 화면에서 Gemini 없이 빈 콘티가 된다
    const picked = (Array.isArray(articles) ? articles : []).filter((a) => a && /^https?:\/\//.test(String(a.url || ""))).slice(0, MAX_ARTICLES).map((a) => ({
      title: String(a.title || "").slice(0, 200), url: String(a.url || ""), source: String(a.source || "").slice(0, 60),
    }));
    if (!picked.length) return json({ error: "참고 기사가 없어요. 콘티 만들기 창에서 Search로 기사를 찾아 고른 뒤 다시 만들어 주세요" }, 400);
    const perArticle = Math.max(2000, Math.min(3500, Math.floor(ARTICLE_TEXT_BUDGET / picked.length)));
    const fetched = await Promise.all(picked.map((a) => fetchArticle(a.url, perArticle)));   // 동시에 읽어서(기사마다 최대 7초) 건수가 늘어도 시간은 거의 같다
    picked.forEach((a, i) => { a.text = fetched[i].text; a.media = [...fetched[i].images, ...fetched[i].videos]; a.embeds = fetched[i].embeds; });

    // 관점 자료: 구글 뉴스 검색(무료, Supabase 함수 news-search)으로 관련 칼럼·분석 기사를 찾아 본문을 읽는다. 못 찾으면 관점 정리 없이 쓴다.
    let perspectives = [];
    try { perspectives = await findPerspectiveArticles(cleanTopic, picked.map((a) => a.title), 3, env); } catch { /* 관점 자료 없이 진행 */ }
    const researched = {
      ok: perspectives.length > 0,
      text: perspectives.map((a, i) => `(${i + 1}) [${a.source}] ${a.title}\n${a.text}`).join("\n\n"),
      sources: perspectives.map((a) => ({ title: `${a.source} — ${a.title}`, url: a.url })),
    };
    
    const requestBody = {
      contents: [{ parts: [{ text: buildPrompt(cleanTopic, picked, researched.text, String(note || "").trim().slice(0, 300), String(traffic || "").slice(0, 20), country) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            title1: { type: "STRING" },
            title2: { type: "STRING" },
            trend_summary: { type: "ARRAY", minItems: 1, maxItems: 2, items: CARD_SCHEMA },
            issue: { type: "ARRAY", minItems: 3, maxItems: 5, items: CARD_SCHEMA },
            perspectives: { type: "ARRAY", maxItems: 2, items: CARD_SCHEMA },
            closing: { type: "ARRAY", minItems: 1, maxItems: 1, items: CARD_SCHEMA },
            mood: { type: "STRING", enum: MOOD_IDS },
            hook_formula: { type: "STRING", enum: HookKit.formulaIdsFor("news") },
          },
          required: ["name", "trend_summary", "issue", "perspectives", "closing", "mood", "hook_formula"],
        },
      },
    };
    const usePerspectives = researchUsable(researched.text);
    // script_text = 성우가 읽는 말(기호 없음), subtitle_text = 화면 자막(계약서 16절)
    const card = (part) => (c) => ({ section: part, script_text: cleanScript(c.script_text), subtitle_text: cleanSubtitle(c.subtitle), keyword: c.keyword || "", direction: c.direction || "" });

    // 응답이 중간에 잘려 JSON이 깨지거나 대본이 너무 짧게 나오는 건 가끔 있는 일시적 현상이라, 이 경우만 한 번 더 시도함
    let parsed = null, lastProblem = "";
    for (let pass = 0; pass < 2 && !parsed; pass++) {
      const written = await callGemini(apiKey, requestBody);
      if (!written.ok) return json({ error: written.message, quotaExceeded: written.quotaExceeded, detail: written.errText }, 502);
      const text = written.data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
      if (!text) { lastProblem = "제미나이 응답이 비어 있습니다"; continue; }
      let candidate;
      try { candidate = JSON.parse(text); } catch { lastProblem = "제미나이 응답이 중간에 끊겨 해석하지 못했습니다"; continue; }
      candidate.segments = [
        ...(candidate.trend_summary || []).map(card("트렌드 요약")),
        ...(candidate.issue || []).map(card("이슈 설명")),
        ...(usePerspectives ? (candidate.perspectives || []).map(card("관점 정리")) : []),
        ...(candidate.closing || []).map(card("마무리")),
        // 구독/좋아요 안내 카드: 항상 마지막에 넣는다. 사진은 영상 만들 때 마녀 사진이 자동으로 들어간다(직접 넣으면 그 사진을 씀)
        { section: "구독/좋아요", script_text: SUBSCRIBE_TEXT, keyword: "sexy witch", direction: "천천히 줌인" },
      ];
      if (candidate.segments.filter((c) => c.script_text).length < 4) { lastProblem = "대본이 충분히 만들어지지 않았습니다"; continue; }
      parsed = candidate;
    }
    if (!parsed) return json({ error: lastProblem + " (두 번 시도했어요). 잠시 뒤 다시 시도해주세요" }, 502);
    // 화면 제목 두 줄 (입력칸 글자 수 제한 안으로)
    parsed.title1 = String(parsed.title1 || "").trim().slice(0, 20);
    parsed.title2 = String(parsed.title2 || "").trim().slice(0, 20);
    // 영상 분위기(색감 필터): 정해진 4개 외 값이거나 없으면 기본(neutral)
    parsed.mood = normalizeMood(parsed.mood);
    // 첫 문장이 따른 후킹 공식 id (목록 밖 값이면 null) — 콘티 video_settings.hook_formula로 저장된다
    parsed.hook_formula = HookKit.normalizeFormula(parsed.hook_formula);
    delete parsed.trend_summary; delete parsed.issue; delete parsed.perspectives; delete parsed.closing;

    parsed.country = country || null;
    parsed.usedArticles = picked.map((a) => ({ title: a.title, url: a.url, source: a.source, hadText: !!a.text }));
    parsed.research = { ok: researched.ok, sources: researched.sources };
    // 기사에서 찾은 사진 후보 (저작권 확인은 사용자가 콘티에서 직접 한다)
    parsed.images = picked.flatMap((a) => a.media.map((m) => ({
      type: m.type, url: m.url, caption: m.caption, source: a.source, articleUrl: a.url, articleTitle: a.title,
    })));
    // 유튜브 등 외부 플레이어 영상은 내려받지 않고 링크만 알려준다
    parsed.embeds = picked.flatMap((a) => a.embeds.map((link) => ({ link, source: a.source, articleUrl: a.url })));
    return json(parsed, 200);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
