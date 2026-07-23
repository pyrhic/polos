const SHEET_ID = "1eDq93iuSBJ6fn_wY9iV3KDUAik7oHdZYDOSMsb94UrQ";
const SHEET_TAB = "근무일지 2026";

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
    scope: "https://www.googleapis.com/auth/spreadsheets",
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

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );

  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });

  if (!res.ok) {
    throw new Error("구글 인증 실패: " + (await res.text()));
  }
  const data = await res.json();
  return data.access_token;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const date = (body.date || "").trim();
    const dow = (body.dow || "").trim();
    const tasks = (body.tasks || "").trim();
    const leave = (body.leave || "").trim();

    if (!date || !tasks) {
      return new Response(JSON.stringify({ error: "날짜와 업무 내용은 필수입니다." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const accessToken = await getAccessToken(serviceAccount);

    // 시트는 연간 날짜/요일이 미리 채워진 템플릿이라, 새 행을 추가하지 않고
    // 해당 날짜의 기존 행을 찾아서 E(SW업무)/I(추가부재시간) 칸만 채워 넣는다.
    const readRange = encodeURIComponent(`${SHEET_TAB}!B:I`);
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${readRange}`;
    const readRes = await fetch(readUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!readRes.ok) {
      return new Response(JSON.stringify({ error: "구글시트 조회 실패", detail: await readRes.text() }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    const readData = await readRes.json();
    const allRows = readData.values || [];
    const rowIndex = allRows.findIndex((r) => (r[0] || "").trim() === date);

    if (rowIndex === -1) {
      return new Response(
        JSON.stringify({ error: `시트에서 ${date} 날짜 행을 찾을 수 없습니다. 시트를 직접 확인해주세요.` }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const sheetRowNumber = rowIndex + 1; // B:I 범위는 1행부터 시작하므로 인덱스+1이 실제 행 번호
    const existingRow = allRows[rowIndex] || [];
    const existingTasks = (existingRow[3] || "").trim(); // E열
    // overwrite=true면 수정(덮어쓰기), 아니면 기존 내용에 이어붙임(새 입력)
    const mergedTasks = body.overwrite || !existingTasks ? tasks : `${existingTasks}\n${tasks}`;

    async function updateCell(col, value) {
      const cellRange = encodeURIComponent(`${SHEET_TAB}!${col}${sheetRowNumber}`);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${cellRange}?valueInputOption=USER_ENTERED`;
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: [[value]] }),
      });
      if (!res.ok) {
        throw new Error(`${col}열 저장 실패: ${await res.text()}`);
      }
    }

    await updateCell("E", mergedTasks);
    if (leave) {
      await updateCell("I", leave);
    }

    return new Response(JSON.stringify({ success: true }), {
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
