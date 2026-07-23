const COLORS = ["#C85C4A", "#D58C32", "#D2AE3F", "#5A8B62", "#3F8177", "#4B78A8", "#7466A6", "#A45C82"];
const STANDARD_LOCATION_NAMES = ["Punschhütte", "Bar"];
const DEFAULT_DATA = {
  categories: [
    { id: "cat-coffee", name: "Kaffee", color: "#C85C4A" },
    { id: "cat-cold", name: "Kaltgetränke", color: "#4B78A8" },
    { id: "cat-food", name: "Speisen", color: "#D58C32" },
    { id: "cat-sweets", name: "Süßes", color: "#A45C82" }
  ],
  products: [
    { id: "p1", name: "Espresso", price: 2.4, categoryId: "cat-coffee" },
    { id: "p2", name: "Cappuccino", price: 3.8, categoryId: "cat-coffee" },
    { id: "p3", name: "Caffè Latte", price: 4.2, categoryId: "cat-coffee" },
    { id: "p4", name: "Mineralwasser", price: 2.9, categoryId: "cat-cold" },
    { id: "p5", name: "Hauslimonade", price: 4.5, categoryId: "cat-cold" },
    { id: "p6", name: "Orangensaft", price: 3.9, categoryId: "cat-cold" },
    { id: "p7", name: "Croissant", price: 2.8, categoryId: "cat-food" },
    { id: "p8", name: "Focaccia", price: 6.9, categoryId: "cat-food" },
    { id: "p9", name: "Bananenbrot", price: 3.6, categoryId: "cat-sweets" }
  ]
};

let data = loadData();
let sales = loadSales();
let cashBalances = loadCashBalances();
let appSettings = loadAppSettings();
const legacySnapshot = {
  data: structuredClone(data),
  sales: structuredClone(sales),
  cashBalances: structuredClone(cashBalances),
  settings: structuredClone(appSettings)
};
let locations = [];
let currentLocationId = localStorage.getItem("kassenraum-current-location") || "local";
let currentRole = "admin";
let currentUserId = "";
let currentUserEmail = "";
let localMode = false;
let employees = [];
let timeEntries = [];
let employeeBonuses = [];
let submittedReports = [];
let cart = [];
let selectedCategory = "all";
let editor = { type: null, id: null, color: COLORS[0], copySourceId: null };
let reportFilter = "today";
let receiptLocationFilter = "all";
let pendingPaymentTotal = 0;
let paymentReturnCategory = null;
let combinedReportScope = { key: "", sales: [], cashBalances: {}, locationName: "Alle Standorte" };
let reportLocationScope = [];
let toastTimer;
let cloudSaveTimer;
let realtimeReloadTimer;
let timeReloadTimer;
let adminReportRefreshTimer;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const euro = (value) => new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format(value);
const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem("kassenraum-data"));
    if (saved?.categories && saved?.products) return saved;
  } catch (_) {}
  return structuredClone(DEFAULT_DATA);
}

function loadSales() {
  try {
    const saved = JSON.parse(localStorage.getItem("kassenraum-sales"));
    if (Array.isArray(saved)) return saved;
  } catch (_) {}
  return [];
}

function loadCashBalances() {
  try {
    const saved = JSON.parse(localStorage.getItem("kassenraum-cash-balances"));
    if (saved && typeof saved === "object" && !Array.isArray(saved)) return saved;
  } catch (_) {}
  return {};
}

function loadAppSettings() {
  try {
    return { theme: "dark", billingEmail: "", billingEmail2: "", billingMode: "separate", startCategoryId: "first", ...(JSON.parse(localStorage.getItem("kassenraum-settings")) || {}) };
  } catch (_) {
    return { theme: "dark", billingEmail: "", billingEmail2: "", billingMode: "separate", startCategoryId: "first" };
  }
}

function scopedKey(base) {
  return currentLocationId && currentLocationId !== "local" ? `${base}:${currentLocationId}` : base;
}

function scopedKeyFor(base, locationId) {
  return locationId && locationId !== "local" ? `${base}:${locationId}` : base;
}

function persist() {
  localStorage.setItem(scopedKey("kassenraum-data"), JSON.stringify(data));
  localStorage.setItem(scopedKey("kassenraum-settings"), JSON.stringify(appSettings));
  clearTimeout(cloudSaveTimer);
  if (!localMode && currentLocationId !== "local") {
    cloudSaveTimer = setTimeout(() => CloudStore.saveState(currentLocationId, data, appSettings), 250);
  }
}

function persistSales() {
  localStorage.setItem(scopedKey("kassenraum-sales"), JSON.stringify(sales));
}

function persistCashBalances() {
  localStorage.setItem(scopedKey("kassenraum-cash-balances"), JSON.stringify(cashBalances));
}

function persistLocalTimeTracking() {
  localStorage.setItem("kassenraum-employees-global", JSON.stringify(employees));
  localStorage.setItem("kassenraum-time-entries-global", JSON.stringify(timeEntries));
  localStorage.setItem("kassenraum-employee-bonuses-global", JSON.stringify(employeeBonuses));
}

function categoryFor(id) {
  return data.categories.find((category) => category.id === id);
}

function isAdminUser() {
  return localMode
    || currentUserEmail.trim().toLocaleLowerCase("de") === "admin@standl.at"
    || currentRole === "admin"
    || locations.some((location) => String(location.role || "").toLowerCase() === "admin");
}

function canonicalLocationName(name) {
  const normalized = String(name || "")
    .trim()
    .toLocaleLowerCase("de")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!normalized || normalized === "undefined" || normalized === "null" || normalized === "hauptstandort") return null;
  if (normalized.includes("punsch")) return "Punschhütte";
  if (normalized === "bar" || normalized.includes("bar ")) return "Bar";
  return null;
}

function normalizeLocationList(list) {
  const prepared = [];
  const seen = new Set();
  (list || []).forEach((location) => {
    if (!location?.id) return;
    const rawName = String(location.name ?? "").trim();
    const canonicalName = canonicalLocationName(rawName);
    if (!canonicalName) return;
    const dedupeKey = canonicalName.toLocaleLowerCase("de");
    if (seen.has(dedupeKey)) return;
    prepared.push({
      ...location,
      name: canonicalName,
      role: location.role || "staff"
    });
    seen.add(dedupeKey);
  });
  return STANDARD_LOCATION_NAMES
    .map((name) => prepared.find((location) => location.name === name))
    .filter(Boolean);
}

function canonicalLocationName(name) {
  const rawName = String(name || "").trim();
  const normalized = rawName
    .toLocaleLowerCase("de")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!normalized || normalized === "undefined" || normalized === "null") return null;
  if (normalized.includes("punsch")) return "Punschhütte";
  if (normalized === "bar" || normalized.includes("bar ")) return "Bar";
  return rawName;
}

function normalizeLocationList(list) {
  const prepared = [];
  const seen = new Set();
  (list || []).forEach((location) => {
    if (!location?.id || seen.has(String(location.id))) return;
    const rawName = String(location.name ?? "").trim();
    const invalidName = !rawName || rawName.toLowerCase() === "undefined" || rawName.toLowerCase() === "null";
    if (invalidName) return;
    prepared.push({
      ...location,
      name: rawName,
      role: location.role || "staff"
    });
    seen.add(String(location.id));
  });
  return prepared;
}

function renderAll() {
  applyTheme();
  renderRoleAccess();
  renderLocationSelector();
  renderActiveEmployees();
  renderCategories();
  renderProducts();
  renderCart();
  renderSettings();
}

function renderRoleAccess() {
  const isAdmin = isAdminUser();
  $("#settingsButton").classList.toggle("hidden", !isAdmin);
  $$(".open-settings").forEach((button) => button.classList.toggle("hidden", !isAdmin));
  $$(".admin-only").forEach((element) => element.classList.toggle("hidden", !isAdmin));
  $$(".staff-only").forEach((element) => element.classList.toggle("hidden", isAdmin));
  if (!isAdmin && !$("#settingsView").classList.contains("hidden")) {
    $("#settingsView").classList.add("hidden");
    $("#posView").classList.remove("hidden");
  }
}

function applyTheme() {
  document.body.dataset.theme = appSettings.theme || "dark";
  document.querySelector('meta[name="theme-color"]').content = appSettings.theme === "light" ? "#f5f3ec" : "#0b100f";
}

function renderLocationSelector() {
  const selector = $("#locationSelector");
  locations = normalizeLocationList(locations);
  if (!locations.some((location) => location.id === currentLocationId) && locations.length) {
    currentLocationId = locations[0].id;
    localStorage.setItem("kassenraum-current-location", currentLocationId);
  }
  selector.innerHTML = locations.map((location) =>
    `<option value="${location.id}">${escapeHtml(location.name)}</option>`
  ).join("");
  selector.value = currentLocationId;
  selector.disabled = locations.length < 2;
}

function showApplication() {
  $("#loginScreen").classList.add("hidden");
  $("#appShell").classList.remove("hidden");
  renderAll();
}

function loadLocalLocation(locationId) {
  currentLocationId = locationId;
  const read = (base, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(scopedKey(base)));
      return value ?? fallback;
    } catch (_) {
      return fallback;
    }
  };
  data = read("kassenraum-data", structuredClone(DEFAULT_DATA));
  sales = read("kassenraum-sales", []);
  cashBalances = read("kassenraum-cash-balances", {});
  appSettings = { theme: "dark", billingEmail: "", billingEmail2: "", billingMode: "separate", startCategoryId: "first", ...read("kassenraum-settings", {}) };
  const readGlobal = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch (_) {
      return fallback;
    }
  };
  employees = readGlobal("kassenraum-employees-global", read("kassenraum-employees", []));
  timeEntries = readGlobal("kassenraum-time-entries-global", read("kassenraum-time-entries", []))
    .map((entry) => ({
      ...entry,
      locationId: entry.locationId || locationId,
      hourlyRate: Number(entry.hourlyRate ?? employees.find((employee) => employee.id === entry.employeeId)?.hourlyRate ?? 0)
    }));
  employeeBonuses = readGlobal("kassenraum-employee-bonuses-global", read("kassenraum-employee-bonuses", []));
}

async function refreshLocationMemberships() {
  if (localMode || !currentUserId) return;
  try {
    const updatedLocations = await CloudStore.locations();
    if (!updatedLocations.length) return;
    locations = normalizeLocationList(updatedLocations);
    const currentLocation = locations.find((location) => location.id === currentLocationId);
    if (!currentLocation) {
      await switchLocation(locations[0].id);
      showToast("Standortzugriff wurde aktualisiert");
      return;
    }
    currentRole = currentLocation.role || "staff";
    renderAll();
    showToast("Standorte wurden aktualisiert");
  } catch (_) {}
}

async function switchLocation(locationId, background = false) {
  const location = locations.find((entry) => entry.id === locationId);
  if (!location) return;
  currentLocationId = locationId;
  currentRole = location.role || (localMode ? "admin" : "staff");
  localStorage.setItem("kassenraum-current-location", locationId);
  if (localMode) {
    loadLocalLocation(locationId);
    renderAll();
    if (!$("#timeClockView").classList.contains("hidden")) renderTimeTracking();
    return;
  }
  try {
    const remote = await CloudStore.loadLocation(locationId);
    const remoteData = remote.state?.data;
    const isNewLocation = !remoteData?.categories?.length;
    const shouldMigrate = isNewLocation && !localStorage.getItem("kassenraum-cloud-migrated");
    data = isNewLocation ? structuredClone(shouldMigrate ? legacySnapshot.data : DEFAULT_DATA) : remoteData;
    appSettings = { theme: "dark", billingEmail: "", billingEmail2: "", billingMode: "separate", startCategoryId: "first", ...(shouldMigrate ? legacySnapshot.settings : remote.state?.settings || {}) };
    sales = shouldMigrate && !remote.sales.length ? structuredClone(legacySnapshot.sales) : remote.sales;
    cashBalances = shouldMigrate && !Object.keys(remote.cashBalances).length ? structuredClone(legacySnapshot.cashBalances) : remote.cashBalances;
    persistSales();
    persistCashBalances();
    localStorage.setItem(scopedKey("kassenraum-data"), JSON.stringify(data));
    localStorage.setItem(scopedKey("kassenraum-settings"), JSON.stringify(appSettings));
    if (isNewLocation && isAdminUser()) {
      persist();
      sales.forEach((sale) => CloudStore.insertSale(locationId, sale));
      Object.entries(cashBalances).forEach(([dateKey, balance]) => CloudStore.saveCash(locationId, dateKey, balance));
      if (shouldMigrate) localStorage.setItem("kassenraum-cloud-migrated", "1");
    }
    CloudStore.subscribe(
      locationId,
      () => {
        clearTimeout(realtimeReloadTimer);
        realtimeReloadTimer = setTimeout(async () => {
          await switchLocation(locationId, true);
          if (!$("#reportsView").classList.contains("hidden")) {
            await refreshReportScope(true, isAdminUser());
            renderReport();
          }
        }, 350);
      },
      currentUserId,
      () => {
        clearTimeout(realtimeReloadTimer);
        realtimeReloadTimer = setTimeout(refreshLocationMemberships, 350);
      },
      () => {
        if (!$("#timeClockView").classList.contains("hidden")) {
          clearTimeout(timeReloadTimer);
          timeReloadTimer = setTimeout(reloadTimeTracking, 250);
        }
      },
      null,
      isAdminUser()
        ? () => {}
        : () => {
          clearTimeout(realtimeReloadTimer);
          realtimeReloadTimer = setTimeout(async () => {
            await switchLocation(locationId, true);
            if (!$("#reportsView").classList.contains("hidden")) {
              await refreshReportScope(true, false);
              renderReport();
            }
          }, 350);
        }
    );
    if (!background) showToast(`Standort: ${location.name}`);
  } catch (error) {
    loadLocalLocation(locationId);
    showToast("Offline – lokaler Datenstand wird verwendet");
  }
  selectInitialCategory();
  renderAll();
  if (!$("#timeClockView").classList.contains("hidden")) await reloadTimeTracking();
}

async function startCloudSession() {
  const session = await CloudStore.session();
  if (!session) return false;
  currentUserId = session.user.id;
  currentUserEmail = session.user.email || "";
  if (currentUserEmail.toLocaleLowerCase("de") === "admin@standl.at") {
    try {
      await CloudStore.ensureAdminAccess();
    } catch (_) {}
  }
  locations = normalizeLocationList(await CloudStore.locations());
  if (!locations.length) {
    await CloudStore.createLocation("Punschhütte");
    await CloudStore.createLocation("Bar");
    locations = normalizeLocationList(await CloudStore.locations());
  }
  const preferred = locations.some((location) => location.id === currentLocationId)
    ? currentLocationId
    : locations[0].id;
  currentRole = locations.find((location) => location.id === preferred)?.role || "staff";
  if (isAdminUser()) {
    try {
      await CloudStore.syncLocationMemberships();
      locations = normalizeLocationList(await CloudStore.locations());
      currentRole = locations.find((location) => location.id === preferred)?.role || currentRole;
    } catch (_) {}
  }
  $("#currentUserLabel").textContent = session.user.email || "Supabase-Konto";
  showApplication();
  await switchLocation(preferred);
  await reloadTimeTracking();
  CloudStore.flushQueue();
  return true;
}

function startLocalMode() {
  localMode = true;
  currentRole = "admin";
  currentUserId = "";
  currentUserEmail = "";
  try {
    locations = JSON.parse(localStorage.getItem("kassenraum-local-locations")) || [];
  } catch (_) {
    locations = [];
  }
  locations = normalizeLocationList(locations);
  if (!locations.length) locations = [
    { id: "local-punsch", name: "Punschhütte", role: "admin" },
    { id: "local-bar", name: "Bar", role: "admin" }
  ];
  localStorage.setItem("kassenraum-local-locations", JSON.stringify(locations));
  currentLocationId = locations.some((location) => location.id === currentLocationId) ? currentLocationId : locations[0].id;
  loadLocalLocation(currentLocationId);
  selectInitialCategory();
  showApplication();
}

function visibleCategories() {
  return data.categories.filter((category) => !category.hidden);
}

function firstVisibleCategoryId() {
  return visibleCategories()[0]?.id || "all";
}

function selectInitialCategory() {
  const configured = appSettings.startCategoryId || "first";
  selectedCategory = configured !== "first" && visibleCategories().some((category) => category.id === configured)
    ? configured
    : firstVisibleCategoryId();
}

function ensureSelectableCategory() {
  if (selectedCategory === "all") {
    if (visibleCategories().length) selectedCategory = firstVisibleCategoryId();
    return;
  }
  if (!visibleCategories().some((category) => category.id === selectedCategory)) {
    selectedCategory = firstVisibleCategoryId();
  }
}

