const state = {
  allBatteries: [],
  globalStats: null,
  selectedBatteryId: null,
  selectedStatsBatteryId: null,
  selectedUsageIds: new Set(),
  batteryView: { filter: "active", sort: "stars", search: "" },
  usageView: { sort: "stars", search: "" },
  statsView: { sort: "stars", search: "" },
  qrDetector: null,
  scanAnimationFrame: null,
  selectedUsageEventType: "used"
};

const els = {};

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
  els.batterySortOrder = document.getElementById("battery-sort-order");
  els.batterySearch = document.getElementById("battery-search");
  els.batteryGrid = document.getElementById("battery-grid");
  els.batteryDetailPanel = document.getElementById("battery-detail-panel");
  els.refreshBtn = document.getElementById("refresh-btn");

  els.usageForm = document.getElementById("usage-form");
  els.usageFormMessage = document.getElementById("usage-form-message");
  els.usageEventType = document.getElementById("usage-event-type");
  els.usageFinalVoltage = document.getElementById("usage-final-voltage");
  els.usageNotes = document.getElementById("usage-notes");
  els.usageSortOrder = document.getElementById("usage-sort-order");
  els.usageSearch = document.getElementById("usage-search");
  els.usageGrid = document.getElementById("usage-grid");
  els.usageSelectedCount = document.getElementById("usage-selected-count");
  els.usageSelectAll = document.getElementById("usage-select-all");
  els.usageClearSelection = document.getElementById("usage-clear-selection");
  els.scanQrBtn = document.getElementById("scan-qr-btn");

  els.statsSortOrder = document.getElementById("stats-sort-order");
  els.statsSearch = document.getElementById("stats-search");
  els.statsGrid = document.getElementById("stats-grid");
  els.statsPanel = document.getElementById("stats-panel");
  els.batteryEvents = document.getElementById("battery-events");
  els.statsDeleteSelected = document.getElementById("stats-delete-selected");

  els.qrScannerModal = document.getElementById("qr-scanner-modal");
  els.qrScannerVideo = document.getElementById("qr-scanner-video");
  els.qrScannerCanvas = document.getElementById("qr-scanner-canvas");
  els.qrScannerMessage = document.getElementById("qr-scanner-message");
  els.qrScannerClose = document.getElementById("qr-scanner-close");

  els.tabButtons = [...document.querySelectorAll(".tab-btn")];
  els.tabPanels = [...document.querySelectorAll(".tab-panel")];
  els.tabSelect = document.getElementById("tab-select");
}

function bindEvents() {
  els.tabButtons.forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tabTarget)));
  if (els.tabSelect) els.tabSelect.addEventListener("change", () => switchTab(els.tabSelect.value));

  els.batteryFilter?.addEventListener("change", () => { state.batteryView.filter = els.batteryFilter.value; renderBatteryManagement(); });
  els.batterySortOrder?.addEventListener("change", () => { state.batteryView.sort = els.batterySortOrder.value; renderBatteryManagement(); });
  els.batterySearch?.addEventListener("input", () => { state.batteryView.search = els.batterySearch.value.trim().toLowerCase(); renderBatteryManagement(); });
  els.refreshBtn?.addEventListener("click", refreshData);
  els.batteryGrid?.addEventListener("click", onManagementGridClick);
  els.batteryGrid?.addEventListener("change", onManagementGridChange);

  els.usageSortOrder?.addEventListener("change", () => { state.usageView.sort = els.usageSortOrder.value; renderUsageGrid(); });
  els.usageSearch?.addEventListener("input", () => { state.usageView.search = els.usageSearch.value.trim().toLowerCase(); renderUsageGrid(); });
  els.usageSelectAll?.addEventListener("click", selectAllVisibleUsageBatteries);
  els.usageClearSelection?.addEventListener("click", clearUsageSelection);
  els.usageGrid?.addEventListener("click", onUsageGridClick);
  els.usageEventType?.addEventListener("change", onUsageTypeChange);
  els.usageForm?.addEventListener("submit", submitUsageForm);
  els.scanQrBtn?.addEventListener("click", openQrScanner);

  els.statsSortOrder?.addEventListener("change", () => { state.statsView.sort = els.statsSortOrder.value; renderStatsGrid(); });
  els.statsSearch?.addEventListener("input", () => { state.statsView.search = els.statsSearch.value.trim().toLowerCase(); renderStatsGrid(); });
  els.statsGrid?.addEventListener("click", onStatsGridClick);
  els.statsDeleteSelected?.addEventListener("click", deleteSelectedStatsEvents);

  els.batteryForm?.addEventListener("submit", submitBatteryForm);
  els.qrScannerClose?.addEventListener("click", closeQrScanner);
  els.qrScannerModal?.addEventListener("click", (event) => { if (event.target === els.qrScannerModal) closeQrScanner(); });
}

