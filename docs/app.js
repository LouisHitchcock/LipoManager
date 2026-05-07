const state = {
  batteryFilter: "active",
  batterySearch: "",
  allBatteries: [],
  selectedStatsBatteryId: null,
  selectedUsageBatteryId: null,
  selectedUsageEventType: null,
  globalStats: null,
  qrDetector: null
};

const els = {};
let scanAnimationFrame = null;
document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  initializeUi();
});

function cacheElements() {
  els.apiStatus = document.getElementById("api-status");
  els.metricActiveCount = document.getElementById("metric-active-count");
  els.metricArchivedCount = document.getElementById("metric-archived-count");
  els.metricUsedEvents = document.getElementById("metric-used-events");
  els.metricAverageRating = document.getElementById("metric-average-rating");
  els.batteryForm = document.getElementById("battery-form");
  els.batteryFormMessage = document.getElementById("battery-form-message");
  els.batteryFilter = document.getElementById("battery-filter");
  els.batterySearch = document.getElementById("battery-search");
  els.batteryCards = document.getElementById("battery-cards");
  els.refreshBtn = document.getElementById("refresh-btn");
  els.usageForm = document.getElementById("usage-form");
  els.usageFormMessage = document.getElementById("usage-form-message");
  els.usageEventType = document.getElementById("usage-event-type");
  els.usageFinalVoltage = document.getElementById("usage-final-voltage");
  els.usageBatteryList = document.getElementById("usage-battery-list");
  els.usageSelectedCount = document.getElementById("usage-selected-count");
  els.scanQrBtn = document.getElementById("scan-qr-btn");
  els.qrScannerModal = document.getElementById("qr-scanner-modal");
  els.qrScannerVideo = document.getElementById("qr-scanner-video");
  els.qrScannerCanvas = document.getElementById("qr-scanner-canvas");
  els.qrScannerMessage = document.getElementById("qr-scanner-message");
  els.qrScannerClose = document.getElementById("qr-scanner-close");
  els.statsBatterySelect = document.getElementById("stats-battery-select");
  els.statsPanel = document.getElementById("stats-panel");
  els.batteryEvents = document.getElementById("battery-events");
  els.tabButtons = [...document.querySelectorAll(".tab-btn")];
  els.tabPanels = [...document.querySelectorAll(".tab-panel")];
  els.tabSelect = document.getElementById("tab-select");
}

function bindEvents() {
  els.tabButtons.forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tabTarget));
  });

  if (els.tabSelect) {
    els.tabSelect.addEventListener("change", () => switchTab(els.tabSelect.value));
  }
  els.batteryFilter.addEventListener("change", () => {
    state.batteryFilter = els.batteryFilter.value;
    renderBatteryCards();
  });
  els.batterySearch.addEventListener("input", () => {
    state.batterySearch = els.batterySearch.value || "";
    renderBatteryCards();
  });
  els.refreshBtn.addEventListener("click", refreshData);
  els.batteryCards.addEventListener("click", onBatteryCardsClick);
  els.batteryCards.addEventListener("change", onBatteryCardsChange);
  els.usageBatteryList.addEventListener("change", updateUsageSelectedCount);
  els.usageEventType.addEventListener("change", onUsageTypeChange);
  els.usageForm.addEventListener("submit", submitUsageForm);
  if (els.scanQrBtn) els.scanQrBtn.addEventListener("click", openQrScanner);
  if (els.qrScannerClose) els.qrScannerClose.addEventListener("click", closeQrScanner);
  if (els.qrScannerModal) {
    els.qrScannerModal.addEventListener("click", (event) => {
      if (event.target === els.qrScannerModal) closeQrScanner();
    });
  }
  els.statsBatterySelect.addEventListener("change", async () => {
    state.selectedStatsBatteryId = Number(els.statsBatterySelect.value) || null;
    await loadStatsPanel();
  });
}

async function initializeUi() {
  onUsageTypeChange();

  const params = new URLSearchParams(window.location.search);
  const initialTab = params.get("tab");
  state.selectedUsageBatteryId = params.get("battery");
  state.selectedUsageEventType = params.get("type");

  switchTab(["tab-management", "tab-usage", "tab-stats"].includes(initialTab) ? initialTab : "tab-management", false);
  await checkHealth();
  await refreshData();
  applyUsageDeepLink();
}