function renderCategories() {
  const nav = $("#categoryNav");
  const categories = visibleCategories();
  ensureSelectableCategory();
  nav.innerHTML = categories.map((category) =>
    categoryButton(category.id, category.name, category.color, data.products.filter((product) => product.categoryId === category.id).length)
  ).join("");
  $("#categoryCount").textContent = categories.length;

  nav.querySelectorAll(".category-button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedCategory = button.dataset.id;
      renderCategories();
      renderProducts();
    });
  });
}

function categoryButton(id, name, color, count) {
  return `<button class="category-button ${selectedCategory === id ? "active" : ""}" data-id="${id}">
    <span class="category-dot" style="background:${color}"></span>
    <span>${escapeHtml(name)}</span><span class="count">${count}</span>
  </button>`;
}

function renderProducts() {
  const search = $("#productSearch").value.trim().toLowerCase();
  const visibleIds = new Set(visibleCategories().map((category) => category.id));
  const filtered = data.products.filter((product) => {
    const matchesCategory = selectedCategory === "all" || product.categoryId === selectedCategory;
    return visibleIds.has(product.categoryId) && matchesCategory && product.name.toLowerCase().includes(search);
  });
  const selected = categoryFor(selectedCategory);
  $("#productTitle").textContent = selected ? selected.name : "Alle Artikel";
  $("#productGrid").innerHTML = filtered.map((product) => {
    const category = categoryFor(product.categoryId) || { name: "Ohne Kategorie", color: "#777" };
    return `<button class="product-card" data-id="${product.id}" style="--card-color:${category.color}">
      <span class="product-category"><i></i>${escapeHtml(category.name)}</span>
      <strong>${escapeHtml(product.name)}</strong>
      <span class="product-price">${euro(product.price)}</span>
      <span class="product-add">+</span>
    </button>`;
  }).join("");
  $("#emptyProducts").classList.toggle("hidden", filtered.length > 0);
  $("#productGrid").classList.toggle("hidden", filtered.length === 0);
  $("#productGrid").querySelectorAll(".product-card").forEach((button) =>
    button.addEventListener("click", () => addToCart(button.dataset.id))
  );
}

function addToCart(productId) {
  const item = cart.find((entry) => entry.productId === productId);
  if (item) item.quantity += 1;
  else cart.push({ productId, quantity: 1 });
  renderCart();
  showToast("Zum Bon hinzugefügt");
}

function updateQuantity(productId, delta) {
  const item = cart.find((entry) => entry.productId === productId);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) cart = cart.filter((entry) => entry.productId !== productId);
  renderCart();
}

function cartTotal() {
  return cart.reduce((sum, entry) => {
    const product = data.products.find((item) => item.id === entry.productId);
    return sum + (product ? product.price * entry.quantity : 0);
  }, 0);
}

function renderCart() {
  cart = cart.filter((entry) => data.products.some((product) => product.id === entry.productId));
  const hasItems = cart.length > 0;
  $(".cart-panel").classList.toggle("has-items", hasItems);
  $("#posView").classList.toggle("cart-expanded", hasItems);
  $("#cartItems").classList.toggle("hidden", !hasItems);
  $("#emptyCart").classList.toggle("hidden", hasItems);
  $("#clearCartButton").disabled = !hasItems;
  $("#checkoutButton").disabled = !hasItems;
  $("#cartItems").innerHTML = cart.map((entry) => {
    const product = data.products.find((item) => item.id === entry.productId);
    return `<div class="cart-item">
      <div class="cart-item-info"><strong>${escapeHtml(product.name)}</strong><small>${euro(product.price)} / Stück</small></div>
      <span class="cart-item-price">${euro(product.price * entry.quantity)}</span>
      <div class="quantity-control">
        <button data-action="minus" data-id="${product.id}" aria-label="Ein Stück entfernen">−</button>
        <span>${entry.quantity}</span>
        <button data-action="plus" data-id="${product.id}" aria-label="Ein Stück hinzufügen">+</button>
      </div>
    </div>`;
  }).join("");
  $("#cartItems").querySelectorAll(".quantity-control button").forEach((button) =>
    button.addEventListener("click", () => updateQuantity(button.dataset.id, button.dataset.action === "plus" ? 1 : -1))
  );
  $("#subtotal").textContent = euro(cartTotal());
  $("#total").textContent = euro(cartTotal());
}

function openSettings(tab = "categories") {
  if (!isAdminUser()) {
    showToast("Nur Administratoren können die Einstellungen öffnen.");
    return;
  }
  stopAdminReportAutoRefresh();
  $("#posView").classList.add("hidden");
  $("#reportsView").classList.add("hidden");
  $("#timeClockView").classList.add("hidden");
  $("#settingsView").classList.remove("hidden");
  setSettingsTab(tab);
  renderSettings();
  window.scrollTo(0, 0);
}

function closeSettings() {
  $("#settingsView").classList.add("hidden");
  $("#reportsView").classList.add("hidden");
  $("#timeClockView").classList.add("hidden");
  $("#posView").classList.remove("hidden");
  stopAdminReportAutoRefresh();
  renderAll();
}

function stopAdminReportAutoRefresh() {
  clearInterval(adminReportRefreshTimer);
  adminReportRefreshTimer = null;
}

function startAdminReportAutoRefresh() {
  stopAdminReportAutoRefresh();
  if (!isAdminUser() || localMode) return;
  adminReportRefreshTimer = setInterval(async () => {
    if ($("#reportsView").classList.contains("hidden")) {
      stopAdminReportAutoRefresh();
      return;
    }
    try {
      await refreshAdminReceiptLocations();
      await refreshReportScope(true, true);
      renderReport();
    } catch (_) {}
  }, 120000);
}

async function refreshAdminReceiptLocations() {
  if (!isAdminUser() || localMode || !CloudStore.adminLocations) return;
  const remoteLocations = (await CloudStore.adminLocations())
    .map((location) => {
      const name = canonicalLocationName(location.name);
      return name ? { ...location, name, role: "admin" } : null;
    })
    .filter(Boolean);
  if (!remoteLocations.length) return;
  reportLocationScope = remoteLocations;
  const visibleLocations = normalizeLocationList(remoteLocations);
  if (!visibleLocations.length) return;
  const currentIds = locations.map((location) => String(location.id)).join("|");
  const remoteIds = visibleLocations.map((location) => String(location.id)).join("|");
  if (currentIds !== remoteIds) {
    locations = visibleLocations;
    if (!locations.some((location) => location.id === currentLocationId)) {
      currentLocationId = locations[0].id;
      localStorage.setItem("kassenraum-current-location", currentLocationId);
    }
    renderLocationSelector();
  }
}

async function syncReceiptsForAdmin() {
  if (!isAdminUser()) {
    showToast("Nur Administratoren kÃ¶nnen Bons synchronisieren.");
    return;
  }
  const button = $("#syncReceiptsButton");
  const originalText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "Synchronisiere â€¦";
  }
  try {
    await refreshAdminReceiptLocations();
    await refreshReportScope(true, true);
    await refreshSubmittedReports();
    renderReport();
    startAdminReportAutoRefresh();
    const count = filteredReceiptSales().length;
    showToast(`${count} ${count === 1 ? "Bon" : "Bons"} synchronisiert`);
  } catch (error) {
    showToast(error.message || "Bons konnten nicht synchronisiert werden");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function openReports(options = {}) {
  $("#posView").classList.add("hidden");
  $("#settingsView").classList.add("hidden");
  $("#timeClockView").classList.add("hidden");
  $("#reportsView").classList.remove("hidden");
  reportFilter = "today";
  receiptLocationFilter = "all";
  $("#reportDateInput").value = localDateKey(new Date());
  await refreshAdminReceiptLocations();
  await refreshReportScope(true, isAdminUser());
  if (isAdminUser()) await refreshSubmittedReports();
  renderReport();
  startAdminReportAutoRefresh();
  if (options.showReceiptHistory) {
    const history = $(".receipt-history-card");
    history.open = true;
    setTimeout(() => history.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }
  window.scrollTo(0, 0);
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function businessDateKey(value = new Date()) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (date.getHours() < 4) date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

function salesForBusinessDate(entries, dateKey) {
  return (entries || []).filter((sale) => businessDateKey(sale.timestamp) === dateKey);
}

function formatDateKey(key) {
  return new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" })
    .format(new Date(`${key}T12:00:00`));
}

function useCombinedReports() {
  return appSettings.billingMode === "combined" && locations.length > 1;
}

function reportSourceSales() {
  return useCombinedReports() ? combinedReportScope.sales : sales;
}

function reportSourceCashBalances() {
  return useCombinedReports() ? combinedReportScope.cashBalances : cashBalances;
}

function readStoredJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch (_) {
    return fallback;
  }
}

async function refreshReportScope(force = false, includeAllLocations = false) {
  const shouldLoadAllLocations = useCombinedReports() || includeAllLocations;
  if (!shouldLoadAllLocations) {
    combinedReportScope = { key: "", sales: [], cashBalances: {}, locationName: "Alle Standorte" };
    return;
  }
  const scopeLocations = includeAllLocations && reportLocationScope.length ? reportLocationScope : locations;
  const scopeKey = `${scopeLocations.map((location) => location.id).join("|")}:${sales.length}:${Object.keys(cashBalances).length}`;
  if (!force && combinedReportScope.key === scopeKey) return;
  try {
    if (localMode) {
      const allSales = [];
      const combinedCash = {};
      scopeLocations.forEach((location) => {
        const locationSales = readStoredJson(scopedKeyFor("kassenraum-sales", location.id), []);
        locationSales.forEach((sale) => allSales.push({ ...sale, locationId: location.id, locationName: location.name }));
        const locationCash = readStoredJson(scopedKeyFor("kassenraum-cash-balances", location.id), {});
        Object.entries(locationCash).forEach(([dateKey, value]) => {
          if (Number.isFinite(Number(value))) combinedCash[dateKey] = (combinedCash[dateKey] || 0) + Number(value);
        });
      });
      combinedReportScope = { key: scopeKey, sales: allSales, cashBalances: combinedCash, locationName: "Alle Standorte" };
    } else {
      const remote = await CloudStore.loadReportsForLocations(scopeLocations.map((location) => location.id));
      const locationNames = Object.fromEntries(scopeLocations.map((location) => [location.id, location.name]));
      const allSales = (remote.sales || []).map((sale) => ({
        ...sale,
        locationId: sale.location_id || sale.locationId,
        locationName: locationNames[sale.location_id || sale.locationId] || "Standort"
      }));
      const combinedCash = {};
      (remote.cashBalances || []).forEach((row) => {
        if (Number.isFinite(Number(row.balance))) combinedCash[row.date_key] = (combinedCash[row.date_key] || 0) + Number(row.balance);
      });
      combinedReportScope = { key: scopeKey, sales: allSales, cashBalances: combinedCash, locationName: "Alle Standorte" };
    }
  } catch (error) {
    showToast(error.message || "Gemeinsame Abrechnung konnte nicht geladen werden");
  }
}

function filteredSales() {
  const source = reportSourceSales();
  if (reportFilter === "all") return source;
  const key = reportFilter === "today" ? localDateKey(new Date()) : $("#reportDateInput").value;
  return source.filter((sale) => localDateKey(sale.timestamp) === key);
}

function selectedReportDateKey() {
  return reportFilter === "today" ? localDateKey(new Date()) : $("#reportDateInput").value;
}

function isReceiptItemCanceled(item) {
  return item?.canceled === true || item?.status === "storniert";
}

function activeSaleItems(sale) {
  return (sale?.items || []).filter((item) => !isReceiptItemCanceled(item));
}

function saleActiveTotal(sale) {
  return activeSaleItems(sale).reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
}

function receiptHistoryBaseSales() {
  if (!isAdminUser()) return reportSourceSales();
  return combinedReportScope.sales.length ? combinedReportScope.sales : reportSourceSales();
}

function filteredReceiptSales() {
  let source = receiptHistoryBaseSales();
  if (isAdminUser() && receiptLocationFilter !== "all") {
    source = source.filter((sale) => String(sale.locationId || sale.location_id || currentLocationId) === String(receiptLocationFilter));
  }
  if (reportFilter === "all") return source;
  const key = reportFilter === "today" ? localDateKey(new Date()) : $("#reportDateInput").value;
  return source.filter((sale) => localDateKey(sale.timestamp) === key);
}

function aggregateSales(entries) {
  const products = new Map();
  let revenue = 0;
  let itemCount = 0;
  let freeCount = 0;

  entries.forEach((sale) => activeSaleItems(sale).forEach((item) => {
    const key = item.name.trim().toLocaleLowerCase("de");
    if (!products.has(key)) {
      products.set(key, { name: item.name, categories: new Set(), quantity: 0, revenue: 0, freeQuantity: 0 });
    }
    const summary = products.get(key);
    summary.categories.add(item.categoryName || "Ohne Kategorie");
    summary.quantity += item.quantity;
    summary.revenue += item.price * item.quantity;
    if (item.price > 0) revenue += item.price * item.quantity;
    else {
      summary.freeQuantity += item.quantity;
      freeCount += item.quantity;
    }
    itemCount += item.quantity;
  }));

  return {
    revenue,
    itemCount,
    freeCount,
    products: [...products.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "de"))
  };
}

function renderReceiptHistory(reportSales) {
  const sortedSales = [...reportSales].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  $("#receiptHistoryCount").textContent = `${sortedSales.length} ${sortedSales.length === 1 ? "Bon" : "Bons"}`;
  $("#receiptHistoryBody").innerHTML = sortedSales.map((sale) => {
    const items = (sale.items || []).map((item) =>
      `${escapeHtml(item.name)} <small>${Number(item.quantity || 0)} × ${euro(Number(item.price || 0))}${item.categoryName ? ` · ${escapeHtml(item.categoryName)}` : ""}</small>`
    ).join("");
    return `<tr class="receipt-history-row" data-sale-id="${escapeHtml(sale.id || "")}" tabindex="0" role="button" aria-label="Bon anzeigen">
      <td><strong>${escapeHtml(formatDateTime(sale.timestamp))}</strong><small>${escapeHtml(sale.id || "")}</small></td>
      <td>${escapeHtml(sale.locationName || locations.find((location) => location.id === currentLocationId)?.name || "Standort")}</td>
      <td class="receipt-items">${items}</td>
      <td class="number"><strong>${euro(saleActiveTotal(sale))}</strong></td>
    </tr>`;
  }).join("");
  $$(".receipt-history-row").forEach((row) => {
    row.addEventListener("click", () => openReceiptDialog(row.dataset.saleId));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openReceiptDialog(row.dataset.saleId);
      }
    });
  });
  $("#emptyReceiptHistory").classList.toggle("hidden", sortedSales.length > 0);
  $(".receipt-history-card .report-table-scroll").classList.toggle("hidden", sortedSales.length === 0);
}

function saleLocationName(sale) {
  return sale?.locationName || locations.find((location) => location.id === (sale?.locationId || currentLocationId))?.name || "Standort";
}

function findSaleForReceipt(saleId) {
  return reportSourceSales().find((sale) => String(sale.id || "") === String(saleId || ""));
}

async function persistCorrectedSale(sale) {
  const localIndex = sales.findIndex((entry) => String(entry.id || "") === String(sale.id || ""));
  if (!sale.items?.length) {
    if (localIndex >= 0) sales.splice(localIndex, 1);
    if (!localMode) await CloudStore.deleteSale(sale.id);
  } else {
    sale.total = sale.items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
    if (localIndex >= 0) sales[localIndex] = sale;
    if (!localMode) await CloudStore.saveSale(sale.locationId || currentLocationId, sale);
  }
  persistSales();
  await refreshReportScope(true);
  renderReport();
}

async function removeReceiptPosition(saleId, itemIndex) {
  const sale = findSaleForReceipt(saleId);
  if (!sale || !sale.items?.[itemIndex]) {
    showToast("Position wurde nicht gefunden");
    return;
  }
  const item = sale.items[itemIndex];
  if (!confirm(`Position „${item.name}“ aus diesem Bon löschen?`)) return;
  try {
    sale.items.splice(itemIndex, 1);
    await persistCorrectedSale(sale);
    if (sale.items.length) openReceiptDialog(sale.id);
    else $("#receiptDialog").close();
    showToast("Bonposition wurde gelöscht");
  } catch (error) {
    showToast(error.message || "Bonposition konnte nicht gelöscht werden");
  }
}

