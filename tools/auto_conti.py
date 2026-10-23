"""정해진 요일에 Claude 루틴이 콘티를 하나 만들 때 쓰는 도구 (파이썬 표준 라이브러리만, 비밀값 필요 없음).

앱의 "콘티 만들기" 팝업(youtube/conti-create-modal.js)에서 기사를 골라 "콘티 생성"을 누른 것과 똑같이 만든다:
빈 콘티 행(create_status=queued) → Supabase Edge Function create-conti → 서버가 Gemini로 대본·장면·기사 사진을 채운다.
루틴이 만든 콘티는 video_settings.auto_upload = true (영상 생성을 누르면 다 된 뒤 비공개로 자동 업로드), created_by = "routine".
이 도구는 영상 생성·업로드·공개를 하지 않는다.

사용법 (polos 폴더에서):
  python tools/auto_conti.py recent
      최근 콘티 30개의 이름·주제를 JSON으로 (같은 주제를 또 만들지 않으려고)
  python tools/auto_conti.py search "검색어"
      구글 뉴스 검색(Edge Function news-search, 최근 1주, 최대 5건) 결과를 JSON으로
  python tools/auto_conti.py create --topic "주제" --note "방향 메모" --articles articles.json [--channel 2] [--mood bright]
      articles.json = [{"title": "...", "url": "https://...", "source": "매체명"}, ...] (1~5건, search 결과를 그대로 써도 된다)
      다 만들어질 때까지 기다린다(최대 약 5분). 실패하면 한 번 다시 만든다(앱의 "다시 만들기"와 같다). 결과를 JSON으로 출력.

주소·키는 config.js(SUPABASE_URL, SUPABASE_ANON_KEY — 공개해도 되는 publishable 키)에서 읽는다.
  환경변수 POLOS_CONFIG_JS  다른 config.js 경로 (시험용)
           POLOS_BASE_URL   앱 주소 (기본 https://polos-cxn.pages.dev — 결과의 열기 링크용)
종료 코드: 0 성공, 1 실패(이유는 stderr와 결과 JSON의 error).
"""
import argparse
import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_JS = os.environ.get("POLOS_CONFIG_JS") or os.path.join(ROOT, "config.js")
BASE_URL = (os.environ.get("POLOS_BASE_URL") or "https://polos-cxn.pages.dev").rstrip("/")
MAX_ARTICLES = 5                 # conti-create-modal.js MAX_ARTICLES
RECENT_LIMIT = 30
POLL_SEC = float(os.environ.get("AUTO_CONTI_POLL_SEC") or 5)
WAIT_SEC = float(os.environ.get("AUTO_CONTI_WAIT_SEC") or 300)
TIMEOUT = 40


def load_config(path=CONFIG_JS):
    text = open(path, encoding="utf-8").read()
    url = re.search(r"SUPABASE_URL\s*:\s*[\"']([^\"']+)[\"']", text)
    key = re.search(r"SUPABASE_ANON_KEY\s*:\s*[\"']([^\"']+)[\"']", text)
    if not url or not key:
        raise SystemExit(f"config.js에서 SUPABASE_URL / SUPABASE_ANON_KEY를 찾지 못했습니다: {path}")
    return url.group(1).rstrip("/"), key.group(1)


class Client:
    def __init__(self, url, key):
        self.url, self.key = url, key
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def _call(self, full_url, method="GET", body=None, extra=None, timeout=TIMEOUT):
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(full_url, data=data, method=method, headers={**self.headers, **(extra or {})})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace")

    def rest(self, path, method="GET", body=None, prefer=None, what="요청"):
        status, text = self._call(f"{self.url}/rest/v1/{path}", method, body, {"Prefer": prefer} if prefer else None)
        if status >= 400:
            raise RuntimeError(f"{what} 실패 ({status}): {text[:300]}")
        return json.loads(text) if text.strip() else None

    def fn(self, name, body, timeout=TIMEOUT):
        """Supabase Edge Function. (status, json 또는 None)"""
        status, text = self._call(f"{self.url}/functions/v1/{name}", "POST", body, timeout=timeout)
        try:
            data = json.loads(text) if text.strip() else None
        except ValueError:
            data = None
        return status, data


