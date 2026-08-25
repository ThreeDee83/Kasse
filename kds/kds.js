(function () {
  "use strict";

  const config = globalThis.KASSENRAUM_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co$/.test(config.supabaseUrl || "")
    && !String(config.supabaseAnonKey || "").startsWith("DEIN_");
  const client = configured && globalThis.supabase
    ? globalThis.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
    : null;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  let currentUser = null;
  let locations = [];
  let currentLocationId = localStorage.getItem("owncash-kds-location") || "";
  let openOrders = [];
  let doneOrders = [];
  let currentView = "open";
  let channel = null;
  let refreshTimer = null;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[character]));
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "–";
    return new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "–";
    return new Intl.DateTimeFormat("de-AT", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
    }).format(date);
  }

  function ageMinutes(order) {
    return Math.max(0, Math.floor((Date.now() - new Date(order.received_at).getTime()) / 60000));
  }

  function durationMinutes(order) {
    if (!order.completed_at) return ageMinutes(order);
    return Math.max(0, Math.floor((new Date(order.completed_at) - new Date(order.received_at)) / 60000));
  }

  function setConnectionStatus() {
    const online = navigator.onLine;
    $("#connectionStatus").textContent = online ? "Online" : "Offline";
    $("#connectionStatus").classList.toggle("offline", !online);
  }

  function setMessage(message, isError = false) {
    const output = $("#completionMessage");
    output.textContent = message;
    output.classList.toggle("error", isError);
  }

  function renderOrders() {
    const orders = currentView === "open" ? openOrders : doneOrders;
    $("#openCount").textContent = openOrders.length;
    $("#doneCount").textContent = doneOrders.length;
    $$(".view-tab").forEach((button) => button.classList.toggle("active", button.dataset.view === currentView));
    const grid = $("#ordersGrid");
    const empty = $("#emptyState");
    if (!orders.length) {
      grid.innerHTML = "";
      empty.textContent = currentView === "open" ? "Keine offenen Speisenbestellungen." : "Noch keine erledigten Bestellungen.";
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    grid.innerHTML = orders.map((order) => {
      const minutes = durationMinutes(order);
      const ageClass = currentView === "done" ? "done" : (minutes >= 20 ? "late" : (minutes >= 10 ? "warning" : ""));
      const items = Array.isArray(order.items) ? order.items : [];
      const hasPager = Boolean(order.pager_number);
      return `<article class="order-card ${ageClass}" data-id="${escapeHtml(order.id)}">
        <div class="order-head">
          <div><span class="eyebrow">${hasPager ? "PAGER" : "BESTELLUNG"}</span><div class="pager-number ${hasPager ? "" : "no-pager"}">${hasPager ? escapeHtml(order.pager_number) : "Kein Pager"}</div></div>
          <div class="order-meta">
            <strong>${currentView === "done" ? `Erledigt ${escapeHtml(formatDateTime(order.completed_at))}` : `Eingang ${escapeHtml(formatTime(order.received_at))}`}</strong>
            ${minutes} Min. ${currentView === "done" ? "Bearbeitungszeit" : "offen"}
          </div>
        </div>
        <ul class="order-items">${items.map((item) => `<li>
          <span class="item-quantity">${escapeHtml(Number(item.quantity || 0))}×</span>
          <span class="item-name">${escapeHtml(item.name || "Artikel")}</span>
        </li>`).join("")}</ul>
        ${currentView === "open" && !hasPager ? `<div class="order-actions"><button class="complete-order-button" type="button" data-id="${escapeHtml(order.id)}">Bestellung erledigt</button></div>` : ""}
      </article>`;
    }).join("");
    $$(".complete-order-button").forEach((button) => button.addEventListener("click", () => {
      completeOrder(button.dataset.id).catch((error) => setMessage(error.message, true));
    }));
  }

  async function loadOrders() {
    if (!client || !currentLocationId) return;
    const [openResult, doneResult] = await Promise.all([
      client.from("kds_orders").select("*").eq("location_id", currentLocationId)
        .is("completed_at", null).order("received_at", { ascending: true }),
      client.from("kds_orders").select("*").eq("location_id", currentLocationId)
        .not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(200)
    ]);
    if (openResult.error) throw openResult.error;
    if (doneResult.error) throw doneResult.error;
    openOrders = openResult.data || [];
    doneOrders = doneResult.data || [];
    renderOrders();
  }

  function subscribeToOrders() {
    if (channel) client.removeChannel(channel);
    if (!currentLocationId) return;
    channel = client.channel(`kds-${currentLocationId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "kds_orders", filter: `location_id=eq.${currentLocationId}`
      }, () => loadOrders().catch((error) => setMessage(error.message, true)))
      .subscribe();
  }

  async function changeLocation(locationId) {
    if (!locations.some((location) => location.id === locationId)) return;
    currentLocationId = locationId;
    localStorage.setItem("owncash-kds-location", locationId);
    $("#locationSelect").value = locationId;
    openOrders = [];
    doneOrders = [];
    renderOrders();
    subscribeToOrders();
    await loadOrders();
    $("#pagerInput").focus();
  }

  async function startKds(session) {
    currentUser = session.user;
    const { data, error } = await client.from("locations").select("id,name").order("name");
    if (error) throw error;
    locations = (data || []).filter((location) => location?.id && location?.name);
    if (!locations.length) throw new Error("Für dieses Konto ist kein Standort freigeschaltet.");
    $("#locationSelect").innerHTML = locations.map((location) =>
      `<option value="${escapeHtml(location.id)}">${escapeHtml(location.name)}</option>`
    ).join("");
    $("#loginScreen").classList.add("hidden");
    $("#kdsApp").classList.remove("hidden");
    $("#currentDate").textContent = new Intl.DateTimeFormat("de-AT", {
      weekday: "long", day: "2-digit", month: "2-digit", year: "numeric"
    }).format(new Date());
    const preferred = locations.some((location) => location.id === currentLocationId)
      ? currentLocationId
      : locations[0].id;
    await changeLocation(preferred);
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => loadOrders().catch(() => {}), 15000);
  }

  async function completePager(event) {
    event.preventDefault();
    const input = $("#pagerInput");
    const pagerNumber = globalThis.KdsOrder?.normalizePagerNumber(input.value);
    if (!pagerNumber) return;
    const matching = openOrders.filter((order) => String(order.pager_number) === pagerNumber);
    if (!matching.length) {
      setMessage(`Pager ${pagerNumber} ist nicht als offene Bestellung vorhanden.`, true);
      input.select();
      return;
    }
    const { error } = await client.from("kds_orders").update({
      completed_at: new Date().toISOString(),
      completed_by: currentUser.id
    }).eq("location_id", currentLocationId).eq("pager_number", pagerNumber).is("completed_at", null);
    if (error) {
      setMessage(error.message || "Bestellung konnte nicht abgeschlossen werden.", true);
      return;
    }
    input.value = "";
    setMessage(`Pager ${pagerNumber} wurde erledigt.`);
    await loadOrders();
    input.focus();
  }

  async function completeOrder(orderId) {
    const order = openOrders.find((entry) => String(entry.id) === String(orderId));
    if (!order) return;
    const { error } = await client.from("kds_orders").update({
      completed_at: new Date().toISOString(),
      completed_by: currentUser.id
    }).eq("location_id", currentLocationId).eq("id", order.id).is("completed_at", null);
    if (error) throw error;
    setMessage(order.pager_number ? `Pager ${order.pager_number} wurde erledigt.` : "Bestellung ohne Pager wurde erledigt.");
    await loadOrders();
    $("#pagerInput").focus();
  }

  async function boot() {
    setConnectionStatus();
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
    if (!client) {
      $("#loginError").textContent = "Supabase ist nicht konfiguriert.";
      $("#loginError").classList.remove("hidden");
      return;
    }
    const { data } = await client.auth.getSession();
    if (data.session) {
      try {
        await startKds(data.session);
      } catch (error) {
        $("#loginError").textContent = error.message;
        $("#loginError").classList.remove("hidden");
      }
    }
  }

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#loginError").classList.add("hidden");
    const { data, error } = await client.auth.signInWithPassword({
      email: $("#loginEmail").value.trim(), password: $("#loginPassword").value
    });
    if (error) {
      $("#loginError").textContent = error.message;
      $("#loginError").classList.remove("hidden");
      return;
    }
    try {
      await startKds(data.session);
    } catch (startError) {
      $("#loginError").textContent = startError.message;
      $("#loginError").classList.remove("hidden");
    }
  });
  $("#completeForm").addEventListener("submit", (event) => completePager(event).catch((error) => setMessage(error.message, true)));
  $("#locationSelect").addEventListener("change", (event) => changeLocation(event.target.value).catch((error) => setMessage(error.message, true)));
  $("#refreshButton").addEventListener("click", () => loadOrders().catch((error) => setMessage(error.message, true)));
  $$(".view-tab").forEach((button) => button.addEventListener("click", () => {
    currentView = button.dataset.view;
    renderOrders();
  }));
  $("#logoutButton").addEventListener("click", async () => {
    if (channel) await client.removeChannel(channel);
    clearInterval(refreshTimer);
    await client.auth.signOut();
    location.reload();
  });
  globalThis.addEventListener("online", () => { setConnectionStatus(); loadOrders().catch(() => {}); });
  globalThis.addEventListener("offline", setConnectionStatus);
  setInterval(() => { if (currentView === "open" && openOrders.length) renderOrders(); }, 30000);

  boot().catch((error) => {
    $("#loginError").textContent = error.message;
    $("#loginError").classList.remove("hidden");
  });
})();