async function deleteReceipt(saleId) {
  if (!isAdminUser()) return;
  const sale = findSaleForReceipt(saleId);
  if (!sale) {
    showToast("Bon wurde nicht gefunden");
    return;
  }
  if (!confirm(`Bon ${sale.id || ""} wirklich endgültig löschen?`)) return;
  if (!confirm("Sicher? Dieser Bon wird dauerhaft aus der Abrechnung entfernt.")) return;
  try {
    if (localMode) {
      sales = sales.filter((entry) => String(entry.id || "") !== String(sale.id || ""));
    } else {
      await CloudStore.deleteSale(sale.id);
    }
    combinedReportScope.sales = combinedReportScope.sales.filter((entry) => String(entry.id || "") !== String(sale.id || ""));
    persistSales();
    await refreshReportScope(true, isAdminUser());
    renderReport();
    $("#receiptDialog").close();
    showToast("Bon wurde gelöscht");
  } catch (error) {
    showToast(error.message || "Bon konnte nicht gelöscht werden");
  }
}

function openReceiptDialog(saleId) {
  const sale = findSaleForReceipt(saleId);
  if (!sale) {
    showToast("Bon wurde nicht gefunden");
    return;
  }
  const rows = (sale.items || []).map((item, index) => {
    const quantity = Number(item.quantity || 0);
    const price = Number(item.price || 0);
    return `<tr>
      <td><strong>${escapeHtml(item.name || "")}</strong><small>${escapeHtml(item.categoryName || "Ohne Kategorie")}</small></td>
      <td class="number">${quantity}</td>
      <td class="number">${euro(price)}</td>
      <td class="number"><strong>${euro(quantity * price)}</strong></td>
      <td class="number"><button class="receipt-minus-button" data-sale-id="${escapeHtml(sale.id || "")}" data-item-index="${index}" title="Position löschen">−</button></td>
    </tr>`;
  }).join("");
  $("#receiptDialogTitle").textContent = `Bon ${formatDateTime(sale.timestamp)}`;
  $("#receiptDialogContent").innerHTML = `
    <div class="receipt-detail-meta">
      <span><strong>Standort</strong>${escapeHtml(saleLocationName(sale))}</span>
      <span><strong>Bon-ID</strong>${escapeHtml(sale.id || "")}</span>
      <span><strong>Summe</strong>${euro(saleActiveTotal(sale))}</span>
    </div>
    ${isAdminUser() ? `<div class="receipt-admin-actions"><button class="danger-button" id="deleteReceiptButton" type="button" data-sale-id="${escapeHtml(sale.id || "")}">Bon löschen</button></div>` : ""}
    <div class="report-table-scroll">
      <table class="report-table receipt-detail-table">
        <thead><tr><th>Artikel</th><th class="number">Anzahl</th><th class="number">Preis</th><th class="number">Summe</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  $$(".receipt-minus-button").forEach((button) => button.addEventListener("click", () =>
    removeReceiptPosition(button.dataset.saleId, Number(button.dataset.itemIndex))
  ));
  $("#deleteReceiptButton")?.addEventListener("click", (event) => deleteReceipt(event.currentTarget.dataset.saleId));
  $("#receiptDialog").showModal();
}

function renderReceiptLocationFilter() {
  const wrap = $("#receiptLocationFilterWrap");
  const select = $("#receiptLocationFilter");
  if (!wrap || !select) return;
  wrap.classList.toggle("hidden", !isAdminUser());
  if (!isAdminUser()) return;
  const validIds = new Set(locations.map((location) => String(location.id)));
  if (receiptLocationFilter !== "all" && !validIds.has(String(receiptLocationFilter))) receiptLocationFilter = "all";
  select.innerHTML = `<option value="all">Alle Standorte</option>` + locations.map((location) =>
    `<option value="${escapeHtml(location.id)}">${escapeHtml(location.name)}</option>`
  ).join("");
  select.value = receiptLocationFilter;
}

function renderReceiptHistory(reportSales) {
  renderReceiptLocationFilter();
  const sortedSales = [...reportSales].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  $("#receiptHistoryCount").textContent = `${sortedSales.length} ${sortedSales.length === 1 ? "Bon" : "Bons"}`;
  $("#receiptHistoryBody").innerHTML = sortedSales.map((sale) => {
    const sourceItems = isAdminUser() ? (sale.items || []) : activeSaleItems(sale);
    const items = sourceItems.map((item) =>
      `<span class="${isReceiptItemCanceled(item) ? "receipt-item-canceled" : ""}">${escapeHtml(item.name)} <small>${Number(item.quantity || 0)} × ${euro(Number(item.price || 0))}${item.categoryName ? ` · ${escapeHtml(item.categoryName)}` : ""}</small>${isReceiptItemCanceled(item) ? `<span class="receipt-storno-badge">storniert</span>` : ""}</span>`
    ).join("");
    return `<tr class="receipt-history-row" data-sale-id="${escapeHtml(sale.id || "")}" tabindex="0" role="button" aria-label="Bon anzeigen">
      <td><strong>${escapeHtml(formatDateTime(sale.timestamp))}</strong><small>${escapeHtml(sale.id || "")}</small></td>
      <td>${escapeHtml(saleLocationName(sale))}</td>
      <td class="receipt-items">${items || "<small>Keine aktiven Positionen</small>"}</td>
      <td class="number"><strong>${euro(saleActiveTotal(sale))}</strong></td>
    </tr>`;
  }).join("");
  $$(".receipt-history-row").forEach((row) => {
    row.addEventListener("click", () => openReceiptDialog(row.dataset.saleId));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openReceiptDialog(row.dataset.saleId);
      }
    });
  });
  $("#emptyReceiptHistory").classList.toggle("hidden", sortedSales.length > 0);
  $(".receipt-history-card .report-table-scroll").classList.toggle("hidden", sortedSales.length === 0);
}

function findSaleForReceipt(saleId) {
  const target = String(saleId || "");
  return [...receiptHistoryBaseSales(), ...reportSourceSales(), ...sales].find((sale) => String(sale.id || "") === target);
}

async function persistCorrectedSale(sale) {
  const locationId = sale.locationId || sale.location_id || currentLocationId;
  sale.locationId = locationId;
  sale.total = saleActiveTotal(sale);
  const localIndex = sales.findIndex((entry) => String(entry.id || "") === String(sale.id || ""));
  if (localIndex >= 0) sales[localIndex] = sale;
  else if (String(locationId) === String(currentLocationId)) sales.push(sale);
  const combinedIndex = combinedReportScope.sales.findIndex((entry) => String(entry.id || "") === String(sale.id || ""));
  if (combinedIndex >= 0) combinedReportScope.sales[combinedIndex] = { ...sale, locationName: saleLocationName(sale) };
  persistSales();
  if (!localMode) await CloudStore.saveSale(locationId, sale);
  await refreshReportScope(true, isAdminUser());
  renderReport();
}

async function removeReceiptPosition(saleId, itemIndex) {
  const sale = findSaleForReceipt(saleId);
  if (!sale || !sale.items?.[itemIndex]) {
    showToast("Position wurde nicht gefunden");
    return;
  }
  const item = sale.items[itemIndex];
  if (isReceiptItemCanceled(item)) {
    showToast("Position ist bereits storniert");
    return;
  }
  if (!confirm(`Position „${item.name}“ aus diesem Bon stornieren?`)) return;
  try {
    sale.items[itemIndex] = {
      ...item,
      canceled: true,
      status: "storniert",
      canceledAt: new Date().toISOString(),
      canceledBy: currentUserEmail || currentUserId || "Kasse"
    };
    await persistCorrectedSale(sale);
    openReceiptDialog(sale.id);
    showToast("Bonposition wurde storniert");
  } catch (error) {
    showToast(error.message || "Bonposition konnte nicht storniert werden");
  }
}

function openReceiptDialog(saleId) {
  const sale = findSaleForReceipt(saleId);
  if (!sale) {
    showToast("Bon wurde nicht gefunden");
    return;
  }
  const rows = (sale.items || []).map((item, index) => {
    if (!isAdminUser() && isReceiptItemCanceled(item)) return "";
    const quantity = Number(item.quantity || 0);
    const price = Number(item.price || 0);
    const canceled = isReceiptItemCanceled(item);
    return `<tr class="${canceled ? "is-canceled" : ""}">
      <td><strong>${escapeHtml(item.name || "")}</strong>${canceled ? `<span class="receipt-storno-badge">storniert</span>` : ""}<small>${escapeHtml(item.categoryName || "Ohne Kategorie")}${canceled && item.canceledAt ? ` · ${escapeHtml(formatDateTime(item.canceledAt))}` : ""}</small></td>
      <td class="number">${quantity}</td>
      <td class="number">${euro(price)}</td>
      <td class="number"><strong>${canceled ? euro(0) : euro(quantity * price)}</strong></td>
      <td class="number">${canceled ? "" : `<button class="receipt-minus-button" data-sale-id="${escapeHtml(sale.id || "")}" data-item-index="${index}" title="Position stornieren">−</button>`}</td>
    </tr>`;
  }).join("");
  $("#receiptDialogTitle").textContent = `Bon ${formatDateTime(sale.timestamp)}`;
  $("#receiptDialogContent").innerHTML = `
    <div class="receipt-detail-meta">
      <span><strong>Standort</strong>${escapeHtml(saleLocationName(sale))}</span>
      <span><strong>Bon-ID</strong>${escapeHtml(sale.id || "")}</span>
      <span><strong>Summe</strong>${euro(saleActiveTotal(sale))}</span>
    </div>
    ${isAdminUser() ? `<div class="receipt-admin-actions"><button class="danger-button" id="deleteReceiptButton" type="button" data-sale-id="${escapeHtml(sale.id || "")}">Bon löschen</button></div>` : ""}
    <div class="report-table-scroll">
      <table class="report-table receipt-detail-table">
        <thead><tr><th>Artikel</th><th class="number">Anzahl</th><th class="number">Preis</th><th class="number">Summe</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5">Keine aktiven Positionen</td></tr>`}</tbody>
      </table>
    </div>`;
  $$(".receipt-minus-button").forEach((button) => button.addEventListener("click", () =>
    removeReceiptPosition(button.dataset.saleId, Number(button.dataset.itemIndex))
  ));
  $("#deleteReceiptButton")?.addEventListener("click", (event) => deleteReceipt(event.currentTarget.dataset.saleId));
  $("#receiptDialog").showModal();
}

function renderReport() {
  $$(".report-filter").forEach((button) => button.classList.toggle("active", button.dataset.filter === reportFilter));
  const isDate = reportFilter === "date";
  const isAll = reportFilter === "all";
  $("#reportDateWrap").classList.toggle("hidden", !isDate);
  $("#exportReportButton").disabled = false;
  $("#exportReportButton").title = isAll ? "Erstellt ein Tabellenblatt pro Tag und eine Gesamtabrechnung." : "";
  renderReceiptLocationFilter();

  const reportSales = isAdminUser() ? filteredReceiptSales() : filteredSales();
  const summary = aggregateSales(reportSales);
  const periodKey = selectedReportDateKey();
  const adminLocationScopeLabel = receiptLocationFilter === "all" ? "alle Standorte" : saleLocationName({ locationId: receiptLocationFilter });
  $("#reportPeriodLabel").textContent = `${isAll ? "Gesamter gespeicherter Zeitraum" : formatDateKey(periodKey)} · ${useCombinedReports() ? "alle Standorte gemeinsam" : "aktueller Standort"}`;
  if (isAdminUser()) $("#reportPeriodLabel").textContent = `${isAll ? "Gesamter gespeicherter Zeitraum" : formatDateKey(periodKey)} · ${adminLocationScopeLabel}`;
  $("#reportRevenue").textContent = euro(summary.revenue);
  $("#reportSalesCount").textContent = reportSales.length;
  $("#reportAverage").textContent = `Ø ${euro(reportSales.length ? summary.revenue / reportSales.length : 0)} pro Bon`;
  $("#reportItemCount").textContent = summary.itemCount;
  $("#reportFreeCount").textContent = `${summary.freeCount} davon mit 0 €`;
  $("#reportResultCount").textContent = `${summary.products.length} ${summary.products.length === 1 ? "Artikel" : "Artikel"}`;

  $("#reportTableBody").innerHTML = summary.products.map((product) => `
    <tr>
      <td><strong>${escapeHtml(product.name)}</strong>${product.freeQuantity ? `<small class="zero-price">${product.freeQuantity} kostenlose Ausgabe${product.freeQuantity === 1 ? "" : "n"}</small>` : ""}</td>
      <td>${escapeHtml([...product.categories].join(", "))}</td>
      <td class="number">${product.quantity}</td>
      <td class="number">${euro(product.revenue)}</td>
    </tr>
  `).join("");
  $("#emptyReport").classList.toggle("hidden", summary.products.length > 0);
  $(".report-table-scroll").classList.toggle("hidden", summary.products.length === 0);
  renderReceiptHistory(reportSales);
  renderSubmittedReports();
  $("#cashBalancePanel").classList.toggle("hidden", isAll || useCombinedReports() || isAdminUser());
  if (!isAll && !useCombinedReports() && !isAdminUser()) {
    const savedBalance = reportSourceCashBalances()[periodKey];
    $("#cashBalanceInput").value = Number.isFinite(savedBalance) ? savedBalance : "";
    renderCashDifference(summary.revenue);
  }
}

function renderCashDifference(totalAmount = aggregateSales(filteredSales()).revenue) {
  const value = $("#cashBalanceInput").value;
  const output = $("#cashDifference");
  output.classList.remove("positive", "negative");
  if (value === "") {
    output.textContent = "–";
    return;
  }
  const difference = Number(value) - totalAmount;
  output.textContent = euro(difference);
  output.classList.add(difference < 0 ? "negative" : "positive");
}

function saveCashBalance() {
  if (reportFilter === "all") return;
  const key = selectedReportDateKey();
  const value = $("#cashBalanceInput").value;
  if (value === "") delete cashBalances[key];
  else cashBalances[key] = Math.max(0, Number(value) || 0);
  persistCashBalances();
  if (!localMode && currentLocationId !== "local") {
    if (value === "") CloudStore.deleteCash(currentLocationId, key);
    else CloudStore.saveCash(currentLocationId, key, cashBalances[key]);
  }
  renderCashDifference();
}

function recordCurrentSale() {
  const items = cart.map((entry) => {
    const product = data.products.find((candidate) => candidate.id === entry.productId);
    const category = categoryFor(product.categoryId);
    return {
      productId: product.id,
      name: product.name,
      price: product.price,
      categoryId: product.categoryId,
      categoryName: category?.name || "Ohne Kategorie",
      quantity: entry.quantity
    };
  });
  const sale = { id: uid("sale"), timestamp: new Date().toISOString(), total: cartTotal(), items };
  sales.push(sale);
  persistSales();
  if (!localMode && currentLocationId !== "local") CloudStore.insertSale(currentLocationId, sale);
}

function updatePaymentChange() {
  const inputValue = $("#paymentAmountInput").value;
  const givenAmount = inputValue === "" ? NaN : Number(inputValue);
  const difference = givenAmount - pendingPaymentTotal;
  const isEnough = Number.isFinite(givenAmount) && difference >= -0.005;
  const row = $("#paymentChangeRow");
  row.classList.toggle("positive", isEnough);
  row.classList.toggle("negative", Number.isFinite(givenAmount) && !isEnough);
  $("#paymentChangeLabel").textContent = isEnough ? "Rückgeld" : (Number.isFinite(givenAmount) ? "Fehlbetrag" : "Rückgeld");
  $("#paymentChange").textContent = euro(Number.isFinite(difference) ? Math.abs(difference) : 0);
  $("#confirmPaymentButton").disabled = !isEnough;
}

function openPaymentDialog() {
  pendingPaymentTotal = cartTotal();
  if (!cart.length || pendingPaymentTotal < 0) return;
  paymentReturnCategory = selectedCategory;
  $("#paymentStep").classList.remove("hidden");
  $("#paymentSuccess").classList.add("hidden");
  $("#paymentTotal").textContent = euro(pendingPaymentTotal);
  $("#paymentAmountInput").value = "";
  updatePaymentChange();
  $("#checkoutDialog").showModal();
  $("#paymentAmountInput").focus();
}

function completePayment(event) {
  event.preventDefault();
  const givenAmount = Number($("#paymentAmountInput").value);
  const changeAmount = givenAmount - pendingPaymentTotal;
  if (!Number.isFinite(givenAmount) || changeAmount < -0.005) return;
  recordCurrentSale();
  cart = [];
  renderCart();
  $("#checkoutMessage").textContent = `Gesamt: ${euro(pendingPaymentTotal)} · Gegeben: ${euro(givenAmount)} · Rückgeld: ${euro(Math.max(0, changeAmount))}`;
  $("#paymentStep").classList.add("hidden");
  $("#paymentSuccess").classList.remove("hidden");
}

function buildExportPayload() {
  const buildSheet = (reportSales, { dateLabel, sheetName, cashBalance = null }) => {
    const categoryNames = data.categories
      .filter((category) => data.products.some((product) => product.categoryId === category.id && Number(product.price) <= 0))
      .map((category) => category.name);
    const categorySet = new Set(categoryNames);
    const rows = new Map();

    const ensureRow = (name) => {
      const key = name.trim().toLocaleLowerCase("de");
      if (!rows.has(key)) rows.set(key, { name, total: 0, sold: 0, amount: 0, categoryCounts: {} });
      return rows.get(key);
    };

    data.products.forEach((product) => ensureRow(product.name));
    reportSales.forEach((sale) => activeSaleItems(sale).forEach((item) => {
      const row = ensureRow(item.name);
      row.total += item.quantity;
      row.amount += item.price * item.quantity;
      if (Number(item.price) > 0) row.sold += item.quantity;
      else {
        const categoryName = item.categoryName || "Ohne Kategorie";
        row.categoryCounts[categoryName] = (row.categoryCounts[categoryName] || 0) + item.quantity;
        if (!categorySet.has(categoryName)) {
          categorySet.add(categoryName);
          categoryNames.push(categoryName);
        }
      }
    }));

    return {
      sheetName,
      dateLabel,
      rows: [...rows.values()],
      categoryNames,
      cashBalance,
      locationName: useCombinedReports()
        ? combinedReportScope.locationName
        : (locations.find((location) => location.id === currentLocationId)?.name || "Standort")
    };
  };

  if (reportFilter === "all") {
    const sourceSales = reportSourceSales();
    const sourceCashBalances = reportSourceCashBalances();
    const dateKeys = [...new Set([
      ...sourceSales.map((sale) => localDateKey(sale.timestamp)),
      ...Object.keys(sourceCashBalances)
    ])].sort();
    const sheets = dateKeys.map((dateKey) => buildSheet(
      sourceSales.filter((sale) => localDateKey(sale.timestamp) === dateKey),
      {
        dateLabel: formatDateKey(dateKey),
        sheetName: formatDateKey(dateKey),
        cashBalance: Number.isFinite(sourceCashBalances[dateKey]) ? sourceCashBalances[dateKey] : null
      }
    ));
    const enteredCashBalances = dateKeys
      .map((dateKey) => sourceCashBalances[dateKey])
      .filter((value) => Number.isFinite(value));
    sheets.push(buildSheet(sourceSales, {
      dateLabel: "Gesamtabrechnung",
      sheetName: "Gesamtabrechnung",
      cashBalance: enteredCashBalances.length
        ? enteredCashBalances.reduce((sum, value) => sum + value, 0)
        : null
    }));
    return { filename: "Gesamtabrechnung.xlsx", workbook: { sheets } };
  }

  const dateKey = selectedReportDateKey();
  const sourceCashBalances = reportSourceCashBalances();
  return {
    filename: `${useCombinedReports() ? "Abrechnung_Alle_Standorte" : "Abrechnung"}_${dateKey}.xlsx`,
    workbook: buildSheet(filteredSales(), {
      dateLabel: formatDateKey(dateKey),
      sheetName: formatDateKey(dateKey),
      cashBalance: Number.isFinite(sourceCashBalances[dateKey]) ? sourceCashBalances[dateKey] : null
    })
  };
}

function buildSubmittedReportSheet(reportSales, catalogData, { dateLabel, sheetName, cashBalance = null, locationName = "" }) {
  const catalog = catalogData?.categories && catalogData?.products ? catalogData : { categories: [], products: [] };
  const categoryNames = catalog.categories
    .filter((category) => catalog.products.some((product) => product.categoryId === category.id && Number(product.price) <= 0))
    .map((category) => category.name);
  const categorySet = new Set(categoryNames);
  const rows = new Map();
  const ensureRow = (name) => {
    const cleanName = String(name || "Unbekannter Artikel").trim();
    const key = cleanName.toLocaleLowerCase("de");
    if (!rows.has(key)) rows.set(key, { name: cleanName, total: 0, sold: 0, amount: 0, categoryCounts: {} });
    return rows.get(key);
  };

  catalog.products.forEach((product) => ensureRow(product.name));
  (reportSales || []).forEach((sale) => activeSaleItems(sale).forEach((item) => {
    const row = ensureRow(item.name);
    const quantity = Number(item.quantity || 0);
    const price = Number(item.price || 0);
    row.total += quantity;
    row.amount += price * quantity;
    if (price > 0) row.sold += quantity;
    else {
      const categoryName = item.categoryName || "Ohne Kategorie";
      row.categoryCounts[categoryName] = (row.categoryCounts[categoryName] || 0) + quantity;
      if (!categorySet.has(categoryName)) {
        categorySet.add(categoryName);
        categoryNames.push(categoryName);
      }
    }
  }));

  return {
    sheetName: String(sheetName || dateLabel || "Abrechnung").replace(/[\\/?*[\]:]/g, " ").slice(0, 31),
    dateLabel,
    rows: [...rows.values()],
    categoryNames,
    cashBalance: Number.isFinite(Number(cashBalance)) ? Number(cashBalance) : null,
    locationName
  };
}

function submittedReportLocationName(report) {
  return report.location?.name
    || report.locationName
    || locations.find((location) => String(location.id) === String(report.location_id || report.locationId))?.name
    || "Standort";
}

function submittedReportSales(report) {
  return Array.isArray(report.sales) ? report.sales : [];
}

function submittedReportCatalog(report) {
  return report.catalog?.categories && report.catalog?.products ? report.catalog : data;
}

function downloadSubmittedReport(report) {
  const dateKey = report.business_date || report.businessDate;
  const locationName = submittedReportLocationName(report);
  const sheet = buildSubmittedReportSheet(submittedReportSales(report), submittedReportCatalog(report), {
    dateLabel: formatDateKey(dateKey),
    sheetName: `${locationName} ${formatDateKey(dateKey)}`,
    cashBalance: report.cash_balance ?? report.cashBalance,
    locationName
  });
  XlsxExport.downloadWorkbook(sheet, `Abrechnung_${locationName}_${dateKey}.xlsx`);
}

function downloadAllSubmittedReports() {
  if (!submittedReports.length) {
    showToast("Noch keine Abrechnungen übermittelt");
    return;
  }
  const ordered = [...submittedReports].sort((a, b) =>
    String(a.business_date || a.businessDate).localeCompare(String(b.business_date || b.businessDate))
  );
  const sheets = ordered.map((report) => {
    const dateKey = report.business_date || report.businessDate;
    const locationName = submittedReportLocationName(report);
    return buildSubmittedReportSheet(submittedReportSales(report), submittedReportCatalog(report), {
      dateLabel: formatDateKey(dateKey),
      sheetName: `${locationName} ${dateKey.slice(5)}`,
      cashBalance: report.cash_balance ?? report.cashBalance,
      locationName
    });
  });
  const allSales = ordered.flatMap((report) => submittedReportSales(report));
  const cashValues = ordered
    .map((report) => Number(report.cash_balance ?? report.cashBalance))
    .filter(Number.isFinite);
  const totalCash = cashValues.length ? cashValues.reduce((sum, value) => sum + value, 0) : null;
  sheets.push(buildSubmittedReportSheet(allSales, data, {
    dateLabel: "Gesamtabrechnung",
    sheetName: "Gesamtabrechnung",
    cashBalance: totalCash,
    locationName: "Alle Standorte"
  }));
  XlsxExport.downloadWorkbook({ sheets }, "Gesamtabrechnung_Übermittelt.xlsx");
  showToast("Gesamtabrechnung wurde erstellt");
}

async function refreshSubmittedReports() {
  if (!isAdminUser()) {
    submittedReports = [];
    return;
  }
  if (localMode) {
    submittedReports = readStoredJson("kassenraum-submitted-reports", []);
    return;
  }
  submittedReports = await CloudStore.loadSubmittedReports();
}

async function submitCurrentReport() {
  if (isAdminUser()) return;
  const dateKey = businessDateKey(new Date());
  const reportSales = salesForBusinessDate(sales, dateKey);
  if (!reportSales.length) {
    showToast("Für diesen Geschäftstag sind keine Bons vorhanden");
    return;
  }
  if (!confirm(`Abrechnung für den Geschäftstag ${formatDateKey(dateKey)} an den Admin übermitteln?`)) return;

  const button = $("#submitReportButton");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Wird übermittelt …";
  try {
    const cashBalance = Number.isFinite(Number(cashBalances[dateKey])) ? Number(cashBalances[dateKey]) : null;
    if (localMode) {
      const existing = readStoredJson("kassenraum-submitted-reports", []);
      const locationName = locations.find((location) => location.id === currentLocationId)?.name || "Standort";
      const report = {
        id: existing.find((item) => item.locationId === currentLocationId && item.businessDate === dateKey)?.id || uid("report"),
        locationId: currentLocationId,
        locationName,
        businessDate: dateKey,
        sales: structuredClone(reportSales),
        catalog: structuredClone(data),
        cashBalance,
        submittedAt: new Date().toISOString()
      };
      const remaining = existing.filter((item) => !(item.locationId === currentLocationId && item.businessDate === dateKey));
      localStorage.setItem("kassenraum-submitted-reports", JSON.stringify([report, ...remaining]));
    } else {
      await CloudStore.submitReport(currentLocationId, dateKey, reportSales, data, cashBalance);
    }
    showToast(`Abrechnung ${formatDateKey(dateKey)} wurde übermittelt`);
  } catch (error) {
    showToast(error.message || "Abrechnung konnte nicht übermittelt werden");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function deleteSubmittedReport(reportId) {
  if (!isAdminUser()) return;
  const report = submittedReports.find((item) => String(item.id) === String(reportId));
  if (!report || !confirm(`Abrechnung ${formatDateKey(report.business_date || report.businessDate)} von ${submittedReportLocationName(report)} löschen?`)) return;
  try {
    if (localMode) {
      submittedReports = submittedReports.filter((item) => String(item.id) !== String(reportId));
      localStorage.setItem("kassenraum-submitted-reports", JSON.stringify(submittedReports));
    } else {
      await CloudStore.deleteSubmittedReport(reportId);
      await refreshSubmittedReports();
    }
    renderSubmittedReports();
    showToast("Übermittelte Abrechnung wurde gelöscht");
  } catch (error) {
    showToast(error.message || "Abrechnung konnte nicht gelöscht werden");
  }
}

function renderSubmittedReports() {
  const panel = $("#submittedReportsPanel");
  if (!panel) return;
  panel.classList.toggle("hidden", !isAdminUser());
  if (!isAdminUser()) return;
  const body = $("#submittedReportsBody");
  body.innerHTML = submittedReports.map((report) => {
    const reportSales = submittedReportSales(report);
    const summary = aggregateSales(reportSales);
    const dateKey = report.business_date || report.businessDate;
    const submittedAt = report.submitted_at || report.submittedAt;
    return `<tr>
      <td><strong>${escapeHtml(formatDateKey(dateKey))}</strong></td>
      <td>${escapeHtml(submittedReportLocationName(report))}</td>
      <td>${escapeHtml(formatDateTime(submittedAt))}</td>
      <td class="number">${reportSales.length}</td>
      <td class="number">${euro(summary.revenue)}</td>
      <td class="number"><div class="submitted-report-actions">
        <button class="secondary-button download-submitted-report" data-id="${escapeHtml(report.id)}">Excel</button>
        <button class="danger-button delete-submitted-report" data-id="${escapeHtml(report.id)}">Löschen</button>
      </div></td>
    </tr>`;
  }).join("");
  $("#emptySubmittedReports").classList.toggle("hidden", submittedReports.length > 0);
  panel.querySelector(".report-table-scroll").classList.toggle("hidden", submittedReports.length === 0);
  $("#downloadAllSubmittedReportsButton").disabled = submittedReports.length === 0;
  $$(".download-submitted-report").forEach((button) => button.addEventListener("click", () => {
    const report = submittedReports.find((item) => String(item.id) === String(button.dataset.id));
    if (report) downloadSubmittedReport(report);
  }));
  $$(".delete-submitted-report").forEach((button) => button.addEventListener("click", () => deleteSubmittedReport(button.dataset.id)));
}

async function exportReport() {
  await refreshReportScope(true);
  const payload = buildExportPayload();
  XlsxExport.downloadWorkbook(payload.workbook, payload.filename);
  showToast("Excel-Abrechnung wurde erstellt");
}

function bytesToBase64(bytes) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < array.length; index += chunkSize) {
    binary += String.fromCharCode(...array.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function textToBase64(text) {
  return bytesToBase64(new TextEncoder().encode(text));
}

function wrapBase64(value) {
  return String(value).match(/.{1,76}/g)?.join("\r\n") || "";
}

function encodedMailHeader(value) {
  return `=?UTF-8?B?${textToBase64(value)}?=`;
}

function safeMailFilename(value) {
  return String(value || "Abrechnung.xlsx").replace(/[\\/:*?"<>|]+/g, "_");
}

function downloadEmlWithAttachment({ recipients, subject, body, filename, bytes }) {
  const boundary = `----Kassenraum-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const safeFilename = safeMailFilename(filename);
  const eml = [
    "X-Unsent: 1",
    `To: ${recipients.join(", ")}`,
    `Subject: ${encodedMailHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(textToBase64(body)),
    "",
    `--${boundary}`,
    `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name*=UTF-8''${encodeURIComponent(safeFilename)}`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
    "",
    wrapBase64(bytesToBase64(bytes)),
    "",
    `--${boundary}--`,
    ""
  ].join("\r\n");
  const blob = new Blob([eml], { type: "message/rfc822" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFilename.replace(/\.xlsx$/i, "")}.eml`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function emailReport() {
  const recipients = [appSettings.billingEmail, appSettings.billingEmail2].map((email) => String(email || "").trim()).filter(Boolean);
  if (!recipients.length) {
    showToast("Bitte zuerst eine Abrechnungs-E-Mail im Adminbereich hinterlegen.");
    return;
  }

  const button = $("#emailReportButton");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Mail-App wird geöffnet …";

  try {
    await refreshReportScope(true);
    const payload = buildExportPayload();
    const sales = filteredSales();
    const summary = aggregateSales(sales);
    const period = reportFilter === "all" ? "Gesamtabrechnung" : formatDateKey(selectedReportDateKey());
    const locationName = useCombinedReports() ? combinedReportScope.locationName : (locations.find((location) => location.id === currentLocationId)?.name || "Standort");
    const bytes = XlsxExport.createWorkbook(payload.workbook);
    const file = new File([bytes], payload.filename, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const subject = `Abrechnung ${locationName} – ${period}`;
    const body = [
      `Empfänger: ${recipients.join(", ")}`,
      "",
      `Im Anhang befindet sich die Abrechnung für ${locationName}.`,
      `Zeitraum: ${period}`,
      `Umsatz: ${euro(summary.revenue)}`,
      `Belege: ${sales.length}`,
      `Artikel: ${summary.itemCount}`
    ].join("\n");

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: subject,
          text: body
        });
        showToast("Abrechnung wurde an die Mail-App übergeben");
      } catch (error) {
        if (error?.name === "AbortError") {
          showToast("Teilen abgebrochen");
          return;
        }
        throw error;
      }
      return;
    }

    downloadEmlWithAttachment({
      recipients,
      subject,
      body,
      filename: payload.filename,
      bytes
    });
    showToast("Maildatei mit Excel-Anhang wurde erstellt");
    return;

    XlsxExport.downloadWorkbook(payload.workbook, payload.filename);
    const fallbackBody = `${body}\n\nDie Exceldatei wurde heruntergeladen. Bitte diese Datei an die E-Mail anhängen.`;
    const mailRecipients = recipients.map((email) => encodeURIComponent(email)).join(",");
    window.location.href = `mailto:${mailRecipients}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(fallbackBody)}`;
    showToast("Exceldatei heruntergeladen – bitte im Mailentwurf anhängen");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Mail-App konnte nicht geöffnet werden");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function normalizeTimeTracking(remote) {
  employees = (remote.employees || []).map((employee) => ({
    id: employee.id,
    name: employee.name,
    hourlyRate: Number(employee.hourly_rate ?? employee.hourlyRate ?? 0),
    active: employee.active !== false
  }));
  timeEntries = (remote.timeEntries || []).map((entry) => ({
    id: entry.id,
    employeeId: entry.employee_id || entry.employeeId,
    locationId: entry.location_id || entry.locationId || null,
    hourlyRate: Number(entry.hourly_rate ?? entry.hourlyRate ?? employees.find((employee) => employee.id === (entry.employee_id || entry.employeeId))?.hourlyRate ?? 0),
    clockIn: entry.clock_in || entry.clockIn,
    clockOut: entry.clock_out || entry.clockOut || null
  }));
  employeeBonuses = (remote.bonuses || []).map((bonus) => ({
    id: bonus.id,
    employeeId: bonus.employee_id || bonus.employeeId,
    dateKey: bonus.date_key || bonus.dateKey,
    amount: Number(bonus.amount || 0),
    note: bonus.note || ""
  }));
}