function switchTab(tabId, updateHistory = true) {
  els.tabButtons.forEach((button) => {
    const isActive = button.dataset.tabTarget === tabId;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  els.tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabId);
  });
  if (els.tabSelect) {
    els.tabSelect.value = tabId;
  }
  if (updateHistory) {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tabId);
    window.history.replaceState({}, "", url);
  }
}

function getApiBase() {
  const url = window.APP_CONFIG?.API_BASE_URL?.trim();
  if (!url) return null;
  return url.replace(/\/$/, "");
}

async function api(path, options = {}) {
  const base = getApiBase();
  if (!base || base.includes("replace-with-your-worker-url")) {
    throw new Error("Set docs/config.js API_BASE_URL to your deployed Worker URL.");
  }

  const headers = {
    ...(options.headers ?? {})
  };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
  } catch {
    throw new Error("Could not reach the API endpoint. Check network access and CORS configuration.");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

async function checkHealth() {
  try {
    const health = await api("/health");
    els.apiStatus.textContent = `API online (${new Date(health.time).toLocaleString()})`;
    els.apiStatus.classList.remove("error");
  } catch {
    els.apiStatus.textContent = "API unreachable";
    els.apiStatus.classList.add("error");
  }
}

async function refreshData() {
  clearMessage(els.batteryFormMessage);
  clearMessage(els.usageFormMessage);
  try {
    const batteryData = await api("/api/batteries?archived=all");
    state.allBatteries = batteryData.batteries ?? [];

    try {
      state.globalStats = await api("/api/stats");
    } catch {
      state.globalStats = null;
    }

    renderOverview();
    renderBatteryCards();
    renderUsageBatteryList();
    renderStatsSelect();
    await loadStatsPanel();
  } catch (error) {
    setMessage(els.batteryFormMessage, error.message, true);
    setMessage(els.usageFormMessage, error.message, true);
  }
}

function renderOverview() {
  const activeCount = state.allBatteries.filter((battery) => !battery.archived).length;
  const archivedCount = state.allBatteries.filter((battery) => battery.archived).length;

  let usedEvents = 0;
  let averageRating = null;
  if (state.globalStats) {
    const used = (state.globalStats.events || []).find((entry) => entry.event_type === "used");
    usedEvents = Number(used?.count || 0);
    averageRating = state.globalStats?.totals?.average_rating;
  }

  els.metricActiveCount.textContent = String(activeCount);
  els.metricArchivedCount.textContent = String(archivedCount);
  els.metricUsedEvents.textContent = String(usedEvents);
  els.metricAverageRating.textContent = averageRating ? `${Number(averageRating).toFixed(2)} / 5` : "-";
}

function getFilteredBatteries() {
  let list = state.allBatteries;
  if (state.batteryFilter !== "all") {
    const archived = state.batteryFilter === "archived";
    list = list.filter((battery) => Boolean(battery.archived) === archived);
  }

  const search = state.batterySearch.trim().toLowerCase();
  if (search.length > 0) {
    list = list.filter((battery) => {
      const name = String(battery.name || "").toLowerCase();
      const serial = String(battery.serial || "").toLowerCase();
      const notes = String(battery.notes || "").toLowerCase();
      return name.includes(search) || serial.includes(search) || notes.includes(search);
    });
  }

  return list;
}

function getActiveBatteries() {
  return state.allBatteries.filter((battery) => !battery.archived);
}

function renderBatteryCards() {
  const batteries = getFilteredBatteries();
  if (batteries.length === 0) {
    els.batteryCards.innerHTML = `<div class="empty-state">No batteries match this view.</div>`;
    return;
  }

  els.batteryCards.innerHTML = batteries
    .map((battery) => {
      const rating = Number(battery.rating || 0);
      const archived = Boolean(battery.archived);
      const ratingText = rating ? "★".repeat(rating) : "Unrated";
      const displayName = battery.name ? escapeHtml(battery.name) : escapeHtml(battery.serial);
      const serialLine = battery.name ? `<p class="battery-note">Serial: ${escapeHtml(battery.serial)}</p>` : "";
      const ratingOptions = [0, 1, 2, 3, 4, 5]
        .map((value) => {
          const stars = value === 0 ? "No rating" : `${"★".repeat(value)} (${value})`;
          const selected = value === rating ? "selected" : "";
          return `<option value="${value}" ${selected}>${stars}</option>`;
        })
        .join("");

      return `
        <article class="battery-card ${archived ? "archived" : ""}">
          <div class="battery-top">
            <div>
              <h3 class="battery-serial">${displayName}</h3>
              ${serialLine}
              <p class="spec">${battery.capacity_mah} mAh • ${battery.cell_count}S • Purchased ${escapeHtml(battery.purchased_date)}</p>
              ${battery.notes ? `<p class="battery-note">${escapeHtml(battery.notes)}</p>` : ""}
            </div>
            <div class="qr" data-qr-battery-id="${battery.id}" data-qr-battery-name="${escapeHtml(battery.name || battery.serial)}" data-qr-serial="${escapeHtml(battery.serial)}"></div>
          </div>
          <div class="chips">
            <span class="chip">Last: ${formatDateTime(battery.last_usage_at)}</span>
            <span class="chip">Used: ${battery.used_count ?? 0}</span>
            <span class="chip">Charged: ${battery.charged_count ?? 0}</span>
            <span class="chip">Rating: ${ratingText}</span>
          </div>
          <div class="battery-actions">
            <label>
              Rating
              <select class="rating-select" data-action="rating" data-id="${battery.id}">
                ${ratingOptions}
              </select>
            </label>
            <button type="button" class="secondary" data-action="stats" data-id="${battery.id}">View Stats</button>
            <button type="button" class="secondary" data-action="archive" data-id="${battery.id}" data-archived="${archived ? "1" : "0"}">
              ${archived ? "Restore" : "Archive"}
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  renderQRCodes();
}

function renderQRCodes() {
  if (!window.QRCode) return;
  document.querySelectorAll(".qr[data-qr-serial]").forEach((container) => {
    const batteryId = container.getAttribute("data-qr-battery-id");
    const batteryName = container.getAttribute("data-qr-battery-name") || container.getAttribute("data-qr-serial");
    const serial = container.getAttribute("data-qr-serial");
    if (!serial || !batteryId) return;

    const qrUrl = buildBatteryActionUrl(Number(batteryId), "used");
    container.innerHTML = "";
    try {
      const level = window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : 0;
      new window.QRCode(container, {
        text: qrUrl,
        width: 82,
        height: 82,
        correctLevel: level
      });
      container.title = `Open ${batteryName} to log a usage event`;
    } catch {
      container.innerHTML = `<small>${escapeHtml(serial)}</small>`;
    }
  });
}

function renderUsageBatteryList() {
  const batteries = getActiveBatteries();
  if (batteries.length === 0) {
    els.usageBatteryList.innerHTML = `<div class="empty-state">No active batteries available.</div>`;
    updateUsageSelectedCount();
    return;
  }

  els.usageBatteryList.innerHTML = batteries
    .map(
      (battery) => `
        <label class="check-item">
          <input type="checkbox" value="${battery.id}" />
          <span>${escapeHtml(battery.name || battery.serial)}${battery.name ? ` [${escapeHtml(battery.serial)}]` : ""} (${battery.capacity_mah} mAh, ${battery.cell_count}S)</span>
        </label>
      `
    )
    .join("");

  updateUsageSelectedCount();
}

function renderStatsSelect() {
  const batteries = state.allBatteries;
  if (batteries.length === 0) {
    els.statsBatterySelect.innerHTML = `<option value="">No batteries</option>`;
    state.selectedStatsBatteryId = null;
    return;
  }

  if (!state.selectedStatsBatteryId || !batteries.some((battery) => battery.id === state.selectedStatsBatteryId)) {
    state.selectedStatsBatteryId = batteries[0].id;
  }

  els.statsBatterySelect.innerHTML = batteries
    .map((battery) => {
      const selected = battery.id === state.selectedStatsBatteryId ? "selected" : "";
      const archivedLabel = battery.archived ? " [ARCHIVED]" : "";
      const label = battery.name ? `${battery.name} [${battery.serial}]` : battery.serial;
      return `<option value="${battery.id}" ${selected}>${escapeHtml(label)}${archivedLabel}</option>`;
    })
    .join("");
}

async function loadStatsPanel() {
  if (!state.selectedStatsBatteryId) {
    els.statsPanel.innerHTML = "<p>No battery selected.</p>";
    els.batteryEvents.innerHTML = "";
    return;
  }

  try {
    const [batteryResult, eventsResult] = await Promise.all([
      api(`/api/batteries/${state.selectedStatsBatteryId}`),
      api(`/api/batteries/${state.selectedStatsBatteryId}/events?limit=10`)
    ]);
    const battery = batteryResult.battery;
    const stats = batteryResult.stats;
    els.statsPanel.innerHTML = `
      <p><strong>Name:</strong> ${escapeHtml(battery.name || "-")}</p>
      <p><strong>Serial:</strong> ${escapeHtml(battery.serial)}</p>
      <p><strong>Spec:</strong> ${battery.capacity_mah} mAh / ${battery.cell_count}S</p>
      <p><strong>Status:</strong> ${battery.archived ? "Archived" : "Active"}</p>
      <p><strong>Rating:</strong> ${battery.rating ? "★".repeat(battery.rating) : "No rating"}</p>
      <p><strong>Used cycles:</strong> ${stats.used_count}</p>
      <p><strong>Charged cycles:</strong> ${stats.charged_count}</p>
      <p><strong>Last usage:</strong> ${formatDateTime(stats.last_usage_at)}</p>
      <p><strong>Average final voltage (used):</strong> ${stats.avg_final_voltage ?? "-"}</p>
    `;

    const events = eventsResult.events ?? [];
    els.batteryEvents.innerHTML =
      events.length === 0
        ? "<li>No events yet.</li>"
        : events
            .map(
              (event) => `
                <li>
                  <strong>${event.event_type.toUpperCase()}</strong> at ${formatDateTime(event.occurred_at)}
                  ${event.final_avg_voltage ? ` | ${event.final_avg_voltage}V` : ""}
                  ${event.notes ? `<br/>${escapeHtml(event.notes)}` : ""}
                </li>
              `
            )
            .join("");
  } catch (error) {
    els.statsPanel.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    els.batteryEvents.innerHTML = "";
  }
}

async function submitBatteryForm(event) {
  event.preventDefault();
  clearMessage(els.batteryFormMessage);
  try {
    const payload = {
      name: document.getElementById("battery-name").value || null,
      serial: document.getElementById("battery-serial").value || null,
      capacityMah: Number(document.getElementById("battery-capacity").value),
      cellCount: Number(document.getElementById("battery-cells").value),
      purchasedDate: document.getElementById("battery-purchased").value,
      notes: document.getElementById("battery-notes").value || null
    };

    await api("/api/batteries", { method: "POST", body: payload });
    event.target.reset();
    setMessage(els.batteryFormMessage, "Battery created.");
    await refreshData();
  } catch (error) {
    setMessage(els.batteryFormMessage, error.message, true);
  }
}

async function onBatteryCardsClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const id = Number(button.dataset.id);
  if (!id) return;

  if (button.dataset.action === "archive") {
    const isArchived = button.dataset.archived === "1";
    try {
      await api(`/api/batteries/${id}`, { method: "PATCH", body: { archived: !isArchived } });
      await refreshData();
    } catch (error) {
      setMessage(els.batteryFormMessage, error.message, true);
    }
  }

  if (button.dataset.action === "stats") {
    state.selectedStatsBatteryId = id;
    renderStatsSelect();
    await loadStatsPanel();
    switchTab("tab-usage");
  }
}

async function onBatteryCardsChange(event) {
  const select = event.target.closest("select[data-action='rating']");
  if (!select) return;
  const id = Number(select.dataset.id);
  const rating = Number(select.value);
  try {
    await api(`/api/batteries/${id}`, { method: "PATCH", body: { rating: rating === 0 ? null : rating } });
    await refreshData();
  } catch (error) {
    setMessage(els.batteryFormMessage, error.message, true);
  }
}

function onUsageTypeChange() {
  const isUsed = els.usageEventType.value === "used";
  els.usageFinalVoltage.required = isUsed;
}

function buildBatteryActionUrl(batteryId, eventType = "used") {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", "tab-usage");
  url.searchParams.set("battery", String(batteryId));
  url.searchParams.set("type", eventType);
  return url.toString();
}

function applyUsageDeepLink() {
  if (!state.selectedUsageBatteryId) return;

  const targetBatteryId = Number(state.selectedUsageBatteryId);
  if (!Number.isInteger(targetBatteryId)) return;

  const battery = state.allBatteries.find((entry) => entry.id === targetBatteryId);
  if (!battery) return;

  const isArchived = Boolean(battery.archived);
  const targetEventType = state.selectedUsageEventType === "charged" ? "charged" : "used";

  switchTab("tab-usage", false);
  if (els.tabSelect) {
    els.tabSelect.value = "tab-usage";
  }

  clearAllUsageSelections();
  if (!isArchived) {
    const checkbox = els.usageBatteryList.querySelector(`input[type='checkbox'][value='${battery.id}']`);
    if (checkbox) {
      checkbox.checked = true;
    }
    updateUsageSelectedCount();
  }

  if (els.usageEventType.value !== targetEventType) {
    els.usageEventType.value = targetEventType;
    onUsageTypeChange();
  }

  if (targetEventType === "charged") {
    els.usageFinalVoltage.value = "";
  }

  if (isArchived) {
    setMessage(els.usageFormMessage, "This battery is archived. Restore it before logging events.", true);
    return;
  }
}

function updateUsageSelectedCount() {
  const selected = getSelectedBatteryIds();
  els.usageSelectedCount.textContent = `${selected.length} selected`;
}

function getSelectedBatteryIds() {
  return [...els.usageBatteryList.querySelectorAll("input[type='checkbox']:checked")]
    .map((checkbox) => Number(checkbox.value))
    .filter((id) => Number.isInteger(id));
}

function clearAllUsageSelections() {
  els.usageBatteryList.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.checked = false;
  });
  updateUsageSelectedCount();
}

async function openQrScanner() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setMessage(els.qrScannerMessage, "Camera access is not available in this browser.", true);
    openQrScannerModal();
    return;
  }

  openQrScannerModal();
  try {
    setMessage(els.qrScannerMessage, "Starting camera...");
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    els.qrScannerVideo.srcObject = stream;
    await els.qrScannerVideo.play();
    setMessage(els.qrScannerMessage, "Point the camera at a QR code.");
    startQrScanLoop();
  } catch (error) {
    setMessage(els.qrScannerMessage, error.message || "Could not start camera.", true);
  }
}

function openQrScannerModal() {
  if (!els.qrScannerModal) return;
  els.qrScannerModal.classList.add("open");
  els.qrScannerModal.setAttribute("aria-hidden", "false");
}

function closeQrScanner() {
  stopQrScanLoop();
  if (els.qrScannerVideo?.srcObject) {
    els.qrScannerVideo.srcObject.getTracks().forEach((track) => track.stop());
    els.qrScannerVideo.srcObject = null;
  }
  if (els.qrScannerModal) {
    els.qrScannerModal.classList.remove("open");
    els.qrScannerModal.setAttribute("aria-hidden", "true");
  }
  clearMessage(els.qrScannerMessage);
}

function startQrScanLoop() {
  stopQrScanLoop();
  const detector = getQrDetector();
  if (!detector || !els.qrScannerVideo || !els.qrScannerCanvas) {
    setMessage(els.qrScannerMessage, "This browser does not support camera QR scanning.", true);
    return;
  }

  const scanFrame = async () => {
    try {
      const qrText = await scanCurrentFrame();
      if (qrText) {
        handleScannedQrText(qrText);
        return;
      }
    } catch {
      // Keep scanning until a QR is found.
    }

    scanAnimationFrame = window.requestAnimationFrame(scanFrame);
  };

  scanFrame();
}

function stopQrScanLoop() {
  if (scanAnimationFrame) {
    window.cancelAnimationFrame(scanAnimationFrame);
    scanAnimationFrame = null;
  }
}

function getQrDetector() {
  if (!window.BarcodeDetector) return null;
  if (!state.qrDetector) {
    state.qrDetector = new window.BarcodeDetector({ formats: ["qr_code"] });
  }
  return state.qrDetector;
}

async function scanCurrentFrame() {
  if (!els.qrScannerVideo || !els.qrScannerCanvas) return null;
  if (els.qrScannerVideo.readyState < 2) return null;

  const width = els.qrScannerVideo.videoWidth;
  const height = els.qrScannerVideo.videoHeight;
  if (!width || !height) return null;

  const ctx = els.qrScannerCanvas.getContext("2d", { willReadFrequently: true });
  els.qrScannerCanvas.width = width;
  els.qrScannerCanvas.height = height;
  ctx.drawImage(els.qrScannerVideo, 0, 0, width, height);

  if (window.BarcodeDetector) {
    const detector = getQrDetector();
    const bitmap = await createImageBitmap(els.qrScannerCanvas);
    try {
      const codes = await detector.detect(bitmap);
      return codes[0]?.rawValue || null;
    } finally {
      bitmap.close?.();
    }
  }

  if (typeof window.jsQR !== "function") return null;
  const imageData = ctx.getImageData(0, 0, width, height);
  const code = window.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
  return code?.data || null;
}

function handleScannedQrText(text) {
  const raw = String(text || "").trim();
  if (!raw) return;

  let url;
  try {
    url = new URL(raw, window.location.href);
  } catch {
    setMessage(els.qrScannerMessage, "That QR code is not a valid link.", true);
    return;
  }

  const batteryParam = url.searchParams.get("battery");
  const tabParam = url.searchParams.get("tab") || "tab-usage";
  const typeParam = url.searchParams.get("type") || "used";

  if (batteryParam && /^(\d+)$/.test(batteryParam)) {
    state.selectedUsageBatteryId = batteryParam;
    state.selectedUsageEventType = typeParam;
    closeQrScanner();
    refreshData();
    switchTab(tabParam === "tab-usage" ? "tab-usage" : tabParam, true);
    return;
  }

  setMessage(els.qrScannerMessage, "QR code did not include a battery selection.", true);
}

function parseVoltageInput(rawValue) {
  const raw = String(rawValue ?? "").trim();
  if (raw.length === 0) {
    return { value: null, error: null };
  }

  let cleaned = raw.toLowerCase().replace(/v$/i, "").trim();
  if (cleaned.startsWith(".")) {
    cleaned = `0${cleaned}`;
  }

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { value: null, error: "Voltage must be numeric with up to 2 decimals (example: 16.24 or 16.24v)." };
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0 || value > 25) {
    return { value: null, error: "Voltage must be between 0 and 25V." };
  }

  return { value, error: null };
}

async function submitUsageForm(event) {
  event.preventDefault();
  clearMessage(els.usageFormMessage);

  const batteryIds = getSelectedBatteryIds();
  if (batteryIds.length === 0) {
    setMessage(els.usageFormMessage, "Select at least one battery.", true);
    return;
  }

  const eventType = els.usageEventType.value;
  const parsedVoltage = parseVoltageInput(els.usageFinalVoltage.value);
  if (parsedVoltage.error) {
    setMessage(els.usageFormMessage, parsedVoltage.error, true);
    return;
  }

  const finalAvgVoltage = parsedVoltage.value;
  const notes = document.getElementById("usage-notes").value.trim() || null;
  if (eventType === "used" && finalAvgVoltage === null) {
    setMessage(els.usageFormMessage, "Final voltage is required for Used events.", true);
    return;
  }

  try {
    await api("/api/events/batch", {
      method: "POST",
      body: {
        batteryIds,
        eventType,
        finalAvgVoltage,
        notes
      }
    });
    setMessage(els.usageFormMessage, `Logged ${eventType} for ${batteryIds.length} battery(s).`);
    document.getElementById("usage-notes").value = "";
    if (eventType === "charged") {
      els.usageFinalVoltage.value = "";
    }
    await refreshData();
  } catch (error) {
    setMessage(els.usageFormMessage, error.message, true);
  }
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function setMessage(element, text, isError = false) {
  element.textContent = text || "";
  element.classList.toggle("error", Boolean(isError));
}

function clearMessage(element) {
  setMessage(element, "");
}

function escapeHtml(value) {
  const stringValue = String(value ?? "");
  return stringValue
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
