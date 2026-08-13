// 한국은행 ECOS의 100대 주요 통계지표를 가져온다 (기준금리/물가지수/환율 등).
export async function onRequestGet(context) {
  const { env } = context;
  const apiKey = env.ECOS_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ECOS_API_KEY 환경변수가 설정되지 않았습니다" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const url = `https://ecos.bok.or.kr/api/KeyStatisticList/${apiKey}/json/kr/1/100`;
    const res = await fetch(url);
    if (!res.ok) {
      return new Response(JSON.stringify({ error: "ECOS 조회 실패", detail: await res.text() }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    const data = await res.json();
    const rows = (data.KeyStatisticList && data.KeyStatisticList.row) || [];
    const stats = rows.map((r) => ({
      name: r.KEYSTAT_NAME,
      value: r.DATA_VALUE,
      unit: r.UNIT_NAME,
      asOf: r.CYCLE,
    }));

    return new Response(JSON.stringify(stats), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
