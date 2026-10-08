// 이미 만든 콘티에 기사 사진/영상을 추가하기 위해, 기사 주소들에서 사진·영상 후보를 찾아 돌려준다.
import { fetchArticle, isAllowedUrl } from "../_lib/article.js";

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json" },
});

export async function onRequestPost(context) {
  try {
    const { articles } = await context.request.json();
    const list = (Array.isArray(articles) ? articles : []).filter((a) => a && isAllowedUrl(a.url)).slice(0, 5);
    if (!list.length) return json({ error: "기사 주소가 없습니다" }, 400);
    const fetched = await Promise.all(list.map((a) => fetchArticle(a.url, 200)));
    const media = [];
    const embeds = [];
    list.forEach((a, i) => {
      for (const m of [...fetched[i].images, ...fetched[i].videos]) {
        media.push({ type: m.type, url: m.url, caption: m.caption, source: a.source || "", articleUrl: a.url, articleTitle: a.title || "" });
      }
      for (const link of fetched[i].embeds) embeds.push({ link, source: a.source || "", articleUrl: a.url });
    });
    return json({ media, embeds }, 200);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
