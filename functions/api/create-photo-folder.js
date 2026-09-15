// 프로젝트를 만들 때 사진 업로드용 구글드라이브 폴더를 자동으로 만듦.
// 시트/독스와 달리 폴더는 용량(quota)을 안 써서 서비스계정이 스스로 만들 수 있음(구글시트/독스는
// 사람이 만들어 공유하는 방식이지만, 폴더만큼은 이 함수가 완전 자동으로 만들고 공유까지 함).
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

export async function onRequestPost(context) {
  const { env, request } = context;
  try {
    const { project_id, project_name } = await request.json();
    if (!project_id || !project_name) return jsonRes({ error: "project_id, project_name이 필요합니다" }, 400);

    const serviceAccount = JSON.parse(env.POLOS_PROJECTS_GOOGLE_KEY);
    const accessToken = await getAccessToken(serviceAccount, ["https://www.googleapis.com/auth/drive"]);

    const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `사진 - ${project_name}`,
        mimeType: "application/vnd.google-apps.folder",
      }),
    });
    if (!createRes.ok) return jsonRes({ error: "폴더 생성 실패", detail: await createRes.text() }, 500);
    const folder = await createRes.json();

    const shareRes = await fetch(`https://www.googleapis.com/drive/v3/files/${folder.id}/permissions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "writer", type: "user", emailAddress: OWNER_EMAIL }),
    });
    if (!shareRes.ok) return jsonRes({ error: "폴더 공유 실패", detail: await shareRes.text() }, 500);

    const sbHeaders = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    };
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/projects?id=eq.${project_id}`, {
      method: "PATCH",
      headers: sbHeaders,
      body: JSON.stringify({ photo_folder_id: folder.id }),
    });
    if (!patchRes.ok) return jsonRes({ error: "폴더 ID 저장 실패", detail: await patchRes.text() }, 500);

    return jsonRes({ success: true, folder_url: `https://drive.google.com/drive/folders/${folder.id}` });
  } catch (err) {
    return jsonRes({ error: err.message }, 500);
  }
}