async function reloadTimeTracking() {
  if (!localMode) {
    try {
      normalizeTimeTracking(await CloudStore.loadTimeTracking());
    } catch (error) {
      showToast(error.message || "Arbeitszeiten konnten nicht geladen werden");
    }
  }
  renderTimeTracking();
}

function renderActiveEmployees() {
  const bar = $("#activeEmployeesBar");
  const list = $("#activeEmployeesList");
  if (!bar || !list) return;
  const openEntries = timeEntries
    .filter((entry) => !entry.clockOut)
    .sort((a, b) => new Date(a.clockIn) - new Date(b.clockIn));
  bar.classList.toggle("hidden", !openEntries.length);
  list.innerHTML = openEntries.map((entry) => {
    const employee = employeeForTime(entry.employeeId);
    return `<span class="active-employee-chip"><strong>${escapeHtml(employee?.name || "Unbekannt")}</strong><span>${escapeHtml(locationNameForTime(entry.locationId))} · seit ${escapeHtml(formatDateTime(entry.clockIn))}</span></span>`;
  }).join("");
}

async function openTimeClock() {
  stopAdminReportAutoRefresh();
  $("#posView").classList.add("hidden");
  $("#settingsView").classList.add("hidden");
  $("#reportsView").classList.add("hidden");
  $("#timeClockView").classList.remove("hidden");
  const today = localDateKey(new Date());
  if (!$("#timeFromDate").value) $("#timeFromDate").value = `${today.slice(0, 8)}01`;
  if (!$("#timeToDate").value) $("#timeToDate").value = today;
  $("#manualDateInput").value = today;
  $("#manualEndDateInput").value = today;
  $("#bonusDateInput").value = today;
  renderRoleAccess();
  await reloadTimeTracking();
  window.scrollTo(0, 0);
}