async function initializeUi() {
  const params = new URLSearchParams(window.location.search);
  const initialTab = params.get("tab");
  state.selectedUsageEventType = params.get("type") || "used";
  switchTab(["tab-management", "tab-usage", "tab-stats"].includes(initialTab) ? initialTab : "tab-management", false);
  onUsageTypeChange();
  await checkHealth();
  await refreshData();
}

function switchTab(tabId, updateHistory = true) {
  els.tabButtons.forEach((button) => {
    const active = button.dataset.tabTarget === tabId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  els.tabPanels.forEach((panel) => panel.classList.toggle("active", panel.id === tabId));
  if (els.tabSelect) els.tabSelect.value = tabId;
  if (updateHistory) {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tabId);
    window.history.replaceState({}, "", url);
  }
}

function getApiBase() {
  return window.APP_CONFIG?.API_BASE_URL?.trim()?.replace(/\/$/, "") || null;
}

async function api(path, options = {}) {
  const base = getApiBase();
  if (!base || base.includes("replace-with-your-worker-url")) throw new Error("Set docs/config.js API_BASE_URL to your deployed Worker URL.");

  const headers = { ...(options.headers ?? {}) };
  if (options.body !== undefined) headers["content-type"] = "application/json";

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
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
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
    state.globalStats = await api("/api/stats").catch(() => null);

    const firstActive = state.allBatteries.find((battery) => !battery.archived) || state.allBatteries[0] || null;
    if (!state.selectedBatteryId && firstActive) state.selectedBatteryId = firstActive.id;
    if (!state.selectedStatsBatteryId && firstActive) state.selectedStatsBatteryId = firstActive.id;

    renderOverview();
    renderBatteryManagement();
    renderUsageGrid();
    renderStatsGrid();
    await renderStatsDetail();
  } catch (error) {
    setMessage(els.batteryFormMessage, error.message, true);
    setMessage(els.usageFormMessage, error.message, true);
  }
}

function renderOverview() {
  els.metricActiveCount.textContent = String(state.allBatteries.filter((battery) => !battery.archived).length);
  els.metricArchivedCount.textContent = String(state.allBatteries.filter((battery) => battery.archived).length);
  els.metricUsedEvents.textContent = String((state.globalStats?.events || []).find((entry) => entry.event_type === "used")?.count || 0);
  els.metricAverageRating.textContent = state.globalStats?.totals?.average_rating ? `${Number(state.globalStats.totals.average_rating).toFixed(2)} / 5` : "-";
}

function serialSuffix(serial) {
  return String(serial || "").slice(-3).toLowerCase();
}

function batteryMatchesSearch(battery, query) {
  if (!query) return true;
  const haystack = `${battery.name || ""} ${battery.serial || ""}`.toLowerCase();
  return haystack.includes(query) || serialSuffix(battery.serial).includes(query);
}

function batterySortValue(battery, mode) {
  if (mode === "newest") return new Date(battery.created_at || 0).getTime();
  if (mode === "recently-used") return new Date(battery.last_usage_at || 0).getTime();
  return Number(battery.rating || 0) * 100000 + new Date(battery.last_usage_at || battery.created_at || 0).getTime();
}

function sortBatteries(batteries, mode) {
  return [...batteries].sort((a, b) => batterySortValue(b, mode) - batterySortValue(a, mode));
}

function getManagementBatteries() {
  let batteries = [...state.allBatteries];
  if (state.batteryView.filter === "active") batteries = batteries.filter((battery) => !battery.archived);
  if (state.batteryView.filter === "archived") batteries = batteries.filter((battery) => battery.archived);
  batteries = batteries.filter((battery) => batteryMatchesSearch(battery, state.batteryView.search));
  return sortBatteries(batteries, state.batteryView.sort);
}

