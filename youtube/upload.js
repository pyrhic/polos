// 영상 버전 카드의 "유튜브에 바로 업로드" UI (Studio 페이지에서 사용).
// 쓰는 페이지에 escapeHtml(), videoName(row)가 있어야 한다. 항상 비공개로 올라간다.
const YT_DISCLAIMER = "이 영상은 공개된 자료를 바탕으로 재구성한 이야기이며, 이해를 돕기 위해 일부 각색이 포함될 수 있습니다.";
const YT_RESPONSIBILITY = "정확한 사실 확인은 원본 자료를 참고해주세요.";

function ytDefaultDescription(row) {
  const sources = (row.fact_sources || "").split("\n").map((s) => s.trim()).filter(Boolean);
  // 큐레이션(사진+음악) 영상은 뉴스형 안내 문구 없이 사진·음악 출처만 적는다
  if (row.category === "큐레이션") return sources.length ? "출처:\n" + sources.join("\n") : "";
  // 위키피디아 인물 영상: 글은 위키백과(CC BY-SA 4.0)를 바탕으로 재구성한 것이라 출처와 라이선스, 사진 저작자를 반드시 적는다
  if (String(row.category || "").startsWith("위키")) {
    return ["이 영상의 이야기는 위키백과의 글(CC BY-SA 4.0)을 바탕으로 다시 쓴 것입니다.", sources.length ? "출처:\n" + sources.join("\n") : ""]
      .filter(Boolean).join("\n\n");
  }
  return [YT_DISCLAIMER, YT_RESPONSIBILITY, sources.length ? "출처:\n" + sources.join("\n") : ""]
    .filter(Boolean).join("\n\n");
}

// 웹페이지는 PC 터미널을 직접 실행할 수 없으므로, 명령을 복사해주는 버튼으로 대신한다.
// 슬래시 경로라서 명령 프롬프트/PowerShell/Git Bash 어디서든 그대로 붙여넣어 실행된다.
// youtube-automation 폴더 경로는 config.js의 REAUTH_DIR (비어 있으면 명령을 만들지 않고 버튼을 숨긴다).
function ytReauthCmd(slot) {
  const dir = String((globalThis.POLOS_CONFIG || {}).REAUTH_DIR || "").replace(/\\/g, "/").replace(/\/+$/, "");
  return dir ? `python ${dir}/core/reauth_youtube.py --slot ${slot}` : "";
}

// 올릴 수 있는 채널 목록: Supabase 표 youtube_channels(있고 비어 있지 않으면) > config.js의 YT_CHANNELS > 기본 2개.
// 표는 비동기로 읽어야 하므로, 목록을 그리기 전에 ytPrimeChannels()를 한 번 기다려 둔다.
let ytChannelCache = null;
async function ytPrimeChannels() {
  const cfg = globalThis.POLOS_CONFIG || {};
  try {
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/youtube_channels?select=slot,label,ready&order=sort_order.asc,slot.asc`, {
      headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}` },
    });
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length) ytChannelCache = rows.map((r) => ({ slot: String(r.slot), label: r.label, ready: r.ready })); // 표가 비었으면 config 목록을 쓴다
    }
  } catch { /* 표를 못 읽으면 config.js 목록을 쓴다 */ }
}
function ytChannels() {
  const list = ytChannelCache || (globalThis.POLOS_CONFIG || {}).YT_CHANNELS;
  // ready: false 인 채널(아직 로그인 승인 전)은 목록에 보이지 않는다
  return (Array.isArray(list) && list.length ? list : [{ slot: "1", label: "기존 채널" }, { slot: "2", label: "새 채널" }]).filter((c) => c.ready !== false);
}
// 기본 채널: 마지막으로 올린 채널 (처음이면 첫 채널). 올리기 전에 언제든 바꿀 수 있다.
function ytDefaultSlot(row) {
  const chs = ytChannels();
  const has = (s) => chs.some((c) => c.slot === s);
  if (row && String(row.category || "").startsWith("위키") && has("1")) return "1";   // 위키 이야기(인물·사건·지식)는 Wicked Wiki 채널
  if (row && row.category === "큐레이션" && has("3")) return "3";   // 사진 슬라이드쇼는 OUTSTAGRAM 채널(준비되면)
  try { const s = localStorage.getItem("ytSlot"); if (has(s)) return s; } catch {}
  return chs.length ? chs[0].slot : "1";
}

