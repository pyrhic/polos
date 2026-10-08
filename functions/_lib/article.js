// 기사 페이지에서 본문 텍스트와 사진/영상을 뽑는 공용 도구 (gemini-draft, article-media가 같이 씀)

export const decode = (s) => String(s || "")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#039;/g, "'").replace(/&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

export function isAllowedUrl(u) {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return false;
    const h = url.hostname;
    return !(h === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || h.endsWith(".local") || h.endsWith(".internal"));
  } catch {
    return false;
  }
}

// 일부 언론사(YTN, 국민일보 등)는 EUC-KR이라 UTF-8로 읽으면 글자가 깨진다. 헤더/메타의 charset대로 읽는다.
async function readHtml(res) {
  const buf = await res.arrayBuffer();
  let cs = ((res.headers.get("content-type") || "").match(/charset=([\w-]+)/i) || [])[1];
  if (!cs) {
    const head = new TextDecoder("latin1").decode(buf.slice(0, 4096));
    cs = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
  }
  try {
    return new TextDecoder((cs || "utf-8").toLowerCase()).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

const metaContent = (html, prop) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i"))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i"));
  return m ? decode(m[1]) : "";
};

const BAD_IMG = /logo|icon|sprite|banner|btn|button|\/ads?[\/_-]|profile|avatar|blank|pixel|emoticon/i;

// 사진(og:image + 본문 figure)과 영상(og:video, <video>, 파일 주소)을 찾는다.
// 유튜브 같은 외부 플레이어(embed)는 내려받지 않고 링크만 돌려준다.
export function extractMedia(rawHtml, pageUrl) {
  const images = [];
  const videos = [];
  const abs = (src) => { try { const u = new URL(decode(src), pageUrl).href; return /^https?:/.test(u) ? u : null; } catch { return null; } };
  const addImg = (src, caption) => {
    const u = abs(src);
    if (!u || /\.(svg|gif)(\?|$)/i.test(u) || BAD_IMG.test(u) || images.some((f) => f.url === u)) return;
    images.push({ type: "image", url: u, caption: decode(String(caption || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 120) });
  };
  const addVid = (src) => {
    const u = abs(src);
    if (!u || !/\.(mp4|webm)(\?|$)/i.test(u) || videos.some((f) => f.url === u)) return;
    videos.push({ type: "video", url: u, caption: "" });
  };
  const og = metaContent(rawHtml, "og:image");
  if (og) addImg(og);
  const body = rawHtml.match(/<article[\s\S]*?<\/article>/i)?.[0] || rawHtml;
  for (const m of body.matchAll(/<figure[\s\S]*?<\/figure>/gi)) {
    const img = m[0].match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i);
    const cap = m[0].match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
    if (img) addImg(img[1], cap ? cap[1] : "");
  }
  for (const p of ["og:video", "og:video:url", "og:video:secure_url"]) {
    const v = metaContent(rawHtml, p);
    if (v) addVid(v);
  }
  for (const m of body.matchAll(/<(?:video|source)[^>]+src=["']([^"']+)["']/gi)) addVid(m[1]);
  const embeds = [];
  for (const m of rawHtml.matchAll(/(?:youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/)([\w-]{6,})/g)) {
    const link = `https://www.youtube.com/watch?v=${m[1]}`;
    if (!embeds.includes(link)) embeds.push(link);
  }
  return { images: images.slice(0, 4), videos: videos.slice(0, 2), embeds: embeds.slice(0, 3) };
}

const stripTags = (h) => decode(h.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\n\s*/g, "\n").trim();

// 기사 본문 텍스트(사실 확인용 참고 자료)와 사진/영상 후보. 실패하면 빈 값을 돌려준다.
export async function fetchArticle(url, maxChars = 3500) {
  const empty = { text: "", images: [], videos: [], embeds: [] };
  if (!isAllowedUrl(url)) return empty;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return empty;
    const raw = await readHtml(res);
    const media = extractMedia(raw, res.url || url);
    let html = raw.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
    const article = html.match(/<article[\s\S]*?<\/article>/i);
    const scope = article ? article[0] : html;
    let paras = [...scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => stripTags(m[1]).replace(/\s+/g, " "))
      .filter((p) => p.length > 30);
    // <p>가 적거나 안 쓰는 사이트: 본문 영역(div) 시작 지점부터의 글을 줄 단위로 읽어 더 긴 쪽을 쓴다
    if (paras.join("").length < 600) {
      const m = html.match(/<(?:div|section)[^>]+(?:id|class)=["'][^"']*(?:articleBody|article_body|article-body|article_txt|news_body|newsct_article|view_con|content_body|cont_art)[^"']*["'][^>]*>/i);
      if (m) {
        const alt = stripTags(html.slice(m.index + m[0].length, m.index + m[0].length + 9000)).split("\n").map((l) => l.trim()).filter((l) => l.length > 30);
        if (alt.join("").length > paras.join("").length) paras = alt;
      }
    }
    // 그래도 부족하면 기사 요약(og:description)이라도 쓴다
    const desc = metaContent(raw, "og:description") || metaContent(raw, "description");
    if (desc && !paras.some((p) => p.includes(desc.slice(0, 30)))) paras.unshift(desc);
    return { text: paras.join("\n").slice(0, maxChars), ...media };
  } catch {
    return empty;
  } finally {
    clearTimeout(timer);
  }
}
