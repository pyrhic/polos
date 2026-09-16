// 프로젝트의 WBS를 날짜 축 기반 "진짜" 간트차트로 그려서, 연결된 구글시트의 "간트차트"/"R&R" 탭에 채워 넣음.
// (예전에 있던 나열식 "WBS" 탭은 간트차트와 내용이 겹쳐서 폐기 - 있으면 지움)
// - 맨 위 두 행: 프로젝트 전체 기간을 하루 단위 컬럼으로 나열(월 행 + 일 행, 날짜순 타임라인 축)
// - 마일스톤/업무마다 자기 행을 따로 가짐(겹쳐서 같은 행에 쌓이지 않음)
// - 각 업무 행의 시작일~마감일 구간 셀만 배경색을 칠해 막대처럼 보이게 함
// - 상태(D열)는 O(완료)/X(예정)/보류 중 하나를 시트에서 직접 골라 바꿀 수 있음(드롭다운) - 그 값을
//   앱으로 다시 가져오는 건 import-gantt-status.js가 맡음(완전 실시간 자동화는 앱스스크립트 설치가
//   필요해 일단 수동 "가져오기" 버튼 방식으로 감). 각 행 맨 끝(날짜 칸들 뒤)에 안 보이게 숨겨둔 업무
//   ID 칸이 있어서, 가져올 때 그 ID로 정확히 어느 업무인지 찾음(행 순서가 바뀌어도 안전).
// 인증 방식은 사교원 주간보고서 기능과 동일(서비스계정 JWT, POLOS_PROJECTS_GOOGLE_KEY)
const SUPABASE_URL = "https://oenqrlgmnkpzxsavnfyo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_sZ4wQgaC5f-i40pVzf0vIA_R7iJWDf5";
const LABEL_COLS = 7; // 구분 / WBS / 담당자 / 상태 / 마감일 / 진행률 / 산출물
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
function statusToSymbol(status) {
  if (status === "완료") return "O";
  if (status === "보류") return "보류";
  return "";
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
    const idColIdx = LABEL_COLS + dayCount; // 맨 끝 숨김 열 - 업무 ID(가져오기 매칭용)

    const colIndexForDate = (d) => LABEL_COLS + daysBetween(minDate, d);
    const colOf = (dateStr) => colIndexForDate(toUTCDate(dateStr));

    // 하위 업무는 기본적으로 자기 날짜가 없고(마일스톤만 날짜를 가짐) 그 마일스톤 기간에 속해 수행됨.
    // 그래서 하위 업무는 "자기 날짜가 따로 있으면 그걸 쓰고, 없으면 자기가 속한 마일스톤의 기간(직전
    // 마일스톤 다음날~이 마일스톤 날짜)"을 막대로 씀
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
    // 업무의 "마감일" 표시값 - 자기 날짜가 있으면 그걸, 없으면 소속 마일스톤 자체의 날짜(그 업무의
    // 실질적인 기한)를 씀. 간트차트의 마감일 칸과 R&R 탭에서 공통으로 씀
    function effectiveDue(t, m) {
      const own = t.due_date || t.start_date;
      if (own) return toUTCDate(own);
      const md = m.due_date || m.start_date;
      return md ? toUTCDate(md) : null;
    }

    // 헤더는 두 줄 - 위: 월(같은 달인 구간은 나중에 병합), 아래: 일(숫자만)
    const monthRow = ["", "", "", "", "", "", ""];
    const dayRow = ["구분", "WBS", "담당자", "상태", "마감일", "진행률", "산출물"];
    const monthGroups = []; // { year, month(0-based), startIdx, count } - 연속된 같은 달 구간
    for (let i = 0; i < dayCount; i++) {
      const d = new Date(minDate.getTime() + i * 86400000);
      dayRow.push(String(d.getUTCDate()));
      const y = d.getUTCFullYear();
      const mo = d.getUTCMonth();
      const last = monthGroups[monthGroups.length - 1];
      if (last && last.year === y && last.month === mo) {
        last.count++;
      } else {
        monthGroups.push({ year: y, month: mo, startIdx: i, count: 1 });
      }
    }
    monthGroups.forEach((g) => {
      monthRow[LABEL_COLS + g.startIdx] = `${g.month + 1}월`;
    });
    for (let i = monthRow.length; i < idColIdx; i++) monthRow.push("");
    monthRow.push("");
    dayRow.push("_id");

    const rows = [monthRow, dayRow];
    const colorRequests = []; // { rowIndex, startCol, endCol, color, textColor? }
    const boldDataRows = [];
    const allTaskRows = []; // R&R 탭에서 재사용 - { milestone, task }

    milestones.forEach((m) => {
      const rowIndex = rows.length;
      const total = flattenDescendants(m.id, []).filter((t) => !byParent.has(t.id)).length;
      const done = flattenDescendants(m.id, []).filter((t) => !byParent.has(t.id) && t.status === "완료").length;
      const pct = total ? `${Math.round((done / total) * 100)}%` : "";
      const mDueStr = m.due_date || m.start_date;
      const mDue = mDueStr ? toUTCDate(mDueStr) : null;
      const row = ["마일스톤", m.name, m.assignee || "", statusToSymbol(m.status), mDue ? shortLabel(mDue) : "", pct, m.deliverables || ""];
      for (let i = row.length; i < idColIdx; i++) row.push("");
      row.push(String(m.id));
      rows.push(row);
      boldDataRows.push(rowIndex);
      if (mDue) {
        const c = colOf(mDueStr);
        colorRequests.push({ rowIndex, startCol: c, endCol: c + 1, color: COLOR_MILESTONE });
      }
      const period = milestonePeriod.get(m.id);
      sortByDate(flattenDescendants(m.id, [])).forEach((t) => {
        allTaskRows.push({ milestone: m, task: t });
        const r = rows.length;
        const due = effectiveDue(t, m);
        const trow = ["", "  " + t.name, t.assignee || "", statusToSymbol(t.status), due ? shortLabel(due) : "", "", t.deliverables || ""];
        for (let i = trow.length; i < idColIdx; i++) trow.push("");
        trow.push(String(t.id));
        rows.push(trow);
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
      colorRequests.push({ rowIndex: 1, startCol: c, endCol: c + 1, color: COLOR_TODAY, textColor: WHITE });
    }

    // R&R 탭 - 담당자별로 그룹핑해서 각자의 업무/마감일/산출물만 모아 보여줌
    const byAssignee = new Map();
    allTaskRows.forEach(({ milestone, task }) => {
      const key = task.assignee || "미지정";
      if (!byAssignee.has(key)) byAssignee.set(key, []);
      byAssignee.get(key).push({ milestone, task });
    });
    const rrRows = [["담당자", "업무명", "마감일", "산출물"]];
    const rrBoldRows = [];
    [...byAssignee.keys()].sort((a, b) => a.localeCompare(b, "ko")).forEach((name) => {
      const items = byAssignee.get(name).sort((a, b) => {
        const da = effectiveDue(a.task, a.milestone);
        const db = effectiveDue(b.task, b.milestone);
        return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
      });
      rrBoldRows.push(rrRows.length);
      rrRows.push([name, "", "", ""]);
      items.forEach(({ milestone, task }) => {
        const due = effectiveDue(task, milestone);
        rrRows.push(["", task.name, due ? shortLabel(due) : "", task.deliverables || ""]);
      });
    });

    // 기존 "WBS"(폐기), "간트차트", "R&R" 탭 정리 - WBS는 완전히 없애고, 나머지 둘은 매번 깨끗하게 새로 만듦
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
    const findTab = (title) => (meta.sheets || []).find((s) => s.properties?.title === title);
    const existingWbs = findTab("WBS");
    const existingGantt = findTab("간트차트");
    const existingRR = findTab("R&R");

    const createReqs = [];
    if (existingWbs) createReqs.push({ deleteSheet: { sheetId: existingWbs.properties.sheetId } });
    if (existingGantt) createReqs.push({ deleteSheet: { sheetId: existingGantt.properties.sheetId } });
    if (existingRR) createReqs.push({ deleteSheet: { sheetId: existingRR.properties.sheetId } });
    createReqs.push({
      addSheet: {
        properties: { title: "간트차트", gridProperties: { frozenRowCount: 2, frozenColumnCount: LABEL_COLS } },
      },
    });
    createReqs.push({
      addSheet: {
        properties: { title: "R&R", gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } },
      },
    });
    const createRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: createReqs }),
    });
    if (!createRes.ok) return jsonRes({ error: "탭 생성 실패", detail: await createRes.text() }, 500);
    const created = await createRes.json();
    const addSheetReplies = (created.replies || []).filter((r) => r.addSheet);
    const ganttSheetId = addSheetReplies[0].addSheet.properties.sheetId;
    const rrSheetId = addSheetReplies[1].addSheet.properties.sheetId;

    const [ganttValuesRes, rrValuesRes] = await Promise.all([
      fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/간트차트!A1?valueInputOption=RAW`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: rows }),
      }),
      fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/R%26R!A1?valueInputOption=RAW`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: rrRows }),
      }),
    ]);
    if (!ganttValuesRes.ok) return jsonRes({ error: "간트차트 값 채우기 실패", detail: await ganttValuesRes.text() }, 500);
    if (!rrValuesRes.ok) return jsonRes({ error: "R&R 값 채우기 실패", detail: await rrValuesRes.text() }, 500);

    const formatReqs = [
      // 간트차트 - 라벨 열 너비
      {
        updateDimensionProperties: {
          range: { sheetId: ganttSheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
          properties: { pixelSize: 180 },
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: ganttSheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 },
          properties: { pixelSize: 90 },
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: ganttSheetId, dimension: "COLUMNS", startIndex: 3, endIndex: 6 },
          properties: { pixelSize: 55 },
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: ganttSheetId, dimension: "COLUMNS", startIndex: 6, endIndex: 7 },
          properties: { pixelSize: 160 },
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: ganttSheetId, dimension: "COLUMNS", startIndex: LABEL_COLS, endIndex: LABEL_COLS + dayCount },
          properties: { pixelSize: 34 },
          fields: "pixelSize",
        },
      },
      {
        // 숨김 업무 ID 열
        updateDimensionProperties: {
          range: { sheetId: ganttSheetId, dimension: "COLUMNS", startIndex: idColIdx, endIndex: idColIdx + 1 },
          properties: { hiddenByUser: true },
          fields: "hiddenByUser",
        },
      },
      {
        // 월 표시 행 - 굵게, 가운데 정렬(칸 병합은 아래 mergeReqs에서 따로 처리)
        repeatCell: {
          range: { sheetId: ganttSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: LABEL_COLS, endColumnIndex: LABEL_COLS + dayCount },
          cell: { userEnteredFormat: { horizontalAlignment: "CENTER", textFormat: { bold: true, fontSize: 8 } } },
          fields: "userEnteredFormat.horizontalAlignment,userEnteredFormat.textFormat",
        },
      },
      {
        // 일 표시 행 - 숫자만, 가운데 정렬
        repeatCell: {
          range: { sheetId: ganttSheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: LABEL_COLS, endColumnIndex: LABEL_COLS + dayCount },
          cell: { userEnteredFormat: { horizontalAlignment: "CENTER", textFormat: { bold: true, fontSize: 8 } } },
          fields: "userEnteredFormat.horizontalAlignment,userEnteredFormat.textFormat",
        },
      },
      {
        repeatCell: {
          range: { sheetId: ganttSheetId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: LABEL_COLS },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: "userEnteredFormat.textFormat.bold",
        },
      },
      {
        // 상태(D열) - O/X/보류 중 골라 넣는 드롭다운
        setDataValidation: {
          range: { sheetId: ganttSheetId, startRowIndex: 2, endRowIndex: rows.length, startColumnIndex: 3, endColumnIndex: 4 },
          rule: {
            condition: {
              type: "ONE_OF_LIST",
              values: [{ userEnteredValue: "O" }, { userEnteredValue: "X" }, { userEnteredValue: "보류" }],
            },
            showCustomUi: true,
            strict: false,
          },
        },
      },
      ...monthGroups
        .filter((g) => g.count > 1)
        .map((g) => ({
          mergeCells: {
            range: {
              sheetId: ganttSheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: LABEL_COLS + g.startIdx,
              endColumnIndex: LABEL_COLS + g.startIdx + g.count,
            },
            mergeType: "MERGE_COLUMNS",
          },
        })),
      ...boldDataRows.map((r) => ({
        repeatCell: {
          range: { sheetId: ganttSheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: LABEL_COLS },
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
            range: { sheetId: ganttSheetId, startRowIndex: cr.rowIndex, endRowIndex: cr.rowIndex + 1, startColumnIndex: cr.startCol, endColumnIndex: cr.endCol },
            cell,
            fields,
          },
        };
      }),
      // R&R - 열 너비 + 굵은 담당자 그룹 행
      {
        updateDimensionProperties: {
          range: { sheetId: rrSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 90 },
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: rrSheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
          properties: { pixelSize: 220 },
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: rrSheetId, dimension: "COLUMNS", startIndex: 3, endIndex: 4 },
          properties: { pixelSize: 160 },
          fields: "pixelSize",
        },
      },
      {
        repeatCell: {
          range: { sheetId: rrSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 4 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: "userEnteredFormat.textFormat.bold",
        },
      },
      ...rrBoldRows.map((r) => ({
        repeatCell: {
          range: { sheetId: rrSheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 4 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: "userEnteredFormat.textFormat.bold",
        },
      })),
    ];
    const formatRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: formatReqs }),
    });
    if (!formatRes.ok) return jsonRes({ error: "서식 적용 실패", detail: await formatRes.text() }, 500);

    // 최초 생성 여부를 기록해둠 - 앱에서 이 값이 있으면 "생성하기" 대신 "가져오기" 버튼만 보여줌
    if (!project.gantt_generated_at) {
      await fetch(`${SUPABASE_URL}/rest/v1/projects?id=eq.${project_id}`, {
        method: "PATCH",
        headers: sbHeaders,
        body: JSON.stringify({ gantt_generated_at: new Date().toISOString() }),
      });
    }

    return jsonRes({ success: true, sheet_url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=${ganttSheetId}` });
  } catch (err) {
    return jsonRes({ error: err.message }, 500);
  }
}
