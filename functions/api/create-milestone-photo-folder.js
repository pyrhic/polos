// 마일스톤(업무)별 사진 하위 폴더를 자동 생성 - 프로젝트의 메인 사진 폴더 안에 그 마일스톤
// 이름으로 된 하위 폴더를 만듦. 하위 폴더는 부모 폴더의 공유 권한을 그대로 물려받아서
// 따로 다시 공유할 필요 없음(구글드라이브 기본 동작). 프로젝트에 메인 사진 폴더가 아직
// 없으면(예전 프로젝트 등) 이 함수가 먼저 만들어둠.
const SUPABASE_URL = "https://oenqrlgmnkpzxsavnfyo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_sZ4wQgaC5f-i40pVzf0vIA_R7iJWDf5";
const OWNER_EMAIL = "pyrhic@gmail.com";

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

async function createFolder(accessToken, name, parentId) {
  const res = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function onRequestPost(context) {
  const { env, request } = context;
  try {
    const { project_id, task_id, milestone_name } = await request.json();
    if (!project_id || !task_id || !milestone_name) {
      return jsonRes({ error: "project_id, task_id, milestone_name이 필요합니다" }, 400);
    }

    const serviceAccount = JSON.parse(env.POLOS_PROJECTS_GOOGLE_KEY);
    const accessToken = await getAccessToken(serviceAccount, ["https://www.googleapis.com/auth/drive"]);

    // RLS가 프로젝트 멤버십을 기준으로 판단하므로, 고정 anon key가 아니라 호출한 사람의 로그인 토큰을 그대로 전달
    const userToken = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "") || SUPABASE_ANON_KEY;
    const sbHeaders = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
    };

    const pRes = await fetch(`${SUPABASE_URL}/rest/v1/projects?select=id,name,photo_folder_id&id=eq.${project_id}`, {
      headers: sbHeaders,
    });
    const projects = await pRes.json();
    if (!projects.length) return jsonRes({ error: "프로젝트를 찾을 수 없습니다" }, 404);
    const project = projects[0];

    let parentFolderId = project.photo_folder_id;
    if (!parentFolderId) {
      const mainFolder = await createFolder(accessToken, `사진 - ${project.name}`, null);
      parentFolderId = mainFolder.id;
      await fetch(`https://www.googleapis.com/drive/v3/files/${parentFolderId}/permissions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "writer", type: "user", emailAddress: OWNER_EMAIL }),
      });
      await fetch(`${SUPABASE_URL}/rest/v1/projects?id=eq.${project_id}`, {
        method: "PATCH",
        headers: sbHeaders,
        body: JSON.stringify({ photo_folder_id: parentFolderId }),
      });
    }

    const subFolder = await createFolder(accessToken, milestone_name, parentFolderId);

    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/project_wbs_tasks?id=eq.${task_id}`, {
      method: "PATCH",
      headers: sbHeaders,
      body: JSON.stringify({ photo_folder_id: subFolder.id }),
    });
    if (!patchRes.ok) return jsonRes({ error: "폴더 ID 저장 실패", detail: await patchRes.text() }, 500);

    return jsonRes({ success: true, folder_url: `https://drive.google.com/drive/folders/${subFolder.id}` });
  } catch (err) {
    return jsonRes({ error: err.message }, 500);
  }
}
