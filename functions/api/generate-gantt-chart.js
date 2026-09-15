// 프로젝트의 WBS를 날짜 축 기반 "진짜" 간트차트로 그려서, 연결된 구글시트의 "간트차트" 탭에 채워 넣음.
// (같은 시트의 "WBS" 탭은 나열식 표 그대로 두고, 이 탭은 매번 지우고 새로 만들어 깨끗하게 다시 그림)
// - 맨 위 행: 프로젝트 전체 기간을 하루 단위 컬럼으로 나열(날짜순 타임라인 축)
// - 마일스톤/업무마다 자기 행을 따로 가짐(겹쳐서 같은 행에 쌓이지 않음)
// - 각 업무 행의 시작일~마감일 구간 셀만 배경색을 칠해 막대처럼 보이게 함
// 인증 방식은 sync-gantt-sheet.js와 동일(서비스계정 JWT, POLOS_PROJECTS_GOOGLE_KEY)
const SUPABASE_URL = "https://oenqrlgmnkpzxsavnfyo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_sZ4wQgaC5f-i40pVzf0vIA_R7iJWDf5";
const LABEL_COLS = 4; // 구분 / 업무명 / 담당자 / 상태
const MAX_DAYS = 400;

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

function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}
const COLOR_DONE = hexToRgb("#3ecf8e"); // 완료 - 앱 상태뱃지와 동일한 초록
const COLOR_ACTIVE = hexToRgb("#8b7ff0"); // 진행중/기타 - 앱 강조색과 동일한 보라
const COLOR_MILESTONE = hexToRgb("#f2b84b"); // 마일스톤 마커 - 막대와 구분되는 골드
const COLOR_TODAY = hexToRgb("#e8362a"); // 오늘 표시 - 앱 타임라인의 오늘 표시와 동일한 빨강
const WHITE = { red: 1, green: 1, blue: 1 };