function employeeForTime(id) {
  return employees.find((employee) => employee.id === id);
}

function locationNameForTime(id) {
  return locations.find((location) => location.id === id)?.name || "Gelöschter Standort";
}

function formatDateTime(value) {
  if (!value) return "Offen";
  return new Intl.DateTimeFormat("de-AT", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(new Date(value));
}

function formatHours(value) {
  const totalMinutes = Math.max(0, Math.round(Number(value || 0) * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} Std. ${String(minutes).padStart(2, "0")} Min.`;
}

function timeRange() {
  const today = localDateKey(new Date());
  return {
    from: $("#timeFromDate").value || `${today.slice(0, 8)}01`,
    to: $("#timeToDate").value || today
  };
}

function entryDurationHours(entry) {
  const start = new Date(entry.clockIn);
  const end = entry.clockOut ? new Date(entry.clockOut) : new Date();
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return 0;
  return (end - start) / 3600000;
}

function aggregateTimeTracking() {
  const { from, to } = timeRange();
  const dailyMap = new Map();
  timeEntries.forEach((entry) => {
    const entryRate = Number(entry.hourlyRate ?? employeeForTime(entry.employeeId)?.hourlyRate ?? 0);
    const dateKey = localDateKey(new Date(entry.clockIn));
    if (dateKey < from || dateKey > to) return;
    const hours = entryDurationHours(entry);
    const key = `${entry.employeeId}|${dateKey}`;
    const current = dailyMap.get(key) || { employeeId: entry.employeeId, dateKey, hours: 0, wages: 0 };
    current.hours += hours;
    current.wages += hours * entryRate;
    dailyMap.set(key, current);
  });
  employeeBonuses.forEach((bonus) => {
    if (bonus.dateKey < from || bonus.dateKey > to) return;
    const key = `${bonus.employeeId}|${bonus.dateKey}`;
    if (!dailyMap.has(key)) dailyMap.set(key, { employeeId: bonus.employeeId, dateKey: bonus.dateKey, hours: 0, wages: 0 });
  });

  const dailyRows = [...dailyMap.values()].map((row) => {
    const employee = employeeForTime(row.employeeId) || { name: "Unbekannt", hourlyRate: 0 };
    const bonus = employeeBonuses.find((item) => item.employeeId === row.employeeId && item.dateKey === row.dateKey);
    const wages = Number(row.wages || 0);
    const effectiveRate = row.hours > 0 ? wages / row.hours : employee.hourlyRate;
    return {
      ...row,
      employeeName: employee.name,
      hourlyRate: effectiveRate,
      wages,
      bonus: Number(bonus?.amount || 0),
      bonusNote: bonus?.note || "",
      total: wages + Number(bonus?.amount || 0)
    };
  }).sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.employeeName.localeCompare(b.employeeName, "de"));

  const employeeMap = new Map();
  dailyRows.forEach((row) => {
    const current = employeeMap.get(row.employeeId) || {
      employeeId: row.employeeId, employeeName: row.employeeName, hours: 0, wages: 0, bonus: 0, total: 0
    };
    current.hours += row.hours;
    current.wages += row.wages;
    current.bonus += row.bonus;
    current.total += row.total;
    employeeMap.set(row.employeeId, current);
  });
  const employeeRows = [...employeeMap.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName, "de"));
  const totals = employeeRows.reduce((sum, row) => ({
    hours: sum.hours + row.hours,
    wages: sum.wages + row.wages,
    bonus: sum.bonus + row.bonus,
    total: sum.total + row.total
  }), { hours: 0, wages: 0, bonus: 0, total: 0 });
  return { dailyRows, employeeRows, totals };
}

function employeeOptions(includeInactive = true) {
  return employees
    .filter((employee) => includeInactive || employee.active || timeEntries.some((entry) => entry.employeeId === employee.id && !entry.clockOut))
    .map((employee) => `<option value="${employee.id}">${escapeHtml(employee.name)}</option>`)
    .join("");
}

function renderTimeTracking() {
  renderActiveEmployees();
  const clockSelect = $("#clockEmployeeSelect");
  const selectedClockEmployee = clockSelect.value;
  clockSelect.innerHTML = `<option value="">Mitarbeiter wählen …</option>${employeeOptions(false)}`;
  if (employees.some((employee) => employee.id === selectedClockEmployee
    && (employee.active || timeEntries.some((entry) => entry.employeeId === employee.id && !entry.clockOut)))) {
    clockSelect.value = selectedClockEmployee;
  }

  ["manualEmployeeSelect", "bonusEmployeeSelect"].forEach((id) => {
    const select = $(`#${id}`);
    const selected = select.value;
    select.innerHTML = `<option value="">Mitarbeiter wählen …</option>${employeeOptions(true)}`;
    if (employees.some((employee) => employee.id === selected)) select.value = selected;
  });

  renderClockStatus();
  if (!isAdminUser()) return;
  renderEmployeeAdministration();
  renderTimeAdministration();
}

function renderClockStatus() {
  const employeeId = $("#clockEmployeeSelect").value;
  const employee = employeeForTime(employeeId);
  const openEntry = timeEntries.find((entry) => entry.employeeId === employeeId && !entry.clockOut);
  $("#clockInButton").classList.toggle("hidden", Boolean(openEntry));
  $("#clockOutButton").classList.toggle("hidden", !openEntry);
  $("#clockInButton").disabled = !employee;
  $("#clockOutButton").disabled = !openEntry;
  $("#clockStatusText").textContent = !employee
    ? (employees.some((item) => item.active) ? "Bitte Namen auswählen." : "Noch keine aktiven Mitarbeiter angelegt.")
    : openEntry
      ? `Eingestempelt seit ${formatDateTime(openEntry.clockIn)}`
      : "Aktuell nicht eingestempelt.";
}

function renderEmployeeAdministration() {
  const list = $("#employeeAdminList");
  list.innerHTML = employees.length ? employees.map((employee) => `
    <div class="employee-admin-row" data-id="${employee.id}">
      <label>Name<input class="employee-edit-name" value="${escapeHtml(employee.name)}"></label>
      <label>Stundensatz (€)<input class="employee-edit-rate" type="number" min="0" step="0.01" value="${employee.hourlyRate.toFixed(2)}"></label>
      <label class="employee-active"><input class="employee-edit-active" type="checkbox" ${employee.active ? "checked" : ""}> Aktiv</label>
      <button class="secondary-button save-employee" type="button">Speichern</button>
      <button class="danger-button delete-employee" type="button">Entfernen</button>
    </div>`).join("") : `<div class="list-empty">Noch keine Mitarbeiter vorhanden.</div>`;
  $$(".save-employee").forEach((button) => button.addEventListener("click", () => saveExistingEmployee(button.closest(".employee-admin-row"))));
  $$(".delete-employee").forEach((button) => button.addEventListener("click", () => removeEmployee(button.closest(".employee-admin-row").dataset.id)));
}

function renderTimeAdministration() {
  const { from, to } = timeRange();
  const { dailyRows, employeeRows, totals } = aggregateTimeTracking();
  $("#timeTotalHours").textContent = formatHours(totals.hours);
  $("#timeTotalWages").textContent = euro(totals.wages);
  $("#timeTotalBonuses").textContent = euro(totals.bonus);
  $("#timeTotalPay").textContent = euro(totals.total);

  $("#dailyTimeTable").innerHTML = dailyRows.length ? dailyRows.map((row) => `
    <tr><td>${escapeHtml(formatDateKey(row.dateKey))}</td><td>${escapeHtml(row.employeeName)}</td>
    <td class="numeric">${formatHours(row.hours)}</td><td class="numeric">${euro(row.hourlyRate)}</td>
    <td class="numeric">${euro(row.wages)}</td><td class="numeric" title="${escapeHtml(row.bonusNote)}">${euro(row.bonus)}</td>
    <td class="numeric"><strong>${euro(row.total)}</strong></td></tr>`).join("")
    : `<tr><td colspan="7">Keine Arbeitszeiten im gewählten Zeitraum.</td></tr>`;

  $("#employeeTimeTotals").innerHTML = employeeRows.length ? employeeRows.map((row) => `
    <tr><td>${escapeHtml(row.employeeName)}</td><td class="numeric">${formatHours(row.hours)}</td>
    <td class="numeric">${euro(row.wages)}</td><td class="numeric">${euro(row.bonus)}</td>
    <td class="numeric"><strong>${euro(row.total)}</strong></td></tr>`).join("")
    : `<tr><td colspan="5">Keine Mitarbeitersummen vorhanden.</td></tr>`;

  const filteredEntries = timeEntries.filter((entry) => {
    const day = localDateKey(new Date(entry.clockIn));
    return day >= from && day <= to;
  });
  $("#timeEntriesTable").innerHTML = filteredEntries.length ? filteredEntries.map((entry) => {
    const hours = entryDurationHours(entry);
    return `<tr><td>${escapeHtml(employeeForTime(entry.employeeId)?.name || "Unbekannt")}</td>
      <td>${escapeHtml(locationNameForTime(entry.locationId))}</td>
      <td>${formatDateTime(entry.clockIn)}</td><td class="${entry.clockOut ? "" : "time-open"}">${formatDateTime(entry.clockOut)}</td>
      <td class="numeric">${formatHours(hours)}</td>
      <td><div class="time-row-actions">
        <button class="secondary-button edit-time-entry" data-id="${entry.id}">Bearbeiten</button>
        <button class="danger-button delete-time-entry" data-id="${entry.id}">Löschen</button>
      </div></td></tr>`;
  }).join("") : `<tr><td colspan="6">Keine Stempelungen im gewählten Zeitraum.</td></tr>`;
  $$(".edit-time-entry").forEach((button) => button.addEventListener("click", () => openTimeEntryEditor(button.dataset.id)));
  $$(".delete-time-entry").forEach((button) => button.addEventListener("click", () => removeTimeEntry(button.dataset.id)));

  const filteredBonuses = employeeBonuses.filter((bonus) => bonus.dateKey >= from && bonus.dateKey <= to);
  $("#bonusAdminList").innerHTML = filteredBonuses.length ? filteredBonuses.map((bonus) => `
    <div class="bonus-admin-row"><span><strong>${escapeHtml(employeeForTime(bonus.employeeId)?.name || "Unbekannt")}</strong><br><small>${escapeHtml(formatDateKey(bonus.dateKey))}${bonus.note ? ` · ${escapeHtml(bonus.note)}` : ""}</small></span>
    <strong>${euro(bonus.amount)}</strong><button class="danger-button delete-bonus" data-id="${bonus.id}">Löschen</button></div>`).join("") : "";
  $$(".delete-bonus").forEach((button) => button.addEventListener("click", () => removeBonus(button.dataset.id)));
}

async function clockEmployee(direction) {
  const employeeId = $("#clockEmployeeSelect").value;
  if (!employeeId) return;
  try {
    if (localMode) {
      const openEntry = timeEntries.find((entry) => entry.employeeId === employeeId && !entry.clockOut);
      if (direction === "in") {
        if (openEntry) throw new Error("Mitarbeiter ist bereits eingestempelt");
        const employee = employeeForTime(employeeId);
        timeEntries.unshift({
          id: uid("time"), employeeId, locationId: currentLocationId,
          hourlyRate: Number(employee?.hourlyRate || 0),
          clockIn: new Date().toISOString(), clockOut: null
        });
      } else {
        if (!openEntry) throw new Error("Mitarbeiter ist nicht eingestempelt");
        openEntry.clockOut = new Date().toISOString();
      }
      persistLocalTimeTracking();
    } else {
      if (!navigator.onLine) throw new Error("Zum Stempeln ist eine Internetverbindung erforderlich.");
      if (direction === "in") await CloudStore.clockIn(employeeId, currentLocationId);
      else await CloudStore.clockOut(employeeId);
      await reloadTimeTracking();
    }
    renderTimeTracking();
    showToast(direction === "in" ? "Erfolgreich eingestempelt" : "Erfolgreich ausgestempelt");
  } catch (error) {
    showToast(error.message || "Stempeln fehlgeschlagen");
  }
}

async function addEmployee(event) {
  event.preventDefault();
  const employee = {
    name: $("#employeeNameInput").value.trim(),
    hourlyRate: Number($("#employeeRateInput").value),
    active: true
  };
  if (!employee.name || !Number.isFinite(employee.hourlyRate) || employee.hourlyRate < 0) return;
  if (employees.some((item) => item.name.toLowerCase() === employee.name.toLowerCase())) {
    showToast("Mitarbeitername ist bereits vorhanden");
    return;
  }
  try {
    if (localMode) {
      employees.push({ ...employee, id: uid("employee") });
      persistLocalTimeTracking();
    } else {
      await CloudStore.saveEmployee(currentLocationId, employee);
      await reloadTimeTracking();
    }
    $("#addEmployeeForm").reset();
    $("#employeeRateInput").value = "0";
    renderTimeTracking();
    showToast("Mitarbeiter wurde angelegt");
  } catch (error) {
    showToast(error.message || "Mitarbeiter konnte nicht angelegt werden");
  }
}

function askRateRecalculation(employee, newRate) {
  return new Promise((resolve) => {
    const dialog = $("#rateChangeDialog");
    $("#rateChangeMessage").textContent =
      `Der Stundensatz von ${employee.name} wird von ${euro(employee.hourlyRate)} auf ${euro(newRate)} geändert. Sollen vergangene Stempelzeiten ebenfalls angepasst werden?`;
    const finish = (answer) => {
      dialog.close();
      resolve(answer);
    };
    $("#rateChangeYesButton").onclick = () => finish(true);
    $("#rateChangeNoButton").onclick = () => finish(false);
    dialog.oncancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    dialog.showModal();
  });
}

async function saveExistingEmployee(row) {
  const previousEmployee = employeeForTime(row.dataset.id);
  const employee = {
    id: row.dataset.id,
    name: row.querySelector(".employee-edit-name").value.trim(),
    hourlyRate: Number(row.querySelector(".employee-edit-rate").value),
    active: row.querySelector(".employee-edit-active").checked
  };
  if (!employee.name || !Number.isFinite(employee.hourlyRate) || employee.hourlyRate < 0) return;
  if (employees.some((item) => item.id !== employee.id && item.name.toLowerCase() === employee.name.toLowerCase())) {
    showToast("Mitarbeitername ist bereits vorhanden");
    return;
  }
  const rateChanged = previousEmployee && Math.abs(previousEmployee.hourlyRate - employee.hourlyRate) > 0.0001;
  const recalculatePast = rateChanged ? await askRateRecalculation(previousEmployee, employee.hourlyRate) : false;
  try {
    if (localMode) {
      const index = employees.findIndex((item) => item.id === employee.id);
      employees[index] = employee;
      if (recalculatePast) {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - 2);
        timeEntries.forEach((entry) => {
          if (entry.employeeId === employee.id && new Date(entry.clockIn) >= cutoff) entry.hourlyRate = employee.hourlyRate;
        });
      }
      persistLocalTimeTracking();
    } else {
      await CloudStore.saveEmployee(currentLocationId, employee, recalculatePast);
      await reloadTimeTracking();
    }
    renderTimeTracking();
    showToast("Mitarbeiter gespeichert");
  } catch (error) {
    showToast(error.message || "Mitarbeiter konnte nicht gespeichert werden");
  }
}