function getUsageBatteries() {
  const batteries = state.allBatteries.filter((battery) => !battery.archived).filter((battery) => batteryMatchesSearch(battery, state.usageView.search));
  return sortBatteries(batteries, state.usageView.sort);
}

function getStatsBatteries() {
  const batteries = state.allBatteries.filter((battery) => batteryMatchesSearch(battery, state.statsView.search));
  return sortBatteries(batteries, state.statsView.sort);
}

function renderBatteryManagement() {
  const batteries = getManagementBatteries();
  els.batteryGrid.innerHTML = batteries.length ? batteries.map((battery) => renderBatteryCard(battery, { selectable: true, selected: state.selectedBatteryId === battery.id, showQuickUsage: true })).join("") : `<div class="empty-state">No batteries match this view.</div>`;
  renderManagementDetail();
  renderQRCodes();
}

function renderUsageGrid() {
  const batteries = getUsageBatteries();
  els.usageGrid.innerHTML = batteries.length ? batteries.map((battery) => renderBatteryCard(battery, { selectable: true, multiSelected: state.selectedUsageIds.has(battery.id), showQuickUsage: false })).join("") : `<div class="empty-state">No active batteries match this view.</div>`;
  renderUsageSelectedCount();
}

function renderStatsGrid() {
  const batteries = getStatsBatteries();
  els.statsGrid.innerHTML = batteries.length ? batteries.map((battery) => renderBatteryCard(battery, { selectable: true, selected: state.selectedStatsBatteryId === battery.id, showQuickUsage: false })).join("") : `<div class="empty-state">No batteries match this view.</div>`;
}

function renderBatteryCard(battery, options) {
  const selectedClass = options.selected ? " is-selected" : "";
  const multiClass = options.multiSelected ? " multi-selected" : "";
  const classes = `battery-card${battery.archived ? " archived" : ""}${options.selectable ? " selectable" : ""}${selectedClass}${multiClass}`;
  return `
    <article class="${classes}" data-battery-id="${battery.id}">
      <div class="battery-top">
        <div class="battery-main">
          <h3 class="battery-title">${escapeHtml(battery.name || battery.serial)}</h3>
          <p class="battery-subtitle">${escapeHtml(battery.serial)}${serialSuffix(battery.serial) ? ` • last 3: ${escapeHtml(serialSuffix(battery.serial))}` : ""}</p>
          <p class="spec">${battery.capacity_mah} mAh • ${battery.cell_count}S • ${battery.archived ? "Archived" : "Active"}</p>
        </div>
        <div class="qr" data-qr-battery-id="${battery.id}" data-qr-battery-name="${escapeHtml(battery.name || battery.serial)}" data-qr-serial="${escapeHtml(battery.serial)}"></div>
      </div>
      <div class="chips">
        <span class="chip">Rating: ${battery.rating ? "★".repeat(battery.rating) : "-"}</span>
        <span class="chip">Used: ${battery.used_count ?? 0}</span>
        <span class="chip">Charged: ${battery.charged_count ?? 0}</span>
        <span class="chip">Last: ${formatDateTime(battery.last_usage_at)}</span>
      </div>
      <div class="card-actions">
        <button type="button" class="secondary" data-card-action="stats" data-battery-id="${battery.id}">Open Stats</button>
        ${options.showQuickUsage ? `<button type="button" class="secondary" data-card-action="usage" data-battery-id="${battery.id}">Quick Usage</button>` : ""}
      </div>
    </article>`;
}

