const DOC_ID = "1nqfrfCVw9HB0y7qi7eTOsIf3Ulg83ARAdsYboiFgY1w";

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
    scope: "https://www.googleapis.com/auth/documents.readonly",
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

function paragraphText(paragraph) {
  return (paragraph.elements || []).map((el) => el.textRun?.content || "").join("");
}

function hasHorizontalRule(paragraph) {
  return (paragraph.elements || []).some((el) => !!el.horizontalRule);
}

// 제목(Title 스타일)으로 시작해서 가로선으로 닫힌 글만 추출. 안 닫힌 글은 통째로 버림(비공개 처리)
function parseEssays(bodyContent) {
  const essays = [];
  let current = null;

  for (const item of bodyContent) {
    if (!item.paragraph) continue;
    const p = item.paragraph;
    const isTitle = p.paragraphStyle?.namedStyleType === "TITLE";
    const text = paragraphText(p);

    if (isTitle) {
      current = { title: text.trim(), paragraphs: [] };
      continue;
    }
    if (!current) continue;

    if (hasHorizontalRule(p)) {
      essays.push(current);
      current = null;
      continue;
    }

    current.paragraphs.push(text.replace(/\n$/, ""));
  }

  return essays;
}

function findTab(tabs, title) {
  for (const t of tabs || []) {
    if (t.tabProperties?.title === title) return t;
    if (t.childTabs) {
      const found = findTab(t.childTabs, title);
      if (found) return found;
    }
  }
  return null;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    const tabTitle = url.searchParams.get("tab");
    if (!tabTitle) {
      return new Response(JSON.stringify({ error: "tab 파라미터가 필요합니다." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const accessToken = await getAccessToken(serviceAccount);

    const res = await fetch(
      `https://docs.googleapis.com/v1/documents/${DOC_ID}?includeTabsContent=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      return new Response(JSON.stringify({ error: "문서 조회 실패", detail: await res.text() }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    const doc = await res.json();
    const tab = findTab(doc.tabs, tabTitle);
    if (!tab) {
      return new Response(JSON.stringify({ error: `"${tabTitle}" 탭을 찾을 수 없습니다.` }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const bodyContent = tab.documentTab?.body?.content || [];
    const essays = parseEssays(bodyContent).map((e) => {
      const paragraphs = e.paragraphs.slice();
      while (paragraphs.length && !paragraphs[0].trim()) paragraphs.shift();
      while (paragraphs.length && !paragraphs[paragraphs.length - 1].trim()) paragraphs.pop();
      return { title: e.title, paragraphs };
    });

    return new Response(JSON.stringify(essays), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
