(function (global) {
  const config = global.KASSENRAUM_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co$/.test(config.supabaseUrl || "")
    && !String(config.supabaseAnonKey || "").startsWith("DEIN_");
  const client = configured && global.supabase
    ? global.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
    : null;
  let channel = null;
  const queueKey = "kassenraum-sync-queue";

  function enqueue(action) {
    const queue = JSON.parse(localStorage.getItem(queueKey) || "[]");
    queue.push({ ...action, queuedAt: new Date().toISOString() });
    localStorage.setItem(queueKey, JSON.stringify(queue));
  }

  async function run(action) {
    if (!client) throw new Error("Supabase ist nicht konfiguriert.");
    if (action.type === "state") {
      return client.from("location_state").upsert({
        location_id: action.locationId,
        data: action.data,
        settings: action.settings,
        updated_at: new Date().toISOString()
      }, { onConflict: "location_id" });
    }
    if (action.type === "sale") return client.from("sales").upsert(action.sale);
    if (action.type === "cash") {
      return client.from("cash_balances").upsert({
        location_id: action.locationId,
        date_key: action.dateKey,
        balance: action.balance
      }, { onConflict: "location_id,date_key" });
    }
    if (action.type === "catalog") {
      const rows = [...new Set(action.locationIds || [])].map((locationId) => ({
        location_id: locationId,
        data: action.data,
        updated_at: new Date().toISOString()
      }));
      if (!rows.length) return { data: [], error: null };
      return client
        .from("location_state")
        .upsert(rows, { onConflict: "location_id" });
    }
  }

  async function queued(action) {
    try {
      const result = await run(action);
      if (result?.error) throw result.error;
      return result;
    } catch (error) {
      enqueue(action);
      return { error, queued: true };
    }
  }

  async function flushQueue() {
    if (!client || !navigator.onLine) return;
    const queue = JSON.parse(localStorage.getItem(queueKey) || "[]");
    if (!queue.length) return;
    const remaining = [];
    for (const action of queue) {
      try {
        const result = await run(action);
        if (result?.error) throw result.error;
      } catch (_) {
        remaining.push(action);
      }
    }
    localStorage.setItem(queueKey, JSON.stringify(remaining));
  }

  async function signIn(email, password) {
    return client.auth.signInWithPassword({ email, password });
  }

  async function signOut() {
    if (channel) await client.removeChannel(channel);
    channel = null;
    return client.auth.signOut();
  }

  async function session() {
    if (!client) return null;
    return (await client.auth.getSession()).data.session;
  }

  async function locations() {
    const { data, error } = await client
      .from("user_locations")
      .select("role, location:locations(id,name)")
      .order("created_at");
    if (error) throw error;
    return (data || [])
      .filter((entry) => entry.location?.id)
      .map((entry) => ({ ...entry.location, role: entry.role }));
  }

  async function adminLocations() {
    const { data, error } = await client
      .from("locations")
      .select("id,name,created_at")
      .order("created_at");
    if (error) throw error;
    return (data || []).map((location) => ({ id: location.id, name: location.name, role: "admin" }));
  }

  async function createLocation(name) {
    const { data, error } = await client.rpc("create_location", { location_name: name });
    if (error) throw error;
    return data;
  }

  async function deleteLocation(locationId) {
    const { error } = await client.rpc("delete_location", { target_location: locationId });
    if (error) throw error;
  }

  async function syncLocationMemberships() {
    const { data, error } = await client.rpc("sync_location_memberships");
    if (error) throw error;
    return data;
  }

  async function updateLocation(locationId, name) {
    const { error } = await client.from("locations").update({ name }).eq("id", locationId);
    if (error) throw error;
  }

  function saveCatalogToLocations(locationIds, data) {
    return queued({ type: "catalog", locationIds, data });
  }

  async function overwriteCatalogToLocations(locationIds, data) {
    const result = await run({ type: "catalog", locationIds, data });
    if (result?.error) throw result.error;
    return result;
  }

  async function syncCatalogToAllLocations(data, fallbackLocationIds = []) {
    const rpcResult = await client.rpc("sync_catalog_to_all_locations", { catalog_data: data });
    if (!rpcResult.error) return { data: rpcResult.data, allLocations: true };
    if (!["42883", "PGRST202"].includes(rpcResult.error.code)) throw rpcResult.error;
    const fallback = await overwriteCatalogToLocations(fallbackLocationIds, data);
    return { ...fallback, allLocations: false, fallback: true };
  }

  async function syncMasterData(data, employees, fallbackLocationIds = [], locationId = null) {
    const rpcResult = await client.rpc("sync_master_data", {
      catalog_data: data,
      employee_data: (employees || []).map((employee) => ({
        name: String(employee.name || "").trim(),
        hourlyRate: Number(employee.hourlyRate ?? employee.hourly_rate ?? 0),
        active: employee.active !== false
      }))
    });
    if (!rpcResult.error) return { data: rpcResult.data, allLocations: true, atomic: true };
    if (!["42883", "PGRST202"].includes(rpcResult.error.code)) throw rpcResult.error;

    const catalogResult = await syncCatalogToAllLocations(data, fallbackLocationIds);
    const employeeResult = await syncEmployees(employees, locationId);
    return { ...catalogResult, employees: employeeResult?.synced || 0, atomic: false, fallback: true };
  }

  function normalizedName(name) {
    return String(name || "").trim().toLocaleLowerCase("de");
  }

  async function syncEmployees(employees, locationId = null) {
    if (!client) throw new Error("Supabase ist nicht konfiguriert.");
    const incoming = (employees || [])
      .map((employee) => ({
        id: employee.id,
        name: String(employee.name || "").trim(),
        hourlyRate: Number(employee.hourlyRate ?? employee.hourly_rate ?? 0),
        active: employee.active !== false
      }))
      .filter((employee) => employee.name && Number.isFinite(employee.hourlyRate));
    if (!incoming.length) return { synced: 0 };

    const { data: existingEmployees, error: loadError } = await client.from("employees").select("*");
    if (loadError) throw loadError;
    const existingByName = new Map((existingEmployees || []).map((employee) => [normalizedName(employee.name), employee]));

    for (const employee of incoming) {
      const existing = existingByName.get(normalizedName(employee.name));
      const values = {
        name: employee.name,
        hourly_rate: employee.hourlyRate,
        active: employee.active
      };
      if (existing?.id) {
        const { error } = await client.from("employees").update(values).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { data, error } = await client.from("employees").insert({ ...values, location_id: locationId }).select("*").single();
        if (error) throw error;
        if (data?.name) existingByName.set(normalizedName(data.name), data);
      }
    }
    return { synced: incoming.length };
  }

  async function loadLocation(locationId) {
    const [stateResult, salesResult, cashResult] = await Promise.all([
      client.from("location_state").select("*").eq("location_id", locationId).maybeSingle(),
      client.from("sales").select("*").eq("location_id", locationId).order("timestamp"),
      client.from("cash_balances").select("*").eq("location_id", locationId)
    ]);
    if (stateResult.error) throw stateResult.error;
    if (salesResult.error) throw salesResult.error;
    if (cashResult.error) throw cashResult.error;
    return {
      state: stateResult.data,
      sales: salesResult.data || [],
      cashBalances: Object.fromEntries((cashResult.data || []).map((row) => [row.date_key, Number(row.balance)]))
    };
  }

  async function loadReportsForLocations(locationIds) {
    const [salesResult, cashResult] = await Promise.all([
      client.from("sales").select("*").in("location_id", locationIds).order("timestamp"),
      client.from("cash_balances").select("*").in("location_id", locationIds)
    ]);
    if (salesResult.error) throw salesResult.error;
    if (cashResult.error) throw cashResult.error;
    return {
      sales: salesResult.data || [],
      cashBalances: cashResult.data || []
    };
  }

  function saveState(locationId, data, settings) {
    return queued({ type: "state", locationId, data, settings });
  }

  function insertSale(locationId, sale) {
    const { locationName, locationId: ignoredLocationId, ...cleanSale } = sale;
    return queued({ type: "sale", sale: { ...cleanSale, location_id: locationId } });
  }

  function saveSale(locationId, sale) {
    const { locationName, locationId: ignoredLocationId, ...cleanSale } = sale;
    return queued({ type: "sale", sale: { ...cleanSale, location_id: locationId } });
  }

  async function deleteSale(saleId) {
    const { error } = await client.from("sales").delete().eq("id", saleId);
    if (error) throw error;
  }

  async function deleteSalesByIds(saleIds) {
    const ids = [...new Set((saleIds || []).filter(Boolean).map(String))];
    if (!ids.length) return;
    const { error } = await client.from("sales").delete().in("id", ids);
    if (error) throw error;
  }

  function saveCash(locationId, dateKey, balance) {
    return queued({ type: "cash", locationId, dateKey, balance });
  }

  async function deleteCash(locationId, dateKey) {
    if (!client) return;
    return client.from("cash_balances").delete().eq("location_id", locationId).eq("date_key", dateKey);
  }

  async function deleteSales(locationId) {
    const { error } = await client.from("sales").delete().eq("location_id", locationId);
    if (error) throw error;
    const { error: cashError } = await client.from("cash_balances").delete().eq("location_id", locationId);
    if (cashError) throw cashError;
  }

  async function loadTimeTracking() {
    const [employeesResult, entriesResult, bonusesResult] = await Promise.all([
      client.from("employees").select("*").order("name"),
      client.from("time_entries").select("*").order("clock_in", { ascending: false }),
      client.from("employee_bonuses").select("*").order("date_key", { ascending: false })
    ]);
    if (employeesResult.error) throw employeesResult.error;
    if (entriesResult.error) throw entriesResult.error;
    if (bonusesResult.error && bonusesResult.error.code !== "42501") throw bonusesResult.error;
    return {
      employees: employeesResult.data || [],
      timeEntries: entriesResult.data || [],
      bonuses: bonusesResult.data || []
    };
  }

  async function clockIn(employeeId, locationId) {
    const { data, error } = await client.rpc("clock_in_employee", {
      target_employee: employeeId,
      target_location: locationId
    });
    if (error) throw error;
    return data;
  }

  async function clockOut(employeeId) {
    const { data, error } = await client.rpc("clock_out_employee", { target_employee: employeeId });
    if (error) throw error;
    return data;
  }

  async function saveEmployee(locationId, employee, recalculatePast = false) {
    const values = {
      name: employee.name,
      hourly_rate: employee.hourlyRate,
      active: employee.active
    };
    const query = employee.id
      ? client.from("employees").update(values).eq("id", employee.id)
      : client.from("employees").insert({ ...values, location_id: locationId });
    const { error } = await query;
    if (error) throw error;
    if (employee.id && recalculatePast) {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 2);
      const { error: rateError } = await client
        .from("time_entries")
        .update({ hourly_rate: employee.hourlyRate })
        .eq("employee_id", employee.id)
        .gte("clock_in", cutoff.toISOString());
      if (rateError) throw rateError;
    }
  }

  async function deleteEmployee(employeeId) {
    const { error } = await client.from("employees").delete().eq("id", employeeId);
    if (error) throw error;
  }

  async function addTimeEntry(locationId, entry) {
    const { error } = await client.from("time_entries").insert({
      location_id: locationId,
      employee_id: entry.employeeId,
      hourly_rate: entry.hourlyRate,
      clock_in: entry.clockIn,
      clock_out: entry.clockOut
    });
    if (error) throw error;
  }

  async function updateTimeEntry(entry) {
    const { error } = await client.from("time_entries").update({
      location_id: entry.locationId,
      employee_id: entry.employeeId,
      hourly_rate: entry.hourlyRate,
      clock_in: entry.clockIn,
      clock_out: entry.clockOut
    }).eq("id", entry.id);
    if (error) throw error;
  }

  async function deleteTimeEntry(locationId, entryId) {
    const { error } = await client.from("time_entries").delete().eq("id", entryId);
    if (error) throw error;
  }

  async function saveBonus(locationId, bonus) {
    const { error } = await client.from("employee_bonuses").upsert({
      location_id: locationId,
      employee_id: bonus.employeeId,
      date_key: bonus.dateKey,
      amount: bonus.amount,
      note: bonus.note || ""
    }, { onConflict: "employee_id,date_key" });
    if (error) throw error;
  }

  async function deleteBonus(locationId, bonusId) {
    const { error } = await client.from("employee_bonuses").delete().eq("id", bonusId);
    if (error) throw error;
  }

  async function deleteTimeTracking() {
    const { error: bonusError } = await client.from("employee_bonuses").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (bonusError) throw bonusError;
    const { error: entryError } = await client.from("time_entries").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (entryError) throw entryError;
  }

  function subscribe(locationId, callback, userId, membershipCallback, timeCallback, allSalesCallback = null, locationSalesCallback = null) {
    const saleCallback = locationSalesCallback || callback;
    if (channel) client.removeChannel(channel);
    channel = client.channel(`location-${locationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "location_state", filter: `location_id=eq.${locationId}` }, callback)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales", filter: `location_id=eq.${locationId}` }, saleCallback)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_balances", filter: `location_id=eq.${locationId}` }, saleCallback)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_locations", filter: `user_id=eq.${userId}` }, membershipCallback)
      .on("postgres_changes", { event: "*", schema: "public", table: "locations" }, membershipCallback)
      .on("postgres_changes", { event: "*", schema: "public", table: "employees" }, timeCallback)
      .on("postgres_changes", { event: "*", schema: "public", table: "time_entries" }, timeCallback)
      .on("postgres_changes", { event: "*", schema: "public", table: "employee_bonuses" }, timeCallback);
    if (allSalesCallback) {
      channel
        .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, allSalesCallback)
        .on("postgres_changes", { event: "*", schema: "public", table: "cash_balances" }, allSalesCallback);
    }
    channel.subscribe();
  }

  global.CloudStore = {
    configured, client, signIn, signOut, session, locations, adminLocations, createLocation, deleteLocation, updateLocation, loadLocation, loadReportsForLocations,
    saveState, saveCatalogToLocations, overwriteCatalogToLocations, syncCatalogToAllLocations, syncMasterData, syncLocationMemberships, insertSale, saveSale, deleteSale, deleteSalesByIds, saveCash, deleteCash, deleteSales,
    loadTimeTracking, clockIn, clockOut, saveEmployee, syncEmployees, deleteEmployee, addTimeEntry, updateTimeEntry, deleteTimeEntry, saveBonus, deleteBonus, deleteTimeTracking,
    subscribe, flushQueue
  };
  global.addEventListener("online", flushQueue);
})(globalThis);