function ytReauthHelpHtml() {
  const buttons = ytChannels().filter((c) => ytReauthCmd(c.slot)).map((c) =>
    `<button type="button" class="yt-reauth-copy" data-slot="${escapeHtml(c.slot)}" style="margin-top:6px;">재로그인 명령 복사 (${escapeHtml(c.label)}${c.slot === "1" ? "" : " · 채널 선택 화면에서 그 채널을 고르세요"})</button>`
  ).join("");
  if (!buttons) {
    return `<div class="yt-reauth" style="margin-top:8px;padding:8px 10px;background:var(--inset);border-radius:3px;font-size:0.78rem;color:var(--muted);">
    유튜브 인증이 만료되면(7일마다) 업로드가 실패합니다. 이 채널의 유튜브 로그인을 다시 연결해 주세요.
  </div>`;
  }
  return `<div class="yt-reauth" style="margin-top:8px;padding:8px 10px;background:var(--inset);border-radius:3px;font-size:0.78rem;color:var(--muted);">
    <div style="color:var(--point);font-weight:700;margin-bottom:4px;">⚠ 프로그래밍 폴더가 있는 PC에서 실행해주세요</div>
    유튜브 인증이 만료되면(7일마다) 업로드가 실패합니다. 아래 버튼으로 명령을 복사해 PC 터미널에 붙여넣고 Enter를 누른 뒤, 브라우저에서 "허용"만 누르면 됩니다. (폰에서는 실행할 수 없습니다)
    ${buttons}
  </div>`;
}

// 롱폼에서 만든 쇼츠는 버전마다 제목이 따로 있다 (video_settings.titles). 없으면 콘티 이름.
function ytTitleFor(row, o) {
  const t = ((row.video_settings || {}).titles || {})[o.version];
  return (t || videoName(row)).slice(0, 100);
}

function uploadBlockHtml(o, row) {
  if (o.youtube_status === "done" && o.youtube_video_id) {
    return `<div class="yt-block" style="margin-top:8px;font-size:0.85rem;">
      <a class="accent" href="https://youtu.be/${escapeHtml(o.youtube_video_id)}" target="_blank" rel="noopener">유튜브에서 보기 ↗ (비공개로 업로드됨)</a>
    </div>`;
  }
  if (o.youtube_status === "uploading") {
    return `<div class="yt-block" style="margin-top:8px;font-size:0.85rem;color:var(--accent);">유튜브 업로드 중... (몇 분 걸릴 수 있어요)</div>`;
  }
  const errorNote = o.youtube_status === "error"
    ? `<div class="msg err" style="display:block;font-size:0.8rem;">업로드 실패: ${escapeHtml(o.youtube_error || "알 수 없는 오류")}</div>${ytReauthHelpHtml()}` : "";
  return `<div class="yt-block" data-output-id="${o.id}" data-video-url="${escapeHtml(o.video_url)}" style="margin-top:8px;">
    ${errorNote}
    <button type="button" class="yt-open-btn" style="">${o.youtube_status === "error" ? "다시 업로드" : "유튜브에 업로드"}</button>
    <div class="yt-form" style="display:none;margin-top:8px;">
      <label>올릴 채널</label>
      <select class="yt-channel">${ytChannels().map((c) => `<option value="${escapeHtml(c.slot)}"${c.slot === ytDefaultSlot(row) ? " selected" : ""}>${escapeHtml(c.label)}</option>`).join("")}</select>
      <label>제목 (100자 이내)</label>
      <input type="text" class="yt-title" maxlength="100" value="${escapeHtml(ytTitleFor(row, o))}">
      <label>설명</label>
      <textarea class="yt-desc" style="min-height:140px;">${escapeHtml(ytDefaultDescription(row))}</textarea>
      <label>태그 (콤마로 구분, 선택)</label>
      <input type="text" class="yt-tags" placeholder="예: 미스터리, 이슈">
      <div style="color:var(--muted);font-size:0.75rem;margin:6px 0;">비공개로 올라갑니다. 공개 전환은 유튜브 스튜디오에서 직접 하세요.</div>
      ${o.youtube_status === "error" ? "" : `<details style="margin:6px 0;"><summary style="color:var(--muted);font-size:0.78rem;cursor:pointer;">업로드가 실패하거나 유튜브 인증이 만료됐나요?</summary>${ytReauthHelpHtml()}</details>`}
      <div style="display:flex;gap:8px;">
        <button type="button" class="yt-start-btn" style="flex:2;">업로드 시작</button>
        <button type="button" class="yt-cancel-btn" style="flex:1;">취소</button>
      </div>
    </div>
  </div>`;
}