function renderManagementDetail() {
  if (!els.batteryDetailPanel) return;
  const battery = state.allBatteries.find((entry) => entry.id === state.selectedBatteryId);
  if (!battery) {
    els.batteryDetailPanel.innerHTML = `<div class="detail-empty"><h2>Battery Details</h2><p class="muted">Select a battery card to inspect it.</p></div>`;
    return;
  }

  const ratingOptions = [0,1,2,3,4,5].map((value) => `<option value="${value}" ${value === Number(battery.rating || 0) ? "selected" : ""}>${value === 0 ? "No rating" : `${"★".repeat(value)} (${value})`}</option>`).join("");
  els.batteryDetailPanel.innerHTML = `
    <div class="detail-header">
      <div>
        <p class="eyebrow">Selected Battery</p>
        <h2>${escapeHtml(battery.name || battery.serial)}</h2>
        <p class="muted">${escapeHtml(battery.serial)}</p>
      </div>
      <div class="qr large-qr" data-qr-battery-id="${battery.id}" data-qr-battery-name="${escapeHtml(battery.name || battery.serial)}" data-qr-serial="${escapeHtml(battery.serial)}"></div>
    </div>
    <div class="detail-stats">
      <span class="chip">${battery.capacity_mah} mAh</span>
      <span class="chip">${battery.cell_count}S</span>
      <span class="chip">Purchased ${escapeHtml(battery.purchased_date)}</span>
      <span class="chip">${battery.archived ? "Archived" : "Active"}</span>
    </div>
    ${battery.notes ? `<p class="detail-copy">${escapeHtml(battery.notes)}</p>` : ""}
    <label>
      Rating
      <select id="detail-rating-select">${ratingOptions}</select>
    </label>
    <div class="quick-actions">
      <button type="button" class="secondary" id="detail-open-stats">Open Stats</button>
      <button type="button" class="secondary" id="detail-open-usage">Quick Usage</button>
      <button type="button" class="secondary" id="detail-toggle-archive">${battery.archived ? "Restore" : "Archive"}</button>
    </div>
  `;

  document.getElementById("detail-rating-select")?.addEventListener("change", async (event) => {
    const value = Number(event.target.value);
    await api(`/api/batteries/${battery.id}`, { method: "PATCH", body: { rating: value === 0 ? null : value } });
    await refreshData();
  });
  document.getElementById("detail-open-stats")?.addEventListener("click", () => {
    state.selectedStatsBatteryId = battery.id;
    switchTab("tab-stats");
    renderStatsGrid();
    renderStatsDetail();
  });
  document.getElementById("detail-open-usage")?.addEventListener("click", () => {
    state.selectedUsageIds = new Set([battery.id]);
    switchTab("tab-usage");
    renderUsageGrid();
    renderUsageSelectedCount();
  });
  document.getElementById("detail-toggle-archive")?.addEventListener("click", async () => {
    await api(`/api/batteries/${battery.id}`, { method: "PATCH", body: { archived: !battery.archived } });
    await refreshData();
  });
  renderQRCodes();
}

async function renderStatsDetail() {
  if (!state.selectedStatsBatteryId) {
    els.statsPanel.innerHTML = `<div class="detail-empty"><h2>Battery Stats</h2><p class="muted">Select a battery card to view stats.</p></div>`;
    els.batteryEvents.innerHTML = "";
    return;
  }

  const [batteryResult, eventsResult] = await Promise.all([
    api(`/api/batteries/${state.selectedStatsBatteryId}`),
    api(`/api/batteries/${state.selectedStatsBatteryId}/events?limit=20`)
  ]);

  const battery = batteryResult.battery;
  const stats = batteryResult.stats;
  els.statsPanel.innerHTML = `
    <h2>${escapeHtml(battery.name || battery.serial)}</h2>
    <p><strong>Serial:</strong> ${escapeHtml(battery.serial)}</p>
    <p><strong>Last 3:</strong> ${escapeHtml(serialSuffix(battery.serial))}</p>
    <p><strong>Status:</strong> ${battery.archived ? "Archived" : "Active"}</p>
    <p><strong>Rating:</strong> ${battery.rating ? "★".repeat(battery.rating) : "No rating"}</p>
    <p><strong>Used cycles:</strong> ${stats.used_count}</p>
    <p><strong>Charged cycles:</strong> ${stats.charged_count}</p>
    <p><strong>Last usage:</strong> ${formatDateTime(stats.last_usage_at)}</p>
    <p><strong>Average final voltage (used):</strong> ${stats.avg_final_voltage ?? "-"}</p>`;

  els.batteryEvents.innerHTML = (eventsResult.events || []).map((event) => `
    <li>
      <label class="event-row">
        <input type="checkbox" value="${event.id}" />
        <span>
          <strong>${event.event_type.toUpperCase()}</strong> at ${formatDateTime(event.occurred_at)}
          ${event.final_avg_voltage ? ` | ${event.final_avg_voltage}V` : ""}
          ${event.notes ? `<br/>${escapeHtml(event.notes)}` : ""}
        </span>
      </label>
    </li>`).join("") || "<li>No events yet.</li>";
}