def out(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


# ───── recent ─────
def cmd_recent(c):
    rows = c.rest(f"youtube_scripts?select=id,created_at,category,hook,video_settings,create_request,create_status&order=created_at.desc&limit={RECENT_LIMIT}",
                  what="최근 콘티 읽기") or []
    items = []
    for r in rows:
        vs = r.get("video_settings") or {}
        req = r.get("create_request") or {}
        items.append({
            "id": r.get("id"),
            "created_at": r.get("created_at"),
            "name": vs.get("name") or (r.get("hook") or "")[:20],
            "topic": req.get("topic") or req.get("title") or "",
            "hook": (r.get("hook") or "")[:80],
            "category": r.get("category"),
            "channel_slot": vs.get("channel_slot"),
            "created_by": vs.get("created_by") or "",
            "create_status": r.get("create_status"),
        })
    out(items)
    return 0


# ───── search ─────
def cmd_search(c, query):
    q = (query or "").strip()
    if not q:
        print("검색어를 주세요", file=sys.stderr)
        return 1
    status, data = c.fn("news-search", {"q": q})
    if status != 200 or not isinstance(data, dict):
        err = (data or {}).get("error") if isinstance(data, dict) else None
        print(f"뉴스 검색 실패 ({status}): {err or ''}", file=sys.stderr)
        out({"query": q, "error": err or f"HTTP {status}", "items": []})
        return 1
    items = [{"title": a.get("title", ""), "url": a.get("url", ""), "source": a.get("source", ""), "date": a.get("date", "")}
             for a in (data.get("items") or [])][:MAX_ARTICLES]
    out({"query": q, "items": items})
    return 0


# ───── create ─────
def base_settings(d):
    """conti-create-modal.js baseSettings: 기본값의 자막 위치가 framed 기준이면 framed로 만든다."""
    d = dict(d or {})
    if d.get("caption_position_pct") is not None and d.get("layout") != "full":
        d["layout"] = "framed"
    return d


def card_voice_settings(card):
    """conti-core.js ContiCore.cardVoiceSettings(card) (새 콘티라 prev 없음)."""
    v = (card or {}).get("voice")
    name = str(v.get("name") or "").strip() if isinstance(v, dict) else ""
    if name and v.get("voice"):
        def num(x):
            try:
                n = float(x)
                return int(n) if n.is_integer() else n
            except (TypeError, ValueError):
                return 0
        return {"tts_voice": str(v["voice"]), "tts_rate": num(v.get("rate")), "tts_pitch": num(v.get("pitch")), "voice_name": name[:20], "voice_sync": True}
    return {}


def slug_of(topic):
    """conti-create-modal.js slugOf: 오늘(UTC) 날짜 + 주제에서 글자·숫자가 아닌 것은 - 로, 20자."""
    return f"{datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')}_{re.sub(r'[\W_]+', '-', topic)[:20]}"


def load_articles(path):
    raw = json.load(open(path, encoding="utf-8"))
    if isinstance(raw, dict):
        raw = raw.get("items") or []   # search 결과를 그대로 넣어도 된다
    arts = []
    for a in raw if isinstance(raw, list) else []:
        if not isinstance(a, dict):
            continue
        title, url = str(a.get("title") or "").strip(), str(a.get("url") or "").strip()
        if title and re.match(r"^https?://", url):
            arts.append({"title": title, "url": url, "source": str(a.get("source") or "").strip()})
    if not arts:
        raise SystemExit("기사가 없습니다 — articles.json에 title·url이 있는 기사를 1~5건 넣으세요")
    return arts[:MAX_ARTICLES]


def pick_default_card(cards):
    """팝업처럼 ★ 기본 카드, 없으면 목록의 첫 카드(브라우저 select의 첫 옵션)."""
    return next((c for c in cards if c.get("is_default")), cards[0] if cards else None)


def make_placeholder(c, topic, note, articles, slot, mood=""):
    chs = c.rest("youtube_channels?select=slot,label,ready,source&order=sort_order.asc,slot.asc", what="채널 읽기") or []
    ch = next((x for x in chs if str(x.get("slot")) == str(slot)), None)
    if not ch:
        raise RuntimeError(f"채널 {slot}번이 youtube_channels에 없습니다")
    channel_slot = int(ch["slot"])
    cards = c.rest(f"youtube_subscribe_cards?select=*&channel_slot=eq.{channel_slot}&order=sort_order.asc,id.asc", what="채널 카드 읽기") or []
    card = pick_default_card(cards)
    dflt = c.rest("youtube_default_settings?select=settings&id=eq.1", what="기본 설정 읽기") or []
    defaults = (dflt[0].get("settings") if dflt else None) or {}
    card_settings = {"channel_slot": channel_slot}
    if card:
        card_settings.update({"subscribe_card_id": card["id"], "channel_slot": card.get("channel_slot")})
    settings = {**base_settings(defaults), **card_settings, **card_voice_settings(card),
                "auto_upload": True, "created_by": "routine"}
    name = topic
    request = {
        "kind": "news", "topic": topic, "articles": articles, "note": note, "traffic": "", "geo": "",
        "mood": mood or "",
        "card_id": card["id"] if card else None,
        "channel_slot": card.get("channel_slot") if card else channel_slot,
    }
    rows = c.rest("youtube_scripts", "POST", {
        "category": "뉴스/이슈", "hook": name, "story": "", "closing": "", "fact_sources": "", "status": "approved",
        "slug": slug_of(name), "video_settings": {**settings, "name": name[:40]},
        "create_status": "queued", "create_request": request,
    }, prefer="return=representation", what="콘티 행 만들기")
    return rows[0], ch, card


def start_server(c, script_id):
    status, data = c.fn("create-conti", {"script_id": int(script_id)}, timeout=25)
    if status == 202:
        return None
    ours = isinstance(data, dict) and data.get("from") == "create-conti"
    err = (data or {}).get("error") if isinstance(data, dict) else None
    if not ours:
        return f"create-conti 함수를 부르지 못했습니다 (HTTP {status}) — 배포·Verify JWT 설정 확인"
    return err or f"create-conti 거절 (HTTP {status})"


def wait_done(c, script_id):
    deadline = time.time() + WAIT_SEC
    row = None
    while time.time() < deadline:
        rows = c.rest(f"youtube_scripts?select=id,create_status,create_error,video_settings,hook&id=eq.{int(script_id)}", what="상태 확인") or []
        row = rows[0] if rows else None
        if not row:
            return {"create_status": "missing", "create_error": "콘티가 지워졌습니다"}
        if row.get("create_status") in ("done", "error"):
            return row
        time.sleep(POLL_SEC)
    return {**(row or {}), "create_status": "timeout", "create_error": f"{int(WAIT_SEC)}초 안에 끝나지 않았습니다 (서버에서 계속 만들 수 있으니 앱에서 확인하세요)"}


def retry_reset(c, script_id):
    """storyboard.html retryConti와 같다: 대기 중으로 되돌린 뒤 다시 맡긴다."""
    c.rest(f"youtube_scripts?id=eq.{int(script_id)}", "PATCH",
           {"create_status": "queued", "create_error": None, "create_started_at": now_iso()}, what="다시 만들기 준비")


def run_job(c, script_id, log):
    final = None
    for attempt in (1, 2):
        if attempt == 2:
            log(f"실패해서 한 번 다시 만듭니다: {final.get('create_error')}")
            retry_reset(c, script_id)
        err = start_server(c, script_id)
        if err:
            final = {"create_status": "error", "create_error": err}
            if attempt == 1 and "부르지 못했습니다" not in err:
                continue
            break
        final = wait_done(c, script_id)
        if final.get("create_status") == "done" or final.get("create_status") in ("timeout", "missing"):
            break
    return final, attempt


def cmd_create(c, args):
    topic = (args.topic or "").strip()
    if not topic:
        print("--topic이 필요합니다", file=sys.stderr)
        return 1
    articles = load_articles(args.articles)
    log = lambda m: print(m, file=sys.stderr)  # noqa: E731
    row, ch, card = make_placeholder(c, topic, (args.note or "").strip()[:300], articles, args.channel, args.mood or "")
    sid = row["id"]
    log(f"콘티 #{sid} 행을 만들었습니다 (채널 {ch.get('label')}, 카드 {card.get('name') if card else '없음'}). 서버에 맡깁니다…")
    final, attempts = run_job(c, sid, log)
    result = {"id": sid, "status": final.get("create_status"), "attempts": attempts,
              "error": final.get("create_error") if final.get("create_status") != "done" else None,
              "channel": {"slot": ch.get("slot"), "label": ch.get("label")},
              "card": {"id": card.get("id"), "name": card.get("name")} if card else None,
              "open_url": f"{BASE_URL}/youtube/storyboard.html?open={sid}"}
    if final.get("create_status") == "done":
        rows = c.rest(f"youtube_scripts?select=id,hook,fact_sources,video_settings,create_request&id=eq.{sid}", what="결과 읽기") or [{}]
        r = rows[0]
        vs = r.get("video_settings") or {}
        segs = c.rest(f"youtube_segments?select=order_no,section,script_text,asset_paths&script_id=eq.{sid}&order=order_no.asc", what="장면 읽기") or []
        result.update({
            "name": vs.get("name"), "title1": vs.get("title1"), "title2": vs.get("title2"), "source_text": vs.get("source_text"),
            "mood": vs.get("mood"), "auto_upload": vs.get("auto_upload"), "created_by": vs.get("created_by"),
            "note": (r.get("create_request") or {}).get("result_note"),
            "scenes": [{"order": s.get("order_no"), "section": s.get("section"), "text": s.get("script_text"),
                        "media": len(s.get("asset_paths") or [])} for s in segs],
        })
    out(result)
    return 0 if final.get("create_status") == "done" else 1


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    p = argparse.ArgumentParser(description="루틴용 콘티 도구 (콘티만 만든다 — 영상 생성·업로드 안 함)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("recent", help="최근 콘티 30개")
    s = sub.add_parser("search", help="뉴스 검색 (news-search)")
    s.add_argument("query")
    cr = sub.add_parser("create", help="콘티 하나 만들기 (create-conti)")
    cr.add_argument("--topic", required=True)
    cr.add_argument("--note", default="")
    cr.add_argument("--articles", required=True, help="기사 JSON 파일 [{title,url,source}]")
    cr.add_argument("--channel", default="2", help="youtube_channels slot (기본 2 = 연예계중개)")
    cr.add_argument("--mood", default="", choices=["", "neutral", "mystery", "bright", "calm"], help="비우면 Gemini가 고른다")
    args = p.parse_args(argv)
    c = Client(*load_config())
    try:
        if args.cmd == "recent":
            return cmd_recent(c)
        if args.cmd == "search":
            return cmd_search(c, args.query)
        return cmd_create(c, args)
    except (RuntimeError, urllib.error.URLError, OSError, ValueError) as e:
        print(f"실패: {e}", file=sys.stderr)
        out({"error": str(e)})
        return 1


if __name__ == "__main__":
    sys.exit(main())
