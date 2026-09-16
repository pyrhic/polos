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

// 제미나이 호출 - youtube 자동화 쪽 gemini-script.js와 동일한 방식(GEMINI_API_KEY, 재시도 포함)
async function callGemini(env, prompt, fallback) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return fallback;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });
      if (res.ok) break;
      if (res.status !== 503 && res.status !== 429) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
    if (!res.ok) return fallback;
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? text.trim() : fallback;
  } catch {
    return fallback;
  }
}

// 만족도 조사(구글폼) 응답을 읽어서 정량(척도/객관식 평균)과 정성(주관식 답변)으로 나눔.
// 폼 자체는 사람이 직접 만들어 공유한 것 - 여긴 "이미 있는 폼의 응답 읽기"만 하므로
// 서비스계정 저장공간 문제와 무관함(새로 만들거나 복사하는 게 아니라 읽기만 함)
async function fetchSurveyEvaluation(serviceAccount, formId) {
  const token = await getAccessToken(serviceAccount, [
    "https://www.googleapis.com/auth/forms.body.readonly",
    "https://www.googleapis.com/auth/forms.responses.readonly",
  ]);
  const [formRes, respRes] = await Promise.all([
    fetch(`https://forms.googleapis.com/v1/forms/${formId}`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`https://forms.googleapis.com/v1/forms/${formId}/responses`, { headers: { Authorization: `Bearer ${token}` } }),
  ]);
  if (!formRes.ok || !respRes.ok) {
    throw new Error(`설문지 조회 실패 (${!formRes.ok ? await formRes.text() : await respRes.text()})`);
  }
  const form = await formRes.json();
  const respData = await respRes.json();
  const responses = respData.responses || [];

  // qMeta에 SCALE의 low~high, CHOICE의 전체 선택지 목록까지 담아둠 - 응답이 0건인 값도
  // 분포표에 "0건"으로 표시되게 하려면(구글폼 자체 응답 요약 화면과 같은 방식) 답변에만
  // 의존하지 않고 문항 구조에서 전체 값 목록을 미리 알아야 함
  const qMeta = new Map(); // questionId -> { title, type, categories }
  (form.items || []).forEach((item) => {
    const q = item.questionItem?.question;
    if (!q) return;
    if (q.scaleQuestion) {
      const { low, high } = q.scaleQuestion;
      const categories = [];
      for (let v = low; v <= high; v++) categories.push(String(v));
      qMeta.set(q.questionId, { title: item.title || "(제목 없음)", type: "SCALE", categories });
    } else if (q.choiceQuestion) {
      qMeta.set(q.questionId, {
        title: item.title || "(제목 없음)",
        type: "CHOICE",
        categories: (q.choiceQuestion.options || []).map((o) => o.value),
      });
    } else {
      qMeta.set(q.questionId, { title: item.title || "(제목 없음)", type: "TEXT" });
    }
  });

  const tallyByQ = new Map(); // qid -> Map(answerValue -> count)
  const textByQ = new Map();
  responses.forEach((r) => {
    Object.entries(r.answers || {}).forEach(([qid, ans]) => {
      const meta = qMeta.get(qid);
      if (!meta) return;
      (ans.textAnswers?.answers || []).forEach((a) => {
        if (meta.type === "SCALE" || meta.type === "CHOICE") {
          if (!tallyByQ.has(qid)) tallyByQ.set(qid, new Map());
          const t = tallyByQ.get(qid);
          t.set(a.value, (t.get(a.value) || 0) + 1);
        } else {
          if (!textByQ.has(qid)) textByQ.set(qid, []);
          textByQ.get(qid).push(a.value);
        }
      });
    });
  });

  // 정량 문항은 "평균 하나"가 아니라 각 값(1~5점 등)별 응답 수 분포로 - 응답이 1건뿐이어도
  // "몇 명 중 몇 명이 이 값을 골랐는지"가 그대로 의미를 가짐(평균만 내면 응답이 적을 때 의미가 없음)
  const quantitative = [...tallyByQ.entries()].map(([qid, tally]) => {
    const meta = qMeta.get(qid);
    const total = [...tally.values()].reduce((s, c) => s + c, 0);
    const dist = meta.categories.map((c) => ({ value: c, count: tally.get(c) || 0 }));
    const avg =
      meta.type === "SCALE"
        ? [...tally.entries()].reduce((s, [v, c]) => s + Number(v) * c, 0) / (total || 1)
        : null;
    return { title: meta.title, dist, total, avg };
  });
  const qualitative = [...textByQ.entries()].map(([qid, vals]) => ({
    title: qMeta.get(qid).title,
    answers: vals,
  }));

  return { responseCount: responses.length, quantitative, qualitative };
}

