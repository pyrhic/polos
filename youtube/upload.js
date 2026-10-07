// 영상 버전 카드의 "유튜브에 바로 업로드" UI (영상 점검 페이지에서 사용).
// 쓰는 페이지에 escapeHtml(), videoName(row)가 있어야 한다. 항상 비공개로 올라간다.
const YT_DISCLAIMER = "이 영상은 공개된 자료를 바탕으로 재구성한 이야기이며, 이해를 돕기 위해 일부 각색이 포함될 수 있습니다.";
const YT_RESPONSIBILITY = "정확한 사실 확인은 원본 자료를 참고해주세요.";

function ytDefaultDescription(row) {
  const sources = (row.fact_sources || "").split("\n").map((s) => s.trim()).filter(Boolean);
  return [YT_DISCLAIMER, YT_RESPONSIBILITY, sources.length ? "출처:\n" + sources.join("\n") : ""]
    .filter(Boolean).join("\n\n");
}

// 웹페이지는 PC 터미널을 직접 실행할 수 없으므로, 명령을 복사해주는 버튼으로 대신한다.
// 슬래시 경로라서 명령 프롬프트/PowerShell/Git Bash 어디서든 그대로 붙여넣어 실행된다.
const YT_REAUTH_CMD = "python C:/Users/PC/youtube-automation/core/reauth_youtube.py";

function ytReauthHelpHtml() {
  return `<div class="yt-reauth" style="margin-top:8px;padding:8px 10px;background:#17141c;border-radius:3px;font-size:0.78rem;color:#a89bb5;">
    <div style="color:#ffd93d;font-weight:700;margin-bottom:4px;">⚠ 프로그래밍 폴더가 있는 PC에서 실행해주세요</div>
    유튜브 인증이 만료되면(7일마다) 업로드가 실패합니다. 아래 버튼으로 명령을 복사해 PC 터미널에 붙여넣고 Enter를 누른 뒤, 브라우저에서 "허용"만 누르면 됩니다. (폰에서는 실행할 수 없습니다)
    <button type="button" class="yt-reauth-copy" style="margin-top:6px;background:#221a2e;">재로그인 명령 복사</button>
  </div>`;
}

function uploadBlockHtml(o, row) {
  if (o.youtube_status === "done" && o.youtube_video_id) {
    return `<div class="yt-block" style="margin-top:8px;font-size:0.85rem;">
      <a class="accent" href="https://youtu.be/${escapeHtml(o.youtube_video_id)}" target="_blank" rel="noopener">유튜브에서 보기 ↗ (비공개로 업로드됨)</a>
    </div>`;
  }
  if (o.youtube_status === "uploading") {
    return `<div class="yt-block" style="margin-top:8px;font-size:0.85rem;color:#4fc3f7;">유튜브 업로드 중... (몇 분 걸릴 수 있어요)</div>`;
  }
  const errorNote = o.youtube_status === "error"
    ? `<div class="msg err" style="display:block;font-size:0.8rem;">업로드 실패: ${escapeHtml(o.youtube_error || "알 수 없는 오류")}</div>${ytReauthHelpHtml()}` : "";
  return `<div class="yt-block" data-output-id="${o.id}" data-video-url="${escapeHtml(o.video_url)}" style="margin-top:8px;">
    ${errorNote}
    <button type="button" class="yt-open-btn" style="background:#221a2e;">${o.youtube_status === "error" ? "다시 업로드" : "유튜브에 업로드"}</button>
    <div class="yt-form" style="display:none;margin-top:8px;">
      <label>제목 (100자 이내)</label>
      <input type="text" class="yt-title" maxlength="100" value="${escapeHtml(videoName(row))}">
      <label>설명</label>
      <textarea class="yt-desc" style="min-height:140px;">${escapeHtml(ytDefaultDescription(row))}</textarea>
      <label>태그 (콤마로 구분, 선택)</label>
      <input type="text" class="yt-tags" placeholder="예: 미스터리, 이슈">
      <div style="color:#a89bb5;font-size:0.75rem;margin:6px 0;">비공개로 올라갑니다. 공개 전환은 유튜브 스튜디오에서 직접 하세요.</div>
      ${o.youtube_status === "error" ? "" : `<details style="margin:6px 0;"><summary style="color:#a89bb5;font-size:0.78rem;cursor:pointer;">업로드가 실패하거나 유튜브 인증이 만료됐나요?</summary>${ytReauthHelpHtml()}</details>`}
      <div style="display:flex;gap:8px;">
        <button type="button" class="yt-start-btn" style="flex:2;">업로드 시작</button>
        <button type="button" class="yt-cancel-btn" style="flex:1;background:#221a2e;">취소</button>
      </div>
    </div>
  </div>`;
}

function bindUploadBlocks(reload) {
  document.querySelectorAll(".yt-reauth-copy").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(YT_REAUTH_CMD);
        btn.textContent = "복사됨 ✓ — PC 터미널에 붙여넣고 Enter";
        setTimeout(() => { btn.textContent = "재로그인 명령 복사"; }, 3500);
      } catch {
        prompt("이 명령을 복사해서 PC 터미널에서 실행하세요:", YT_REAUTH_CMD);
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
      if (!confirm("이 영상을 유튜브에 (비공개로) 업로드할까요?")) return;
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
