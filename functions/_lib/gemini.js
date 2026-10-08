// 제미나이 호출 공용 도구: 과부하(5xx)는 재시도하고, 하루 무료 한도 초과(429)는 재시도 없이 구분해서 알려준다.
const MODEL_URL = (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`;

export async function callGemini(apiKey, body) {
  const MAX_ATTEMPTS = 4;
  const BACKOFF_MS = [1000, 2500, 5000];
  let res, errText = "", quotaExceeded = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    res = await fetch(MODEL_URL(apiKey), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) break;
    errText = await res.text();
    if (res.status === 429 && errText.includes("RESOURCE_EXHAUSTED")) { quotaExceeded = true; break; }
    const retriable = res.status === 503 || res.status >= 500;
    if (!retriable || attempt === MAX_ATTEMPTS - 1) break;
    await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt] ?? 5000));
  }
  if (res.ok) return { ok: true, data: await res.json() };
  return { ok: false, status: res.status, errText, quotaExceeded };
}
