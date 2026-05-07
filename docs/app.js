const state = {
  allBatteries: [],
  selectedStatsBatteryId: null,
  selectedUsageEventType: "used",
  selectedUsageSort: "stars",
  selectedBatterySort: "stars",
  usageSearch: "",
  batterySearch: "",
  globalStats: null,
  qrDetector: null,
  scanAnimationFrame: null,
  selectedStatsEventIds: new Set(),
  statsBatteryQuery: ""
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
  els.batterySerialSearch = document.getElementById("battery-serial-search");
  els.batteryCards = document.getElementById("battery-cards");
  els.batteryDetailPanel = document.getElementById("battery-detail-panel");
  els.refreshBtn = document.getElementById("refresh-btn");
  els.usageForm = document.getElementById("usage-form");
  els.usageFormMessage = document.getElementById("usage-form-message");
  els.usageEventType = document.getElementById("usage-event-type");
  els.usageFinalVoltage = document.getElementById("usage-final-voltage");
  els.usageBatterySearch = document.getElementById("usage-battery-search");
  els.usageSortOrder = document.getElementById("usage-sort-order");
  els.usageBatteryList = document.getElementById("usage-battery-list");
  els.usageSelectedCount = document.getElementById("usage-selected-count");
  els.usageSelectAll = document.getElementById("usage-select-all");
  els.scanQrBtn = document.getElementById("scan-qr-btn");
  els.qrScannerModal = document.getElementById("qr-scanner-modal");
  els.qrScannerVideo = document.getElementById("qr-scanner-video");
  els.qrScannerCanvas = document.getElementById("qr-scanner-canvas");
  els.qrScannerMessage = document.getElementById("qr-scanner-message");
  els.qrScannerClose = document.getElementById("qr-scanner-close");
  els.statsBatteryGrid = document.getElementById("stats-battery-grid");
  els.statsPanel = document.getElementById("stats-panel");
  els.batteryEvents = document.getElementById("battery-events");
  els.statsDeleteSelected = document.getElementById("stats-delete-selected");
  els.tabButtons = [...document.querySelectorAll(".tab-btn")];
  els.tabPanels = [...document.querySelectorAll(".tab-panel")];
  els.tabSelect = document.getElementById("tab-select");
}

function bindEvents() {
  els.tabButtons.forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tabTarget)));
  if (els.tabSelect) els.tabSelect.addEventListener("change", () => switchTab(els.tabSelect.value));
  els.batteryFilter.addEventListener("change", renderBatteryCards);
  els.batterySortOrder.addEventListener("change", renderBatteryCards);
  els.batterySerialSearch.addEventListener("input", renderBatteryCards);
  els.usageSortOrder.addEventListener("change", renderUsageBatteryList);
  els.usageBatterySearch.addEventListener("input", renderUsageBatteryList);
  els.refreshBtn.addEventListener("click", refreshData);
  els.batteryCards.addEventListener("click", onBatteryCardsClick);
  els.batteryCards.addEventListener("change", onBatteryCardsChange);
  els.usageBatteryList.addEventListener("change", updateUsageSelectedCount);
  els.usageEventType.addEventListener("change", onUsageTypeChange);
  els.usageSelectAll.addEventListener("click", selectAllUsageBatteries);
  els.batteryForm.addEventListener("submit", submitBatteryForm);
  els.usageForm.addEventListener("submit", submitUsageForm);
  if (els.scanQrBtn) els.scanQrBtn.addEventListener("click", openQrScanner);
  if (els.qrScannerClose) els.qrScannerClose.addEventListener("click", closeQrScanner);
  if (els.qrScannerModal) els.qrScannerModal.addEventListener("click", (e) => { if (e.target === els.qrScannerModal) closeQrScanner(); });
  if (els.statsBatteryGrid) els.statsBatteryGrid.addEventListener("click", onStatsBatteryGridClick);
  if (els.statsDeleteSelected) els.statsDeleteSelected.addEventListener("click", deleteSelectedStatsEvents);
}