// 정량 문항 평균을 "그림"이 아니라 연결된 구글시트 안에 진짜 편집 가능한 차트로 만들어 넣음.
// (독스 API에는 "시트에 연결된 차트 삽입" 기능이 아예 없어서 - 그건 독스 UI에서 사람이 직접
// "삽입 > 차트 > 시트에서"를 눌러야만 되는 기능임. 대신 시트 안에는 API로 진짜 차트를 만들 수
// 있으니, 데이터+차트를 시트의 "설문결과" 탭에 만들어두고 보고서에는 그 탭 링크만 넣음 -
// 그러면 나중에 시트에서 직접 차트를 고칠 수 있음)
async function writeSurveyChartToSheet(accessToken, sheetId, quantitative) {
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!metaRes.ok) return null;
  const meta = await metaRes.json();
  const existing = (meta.sheets || []).find((s) => s.properties?.title === "설문결과");

  const createReqs = [];
  if (existing) createReqs.push({ deleteSheet: { sheetId: existing.properties.sheetId } });
  createReqs.push({ addSheet: { properties: { title: "설문결과" } } });
  const createRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: createReqs }),
  });
  if (!createRes.ok) return null;
  const created = await createRes.json();
  const addSheetReply = (created.replies || []).find((r) => r.addSheet);
  const newSheetId = addSheetReply.addSheet.properties.sheetId;

  // 문항마다 "제목 행 + 값/응답수/비율 표"를 세로로 쌓고, 그 표 옆(D열)에 그 문항만의 분포
  // 차트를 하나씩 앉힘 - 구글폼 자체 응답 요약 화면처럼 문항별로 분포가 따로 보이게 함
  const rows = [];
  const blocks = [];
  quantitative.forEach((q) => {
    const titleRow = rows.length;
    rows.push([q.title]);
    rows.push(["값", "응답 수", "비율"]);
    const dataStartRow = rows.length;
    q.dist.forEach((d) => {
      const pct = q.total ? Math.round((d.count / q.total) * 100) : 0;
      rows.push([d.value, d.count, `${pct}%`]);
    });
    blocks.push({ titleRow, dataStartRow, dataEndRow: rows.length });
    rows.push([]);
    rows.push([]);
  });

  const valuesRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/설문결과!A1?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: rows }),
    }
  );
  if (!valuesRes.ok) return null;

  const chartRequests = quantitative.map((q, i) => ({
    addChart: {
      chart: {
        spec: {
          title: q.title,
          basicChart: {
            chartType: "COLUMN",
            legendPosition: "NO_LEGEND",
            domains: [
              {
                domain: {
                  sourceRange: {
                    sources: [{ sheetId: newSheetId, startRowIndex: blocks[i].dataStartRow, endRowIndex: blocks[i].dataEndRow, startColumnIndex: 0, endColumnIndex: 1 }],
                  },
                },
              },
            ],
            series: [
              {
                series: {
                  sourceRange: {
                    sources: [{ sheetId: newSheetId, startRowIndex: blocks[i].dataStartRow, endRowIndex: blocks[i].dataEndRow, startColumnIndex: 1, endColumnIndex: 2 }],
                  },
                },
              },
            ],
          },
        },
        position: {
          overlayPosition: { anchorCell: { sheetId: newSheetId, rowIndex: blocks[i].titleRow, columnIndex: 3 }, widthPixels: 500, heightPixels: 300 },
        },
      },
    },
  }));
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: chartRequests }),
  });

  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=${newSheetId}`;
}

const MAX_REPORT_PHOTOS = 20;

// 사진 폴더(사람이 올린 실제 사진)에서 이미지 목록을 가져와, 문서에 끼워 넣을 수 있게 각 파일을
// "링크가 있는 모든 사용자가 보기" 권한으로 바꿈(독스가 서버에서 직접 이미지를 가져오려면 인증 없이
// 접근 가능해야 함). 폴더 자체는 이미 사람이 올린 파일이 있는 곳이라 저장공간 문제와 무관함
async function fetchFolderPhotos(accessToken, folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and mimeType contains 'image/' and trashed = false`);
  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&orderBy=name&pageSize=${MAX_REPORT_PHOTOS}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!listRes.ok) return [];
  const data = await listRes.json();
  const files = data.files || [];
  await Promise.all(
    files.map((f) =>
      fetch(`https://www.googleapis.com/drive/v3/files/${f.id}/permissions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      })
    )
  );
  return files.map((f) => ({ uri: `https://drive.google.com/uc?export=view&id=${f.id}`, name: f.name }));
}

export async function onRequestPost(context) {
  const { env, request } = context;
  try {
    const { project_id } = await request.json();
    if (!project_id) return jsonRes({ error: "project_id가 필요합니다" }, 400);

    const serviceAccount = JSON.parse(env.POLOS_PROJECTS_GOOGLE_KEY);
    const accessToken = await getAccessToken(serviceAccount, [
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets",
    ]);

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
    const bgPrompt = `다음은 사교원 후진항 어촌신활력증진사업의 한 프로젝트 정보야. 이 내용만 바탕으로 "추진 배경 및 목적" 문단을 2~4문장, 공식 보고서에 어울리는 간결하고 격식있는 문체로 작성해줘. 아래 내용에 없는 사실을 지어내지 마. 결과만 출력해(설명이나 따옴표 없이):\n\n사업명: ${project.name}\n메모: ${project.description || "(기록된 배경 메모 없음)"}`;
    blocks.push({
      text: await callGemini(env, bgPrompt, project.description || "(작성 필요)"),
      style: "NORMAL",
    });

    // 추진 경과는 세부 업무를 전부 나열하지 않고 마일스톤별 완료현황만 간단히 요약함(그건 기획서 몫) -
    // 결과보고서는 대신 (1) 행사 당일("실행" 마일스톤)에 실제 있었던 일, (2) 예산이 실제로 걸린
    // 사전준비 업무만 따로 짚어서 "실제로 무슨 일이 있었는지"에 집중되게 함
    blocks.push({ text: "3. 추진 경과", style: "HEADING_1" });
    milestones.forEach((m) => {
      const kids = flattenDescendants(m.id, []);
      const total = kids.length;
      const done = kids.filter((t) => t.status === "완료").length;
      blocks.push({
        text: `${m.name} (${m.due_date || "-"}) - ${total ? `${done}/${total} 완료` : m.status || ""}`,
        style: "BULLET",
      });
    });

    const eventMilestone = milestones.find((m) => m.name === "실행");
    if (eventMilestone) {
      blocks.push({ text: "행사 당일 진행 내용", style: "HEADING_2" });
      const eventTasks = sortByDate(flattenDescendants(eventMilestone.id, []));
      if (eventTasks.length) {
        eventTasks.forEach((t) => {
          blocks.push({
            text: `${t.name} - ${t.status === "완료" ? "완료" : t.status || "예정"}${t.deliverables ? " (" + t.deliverables + ")" : ""}`,
            style: "BULLET",
          });
        });
      } else {
        blocks.push({ text: "(등록된 세부 내용 없음)", style: "NORMAL" });
      }
    }

    const bigBudgetTasks = allChildren
      .filter((t) => (Number(t.budget_actual) || Number(t.budget_planned) || 0) > 0)
      .sort((a, b) => (Number(b.budget_actual) || Number(b.budget_planned) || 0) - (Number(a.budget_actual) || Number(a.budget_planned) || 0));
    if (bigBudgetTasks.length) {
      blocks.push({ text: "주요 예산 집행 사전준비", style: "HEADING_2" });
      bigBudgetTasks.forEach((t) => {
        const amount = Number(t.budget_actual) || Number(t.budget_planned) || 0;
        blocks.push({ text: `${t.name} - ${amount.toLocaleString()}원`, style: "BULLET" });
      });
    }

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

    blocks.push({ text: "7. 주요성과", style: "HEADING_1" });
    if (!project.survey_form_id) {
      blocks.push({ text: "(연결된 만족도 조사가 없습니다)", style: "NORMAL" });
    } else {
      let survey = null;
      try {
        survey = await fetchSurveyEvaluation(serviceAccount, project.survey_form_id);
      } catch (err) {
        blocks.push({ text: `(만족도 조사 조회 실패: ${err.message})`, style: "NORMAL" });
      }
      if (survey && !survey.responseCount) {
        blocks.push({ text: "(설문 응답이 아직 없습니다)", style: "NORMAL" });
      } else if (survey) {
        blocks.push({ text: `총 응답 ${survey.responseCount}건`, style: "NORMAL" });
        const distSummary = (q) => q.dist.map((d) => `${d.value} ${d.count}건`).join(", ");
        survey.quantitative.forEach((q) => {
          const summary = q.avg !== null ? `평균 ${q.avg.toFixed(1)}점 (${q.total}건) - ${distSummary(q)}` : distSummary(q);
          blocks.push({ text: `${q.title} - ${summary}`, style: "BULLET" });
        });
        if (survey.quantitative.length) {
          if (!project.survey_sheet_id) {
            blocks.push({ text: "(그래프를 만들려면 먼저 설문 결과용 구글시트를 연결해주세요)", style: "NORMAL" });
          } else {
            const chartUrl = await writeSurveyChartToSheet(accessToken, project.survey_sheet_id, survey.quantitative);
            if (chartUrl) {
              blocks.push({ style: "LINK", text: "만족도 조사 결과 그래프 (구글시트에서 보기/수정) →", url: chartUrl });
            }
          }
        }
        survey.qualitative.forEach((q) => {
          blocks.push({ text: q.title, style: "HEADING_2" });
          q.answers.slice(0, 15).forEach((a) => blocks.push({ text: a, style: "BULLET" }));
        });
        const evalFacts = [
          `총 응답 ${survey.responseCount}건`,
          ...survey.quantitative.map((q) => `${q.title}: ${q.avg !== null ? `평균 ${q.avg.toFixed(1)}점, ` : ""}분포 ${distSummary(q)}`),
          ...survey.qualitative.map((q) => `${q.title} 주관식 답변: ${q.answers.slice(0, 10).join(" / ")}`),
        ].join("\n");
        const evalPrompt = `다음은 사교원 후진항 어촌신활력증진사업의 한 프로젝트 만족도 조사 결과야. 이 내용만 바탕으로 정량적 평가(평점 수준)와 정성적 평가(주관식 의견 경향)를 나눠서 3~6문장, 공식 보고서에 어울리는 간결하고 격식있는 문체로 작성해줘. 사실을 지어내지 말고 주어진 내용에서만 판단해. 결과만 출력해(설명이나 따옴표 없이):\n\n${evalFacts}`;
        blocks.push({ text: await callGemini(env, evalPrompt, "(직접 작성 필요)"), style: "NORMAL" });
      }
    }

    blocks.push({ text: "8. 종합 평가", style: "HEADING_1" });
    const facts = [
      `추진기간 ${project.start_date || "-"}~${project.due_date || "-"}`,
      `전체 업무 ${allChildren.length}건 중 완료 ${doneChildren.length}건`,
      `산출물: ${deliverables.join(", ") || "없음"}`,
      `미완료 과제: ${pendingChildren.map((t) => t.name).join(", ") || "없음"}`,
    ].join("\n");
    const summaryPrompt = `다음은 사교원 후진항 어촌신활력증진사업의 한 프로젝트 실적 요약이야. 이 내용만 바탕으로 종합 평가 문단을 3~5문장, 공식 보고서에 어울리는 간결하고 격식있는 문체로 작성해줘. 사실을 지어내지 말고 주어진 내용에서만 판단해. 결과만 출력해(설명이나 따옴표 없이):\n\n${facts}`;
    blocks.push({ text: await callGemini(env, summaryPrompt, "(직접 작성 필요)"), style: "NORMAL" });

    blocks.push({ text: "9. 사진", style: "HEADING_1" });
    if (!project.photo_folder_id) {
      blocks.push({ text: "(연결된 사진 폴더가 없습니다)", style: "NORMAL" });
    } else {
      const photos = await fetchFolderPhotos(accessToken, project.photo_folder_id);
      if (!photos.length) {
        blocks.push({ text: "(폴더에 등록된 사진이 없습니다)", style: "NORMAL" });
      } else {
        photos.forEach((p) => {
          blocks.push({ style: "IMAGE", uri: p.uri, caption: p.name });
        });
      }
    }

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
      if (b.style === "IMAGE") {
        requests.push({
          insertInlineImage: {
            uri: b.uri,
            location: { index: cursor },
            objectSize: { width: { magnitude: 350, unit: "PT" } },
          },
        });
        cursor += 1;
        const capText = `${b.caption}\n`;
        requests.push({ insertText: { location: { index: cursor }, text: capText } });
        cursor += capText.length;
        return;
      }
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
      } else if (b.style === "LINK") {
        styleRequests.push({
          updateTextStyle: {
            range: { startIndex: cursor, endIndex: cursor + b.text.length },
            textStyle: { link: { url: b.url } },
            fields: "link",
          },
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