function bindUploadBlocks(reload) {
  document.querySelectorAll(".yt-reauth-copy").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const cmd = ytReauthCmd(btn.dataset.slot || "1");
      const label = btn.textContent;
      try {
        await navigator.clipboard.writeText(cmd);
        btn.textContent = "복사됨 ✓ — PC 터미널에 붙여넣고 Enter";
        setTimeout(() => { btn.textContent = label; }, 3500);
      } catch {
        prompt("이 명령을 복사해서 PC 터미널에서 실행하세요:", cmd);
      }
    })
  );

  document.querySelectorAll(".yt-block[data-output-id]").forEach((block) => {
    const form = block.querySelector(".yt-form");
    const openBtn = block.querySelector(".yt-open-btn");
    openBtn.addEventListener("click", () => { form.style.display = "block"; openBtn.style.display = "none"; });
    block.querySelector(".yt-cancel-btn").addEventListener("click", () => { form.style.display = "none"; openBtn.style.display = ""; });
    block.querySelector(".yt-start-btn").addEventListener("click", async (e) => {
      const title = block.querySelector(".yt-title").value.trim();
      if (!title) { alert("제목을 입력하세요."); return; }
      const chSel = block.querySelector(".yt-channel");
      const chLabel = chSel.options[chSel.selectedIndex].textContent;
      if (!confirm(`이 영상을 "${chLabel}" 채널에 (비공개로) 업로드할까요?`)) return;
      try { localStorage.setItem("ytSlot", chSel.value); } catch {}
      e.target.disabled = true;
      e.target.textContent = "요청 중...";
      try {
        const res = await fetch("/api/trigger-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outputId: Number(block.dataset.outputId),
            videoUrl: block.dataset.videoUrl,
            title,
            description: block.querySelector(".yt-desc").value,
            tags: block.querySelector(".yt-tags").value,
            channelSlot: block.querySelector(".yt-channel").value,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "업로드 요청 실패");
        reload();
      } catch (err) {
        alert("업로드 실패: " + err.message);
        e.target.disabled = false;
        e.target.textContent = "업로드 시작";
      }
    });
  });
}

function ytAnyUploading(outputsByScript) {
  return Object.values(outputsByScript).some((list) => list.some((o) => o.youtube_status === "uploading"));
}

// 폼을 열어 입력 중이면 자동 새로고침으로 날리지 않도록 건너뛴다.
let ytPollTimer = null;
function ytSchedulePoll(loadFn) {
  clearTimeout(ytPollTimer);
  ytPollTimer = setTimeout(() => {
    const formOpen = Array.from(document.querySelectorAll(".yt-form")).some((f) => f.style.display === "block");
    formOpen ? ytSchedulePoll(loadFn) : loadFn();
  }, 8000);
}