async function initializeUi() {
  const params = new URLSearchParams(window.location.search);
  const initialTab = params.get("tab");
  state.selectedUsageEventType = params.get("type") || "used";
  state.statsBatteryQuery = "";
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

function getApiBase() { return window.APP_CONFIG?.API_BASE_URL?.trim()?.replace(/\/$/, "") || null; }
async function api(path, options = {}) {
  const base = getApiBase();
  if (!base || base.includes("replace-with-your-worker-url")) throw new Error("Set docs/config.js API_BASE_URL to your deployed Worker URL.");
  const headers = { ...(options.headers ?? {}) };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  let response;
  try { response = await fetch(`${base}${path}`, { method: options.method ?? "GET", headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined }); }
  catch { throw new Error("Could not reach the API endpoint. Check network access and CORS configuration."); }
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
    try { state.globalStats = await api("/api/stats"); } catch { state.globalStats = null; }
    renderOverview();
    renderBatteryCards();
    renderUsageBatteryList();
    renderStatsGrid();
    await loadStatsPanel();
  } catch (error) {
    setMessage(els.batteryFormMessage, error.message, true);
    setMessage(els.usageFormMessage, error.message, true);
  }
}

function renderOverview() {
  els.metricActiveCount.textContent = String(state.allBatteries.filter((b) => !b.archived).length);
  els.metricArchivedCount.textContent = String(state.allBatteries.filter((b) => b.archived).length);
  els.metricUsedEvents.textContent = String((state.globalStats?.events || []).find((e) => e.event_type === "used")?.count || 0);
  els.metricAverageRating.textContent = state.globalStats?.totals?.average_rating ? `${Number(state.globalStats.totals.average_rating).toFixed(2)} / 5` : "-";
}

function batterySearchValue() { return (els.batterySerialSearch?.value || "").trim().toLowerCase(); }
function usageSearchValue() { return (els.usageBatterySearch?.value || "").trim().toLowerCase(); }
function serialSuffix(serial) { return String(serial || "").slice(-3).toLowerCase(); }
function batteryScore(battery) { return Number(battery.rating || 0) * 100000 + Number(battery.last_usage_at ? new Date(battery.last_usage_at).getTime() : 0) + Number(battery.created_at ? new Date(battery.created_at).getTime() : 0); }
function sortBatteries(list, sortMode) { const copy = [...list]; if (sortMode === "newest") copy.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); else if (sortMode === "recently-used") copy.sort((a, b) => new Date(b.last_usage_at || 0) - new Date(a.last_usage_at || 0)); else copy.sort((a, b) => batteryScore(b) - batteryScore(a)); return copy; }

function getVisibleBatteries() {
  let list = state.allBatteries;
  const filter = els.batteryFilter?.value || "active";
  if (filter !== "all") list = list.filter((battery) => Boolean(battery.archived) === (filter === "archived"));
  const search = batterySearchValue();
  if (search) list = list.filter((battery) => `${battery.name || ""} ${battery.serial || ""}`.toLowerCase().includes(search) || serialSuffix(battery.serial).includes(search));
  return sortBatteries(list, els.batterySortOrder?.value || "stars");
}

function getVisibleUsageBatteries() {
  let list = state.allBatteries.filter((battery) => !battery.archived);
  const search = usageSearchValue();
  if (search) list = list.filter((battery) => `${battery.name || ""} ${battery.serial || ""}`.toLowerCase().includes(search) || serialSuffix(battery.serial).includes(search));
  return sortBatteries(list, els.usageSortOrder?.value || "stars");
}

function renderBatteryCards() {
  const batteries = getVisibleBatteries();
  els.batteryCards.innerHTML = batteries.length ? batteries.map((battery) => batteryCardHtml(battery)).join("") : `<div class="empty-state">No batteries match this view.</div>`;
  renderQRCodes();
  renderBatteryDetail();
}

