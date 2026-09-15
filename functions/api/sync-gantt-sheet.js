// 프로젝트의 WBS(마일스톤+하위업무)를 사람이 미리 만들어 공유해둔 구글시트에 표로 채워 넣음.
// 서비스계정은 2022년 이후 구글 정책상 자체 드라이브 저장공간이 없어(storageQuota=0) 새 파일을
// 직접 만들 수 없음 - 그래서 새 시트 생성은 사람이 하고, 이 함수는 이미 공유받은 기존 시트에
// "WBS" 탭을 만들어(없으면) 내용만 채워 넣는 역할만 함.
// 서비스계정 인증은 사교원 주간보고서 기능(generate-weekly-report.js)과 같은 JWT 방식을 재사용.
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
    const { project_id } = await request.json();
    if (!project_id) return jsonRes({ error: "project_id가 필요합니다" }, 400);

    const serviceAccount = JSON.parse(env.POLOS_PROJECTS_GOOGLE_KEY);
    const accessToken = await getAccessToken(serviceAccount, [
      "https://www.googleapis.com/auth/spreadsheets",
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
    const sheetId = project.gantt_sheet_id;
    if (!sheetId) return jsonRes({ error: "연결된 구글시트가 없습니다. 먼저 시트를 만들어 공유하고 연결해주세요." }, 400);
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

    // 연결된 시트에 "WBS" 탭이 없으면 만들어둠 (기존 파일 안에서의 편집이라 저장공간 문제 없음)
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!metaRes.ok) {
      return jsonRes(
        { error: "구글시트 접근 실패 - 편집자로 공유되어 있는지 확인해주세요", detail: await metaRes.text() },
        500
      );
    }
    const meta = await metaRes.json();
    const hasWbsTab = (meta.sheets || []).some((s) => s.properties?.title === "WBS");
    if (!hasWbsTab) {
      const addTabRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: "WBS" } } }] }),
      });
      if (!addTabRes.ok) return jsonRes({ error: "WBS 탭 생성 실패", detail: await addTabRes.text() }, 500);
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