function onManagementGridClick(event) {
  const actionButton = event.target.closest("button[data-card-action]");
  const card = event.target.closest(".battery-card");
  if (!card) return;
  const batteryId = Number(card.dataset.batteryId);
  if (!batteryId) return;

  if (actionButton?.dataset.cardAction === "stats") {
    state.selectedStatsBatteryId = batteryId;
    switchTab("tab-stats");
    renderStatsGrid();
    renderStatsDetail();
    return;
  }

  if (actionButton?.dataset.cardAction === "usage") {
    state.selectedUsageIds = new Set([batteryId]);
    switchTab("tab-usage");
    renderUsageGrid();
    renderUsageSelectedCount();
    return;
  }

  state.selectedBatteryId = batteryId;
  renderBatteryManagement();
}

function onManagementGridChange() {}

function onUsageGridClick(event) {
  const card = event.target.closest(".battery-card");
  if (!card) return;
  const batteryId = Number(card.dataset.batteryId);
  if (!batteryId) return;
  if (state.selectedUsageIds.has(batteryId)) state.selectedUsageIds.delete(batteryId);
  else state.selectedUsageIds.add(batteryId);
  renderUsageGrid();
}

function onStatsGridClick(event) {
  const card = event.target.closest(".battery-card");
  if (!card) return;
  const batteryId = Number(card.dataset.batteryId);
  if (!batteryId) return;
  state.selectedStatsBatteryId = batteryId;
  renderStatsGrid();
  renderStatsDetail();
}

function onUsageTypeChange() {
  const eventType = els.usageEventType.value;
  els.usageFinalVoltage.required = eventType === "used";
  if (eventType === "storage") els.usageFinalVoltage.value = "3.8";
  else if (eventType === "charged" && els.usageFinalVoltage.value === "3.8") els.usageFinalVoltage.value = "";
}

function renderUsageSelectedCount() {
  const count = state.selectedUsageIds.size;
  els.usageSelectedCount.textContent = `${count} selected`;
}

function selectAllVisibleUsageBatteries() {
  state.selectedUsageIds = new Set(getUsageBatteries().map((battery) => battery.id));
  renderUsageGrid();
}

function clearUsageSelection() {
  state.selectedUsageIds.clear();
  renderUsageGrid();
}

function parseVoltageInput(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { value: null, error: null };
  let cleaned = raw.toLowerCase().replace(/v$/i, "").trim();
  if (cleaned.startsWith(".")) cleaned = `0${cleaned}`;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return { value: null, error: "Voltage must be numeric with up to 2 decimals." };
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0 || num > 25) return { value: null, error: "Voltage must be between 0 and 25V." };
  return { value: Number(num.toFixed(2)), error: null };
}

async function submitBatteryForm(event) {
  event.preventDefault();
  clearMessage(els.batteryFormMessage);
  const count = Math.max(1, Number(document.getElementById("battery-count")?.value || 1));
  const base = {
    name: document.getElementById("battery-name").value || null,
    serial: document.getElementById("battery-serial").value || null,
    capacityMah: Number(document.getElementById("battery-capacity").value),
    cellCount: Number(document.getElementById("battery-cells").value),
    purchasedDate: document.getElementById("battery-purchased").value,
    notes: document.getElementById("battery-notes").value || null
  };

  try {
    for (let index = 0; index < count; index += 1) {
      await api("/api/batteries", { method: "POST", body: base });
    }
    event.target.reset();
    setMessage(els.batteryFormMessage, `Created ${count} battery(s).`);
    await refreshData();
  } catch (error) {
    setMessage(els.batteryFormMessage, error.message, true);
  }
}