function batteryCardHtml(battery) {
  const rating = Number(battery.rating || 0);
  const archived = Boolean(battery.archived);
  const stars = rating ? "★".repeat(rating) : "Unrated";
  const ratingOptions = [0,1,2,3,4,5].map((v) => `<option value="${v}" ${v===rating?"selected":""}>${v===0?"No rating":`${"★".repeat(v)} (${v})`}</option>`).join("");
  return `<article class="battery-card ${archived ? "archived" : ""}" data-battery-id="${battery.id}">
    <div class="battery-top"><div><h3 class="battery-serial">${escapeHtml(battery.name || battery.serial)}</h3><p class="battery-note">Serial: ${escapeHtml(battery.serial)}${serialSuffix(battery.serial) ? ` • Last 3: ${escapeHtml(serialSuffix(battery.serial))}` : ""}</p><p class="spec">${battery.capacity_mah} mAh • ${battery.cell_count}S • Purchased ${escapeHtml(battery.purchased_date)}</p></div><div class="qr" data-qr-battery-id="${battery.id}" data-qr-battery-name="${escapeHtml(battery.name || battery.serial)}" data-qr-serial="${escapeHtml(battery.serial)}"></div></div>
    <div class="chips"><span class="chip">Last: ${formatDateTime(battery.last_usage_at)}</span><span class="chip">Used: ${battery.used_count ?? 0}</span><span class="chip">Charged: ${battery.charged_count ?? 0}</span><span class="chip">Rating: ${stars}</span></div>
    <div class="battery-actions"><label>Rating<select data-action="rating" data-id="${battery.id}">${ratingOptions}</select></label><button type="button" class="secondary" data-action="stats" data-id="${battery.id}">View</button><button type="button" class="secondary" data-action="archive" data-id="${battery.id}" data-archived="${archived ? 1 : 0}">${archived ? "Restore" : "Archive"}</button></div>
  </article>`;
}

function renderUsageBatteryList() {
  const batteries = getVisibleUsageBatteries();
  if (!batteries.length) { els.usageBatteryList.innerHTML = `<div class="empty-state">No active batteries available.</div>`; updateUsageSelectedCount(); return; }
  els.usageBatteryList.innerHTML = batteries.map((battery) => `<label class="check-item"><input type="checkbox" value="${battery.id}" /><span>${escapeHtml(battery.name || battery.serial)}${battery.name ? ` [${escapeHtml(battery.serial)}]` : ""} (${battery.capacity_mah} mAh, ${battery.cell_count}S)</span></label>`).join("");
  updateUsageSelectedCount();
}

function renderStatsGrid() {
  if (!els.statsBatteryGrid) return;
  const batteries = sortBatteries([...state.allBatteries], "recently-used");
  els.statsBatteryGrid.innerHTML = batteries.length ? batteries.map((battery) => `<button type="button" class="stats-battery-card ${state.selectedStatsBatteryId === battery.id ? "active" : ""}" data-stats-battery-id="${battery.id}"><strong>${escapeHtml(battery.name || battery.serial)}</strong><span>${escapeHtml(battery.serial)}</span><span>Last 3: ${escapeHtml(serialSuffix(battery.serial))}</span><span>${battery.archived ? "Archived" : "Active"}</span><span>Rating: ${battery.rating ? "★".repeat(battery.rating) : "-"}</span></button>`).join("") : `<div class="empty-state">No batteries.</div>`;
  renderBatteryDetail();
}

function renderQRCodes() {
  if (!window.QRCode) return;
  document.querySelectorAll(".qr[data-qr-serial]").forEach((container) => {
    const id = container.getAttribute("data-qr-battery-id");
    const serial = container.getAttribute("data-qr-serial");
    if (!id || !serial) return;
    container.innerHTML = "";
    try { new window.QRCode(container, { text: buildBatteryActionUrl(Number(id), "used"), width: 82, height: 82, correctLevel: window.QRCode.CorrectLevel?.M || 0 }); }
    catch { container.innerHTML = `<small>${escapeHtml(serial)}</small>`; }
  });
}

function onBatteryCardsClick(event) {
  const card = event.target.closest("button[data-action], .battery-card");
  if (!card) return;
  const id = Number(card.dataset.id || card.dataset.batteryId);
  if (!id) return;
  const actionButton = event.target.closest("button[data-action]");
  if (actionButton?.dataset.action === "archive") {
    api(`/api/batteries/${id}`, { method: "PATCH", body: { archived: actionButton.dataset.archived !== "1" } }).then(refreshData).catch((e) => setMessage(els.batteryFormMessage, e.message, true));
    return;
  }
  state.selectedStatsBatteryId = id;
  renderBatteryDetail();
}

