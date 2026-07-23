const SUPABASE_URL = "https://oenqrlgmnkpzxsavnfyo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_sZ4wQgaC5f-i40pVzf0vIA_R7iJWDf5";

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { password, action } = body;

    if (password !== env.ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: "비밀번호가 틀렸습니다." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    };

    // 숨김(archived) 처리된 기록만 정리 대상으로 삼는다.
    const listRes = await fetch(
      `${SUPABASE_URL}/rest/v1/weekly_reports?select=id,report_date&archived=eq.true&order=report_date.asc`,
      { headers }
    );
    if (!listRes.ok) {
      return new Response(JSON.stringify({ error: "조회 실패", detail: await listRes.text() }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    const rows = await listRes.json();

    if (rows.length === 0) {
      return new Response(JSON.stringify({ success: true, deleted: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    let idsToDelete;
    if (action === "delete100") {
      idsToDelete = rows.map((r) => r.id);
    } else if (action === "delete50") {
      const count = Math.ceil(rows.length / 2);
      idsToDelete = rows.slice(0, count).map((r) => r.id);
    } else {
      return new Response(JSON.stringify({ error: "알 수 없는 action입니다." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const idList = idsToDelete.join(",");
    const delRes = await fetch(`${SUPABASE_URL}/rest/v1/weekly_reports?id=in.(${idList})`, {
      method: "DELETE",
      headers,
    });

    if (!delRes.ok) {
      return new Response(JSON.stringify({ error: "삭제 실패", detail: await delRes.text() }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, deleted: idsToDelete.length }), {
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