async function removeEmployee(employeeId) {
  if (!isAdminUser()) return;
  const employee = employeeForTime(employeeId);
  if (!employee) return;
  const entryCount = timeEntries.filter((entry) => entry.employeeId === employeeId).length;
  const bonusCount = employeeBonuses.filter((bonus) => bonus.employeeId === employeeId).length;
  const openEntry = timeEntries.some((entry) => entry.employeeId === employeeId && !entry.clockOut);
  const warning = [
    `Mitarbeiter „${employee.name}“ wirklich entfernen?`,
    entryCount || bonusCount
      ? `Dabei werden ${entryCount} Stempelzeit(en) und ${bonusCount} Bonus-Eintrag/Einträge dieses Mitarbeiters gelöscht.`
      : "Es sind keine Stempelzeiten oder Boni für diesen Mitarbeiter vorhanden.",
    openEntry ? "Der Mitarbeiter ist aktuell eingestempelt." : "",
    "Wenn du die Historie behalten möchtest, deaktiviere den Mitarbeiter stattdessen."
  ].filter(Boolean).join("\n\n");
  if (!confirm(warning)) return;
  try {
    if (localMode) {
      employees = employees.filter((item) => item.id !== employeeId);
      timeEntries = timeEntries.filter((entry) => entry.employeeId !== employeeId);
      employeeBonuses = employeeBonuses.filter((bonus) => bonus.employeeId !== employeeId);
      persistLocalTimeTracking();
    } else {
      await CloudStore.deleteEmployee(employeeId);
      await reloadTimeTracking();
    }
    renderTimeTracking();
    showToast("Mitarbeiter wurde entfernt");
  } catch (error) {
    showToast(error.message || "Mitarbeiter konnte nicht entfernt werden");
  }
}

async function addManualTimeEntry(event) {
  event.preventDefault();
  const startDateKey = $("#manualDateInput").value;
  const endDateKey = $("#manualEndDateInput").value;
  const start = new Date(`${startDateKey}T${$("#manualStartInput").value}`);
  const end = new Date(`${endDateKey}T${$("#manualEndInput").value}`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    showToast("Endzeit muss nach der Startzeit liegen");
    return;
  }
  const entry = {
    id: uid("time"),
    employeeId: $("#manualEmployeeSelect").value,
    locationId: currentLocationId,
    hourlyRate: Number(employeeForTime($("#manualEmployeeSelect").value)?.hourlyRate || 0),
    clockIn: start.toISOString(),
    clockOut: end.toISOString()
  };
  try {
    if (localMode) {
      timeEntries.unshift(entry);
      persistLocalTimeTracking();
    } else {
      await CloudStore.addTimeEntry(currentLocationId, entry);
      await reloadTimeTracking();
    }
    renderTimeTracking();
    showToast("Stempelzeit wurde hinzugefügt");
  } catch (error) {
    showToast(error.message || "Stempelzeit konnte nicht gespeichert werden");
  }
}