function onBatteryCardsChange(event) {
  const select = event.target.closest("select[data-action='rating']");
  if (!select) return;
  const id = Number(select.dataset.id);
  const rating = Number(select.value);
  api(`/api/batteries/${id}`, { method: "PATCH", body: { rating: rating === 0 ? null : rating } }).then(refreshData).catch((e) => setMessage(els.batteryFormMessage, e.message, true));
}

function onStatsBatteryGridClick(event) {
  const card = event.target.closest("button[data-stats-battery-id]");
  if (!card) return;
  state.selectedStatsBatteryId = Number(card.dataset.statsBatteryId);
  state.selectedStatsEventIds = new Set();
  renderStatsGrid();
  loadStatsPanel();
}
function onUsageTypeChange() {
  const eventType = els.usageEventType.value;
  els.usageFinalVoltage.required = eventType === "used";
  if (eventType === "storage") els.usageFinalVoltage.value = "3.8";
  else if (eventType === "charged" && els.usageFinalVoltage.value === "3.8") els.usageFinalVoltage.value = "";
}

function getSelectedBatteryIds() { return [...els.usageBatteryList.querySelectorAll("input[type='checkbox']:checked")].map((c) => Number(c.value)).filter(Number.isInteger); }
function selectAllUsageBatteries() { els.usageBatteryList.querySelectorAll("input[type='checkbox']").forEach((c) => c.checked = true); updateUsageSelectedCount(); }
function updateUsageSelectedCount() { els.usageSelectedCount.textContent = `${getSelectedBatteryIds().length} selected`; }

function applyUsageDeepLink() {
  const battery = state.allBatteries.find((b) => b.id === Number(state.selectedUsageBatteryId));
  if (!battery) return;
  switchTab("tab-usage", false);
  els.usageEventType.value = state.selectedUsageEventType || "used";
  onUsageTypeChange();
  renderUsageBatteryList();
  const checkbox = els.usageBatteryList.querySelector(`input[value='${battery.id}']`);
  if (checkbox) checkbox.checked = true;
  updateUsageSelectedCount();
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
    for (let i = 0; i < count; i += 1) await api("/api/batteries", { method: "POST", body: base });
    event.target.reset();
    setMessage(els.batteryFormMessage, `Created ${count} battery(s).`);
    await refreshData();
  } catch (error) { setMessage(els.batteryFormMessage, error.message, true); }
}

async function submitUsageForm(event) {
  event.preventDefault();
  clearMessage(els.usageFormMessage);
  const batteryIds = getSelectedBatteryIds();
  if (!batteryIds.length) return setMessage(els.usageFormMessage, "Select at least one battery.", true);
  const eventType = els.usageEventType.value;
  const parsedVoltage = parseVoltageInput(els.usageFinalVoltage.value);
  if (parsedVoltage.error) return setMessage(els.usageFormMessage, parsedVoltage.error, true);
  const notes = document.getElementById("usage-notes").value.trim() || null;
  const finalAvgVoltage = eventType === "storage" ? 3.8 : parsedVoltage.value;
  if (eventType === "used" && finalAvgVoltage === null) return setMessage(els.usageFormMessage, "Final voltage is required for Used events.", true);
  try {
    await api("/api/events/batch", { method: "POST", body: { batteryIds, eventType, finalAvgVoltage, notes } });
    setMessage(els.usageFormMessage, `Logged ${eventType} for ${batteryIds.length} battery(s).`);
    await refreshData();
  } catch (error) { setMessage(els.usageFormMessage, error.message, true); }
}

function getSelectedEventIds() { return [...els.batteryEvents.querySelectorAll("input[type='checkbox']:checked")].map((c) => Number(c.value)).filter(Number.isInteger); }
async function deleteSelectedStatsEvents() {
  const ids = getSelectedEventIds();
  if (!ids.length) return;
  if (!window.confirm(`Delete ${ids.length} selected event(s)?`)) return;
  for (const id of ids) await api(`/api/events/${id}`, { method: "DELETE" });
  await loadStatsPanel();
}

