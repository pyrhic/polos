// "간트차트" 탭에서 사람이 직접 바꾼 상태(D열: O/X/보류)를 다시 앱(Supabase)으로 가져옴.
// 실시간 자동 동기화(앱스스크립트 onEdit 트리거)는 사용자의 1회 권한 승인이 별도로 필요해서
// 아직 안 쓰고, 이 버튼을 눌러야 반영되는 수동 방식으로 감.
// 각 행 맨 끝(날짜 칸들 뒤)에 숨겨둔 업무 ID로 정확히 어느 업무인지 매칭 - 행 순서가
// 바뀌거나 빈 행이 섞여도 안전함.
const SUPABASE_URL = "https://oenqrlgmnkpzxsavnfyo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_sZ4wQgaC5f-i40pVzf0vIA_R7iJWDf5";

function base64url(bytes) {
  let str;
  if (typeof bytes === "string") {
    str = btoa(bytes);
  } else {
    str = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  }
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(serviceAccount, scopes) {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: serviceAccount.client_email,
    scope: scopes.join(" "),
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

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

function symbolToStatus(cell) {
  const v = (cell || "").trim();
  if (v === "O") return "완료";
  if (v === "보류") return "보류";
  return "예정";
}

export async function onRequestPost(context) {
  const { env, request } = context;
  try {
    const { project_id } = await request.json();
    if (!project_id) return jsonRes({ error: "project_id가 필요합니다" }, 400);

    const serviceAccount = JSON.parse(env.POLOS_PROJECTS_GOOGLE_KEY);
    const accessToken = await getAccessToken(serviceAccount, ["https://www.googleapis.com/auth/spreadsheets"]);

    const sbHeaders = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    };

    const pRes = await fetch(`${SUPABASE_URL}/rest/v1/projects?select=gantt_sheet_id&id=eq.${project_id}`, {
      headers: sbHeaders,
    });
    const projects = await pRes.json();
    if (!projects.length) return jsonRes({ error: "프로젝트를 찾을 수 없습니다" }, 404);
    const sheetId = projects[0].gantt_sheet_id;
    if (!sheetId) return jsonRes({ error: "연결된 구글시트가 없습니다" }, 400);

    const valuesRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/간트차트!A1:ZZ5000`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!valuesRes.ok) {
      return jsonRes({ error: "구글시트 조회 실패 - 편집자로 공유되어 있는지 확인해주세요", detail: await valuesRes.text() }, 500);
    }
    const data = await valuesRes.json();
    const values = data.values || [];
    if (values.length < 3) return jsonRes({ error: "간트차트 탭에 데이터가 없습니다" }, 400);

    const updates = [];
    for (let r = 2; r < values.length; r++) {
      const row = values[r];
      if (!row || !row.length) continue;
      const taskId = row[row.length - 1];
      if (!taskId || Number.isNaN(Number(taskId))) continue;
      updates.push({ id: Number(taskId), status: symbolToStatus(row[3]) });
    }
    if (!updates.length) return jsonRes({ error: "가져올 업무를 찾지 못했습니다" }, 400);

    // 업무마다 개별 PATCH를 보내면 업무 수가 많을 때 Cloudflare Worker의 "하위 요청 개수 제한"에
    // 걸림 - id가 identity 컬럼이라 upsert도 안 돼서, DB 함수(RPC)로 한 번에 순수 UPDATE 처리
    // (bulk_update_task_status_migration.sql을 Supabase에 먼저 실행해둬야 함)
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/bulk_update_task_status`, {
      method: "POST",
      headers: sbHeaders,
      body: JSON.stringify({ updates }),
    });
    if (!rpcRes.ok) {
      return jsonRes({ error: "Supabase 반영 실패", detail: await rpcRes.text() }, 500);
    }

    return jsonRes({ success: true, updated: updates.length });
  } catch (err) {
    return jsonRes({ error: err.message }, 500);
  }
}
