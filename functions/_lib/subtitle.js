// SCRIPT(성우가 읽는 대본)와 SUBTITLE(화면 자막)을 나눠 쓰게 하는 콘티 AI 규칙 (youtube-automation docs/storyboard-contract.md 16절)
// gemini-draft.js(뉴스)와 gemini-wiki-draft.js(위키)가 같이 쓴다.

// 프롬프트에 넣는 규칙. subject = 이 영상에서 이름을 꼭 밝혀야 하는 대상 설명(예: "인물·단체·작품·장소")
export function subtitlePromptBlock(subject) {
  return `[SCRIPT와 SUBTITLE — 카드마다 둘 다 쓴다]
- script_text는 성우가 소리 내어 읽는 대본이다. 기호 없이 자연스러운 한국어 말로만 쓴다. 대괄호[ ], 중괄호{ }, 쉼 표시(-), 별표(**), 줄 나눔 표시(/)는 쓰지 않는다
- 순위·목록 형식(TOP5, 1위~5위 등)이면 script_text에서도 그 카드의 대상 이름을 말한다(별명·대명사로만 부르지 않는다)
- subtitle은 그 카드 동안 화면에 보이는 자막이다. script_text의 핵심 사실을 줄여 1~3줄(줄바꿈으로 구분), 한 줄은 공백 포함 약 16자 이내로 짧게 쓴다
- 카드가 특정 ${subject}에 관한 내용이면 subtitle에 반드시 그 이름을 넣는다. 예) "5위 류수영", "경찰의 날 1,100인분 재능기부"
- subtitle의 사실·숫자·이름은 위 자료에 있는 것만 쓴다. 기호(괄호 표시·별표·쉼 표시)와 이모지는 쓰지 않는다
- script_text 문장 수와 subtitle 줄 수를 같게 쓰면 문장마다 그 줄이 나온다(다르면 카드 시간을 글자 수대로 나눠 보여준다)`;
}

// 응답 schema에 넣는 subtitle 칸
export const SUBTITLE_SCHEMA = { type: "STRING" };

// 읽는 대본: 혹시 남은 자막 기호를 지운다 ([..]는 안의 글자만 남기고, {..}·**·따로 떨어진 - / 는 뺀다)
export function cleanScript(text) {
  return String(text || "").replace(/\r/g, "")
    .replace(/\*\*/g, "").replace(/\[([^\[\]]*)\]/g, "$1").replace(/\{[^{}]*\}/g, " ")
    .split("\n").map((l) => l.replace(/(^|\s)(?:-+|\/)(?=\s|$)/g, " ").replace(/[ \t]{2,}/g, " ").trim()).filter(Boolean).join("\n");
}

// 화면 자막: 기호를 지우고 빈 줄을 뺀 1~3줄, 줄마다 40자까지
export function cleanSubtitle(text) {
  return String(text || "").replace(/\r/g, "").replace(/\\n/g, "\n")
    .replace(/\*\*/g, "").replace(/[\[\]{}]/g, "")
    .split("\n").map((l) => l.replace(/(^|\s)-+(?=\s|$)/g, " ").replace(/[ \t]{2,}/g, " ").trim().slice(0, 40)).filter(Boolean).slice(0, 3).join("\n");
}