async function loadStatsPanel() {
  if (!state.selectedStatsBatteryId) return;
  const [batteryResult, eventsResult] = await Promise.all([api(`/api/batteries/${state.selectedStatsBatteryId}`), api(`/api/batteries/${state.selectedStatsBatteryId}/events?limit=20`)]);
  const battery = batteryResult.battery;
  const stats = batteryResult.stats;
  els.statsPanel.innerHTML = `
    <p><strong>Name:</strong> ${escapeHtml(battery.name || "-")}</p>
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

async function openQrScanner() {
  if (!navigator.mediaDevices?.getUserMedia) return setMessage(els.qrScannerMessage, "Camera access is not available in this browser.", true);
  openQrScannerModal();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    els.qrScannerVideo.srcObject = stream;
    await els.qrScannerVideo.play();
    startQrScanLoop();
  } catch (error) { setMessage(els.qrScannerMessage, error.message || "Could not start camera.", true); }
}
function openQrScannerModal() { els.qrScannerModal?.classList.add("open"); els.qrScannerModal?.setAttribute("aria-hidden", "false"); }
function closeQrScanner() { stopQrScanLoop(); if (els.qrScannerVideo?.srcObject) els.qrScannerVideo.srcObject.getTracks().forEach((t) => t.stop()); els.qrScannerModal?.classList.remove("open"); els.qrScannerModal?.setAttribute("aria-hidden", "true"); clearMessage(els.qrScannerMessage); }
function startQrScanLoop() { stopQrScanLoop(); if (!window.BarcodeDetector && typeof window.jsQR !== "function") return setMessage(els.qrScannerMessage, "This browser does not support camera QR scanning.", true); const scanFrame = async () => { const txt = await scanCurrentFrame(); if (txt) return handleScannedQrText(txt); state.scanAnimationFrame = requestAnimationFrame(scanFrame); }; scanFrame(); }
function stopQrScanLoop() { if (state.scanAnimationFrame) { cancelAnimationFrame(state.scanAnimationFrame); state.scanAnimationFrame = null; } }
async function scanCurrentFrame() { if (!els.qrScannerVideo || !els.qrScannerCanvas || els.qrScannerVideo.readyState < 2) return null; const w = els.qrScannerVideo.videoWidth, h = els.qrScannerVideo.videoHeight; if (!w || !h) return null; const ctx = els.qrScannerCanvas.getContext("2d", { willReadFrequently: true }); els.qrScannerCanvas.width = w; els.qrScannerCanvas.height = h; ctx.drawImage(els.qrScannerVideo, 0, 0, w, h); if (window.BarcodeDetector) { const detector = state.qrDetector || (state.qrDetector = new window.BarcodeDetector({ formats: ["qr_code"] })); const bitmap = await createImageBitmap(els.qrScannerCanvas); try { const codes = await detector.detect(bitmap); return codes[0]?.rawValue || null; } finally { bitmap.close?.(); } } if (typeof window.jsQR !== "function") return null; const imageData = ctx.getImageData(0, 0, w, h); return window.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" })?.data || null; }
function handleScannedQrText(text) { const raw = String(text || "").trim(); if (!raw) return; const url = new URL(raw, window.location.href); const batteryParam = url.searchParams.get("battery"); if (batteryParam && /^\d+$/.test(batteryParam)) { state.selectedUsageBatteryId = batteryParam; state.selectedUsageEventType = url.searchParams.get("type") || "used"; closeQrScanner(); refreshData().then(() => applyUsageDeepLink()); return; } setMessage(els.qrScannerMessage, "QR code did not include a battery selection.", true); }
function formatDateTime(value) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString(); }
function setMessage(element, text, isError = false) { if (!element) return; element.textContent = text || ""; element.classList.toggle("error", Boolean(isError)); }
function clearMessage(element) { setMessage(element, ""); }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }