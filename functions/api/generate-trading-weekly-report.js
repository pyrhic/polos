const SHEET_ID = "1eDq93iuSBJ6fn_wY9iV3KDUAik7oHdZYDOSMsb94UrQ";
const SHEET_TAB = "근무일지 2026";
const SUPABASE_URL = "https://oenqrlgmnkpzxsavnfyo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_sZ4wQgaC5f-i40pVzf0vIA_R7iJWDf5";
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const GOAL_AMOUNT = 100000000; // 목표 1억

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
    weekdays.push({
      label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
      dow: DOW[d.getUTCDay()],
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      date: d.getUTCDate(),
    });
  }
  return weekdays;
}

function parseCell(raw) {
  const text = (raw || "").trim();
  const m = text.match(/^자산:\s*([\d,]+)/);
  if (!m) return { assets: null, journal: text };
  return { assets: Number(m[1].replace(/,/g, "")), journal: text.slice(m[0].length).replace(/^\n+/, "") };
}

async function generateInsights(env, journalText) {
  if (!env.AI || !journalText) return "";
  try {
    const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "user",
          content: `다음은 개인 주식 트레이딩 일지야. 숫자나 매매 판단을 새로 만들어내지 말고, 적힌 내용에서만 패턴이나 배울 점을 짧게 개조식으로 3개 이내로 뽑아줘(설명이나 따옴표 없이, 줄바꿈으로 구분):\n\n${journalText}`,
        },
      ],
    });
    return (result.response || "").trim();
  } catch {
    return "";
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

    const days = weekdays.map((w) => {
      const row = allRows.find((r) => (r[0] || "").trim() === w.label);
      const { assets, journal } = parseCell(row?.[6]);
      return { date: w.label, dow: w.dow, assets, journal };
    });

    const daysWithAssets = days.filter((d) => d.assets !== null);
    if (daysWithAssets.length === 0) {
      return new Response(JSON.stringify({ error: "이번 주에 입력된 총자산 기록이 아직 없습니다." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const currentAssets = daysWithAssets[daysWithAssets.length - 1].assets;

    const sbHeaders = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    };

    // 지난 주(과거 리포트 중 가장 최근) 종가 자산 조회 - 주간 수익률 계산 기준
    const first = weekdays[0];
    const last = weekdays[weekdays.length - 1];
    const pad = (n) => String(n).padStart(2, "0");
    const reportDate = `${last.year}-${pad(last.month)}-${pad(last.date)}`;

    const prevRes = await fetch(
      `${SUPABASE_URL}/rest/v1/trading_weekly_reports?select=report_data&archived=eq.false&report_date=lt.${reportDate}&order=report_date.desc&limit=1`,
      { headers: sbHeaders }
    );
    const prevRows = prevRes.ok ? await prevRes.json() : [];
    const prevAssets = prevRows[0]?.report_data?.currentAssets ?? null;

    let weeklyReturnPct = null;
    if (prevAssets && prevAssets > 0) {
      weeklyReturnPct = ((currentAssets - prevAssets) / prevAssets) * 100;
    }

    // 올해 말까지 1억 목표 달성을 위한 필요 일일 수익 계산
    const yearEnd = Date.UTC(last.year, 11, 31);
    const lastDateUtc = Date.UTC(last.year, last.month - 1, last.date);
    const remainingDays = Math.max(1, Math.round((yearEnd - lastDateUtc) / 86400000));
    const requiredDailyProfit = (GOAL_AMOUNT - currentAssets) / remainingDays;

    const journalText = days
      .filter((d) => d.journal)
      .map((d) => `${d.date}(${d.dow}): ${d.journal}`)
      .join("\n");
    const insights = await generateInsights(env, journalText);

    const reportData = {
      report_date: reportDate,
      periodStart: `${first.year}년 ${first.month}월 ${first.date}일`,
      periodEnd: `${last.month}월 ${last.date}일`,
      days,
      currentAssets,
      prevAssets,
      weeklyReturnPct,
      goalAmount: GOAL_AMOUNT,
      remainingDays,
      requiredDailyProfit,
      insights,
    };

    // 이번 주 리포트가 이미 있으면 갱신, 없으면 새로 생성
    const existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/trading_weekly_reports?select=id&report_date=eq.${reportDate}`,
      { headers: sbHeaders }
    );
    const existing = existingRes.ok ? await existingRes.json() : [];

    let saveRes;
    if (existing.length > 0) {
      saveRes = await fetch(`${SUPABASE_URL}/rest/v1/trading_weekly_reports?id=eq.${existing[0].id}`, {
        method: "PATCH",
        headers: sbHeaders,
        body: JSON.stringify({ report_data: reportData }),
      });
    } else {
      saveRes = await fetch(`${SUPABASE_URL}/rest/v1/trading_weekly_reports`, {
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
