// 프로젝트의 WBS(마일스톤+하위업무)를 구글시트로 내보냄(없으면 새로 만들고, 있으면 전체 갱신).
// 서비스계정 인증은 사교원 주간보고서 기능(generate-weekly-report.js)과 같은 JWT 방식을 재사용하되,
// 이 기능은 시트를 새로 만들고 써야 해서 스코프를 spreadsheets(쓰기)+drive(공유)로 넓힘.
// 이 기능 전용 서비스계정 키(POLOS_PROJECTS_GOOGLE_KEY)를 씀 - 근무일지 쪽 키(GOOGLE_SERVICE_ACCOUNT_KEY)는 안 건드림
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

export async function onRequestPost(context) {
  const { env, request } = context;
  try {
    const { project_id, owner_email } = await request.json();
    if (!project_id) return jsonRes({ error: "project_id가 필요합니다" }, 400);

    const serviceAccount = JSON.parse(env.POLOS_PROJECTS_GOOGLE_KEY);
    const accessToken = await getAccessToken(serviceAccount, [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ]);

    const sbHeaders = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    };

    const [pRes, tasksRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/projects?select=*&id=eq.${project_id}`, { headers: sbHeaders }),
      fetch(
        `${SUPABASE_URL}/rest/v1/project_wbs_tasks?select=*&project_id=eq.${project_id}&order=sort_order.asc,id.asc`,
        { headers: sbHeaders }
      ),
    ]);
    const projects = await pRes.json();
    if (!projects.length) return jsonRes({ error: "프로젝트를 찾을 수 없습니다" }, 404);
    const project = projects[0];
    const tasks = tasksRes.ok ? await tasksRes.json() : [];

    // 트리 순서(마일스톤 → 하위업무, 들여쓰기)로 시트 행 구성
    const byParent = new Map();
    tasks.forEach((t) => {
      const key = t.parent_id ?? "root";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(t);
    });
    const sortKids = (list) => [...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id);
    const rows = [["구분", "업무명", "담당자", "시작일", "마감일", "상태", "진행률", "산출물"]];
    (function walk(parentKey, depth) {
      sortKids(byParent.get(parentKey) || []).forEach((t) => {
        rows.push([
          t.is_milestone ? "마일스톤" : "업무",
          "  ".repeat(depth) + t.name,
          t.assignee || "",
          t.start_date || "",
          t.due_date || "",
          t.status || "",
          t.is_milestone ? "" : t.status === "완료" ? "100%" : "0%",
          t.deliverables || "",
        ]);
        walk(t.id, depth + 1);
      });
    })("root", 0);

    let sheetId = project.gantt_sheet_id;

    if (!sheetId) {
      const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          properties: { title: `${project.name} - WBS` },
          sheets: [{ properties: { title: "WBS" } }],
        }),
      });
      if (!createRes.ok) return jsonRes({ error: "구글시트 생성 실패", detail: await createRes.text() }, 500);
      const created = await createRes.json();
      sheetId = created.spreadsheetId;

      if (owner_email) {
        await fetch(`https://www.googleapis.com/drive/v3/files/${sheetId}/permissions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ role: "writer", type: "user", emailAddress: owner_email }),
        });
      }

      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/projects?id=eq.${project_id}`, {
        method: "PATCH",
        headers: sbHeaders,
        body: JSON.stringify({ gantt_sheet_id: sheetId }),
      });
      if (!patchRes.ok) return jsonRes({ error: "sheet_id 저장 실패", detail: await patchRes.text() }, 500);
    }

    // 항목 수가 줄어도 이전 내용이 안 남게 전체 지우고 다시 씀
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/WBS:clear`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const updateRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/WBS!A1?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: rows }),
      }
    );
    if (!updateRes.ok) return jsonRes({ error: "구글시트 갱신 실패", detail: await updateRes.text() }, 500);

    return jsonRes({ success: true, sheet_url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit` });
  } catch (err) {
    return jsonRes({ error: err.message }, 500);
  }
}
