// 제미나이 호출 공용 도구.
// - 과부하(5xx)는 같은 모델을 점점 길게 기다리며 몇 번 다시 시도하고, 그래도 안 되면 다음 모델로 넘어간다
//   (한 모델이 몇십 초씩 혼잡할 때가 있어서 같은 모델만 두드리면 계속 실패함).
// - 429(한도 초과)는 같은 모델을 재시도하지 않고(한도만 더 깎임) 바로 다음 모델로 - 모델마다 한도가 따로라서.
//   하루 한도(PerDay)와 분당 한도(PerMinute)를 구분해서 알려준다.
// - 404/400(모델이 없거나 요청이 이 모델과 안 맞음)도 다음 모델로. 403(키 문제)은 바로 중단.
const MODELS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"];
const TRANSIENT = new Set([500, 502, 503, 504]);
const ATTEMPTS_PER_MODEL = 3;

const modelUrl = (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function googleMessage(errText) {
  try { return String(JSON.parse(errText)?.error?.message || "").slice(0, 200); } catch { return String(errText || "").slice(0, 200); }
}
// 429가 하루 한도인지 분당 한도인지: 응답의 quotaId(예: ...PerDayPerProjectPerModel / ...PerMinute...)로 구분
function quotaKind(errText) {
  if (/PerMinute|per minute/i.test(errText)) return "minute";
  return "day";
}

export async function callGemini(apiKey, body, { models = MODELS } = {}) {
  let last = { status: 0, errText: "" };
  let sawDay = false, sawMinute = false, sawTransient = false;
  const tried = [];
  for (const model of models) {
    tried.push(model);
    for (let attempt = 0; attempt < ATTEMPTS_PER_MODEL; attempt++) {
      let res;
      try {
        res = await fetch(modelUrl(model, apiKey), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      } catch (err) {
        last = { status: 0, errText: String(err.message || err) };
        sawTransient = true;
        if (attempt < ATTEMPTS_PER_MODEL - 1) await sleep(1500 * (attempt + 1));
        continue;
      }
      if (res.ok) {
        // 200인데 본문이 JSON이 아니거나 중간에 끊긴 경우(드물게 있음)도 일시적 실패로 보고 다시 시도함
        try {
          return { ok: true, data: await res.json(), model };
        } catch {
          last = { status: 502, errText: "응답 본문이 올바른 JSON이 아닙니다" };
          sawTransient = true;
          if (attempt < ATTEMPTS_PER_MODEL - 1) await sleep(1500 * (attempt + 1));
          continue;
        }
      }
      last = { status: res.status, errText: await res.text() };
      if (TRANSIENT.has(res.status)) {
        sawTransient = true;
        if (attempt < ATTEMPTS_PER_MODEL - 1) await sleep(1500 * (attempt + 1));
        continue;
      }
      break;
    }
    if (last.status === 429) { if (quotaKind(last.errText) === "minute") sawMinute = true; else sawDay = true; continue; }
    if (last.status === 404 || last.status === 400 || TRANSIENT.has(last.status) || last.status === 0) continue;
    break; // 401/403 등: 다른 모델로 가도 같음
  }
  const quotaExceeded = last.status === 429 && quotaKind(last.errText) === "day" && !sawTransient;
  let message;
  if (quotaExceeded) message = "제미나이 무료 사용량을 오늘 다 썼습니다 (모델별 하루 한도). 내일 다시 시도하세요.";
  else if (last.status === 429) message = "제미나이 분당 사용량을 넘었어요. 1분쯤 뒤에 다시 시도해주세요.";
  else if (sawTransient || TRANSIENT.has(last.status)) message = `제미나이 서버가 혼잡해서 응답하지 못했어요(${last.status || "연결 실패"}). 모델 ${tried.length}개로 시도했어요. 1~2분 뒤 다시 시도해주세요.`;
  else message = `제미나이 호출 실패 (${last.status}): ${googleMessage(last.errText)}`;
  return { ok: false, status: last.status, errText: last.errText, quotaExceeded, sawDay, sawMinute, message };
}
