(() => {
  const ACCEPT = "audio/*,video/mp4,video/webm,.wav,.mp3,.m4a,.flac,.ogg";
  const {
    ZERO_HMS,
    msToHms,
    hmsToMs,
    clampHms,
    calculateQuote,
    formatKrw,
    formatDurationHuman,
    formatSegmentClock,
    sumSelectedSegmentDurationMs,
    readMediaDuration,
  } = QuotePricing;

  const quoteModal = document.getElementById("quote-modal");
  const openBtn = document.getElementById("quote-open-btn");
  const bodyEl = document.getElementById("quote-modal-body");
  const fileInput = document.getElementById("quote-file-input");

  if (!quoteModal || !openBtn || !bodyEl || !fileInput) return;

  let segmentStopHandler = null;

  const state = {
    files: [],
    activeFileId: null,
    mode: "full",
    segments: [],
    segmentForm: { start: { ...ZERO_HMS }, end: { ...ZERO_HMS } },
    segmentFormError: "",
  };

  function createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function activeFile() {
    return state.files.find((entry) => entry.id === state.activeFileId) ?? null;
  }

  function totalDurationMs() {
    return state.files.reduce((sum, entry) => sum + (entry.durationMs ?? 0), 0);
  }

  function billableDurationMs() {
    if (!state.files.some((entry) => entry.durationMs != null && !entry.loading)) return 0;
    if (state.mode === "full") return totalDurationMs();
    return sumSelectedSegmentDurationMs(state.segments);
  }

  function hasLoadedDuration() {
    return state.files.some((entry) => entry.durationMs != null && !entry.loading);
  }

  function revokeAllUrls() {
    for (const entry of state.files) {
      URL.revokeObjectURL(entry.url);
    }
  }

  function resetQuote() {
    revokeAllUrls();
    state.files = [];
    state.activeFileId = null;
    state.mode = "full";
    state.segments = [];
    state.segmentForm = { start: { ...ZERO_HMS }, end: { ...ZERO_HMS } };
    state.segmentFormError = "";
    fileInput.value = "";
    render();
  }

  function removeFile(fileId) {
    const target = state.files.find((entry) => entry.id === fileId);
    if (target) URL.revokeObjectURL(target.url);
    state.files = state.files.filter((entry) => entry.id !== fileId);
    state.segments = state.segments.filter((segment) => segment.fileId !== fileId);
    if (state.activeFileId === fileId) {
      state.activeFileId = state.files[0]?.id ?? null;
    }
    render();
  }

  async function loadDurations(entries) {
    await Promise.all(
      entries.map(async (entry) => {
        try {
          const durationMs = await readMediaDuration(entry.file);
          entry.durationMs = durationMs;
          entry.loading = false;
          entry.error = "";
        } catch (err) {
          entry.durationMs = null;
          entry.loading = false;
          entry.error = err instanceof Error ? err.message : "재생 시간을 확인할 수 없습니다.";
        }
      }),
    );
    if (!state.activeFileId && state.files.length) {
      state.activeFileId = state.files[0].id;
    }
    render();
  }

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []).filter((file) => file.size > 0);
    if (!incoming.length) return;

    const added = incoming.map((file) => ({
      id: createId("quote-file"),
      file,
      url: URL.createObjectURL(file),
      durationMs: null,
      loading: true,
      error: "",
    }));

    state.files.push(...added);
    if (!state.activeFileId) state.activeFileId = added[0].id;
    fileInput.value = "";
    render();
    void loadDurations(added);
  }

  function addSegment() {
    const file = activeFile();
    if (!file?.durationMs) return;

    const start_ms = hmsToMs(state.segmentForm.start);
    const end_ms = hmsToMs(state.segmentForm.end);

    if (end_ms <= start_ms) {
      state.segmentFormError = "종료 시간은 시작 시간보다 늦어야 합니다.";
      render();
      return;
    }
    if (end_ms > file.durationMs) {
      state.segmentFormError = "종료 시간이 파일 길이를 넘을 수 없습니다.";
      render();
      return;
    }

    state.segments.push({
      id: createId("quote-seg"),
      fileId: file.id,
      start_ms,
      end_ms,
      selected: true,
    });
    state.segments.sort(
      (left, right) =>
        left.fileId.localeCompare(right.fileId) || left.start_ms - right.start_ms || left.end_ms - right.end_ms,
    );
    state.segmentForm = { start: { ...ZERO_HMS }, end: { ...ZERO_HMS } };
    state.segmentFormError = "";
    render();
  }

  function playSegment(audio, startMs, endMs) {
    if (!audio) return;
    if (segmentStopHandler) {
      audio.removeEventListener("timeupdate", segmentStopHandler);
      segmentStopHandler = null;
    }
    audio.currentTime = startMs / 1000;
    void audio.play();
    segmentStopHandler = () => {
      if (audio.currentTime >= endMs / 1000) {
        audio.pause();
        audio.removeEventListener("timeupdate", segmentStopHandler);
        segmentStopHandler = null;
      }
    };
    audio.addEventListener("timeupdate", segmentStopHandler);
  }

  function hmsSelectHtml(name, value, maxMs, label) {
    const max = maxMs != null ? msToHms(maxMs) : { hour: 23, minute: 59, second: 59 };
    const minuteMax = value.hour === max.hour ? max.minute : 59;
    const secondMax = value.hour === max.hour && value.minute === max.minute ? max.second : 59;

    const hours = Array.from({ length: max.hour + 1 }, (_, hour) => hour);
    const minutes = Array.from({ length: minuteMax + 1 }, (_, minute) => minute);
    const seconds = Array.from({ length: secondMax + 1 }, (_, second) => second);

    return `
      <div class="quote-hms-field">
        <span class="quote-hms-label">${label}</span>
        <div class="quote-hms-row">
          <select class="quote-hms-select" data-hms="${name}-hour">${hours.map((h) => `<option value="${h}" ${h === value.hour ? "selected" : ""}>${h}</option>`).join("")}</select><span class="quote-hms-unit">시</span>
          <select class="quote-hms-select" data-hms="${name}-minute">${minutes.map((m) => `<option value="${m}" ${m === value.minute ? "selected" : ""}>${m}</option>`).join("")}</select><span class="quote-hms-unit">분</span>
          <select class="quote-hms-select" data-hms="${name}-second">${seconds.map((s) => `<option value="${s}" ${s === value.second ? "selected" : ""}>${s}</option>`).join("")}</select><span class="quote-hms-unit">초</span>
        </div>
      </div>
    `;
  }

  function formatSegmentRange(startMs, endMs) {
    return `${formatSegmentClock(startMs)} ~ ${formatSegmentClock(endMs)}`;
  }

  function quoteSummaryHtml(quote, mode, fileCount) {
    if (mode === "segments" && billableDurationMs() === 0) {
      return `<div class="quote-notice quote-notice--warn">견적을 보려면 구간을 추가하고 선택해 주세요.</div>`;
    }
    if (quote.overLimit) {
      return `<div class="quote-notice quote-notice--warn"><strong>60분 이상은 별도 문의</strong><br>계산 시간 ${formatDurationHuman(quote.durationMs)}</div>`;
    }
    if (!quote.tier) return "";

    return `
      <div class="quote-summary">
        <p class="quote-summary__label">예상 견적</p>
        ${mode === "full" && fileCount > 1 ? `<p class="quote-summary__meta">대상 파일: <strong>${fileCount}개 합산</strong></p>` : ""}
        <p class="quote-summary__meta">계산 기준 시간: <strong>${formatDurationHuman(quote.durationMs)}</strong></p>
        <p class="quote-summary__meta">적용 구간: <strong>${quote.tier.label}</strong></p>
        <div class="quote-summary__grid">
          <div class="quote-summary__box">
            <p class="quote-summary__box-label">PDF 기본요금</p>
            <p class="quote-summary__box-value">${formatKrw(quote.tier.baseFee)}</p>
          </div>
          <div class="quote-summary__box quote-summary__box--accent">
            <p class="quote-summary__box-label">부가세 포함 결제금액</p>
            <p class="quote-summary__box-value quote-summary__box-value--lg">${formatKrw(quote.tier.totalWithVat)}</p>
          </div>
        </div>
        <p class="quote-summary__note">※ 실제 의뢰·작업 조건에 따라 최종 금액이 달라질 수 있습니다.</p>
      </div>
    `;
  }

  function render() {
    const loadedFileCount = state.files.filter((entry) => entry.durationMs != null).length;
    const loadingFileCount = state.files.filter((entry) => entry.loading).length;
    const quote = calculateQuote(billableDurationMs());
    const file = activeFile();
    const hasContent = state.files.length > 0 || state.segments.length > 0;

    const fileListHtml = state.files.length
      ? `
        <div class="quote-files">
          <div class="quote-files__head">
            <div>
              <p class="quote-files__title">업로드 파일 ${state.files.length}개${loadedFileCount ? ` · 합계 ${formatDurationHuman(totalDurationMs())}` : ""}</p>
              ${loadingFileCount ? `<p class="quote-files__sub">재생 시간 확인 중 ${loadingFileCount}개…</p>` : ""}
            </div>
          </div>
          <div class="quote-files__list">
            ${state.files
              .map(
                (entry) => `
              <div class="quote-file-item ${entry.id === state.activeFileId ? "is-active" : ""}">
                <button type="button" class="quote-file-item__main" data-action="select-file" data-file-id="${entry.id}">
                  <span class="quote-file-item__name">${entry.file.name}</span>
                  <span class="quote-file-item__meta">${
                    entry.loading
                      ? "재생 시간 확인 중…"
                      : entry.error
                        ? entry.error
                        : entry.durationMs != null
                          ? formatDurationHuman(entry.durationMs)
                          : "재생 시간 미확인"
                  }</span>
                </button>
                <button type="button" class="quote-file-item__remove" data-action="remove-file" data-file-id="${entry.id}">삭제</button>
              </div>`,
              )
              .join("")}
          </div>
        </div>`
      : "";

    const modeHtml = hasLoadedDuration()
      ? `
        <div class="quote-mode-toggle">
          <button type="button" class="quote-mode-btn ${state.mode === "full" ? "is-active" : ""}" data-action="set-mode" data-mode="full">파일 전체</button>
          <button type="button" class="quote-mode-btn ${state.mode === "segments" ? "is-active" : ""}" data-action="set-mode" data-mode="segments">구간 선택</button>
        </div>
        ${
          state.mode === "full"
            ? `<p class="quote-mode-note">업로드한 ${loadedFileCount}개 파일 재생 시간 합계(${formatDurationHuman(totalDurationMs())})를 기준으로 견적을 계산합니다.</p>`
            : `
          <div class="quote-segment-panel">
            <p class="quote-segment-panel__title">구간 추가</p>
            <p class="quote-segment-panel__desc">파일을 선택한 뒤 구간을 추가하세요. 선택한 구간 시간의 합으로 견적이 계산됩니다.</p>
            ${
              file
                ? `
              <p class="quote-segment-panel__file">편집 중: <strong>${file.file.name}</strong>${file.durationMs != null ? ` · ${formatDurationHuman(file.durationMs)}` : ""}</p>
              ${file.durationMs != null && !file.error ? `<audio class="quote-audio" controls preload="metadata" src="${file.url}"></audio>` : ""}
              ${hmsSelectHtml("start", state.segmentForm.start, file.durationMs, "시작")}
              ${hmsSelectHtml("end", state.segmentForm.end, file.durationMs, "종료")}
              <div class="quote-segment-actions">
                <button type="button" class="quote-chip-btn" data-action="current-start">현재→시작</button>
                <button type="button" class="quote-chip-btn" data-action="current-end">현재→종료</button>
                <button type="button" class="quote-chip-btn quote-chip-btn--primary" data-action="add-segment">구간 추가</button>
              </div>
              ${state.segmentFormError ? `<p class="quote-error">${state.segmentFormError}</p>` : ""}
              <div class="quote-segment-list">
                ${
                  state.segments.length
                    ? state.segments
                        .map((segment) => {
                          const segmentFile = state.files.find((entry) => entry.id === segment.fileId);
                          const segmentDuration = Math.max(0, segment.end_ms - segment.start_ms);
                          return `
                        <div class="quote-segment-item">
                          <input type="checkbox" data-action="toggle-segment" data-segment-id="${segment.id}" ${segment.selected ? "checked" : ""} />
                          <div class="quote-segment-item__body">
                            <p class="quote-segment-item__range">${formatSegmentRange(segment.start_ms, segment.end_ms)}</p>
                            <p class="quote-segment-item__meta">${segmentFile?.file.name ?? "파일"} · ${formatDurationHuman(segmentDuration)}</p>
                          </div>
                          <button type="button" class="quote-chip-btn" data-action="play-segment" data-segment-id="${segment.id}">재생</button>
                          <button type="button" class="quote-chip-btn quote-chip-btn--danger" data-action="delete-segment" data-segment-id="${segment.id}">삭제</button>
                        </div>`;
                        })
                        .join("")
                    : `<p class="quote-segment-empty">아직 구간이 없습니다. 파일을 선택하고 구간을 추가해 주세요.</p>`
                }
              </div>
              <p class="quote-segment-sum">선택 구간 합계: ${formatDurationHuman(billableDurationMs())}</p>`
                : ""
            }
          </div>`
        }
        ${quoteSummaryHtml(quote, state.mode, loadedFileCount)}
      `
      : "";

    bodyEl.innerHTML = `
      <div class="quote-modal__head">
        <p class="quote-modal__eyebrow">무료 견적</p>
        <div class="quote-modal__title-row">
          <h2 class="quote-modal__title" id="quote-modal-title">녹취록 작성 비용 계산</h2>
          <button type="button" class="quote-reset-btn" data-action="reset-quote" ${hasContent ? "" : "disabled"}>견적초기화</button>
        </div>
        <p class="quote-modal__desc" id="quote-modal-desc">음성·영상 파일을 올리면 예상 견적을 확인할 수 있습니다.</p>
      </div>

      <button type="button" class="quote-dropzone" data-action="pick-files">
        <span class="quote-dropzone__icon">📋</span>
        <span class="quote-dropzone__title">${state.files.length ? "파일 추가" : "견적용 파일 선택"}</span>
        <span class="quote-dropzone__desc">여러 파일 선택 가능 · wav, mp3, m4a, mp4 등 · 드래그 앤 드롭</span>
      </button>

      ${fileListHtml}
      ${modeHtml}
    `;
  }

  function updateHmsFromSelects() {
    const file = activeFile();
    const maxMs = file?.durationMs ?? undefined;
    const read = (name) => Number(bodyEl.querySelector(`[data-hms="${name}"]`)?.value ?? 0);
    state.segmentForm.start = clampHms(
      { hour: read("start-hour"), minute: read("start-minute"), second: read("start-second") },
      maxMs,
    );
    state.segmentForm.end = clampHms(
      { hour: read("end-hour"), minute: read("end-minute"), second: read("end-second") },
      maxMs,
    );
  }

  function setBodyLocked(locked) {
    document.body.classList.toggle("terms-modal-open", locked);
  }

  function openQuoteModal() {
    const signupModal = document.getElementById("signup-modal");
    const termsModal = document.getElementById("terms-modal");
    if (signupModal && !signupModal.hidden) {
      signupModal.hidden = true;
      signupModal.setAttribute("aria-hidden", "true");
    }
    if (termsModal && !termsModal.hidden) {
      termsModal.hidden = true;
      termsModal.setAttribute("aria-hidden", "true");
    }
    quoteModal.hidden = false;
    quoteModal.setAttribute("aria-hidden", "false");
    setBodyLocked(true);
    render();
    bodyEl.querySelector(".quote-dropzone")?.focus();
  }

  function closeQuoteModal() {
    quoteModal.hidden = true;
    quoteModal.setAttribute("aria-hidden", "true");
    const signupModal = document.getElementById("signup-modal");
    const termsModal = document.getElementById("terms-modal");
    if ((!signupModal || signupModal.hidden) && (!termsModal || termsModal.hidden)) {
      setBodyLocked(false);
    }
  }

  openBtn.addEventListener("click", openQuoteModal);

  quoteModal.querySelectorAll("[data-quote-close]").forEach((el) => {
    el.addEventListener("click", closeQuoteModal);
  });

  fileInput.addEventListener("change", (event) => {
    addFiles(event.target.files);
  });

  bodyEl.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;

    const action = target.dataset.action;

    if (action === "pick-files") {
      fileInput.click();
      return;
    }
    if (action === "reset-quote") {
      resetQuote();
      return;
    }
    if (action === "select-file") {
      state.activeFileId = target.dataset.fileId;
      render();
      return;
    }
    if (action === "remove-file") {
      removeFile(target.dataset.fileId);
      return;
    }
    if (action === "set-mode") {
      state.mode = target.dataset.mode;
      render();
      return;
    }
    if (action === "add-segment") {
      updateHmsFromSelects();
      addSegment();
      return;
    }
    if (action === "current-start" || action === "current-end") {
      const audio = bodyEl.querySelector(".quote-audio");
      const file = activeFile();
      if (!audio || !file?.durationMs) return;
      const next = clampHms(msToHms(Math.floor(audio.currentTime * 1000)), file.durationMs);
      if (action === "current-start") state.segmentForm.start = next;
      else state.segmentForm.end = next;
      render();
      return;
    }
    if (action === "toggle-segment") {
      const segmentId = target.dataset.segmentId;
      const segment = state.segments.find((item) => item.id === segmentId);
      if (segment) segment.selected = target.checked;
      render();
      return;
    }
    if (action === "delete-segment") {
      state.segments = state.segments.filter((item) => item.id !== target.dataset.segmentId);
      render();
      return;
    }
    if (action === "play-segment") {
      const segment = state.segments.find((item) => item.id === target.dataset.segmentId);
      const segmentFile = state.files.find((entry) => entry.id === segment?.fileId);
      const audio = bodyEl.querySelector(".quote-audio");
      if (!segment || !segmentFile || !audio) return;
      if (audio.src !== segmentFile.url) audio.src = segmentFile.url;
      playSegment(audio, segment.start_ms, segment.end_ms);
    }
  });

  bodyEl.addEventListener("change", (event) => {
    if (event.target.matches("[data-hms]")) {
      updateHmsFromSelects();
      render();
    }
  });

  bodyEl.addEventListener("dragenter", (event) => {
    const zone = event.target.closest(".quote-dropzone");
    if (!zone) return;
    event.preventDefault();
    zone.classList.add("is-drag");
  });

  bodyEl.addEventListener("dragover", (event) => {
    const zone = event.target.closest(".quote-dropzone");
    if (!zone) return;
    event.preventDefault();
    zone.classList.add("is-drag");
  });

  bodyEl.addEventListener("dragleave", (event) => {
    const zone = event.target.closest(".quote-dropzone");
    if (!zone) return;
    if (zone.contains(event.relatedTarget)) return;
    zone.classList.remove("is-drag");
  });

  bodyEl.addEventListener("drop", (event) => {
    const zone = event.target.closest(".quote-dropzone");
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove("is-drag");
    addFiles(event.dataTransfer.files);
  });
})();
