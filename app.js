const COLORS = ["#C85C4A", "#D58C32", "#D2AE3F", "#5A8B62", "#3F8177", "#4B78A8", "#7466A6", "#A45C82"];
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
let managedUsers = [];
let managedUsersLoading = false;
let managedUsersError = "";
let cart = [];
let selectedCategory = "all";
let editor = { type: null, id: null, color: COLORS[0], copySourceId: null };
let reportFilter = "today";
let pendingPaymentTotal = 0;
let toastTimer;
let cloudSaveTimer;
let realtimeReloadTimer;

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
    return { theme: "dark", billingEmail: "", ...(JSON.parse(localStorage.getItem("kassenraum-settings")) || {}) };
  } catch (_) {
    return { theme: "dark", billingEmail: "" };
  }
}

function scopedKey(base) {
  return currentLocationId && currentLocationId !== "local" ? `${base}:${currentLocationId}` : base;
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

function categoryFor(id) {
  return data.categories.find((category) => category.id === id);
}

function renderAll() {
  applyTheme();
  renderRoleAccess();
  renderLocationSelector();
  renderCategories();
  renderProducts();
  renderCart();
  renderSettings();
}

function renderRoleAccess() {
  const isAdmin = currentRole === "admin";
  $("#settingsButton").classList.toggle("hidden", !isAdmin);
  $$(".open-settings").forEach((button) => button.classList.toggle("hidden", !isAdmin));
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
  appSettings = { theme: "dark", billingEmail: "", ...read("kassenraum-settings", {}) };
}

async function refreshLocationMemberships() {
  if (localMode || !currentUserId) return;
  try {
    const updatedLocations = await CloudStore.locations();
    if (!updatedLocations.length) return;
    locations = updatedLocations;
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
    return;
  }
  try {
    const remote = await CloudStore.loadLocation(locationId);
    const remoteData = remote.state?.data;
    const isNewLocation = !remoteData?.categories?.length;
    const shouldMigrate = isNewLocation && !localStorage.getItem("kassenraum-cloud-migrated");
    data = isNewLocation ? structuredClone(shouldMigrate ? legacySnapshot.data : DEFAULT_DATA) : remoteData;
    appSettings = { theme: "dark", billingEmail: "", ...(shouldMigrate ? legacySnapshot.settings : remote.state?.settings || {}) };
    sales = shouldMigrate && !remote.sales.length ? structuredClone(legacySnapshot.sales) : remote.sales;
    cashBalances = shouldMigrate && !Object.keys(remote.cashBalances).length ? structuredClone(legacySnapshot.cashBalances) : remote.cashBalances;
    persistSales();
    persistCashBalances();
    localStorage.setItem(scopedKey("kassenraum-data"), JSON.stringify(data));
    localStorage.setItem(scopedKey("kassenraum-settings"), JSON.stringify(appSettings));
    if (isNewLocation && currentRole === "admin") {
      persist();
      sales.forEach((sale) => CloudStore.insertSale(locationId, sale));
      Object.entries(cashBalances).forEach(([dateKey, balance]) => CloudStore.saveCash(locationId, dateKey, balance));
      if (shouldMigrate) localStorage.setItem("kassenraum-cloud-migrated", "1");
    }
    CloudStore.subscribe(
      locationId,
      () => {
        clearTimeout(realtimeReloadTimer);
        realtimeReloadTimer = setTimeout(() => switchLocation(locationId, true), 350);
      },
      currentUserId,
      () => {
        clearTimeout(realtimeReloadTimer);
        realtimeReloadTimer = setTimeout(refreshLocationMemberships, 350);
      }
    );
    if (!background) showToast(`Standort: ${location.name}`);
  } catch (error) {
    loadLocalLocation(locationId);
    showToast("Offline – lokaler Datenstand wird verwendet");
  }
  selectedCategory = "all";
  renderAll();
}

async function startCloudSession() {
  const session = await CloudStore.session();
  if (!session) return false;
  currentUserId = session.user.id;
  currentUserEmail = session.user.email || "";
  locations = await CloudStore.locations();
  if (!locations.length) {
    await CloudStore.createLocation("Hauptstandort");
    locations = await CloudStore.locations();
  }
  const preferred = locations.some((location) => location.id === currentLocationId)
    ? currentLocationId
    : locations[0].id;
  currentRole = locations.find((location) => location.id === preferred)?.role || "staff";
  $("#currentUserLabel").textContent = session.user.email || "Supabase-Konto";
  showApplication();
  await switchLocation(preferred);
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
  if (!locations.length) locations = [{ id: "local", name: "Lokaler Standort", role: "admin" }];
  currentLocationId = locations.some((location) => location.id === currentLocationId) ? currentLocationId : locations[0].id;
  loadLocalLocation(currentLocationId);
  showApplication();
}

function visibleCategories() {
  return data.categories.filter((category) => !category.hidden);
}

function renderCategories() {
  const nav = $("#categoryNav");
  const categories = visibleCategories();
  const visibleIds = new Set(categories.map((category) => category.id));
  const visibleProductCount = data.products.filter((product) => visibleIds.has(product.categoryId)).length;
  const allButton = categoryButton("all", "Alle Artikel", "#183F37", visibleProductCount);
  nav.innerHTML = allButton + categories.map((category) =>
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
  if (currentRole !== "admin") {
    showToast("Nur Administratoren können die Einstellungen öffnen.");
    return;
  }
  $("#posView").classList.add("hidden");
  $("#settingsView").classList.remove("hidden");
  setSettingsTab(tab);
  renderSettings();
  window.scrollTo(0, 0);
}

function closeSettings() {
  $("#settingsView").classList.add("hidden");
  $("#reportsView").classList.add("hidden");
  $("#posView").classList.remove("hidden");
  renderAll();
}

function openReports() {
  $("#posView").classList.add("hidden");
  $("#settingsView").classList.add("hidden");
  $("#reportsView").classList.remove("hidden");
  reportFilter = "today";
  $("#reportDateInput").value = localDateKey(new Date());
  renderReport();
  window.scrollTo(0, 0);
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateKey(key) {
  return new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" })
    .format(new Date(`${key}T12:00:00`));
}

function filteredSales() {
  if (reportFilter === "all") return sales;
  const key = reportFilter === "today" ? localDateKey(new Date()) : $("#reportDateInput").value;
  return sales.filter((sale) => localDateKey(sale.timestamp) === key);
}

function selectedReportDateKey() {
  return reportFilter === "today" ? localDateKey(new Date()) : $("#reportDateInput").value;
}

function aggregateSales(entries) {
  const products = new Map();
  let revenue = 0;
  let itemCount = 0;
  let freeCount = 0;

  entries.forEach((sale) => sale.items.forEach((item) => {
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

function renderReport() {
  $$(".report-filter").forEach((button) => button.classList.toggle("active", button.dataset.filter === reportFilter));
  const isDate = reportFilter === "date";
  const isAll = reportFilter === "all";
  $("#reportDateWrap").classList.toggle("hidden", !isDate);
  $("#exportReportButton").disabled = false;
  $("#exportReportButton").title = isAll ? "Erstellt ein Tabellenblatt pro Tag und eine Gesamtabrechnung." : "";

  const reportSales = filteredSales();
  const summary = aggregateSales(reportSales);
  const periodKey = selectedReportDateKey();
  $("#reportPeriodLabel").textContent = isAll ? "Gesamter gespeicherter Zeitraum" : formatDateKey(periodKey);
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
  $("#cashBalancePanel").classList.toggle("hidden", isAll);
  if (!isAll) {
    const savedBalance = cashBalances[periodKey];
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
    const categoryNames = data.categories.map((category) => category.name);
    const categorySet = new Set(categoryNames);
    const rows = new Map();

    const ensureRow = (name) => {
      const key = name.trim().toLocaleLowerCase("de");
      if (!rows.has(key)) rows.set(key, { name, total: 0, sold: 0, amount: 0, categoryCounts: {} });
      return rows.get(key);
    };

    data.products.forEach((product) => ensureRow(product.name));
    reportSales.forEach((sale) => sale.items.forEach((item) => {
      const row = ensureRow(item.name);
      row.total += item.quantity;
      row.amount += item.price * item.quantity;
      if (item.price > 0) row.sold += item.quantity;
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
      locationName: locations.find((location) => location.id === currentLocationId)?.name || "Standort"
    };
  };

  if (reportFilter === "all") {
    const dateKeys = [...new Set([
      ...sales.map((sale) => localDateKey(sale.timestamp)),
      ...Object.keys(cashBalances)
    ])].sort();
    const sheets = dateKeys.map((dateKey) => buildSheet(
      sales.filter((sale) => localDateKey(sale.timestamp) === dateKey),
      {
        dateLabel: formatDateKey(dateKey),
        sheetName: formatDateKey(dateKey),
        cashBalance: Number.isFinite(cashBalances[dateKey]) ? cashBalances[dateKey] : null
      }
    ));
    const enteredCashBalances = dateKeys
      .map((dateKey) => cashBalances[dateKey])
      .filter((value) => Number.isFinite(value));
    sheets.push(buildSheet(sales, {
      dateLabel: "Gesamtabrechnung",
      sheetName: "Gesamtabrechnung",
      cashBalance: enteredCashBalances.length
        ? enteredCashBalances.reduce((sum, value) => sum + value, 0)
        : null
    }));
    return { filename: "Gesamtabrechnung.xlsx", workbook: { sheets } };
  }

  const dateKey = selectedReportDateKey();
  return {
    filename: `Abrechnung_${dateKey}.xlsx`,
    workbook: buildSheet(filteredSales(), {
      dateLabel: formatDateKey(dateKey),
      sheetName: formatDateKey(dateKey),
      cashBalance: Number.isFinite(cashBalances[dateKey]) ? cashBalances[dateKey] : null
    })
  };
}

function exportReport() {
  const payload = buildExportPayload();
  XlsxExport.downloadWorkbook(payload.workbook, payload.filename);
  showToast("Excel-Abrechnung wurde erstellt");
}

async function emailReport() {
  if (!appSettings.billingEmail) {
    showToast("Bitte zuerst eine Abrechnungs-E-Mail im Adminbereich hinterlegen.");
    return;
  }

  const button = $("#emailReportButton");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Mail-App wird geöffnet …";

  try {
    const payload = buildExportPayload();
    const sales = filteredSales();
    const summary = aggregateSales(sales);
    const period = reportFilter === "all" ? "Gesamtabrechnung" : formatDateKey(selectedReportDateKey());
    const locationName = locations.find((location) => location.id === currentLocationId)?.name || "Standort";
    const bytes = XlsxExport.createWorkbook(payload.workbook);
    const file = new File([bytes], payload.filename, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const subject = `Abrechnung ${locationName} – ${period}`;
    const body = [
      `Empfänger: ${appSettings.billingEmail}`,
      "",
      `Im Anhang befindet sich die Abrechnung für ${locationName}.`,
      `Zeitraum: ${period}`,
      `Umsatz: ${formatMoney(summary.revenue)}`,
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

    XlsxExport.downloadWorkbook(payload.workbook, payload.filename);
    const fallbackBody = `${body}\n\nDie Exceldatei wurde heruntergeladen. Bitte diese Datei an die E-Mail anhängen.`;
    window.location.href = `mailto:${encodeURIComponent(appSettings.billingEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(fallbackBody)}`;
    showToast("Exceldatei heruntergeladen – bitte im Mailentwurf anhängen");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Mail-App konnte nicht geöffnet werden");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function setSettingsTab(tab) {
  $$(".settings-tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  $("#categoriesTab").classList.toggle("hidden", tab !== "categories");
  $("#productsTab").classList.toggle("hidden", tab !== "products");
  $("#generalTab").classList.toggle("hidden", tab !== "general");
  if (tab === "general" && currentRole === "admin") loadManagedUsers();
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
  $("#billingEmailInput").value = appSettings.billingEmail || "";
  $("#currentUserLabel").textContent = localMode ? "Lokaler Testmodus" : (currentUserEmail || "Supabase-Konto aktiv");
  renderUserManagement();
}

function adminLocations() {
  return locations.filter((location) => location.role === "admin");
}

function locationChecksHtml(selectedIds = [], prefix = "location", disabled = false) {
  const selected = new Set(selectedIds);
  return adminLocations().map((location) => {
    const inputId = `${prefix}-${location.id}`;
    return `<label class="location-check" for="${inputId}">
      <input id="${inputId}" type="checkbox" value="${location.id}" ${selected.has(location.id) ? "checked" : ""} ${disabled ? "disabled" : ""}>
      <span>${escapeHtml(location.name)}</span>
    </label>`;
  }).join("");
}

function renderUserManagement() {
  const createLocations = $("#newUserLocations");
  const list = $("#managedUsersList");
  if (!createLocations || !list) return;

  const allAdminLocationIds = adminLocations().map((location) => location.id);
  createLocations.innerHTML = locationChecksHtml(allAdminLocationIds, "new-user-location");

  if (localMode) {
    list.innerHTML = `<div class="list-empty">Benutzerverwaltung ist nur mit Supabase-Anmeldung verfügbar.</div>`;
    $("#createUserForm").classList.add("hidden");
    $("#refreshUsersButton").classList.add("hidden");
    return;
  }
  $("#createUserForm").classList.remove("hidden");
  $("#refreshUsersButton").classList.remove("hidden");

  if (managedUsersLoading) {
    list.innerHTML = `<div class="list-empty">Benutzer werden geladen …</div>`;
    return;
  }
  if (managedUsersError) {
    list.innerHTML = `<div class="list-empty">${escapeHtml(managedUsersError)}</div>`;
    return;
  }
  if (!managedUsers.length) {
    list.innerHTML = `<div class="list-empty">Noch keine Benutzer für deine Standorte vorhanden.</div>`;
    return;
  }

  list.innerHTML = managedUsers.map((user) => {
    const selectedIds = user.memberships.map((membership) => membership.locationId);
    const role = user.memberships.some((membership) => membership.role === "admin") ? "admin" : "staff";
    const disabled = user.isCurrentUser;
    return `<article class="managed-user" data-user-id="${user.id}">
      <div class="managed-user-header">
        <span class="user-avatar">${escapeHtml(user.email.charAt(0).toUpperCase())}</span>
        <div><strong>${escapeHtml(user.email)}</strong><small>${role === "admin" ? "Administrator" : "Staff"}</small></div>
        ${disabled ? `<span class="current-user-badge">Du</span>` : ""}
      </div>
      <div class="managed-user-controls">
        <label>Rolle
          <select class="managed-user-role" ${disabled ? "disabled" : ""}>
            <option value="staff" ${role === "staff" ? "selected" : ""}>Staff</option>
            <option value="admin" ${role === "admin" ? "selected" : ""}>Administrator</option>
          </select>
        </label>
        <div class="location-checks">${locationChecksHtml(selectedIds, `user-${user.id}`, disabled)}</div>
        <div class="managed-user-actions">
          <button class="secondary-button save-managed-user" type="button" ${disabled ? "disabled" : ""}>Speichern</button>
          <button class="danger-button remove-managed-user" type="button" ${disabled ? "disabled" : ""}>Entfernen</button>
        </div>
      </div>
    </article>`;
  }).join("");

  $$(".save-managed-user").forEach((button) => button.addEventListener("click", () => {
    updateManagedUser(button.closest(".managed-user"));
  }));
  $$(".remove-managed-user").forEach((button) => button.addEventListener("click", () => {
    removeManagedUser(button.closest(".managed-user"));
  }));
}

async function loadManagedUsers() {
  if (localMode || currentRole !== "admin" || managedUsersLoading) {
    renderUserManagement();
    return;
  }
  managedUsersLoading = true;
  managedUsersError = "";
  renderUserManagement();
  try {
    const result = await CloudStore.manageUsers("list");
    managedUsers = result.users || [];
  } catch (error) {
    managedUsers = [];
    managedUsersError = "Benutzerverwaltung nicht erreichbar. Ist die Edge Function veröffentlicht?";
    showToast(error.message || "Benutzer konnten nicht geladen werden");
  } finally {
    managedUsersLoading = false;
    renderUserManagement();
  }
}

function selectedLocationIds(container) {
  return $$(`#${container} input[type="checkbox"]:checked`).map((input) => input.value);
}

async function createManagedUser(event) {
  event.preventDefault();
  const button = $("#createUserButton");
  const payload = {
    email: $("#newUserEmail").value.trim(),
    password: $("#newUserPassword").value,
    role: $("#newUserRole").value,
    locationIds: selectedLocationIds("newUserLocations")
  };
  if (!payload.locationIds.length) {
    showToast("Mindestens einen Standort auswählen");
    return;
  }
  button.disabled = true;
  button.textContent = "Wird angelegt …";
  try {
    await CloudStore.manageUsers("create", payload);
    $("#createUserForm").reset();
    showToast("Benutzer wurde angelegt");
    await loadManagedUsers();
  } catch (error) {
    showToast(error.message || "Benutzer konnte nicht angelegt werden");
  } finally {
    button.disabled = false;
    button.textContent = "Benutzer anlegen";
    renderUserManagement();
  }
}

async function updateManagedUser(row) {
  const userId = row?.dataset.userId;
  if (!userId) return;
  const locationIds = [...row.querySelectorAll('.location-check input:checked')].map((input) => input.value);
  if (!locationIds.length) {
    showToast("Mindestens einen Standort auswählen");
    return;
  }
  try {
    await CloudStore.manageUsers("update", {
      userId,
      role: row.querySelector(".managed-user-role").value,
      locationIds
    });
    showToast("Benutzerzugriff gespeichert");
    await loadManagedUsers();
  } catch (error) {
    showToast(error.message || "Benutzer konnte nicht gespeichert werden");
  }
}

async function removeManagedUser(row) {
  const userId = row?.dataset.userId;
  const user = managedUsers.find((entry) => entry.id === userId);
  if (!userId || !user) return;
  if (!confirm(`${user.email} wirklich aus allen verwalteten Standorten entfernen?`)) return;
  try {
    await CloudStore.manageUsers("remove", { userId });
    showToast("Benutzer wurde entfernt");
    await loadManagedUsers();
  } catch (error) {
    showToast(error.message || "Benutzer konnte nicht entfernt werden");
  }
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
  if (!confirm(`${importedCategories.length} Kategorien und ${importedProducts.length} Artikel importieren? Das aktuelle Sortiment wird ersetzt.`)) return;
  data = { categories: importedCategories, products: importedProducts };
  persist();
  renderAll();
  if (!localMode && currentLocationId !== "local") {
    clearTimeout(cloudSaveTimer);
    const result = await CloudStore.saveState(currentLocationId, data, appSettings);
    showToast(result?.queued
      ? "Excel-Sortiment lokal gespeichert – Synchronisierung folgt automatisch"
      : "Excel-Sortiment wurde für alle Benutzer übernommen");
  } else {
    showToast("Excel-Sortiment wurde importiert");
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

function showToast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 1800);
}

async function logout() {
  try {
    if (!localMode) await CloudStore.signOut();
  } catch (_) {}
  localMode = false;
  currentUserId = "";
  currentUserEmail = "";
  managedUsers = [];
  managedUsersError = "";
  $("#appShell").classList.add("hidden");
  $("#settingsView").classList.add("hidden");
  $("#reportsView").classList.add("hidden");
  $("#posView").classList.remove("hidden");
  $("#loginScreen").classList.remove("hidden");
  $("#loginPassword").value = "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

$("#dateChip").textContent = new Intl.DateTimeFormat("de-AT", { weekday: "long", day: "2-digit", month: "long" }).format(new Date());
$("#settingsButton").addEventListener("click", () => openSettings());
$("#reportsButton").addEventListener("click", openReports);
$("#brandHome").addEventListener("click", closeSettings);
$("#backToPos").addEventListener("click", closeSettings);
$("#backFromReports").addEventListener("click", closeSettings);
$$(".open-settings").forEach((button) => button.addEventListener("click", () => openSettings("products")));
$$(".settings-tab").forEach((button) => button.addEventListener("click", () => setSettingsTab(button.dataset.tab)));
$$(".report-filter").forEach((button) => button.addEventListener("click", () => {
  reportFilter = button.dataset.filter;
  renderReport();
}));
$("#reportDateInput").addEventListener("change", renderReport);
$("#cashBalanceInput").addEventListener("input", saveCashBalance);
$("#exportReportButton").addEventListener("click", exportReport);
$("#emailReportButton").addEventListener("click", emailReport);
$("#productSearch").addEventListener("input", renderProducts);
$("#addCategoryButton").addEventListener("click", () => openEditor("category"));
$("#addProductButton").addEventListener("click", () => openEditor("product"));
$("#locationSelector").addEventListener("change", (event) => switchLocation(event.target.value));
$("#themeSelect").addEventListener("change", (event) => {
  appSettings.theme = event.target.value;
  persist();
  applyTheme();
});
$("#billingEmailInput").addEventListener("change", (event) => {
  appSettings.billingEmail = event.target.value.trim();
  persist();
  showToast("Abrechnungs-E-Mail gespeichert");
});
$("#createLocationButton").addEventListener("click", async (event) => {
  event.preventDefault();
  const name = $("#newLocationInput").value.trim();
  if (!name) return;
  try {
    if (localMode) {
      const location = { id: uid("location"), name, role: "admin" };
      locations.push(location);
      localStorage.setItem("kassenraum-local-locations", JSON.stringify(locations));
      $("#newLocationInput").value = "";
      await switchLocation(location.id);
    } else {
      const id = await CloudStore.createLocation(name);
      locations = await CloudStore.locations();
      $("#newLocationInput").value = "";
      await switchLocation(id);
    }
  } catch (error) {
    showToast(error.message || "Standort konnte nicht angelegt werden");
  }
});
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
$("#deleteSalesButton").addEventListener("click", deleteRevenueData);
$("#createUserForm").addEventListener("submit", createManagedUser);
$("#refreshUsersButton").addEventListener("click", loadManagedUsers);
$("#logoutButton").addEventListener("click", logout);
$("#topLogoutButton").addEventListener("click", logout);
$("#editorForm").addEventListener("submit", saveEditor);
$("#dialogClose").addEventListener("click", () => $("#editorDialog").close());
$("#dialogCancel").addEventListener("click", () => $("#editorDialog").close());
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
