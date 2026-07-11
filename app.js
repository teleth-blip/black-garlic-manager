(() => {
  "use strict";

  const STORAGE_KEYS = {
    url: "blackGarlicSupabaseUrl",
    key: "blackGarlicSupabaseAnonKey",
    worker: "blackGarlicWorkerId",
    pins: "blackGarlicSavedPins"
  };

  const TABLES = {
    rooms: "black_garlic_rooms",
    types: "black_garlic_types",
    storageTypes: "black_garlic_storage_types",
    lots: "black_garlic_harvest_lots",
    brackets: "black_garlic_age_brackets",
    rules: "black_garlic_maturation_rules",
    entries: "black_garlic_entries",
    storageEntries: "black_garlic_storage_entries",
    settings: "black_garlic_settings",
    workers: "workers"
  };

  const state = {
    client: null,
    workerId: "",
    activeTab: "main",
    activeSummary: "daily",
    activePrediction: "table",
    activeMaster: "rooms",
    data: emptyData(),
    drafts: {},
    charts: {
      summary: null,
      prediction: null
    }
  };

  function emptyData() {
    return {
      workers: [],
      rooms: [],
      types: [],
      storageTypes: [],
      lots: [],
      brackets: [],
      rules: [],
      entries: [],
      storageEntries: [],
      settings: {}
    };
  }

  const $ = id => document.getElementById(id);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    setDefaultDates();
    bindEvents();
    createIcons();
    connect().catch(err => showFatal(err));
  }

  function bindEvents() {
    $("saveSetupBtn").addEventListener("click", saveSetup);
    $("loginBtn").addEventListener("click", login);
    $("loginWorkerSelect").addEventListener("change", () => {
      $("loginMessage").textContent = "";
      syncPinVisibility();
    });
    $("workerSelect").addEventListener("change", event => {
      state.workerId = event.target.value;
      localStorage.setItem(STORAGE_KEYS.worker, state.workerId);
    });
    $("reloadBtn").addEventListener("click", () => refreshAll("更新しました"));
    $("logoutBtn").addEventListener("click", logout);

    $$(".tab").forEach(btn => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    $("mainForm").addEventListener("submit", event => {
      event.preventDefault();
      saveMainEntry().catch(showError);
    });
    $("mainClearBtn").addEventListener("click", clearMainForm);
    $("mainDate").addEventListener("change", () => {
      loadMainRecordByKey();
    });
    $("mainType").addEventListener("change", () => {
      loadMainRecordByKey();
    });
    $("mainRoom").addEventListener("change", loadMainRecordByKey);
    $("mainHistoryDate").addEventListener("change", renderMainHistory);
    $("mainHistoryType").addEventListener("change", renderMainHistory);
    $("mainPrevDateBtn").addEventListener("click", () => moveDate("mainHistoryDate", -1));
    $("mainNextDateBtn").addEventListener("click", () => moveDate("mainHistoryDate", 1));

    $("storageForm").addEventListener("submit", event => {
      event.preventDefault();
      saveStorageEntry().catch(showError);
    });
    $("storageClearBtn").addEventListener("click", clearStorageForm);
    $("storageDate").addEventListener("change", () => {
      loadStorageRecordByKey();
    });
    $("storageType").addEventListener("change", loadStorageRecordByKey);
    $("storageHistoryDate").addEventListener("change", renderStorageHistory);
    $("storageHistoryType").addEventListener("change", renderStorageHistory);
    $("storagePrevDateBtn").addEventListener("click", () => moveDate("storageHistoryDate", -1));
    $("storageNextDateBtn").addEventListener("click", () => moveDate("storageHistoryDate", 1));

    $$("#summaryPanel .sub-tab[data-summary-view]").forEach(btn => {
      btn.addEventListener("click", () => switchSummary(btn.dataset.summaryView));
    });
    $("summaryRefreshBtn").addEventListener("click", renderSummary);
    $("graphRefreshBtn").addEventListener("click", renderSummaryGraph);
    $("summaryPrintBtn").addEventListener("click", () => window.print());
    ["summaryStartDate", "summaryType", "summaryRoom"].forEach(id => {
      $(id).addEventListener("change", renderSummary);
    });

    $$("#predictionPanel .sub-tab[data-prediction-view]").forEach(btn => {
      btn.addEventListener("click", () => switchPrediction(btn.dataset.predictionView));
    });
    $("predictionRefreshBtn").addEventListener("click", () => {
      savePredictionSettings().then(renderPrediction).catch(showError);
    });

    $$("#masterPanel .sub-tab[data-master-view]").forEach(btn => {
      btn.addEventListener("click", () => switchMaster(btn.dataset.masterView));
    });
    $("masterPanel").addEventListener("click", handleMasterClick);
    $("masterSaveBtn").addEventListener("click", () => saveMaster().catch(showError));
  }

  async function connect() {
    const config = readConfig();
    const hasFileConfig = hasStaticConfig();
    if (!hasFileConfig && shouldForceSetup()) {
      showSetup();
      return;
    }
    if (!config.url || !config.key) {
      showSetup();
      return;
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabaseライブラリを読み込めませんでした。通信環境を確認してください。");
    }

    try {
      state.client = window.supabase.createClient(config.url, config.key);
    } catch (error) {
      if (!hasFileConfig) showSetup();
      throw error;
    }
    $("setupPanel").classList.add("hidden");
    $("loginPanel").classList.add("hidden");
    await loadWorkersForLogin();
  }

  function showSetup() {
    const config = readConfig();
    $("setupUrl").value = config.url;
    $("setupKey").value = config.key;
    $("setupPanel").classList.remove("hidden");
    $("loginPanel").classList.add("hidden");
    document.body.classList.add("login-locked");
    createIcons();
  }

  function readConfig() {
    const fileConfig = window.APP_CONFIG || {};
    const fileUrl = String(fileConfig.supabaseUrl || "").trim();
    const fileKey = String(fileConfig.supabaseAnonKey || "").trim();
    return {
      url: fileUrl || localStorage.getItem(STORAGE_KEYS.url) || "",
      key: fileKey || localStorage.getItem(STORAGE_KEYS.key) || ""
    };
  }

  function hasStaticConfig() {
    const fileConfig = window.APP_CONFIG || {};
    return !!String(fileConfig.supabaseUrl || "").trim() && !!String(fileConfig.supabaseAnonKey || "").trim();
  }

  function shouldForceSetup() {
    const params = new URLSearchParams(window.location.search);
    return params.has("setup") || window.location.hash === "#setup";
  }

  async function saveSetup() {
    const url = $("setupUrl").value.trim();
    const key = $("setupKey").value.trim();
    if (!url || !key) {
      showError(new Error("Supabase URLとanon keyを入力してください。"));
      return;
    }
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
      showError(new Error("Supabase URLは https://xxxxxxxx.supabase.co の形式で入力してください。"));
      return;
    }
    localStorage.setItem(STORAGE_KEYS.url, url);
    localStorage.setItem(STORAGE_KEYS.key, key);
    await connect();
  }

  async function loadWorkersForLogin() {
    state.data.workers = await selectAll(TABLES.workers, query => query.order("display_order").order("worker_id"));
    renderWorkerSelects();
    const saved = localStorage.getItem(STORAGE_KEYS.worker) || "";
    if (saved && activeWorkers().some(worker => worker.worker_id === saved)) {
      state.workerId = saved;
      $("loginWorkerSelect").value = saved;
      $("workerSelect").value = saved;
      if (await tryAutoLogin(saved)) return;
    }
    $("loginPanel").classList.remove("hidden");
    document.body.classList.add("login-locked");
    syncPinVisibility();
  }

  function renderWorkerSelects() {
    const workers = activeWorkers();
    const options = workers.map(worker => `<option value="${esc(worker.worker_id)}">${esc(worker.worker_name)}</option>`).join("");
    $("loginWorkerSelect").innerHTML = options;
    $("workerSelect").innerHTML = options;
    if (!state.workerId && workers[0]) state.workerId = workers[0].worker_id;
    if (state.workerId) {
      $("loginWorkerSelect").value = state.workerId;
      $("workerSelect").value = state.workerId;
    }
  }

  function activeWorkers() {
    return state.data.workers.filter(worker => worker.active !== false);
  }

  function syncPinVisibility() {
    const worker = activeWorkers().find(item => item.worker_id === $("loginWorkerSelect").value);
    const pin = workerPin(worker);
    const savedPin = worker ? savedWorkerPin(worker.worker_id) : "";
    const shouldShowPin = !!pin && !savedPin;
    $("loginPinLabel").classList.toggle("hidden", !shouldShowPin);
    if (!shouldShowPin) $("loginPin").value = "";
  }

  function workerPin(worker) {
    const note = String(worker && worker.note || "");
    const match = note.match(/(?:pin|PIN|Pin)\s*[:=]\s*([0-9]+)/);
    return match ? match[1] : "";
  }

  async function login() {
    const selected = $("loginWorkerSelect").value;
    const worker = activeWorkers().find(item => item.worker_id === selected);
    if (!worker) {
      $("loginMessage").textContent = "有効な作業者がありません。";
      return;
    }
    const pin = workerPin(worker);
    const enteredPin = $("loginPin").value.trim();
    const savedPin = savedWorkerPin(selected);
    const usablePin = enteredPin || savedPin;
    if (pin && usablePin !== pin) {
      if (savedPin && !enteredPin) {
        removeSavedWorkerPin(selected);
        syncPinVisibility();
        $("loginMessage").textContent = "保存済みPINが違います。PINを入力してください。";
      } else {
        $("loginMessage").textContent = "PINが違います。";
      }
      return;
    }
    if (pin && enteredPin) saveWorkerPin(selected, enteredPin);
    await completeLogin(selected);
  }

  function logout() {
    document.body.classList.add("login-locked");
    $("loginPanel").classList.remove("hidden");
    syncPinVisibility();
  }

  async function tryAutoLogin(workerId) {
    const worker = activeWorkers().find(item => item.worker_id === workerId);
    if (!worker) return false;
    const pin = workerPin(worker);
    const savedPin = savedWorkerPin(workerId);
    if (pin && savedPin !== pin) {
      if (savedPin) removeSavedWorkerPin(workerId);
      return false;
    }
    await completeLogin(workerId);
    return true;
  }

  async function completeLogin(workerId) {
    state.workerId = workerId;
    localStorage.setItem(STORAGE_KEYS.worker, workerId);
    $("loginWorkerSelect").value = workerId;
    $("workerSelect").value = workerId;
    $("loginPin").value = "";
    $("loginMessage").textContent = "";
    document.body.classList.remove("login-locked");
    $("loginPanel").classList.add("hidden");
    await refreshAll();
  }

  function savedPins() {
    try {
      const pins = JSON.parse(localStorage.getItem(STORAGE_KEYS.pins) || "{}");
      return pins && typeof pins === "object" ? pins : {};
    } catch (error) {
      return {};
    }
  }

  function savedWorkerPin(workerId) {
    const pins = savedPins();
    return String(pins[workerId] || "");
  }

  function saveWorkerPin(workerId, pin) {
    if (!workerId || !pin) return;
    const pins = savedPins();
    pins[workerId] = pin;
    localStorage.setItem(STORAGE_KEYS.pins, JSON.stringify(pins));
  }

  function removeSavedWorkerPin(workerId) {
    const pins = savedPins();
    delete pins[workerId];
    localStorage.setItem(STORAGE_KEYS.pins, JSON.stringify(pins));
  }

  async function refreshAll(message) {
    await withBusy($("reloadBtn"), async () => {
      await loadAll();
      renderAll();
      if (message) toast(message);
    });
  }

  async function loadAll() {
    const [
      workers,
      rooms,
      types,
      storageTypes,
      lots,
      brackets,
      rules,
      entries,
      storageEntries,
      settingsRows
    ] = await Promise.all([
      selectAll(TABLES.workers, query => query.order("display_order").order("worker_id")),
      selectAll(TABLES.rooms, query => query.order("display_order").order("room_name")),
      selectAll(TABLES.types, query => query.order("display_order").order("type_name")),
      selectAll(TABLES.storageTypes, query => query.order("display_order").order("type_name")),
      selectAll(TABLES.lots, query => query.order("harvest_date", { ascending: false }).order("lot_name")),
      selectAll(TABLES.brackets, query => query.order("display_order").order("min_days")),
      selectAll(TABLES.rules, query => query.order("room_id")),
      selectAll(TABLES.entries, query => query.order("entry_date").order("recorded_at")),
      selectAll(TABLES.storageEntries, query => query.order("storage_date").order("recorded_at")),
      selectAll(TABLES.settings, query => query.order("setting_key"))
    ]);

    state.data = {
      workers,
      rooms,
      types,
      storageTypes,
      lots,
      brackets,
      rules,
      entries,
      storageEntries,
      settings: Object.fromEntries(settingsRows.map(row => [row.setting_key, row.setting_value]))
    };
    renderWorkerSelects();
    resetDrafts();
  }

  async function selectAll(table, configure) {
    let query = state.client.from(table).select("*").range(0, 49999);
    if (configure) query = configure(query);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  function renderAll() {
    fillAllSelects();
    renderMainHistory();
    renderStorageHistory();
    renderSummary();
    renderPrediction();
    renderMaster();
    fitResponsiveTables();
    createIcons();
  }

  function fillAllSelects() {
    fillSelect("mainType", activeRows(state.data.types), "id", "type_name");
    fillSelect("mainRoom", activeRows(state.data.rooms), "id", "room_name");
    fillSelect("mainHistoryType", activeRows(state.data.types), "id", "type_name", "全体");
    fillSelect("storageType", activeRows(state.data.storageTypes), "id", "type_name");
    fillSelect("storageHistoryType", activeRows(state.data.storageTypes), "id", "type_name", "全体");
    fillSelect("summaryType", activeRows(state.data.types), "id", "type_name", "全体");
    fillSelect("summaryRoom", activeRows(state.data.rooms), "id", "room_name", "全体");
    fillSelect("predictionType", activeRows(state.data.types), "id", "type_name", "全体");
    fillSelect("predictionRoom", activeRows(state.data.rooms), "id", "room_name", "全体");
    $("avgUsage").value = state.data.settings.prediction && state.data.settings.prediction.avgUsage !== undefined
      ? state.data.settings.prediction.avgUsage
      : 0;
  }

  function fillSelect(id, rows, valueKey, labelKey, allLabel) {
    const el = $(id);
    const current = el.value;
    const options = [];
    if (allLabel) options.push(`<option value="All">${esc(allLabel)}</option>`);
    rows.forEach(row => {
      const label = typeof labelKey === "function" ? labelKey(row) : row[labelKey];
      options.push(`<option value="${esc(row[valueKey])}">${esc(label)}</option>`);
    });
    el.innerHTML = options.join("");
    if (current && Array.from(el.options).some(option => option.value === current)) {
      el.value = current;
    }
  }

  function activeRows(rows) {
    return rows.filter(row => row.active !== false);
  }

  function getDefaultLotId() {
    const lots = activeRows(state.data.lots);
    const lot = lots.find(row => row.lot_name === "未指定") || lots[0] || state.data.lots[0];
    if (!lot || !lot.id) {
      throw new Error("既定の収穫ロットがありません。Supabaseの初期データを確認してください。");
    }
    return lot.id;
  }

  function switchTab(tab) {
    state.activeTab = tab;
    $$(".tab").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
    $$("[data-panel]").forEach(panel => panel.classList.toggle("active-panel", panel.dataset.panel === tab));
    if (tab === "summary") renderSummary();
    if (tab === "prediction") renderPrediction();
    if (tab === "master") renderMaster();
    createIcons();
  }

  function switchSummary(view) {
    state.activeSummary = view;
    $$("#summaryPanel .sub-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.summaryView === view));
    $$(".summary-view").forEach(el => el.classList.toggle("active", el.id === `${view}Summary` || (view === "graph" && el.id === "summaryGraph")));
    renderSummary();
  }

  function switchPrediction(view) {
    state.activePrediction = view;
    $$("#predictionPanel .sub-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.predictionView === view));
    $("predictionTableView").classList.toggle("active", view === "table");
    $("predictionChartView").classList.toggle("active", view === "chart");
    renderPrediction();
  }

  function switchMaster(view) {
    state.activeMaster = view;
    $$("#masterPanel .sub-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.masterView === view));
    $$(".master-view").forEach(el => el.classList.remove("active"));
    const map = {
      rooms: "masterRooms",
      types: "masterTypes",
      storageTypes: "masterStorageTypes",
      lots: "masterLots",
      maturation: "masterMaturation"
    };
    $(map[view]).classList.add("active");
    renderMaster();
  }

  async function saveMainEntry() {
    const payload = {
      recorded_at: new Date().toISOString(),
      entry_date: $("mainDate").value,
      worker_id: state.workerId,
      room_id: $("mainRoom").value,
      type_id: $("mainType").value,
      harvest_lot_id: getDefaultLotId(),
      temperature: nullableNumber($("mainTemperature").value),
      out_qty: clampNumber($("mainOut").value),
      in_qty: clampNumber($("mainIn").value),
      empty_qty: clampNumber($("mainEmpty").value),
      note: $("mainNote").value.trim(),
      inventory_manual: $("mainInventory").value !== "",
      inventory_qty: $("mainInventory").value === "" ? 0 : clampNumber($("mainInventory").value)
    };
    requireFields(payload, ["entry_date", "worker_id", "room_id", "type_id", "harvest_lot_id"]);

    const id = $("mainEntryId").value;
    await withBusy($("mainForm").querySelector("button[type='submit']"), async () => {
      if (id) {
        await assertOk(state.client.from(TABLES.entries).update(payload).eq("id", id));
      } else {
        await assertOk(state.client.from(TABLES.entries).upsert(payload, {
          onConflict: "entry_date,room_id,type_id,harvest_lot_id"
        }));
      }
      await recalculateInventoryGroup(payload.room_id, payload.type_id, payload.harvest_lot_id);
      await loadAll();
      renderAll();
      loadMainRecordByKey();
      $("mainStatus").textContent = "保存済み";
      setTimeout(() => $("mainStatus").textContent = "", 1600);
    });
  }

  async function recalculateInventoryGroup(roomId, typeId, lotId) {
    let query = state.client
      .from(TABLES.entries)
      .select("*")
      .eq("room_id", roomId)
      .eq("type_id", typeId)
      .eq("harvest_lot_id", lotId)
      .order("entry_date")
      .order("recorded_at");
    const { data, error } = await query;
    if (error) throw error;
    let inventory = 0;
    for (const row of data || []) {
      if (row.inventory_manual) {
        inventory = clampNumber(row.inventory_qty);
      } else {
        inventory = clampNumber(inventory - clampNumber(row.out_qty) + clampNumber(row.in_qty));
      }
      if (Number(row.inventory_qty || 0) !== inventory) {
        await assertOk(state.client.from(TABLES.entries).update({ inventory_qty: inventory }).eq("id", row.id));
      }
    }
  }

  async function deleteMainEntry(id) {
    const targetId = id || $("mainEntryId").value;
    const isEditingTarget = $("mainEntryId").value === targetId;
    if (!targetId) return;
    if (!confirm("この行の黒にんにくデータを削除しますか？")) return;
    const row = state.data.entries.find(item => item.id === targetId);
    await assertOk(state.client.from(TABLES.entries).delete().eq("id", targetId));
    if (row) await recalculateInventoryGroup(row.room_id, row.type_id, row.harvest_lot_id);
    await loadAll();
    if (isEditingTarget) clearMainForm();
    renderAll();
  }

  function clearMainForm() {
    $("mainEntryId").value = "";
    $("mainTemperature").value = "";
    $("mainOut").value = "";
    $("mainIn").value = "";
    $("mainEmpty").value = "";
    $("mainInventory").value = "";
    $("mainNote").value = "";
    setMainEditMode(false);
  }

  function loadMainRecordByKey() {
    const row = state.data.entries.find(item =>
      item.entry_date === $("mainDate").value &&
      item.type_id === $("mainType").value &&
      item.room_id === $("mainRoom").value &&
      item.harvest_lot_id === getDefaultLotId()
    );
    if (row) loadMainRow(row);
    else clearMainForm();
  }

  function loadMainRow(row) {
    if (!row) return;
    $("mainEntryId").value = row.id;
    $("mainDate").value = row.entry_date;
    $("mainType").value = row.type_id;
    $("mainRoom").value = row.room_id;
    $("mainTemperature").value = row.temperature ?? "";
    $("mainOut").value = row.out_qty ?? "";
    $("mainIn").value = row.in_qty ?? "";
    $("mainEmpty").value = row.empty_qty ?? "";
    $("mainInventory").value = row.inventory_manual ? row.inventory_qty ?? "" : "";
    $("mainNote").value = row.note || "";
    setMainEditMode(true);
  }

  function setMainEditMode(isEdit) {
    const button = $("mainSubmitBtn");
    if (!button) return;
    const label = button.querySelector("span");
    if (label) label.textContent = isEdit ? "【編集モード】更新する" : "データ登録";
    button.classList.toggle("edit-mode", isEdit);
  }

  function renderMainHistory() {
    const date = $("mainHistoryDate").value;
    const typeId = $("mainHistoryType").value;
    $("mainHistoryWeekday").value = weekdayLabel(date);
    const rows = state.data.entries
      .filter(row => row.entry_date === date && (typeId === "All" || !typeId || row.type_id === typeId))
      .sort((a, b) => compareDisplay(roomName(a.room_id), roomName(b.room_id)) || compareDisplay(typeName(a.type_id), typeName(b.type_id)));

    const totalOut = rows.reduce((sum, row) => sum + clampNumber(row.out_qty), 0);
    const totalIn = rows.reduce((sum, row) => sum + clampNumber(row.in_qty), 0);
    const totalEmpty = rows.reduce((sum, row) => sum + clampNumber(row.empty_qty), 0);
    const totalInventory = rows.reduce((sum, row) => sum + clampNumber(row.inventory_qty), 0);
    const body = rows.map(row => `
      <tr class="clickable" data-main-id="${esc(row.id)}">
        <td class="stack-cell">${esc(workerName(row.worker_id))}</td>
        <td class="stack-cell">${esc(roomName(row.room_id))}</td>
        <td class="stack-cell">${esc(typeName(row.type_id))}</td>
        <td class="num-cell">${num(row.temperature)}</td>
        <td class="num-cell">${num(row.out_qty)}</td>
        <td class="num-cell">${num(row.in_qty)}</td>
        <td class="num-cell">${num(row.empty_qty)}</td>
        <td class="num-cell">${num(row.inventory_qty)}${row.inventory_manual ? '<span class="manual-mark">＊</span>' : ""}</td>
        <td class="note-cell">${esc(row.note || "")}</td>
        <td class="action-cell"><button type="button" class="danger icon-btn row-delete-btn" data-main-delete="${esc(row.id)}" title="削除"><i data-lucide="trash-2"></i></button></td>
      </tr>
    `).join("");

    $("mainHistory").innerHTML = `
      <table class="main-history-table">
        <colgroup>
          <col class="col-worker">
          <col class="col-room">
          <col class="col-type">
          <col class="col-number">
          <col class="col-number">
          <col class="col-number">
          <col class="col-number">
          <col class="col-inventory">
          <col class="col-note">
          <col class="col-action">
        </colgroup>
        <thead><tr><th class="stack-heading">作業者</th><th class="stack-heading">室</th><th class="stack-heading">種別</th><th>温度</th><th>出庫</th><th>入庫</th><th>空き</th><th>在庫</th><th class="stack-heading">備考</th><th>削除</th></tr></thead>
        <tbody>${body || emptyRow(10)}<tr class="total-row"><td colspan="4">合計</td><td>${num(totalOut)}</td><td>${num(totalIn)}</td><td>${num(totalEmpty)}</td><td>${num(totalInventory)}</td><td></td><td></td></tr></tbody>
      </table>
    `;
    $("mainHistory").querySelectorAll("[data-main-delete]").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        deleteMainEntry(button.dataset.mainDelete).catch(showError);
      });
    });
    $("mainHistory").querySelectorAll("[data-main-id]").forEach(tr => {
      tr.addEventListener("click", () => loadMainRow(state.data.entries.find(row => row.id === tr.dataset.mainId)));
    });
    fitResponsiveTables($("mainHistory"));
  }

  async function saveStorageEntry() {
    const payload = {
      recorded_at: new Date().toISOString(),
      storage_date: $("storageDate").value,
      worker_id: state.workerId,
      storage_type_id: $("storageType").value,
      columns16: Math.max(0, Math.floor(clampNumber($("storageColumns").value))),
      pieces: Math.max(0, Math.floor(clampNumber($("storagePieces").value))),
      note: $("storageNote").value.trim()
    };
    requireFields(payload, ["storage_date", "worker_id", "storage_type_id"]);
    const id = $("storageEntryId").value;
    await withBusy($("storageForm").querySelector("button[type='submit']"), async () => {
      if (id) {
        await assertOk(state.client.from(TABLES.storageEntries).update(payload).eq("id", id));
      } else {
        await assertOk(state.client.from(TABLES.storageEntries).upsert(payload, {
          onConflict: "storage_date,storage_type_id"
        }));
      }
      await loadAll();
      renderAll();
      loadStorageRecordByKey();
      $("storageStatus").textContent = "保存済み";
      setTimeout(() => $("storageStatus").textContent = "", 1600);
    });
  }

  async function deleteStorageEntry(id) {
    const targetId = id || $("storageEntryId").value;
    const isEditingTarget = $("storageEntryId").value === targetId;
    if (!targetId) return;
    if (!confirm("この行の保管庫データを削除しますか？")) return;
    await assertOk(state.client.from(TABLES.storageEntries).delete().eq("id", targetId));
    await loadAll();
    if (isEditingTarget) clearStorageForm();
    renderAll();
  }

  function clearStorageForm() {
    $("storageEntryId").value = "";
    $("storageColumns").value = "";
    $("storagePieces").value = "";
    $("storageNote").value = "";
  }

  function loadStorageRecordByKey() {
    const row = state.data.storageEntries.find(item =>
      item.storage_date === $("storageDate").value &&
      item.storage_type_id === $("storageType").value
    );
    if (row) loadStorageRow(row);
    else clearStorageForm();
  }

  function loadStorageRow(row) {
    $("storageEntryId").value = row.id;
    $("storageDate").value = row.storage_date;
    $("storageType").value = row.storage_type_id;
    $("storageColumns").value = row.columns16 ?? "";
    $("storagePieces").value = row.pieces ?? "";
    $("storageNote").value = row.note || "";
  }

  function renderStorageHistory() {
    const date = $("storageHistoryDate").value;
    const typeId = $("storageHistoryType").value;
    $("storageHistoryWeekday").value = weekdayLabel(date);
    const rows = state.data.storageEntries
      .filter(row => row.storage_date === date && (typeId === "All" || !typeId || row.storage_type_id === typeId))
      .sort((a, b) => compareDisplay(storageTypeName(a.storage_type_id), storageTypeName(b.storage_type_id)));
    const totalColumns = rows.reduce((sum, row) => sum + storageColumns(row), 0);
    const body = rows.map(row => `
      <tr class="clickable" data-storage-id="${esc(row.id)}">
        <td class="text-left">${esc(fmtDate(row.storage_date))}</td>
        <td class="text-left">${esc(workerName(row.worker_id))}</td>
        <td class="text-left">${esc(storageTypeName(row.storage_type_id))}</td>
        <td>${num(row.columns16, 0)}</td>
        <td>${num(row.pieces, 0)}</td>
        <td>${num(storageColumns(row))}</td>
        <td class="text-left">${esc(row.note || "")}</td>
        <td class="action-cell"><button type="button" class="danger icon-btn row-delete-btn" data-storage-delete="${esc(row.id)}" title="削除"><i data-lucide="trash-2"></i></button></td>
      </tr>
    `).join("");
    $("storageHistory").innerHTML = `
      <table>
        <thead><tr><th>日付</th><th>作業者</th><th>種別</th><th>16段</th><th>端数</th><th>列換算</th><th>備考</th><th>削除</th></tr></thead>
        <tbody>${body || emptyRow(8)}<tr class="total-row"><td colspan="5">合計</td><td>${num(totalColumns)}</td><td></td><td></td></tr></tbody>
      </table>
    `;
    $("storageHistory").querySelectorAll("[data-storage-delete]").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        deleteStorageEntry(button.dataset.storageDelete).catch(showError);
      });
    });
    $("storageHistory").querySelectorAll("[data-storage-id]").forEach(tr => {
      tr.addEventListener("click", () => loadStorageRow(state.data.storageEntries.find(row => row.id === tr.dataset.storageId)));
    });
    fitResponsiveTables($("storageHistory"));
  }

  function renderSummary() {
    if (state.activeSummary === "daily") renderDailySummary();
    if (state.activeSummary === "weekly") renderWeeklySummary();
    if (state.activeSummary === "monthly") renderMonthlySummary();
    if (state.activeSummary === "graph") renderSummaryGraph();
    fitResponsiveTables($("summaryPanel"));
  }

  function renderDailySummary() {
    const base = parseYmd($("summaryStartDate").value);
    const start = addDays(base, -6);
    const end = base;
    const rows = dateRange(start, end).map(date => {
      const ymd = dateToStr(date);
      const dayRows = filterEntries(ymd, ymd, $("summaryType").value, $("summaryRoom").value);
      return {
        date: ymd,
        workers: unique(dayRows.map(row => workerName(row.worker_id)).filter(Boolean)).join("、"),
        out: sum(dayRows, "out_qty"),
        inQty: sum(dayRows, "in_qty"),
        empty: sum(dayRows, "empty_qty"),
        inventory: sum(dayRows, "inventory_qty"),
        note: dayRows.map(row => row.note).filter(Boolean).join(" / ")
      };
    });

    $("dailySummary").innerHTML = tableHtml(
      ["日付", "作業者名", "搬入数", "搬出数", "在庫", "空き", "備考"],
      rows.map(row => [
        fmtDate(row.date),
        row.workers,
        num(row.inQty),
        num(row.out),
        num(row.inventory),
        num(row.empty),
        row.note
      ]),
      [0, 1, 6]
    );
  }

  function renderWeeklySummary() {
    const base = parseYmd($("summaryStartDate").value);
    const monday = startOfWeekMonday(base);
    const days = dateRange(monday, addDays(monday, 6));
    const typeId = $("summaryType").value;
    const roomId = $("summaryRoom").value;
    const types = typeId === "All" ? activeRows(state.data.types) : activeRows(state.data.types).filter(row => row.id === typeId);
    const rooms = roomId === "All" ? activeRows(state.data.rooms) : activeRows(state.data.rooms).filter(row => row.id === roomId);
    const sections = [];

    types.forEach(type => {
      rooms.forEach(room => {
        const allRows = days.flatMap(day => filterEntries(dateToStr(day), dateToStr(day), type.id, room.id));
        if (!allRows.length) return;
        const rows = days.map(day => {
          const ymd = dateToStr(day);
          const dayRows = allRows.filter(row => row.entry_date === ymd);
          return [
            fmtDate(ymd),
            unique(dayRows.map(row => workerName(row.worker_id)).filter(Boolean)).join("、"),
            num(sum(dayRows, "in_qty")),
            num(sum(dayRows, "out_qty")),
            num(sum(dayRows, "inventory_qty")),
            num(lastValue(dayRows, "temperature")),
            dayRows.map(row => fmtTime(row.recorded_at)).filter(Boolean).join("、"),
            dayRows.map(row => row.note).filter(Boolean).join(" / ")
          ];
        });
        sections.push(`
          <h2 class="print-title">${esc(reiwaMonthLabel(monday))} ${esc(type.type_name)} ${esc(room.room_name)}</h2>
          ${tableHtml(["日付(曜日)", "作業者名", "搬入数", "搬出数", "在庫", "温度", "時刻", "備考"], rows, [0, 1, 7])}
        `);
      });
    });

    $("weeklySummary").innerHTML = sections.join("") || `<p class="muted">表示対象のデータがありません。</p>`;
  }

  function renderMonthlySummary() {
    const base = parseYmd($("summaryStartDate").value);
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    const rows = [];
    activeRows(state.data.types).forEach(type => {
      activeRows(state.data.rooms).forEach(room => {
        const list = filterEntries(dateToStr(start), dateToStr(end), type.id, room.id);
        if (!list.length) return;
        rows.push([
          type.type_name,
          room.room_name,
          num(sum(list, "in_qty")),
          num(sum(list, "out_qty")),
          num(sum(list, "empty_qty")),
          num(lastInventory(list))
        ]);
      });
    });

    const storageRows = activeRows(state.data.storageTypes).map(type => {
      const list = state.data.storageEntries.filter(row =>
        row.storage_type_id === type.id &&
        row.storage_date >= dateToStr(start) &&
        row.storage_date <= dateToStr(end)
      );
      if (!list.length) return null;
      const last = list.sort((a, b) => compareDisplay(a.storage_date, b.storage_date)).at(-1);
      return [type.type_name, fmtDate(last.storage_date), num(last.columns16, 0), num(last.pieces, 0), num(storageColumns(last))];
    }).filter(Boolean);

    $("monthlySummary").innerHTML = `
      <h2 class="print-title">${esc(reiwaMonthLabel(start))} 室別集計</h2>
      ${tableHtml(["種別", "室名", "搬入数", "搬出数", "空き", "在庫"], rows, [0, 1])}
      <h2 class="print-title">保管庫集計</h2>
      ${tableHtml(["種別", "最終日", "16段", "端数", "列換算"], storageRows, [0, 1])}
    `;
  }

  function renderSummaryGraph() {
    const start = $("graphStartDate").value;
    const end = $("graphEndDate").value;
    const days = dateRange(parseYmd(start), parseYmd(end));
    const labels = days.map(day => fmtShortDate(dateToStr(day)));
    const inData = [];
    const outData = [];
    const inventoryData = [];
    days.forEach(day => {
      const ymd = dateToStr(day);
      const rows = filterEntries(ymd, ymd, $("summaryType").value, $("summaryRoom").value);
      inData.push(round2(sum(rows, "in_qty")));
      outData.push(round2(sum(rows, "out_qty")));
      inventoryData.push(round2(inventoryAsOf(ymd, $("summaryType").value, $("summaryRoom").value)));
    });

    const canvas = $("summaryChart");
    if (typeof Chart === "undefined") return;
    if (state.charts.summary) state.charts.summary.destroy();
    state.charts.summary = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "入庫", data: inData, borderColor: "#176b55", backgroundColor: "rgba(23,107,85,.12)", tension: .25, yAxisID: "y" },
          { label: "出庫", data: outData, borderColor: "#b54708", backgroundColor: "rgba(181,71,8,.12)", tension: .25, yAxisID: "y" },
          { label: "在庫", data: inventoryData, borderColor: "#2563eb", backgroundColor: "rgba(37,99,235,.12)", tension: .25, yAxisID: "y1" }
        ]
      },
      options: chartOptions("数量", "在庫")
    });
  }

  async function savePredictionSettings() {
    const value = { avgUsage: clampNumber($("avgUsage").value) };
    await assertOk(state.client.from(TABLES.settings).upsert({
      setting_key: "prediction",
      setting_value: value
    }));
    state.data.settings.prediction = value;
  }

  function renderPrediction() {
    const pred = buildPrediction();
    $("predictionTable").innerHTML = tableHtml(
      ["日付", "予測出庫数", "実出庫数", "保管列換算", "予測保管数"],
      pred.rows.map(row => [
        fmtDate(row.date),
        num(row.pred),
        num(row.actual),
        num(row.predColumns),
        num(row.forecastStorage)
      ]),
      [0]
    );
    renderPredictionChart(pred);
    fitResponsiveTables($("predictionPanel"));
  }

  function buildPrediction() {
    const start = $("predictionStartDate").value;
    const end = $("predictionEndDate").value;
    const typeId = $("predictionType").value;
    const roomId = $("predictionRoom").value;
    const avgUsage = clampNumber($("avgUsage").value);
    const map = new Map(dateRange(parseYmd(start), parseYmd(end)).map(day => {
      const ymd = dateToStr(day);
      return [ymd, { date: ymd, pred: 0, actual: 0, predColumns: 0, forecastStorage: 0 }];
    }));

    state.data.entries.forEach(row => {
      if (!matchesFilters(row, typeId, roomId)) return;
      if (row.entry_date >= start && row.entry_date <= end && map.has(row.entry_date)) {
        map.get(row.entry_date).actual += clampNumber(row.out_qty);
      }
      if (clampNumber(row.in_qty) > 0) {
        const days = maturationDays(row);
        const pDate = dateToStr(addDays(parseYmd(row.entry_date), days));
        if (pDate >= start && pDate <= end && map.has(pDate)) {
          const item = map.get(pDate);
          item.pred += clampNumber(row.in_qty);
          item.predColumns += clampNumber(row.in_qty) / 32;
        }
      }
    });

    let storage = latestStorageTotal(addDays(parseYmd(start), -1), typeId);
    map.forEach(item => {
      const actual = latestStorageTotal(parseYmd(item.date), typeId, item.date);
      if (actual.hasActualOnDate) storage = actual.total;
      storage += item.predColumns;
      if (new Date(`${item.date}T00:00:00`).getDay() !== 0) storage -= avgUsage;
      storage = Math.max(0, storage);
      item.forecastStorage = storage;
    });

    return { rows: Array.from(map.values()).map(row => ({
      date: row.date,
      pred: round2(row.pred),
      actual: round2(row.actual),
      predColumns: round2(row.predColumns),
      forecastStorage: round2(row.forecastStorage)
    })) };
  }

  function renderPredictionChart(pred) {
    const canvas = $("predictionChart");
    if (typeof Chart === "undefined") return;
    if (state.charts.prediction) state.charts.prediction.destroy();
    state.charts.prediction = new Chart(canvas, {
      type: "line",
      data: {
        labels: pred.rows.map(row => fmtShortDate(row.date)),
        datasets: [
          { type: "bar", label: "予測出庫数", data: pred.rows.map(row => row.pred), backgroundColor: "rgba(23,107,85,.28)", borderColor: "#176b55", yAxisID: "y" },
          { type: "bar", label: "実出庫数", data: pred.rows.map(row => row.actual), backgroundColor: "rgba(181,71,8,.28)", borderColor: "#b54708", yAxisID: "y" },
          { label: "予測保管数", data: pred.rows.map(row => row.forecastStorage), borderColor: "#dc2626", backgroundColor: "rgba(220,38,38,.12)", tension: .25, yAxisID: "y1" }
        ]
      },
      options: chartOptions("出庫数", "保管列")
    });
  }

  function maturationDays(entry) {
    const lot = state.data.lots.find(item => item.id === entry.harvest_lot_id);
    if (!lot || !lot.harvest_date) return 30;
    const elapsed = diffDays(parseYmd(lot.harvest_date), parseYmd(entry.entry_date));
    const bracket = activeRows(state.data.brackets).find(item =>
      elapsed >= Number(item.min_days || 0) &&
      (item.max_days === null || item.max_days === undefined || elapsed <= Number(item.max_days))
    );
    if (!bracket) return 30;
    const rule = state.data.rules.find(item => item.room_id === entry.room_id && item.age_bracket_id === bracket.id);
    return Math.max(0, Math.floor(Number(rule && rule.maturation_days || 30)));
  }

  function resetDrafts() {
    state.drafts = {
      rooms: state.data.rooms.map(clone),
      types: state.data.types.map(clone),
      storageTypes: state.data.storageTypes.map(clone),
      lots: state.data.lots.map(clone),
      brackets: state.data.brackets.map(clone)
    };
  }

  function renderMaster() {
    renderSimpleMaster("masterRooms", "rooms", "room_name", "室名");
    renderSimpleMaster("masterTypes", "types", "type_name", "種別");
    renderSimpleMaster("masterStorageTypes", "storageTypes", "type_name", "保管庫種別");
    renderLotMaster();
    renderMaturationMaster();
    fitResponsiveTables($("masterPanel"));
    createIcons();
  }

  function renderSimpleMaster(containerId, draftKey, nameKey, label) {
    const rows = state.drafts[draftKey] || [];
    $(containerId).innerHTML = `
      <div class="master-list">
        ${rows.map((row, index) => `
          <div class="master-row" data-draft="${draftKey}" data-index="${index}">
            <span class="muted">${index + 1}</span>
            <input data-field="${nameKey}" value="${esc(row[nameKey] || "")}" placeholder="${esc(label)}">
            <button type="button" class="secondary icon-btn" data-master-action="up" title="上へ"><i data-lucide="arrow-up"></i></button>
            <button type="button" class="secondary icon-btn" data-master-action="down" title="下へ"><i data-lucide="arrow-down"></i></button>
            <button type="button" class="danger icon-btn" data-master-action="remove" title="削除"><i data-lucide="trash-2"></i></button>
          </div>
        `).join("")}
        <button type="button" class="secondary" data-master-action="add" data-draft="${draftKey}"><i data-lucide="plus"></i><span>${esc(label)}を追加</span></button>
      </div>
    `;
  }

  function renderLotMaster() {
    const rows = state.drafts.lots || [];
    $("masterLots").innerHTML = `
      <div class="master-list">
        ${rows.map((row, index) => `
          <div class="master-row lot-row" data-draft="lots" data-index="${index}">
            <span class="muted">${index + 1}</span>
            <input data-field="lot_name" value="${esc(row.lot_name || "")}" placeholder="収穫ロット名">
            <input data-field="harvest_date" type="date" value="${esc(row.harvest_date || "")}">
            <button type="button" class="secondary icon-btn" data-master-action="up" title="上へ"><i data-lucide="arrow-up"></i></button>
            <button type="button" class="secondary icon-btn" data-master-action="down" title="下へ"><i data-lucide="arrow-down"></i></button>
            <button type="button" class="danger icon-btn" data-master-action="remove" title="削除"><i data-lucide="trash-2"></i></button>
          </div>
        `).join("")}
        <button type="button" class="secondary" data-master-action="add" data-draft="lots"><i data-lucide="plus"></i><span>収穫ロットを追加</span></button>
      </div>
    `;
  }

  function renderMaturationMaster() {
    const brackets = state.drafts.brackets || [];
    const bracketEditor = `
      <h2>収穫からの経過日数区分</h2>
      <div class="master-list">
        ${brackets.map((row, index) => `
          <div class="master-row bracket-row" data-draft="brackets" data-index="${index}">
            <span class="muted">${index + 1}</span>
            <input data-field="label" value="${esc(row.label || "")}" placeholder="例: 0-30日">
            <input data-field="min_days" type="number" min="0" step="1" value="${esc(row.min_days ?? "")}" placeholder="開始">
            <input data-field="max_days" type="number" min="0" step="1" value="${esc(row.max_days ?? "")}" placeholder="終了空欄可">
            <button type="button" class="secondary icon-btn" data-master-action="up" title="上へ"><i data-lucide="arrow-up"></i></button>
            <button type="button" class="secondary icon-btn" data-master-action="down" title="下へ"><i data-lucide="arrow-down"></i></button>
            <button type="button" class="danger icon-btn" data-master-action="remove" title="削除"><i data-lucide="trash-2"></i></button>
          </div>
        `).join("")}
        <button type="button" class="secondary" data-master-action="add" data-draft="brackets"><i data-lucide="plus"></i><span>区分を追加</span></button>
      </div>
    `;

    const activeRooms = activeRows(state.data.rooms);
    const activeBrackets = activeRows(state.data.brackets);
    const matrix = `
      <h2>室名 × 経過日数区分の熟成日数</h2>
      <div class="table-wrap">
        <table class="matrix-table">
          <thead><tr><th>室名</th>${activeBrackets.map(b => `<th>${esc(b.label)}</th>`).join("")}</tr></thead>
          <tbody>
            ${activeRooms.map(room => `
              <tr>
                <td class="text-left">${esc(room.room_name)}</td>
                ${activeBrackets.map(bracket => {
                  const rule = state.data.rules.find(item => item.room_id === room.id && item.age_bracket_id === bracket.id);
                  return `<td><input type="number" min="0" step="1" data-rule-room="${esc(room.id)}" data-rule-bracket="${esc(bracket.id)}" value="${esc(rule ? rule.maturation_days : "")}"></td>`;
                }).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    $("masterMaturation").innerHTML = `${bracketEditor}<div class="section-title compact"></div>${matrix}`;
  }

  function handleMasterClick(event) {
    const button = event.target.closest("[data-master-action]");
    if (!button) return;
    collectMasterInputs();
    const action = button.dataset.masterAction;
    const draftKey = button.dataset.draft || button.closest("[data-draft]").dataset.draft;
    const rowEl = button.closest("[data-index]");
    const index = rowEl ? Number(rowEl.dataset.index) : -1;
    const rows = state.drafts[draftKey];
    if (!rows) return;

    if (action === "add") rows.push(defaultDraftRow(draftKey));
    if (action === "remove" && index >= 0) rows.splice(index, 1);
    if (action === "up" && index > 0) [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]];
    if (action === "down" && index >= 0 && index < rows.length - 1) [rows[index + 1], rows[index]] = [rows[index], rows[index + 1]];
    renderMaster();
  }

  function collectMasterInputs() {
    $$(".master-row[data-draft]").forEach(rowEl => {
      const draftKey = rowEl.dataset.draft;
      const index = Number(rowEl.dataset.index);
      const row = state.drafts[draftKey] && state.drafts[draftKey][index];
      if (!row) return;
      rowEl.querySelectorAll("[data-field]").forEach(input => {
        const field = input.dataset.field;
        if (input.type === "number") row[field] = input.value === "" ? null : Number(input.value);
        else row[field] = input.value.trim();
      });
    });
  }

  function defaultDraftRow(draftKey) {
    if (draftKey === "lots") return { lot_name: "", harvest_date: todayStr(), active: true };
    if (draftKey === "brackets") return { label: "", min_days: 0, max_days: null, active: true };
    if (draftKey === "rooms") return { room_name: "", active: true };
    if (draftKey === "types" || draftKey === "storageTypes") return { type_name: "", active: true };
    return {};
  }

  async function saveMaster() {
    collectMasterInputs();
    await withBusy($("masterSaveBtn"), async () => {
      await saveSimpleDraft("rooms", TABLES.rooms, "room_name", isRoomUsed);
      await saveSimpleDraft("types", TABLES.types, "type_name", isTypeUsed);
      await saveSimpleDraft("storageTypes", TABLES.storageTypes, "type_name", isStorageTypeUsed);
      await saveLotsDraft();
      await saveBracketsDraft();
      await saveMaturationRules();
      await loadAll();
      renderAll();
      toast("マスタを保存しました");
    });
  }

  async function saveSimpleDraft(draftKey, table, nameKey, usedFn) {
    const originalIds = new Set(state.data[draftKey].map(row => row.id));
    const rows = uniqueDraftRows(state.drafts[draftKey], nameKey).map((row, index) => ({
      ...row,
      [nameKey]: String(row[nameKey] || "").trim(),
      display_order: index + 1,
      active: true
    }));
    const keptIds = new Set(rows.filter(row => row.id).map(row => row.id));
    for (const id of originalIds) {
      if (!keptIds.has(id)) {
        if (usedFn(id)) throw new Error(`使用中の項目は削除できません: ${id}`);
        await assertOk(state.client.from(table).delete().eq("id", id));
      }
    }
    for (const row of rows) {
      if (!row[nameKey]) continue;
      await assertOk(state.client.from(table).upsert(row));
    }
  }

  async function saveLotsDraft() {
    const originalIds = new Set(state.data.lots.map(row => row.id));
    const rows = uniqueDraftRows(state.drafts.lots, "lot_name").filter(row => row.lot_name && row.harvest_date).map((row, index) => ({
      ...row,
      display_order: index + 1,
      active: true
    }));
    const keptIds = new Set(rows.filter(row => row.id).map(row => row.id));
    for (const id of originalIds) {
      if (!keptIds.has(id)) {
        if (state.data.entries.some(row => row.harvest_lot_id === id)) throw new Error("使用中の収穫ロットは削除できません。");
        await assertOk(state.client.from(TABLES.lots).delete().eq("id", id));
      }
    }
    for (const row of rows) await assertOk(state.client.from(TABLES.lots).upsert(row));
  }

  async function saveBracketsDraft() {
    const originalIds = new Set(state.data.brackets.map(row => row.id));
    const rows = uniqueDraftRows(state.drafts.brackets, "label").filter(row => row.label).map((row, index) => ({
      ...row,
      min_days: Math.max(0, Number(row.min_days || 0)),
      max_days: row.max_days === null || row.max_days === "" ? null : Math.max(0, Number(row.max_days)),
      display_order: index + 1,
      active: true
    }));
    const keptIds = new Set(rows.filter(row => row.id).map(row => row.id));
    for (const id of originalIds) {
      if (!keptIds.has(id)) {
        await assertOk(state.client.from(TABLES.rules).delete().eq("age_bracket_id", id));
        await assertOk(state.client.from(TABLES.brackets).delete().eq("id", id));
      }
    }
    for (const row of rows) await assertOk(state.client.from(TABLES.brackets).upsert(row));
  }

  async function saveMaturationRules() {
    const inputs = $$("[data-rule-room][data-rule-bracket]");
    for (const input of inputs) {
      const roomId = input.dataset.ruleRoom;
      const bracketId = input.dataset.ruleBracket;
      if (input.value === "") {
        await assertOk(state.client.from(TABLES.rules).delete().eq("room_id", roomId).eq("age_bracket_id", bracketId));
      } else {
        await assertOk(state.client.from(TABLES.rules).upsert({
          room_id: roomId,
          age_bracket_id: bracketId,
          maturation_days: Math.max(0, Math.floor(Number(input.value)))
        }, { onConflict: "room_id,age_bracket_id" }));
      }
    }
  }

  function uniqueDraftRows(rows, nameKey) {
    const seen = new Set();
    const result = [];
    rows.forEach(row => {
      const name = String(row[nameKey] || "").trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      result.push({ ...row, [nameKey]: name });
    });
    return result;
  }

  function isRoomUsed(id) {
    return state.data.entries.some(row => row.room_id === id);
  }

  function isTypeUsed(id) {
    return state.data.entries.some(row => row.type_id === id);
  }

  function isStorageTypeUsed(id) {
    return state.data.storageEntries.some(row => row.storage_type_id === id);
  }

  function filterEntries(start, end, typeId, roomId) {
    return state.data.entries.filter(row =>
      row.entry_date >= start &&
      row.entry_date <= end &&
      matchesFilters(row, typeId, roomId)
    );
  }

  function matchesFilters(row, typeId, roomId) {
    return (typeId === "All" || !typeId || row.type_id === typeId) &&
      (roomId === "All" || !roomId || row.room_id === roomId);
  }

  function inventoryAsOf(ymd, typeId, roomId) {
    const map = new Map();
    state.data.entries
      .filter(row => row.entry_date <= ymd && matchesFilters(row, typeId, roomId))
      .sort((a, b) => compareDisplay(a.entry_date, b.entry_date) || compareDisplay(a.recorded_at, b.recorded_at))
      .forEach(row => {
        map.set(`${row.room_id}|${row.type_id}|${row.harvest_lot_id}`, clampNumber(row.inventory_qty));
      });
    return Array.from(map.values()).reduce((sumValue, value) => sumValue + value, 0);
  }

  function latestStorageTotal(date, typeId, exactDate) {
    const ymd = typeof date === "string" ? date : dateToStr(date);
    const byType = new Map();
    state.data.storageEntries
      .filter(row => row.storage_date <= ymd)
      .filter(row => {
        if (typeId === "All" || !typeId) return true;
        const mainType = state.data.types.find(type => type.id === typeId);
        const storageType = state.data.storageTypes.find(type => type.id === row.storage_type_id);
        return mainType && storageType && mainType.type_name === storageType.type_name;
      })
      .sort((a, b) => compareDisplay(a.storage_date, b.storage_date) || compareDisplay(a.recorded_at, b.recorded_at))
      .forEach(row => byType.set(row.storage_type_id, row));
    const rows = Array.from(byType.values());
    return {
      total: rows.reduce((total, row) => total + storageColumns(row), 0),
      hasActualOnDate: exactDate ? rows.some(row => row.storage_date === exactDate) : false
    };
  }

  function storageColumns(row) {
    return clampNumber(row.columns16) + clampNumber(row.pieces) / 16;
  }

  function chartOptions(leftTitle, rightTitle) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom" } },
      scales: {
        y: { beginAtZero: true, position: "left", title: { display: true, text: leftTitle } },
        y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: rightTitle } }
      }
    };
  }

  function setDefaultDates() {
    const today = todayStr();
    $("mainDate").value = today;
    $("mainHistoryDate").value = today;
    $("storageDate").value = today;
    $("storageHistoryDate").value = today;
    $("summaryStartDate").value = today;
    $("summaryStartDate").max = today;
    $("graphStartDate").value = dateToStr(addDays(parseYmd(today), -30));
    $("graphEndDate").value = dateToStr(addDays(parseYmd(today), 1));
    $("predictionStartDate").value = dateToStr(addDays(parseYmd(today), -7));
    $("predictionEndDate").value = dateToStr(addDays(parseYmd(today), 30));
  }

  function moveDate(id, delta) {
    $(id).value = dateToStr(addDays(parseYmd($(id).value), delta));
    $(id).dispatchEvent(new Event("change"));
  }

  function requireFields(payload, fields) {
    const missing = fields.filter(field => !payload[field]);
    if (missing.length) throw new Error("必須項目が未入力です。");
  }

  async function assertOk(resultPromise) {
    const { error } = await resultPromise;
    if (error) throw error;
  }

  async function withBusy(button, fn) {
    const oldDisabled = button.disabled;
    button.disabled = true;
    try {
      await fn();
    } finally {
      button.disabled = oldDisabled;
    }
  }

  function showFatal(error) {
    $("loginMessage").textContent = error.message || String(error);
    showError(error);
  }

  function showError(error) {
    console.error(error);
    toast(error.message || String(error), true);
  }

  function toast(message, isError) {
    const el = $("toast");
    el.textContent = message;
    el.classList.toggle("error", !!isError);
    el.classList.remove("hidden");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.add("hidden"), isError ? 5200 : 2400);
  }

  function createIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
  }

  function clone(row) {
    return JSON.parse(JSON.stringify(row));
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[ch]));
  }

  function num(value, digits = 2) {
    if (value === null || value === undefined || value === "") return "";
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return n.toLocaleString("ja-JP", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  }

  function nullableNumber(value) {
    return value === "" || value === null || value === undefined ? null : clampNumber(value);
  }

  function clampNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, n);
  }

  function round2(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function sum(rows, key) {
    return rows.reduce((total, row) => total + clampNumber(row[key]), 0);
  }

  function lastValue(rows, key) {
    const row = rows.filter(item => item[key] !== null && item[key] !== undefined && item[key] !== "").at(-1);
    return row ? row[key] : "";
  }

  function lastInventory(rows) {
    const row = rows.slice().sort((a, b) => compareDisplay(a.entry_date, b.entry_date)).at(-1);
    return row ? row.inventory_qty : 0;
  }

  function unique(list) {
    return Array.from(new Set(list));
  }

  function compareDisplay(a, b) {
    return String(a || "").localeCompare(String(b || ""), "ja");
  }

  function todayStr() {
    return dateToStr(new Date());
  }

  function parseYmd(ymd) {
    const text = ymd || todayStr();
    const [y, m, d] = text.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function dateToStr(date) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function diffDays(start, end) {
    const s = parseYmd(dateToStr(start));
    const e = parseYmd(dateToStr(end));
    return Math.floor((e.getTime() - s.getTime()) / 86400000);
  }

  function dateRange(start, end) {
    const rows = [];
    for (let d = parseYmd(dateToStr(start)); d <= parseYmd(dateToStr(end)); d = addDays(d, 1)) {
      rows.push(new Date(d));
    }
    return rows;
  }

  function startOfWeekMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    return addDays(d, diff);
  }

  function fmtDate(value) {
    if (!value) return "";
    const d = parseYmd(String(value).slice(0, 10));
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    return `${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()]})`;
  }

  function weekdayLabel(value) {
    if (!value) return "";
    const d = parseYmd(String(value).slice(0, 10));
    const weekdays = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
    return weekdays[d.getDay()];
  }

  function fmtShortDate(value) {
    if (!value) return "";
    const d = parseYmd(String(value).slice(0, 10));
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function fmtTime(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }

  function reiwaMonthLabel(date) {
    const d = new Date(date);
    const reiwa = d.getFullYear() - 2018;
    return `令和${reiwa}年${d.getMonth() + 1}月`;
  }

  function emptyRow(colspan) {
    return `<tr><td colspan="${colspan}" class="text-left muted">データがありません。</td></tr>`;
  }

  function tableHtml(headers, rows, leftIndexes = []) {
    const body = rows.length ? rows.map(row => `
      <tr>${row.map((cell, index) => `<td${leftIndexes.includes(index) ? ' class="text-left"' : ""}>${esc(cell)}</td>`).join("")}</tr>
    `).join("") : emptyRow(headers.length);
    return `
      <div class="table-wrap">
        <table>
          <thead><tr>${headers.map(header => `<th${leftIndexes.includes(headers.indexOf(header)) ? ' class="text-left"' : ""}>${esc(header)}</th>`).join("")}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;
  }

  function fitResponsiveTables(root = document) {
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    scope.querySelectorAll("table").forEach(table => {
      if (!table.closest(".table-wrap")) return;
      table.classList.add("responsive-fit-table");
      table.querySelectorAll("th, td").forEach(cell => {
        cell.classList.remove("fit-number-cell", "fit-text-cell", "fit-action-cell");
        if (cell.querySelector("button, input, select, textarea")) {
          cell.classList.add("fit-action-cell");
          return;
        }
        if (cell.classList.contains("num-cell") || isNumericTableText(cell.textContent)) {
          cell.classList.add("fit-number-cell");
        } else {
          cell.classList.add("fit-text-cell");
        }
      });
    });
  }

  function isNumericTableText(value) {
    const text = String(value || "").trim();
    return text === "" || /^[0-9０-９.,+\-/%％:\s]+$/.test(text);
  }

  function workerName(id) {
    const row = state.data.workers.find(item => item.worker_id === id);
    return row ? row.worker_name : id || "";
  }

  function roomName(id) {
    const row = state.data.rooms.find(item => item.id === id);
    return row ? row.room_name : id || "";
  }

  function typeName(id) {
    const row = state.data.types.find(item => item.id === id);
    return row ? row.type_name : id || "";
  }

  function storageTypeName(id) {
    const row = state.data.storageTypes.find(item => item.id === id);
    return row ? row.type_name : id || "";
  }

  function lotName(id) {
    const row = state.data.lots.find(item => item.id === id);
    return row ? row.lot_name : id || "";
  }
})();