async function submitUsageForm(event) {
  event.preventDefault();
  clearMessage(els.usageFormMessage);
  const batteryIds = [...state.selectedUsageIds];
  if (!batteryIds.length) return setMessage(els.usageFormMessage, "Select at least one battery.", true);

  const eventType = els.usageEventType.value;
  const parsedVoltage = parseVoltageInput(els.usageFinalVoltage.value);
  if (parsedVoltage.error) return setMessage(els.usageFormMessage, parsedVoltage.error, true);

  const notes = els.usageNotes.value.trim() || null;
  const finalAvgVoltage = eventType === "storage" ? 3.8 : parsedVoltage.value;
  if (eventType === "used" && finalAvgVoltage === null) return setMessage(els.usageFormMessage, "Final voltage is required for Used events.", true);

  try {
    await api("/api/events/batch", { method: "POST", body: { batteryIds, eventType, finalAvgVoltage, notes } });
    setMessage(els.usageFormMessage, `Logged ${eventType} for ${batteryIds.length} battery(s).`);
    state.selectedUsageIds.clear();
    await refreshData();
  } catch (error) {
    setMessage(els.usageFormMessage, error.message, true);
  }
}

async function deleteSelectedStatsEvents() {
  const eventIds = [...els.batteryEvents.querySelectorAll("input[type='checkbox']:checked")].map((checkbox) => Number(checkbox.value)).filter(Number.isInteger);
  if (!eventIds.length) return;
  if (!window.confirm(`Delete ${eventIds.length} selected event(s)?`)) return;

  for (const eventId of eventIds) {
    await api(`/api/events/${eventId}`, { method: "DELETE" });
  }
  await renderStatsDetail();
}

function buildBatteryActionUrl(batteryId, eventType = "used") {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", "tab-usage");
  url.searchParams.set("battery", String(batteryId));
  url.searchParams.set("type", eventType);
  return url.toString();
}

function renderQRCodes() {
  if (!window.QRCode) return;
  document.querySelectorAll(".qr[data-qr-serial]").forEach((container) => {
    const batteryId = container.getAttribute("data-qr-battery-id");
    const serial = container.getAttribute("data-qr-serial");
    if (!serial || !batteryId) return;
    container.innerHTML = "";
    try {
      const level = window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : 0;
      new window.QRCode(container, { text: buildBatteryActionUrl(Number(batteryId), "used"), width: container.classList.contains("large-qr") ? 112 : 82, height: container.classList.contains("large-qr") ? 112 : 82, correctLevel: level });
    } catch {
      container.innerHTML = `<small>${escapeHtml(serial)}</small>`;
    }
  });
}

async function openQrScanner() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setMessage(els.qrScannerMessage, "Camera access is not available in this browser.", true);
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
  els.qrScannerModal.classList.add("open");
  els.qrScannerModal.setAttribute("aria-hidden", "false");
}

function closeQrScanner() {
  stopQrScanLoop();
  if (els.qrScannerVideo?.srcObject) {
    els.qrScannerVideo.srcObject.getTracks().forEach((track) => track.stop());
    els.qrScannerVideo.srcObject = null;
  }
  els.qrScannerModal.classList.remove("open");
  els.qrScannerModal.setAttribute("aria-hidden", "true");
  clearMessage(els.qrScannerMessage);
}

function startQrScanLoop() {
  stopQrScanLoop();
  if (!window.BarcodeDetector && typeof window.jsQR !== "function") {
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
      // keep scanning
    }
    state.scanAnimationFrame = window.requestAnimationFrame(scanFrame);
  };

  scanFrame();
}

function stopQrScanLoop() {
  if (state.scanAnimationFrame) {
    window.cancelAnimationFrame(state.scanAnimationFrame);
    state.scanAnimationFrame = null;
  }
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
    const detector = state.qrDetector || (state.qrDetector = new window.BarcodeDetector({ formats: ["qr_code"] }));
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
  const typeParam = url.searchParams.get("type") || "used";
  if (!batteryParam || !/^\d+$/.test(batteryParam)) {
    setMessage(els.qrScannerMessage, "QR code did not include a battery selection.", true);
    return;
  }

  state.selectedUsageIds = new Set([Number(batteryParam)]);
  state.selectedUsageEventType = typeParam;
  closeQrScanner();
  switchTab("tab-usage");
  els.usageEventType.value = typeParam;
  onUsageTypeChange();
  renderUsageGrid();
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function setMessage(element, text, isError = false) {
  if (!element) return;
  element.textContent = text || "";
  element.classList.toggle("error", Boolean(isError));
}

function clearMessage(element) {
  setMessage(element, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
