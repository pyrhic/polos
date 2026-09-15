// 프로젝트 실적을 정리해서, 사람이 미리 만들어 공유해둔 구글독스에 결과보고서로 채워 넣음.
// 서비스계정이 새 파일을 스스로 못 만드는 제약(간트차트와 동일)이라 문서도 "사람이 만들어
// 공유 -> 링크 연결" 방식으로 감. 매번 문서 내용을 전부 지우고 새로 씀(재생성 방식).
// 인증은 간트차트 기능과 동일한 서비스계정(POLOS_PROJECTS_GOOGLE_KEY), 스코프만 documents로 다름
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

async function draftSummary(env, facts) {
  if (!env.AI) return "(직접 작성 필요)";
  try {
    const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "user",
          content: `다음은 사교원 후진항 어촌신활력증진사업의 한 프로젝트 실적 요약이야. 이 내용만 바탕으로 종합 평가 문단을 3~5문장, 공식 보고서에 어울리는 간결하고 격식있는 문체로 작성해줘. 사실을 지어내지 말고 주어진 내용에서만 판단해. 결과만 출력해(설명이나 따옴표 없이):\n\n${facts}`,
        },
      ],
    });
    return (result.response || "(직접 작성 필요)").trim();
  } catch {
    return "(직접 작성 필요)";
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;
  try {
    const { project_id } = await request.json();
    if (!project_id) return jsonRes({ error: "project_id가 필요합니다" }, 400);

    const serviceAccount = JSON.parse(env.POLOS_PROJECTS_GOOGLE_KEY);
    const accessToken = await getAccessToken(serviceAccount, ["https://www.googleapis.com/auth/documents"]);

    const sbHeaders = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    };

    const [pRes, tasksRes, teamRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/projects?select=*&id=eq.${project_id}`, { headers: sbHeaders }),
      fetch(`${SUPABASE_URL}/rest/v1/project_wbs_tasks?select=*&project_id=eq.${project_id}`, { headers: sbHeaders }),
      fetch(`${SUPABASE_URL}/rest/v1/project_team_members?select=*&project_id=eq.${project_id}&order=sort_order.asc`, {
        headers: sbHeaders,
      }),
    ]);
    const projects = await pRes.json();
    if (!projects.length) return jsonRes({ error: "프로젝트를 찾을 수 없습니다" }, 404);
    const project = projects[0];
    const docId = project.report_doc_id;
    if (!docId) return jsonRes({ error: "연결된 구글독스가 없습니다. 먼저 문서를 만들어 공유하고 연결해주세요." }, 400);
    const tasks = tasksRes.ok ? await tasksRes.json() : [];
    const team = teamRes.ok ? await teamRes.json() : [];

    const byParent = new Map();
    tasks.forEach((t) => {
      const key = t.parent_id ?? "root";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(t);
    });
    const dateKey = (t) => t.start_date || t.due_date || "9999-99-99";
    const sortByDate = (list) => [...list].sort((a, b) => dateKey(a).localeCompare(dateKey(b)) || a.id - b.id);
    function flattenDescendants(parentId, acc) {
      (byParent.get(parentId) || []).forEach((t) => {
        acc.push(t);
        flattenDescendants(t.id, acc);
      });
      return acc;
    }
    const milestones = sortByDate(byParent.get("root") || []);
    const allChildren = milestones.flatMap((m) => flattenDescendants(m.id, []));
    const doneChildren = allChildren.filter((t) => t.status === "완료");
    const pendingChildren = allChildren.filter((t) => t.status !== "완료");

    // ---- 문서 내용 블록 구성 ----
    const blocks = [];
    blocks.push({ text: `${project.name} 결과보고서`, style: "TITLE" });

    blocks.push({ text: "1. 사업 개요", style: "HEADING_1" });
    blocks.push({ text: `사업명: ${project.name}`, style: "NORMAL" });
    blocks.push({
      text: `추진기간: ${project.start_date || "-"} ~ ${project.due_date || "-"}`,
      style: "NORMAL",
    });
    blocks.push({
      text: `참여 인력: ${team.length ? team.map((m) => m.name + (m.role ? `(${m.role})` : "")).join(", ") : "(등록된 팀원 없음)"}`,
      style: "NORMAL",
    });

    blocks.push({ text: "2. 추진 배경 및 목적", style: "HEADING_1" });
    blocks.push({ text: project.description || "(작성 필요)", style: "NORMAL" });

    blocks.push({ text: "3. 추진 경과", style: "HEADING_1" });
    milestones.forEach((m) => {
      blocks.push({ text: `${m.name} (${m.due_date || "-"}) - ${m.status || ""}`, style: "HEADING_2" });
      const kids = sortByDate(flattenDescendants(m.id, []));
      if (!kids.length) {
        blocks.push({ text: "(하위 업무 없음)", style: "NORMAL" });
      } else {
        kids.forEach((t) => {
          const mark = t.status === "완료" ? "완료" : t.status || "예정";
          blocks.push({
            text: `${t.name} - ${mark}${t.deliverables ? " (" + t.deliverables + ")" : ""}`,
            style: "BULLET",
          });
        });
      }
    });

    blocks.push({ text: "4. 성과 및 산출물", style: "HEADING_1" });
    const deliverables = [...new Set(doneChildren.map((t) => t.deliverables).filter(Boolean))];
    if (deliverables.length) {
      deliverables.forEach((d) => blocks.push({ text: d, style: "BULLET" }));
    } else {
      blocks.push({ text: "(등록된 산출물 없음)", style: "NORMAL" });
    }

    blocks.push({ text: "5. 예산 집행 현황", style: "HEADING_1" });
    const budgetPlanned = tasks.reduce((s, t) => s + (Number(t.budget_planned) || 0), 0);
    const budgetActual = tasks.reduce((s, t) => s + (Number(t.budget_actual) || 0), 0);
    if (budgetPlanned || budgetActual || project.budget_estimate) {
      blocks.push({ text: `사업비 개요: ${project.budget_estimate || "-"}`, style: "NORMAL" });
      blocks.push({ text: `업무별 계획 합계: ${budgetPlanned.toLocaleString()}원`, style: "NORMAL" });
      blocks.push({ text: `업무별 집행 합계: ${budgetActual.toLocaleString()}원`, style: "NORMAL" });
    } else {
      blocks.push({ text: "(등록된 예산 데이터 없음)", style: "NORMAL" });
    }

    blocks.push({ text: "6. 참여 인력", style: "HEADING_1" });
    if (team.length) {
      team.forEach((m) => blocks.push({ text: `${m.name}${m.role ? " - " + m.role : ""}`, style: "BULLET" }));
    } else {
      blocks.push({ text: "(등록된 팀원 없음)", style: "NORMAL" });
    }

    blocks.push({ text: "7. 미비점 및 향후 과제", style: "HEADING_1" });
    if (pendingChildren.length) {
      pendingChildren.forEach((t) => blocks.push({ text: `${t.name} - ${t.status || "예정"}`, style: "BULLET" }));
    } else {
      blocks.push({ text: "(모든 업무 완료)", style: "NORMAL" });
    }

    blocks.push({ text: "8. 종합 평가", style: "HEADING_1" });
    const facts = [
      `추진기간 ${project.start_date || "-"}~${project.due_date || "-"}`,
      `전체 업무 ${allChildren.length}건 중 완료 ${doneChildren.length}건`,
      `산출물: ${deliverables.join(", ") || "없음"}`,
      `미완료 과제: ${pendingChildren.map((t) => t.name).join(", ") || "없음"}`,
    ].join("\n");
    blocks.push({ text: await draftSummary(env, facts), style: "NORMAL" });

    // ---- 구글독스에 반영 ----
    const docRes = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!docRes.ok) {
      return jsonRes(
        { error: "구글독스 접근 실패 - 편집자로 공유되어 있는지 확인해주세요", detail: await docRes.text() },
        500
      );
    }
    const doc = await docRes.json();
    const content = doc.body?.content || [];
    const bodyEndIndex = content.length ? content[content.length - 1].endIndex : 1;

    const requests = [];
    if (bodyEndIndex > 2) {
      requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: bodyEndIndex - 1 } } });
    }
    let cursor = 1;
    const styleRequests = [];
    blocks.forEach((b) => {
      const text = `${b.text}\n`;
      requests.push({ insertText: { location: { index: cursor }, text } });
      const range = { startIndex: cursor, endIndex: cursor + text.length };
      if (b.style === "TITLE" || b.style === "HEADING_1" || b.style === "HEADING_2") {
        styleRequests.push({
          updateParagraphStyle: { range, paragraphStyle: { namedStyleType: b.style }, fields: "namedStyleType" },
        });
      } else if (b.style === "BULLET") {
        styleRequests.push({
          createParagraphBullets: { range, bulletPreset: "BULLET_DISC_CIRCLE_SQUARE" },
        });
      }
      cursor += text.length;
    });

    const updateRes = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [...requests, ...styleRequests] }),
    });
    if (!updateRes.ok) return jsonRes({ error: "구글독스 갱신 실패", detail: await updateRes.text() }, 500);

    return jsonRes({ success: true, doc_url: `https://docs.google.com/document/d/${docId}/edit` });
  } catch (err) {
    return jsonRes({ error: err.message }, 500);
  }
}
