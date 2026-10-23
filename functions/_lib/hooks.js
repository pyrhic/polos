// 후킹 공식(youtube/hook-kit.js)을 Pages Functions에서 쓰기 위한 다리.
// 실제 내용은 youtube/hook-kit.js 한 곳에만 있다 (브라우저와 같은 파일 — 복사본 없음). esbuild가 함께 묶는다.
// adapted from Jakeschincariol/youtube-agent-skill (MIT)
import "../../youtube/hook-kit.js";

export const HookKit = globalThis.HookKit;

// 대본 프롬프트에 넣는 후킹 규칙. kind: "news" | "wiki" | "pexels"(첫 화면 제목)
export function hookPromptBlock(kind, target) {
  return `[후킹 공식 — ${target}은 아래 공식 중 하나의 "모양"을 따른다]
${HookKit.formulaPromptList(kind)}
- ${target}은 공백 제외 15~35자 정도로 짧게 (입으로 4~8초)
- 공식은 문장 모양만 빌린다. 숫자·이름·날짜·결과는 자료에 있는 것만 쓰고, 공식에 필요한 사실이 자료에 없으면 그 공식은 버리고 다른 공식을 고른다. 예문의 내용은 가져오지 않는다
- 과장·자극적 표현을 더하지 않는다 (공식을 써도 위의 다른 규칙이 모두 우선한다)
- hook_formula: 실제로 따른 공식의 id 하나 (위 목록의 영어 id 그대로)`;
}
