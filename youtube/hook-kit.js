// 후킹 공식 21개 + 후킹 점수(hookscore) + 제목·화면 제목 짝 점검(title lint).
// adapted from Jakeschincariol/youtube-agent-skill (MIT) — yt-script/hooks.json, yt-script/hookscore.py, yt-package/title.py
// 원본은 영어 기준이라 한국어(어절·조사·존댓말·한글 글자 폭)에 맞게 다시 만들었다. 공식 id·영어 이름은 원본 그대로.
//
// ※ 이 파일 하나를 두 곳이 같이 쓴다 (복사본 없음):
//    - 브라우저: <script src="/youtube/hook-kit.js"> → window.HookKit (storyboard.html, review.html)
//    - Pages Functions: functions/_lib/hooks.js 가 이 파일을 import 해서 globalThis.HookKit 을 내보낸다 (esbuild가 함께 묶음)
//    - node 테스트: require("./youtube/hook-kit.js")
//    그래서 import/export 문법을 쓰지 않는 일반 스크립트로 둔다.
//
// 점수는 어디까지나 "어림 규칙(휴리스틱)"이다. 원본 설명처럼 일부러 못 쓴 후킹과 쓸 만한 후킹은 잘 가르지만,
// 잘 쓴 후킹끼리의 조회수 차이는 거의 못 맞힌다. 낮은 점수는 "다시 볼 이유", 높은 점수는 "보장"이 아니다.
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

  // ── 후킹 점수 ──────────────────────────────────────────────
  // 원본(hookscore.py)과 같은 5가지 속성, 0~100. 최종 점수(VERDICT) = 평균 60% + 가장 약한 속성 40%.
  // 가장 약한 칸에 무게를 두는 이유: 네 개가 좋아도 하나가 죽어 있으면 거기서 시청자가 샌다 (평균은 그걸 숨긴다).
  const VAGUE = /(충격|역대급|대박|레전드|소름|경악|난리|미쳤|미친|엄청난?|놀라운|놀랍|굉장|어마어마|최고의|최악의|완벽한?|모든\s?것|결국|모두가?\s?놀란|아무도\s?몰랐던\s?비밀)/g;
  const FILLER = /(안녕하세요|여러분\s?오늘은|오늘은|구독|좋아요|채널|영상에서|그냥|진짜|정말|너무|약간|일단|사실상|알아보겠습니다|소개합니다|살펴보겠습니다)/g;
  // 숫자(아라비아 숫자 + 단위 / 한글 수사 + 단위)
  const NUM = /(\d[\d,.]*\s?(%|퍼센트|배|명|원|만\s?원|억\s?원?|조\s?원?|만|억|조|년|월|일|시|분|초|살|세|개|건|곳|위|등|kg|km|m|톤|달러|회|번째|번|가지|장|층|척|마리)?)|((한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|서른|마흔|백|천|수십|수백|수천)\s?(명|개|번|가지|살|해|배|시간|달|개월|곳|척|마리|채))/g;
  // 날짜·때
  const DATE = /(\d{4}\s?년|\d{1,2}\s?월\s?\d{1,2}\s?일|\d{1,2}\s?월|지난\s?(주|달|해)|올해|작년|지난해|내년|[가-힣]{1,6}의\s?날|광복절|설날|추석|크리스마스|새해)/g;
  // 이름 붙은 것: 따옴표 안 이름, 직함 붙은 사람, 기관, 영문 고유명사
  const QUOTED = /[「『"“'‘][^"”'’」』]{1,24}[」』"”'’]/g;
  const TITLED = /[가-힣]{1,8}(장관|원장|청장|총장|시장|군수|지사|의원|대표|회장|사장|감독|선수|배우|가수|작가|교수|박사|대통령|총리|씨|님|선생|셰프|기자)(?![가-힣])|[가-힣]{1,8}(장관|원장|청장|총장|시장|군수|지사|의원|대표|회장|사장|감독|선수|배우|가수|작가|교수|박사|대통령|총리|선생|셰프)/g;
  const ORG = /(경찰|검찰|법원|대법원|국회|정부|대통령실|기상청|국세청|해경|소방|공항|대학교|병원|은행|구청|시청|군청|어촌계|수협|농협|유엔|나사|[가-힣]{2,}(시|군|항|섬|읍)(?=[은는이가을를의에\s,]))/g;
  const LATIN = /\b[A-Z][a-zA-Z0-9]+/g;
  // 시청자에게 말 걸기: 2인칭, 존댓말 권유·명령, 시청자에게 묻는 끝말
  const YOU = /(너희?|당신|여러분|네가|니가|그대|분이라면|분들|하시는\s?분)/g;
  const ASK = /(하세요|보세요|마세요|드세요|아세요|계세요|해\s?보세요|알고\s?계셨나요|아시나요|있나요|했나요|인가요|일까요|을까요|나요\??|까요\??|죠\??|잖아요)(?=[\s.,!?？]|$)/g;
  // 걸린 것: 돈·위험·손실·생사·법·되돌릴 수 없는 결과
  const STAKE = /(돈|비용|손해|손실|적자|위험|잃|망하|망했|파산|빚|벌금|과태료|처벌|구속|징역|체포|기소|사망|숨지|숨졌|죽|살해|살아남|생존|목숨|부상|피해|사고|재난|붕괴|해고|퇴출|폐업|폐교|중단|금지|불법|위법|법(?=[을이은에\s])|소송|고소|논란|위기|마지막|놓치|후회|실패|조심|주의|경고|사라지|사라졌|끊기|멸종)/g;
  // 궁금증: 의문사, 반전, 숨은 것, 물음표
  const CURIOUS = /(왜|어떻게|무엇|뭐가|누가|어디|언제|과연|알고\s?보니|줄\s?알았(는데|지만|죠)|인\s?줄|반전|사실은|그런데|하지만|그러나|비밀|이유|정체|아무도|모르는|몰랐던|숨겨진|숨은|처음으로|의외|뜻밖|단\s?하나)/g;
  // 정체를 아직 안 밝힌 가리킴말 ("이 서류", "이 한 가지", "이 모든 건") — 말로 하는 후킹에선 궁금증의 틈이 된다
  const POINTER = /(^|\s)이\s?(것|거|한\s?가지|모든|서류|사람|곳|숫자|장면|사진|문서|날)/g;
  // 얻는 것도 걸린 것이다 (상·기록·돈을 얻거나 못 얻음)
  const GAIN = /(받았|받지|얻|벌었|수상|우승|1위|신기록|기록을|기부|만선|성공|합격|당첨|되찾)/g;
  // 스스로 답해버리는 끝 (궁금증을 닫는다)
  const CLOSED = /(때문(에|이다|입니다)|덕분에|그래서|라는\s?뜻|이유는\s?.{1,20}(입니다|이다|때문))/;

  const count = (re, t) => (String(t).match(re) || []).length;
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
  // 말로 읽는 글자 수: 공백·문장부호·{ } 무음 표시를 뺀 글자 (앱의 낭독 길이 계산과 같은 "공백 제외 글자")
  const spokenChars = (t) => String(t || "").replace(/\{[^}]*\}/g, "").replace(/[\s.,!?？！…·~"'“”‘’「」『』()\[\]-]/g, "").length;

  // 첫 장면 대본에서 "첫 문장"(입으로 처음 읽는 한 문장)을 꺼낸다. 줄바꿈은 자막 나눔이라 이어 붙인 뒤 문장 끝(. ? ! …)에서 자른다
  function firstSpokenLine(text) {
    const flat = String(text || "").replace(/\r/g, "").replace(/\{[^}]*\}/g, " ").replace(/[ \t]+\/[ \t]+/g, " ").split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
    // "충격!"처럼 너무 짧은 조각에서 끊기면 다음 문장까지 붙인다 (공백 제외 15자 이상이 될 때까지)
    const parts = flat.match(/[^.?!？！…]*[.?!？！…]+(?=\s|$)|[^.?!？！…]+$/g) || [flat];
    let out = "";
    for (const p of parts) { out += p; if (spokenChars(out) >= BREV_MIN) break; }
    return out.trim();
  }

  function specificity(t) {
    if (!spokenChars(t)) return 0;
    const nums = count(NUM, t), dates = count(DATE, t);
    const named = count(QUOTED, t) + count(TITLED, t) + count(ORG, t) + count(LATIN, t);
    const vague = count(VAGUE, t), filler = count(FILLER, t);
    return clamp(30 + Math.min(3, nums + dates) * 18 + Math.min(3, named) * 10 - vague * 15 - filler * 6);
  }
  function address(t) {
    const n = count(YOU, t) + count(ASK, t);
    const head = String(t).slice(0, 14);   // 처음 14자 ≈ 원본의 "처음 6단어"
    const first = (count(YOU, head) || count(ASK, head)) ? 25 : 0;
    // 한국어 내레이션은 "너/당신"을 거의 안 쓰고 존댓말 끝(~습니다/~요)으로 시청자에게 말한다. 그래서 원본(26)보다 바탕을 높이고 존댓말에 조금 더 준다
    const polite = /(습니다|입니다|어요|아요|예요|에요|세요|죠|까요|나요|가요)[.?!？！…\s]*$/.test(String(t).trim()) ? 10 : 0;
    return clamp(32 + n * 20 + first + polite);
  }
  function stakes(t) {
    const n = count(STAKE, t);
    const n2 = n + Math.min(1, count(GAIN, t));
    return clamp(36 + n2 * 22 + ((count(NUM, t) + count(DATE, t)) ? 10 : 0));
  }
  function curiosity(t) {
    const n = count(CURIOUS, t) + Math.min(1, count(POINTER, t));
    const q = /[?？]\s*$/.test(String(t).trim()) ? 16 : 0;
    const closed = CLOSED.test(t) ? -18 : 0;
    return clamp(32 + n * 20 + q + closed);
  }
  // 길이: 공백 제외 15~35자가 100점. 내레이션 초당 약 4.3자라 3.5~8초 — 원본의 "150wpm에 9~24단어(10초 안)"와 같은 구간
  const BREV_MIN = 15, BREV_MAX = 35;
  function brevity(t) {
    const n = spokenChars(t);
    if (!n) return 0;
    if (n >= BREV_MIN && n <= BREV_MAX) return 100;
    if (n < BREV_MIN) return clamp(Math.max(20, 100 - (BREV_MIN - n) * 8));
    return clamp(Math.max(10, 100 - (n - BREV_MAX) * 2.5));
  }

  const PROPS = [
    ["SPECIFICITY", "구체성", specificity],
    ["ADDRESS", "말 걸기", address],
    ["STAKES", "걸린 것", stakes],
    ["CURIOSITY", "궁금증", curiosity],
    ["BREVITY", "길이", brevity],
  ];
  const FIX = {
    SPECIFICITY: "구체성이 약해요 — 형용사 하나를 숫자·이름·날짜로",
    ADDRESS: "말 걸기가 약해요 — 처음 몇 글자 안에 시청자를 부르거나(\"~하는 분이라면\") 묻는 말로",
    STAKES: "걸린 게 안 보여요 — 무엇을 잃거나 얻는지(돈·안전·기회)를 사실로 한마디",
    CURIOSITY: "궁금증이 약해요 — 스스로 답하는 뒷부분을 자르고 '왜·알고 보니' 같은 틈을 남기세요",
    BREVITY_LONG: `너무 길어요 — 첫 문장은 공백 빼고 ${BREV_MIN}~${BREV_MAX}자(약 4~8초)에서 끊으세요`,
    BREVITY_SHORT: `너무 짧아요 — ${BREV_MIN}자 이상으로 무엇에 대한 이야기인지 담으세요`,
  };
  // 등급: 원본은 72/55. 한국어판은 속성 바탕값을 올린 대신 "일부러 못 쓴 후킹은 약함, 숫자·질문·걸린 것이 다 있는 후킹은 강함"이
  //       되도록 예문 11개(TOP5 원문과 강·약 변형, 뉴스·위키 예문)로 맞춰 66/52로 둔다
  const band = (v) => (v >= 66 ? "STRONG" : v >= 52 ? "WORKABLE" : "WEAK");
  const BAND_KO = { STRONG: "강함", WORKABLE: "보통", WEAK: "약함" };

  function classify(t) {
    let best = null, hits = 0;
    for (const f of FORMULAS) {
      const n = f.match.reduce((a, p) => a + (new RegExp(p, "i").test(t) ? 1 : 0), 0);
      if (n > hits) { best = f; hits = n; }
    }
    return { id: best ? best.id : null, name: best ? best.name : "Unclassified", ko: best ? best.ko : "공식 없음", hits };
  }

  // text: 후킹 한 줄 (첫 장면 전체를 넘겨도 된다 — 첫 문장만 본다)
  function scoreHook(text) {
    const t = firstSpokenLine(text);
    const parts = {};
    PROPS.forEach(([k, , fn]) => { parts[k] = t ? fn(t) : 0; });
    const vals = Object.values(parts);
    const verdict = t ? Math.round(0.6 * (vals.reduce((a, b) => a + b, 0) / vals.length) + 0.4 * Math.min(...vals)) : 0;
    const weakest = PROPS.map(([k]) => k).reduce((a, k) => (parts[k] < parts[a] ? k : a), "SPECIFICITY");
    const n = spokenChars(t);
    const tip = weakest === "BREVITY" ? (n < BREV_MIN ? FIX.BREVITY_SHORT : FIX.BREVITY_LONG) : FIX[weakest];
    const b = band(verdict);
    return { hook: t, chars: n, properties: parts, verdict, band: b, band_ko: BAND_KO[b], weakest, weakest_ko: PROPS.find((p) => p[0] === weakest)[1], tip, formula: classify(t) };
  }

  // ── 제목 + 화면 제목 짝 점검 (title.py 한국어판) ─────────────────
  // 화면 폭: 한글·한자·전각 글자는 영문 약 2자 폭으로 센다 (대략치, 실측 아님).
  // 유튜브는 데스크톱 검색에서 영문 약 60자, 모바일 홈 피드에서 약 40자 근처에서 자른다고 알려져 있다(원본 기준).
  // 한글로 치면 약 30자 / 20자. 쇼츠 피드·플레이어도 1~2줄만 보여서 앞 20자 안팎이 실제로 보이는 부분이다.
  const T_DESKTOP = 60, T_MOBILE = 40, T_HARD = 100;
  // 화면 제목(영상 위 큰 글씨) 권장 길이: 대본 프롬프트 기준 1줄 12자, 2줄 14자 (공백 포함)
  const THUMB1_MAX = 12, THUMB2_MAX = 14;
  const wide = (ch) => /[\u1100-\u11ff\u3000-\u303f\u3130-\u318f\uac00-\ud7af\u4e00-\u9fff\uff00-\uffef]/.test(ch);
  const widthOf = (s) => [...String(s)].reduce((a, ch) => a + (wide(ch) ? 2 : 1), 0);
  function cutToWidth(s, max) {
    let w = 0, out = "";
    for (const ch of String(s)) { w += wide(ch) ? 2 : 1; if (w > max) break; out += ch; }
    const sp = out.lastIndexOf(" ");
    return (sp > out.length * 0.6 ? out.slice(0, sp) : out).trim();
  }
  const T_VAGUE = /(충격|충격적|역대급|대박|레전드|소름|경악|난리|미쳤|미친|엄청난?|놀라운|어마어마|최고의?|최악의?|완벽한?|모든\s?것|결국|모두가?\s?놀란|다들\s?놀란|이것|이거|ㄷㄷ|ㅋㅋ|ㄹㅇ)/g;
  const T_STOP = new Set(["그", "이", "저", "것", "수", "등", "및", "더", "왜", "어떻게", "무엇", "오늘", "영상", "이유", "진짜", "정말", "그리고", "하지만", "있다", "없다", "했다", "한다", "이다", "합니다", "입니다", "된다", "됐다"]);
  const PARTICLE = /(이라고|라고|으로|에서|에게|한테|까지|부터|처럼|보다|이다|입니다|했다|하다|은|는|이|가|을|를|의|에|로|과|와|도|만)$/;
  function stems(s) {
    return String(s || "").toLowerCase().split(/[^0-9a-z가-힣]+/).filter(Boolean)
      .map((w) => { const x = w.replace(PARTICLE, ""); return x.length >= 2 ? x : w; })
      .filter((w) => w.length >= 2 && !T_STOP.has(w));
  }
  const hasSpecific = (t) => count(NUM, t) + count(DATE, t) + count(QUOTED, t) + count(TITLED, t) + count(ORG, t) + count(LATIN, t) > 0;

  // title: 유튜브 업로드 제목, thumb: 화면 제목 줄들 [title1, title2] (또는 문자열). 둘 중 하나만 있어도 된다
  // 돌려주는 것: { score, issues: [{key, msg}], good: [msg] }  — 막지 않는 힌트용
  function lintPair(title, thumb) {
    const t = String(title || "").trim();
    const lines = (Array.isArray(thumb) ? thumb : [thumb]).map((x) => String(x || "").trim()).filter(Boolean);
    const th = lines.join(" ");
    const issues = [], good = [];
    if (t) {
      const n = [...t].length, w = widthOf(t);
      if (n > T_HARD) issues.push({ key: "length", msg: `${n}자 — 유튜브 제목 한도는 ${T_HARD}자예요` });
      else if (w > T_DESKTOP) issues.push({ key: "length", msg: `${n}자 — 검색 결과(PC)에서 뒤가 잘려요 (한글 약 30자까지 보임)` });
      else good.push(`${n}자, PC 검색에서 잘리지 않는 길이`);
      if (w > T_MOBILE) issues.push({ key: "mobile", msg: `휴대폰·쇼츠 피드엔 "${cutToWidth(t, T_MOBILE)}…"까지만 보여요 — 주제가 앞에 오는지 확인` });
      if (/[!?！？]{2,}/.test(t)) issues.push({ key: "shouting", msg: "느낌표·물음표를 겹쳐 쓰면 광고처럼 보여요" });
      const v = t.match(T_VAGUE);
      if (v) issues.push({ key: "vague", msg: `${[...new Set(v)].join(", ")} — 흔한 말이라 무엇인지 안 보여요. 숫자·이름·날짜로 바꿔 보세요` });
      if (hasSpecific(t)) good.push("숫자·이름·날짜가 들어 있어요");
      else issues.push({ key: "no-number", msg: "숫자·날짜·이름이 없어요 — 가장 확실한 한 가지 처방" });
      if (/[?？]$/.test(t)) good.push("제목이 열린 질문이에요");
      const front = stems(t.split(/\s+/).slice(0, 2).join(" "));
      if (!front.length) issues.push({ key: "front-load", msg: "앞 두 어절이 군말이에요 — 주제를 앞으로" });
    }
    if (lines.length) {
      if (lines[0] && [...lines[0]].length > THUMB1_MAX) issues.push({ key: "thumb-length", msg: `화면 제목 1줄 ${[...lines[0]].length}자 — ${THUMB1_MAX}자 이내가 한눈에 읽혀요` });
      if (lines[1] && [...lines[1]].length > THUMB2_MAX) issues.push({ key: "thumb-length", msg: `화면 제목 2줄 ${[...lines[1]].length}자 — ${THUMB2_MAX}자 이내가 한눈에 읽혀요` });
      const v = th.match(T_VAGUE);
      if (v) issues.push({ key: "thumb-vague", msg: `화면 제목의 ${[...new Set(v)].join(", ")} — 구체적인 말로 바꿔 보세요` });
      if (!t && !hasSpecific(th)) issues.push({ key: "thumb-specific", msg: "화면 제목에 숫자·이름·날짜가 없어요" });
    }
    if (t && lines.length) {
      const a = stems(t), b = stems(th);
      const shared = [...new Set(b.filter((x) => a.some((y) => y === x || (x.length >= 2 && y.includes(x)) || (y.length >= 2 && x.includes(y)))))];
      if (shared.length) issues.push({ key: "duplicate", msg: `제목과 화면 제목이 "${shared.join(", ")}"을(를) 겹쳐 말해요 — 화면 제목은 제목이 안 한 말을` });
      else good.push("제목과 화면 제목이 서로 다른 말을 해요");
    }
    const score = Math.max(0, Math.min(100, 100 - 14 * issues.length + 4 * good.length));
    return { title: t, thumb: lines, chars: [...t].length, score, issues, good };
  }

  const HookKit = {
    FORMULAS, FORMULA_IDS, formulaById, normalizeFormula, formulaPromptList, formulaIdsFor,
    scoreHook, firstSpokenLine, spokenChars, BAND_KO, lintPair, widthOf,
    HEURISTIC_NOTE: "어림 규칙(휴리스틱) 점수예요. 낮으면 다시 볼 이유일 뿐, 높다고 조회수가 보장되진 않아요.",
  };
  root.HookKit = HookKit;
  if (typeof module === "object" && module && module.exports) module.exports = HookKit;
})(typeof globalThis !== "undefined" ? globalThis : this);
