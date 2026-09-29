// 투두리스트 "일정" 기능 - 지정한 날짜(+시간)에 구글 캘린더 이벤트를 만들고,
// 삭제 시 그 이벤트도 같이 지워서 항상 투두와 캘린더가 동기화되게 함.
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
    scope: "https://www.googleapis.com/auth/calendar.events",
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
  const { request, env } = context;
  try {
    const { title, date, time } = await request.json();
    if (!date) return jsonRes({ error: "날짜가 필요합니다." }, 400);
    if (!title?.trim()) return jsonRes({ error: "제목이 필요합니다." }, 400);
    if (!env.GOOGLE_CALENDAR_ID) return jsonRes({ error: "GOOGLE_CALENDAR_ID가 설정되어 있지 않습니다." }, 500);

    const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const accessToken = await getAccessToken(serviceAccount);
    const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

    let event;
    if (time) {
      const startDateTime = `${date}T${time}:00`;
      const start = new Date(`${startDateTime}+09:00`);
      const end = new Date(start.getTime() + 60 * 60 * 1000); // 기본 1시간
      event = {
        summary: title.trim(),
        start: { dateTime: startDateTime, timeZone: "Asia/Seoul" },
        end: { dateTime: end.toISOString().slice(0, 19), timeZone: "Asia/Seoul" },
      };
    } else {
      const endDate = new Date(`${date}T00:00:00+09:00`);
      endDate.setDate(endDate.getDate() + 1);
      event = {
        summary: title.trim(),
        start: { date },
        end: { date: endDate.toISOString().slice(0, 10) },
      };
    }

    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events`,
      { method: "POST", headers, body: JSON.stringify(event) }
    );
    if (!calRes.ok) return jsonRes({ error: "캘린더 등록 실패", detail: await calRes.text() }, 500);
    const created = await calRes.json();

    return jsonRes({ ok: true, eventId: created.id });
  } catch (err) {
    return jsonRes({ error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const { eventId } = await request.json();
    if (!eventId) return jsonRes({ error: "eventId가 필요합니다." }, 400);
    if (!env.GOOGLE_CALENDAR_ID) return jsonRes({ error: "GOOGLE_CALENDAR_ID가 설정되어 있지 않습니다." }, 500);

    const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const accessToken = await getAccessToken(serviceAccount);
    const headers = { Authorization: `Bearer ${accessToken}` };

    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE", headers }
    );
    // 이미 지워진 이벤트(410 Gone)는 성공으로 취급
    if (!calRes.ok && calRes.status !== 410 && calRes.status !== 404) {
      return jsonRes({ error: "캘린더 삭제 실패", detail: await calRes.text() }, 500);
    }

    return jsonRes({ ok: true });
  } catch (err) {
    return jsonRes({ error: err.message }, 500);
  }
}