function toLocalDateAndTime(value) {
  if (!value) return { date: "", time: "" };
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { date: "", time: "" };
  const part = (number) => String(number).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`,
    time: `${part(date.getHours())}:${part(date.getMinutes())}:${part(date.getSeconds())}`
  };
}

function openTimeEntryEditor(entryId) {
  const entry = timeEntries.find((item) => item.id === entryId);
  if (!entry || !isAdminUser()) return;
  $("#timeEntryEditId").value = entry.id;
  $("#timeEntryEmployeeInput").innerHTML = employeeOptions(true);
  $("#timeEntryEmployeeInput").value = entry.employeeId;
  $("#timeEntryLocationInput").innerHTML = locations.map((location) =>
    `<option value="${location.id}">${escapeHtml(location.name)}</option>`
  ).join("");
  $("#timeEntryLocationInput").value = locations.some((location) => location.id === entry.locationId)
    ? entry.locationId
    : currentLocationId;
  const start = toLocalDateAndTime(entry.clockIn);
  const end = toLocalDateAndTime(entry.clockOut);
  $("#timeEntryStartDateInput").value = start.date;
  $("#timeEntryStartTimeInput").value = start.time;
  $("#timeEntryEndDateInput").value = end.date;
  $("#timeEntryEndTimeInput").value = end.time;
  $("#timeEntryDialog").showModal();
}

async function saveEditedTimeEntry(event) {
  event.preventDefault();
  const existing = timeEntries.find((entry) => entry.id === $("#timeEntryEditId").value);
  if (!existing) return;
  const employeeId = $("#timeEntryEmployeeInput").value;
  const startDate = $("#timeEntryStartDateInput").value;
  const startTime = $("#timeEntryStartTimeInput").value;
  const endDate = $("#timeEntryEndDateInput").value;
  const endTime = $("#timeEntryEndTimeInput").value;
  const start = new Date(`${startDate}T${startTime}`);
  const hasEnd = Boolean(endDate || endTime);
  const end = endDate && endTime ? new Date(`${endDate}T${endTime}`) : null;
  if (hasEnd && (!endDate || !endTime)) {
    showToast("Bitte Enddatum und Enduhrzeit vollständig eingeben");
    return;
  }
  if (!employeeId || !Number.isFinite(start.getTime()) || (end && (!Number.isFinite(end.getTime()) || end <= start))) {
    showToast("Endzeit muss nach der Startzeit liegen");
    return;
  }
  const entry = {
    ...existing,
    employeeId,
    locationId: $("#timeEntryLocationInput").value,
    hourlyRate: employeeId === existing.employeeId
      ? Number(existing.hourlyRate ?? employeeForTime(employeeId)?.hourlyRate ?? 0)
      : Number(employeeForTime(employeeId)?.hourlyRate || 0),
    clockIn: start.toISOString(),
    clockOut: end ? end.toISOString() : null
  };
  try {
    if (localMode) {
      const index = timeEntries.findIndex((item) => item.id === entry.id);
      timeEntries[index] = entry;
      persistLocalTimeTracking();
    } else {
      await CloudStore.updateTimeEntry(entry);
      await reloadTimeTracking();
    }
    $("#timeEntryDialog").close();
    renderTimeTracking();
    showToast("Stempelzeit wurde aktualisiert");
  } catch (error) {
    showToast(error.message || "Stempelzeit konnte nicht aktualisiert werden");
  }
}

async function removeTimeEntry(entryId) {
  if (!confirm("Diese Stempelzeit wirklich löschen?")) return;
  try {
    if (localMode) {
      timeEntries = timeEntries.filter((entry) => entry.id !== entryId);
      persistLocalTimeTracking();
    } else {
      await CloudStore.deleteTimeEntry(currentLocationId, entryId);
      await reloadTimeTracking();
    }
    renderTimeTracking();
    showToast("Stempelzeit gelöscht");
  } catch (error) {
    showToast(error.message || "Stempelzeit konnte nicht gelöscht werden");
  }
}

async function saveEmployeeBonus(event) {
  event.preventDefault();
  const bonus = {
    id: uid("bonus"),
    employeeId: $("#bonusEmployeeSelect").value,
    dateKey: $("#bonusDateInput").value,
    amount: Number($("#bonusAmountInput").value),
    note: $("#bonusNoteInput").value.trim()
  };
  if (!bonus.employeeId || !bonus.dateKey || !Number.isFinite(bonus.amount) || bonus.amount < 0) return;
  try {
    if (localMode) {
      const existing = employeeBonuses.find((item) => item.employeeId === bonus.employeeId && item.dateKey === bonus.dateKey);
      if (existing) Object.assign(existing, bonus, { id: existing.id });
      else employeeBonuses.push(bonus);
      persistLocalTimeTracking();
    } else {
      await CloudStore.saveBonus(currentLocationId, bonus);
      await reloadTimeTracking();
    }
    renderTimeTracking();
    showToast("Tagesbonus gespeichert");
  } catch (error) {
    showToast(error.message || "Bonus konnte nicht gespeichert werden");
  }
}

async function removeBonus(bonusId) {
  if (!confirm("Diesen Tagesbonus wirklich löschen?")) return;
  try {
    if (localMode) {
      employeeBonuses = employeeBonuses.filter((bonus) => bonus.id !== bonusId);
      persistLocalTimeTracking();
    } else {
      await CloudStore.deleteBonus(currentLocationId, bonusId);
      await reloadTimeTracking();
    }
    renderTimeTracking();
    showToast("Bonus gelöscht");
  } catch (error) {
    showToast(error.message || "Bonus konnte nicht gelöscht werden");
  }
}

function exportTimeReport() {
  if (!isAdminUser()) return;
  const { from, to } = timeRange();
  const aggregated = aggregateTimeTracking();
  const detailRows = [];
  timeEntries.forEach((entry) => {
    const dateKey = localDateKey(new Date(entry.clockIn));
    if (dateKey < from || dateKey > to) return;
    const hours = entryDurationHours(entry);
    const hourlyRate = Number(entry.hourlyRate ?? employeeForTime(entry.employeeId)?.hourlyRate ?? 0);
    const employeeName = employeeForTime(entry.employeeId)?.name || "Unbekannt";
    detailRows.push({
      employeeId: entry.employeeId,
      dateLabel: formatDateKey(dateKey),
      employeeName,
      locationName: locationNameForTime(entry.locationId),
      clockInLabel: formatDateTime(entry.clockIn),
      clockOutLabel: formatDateTime(entry.clockOut),
      hours,
      hourlyRate,
      wages: hours * hourlyRate,
      open: !entry.clockOut
    });
  });
  const payload = {
    locationName: "Alle Standorte",
    periodLabel: `${formatDateKey(from)} bis ${formatDateKey(to)}`,
    dailyRows: aggregated.dailyRows.map((row) => ({ ...row, dateLabel: formatDateKey(row.dateKey) })),
    employeeRows: aggregated.employeeRows,
    employees: employees.map((employee) => ({ id: employee.id, name: employee.name })),
    detailRows,
    totals: aggregated.totals
  };
  XlsxExport.downloadTimeWorkbook(payload, `Arbeitszeit_${from}_${to}.xlsx`);
  showToast("Arbeitszeit-Excel wurde erstellt");
}

function setSettingsTab(tab) {
  $$(".settings-tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  $("#categoriesTab").classList.toggle("hidden", tab !== "categories");
  $("#productsTab").classList.toggle("hidden", tab !== "products");
  $("#generalTab").classList.toggle("hidden", tab !== "general");
  if (tab === "general" && isAdminUser()) reloadTimeTracking();
}

function renderSettings() {
  $("#settingsCategoryCount").textContent = data.categories.length;
  $("#settingsProductCount").textContent = data.products.length;
  $("#categorySettingsList").innerHTML = data.categories.length ? data.categories.map((category) => {
    const count = data.products.filter((product) => product.categoryId === category.id).length;
    return `<div class="settings-row" draggable="true" data-category-id="${category.id}">
      <span class="settings-swatch" style="background:${category.color}">${escapeHtml(category.name.charAt(0).toUpperCase())}</span>
      <strong>${escapeHtml(category.name)}</strong>
      <span class="settings-meta">${count} Artikel · ${category.hidden ? "ausgeblendet" : "sichtbar"}</span>
      <div class="row-actions">
        <button class="row-action visibility toggle-category" data-id="${category.id}">${category.hidden ? "Einblenden" : "Ausblenden"}</button>
        <button class="row-action copy copy-category" data-id="${category.id}">Kopieren</button>
        <button class="row-action edit-category" data-id="${category.id}">Bearbeiten</button>
        <button class="row-action delete delete-category" data-id="${category.id}">Löschen</button>
      </div>
    </div>`;
  }).join("") : `<div class="list-empty">Noch keine Kategorien vorhanden.</div>`;

  $$(".toggle-category").forEach((button) => button.addEventListener("click", () => {
    const category = categoryFor(button.dataset.id);
    category.hidden = !category.hidden;
    persist();
    renderAll();
  }));
  $("#productSettingsList").innerHTML = data.products.length ? data.products.map((product) => {
    const category = categoryFor(product.categoryId) || { name: "Ohne Kategorie", color: "#777" };
    return `<div class="settings-row">
      <span class="settings-swatch" style="background:${category.color}">${escapeHtml(product.name.charAt(0).toUpperCase())}</span>
      <strong>${escapeHtml(product.name)}</strong>
      <span class="settings-meta">${escapeHtml(category.name)} · ${euro(product.price)}</span>
      <div class="row-actions">
        <button class="row-action copy copy-product" data-id="${product.id}">Kopieren</button>
        <button class="row-action edit-product" data-id="${product.id}">Bearbeiten</button>
        <button class="row-action delete delete-product" data-id="${product.id}">Löschen</button>
      </div>
    </div>`;
  }).join("") : `<div class="list-empty">Noch keine Artikel vorhanden.</div>`;

  $$(".copy-category").forEach((button) => button.addEventListener("click", () => openEditor("category", null, button.dataset.id)));
  $$(".edit-category").forEach((button) => button.addEventListener("click", () => openEditor("category", button.dataset.id)));
  $$(".delete-category").forEach((button) => button.addEventListener("click", () => deleteCategory(button.dataset.id)));
  $$(".copy-product").forEach((button) => button.addEventListener("click", () => openEditor("product", null, button.dataset.id)));
  $$(".edit-product").forEach((button) => button.addEventListener("click", () => openEditor("product", button.dataset.id)));
  $$(".delete-product").forEach((button) => button.addEventListener("click", () => deleteProduct(button.dataset.id)));
  setupCategoryDragAndDrop();
  $("#themeSelect").value = appSettings.theme || "dark";
  $("#startCategorySelect").innerHTML = `<option value="first">Erste sichtbare Kategorie</option>${visibleCategories().map((category) =>
    `<option value="${category.id}">${escapeHtml(category.name)}</option>`
  ).join("")}`;
  $("#startCategorySelect").value = visibleCategories().some((category) => category.id === appSettings.startCategoryId)
    ? appSettings.startCategoryId
    : "first";
  $("#billingModeSelect").value = appSettings.billingMode || "separate";
  $("#billingEmailInput").value = appSettings.billingEmail || "";
  $("#billingEmail2Input").value = appSettings.billingEmail2 || "";
  $("#currentUserLabel").textContent = localMode ? "Lokaler Testmodus" : (currentUserEmail || "Supabase-Konto aktiv");
  renderLocationAdministration();
  renderEmployeeAdministration();
}

function renderLocationAdministration() {
  const list = $("#locationAdminList");
  if (!list) return;
  list.innerHTML = locations.map((location) => {
    const canDelete = locations.length > 1 && isAdminUser();
    return `<div class="location-admin-row" data-id="${location.id}">
      <input class="location-edit-name" value="${escapeHtml(location.name)}" aria-label="Standortname">
      ${location.id === currentLocationId ? "<small>Aktuell</small>" : ""}
      <button class="secondary-button save-location-name" data-id="${location.id}">Speichern</button>
      <button class="danger-button delete-location" data-id="${location.id}" ${canDelete ? "" : "disabled"}>Löschen</button>
    </div>`;
  }).join("");
  $$(".save-location-name").forEach((button) => button.addEventListener("click", () => updateLocationName(button.dataset.id)));
  $$(".delete-location").forEach((button) => button.addEventListener("click", () => deleteLocation(button.dataset.id)));
}

function setupCategoryDragAndDrop() {
  let draggedId = null;
  $$("#categorySettingsList .settings-row").forEach((row) => {
    row.addEventListener("dragstart", () => {
      draggedId = row.dataset.categoryId;
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      $$(".drop-target").forEach((item) => item.classList.remove("drop-target"));
    });
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      row.classList.add("drop-target");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      const targetId = row.dataset.categoryId;
      if (!draggedId || draggedId === targetId) return;
      const from = data.categories.findIndex((category) => category.id === draggedId);
      const to = data.categories.findIndex((category) => category.id === targetId);
      const [moved] = data.categories.splice(from, 1);
      data.categories.splice(to, 0, moved);
      persist();
      renderAll();
    });
  });
}

function openEditor(type, id = null, copySourceId = null) {
  editor = { type, id, color: COLORS[0], copySourceId };
  const isCategory = type === "category";
  const isCopy = Boolean(copySourceId);
  $("#categoryFields").classList.toggle("hidden", !isCategory);
  $("#productFields").classList.toggle("hidden", isCategory);
  $("#dialogEyebrow").textContent = isCopy ? "KOPIEREN" : (id ? "BEARBEITEN" : "NEU ANLEGEN");
  $("#dialogTitle").textContent = isCategory
    ? (isCopy ? "Kategorie kopieren" : (id ? "Kategorie bearbeiten" : "Neue Kategorie"))
    : (isCopy ? "Artikel kopieren" : (id ? "Artikel bearbeiten" : "Neuer Artikel"));

  if (isCategory) {
    const category = id ? categoryFor(id) : (copySourceId ? categoryFor(copySourceId) : null);
    $("#categoryNameInput").value = isCopy ? `${category.name} (Kopie)` : (category?.name || "");
    editor.color = category?.color || COLORS[0];
    renderColorPicker();
  } else {
    if (!data.categories.length) {
      showToast("Lege zuerst eine Kategorie an");
      setSettingsTab("categories");
      return;
    }
    const sourceId = id || copySourceId;
    const product = sourceId ? data.products.find((item) => item.id === sourceId) : null;
    $("#productNameInput").value = product?.name || "";
    $("#productPriceInput").value = product?.price ?? "";
    $("#productCategoryInput").innerHTML = data.categories.map((category) =>
      `<option value="${category.id}">${escapeHtml(category.name)}</option>`
    ).join("");
    $("#productCategoryInput").value = product?.categoryId || data.categories[0].id;
  }
  $("#editorDialog").showModal();
  setTimeout(() => (isCategory ? $("#categoryNameInput") : $("#productNameInput")).focus(), 50);
}

function renderColorPicker() {
  $("#colorPicker").innerHTML = COLORS.map((color) =>
    `<button type="button" class="color-option ${editor.color === color ? "selected" : ""}" style="background:${color}" data-color="${color}" aria-label="Farbe ${color}"></button>`
  ).join("");
  $$(".color-option").forEach((button) => button.addEventListener("click", () => {
    editor.color = button.dataset.color;
    renderColorPicker();
  }));
}

function saveEditor(event) {
  event.preventDefault();
  if (editor.type === "category") {
    const name = $("#categoryNameInput").value.trim();
    if (!name) return $("#categoryNameInput").focus();
    if (editor.id) Object.assign(categoryFor(editor.id), { name, color: editor.color });
    else {
      const newCategory = { id: uid("cat"), name, color: editor.color };
      data.categories.push(newCategory);
      if (editor.copySourceId) {
        const copiedProducts = data.products
          .filter((product) => product.categoryId === editor.copySourceId)
          .map((product) => ({ ...product, id: uid("product"), categoryId: newCategory.id }));
        data.products.push(...copiedProducts);
      }
    }
  } else {
    const name = $("#productNameInput").value.trim();
    const price = Number($("#productPriceInput").value);
    const categoryId = $("#productCategoryInput").value;
    if (!name) return $("#productNameInput").focus();
    if (!Number.isFinite(price) || price < 0) return $("#productPriceInput").focus();
    const values = { name, price, categoryId };
    if (editor.id) Object.assign(data.products.find((item) => item.id === editor.id), values);
    else data.products.push({ id: uid("product"), ...values });
  }
  persist();
  $("#editorDialog").close();
  renderAll();
  showToast(editor.copySourceId ? "Kopie wurde erstellt" : "Änderungen gespeichert");
}

function deleteCategory(id) {
  const category = categoryFor(id);
  const productCount = data.products.filter((product) => product.categoryId === id).length;
  const message = productCount
    ? `„${category.name}“ und ${productCount} zugehörige Artikel wirklich löschen?`
    : `Kategorie „${category.name}“ wirklich löschen?`;
  if (!confirm(message)) return;
  data.categories = data.categories.filter((item) => item.id !== id);
  data.products = data.products.filter((product) => product.categoryId !== id);
  if (selectedCategory === id) selectedCategory = "all";
  persist();
  renderAll();
  showToast("Kategorie gelöscht");
}

function deleteProduct(id) {
  const product = data.products.find((item) => item.id === id);
  if (!confirm(`Artikel „${product.name}“ wirklich löschen?`)) return;
  data.products = data.products.filter((item) => item.id !== id);
  cart = cart.filter((item) => item.productId !== id);
  persist();
  renderAll();
  showToast("Artikel gelöscht");
}

async function importExcelFile(file) {
  if (!globalThis.XLSX) throw new Error("Excel-Bibliothek ist offline noch nicht verfügbar.");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  if (matrix.length < 2 || matrix[0].length < 2) throw new Error("Die Excelmatrix enthält keine Kategorien oder Artikel.");
  const importedCategories = matrix[0].slice(1).map((name, index) => ({
    id: uid("cat"),
    name: String(name).trim(),
    color: COLORS[index % COLORS.length],
    hidden: false
  })).filter((category) => category.name);
  const importedProducts = [];
  matrix.slice(1).forEach((row) => {
    const name = String(row[0] || "").trim();
    if (!name) return;
    importedCategories.forEach((category, index) => {
      const rawPrice = row[index + 1];
      if (rawPrice === "" || rawPrice === null || rawPrice === undefined) return;
      const price = Number(String(rawPrice).replace(",", "."));
      if (!Number.isFinite(price) || price < 0) return;
      importedProducts.push({ id: uid("product"), name, price, categoryId: category.id });
    });
  });
  if (!importedProducts.length) throw new Error("Keine gültigen Preise gefunden.");
  if (!confirm(`${importedCategories.length} Kategorien und ${importedProducts.length} Artikel importieren? Das Sortiment wird an allen Standorten ersetzt.`)) return;
  data = { categories: importedCategories, products: importedProducts };
  clearTimeout(cloudSaveTimer);
  if (localMode) {
    locations.forEach((location) => {
      const key = location.id === "local" ? "kassenraum-data" : `kassenraum-data:${location.id}`;
      localStorage.setItem(key, JSON.stringify(data));
    });
    renderAll();
    showToast(`Excel-Sortiment wurde für alle ${locations.length} Standorte übernommen`);
  } else {
    const locationIds = locations.filter((location) => location.role === "admin").map((location) => location.id);
    const result = await CloudStore.saveCatalogToLocations(locationIds, data);
    localStorage.setItem(scopedKey("kassenraum-data"), JSON.stringify(data));
    renderAll();
    showToast(result?.queued
      ? "Excel-Sortiment gespeichert – alle Standorte werden nach Verbindung synchronisiert"
      : `Excel-Sortiment wurde für alle Benutzer an ${locationIds.length} Standorten übernommen`);
  }
}

function selectedAdminExcelSections() {
  return {
    catalog: $("#excelCatalogCheckbox")?.checked !== false,
    employees: $("#excelEmployeesCheckbox")?.checked === true
  };
}

function parseCatalogMatrix(matrix) {
  if (matrix.length < 2 || matrix[0].length < 2) throw new Error("Die Excelmatrix enthält keine Kategorien oder Artikel.");
  const importedCategories = matrix[0].slice(1).map((name, index) => ({
    id: uid("cat"),
    name: String(name).trim(),
    color: COLORS[index % COLORS.length],
    hidden: false
  })).filter((category) => category.name);
  const importedProducts = [];
  matrix.slice(1).forEach((row) => {
    const name = String(row[0] || "").trim();
    if (!name) return;
    importedCategories.forEach((category, index) => {
      const rawPrice = row[index + 1];
      if (rawPrice === "" || rawPrice === null || rawPrice === undefined) return;
      const price = Number(String(rawPrice).replace(",", "."));
      if (!Number.isFinite(price) || price < 0) return;
      importedProducts.push({ id: uid("product"), name, price, categoryId: category.id });
    });
  });
  if (!importedProducts.length) throw new Error("Keine gültigen Preise gefunden.");
  return { categories: importedCategories, products: importedProducts };
}

async function applyCatalogImport(importedData) {
  data = importedData;
  clearTimeout(cloudSaveTimer);
  if (localMode) {
    locations.forEach((location) => localStorage.setItem(scopedKeyFor("kassenraum-data", location.id), JSON.stringify(data)));
    renderAll();
    return `Sortiment wurde für alle ${locations.length} Standorte übernommen`;
  }
  const locationIds = locations.filter((location) => location.role === "admin").map((location) => location.id);
  const result = await CloudStore.saveCatalogToLocations(locationIds, data);
  localStorage.setItem(scopedKey("kassenraum-data"), JSON.stringify(data));
  renderAll();
  return result?.queued
    ? "Sortiment gespeichert – alle Standorte werden nach Verbindung synchronisiert"
    : `Sortiment wurde für alle Benutzer an ${locationIds.length} Standorten übernommen`;
}

function parseEmployeeRows(sheet) {
  if (!sheet) throw new Error("Das Blatt „Mitarbeiter“ wurde nicht gefunden.");
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  const rows = matrix.slice(1).map((row) => {
    const name = String(row[0] || "").trim();
    const hourlyRate = Number(String(row[1] || "0").replace(",", "."));
    const activeText = String(row[2] ?? "ja").trim().toLowerCase();
    return {
      name,
      hourlyRate,
      active: !["nein", "no", "false", "0", "inaktiv"].includes(activeText)
    };
  }).filter((employee) => employee.name && Number.isFinite(employee.hourlyRate) && employee.hourlyRate >= 0);
  if (!rows.length) throw new Error("Keine gültigen Mitarbeiter im Blatt „Mitarbeiter“ gefunden.");
  return rows;
}

async function applyEmployeeImport(importedEmployees) {
  if (localMode) {
    importedEmployees.forEach((employee) => {
      const existing = employees.find((item) => item.name.toLowerCase() === employee.name.toLowerCase());
      if (existing) Object.assign(existing, employee);
      else employees.push({ ...employee, id: uid("employee") });
    });
    persistLocalTimeTracking();
  } else {
    for (const employee of importedEmployees) {
      const existing = employees.find((item) => item.name.toLowerCase() === employee.name.toLowerCase());
      await CloudStore.saveEmployee(currentLocationId, existing ? { ...employee, id: existing.id } : employee);
    }
    await reloadTimeTracking();
  }
  renderTimeTracking();
  return `${importedEmployees.length} Mitarbeiter wurden übernommen`;
}

function adminSyncLocationIds() {
  const adminLocations = locations.filter((location) => String(location.role || "").toLowerCase() === "admin");
  return (adminLocations.length ? adminLocations : locations).map((location) => location.id);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

async function syncMasterDataToUsers() {
  if (!isAdminUser()) {
    showToast("Nur Administratoren können Stammdaten synchronisieren.");
    return;
  }
  if (!confirm("Aktuelle Kategorien, Artikel und Mitarbeiter jetzt an alle User/Staff und Standorte übertragen?")) return;

  const button = $("#syncMasterDataButton");
  const originalText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "Synchronisiere …";
  }

  try {
    clearTimeout(cloudSaveTimer);
    if (localMode) {
      locations.forEach((location) => {
        localStorage.setItem(scopedKeyFor("kassenraum-data", location.id), JSON.stringify(data));
      });
      persistLocalTimeTracking();
      renderAll();
      renderTimeTracking();
      showToast(`Stammdaten wurden lokal an ${locations.length} Standorte synchronisiert`);
      return;
    }

    try {
      await CloudStore.syncLocationMemberships();
      locations = normalizeLocationList(await CloudStore.locations());
    } catch (_) {}
    const locationIds = adminSyncLocationIds();
    if (!locationIds.length) throw new Error("Keine Standorte zum Synchronisieren gefunden.");
    const catalogResult = await CloudStore.syncMasterData(data, employees, locationIds, currentLocationId);
    localStorage.setItem(scopedKey("kassenraum-data"), JSON.stringify(data));
    await reloadTimeTracking();
    renderAll();
    showToast(catalogResult?.queued
      ? "Stammdaten gespeichert – Sync wird bei Verbindung fortgesetzt"
      : `Kategorien, Artikel und MA wurden ${catalogResult?.allLocations ? "an allen Standorten" : `an ${locationIds.length} Standorten`} überschrieben`);
  } catch (error) {
    showToast(error.message || "Stammdaten konnten nicht synchronisiert werden");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function exportAdminExcel() {
  if (!globalThis.XLSX) {
    showToast("Excel-Bibliothek ist offline noch nicht verfügbar.");
    return;
  }
  const sections = selectedAdminExcelSections();
  if (!sections.catalog && !sections.employees) {
    showToast("Bitte mindestens einen Bereich auswählen.");
    return;
  }
  const workbook = XLSX.utils.book_new();
  if (sections.catalog) {
    const categories = data.categories;
    const productNames = [];
    const seenProductNames = new Set();
    data.products.forEach((product) => {
      const key = String(product.name || "").trim().toLocaleLowerCase("de");
      if (!key || seenProductNames.has(key)) return;
      seenProductNames.add(key);
      productNames.push(product.name);
    });
    const matrix = [["Artikel", ...categories.map((category) => category.name)]];
    productNames.forEach((name) => {
      const row = [name];
      categories.forEach((category) => {
        const product = data.products.find((item) => item.name === name && item.categoryId === category.id);
        row.push(product ? Number(product.price) : "");
      });
      matrix.push(row);
    });
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(matrix), "Sortiment");
  }
  if (sections.employees) {
    const employeeRows = [["Name", "Stundensatz", "Aktiv"], ...employees.map((employee) => [
      employee.name,
      Number(employee.hourlyRate || 0),
      employee.active === false ? "nein" : "ja"
    ])];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(employeeRows), "Mitarbeiter");
  }
  XLSX.writeFile(workbook, `Kassenraum_Einstellungen_${localDateKey(new Date())}.xlsx`);
  showToast("Einstellungen wurden als Excel exportiert");
}

function protectWorkbookSheets(workbook, password = "Knusperhaus2026#") {
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    sheet["!protect"] = {
      password,
      selectLockedCells: false,
      selectUnlockedCells: false,
      formatCells: false,
      formatColumns: false,
      formatRows: false,
      insertColumns: false,
      insertRows: false,
      deleteColumns: false,
      deleteRows: false,
      sort: false,
      autoFilter: false,
      pivotTables: false
    };
  });
  return workbook;
}

function buildRevenueBackupWorkbook(backupSales, backupCashBalances, locationName) {
  const workbook = XLSX.utils.book_new();
  const createdAt = new Date();
  const summary = aggregateSales(backupSales);
  const summaryRows = [
    ["Umsatzbackup", ""],
    ["Erstellt am", createdAt.toLocaleString("de-AT")],
    ["Standort", locationName],
    ["Passwort", "Knusperhaus2026#"],
    ["Hinweis", "Excel-Blattschutz/Arbeitsmappenschutz; Datei bitte zusätzlich sicher ablegen."],
    ["Belege", backupSales.length],
    ["Artikel gesamt", summary.itemCount],
    ["0-€ Artikel", summary.freeCount],
    ["Umsatz", summary.revenue]
  ];
  const saleRows = [["Beleg-ID", "Datum/Uhrzeit", "Datum", "Standort", "Gesamtbetrag", "Artikelanzahl"]];
  const itemRows = [["Beleg-ID", "Datum/Uhrzeit", "Artikel", "Kategorie", "Preis", "Anzahl", "Gesamtbetrag", "Status", "Storniert am"]];
  backupSales.forEach((sale) => {
    const timestamp = new Date(sale.timestamp);
    const itemCount = activeSaleItems(sale).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    saleRows.push([
      sale.id || "",
      Number.isFinite(timestamp.getTime()) ? timestamp.toLocaleString("de-AT") : String(sale.timestamp || ""),
      Number.isFinite(timestamp.getTime()) ? localDateKey(timestamp) : "",
      sale.locationName || locationName,
      Number(sale.total || 0),
      itemCount
    ]);
    (sale.items || []).forEach((item) => {
      const canceled = isReceiptItemCanceled(item);
      itemRows.push([
        sale.id || "",
        Number.isFinite(timestamp.getTime()) ? timestamp.toLocaleString("de-AT") : String(sale.timestamp || ""),
        item.name || "",
        item.categoryName || "Ohne Kategorie",
        Number(item.price || 0),
        Number(item.quantity || 0),
        canceled ? 0 : Number(item.price || 0) * Number(item.quantity || 0),
        canceled ? "storniert" : "aktiv",
        item.canceledAt || ""
      ]);
    });
  });
  const cashRows = [["Datum", "Kassenstand"]];
  Object.entries(backupCashBalances || {}).sort(([a], [b]) => a.localeCompare(b)).forEach(([dateKey, balance]) => {
    cashRows.push([dateKey, Number(balance || 0)]);
  });
  const sheets = [
    ["Zusammenfassung", summaryRows],
    ["Belege", saleRows],
    ["Positionen", itemRows],
    ["Kassenstände", cashRows]
  ];
  sheets.forEach(([sheetName, rows]) => {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = rows[0].map((_, index) => ({ wch: index === 0 ? 28 : 18 }));
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  });
  return protectWorkbookSheets(workbook);
}

function downloadRevenueBackup(backupSales = sales, backupCashBalances = cashBalances) {
  if (!globalThis.XLSX) throw new Error("Excel-Bibliothek ist offline noch nicht verfügbar.");
  const locationName = locations.find((location) => location.id === currentLocationId)?.name || "Standort";
  const workbook = buildRevenueBackupWorkbook(backupSales, backupCashBalances, locationName);
  const filename = `Umsatzbackup_${locationName.replace(/[\\/:*?"<>|]+/g, "_")}_${localDateKey(new Date())}.xlsx`;
  XLSX.writeFile(workbook, filename, { compression: true, cellStyles: true });
}

async function importExcelFile(file) {
  if (!globalThis.XLSX) throw new Error("Excel-Bibliothek ist offline noch nicht verfügbar.");
  const sections = selectedAdminExcelSections();
  if (!sections.catalog && !sections.employees) throw new Error("Bitte mindestens einen Bereich auswählen.");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const messages = [];
  let importedCatalog = null;
  let importedEmployees = null;
  if (sections.catalog) {
    const sheet = workbook.Sheets.Sortiment || workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
    importedCatalog = parseCatalogMatrix(matrix);
  }
  if (sections.employees) importedEmployees = parseEmployeeRows(workbook.Sheets.Mitarbeiter);
  const confirmationParts = [];
  if (importedCatalog) confirmationParts.push(`${importedCatalog.categories.length} Kategorien und ${importedCatalog.products.length} Artikel`);
  if (importedEmployees) confirmationParts.push(`${importedEmployees.length} Mitarbeiter/Stundensätze`);
  if (!confirm(`${confirmationParts.join(" sowie ")} importieren? Sortiment wird an allen verwalteten Standorten ersetzt; Mitarbeiter werden hinzugefügt oder aktualisiert.`)) return;
  if (importedCatalog) messages.push(await applyCatalogImport(importedCatalog));
  if (importedEmployees) messages.push(await applyEmployeeImport(importedEmployees));
  renderAll();
  showToast(messages.join(" · "));
}

async function updateLocationName(locationId) {
  const location = locations.find((entry) => entry.id === locationId);
  const row = $(`.location-admin-row[data-id="${locationId}"]`);
  const name = row?.querySelector(".location-edit-name")?.value.trim();
  if (!location || !name || name === location.name) return;
  try {
    if (localMode) {
      location.name = name;
      localStorage.setItem("kassenraum-local-locations", JSON.stringify(locations));
    } else {
      await CloudStore.updateLocation(locationId, name);
      locations = normalizeLocationList(await CloudStore.locations());
    }
    renderAll();
    showToast("Standortname wurde gespeichert");
  } catch (error) {
    showToast(error.message || "Standortname konnte nicht gespeichert werden");
  }
}

async function deleteLocation(locationId) {
  const location = locations.find((entry) => entry.id === locationId);
  if (!location || locations.length < 2) {
    showToast("Der letzte Standort kann nicht gelöscht werden");
    return;
  }
  if (!confirm(`Standort „${location.name}“ wirklich löschen? Sortiment, Umsätze und Kassenstände dieses Standorts werden unwiderruflich entfernt.`)) return;

  try {
    if (localMode) {
      const storageBases = [
        "kassenraum-data", "kassenraum-settings", "kassenraum-sales", "kassenraum-cash-balances",
        "kassenraum-employees", "kassenraum-time-entries", "kassenraum-employee-bonuses"
      ];
      storageBases.forEach((base) => localStorage.removeItem(locationId === "local" ? base : `${base}:${locationId}`));
      locations = locations.filter((entry) => entry.id !== locationId);
      localStorage.setItem("kassenraum-local-locations", JSON.stringify(locations));
    } else {
      await CloudStore.deleteLocation(locationId);
      locations = normalizeLocationList(await CloudStore.locations());
    }

    if (currentLocationId === locationId) {
      await switchLocation(locations[0].id);
    } else {
      renderAll();
    }
    showToast("Standort wurde gelöscht");
  } catch (error) {
    showToast(error.message || "Standort konnte nicht gelöscht werden");
  }
}

async function deleteRevenueData() {
  if (!confirm("Alle Umsatzdaten und Kassenstände dieses Standorts unwiderruflich löschen?")) return;
  if (!localMode) await CloudStore.deleteSales(currentLocationId);
  sales = [];
  cashBalances = {};
  persistSales();
  persistCashBalances();
  renderReport();
  showToast("Umsatzdaten wurden gelöscht");
}

async function resetTimeTrackingData() {
  if (!isAdminUser()) return;
  if (!confirm("Alle Stempelzeiten und Tagesboni unwiderruflich löschen? Mitarbeiter und Stundensätze bleiben erhalten.")) return;
  try {
    if (!localMode) await CloudStore.deleteTimeTracking();
    timeEntries = [];
    employeeBonuses = [];
    persistLocalTimeTracking();
    renderTimeTracking();
    showToast("Zeiterfassung wurde zurückgesetzt");
  } catch (error) {
    showToast(error.message || "Zeiterfassung konnte nicht zurückgesetzt werden");
  }
}

async function deleteRevenueData() {
  if (!isAdminUser()) return;
  if (!sales.length && !Object.keys(cashBalances).length) {
    showToast("Keine Umsatzdaten für ein Backup vorhanden");
    return;
  }
  if (!confirm("Vor dem Löschen muss ein Umsatzbackup erstellt werden. Sämtliche Umsatzdaten jetzt downloaden?")) return;
  try {
    downloadRevenueBackup();
  } catch (error) {
    showToast(error.message || "Umsatzbackup konnte nicht erstellt werden");
    return;
  }
  if (!confirm("Backup wurde zum Download angeboten. Umsatzdaten und Kassenstände dieses Standorts jetzt unwiderruflich löschen?")) return;
  try {
    if (!localMode) await CloudStore.deleteSales(currentLocationId);
    else {
      submittedReports = readStoredJson("kassenraum-submitted-reports", [])
        .filter((report) => String(report.locationId) !== String(currentLocationId));
      localStorage.setItem("kassenraum-submitted-reports", JSON.stringify(submittedReports));
    }
    sales = [];
    cashBalances = {};
    persistSales();
    persistCashBalances();
    await refreshReportScope(true);
    renderReport();
    showToast("Umsatzdaten wurden gelöscht");
  } catch (error) {
    showToast(error.message || "Umsatzdaten konnten nicht gelöscht werden");
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 1800);
}

async function logout() {
  stopAdminReportAutoRefresh();
  try {
    if (!localMode) await CloudStore.signOut();
  } catch (_) {}
  localMode = false;
  currentUserId = "";
  currentUserEmail = "";
  $("#appShell").classList.add("hidden");
  $("#settingsView").classList.add("hidden");
  $("#reportsView").classList.add("hidden");
  $("#timeClockView").classList.add("hidden");
  $("#posView").classList.remove("hidden");
  $("#loginScreen").classList.remove("hidden");
  $("#loginPassword").value = "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

async function deleteRevenueData() {
  if (!isAdminUser()) return;
  const hasRevenueData = sales.length || Object.keys(cashBalances).length;
  if (hasRevenueData && confirm("Vor dem Löschen ein Umsatzbackup downloaden?")) {
    try {
      downloadRevenueBackup();
    } catch (error) {
      showToast(error.message || "Umsatzbackup konnte nicht erstellt werden");
      return;
    }
  }
  if (!confirm("Umsatzdaten und Kassenstände dieses Standorts jetzt unwiderruflich löschen?")) return;
  try {
    if (!localMode) await CloudStore.deleteSales(currentLocationId);
    else {
      submittedReports = readStoredJson("kassenraum-submitted-reports", [])
        .filter((report) => String(report.locationId) !== String(currentLocationId));
      localStorage.setItem("kassenraum-submitted-reports", JSON.stringify(submittedReports));
    }
    sales = [];
    cashBalances = {};
    persistSales();
    persistCashBalances();
    await refreshReportScope(true);
    renderReport();
    showToast("Umsatzdaten wurden gelöscht");
  } catch (error) {
    showToast(error.message || "Umsatzdaten konnten nicht gelöscht werden");
  }
}

$("#dateChip").textContent = new Intl.DateTimeFormat("de-AT", { weekday: "long", day: "2-digit", month: "long" }).format(new Date());
$("#settingsButton").addEventListener("click", () => openSettings());
$("#reportsButton").addEventListener("click", openReports);
$("#timeClockButton").addEventListener("click", openTimeClock);
$("#brandHome").addEventListener("click", closeSettings);
$("#backToPos").addEventListener("click", closeSettings);
$("#backFromReports").addEventListener("click", closeSettings);
$("#backFromTimeClock").addEventListener("click", closeSettings);
$("#clockEmployeeSelect").addEventListener("change", renderClockStatus);
$("#clockInButton").addEventListener("click", () => clockEmployee("in"));
$("#clockOutButton").addEventListener("click", () => clockEmployee("out"));
$("#timeFromDate").addEventListener("change", renderTimeAdministration);
$("#timeToDate").addEventListener("change", renderTimeAdministration);
$("#addEmployeeForm").addEventListener("submit", addEmployee);
$("#manualTimeForm").addEventListener("submit", addManualTimeEntry);
$("#bonusForm").addEventListener("submit", saveEmployeeBonus);
$("#exportTimeButton").addEventListener("click", exportTimeReport);
$$(".open-settings").forEach((button) => button.addEventListener("click", () => openSettings("products")));
$$(".settings-tab").forEach((button) => button.addEventListener("click", () => setSettingsTab(button.dataset.tab)));
$$(".report-filter").forEach((button) => button.addEventListener("click", async () => {
  reportFilter = button.dataset.filter;
  await refreshReportScope(false, isAdminUser());
  renderReport();
}));
$("#reportDateInput").addEventListener("change", async () => {
  await refreshReportScope(false, isAdminUser());
  renderReport();
});
$("#receiptLocationFilter").addEventListener("change", async (event) => {
  receiptLocationFilter = event.target.value;
  await refreshReportScope(true, isAdminUser());
  renderReport();
});
$("#cashBalanceInput").addEventListener("input", saveCashBalance);
$("#exportReportButton").addEventListener("click", exportReport);
$("#emailReportButton").addEventListener("click", emailReport);
$("#submitReportButton").addEventListener("click", submitCurrentReport);
$("#downloadAllSubmittedReportsButton").addEventListener("click", downloadAllSubmittedReports);
$("#syncReceiptsButton").addEventListener("click", syncReceiptsForAdmin);
$("#productSearch").addEventListener("input", renderProducts);
$("#addCategoryButton").addEventListener("click", () => openEditor("category"));
$("#addProductButton").addEventListener("click", () => openEditor("product"));
$("#locationSelector").addEventListener("change", (event) => switchLocation(event.target.value));
$("#themeSelect").addEventListener("change", (event) => {
  appSettings.theme = event.target.value;
  persist();
  applyTheme();
});
$("#startCategorySelect").addEventListener("change", (event) => {
  appSettings.startCategoryId = event.target.value;
  persist();
  selectInitialCategory();
  renderCategories();
  renderProducts();
  showToast("Erstansicht gespeichert");
});
$("#billingModeSelect").addEventListener("change", async (event) => {
  appSettings.billingMode = event.target.value;
  persist();
  await refreshReportScope(true);
  if (!$("#reportsView").classList.contains("hidden")) renderReport();
  showToast(appSettings.billingMode === "combined" ? "Gemeinsame Standortabrechnung aktiv" : "Getrennte Standortabrechnung aktiv");
});
$("#billingEmailInput").addEventListener("change", (event) => {
  appSettings.billingEmail = event.target.value.trim();
  persist();
  showToast("Abrechnungs-E-Mail gespeichert");
});
$("#billingEmail2Input").addEventListener("change", (event) => {
  appSettings.billingEmail2 = event.target.value.trim();
  persist();
  showToast("Zweite Abrechnungs-E-Mail gespeichert");
});
$("#createLocationButton").addEventListener("click", async (event) => {
  event.preventDefault();
  const rawLocationName = $("#newLocationInput").value.trim();
  if (!rawLocationName) return;
  const name = canonicalLocationName(rawLocationName);
  if (!name || !STANDARD_LOCATION_NAMES.includes(name)) {
    showToast("Es sind nur Punschhütte und Bar erlaubt");
    return;
  }
  const existing = locations.find((location) => location.name === name);
  if (existing) {
    showToast(`${name} ist bereits vorhanden`);
    return;
  }
  try {
    if (localMode) {
      const location = { id: uid("location"), name, role: "admin" };
      locations.push(location);
      localStorage.setItem("kassenraum-local-locations", JSON.stringify(locations));
      $("#newLocationInput").value = "";
      await switchLocation(location.id);
    } else {
      const id = await CloudStore.createLocation(name);
      locations = normalizeLocationList(await CloudStore.locations());
      $("#newLocationInput").value = "";
      await switchLocation(id);
    }
  } catch (error) {
    showToast(error.message || "Standort konnte nicht angelegt werden");
  }
});

$("#createLocationButton").addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  const name = $("#newLocationInput").value.trim();
  if (!name) return;
  const existing = locations.find((location) => location.name.toLocaleLowerCase("de") === name.toLocaleLowerCase("de"));
  if (existing) {
    showToast(`${name} ist bereits vorhanden`);
    return;
  }
  try {
    if (localMode) {
      const location = { id: uid("location"), name, role: "admin" };
      locations.push(location);
      localStorage.setItem("kassenraum-local-locations", JSON.stringify(locations));
      $("#newLocationInput").value = "";
      await switchLocation(location.id);
    } else {
      const id = await CloudStore.createLocation(name);
      locations = normalizeLocationList(await CloudStore.locations());
      $("#newLocationInput").value = "";
      await switchLocation(id);
    }
  } catch (error) {
    showToast(error.message || "Standort konnte nicht angelegt werden");
  }
}, true);
$("#excelImportInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    await importExcelFile(file);
  } catch (error) {
    showToast(error.message);
  }
  event.target.value = "";
});
$("#adminExcelExportButton").addEventListener("click", exportAdminExcel);
$("#syncMasterDataButton").addEventListener("click", syncMasterDataToUsers);
$("#deleteSalesButton").addEventListener("click", deleteRevenueData);
$("#resetTimeTrackingButton").addEventListener("click", resetTimeTrackingData);
$("#logoutButton").addEventListener("click", logout);
$("#topLogoutButton").addEventListener("click", logout);
$("#editorForm").addEventListener("submit", saveEditor);
$("#dialogClose").addEventListener("click", () => $("#editorDialog").close());
$("#dialogCancel").addEventListener("click", () => $("#editorDialog").close());
$("#timeEntryEditForm").addEventListener("submit", saveEditedTimeEntry);
$("#timeEntryDialogClose").addEventListener("click", () => $("#timeEntryDialog").close());
$("#timeEntryDialogCancel").addEventListener("click", () => $("#timeEntryDialog").close());
$("#receiptDialogClose").addEventListener("click", () => $("#receiptDialog").close());
$("#receiptDialogOk").addEventListener("click", () => $("#receiptDialog").close());
$("#clearCartButton").addEventListener("click", () => { cart = []; renderCart(); });
$("#checkoutButton").addEventListener("click", openPaymentDialog);
$("#paymentAmountInput").addEventListener("input", updatePaymentChange);
$("#exactPaymentButton").addEventListener("click", () => {
  $("#paymentAmountInput").value = pendingPaymentTotal.toFixed(2);
  updatePaymentChange();
});
$("#cancelPaymentButton").addEventListener("click", () => $("#checkoutDialog").close());
$("#paymentForm").addEventListener("submit", completePayment);
$("#newOrderButton").addEventListener("click", () => {
  $("#checkoutDialog").close();
  if (paymentReturnCategory && visibleCategories().some((category) => category.id === paymentReturnCategory)) {
    selectedCategory = paymentReturnCategory;
  } else {
    selectInitialCategory();
  }
  paymentReturnCategory = null;
  renderCategories();
  renderProducts();
});

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!CloudStore.configured) {
    $("#loginError").textContent = "Supabase ist noch nicht konfiguriert.";
    $("#loginError").classList.remove("hidden");
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  $("#loginError").classList.add("hidden");
  const { error } = await CloudStore.signIn($("#loginEmail").value.trim(), $("#loginPassword").value);
  if (error) {
    $("#loginError").textContent = error.message;
    $("#loginError").classList.remove("hidden");
  } else {
    try {
      await startCloudSession();
    } catch (sessionError) {
      $("#loginError").textContent = sessionError.message || "Standorte konnten nicht geladen werden.";
      $("#loginError").classList.remove("hidden");
    }
  }
  button.disabled = false;
});
$("#localModeButton").addEventListener("click", startLocalMode);

async function boot() {
  applyTheme();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  if (!CloudStore.configured) {
    $("#configHint").classList.remove("hidden");
    return;
  }
  try {
    await startCloudSession();
  } catch (error) {
    $("#loginError").textContent = error.message || "Verbindung zu Supabase fehlgeschlagen.";
    $("#loginError").classList.remove("hidden");
  }
}

boot();