function toUTCDate(str) {
  return new Date(`${str}T00:00:00Z`);
}
function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function shortLabel(d) {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
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

    const [pRes, tasksRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/projects?select=*&id=eq.${project_id}`, { headers: sbHeaders }),
      fetch(`${SUPABASE_URL}/rest/v1/project_wbs_tasks?select=*&project_id=eq.${project_id}`, { headers: sbHeaders }),
    ]);
    const projects = await pRes.json();
    if (!projects.length) return jsonRes({ error: "프로젝트를 찾을 수 없습니다" }, 404);
    const project = projects[0];
    const sheetId = project.gantt_sheet_id;
    if (!sheetId) return jsonRes({ error: "연결된 구글시트가 없습니다. 먼저 시트를 만들어 공유하고 연결해주세요." }, 400);
    const tasks = tasksRes.ok ? await tasksRes.json() : [];

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
    if (!milestones.length) return jsonRes({ error: "생성된 마일스톤이 없습니다" }, 400);

    // 전체 날짜 범위(모든 업무의 시작일/마감일 중 최소~최대) - 이게 곧 간트차트의 가로축
    let minDate = null;
    let maxDate = null;
    tasks.forEach((t) => {
      [t.start_date, t.due_date].forEach((d) => {
        if (!d) return;
        const dt = toUTCDate(d);
        if (!minDate || dt < minDate) minDate = dt;
        if (!maxDate || dt > maxDate) maxDate = dt;
      });
    });
    if (!minDate || !maxDate) {
      return jsonRes({ error: "날짜 정보가 있는 업무가 없어 간트차트를 만들 수 없습니다" }, 400);
    }
    const dayCount = daysBetween(minDate, maxDate) + 1;
    if (dayCount > MAX_DAYS) {
      return jsonRes({ error: `기간이 너무 깁니다(${dayCount}일) - 간트차트를 만들 수 없습니다` }, 400);
    }

    const colIndexForDate = (d) => LABEL_COLS + daysBetween(minDate, d);
    const colOf = (dateStr) => colIndexForDate(toUTCDate(dateStr));

    const header = ["구분", "업무명", "담당자", "상태"];
    for (let i = 0; i < dayCount; i++) {
      header.push(shortLabel(new Date(minDate.getTime() + i * 86400000)));
    }
    const rows = [header];
    const colorRequests = []; // { rowIndex, startCol, endCol, color, textColor? }
    const boldDataRows = [];

    // 하위 업무는 기본적으로 자기 날짜가 없고(마일스톤만 날짜를 가짐) 그 마일스톤 기간에 속해 수행됨.
    // 그래서 하위 업무는 "자기 날짜가 따로 있으면 그걸 쓰고, 없으면 자기가 속한 마일스톤의 기간(직전
    // 마일스톤 다음날~이 마일스톤 날짜)"을 막대로 씀 - 그래야 같은 마일스톤 아래 업무들이 그 구간에
    // 나란히 걸쳐 보이고, 마일스톤이 바뀌면 막대 위치도 그 다음 구간으로 넘어감
    let prevMilestoneDate = null;
    const milestonePeriod = new Map(); // milestone.id -> { start: Date, end: Date }
    milestones.forEach((m) => {
      const mDateStr = m.due_date || m.start_date;
      if (!mDateStr) return;
      const end = toUTCDate(mDateStr);
      const start = prevMilestoneDate ? new Date(prevMilestoneDate.getTime() + 86400000) : end;
      milestonePeriod.set(m.id, { start, end });
      prevMilestoneDate = end;
    });

    milestones.forEach((m) => {
      const rowIndex = rows.length;
      rows.push(["마일스톤", m.name, "", m.status || ""]);
      boldDataRows.push(rowIndex);
      const mDate = m.due_date || m.start_date;
      if (mDate) {
        const c = colOf(mDate);
        colorRequests.push({ rowIndex, startCol: c, endCol: c + 1, color: COLOR_MILESTONE });
      }
      const period = milestonePeriod.get(m.id);
      sortByDate(flattenDescendants(m.id, [])).forEach((t) => {
        const r = rows.length;
        rows.push(["", "  " + t.name, t.assignee || "", t.status || ""]);
        let start = null;
        let end = null;
        if (t.start_date || t.due_date) {
          start = toUTCDate(t.start_date || t.due_date);
          end = toUTCDate(t.due_date || t.start_date);
        } else if (period) {
          start = period.start;
          end = period.end;
        }
        if (start && end) {
          const c1 = colIndexForDate(start);
          const c2 = colIndexForDate(end);
          colorRequests.push({
            rowIndex: r,
            startCol: Math.min(c1, c2),
            endCol: Math.max(c1, c2) + 1,
            color: t.status === "완료" ? COLOR_DONE : COLOR_ACTIVE,
          });
        }
      });
    });

    const today = todayUTC();
    if (today >= minDate && today <= maxDate) {
      const c = colIndexForDate(today);
      colorRequests.push({ rowIndex: 0, startCol: c, endCol: c + 1, color: COLOR_TODAY, textColor: WHITE });
    }

    // 기존 "간트차트" 탭이 있으면 지우고(형식까지 깨끗하게), 새로 만듦
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
    const existing = (meta.sheets || []).find((s) => s.properties?.title === "간트차트");

    const createReqs = [];
    if (existing) createReqs.push({ deleteSheet: { sheetId: existing.properties.sheetId } });
    createReqs.push({
      addSheet: {
        properties: {
          title: "간트차트",
          gridProperties: { frozenRowCount: 1, frozenColumnCount: LABEL_COLS },
        },
      },
    });
    const createRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: createReqs }),
    });
    if (!createRes.ok) return jsonRes({ error: "간트차트 탭 생성 실패", detail: await createRes.text() }, 500);
    const created = await createRes.json();
    const addSheetReply = (created.replies || []).find((r) => r.addSheet);
    const newSheetId = addSheetReply.addSheet.properties.sheetId;

    const valuesRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/간트차트!A1?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: rows }),
      }
    );
    if (!valuesRes.ok) return jsonRes({ error: "간트차트 값 채우기 실패", detail: await valuesRes.text() }, 500);

    const formatReqs = [
      {
        updateDimensionProperties: {
          range: { sheetId: newSheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
          properties: { pixelSize: 180 },
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: newSheetId, dimension: "COLUMNS", startIndex: LABEL_COLS, endIndex: LABEL_COLS + dayCount },
          properties: { pixelSize: 28 },
          fields: "pixelSize",
        },
      },
      {
        repeatCell: {
          range: { sheetId: newSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: LABEL_COLS, endColumnIndex: LABEL_COLS + dayCount },
          cell: { userEnteredFormat: { textRotation: { vertical: true }, textFormat: { bold: true, fontSize: 6 } } },
          fields: "userEnteredFormat.textRotation,userEnteredFormat.textFormat",
        },
      },
      {
        repeatCell: {
          range: { sheetId: newSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: LABEL_COLS },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: "userEnteredFormat.textFormat.bold",
        },
      },
      ...boldDataRows.map((r) => ({
        repeatCell: {
          range: { sheetId: newSheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: LABEL_COLS },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: "userEnteredFormat.textFormat.bold",
        },
      })),
      ...colorRequests.map((cr) => {
        const cell = { userEnteredFormat: { backgroundColor: cr.color } };
        let fields = "userEnteredFormat.backgroundColor";
        if (cr.textColor) {
          cell.userEnteredFormat.textFormat = { foregroundColor: cr.textColor, bold: true };
          fields += ",userEnteredFormat.textFormat.foregroundColor,userEnteredFormat.textFormat.bold";
        }
        return {
          repeatCell: {
            range: { sheetId: newSheetId, startRowIndex: cr.rowIndex, endRowIndex: cr.rowIndex + 1, startColumnIndex: cr.startCol, endColumnIndex: cr.endCol },
            cell,
            fields,
          },
        };
      }),
    ];
    const formatRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: formatReqs }),
    });
    if (!formatRes.ok) return jsonRes({ error: "간트차트 서식 적용 실패", detail: await formatRes.text() }, 500);

    return jsonRes({ success: true, sheet_url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=${newSheetId}` });
  } catch (err) {
    return jsonRes({ error: err.message }, 500);
  }
}
