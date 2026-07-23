const SHEET_ID = "1eDq93iuSBJ6fn_wY9iV3KDUAik7oHdZYDOSMsb94UrQ";
const SHEET_TAB = "근무일지 2026";
const SUPABASE_URL = "https://oenqrlgmnkpzxsavnfyo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_sZ4wQgaC5f-i40pVzf0vIA_R7iJWDf5";
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function base64url(bytes) {
  let str;
  if (typeof bytes === "string") {
    str = btoa(bytes);
  } else {
    str = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  }
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(serviceAccount) {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const pem = serviceAccount.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64url(signature)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error("구글 인증 실패: " + (await res.text()));
  return (await res.json()).access_token;
}

// 이번 주(월~금) 날짜 정보를 한국시간(KST, UTC+9) 기준으로 계산
function getThisWeekdays() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(kst);
  monday.setUTCDate(kst.getUTCDate() + diffToMonday);

  const weekdays = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const date = d.getUTCDate();
    weekdays.push({
      label: `${month}/${date}`,
      dow: DOW[d.getUTCDay()],
      year,
      month,
      date,
    });
  }
  return weekdays;
}

// I열(추가부재시간) 원문을 출장연가 라벨로 변환
function toLeaveLabel(rawCell) {
  const text = (rawCell || "").trim();
  if (!text) return "";
  const m = text.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (m && m[1] === "9:00" && m[2] === "18:00") return "월차";
  return text;
}

async function polish(env, text) {
  if (!env.AI || !text) return text;
  try {
    const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "user",
          content: `다음은 사교원 후진항 어촌신활력증진사업 SW매니저의 주간 업무 내용 원문이야. 공식 보고서에 어울리는 간결하고 격식있는 문체로 다듬어줘. 사실이나 내용은 절대 빠뜨리거나 지어내지 말고 단어 선택과 어미만 정돈해. 완전한 문장으로 늘일 필요 없이 개조식(명사형 종결)도 괜찮아. 항목이 여러 개면 줄바꿈으로 구분해서, 다듬은 결과만 출력해(설명이나 따옴표 없이):\n\n${text}`,
        },
      ],
    });
    return (result.response || text).trim();
  } catch {
    return text; // AI 실패해도 원문으로 진행
  }
}

// 기록이 없는 날(미래 포함) — 같은 주 다른 날 기록을 참고해서 AI가 추정. 반드시 확인/수정이 필요함을 전제로 함
async function inferTasks(env, w, knownTasksText) {
  if (!env.AI || !knownTasksText) return [];
  try {
    const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "user",
          content: `다음은 사교원 후진항 어촌신활력증진사업 SW매니저의 이번 주 업무 기록 중 일부야 (${w.label}(${w.dow}) 기록은 빠져 있음):\n\n${knownTasksText}\n\n이 흐름을 참고해서 ${w.label}(${w.dow})에 있었을 법한 업무를 1~2개, 짧고 개조식으로 추정해서 줄바꿈으로 구분해 출력해(설명이나 따옴표 없이). 확신이 안 서면 "일상 업무 수행" 정도로만 적어.`,
        },
      ],
    });
    return (result.response || "").trim().split("\n").map((t) => t.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function onRequestPost(context) {
  const { env } = context;
  try {
    const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const accessToken = await getAccessToken(serviceAccount);

    const range = encodeURIComponent(`${SHEET_TAB}!B:I`);
    const sheetRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!sheetRes.ok) {
      return new Response(JSON.stringify({ error: "구글시트 조회 실패", detail: await sheetRes.text() }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    const sheetData = await sheetRes.json();
    const allRows = sheetData.values || [];
    const weekdays = getThisWeekdays();

    const rawByDay = weekdays.map((w) => {
      const row = allRows.find((r) => (r[0] || "").trim() === w.label);
      return { w, row, rawTasks: (row?.[3] || "").trim() };
    });

    const knownTasksText = rawByDay
      .filter((d) => d.rawTasks)
      .map((d) => `${d.w.label}(${d.w.dow}): ${d.rawTasks}`)
      .join("\n");

    if (!knownTasksText) {
      return new Response(JSON.stringify({ error: "이번 주에 입력된 업무 기록이 아직 없습니다." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const days = [];
    const remarks = [];

    for (const { w, row, rawTasks } of rawByDay) {
      if (rawTasks) {
        const polished = await polish(env, rawTasks);
        days.push({
          date: w.label,
          dow: w.dow,
          tasks: polished.split("\n").map((t) => t.trim()).filter(Boolean),
          leave: toLeaveLabel(row?.[7]),
        });
      } else {
        const inferred = await inferTasks(env, w, knownTasksText);
        days.push({
          date: w.label,
          dow: w.dow,
          tasks: inferred,
          leave: "",
          inferred: true,
        });
        remarks.push(
          `${w.label}(${w.dow})은 기록이 없어 AI가 그 주 업무 흐름을 바탕으로 추정 작성함 — 확인 후 필요시 직접 수정 필요`
        );
      }
    }

    const first = weekdays[0];
    const last = weekdays[weekdays.length - 1];
    const pad = (n) => String(n).padStart(2, "0");
    const reportDate = `${last.year}-${pad(last.month)}-${pad(last.date)}`;

    const reportData = {
      report_date: reportDate,
      periodStart: `${first.year}년 ${first.month}월 ${first.date}일`,
      periodEnd: `${last.month}월 ${last.date}일`,
      position: "매니저",
      name: "이규영",
      participationRate: "100%",
      days,
      remarks,
    };

    const sbHeaders = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    };

    // 이번 주 보고서가 이미 있으면 갱신, 없으면 새로 생성 (같은 주에 여러 번 눌러도 중복 안 되게)
    const existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/weekly_reports?select=id&report_date=eq.${reportDate}`,
      { headers: sbHeaders }
    );
    const existing = existingRes.ok ? await existingRes.json() : [];

    let saveRes;
    if (existing.length > 0) {
      saveRes = await fetch(`${SUPABASE_URL}/rest/v1/weekly_reports?id=eq.${existing[0].id}`, {
        method: "PATCH",
        headers: sbHeaders,
        body: JSON.stringify({ report_data: reportData }),
      });
    } else {
      saveRes = await fetch(`${SUPABASE_URL}/rest/v1/weekly_reports`, {
        method: "POST",
        headers: sbHeaders,
        body: JSON.stringify({ report_date: reportDate, report_data: reportData }),
      });
    }

    if (!saveRes.ok) {
      return new Response(JSON.stringify({ error: "Supabase 저장 실패", detail: await saveRes.text() }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, report_date: reportDate, updated: existing.length > 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
