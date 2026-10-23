// 후킹 공식 21개 — 콘티 대본 프롬프트(functions/_lib/hooks.js hookPromptBlock)가 쓴다.
// adapted from Jakeschincariol/youtube-agent-skill (MIT) — yt-script/hooks.json
// 원본은 영어 기준이라 한국어에 맞게 다시 만들었다. 공식 id·영어 이름은 원본 그대로.
// (후킹 점수·제목 점검은 2026-10-23에 뺐다 — 평가는 사람이 한다)
//
// ※ Pages Functions: functions/_lib/hooks.js 가 이 파일을 import 해서 globalThis.HookKit 을 내보낸다 (esbuild가 함께 묶음).
//    node에서도 require("./youtube/hook-kit.js")로 읽을 수 있게 import/export 문법을 쓰지 않는 일반 스크립트로 둔다.
(function (root) {
  "use strict";

  // ── 후킹 공식 21개 ──────────────────────────────────────────
  // use: 이 공식을 프롬프트에 넣을 콘텐츠 종류 (news = 뉴스·이슈 대본, wiki = 위키 이야기 대본, pexels = 사진 슬라이드쇼 첫 화면 제목)
  //      우리 채널은 사실만 전하므로 "직접 해봤다"처럼 우리가 한 적 없는 일을 전제로 하는 공식은 뉴스에서 뺀다.
  // match: 한국어 문장에서 이 공식을 알아보는 정규식 (분류용, 점수에는 안 들어간다)
  const FORMULAS = [
    { id: "the-statistic", name: "The Statistic", ko: "통계", use: ["news", "wiki", "pexels"],
      shape: "몰랐던 숫자 하나를 담담하게 말하고, 이어서 그 결과를 말한다",
      example: "귀어한 청년 10명 중 7명이 3년 안에 바다를 떠났습니다.",
      fails_when: "숫자가 흐릿하거나 확인할 수 없으면 죽는다. 출처를 밝힌다",
      match: ["\\d+(\\.\\d+)?\\s?(%|퍼센트|프로)", "\\d+\\s?(명|곳|건|개)\\s?중\\s?\\d+", "\\d{1,3}(,\\d{3})+", "\\d+\\s?(만|억|조)\\s?(명|원|건|달러)"] },
    { id: "someone-elses-result", name: "Someone Else's Result", ko: "남의 결과", use: ["news", "wiki"],
      shape: "이름이 있는 사람·단체가 낸 결과를 먼저, 방법은 뒤에",
      example: "양양의 한 서핑숍은 3년 만에 손님이 4배로 늘었습니다.",
      fails_when: "숫자를 지어내지 않는다. 누구인지 밝힐 수 없으면 다른 공식을 쓴다",
      match: ["\\d+\\s?(년|개월|달|주|일)\\s?만에", "(에서|이던|였던)\\s?.{0,12}(로|으로)\\s?(늘|줄|바뀌|올라|뛰)", "(씨|대표|선수|감독|회장|교수)(는|가|의)\\s"] },
    { id: "the-mistake", name: "The Mistake", ko: "흔한 실수", use: ["wiki", "pexels"],
      shape: "시청자가 지금 하고 있을 법한 실수를 짚는다",
      example: "라면 물이 끓기 전에 면을 넣고 계신가요? 그게 면이 붇는 이유입니다.",
      fails_when: "흔한 실수이고, 시청자가 1초 만에 자기 얘기인지 알 수 있어야 한다",
      match: ["(실수|잘못 알고|잘못 하고|틀리게)", "(하고|쓰고|알고|넣고)\\s?계(신가요|시죠|시나요)", "대부분(의 사람)?(이|은)\\s?.{0,8}(모르|틀리|잘못)"] },
    { id: "contrarian-flip", name: "Contrarian Flip", ko: "통념 뒤집기", use: ["news", "wiki", "pexels"],
      shape: "다들 그렇다고 믿는 것을 먼저 말하고, 그걸 뒤집는다",
      example: "요리 잘하는 방송인인 줄 알았는데, 사실은 전투경찰 출신이었습니다.",
      fails_when: "바로 뒤 장면에서 근거가 안 나오면 일부러 반대만 하는 말로 들린다",
      match: ["줄\\s?알았(는데|지만|다|죠|잖)", "라고들\\s?(하지만|하는데|알지만)", "(다들|모두|흔히|보통)\\s?.{0,15}(알지만|생각하지만|하지만|그런데)", "사실은", "(틀렸|아니었)"] },
    { id: "the-reveal", name: "The Reveal", ko: "공개", use: ["news", "wiki"],
      shape: "무엇을 보여줄지 약속하고, 바로 보여준다",
      example: "그날 법정에서 나온 판결문 한 줄을 그대로 보여드리겠습니다.",
      fails_when: "실제로, 일찍 보여줘야 한다. 끝에 가서야 보여주면 앞에서 다 나간다",
      match: ["보여\\s?(드리|드릴|줄게|드립)", "공개(합니다|됐|했|된)", "(지금|바로)\\s?확인"] },
    { id: "the-superlative", name: "The Superlative", ko: "최상급", use: ["news", "wiki", "pexels"],
      shape: "그 분야에서 가장 ~한 것 하나",
      example: "세계에서 가장 높은 곳에 있는 소금 사막입니다.",
      fails_when: "'가장'은 싸다. 무엇을 이겼는지 이름을 대서 증명한다",
      match: ["(가장|제일|최초|유일|최대|최장|최연소|최고령|사상\\s?처음|처음으로|단\\s?하나)"] },
    { id: "the-clock", name: "The Clock", ko: "시간 약속", use: ["wiki"],
      shape: "얻을 것을 시간으로 묶는다",
      example: "1분 안에 이 다리가 왜 무너졌는지 정리해 드립니다.",
      fails_when: "약속한 시간은 지켜야 한다. 넘기면 다음 영상 후킹을 안 믿는다",
      match: ["\\d+\\s?(초|분|시간)\\s?(안에|만에|동안|이면)", "영상이\\s?끝날\\s?때"] },
    { id: "i-tried-it", name: "I Tried It", ko: "직접 해봤다", use: ["wiki"],
      shape: "누군가 직접 해 본 실험과 그 대가(시간·돈·위험)",
      example: "이 의사는 위염의 원인을 밝히려고 세균을 직접 마셨습니다.",
      fails_when: "실제 대가가 있어야 한다. 대가가 없으면 걸린 게 없다",
      match: ["(직접|스스로|몸소)\\s?.{0,12}(해\\s?봤|마셨|먹었|시험|실험|도전)", "\\d+\\s?(일|주|개월|년)\\s?동안\\s?.{0,10}(해\\s?봤|살아|버텼)"] },
    { id: "the-question", name: "The Question", ko: "질문", use: ["news", "wiki", "pexels"],
      shape: "시청자가 검색창에 칠 바로 그 질문을 던진다",
      example: "양양 앞바다에서 오징어는 왜 사라졌을까요?",
      fails_when: "내 질문이 아니라 시청자의 질문이어야 한다",
      match: ["^(왜|어떻게|무엇|뭐가|누가|어디|언제|과연)", "[?？]\\s*$", "(일까요|을까요|ㄹ까요|나요|는가|었을까)\\s*[?？]?\\s*$"] },
    { id: "the-before-after", name: "Before and After", ko: "전과 후", use: ["news", "wiki", "pexels"],
      shape: "두 상태를 붙여 놓고, 그 사이를 자른다",
      example: "10년 전 폐교였던 이 건물이, 지금은 마을 카페가 됐습니다.",
      fails_when: "보여줄 그림이 있어야 한다. 말로만 하면 약하다",
      match: ["(전|예전|과거)(에는|엔|엔\\s|에)?\\s?.{0,20}(지금|이제|현재)", "(였던|이던)\\s?.{0,20}(됐|되었|바뀌)", "예전(엔|에는)"] },
    { id: "the-teardown", name: "The Teardown", ko: "뜯어보기", use: ["news", "wiki"],
      shape: "실제 사례 하나를 공개적으로 뜯어본다",
      example: "판결문 34쪽을 쟁점 세 가지로 뜯어봤습니다.",
      fails_when: "무엇을 몇 개 뜯어봤는지 말한다. 하나뿐이면 일화다",
      match: ["(뜯어|분석|해부|파헤)", "쟁점\\s?(세|두|네|\\d)"] },
    { id: "the-stack", name: "The Stack", ko: "조합", use: ["news", "wiki"],
      shape: "이름 있는 두 가지를 합쳐 하나의 결과를 낸다",
      example: "수온 자료와 어획량 통계를 겹쳐 보면 답이 나옵니다.",
      fails_when: "둘 다 이름을 댈 수 있어야 하고, 결과가 둘 다를 필요로 해야 한다",
      match: ["(와|과)\\s?.{0,12}(합치|겹쳐|더하|섞|함께\\s?보)", "\\s\\+\\s"] },
    { id: "the-warning", name: "The Warning", ko: "경고", use: ["news", "wiki"],
      shape: "시청자가 곧 치를 대가를 말한다",
      example: "이번 달부터 이 서류 없이 배를 띄우면 과태료 300만 원입니다.",
      fails_when: "대가가 작으면 거짓말이 된다. 아껴 쓴다",
      match: ["(하지\\s?마세요|하면\\s?안\\s?(돼|됩)|조심|주의하|경고|과태료|벌금|처벌)", "(하기|올리기|사기)\\s?전에"] },
    { id: "the-list", name: "The List", ko: "목록", use: ["wiki", "pexels"],
      shape: "개수를 첫 줄에 박은 목록",
      example: "세계에서 가장 이색적인 소금 사막 10곳.",
      fails_when: "개수는 정확해야 하고, 항목끼리 종류가 달라야 한다",
      match: ["^\\d+\\s?(가지|곳|개|명|개국|장면|장)", "\\d+\\s?(가지|곳)(을|를|의|\\s|$)"] },
    { id: "the-receipt", name: "The Receipt", ko: "증거 먼저", use: ["news", "wiki"],
      shape: "증거(문서·사진·기록)를 먼저 보여주고 설명은 나중에",
      example: "이게 1987년 당시 실제 신문 1면입니다.",
      fails_when: "진짜 자료 화면이 있어야 한다. 말로 설명한 증거는 증거가 아니다",
      match: ["(이게|이것이|이\\s?사진|이\\s?문서|이\\s?영상|이\\s?기록)\\s?.{0,15}(실제|당시|원본|진짜)", "(증거|기록|원본)(입니다|이다|이에요)"] },
    { id: "the-insider", name: "The Insider", ko: "숨은 정보", use: ["news", "wiki", "pexels"],
      shape: "다 공개돼 있지만 거의 아무도 안 보는 정보",
      example: "공문서에 다 나와 있지만, 거의 아무도 읽지 않는 항목이 있습니다.",
      fails_when: "없는 내부 정보를 아는 척하지 않는다",
      match: ["(아무도|거의\\s?아무도|대부분)\\s?.{0,10}(모르|안\\s?읽|안\\s?보|몰랐|모른다)", "(숨겨진|숨은|감춰진|알려지지\\s?않은|잘\\s?모르는|몰랐던)"] },
    { id: "the-impossible", name: "The Impossible Claim", ko: "믿기 힘든 사실", use: ["news", "wiki", "pexels"],
      shape: "사실이 아닐 것 같은 말을 하고, 곧바로 증명한다",
      example: "이 다리는 못 하나 쓰지 않고 지어졌습니다.",
      fails_when: "20초 안에 증명이 시작되지 않으면 낚시로 읽힌다",
      match: ["(없이|않고|안\\s?하고)\\s?.{0,12}(했|지어|만들|됐|살아|해냈)", "(불가능|믿기\\s?어렵|말이\\s?안\\s?되|한\\s?번도)"] },
    { id: "the-comparison", name: "The Comparison", ko: "비교", use: ["news", "wiki", "pexels"],
      shape: "이름 있는 두 선택지, 승자 하나",
      example: "같은 날 같은 바다, 한쪽 항구만 만선이었습니다.",
      fails_when: "진 쪽도 소리 내 말한다. 진 쪽이 없는 비교는 광고다",
      match: ["\\s(vs|VS|대)\\s", "(보다|와\\s?달리|과\\s?달리|반면)", "(어느\\s?쪽|누가\\s?이겼|어떤\\s?게\\s?나은)"] },
    { id: "the-origin", name: "The Origin", ko: "기원", use: ["news", "wiki", "pexels"],
      shape: "그 결과가 실제로 어디서 시작됐는지",
      example: "이 모든 건 1920년 한 어부의 일기장에서 시작됐습니다.",
      fails_when: "같은 채널에서 여러 번 쓰면 힘이 빠진다",
      match: ["(시작(됐|되었|했|된)|비롯(됐|되었|된)|유래|기원|뿌리)", "(진짜|실제)\\s?이유"] },
    { id: "the-deadline", name: "The Deadline", ko: "기한", use: ["news"],
      shape: "어떤 날짜에 무언가가 바뀐다",
      example: "다음 달 1일부터 어선 출항 신고 방식이 바뀝니다.",
      fails_when: "확인 가능한 진짜 날짜일 때만. 가장 빨리 신뢰를 잃는 공식이다",
      match: ["(이번|다음|올해|내년|오는)\\s?(주|달|해|\\d+월)?\\s?.{0,6}(부터|까지)", "(바뀝|바뀐다|폐지|시행|마감|종료|더\\s?이상)"] },
    { id: "the-direct-address", name: "The Direct Address", ko: "콕 집어 부르기", use: ["news", "wiki", "pexels"],
      shape: "처음 몇 글자 안에 딱 그 시청자를 부른다",
      example: "올해 처음 귀어를 준비하는 분이라면, 이 한 가지는 꼭 보세요.",
      fails_when: "좁을수록 좋다. '영상 만드는 분이라면'은 아무도 안 부른 것이다",
      match: ["^.{0,24}(분이라면|분들|이라면|하시는\\s?분|여러분|당신)", "(꼭|반드시)\\s?(보세요|확인하세요|알아두세요)"] },
  ];
  const FORMULA_IDS = FORMULAS.map((f) => f.id);
  const formulaById = (id) => FORMULAS.find((f) => f.id === id) || null;
  const normalizeFormula = (id) => { const v = String(id || "").trim(); return FORMULA_IDS.includes(v) ? v : null; };

  // 프롬프트에 넣는 짧은 공식 목록 (kind: news | wiki | pexels). 한 줄에 공식 하나: id(한국어 이름): 모양 — 예) 예문
  function formulaPromptList(kind) {
    return FORMULAS.filter((f) => !kind || f.use.includes(kind)).map((f) => `- ${f.id}(${f.ko}): ${f.shape} — 예) ${f.example}`).join("\n");
  }
  const formulaIdsFor = (kind) => FORMULAS.filter((f) => !kind || f.use.includes(kind)).map((f) => f.id);

  const HookKit = { FORMULAS, FORMULA_IDS, formulaById, normalizeFormula, formulaPromptList, formulaIdsFor };
  root.HookKit = HookKit;
  if (typeof module === "object" && module && module.exports) module.exports = HookKit;
})(typeof globalThis !== "undefined" ? globalThis : this);
