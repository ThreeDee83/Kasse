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
      return client
        .from("location_state")
        .update({ data: action.data, updated_at: new Date().toISOString() })
        .in("location_id", action.locationIds);
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
    return (data || []).map((entry) => ({ ...entry.location, role: entry.role }));
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

  function saveCatalogToLocations(locationIds, data) {
    return queued({ type: "catalog", locationIds, data });
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

  function saveState(locationId, data, settings) {
    return queued({ type: "state", locationId, data, settings });
  }

  function insertSale(locationId, sale) {
    return queued({ type: "sale", sale: { ...sale, location_id: locationId } });
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

  async function saveEmployee(locationId, employee) {
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
  }

  async function addTimeEntry(locationId, entry) {
    const { error } = await client.from("time_entries").insert({
      location_id: locationId,
      employee_id: entry.employeeId,
      clock_in: entry.clockIn,
      clock_out: entry.clockOut
    });
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

  function subscribe(locationId, callback, userId, membershipCallback, timeCallback) {
    if (channel) client.removeChannel(channel);
    channel = client.channel(`location-${locationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "location_state", filter: `location_id=eq.${locationId}` }, callback)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales", filter: `location_id=eq.${locationId}` }, callback)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_balances", filter: `location_id=eq.${locationId}` }, callback)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_locations", filter: `user_id=eq.${userId}` }, membershipCallback)
      .on("postgres_changes", { event: "*", schema: "public", table: "employees" }, timeCallback)
      .on("postgres_changes", { event: "*", schema: "public", table: "time_entries" }, timeCallback)
      .on("postgres_changes", { event: "*", schema: "public", table: "employee_bonuses" }, timeCallback)
      .subscribe();
  }

  global.CloudStore = {
    configured, client, signIn, signOut, session, locations, createLocation, deleteLocation, loadLocation,
    saveState, saveCatalogToLocations, insertSale, saveCash, deleteCash, deleteSales,
    loadTimeTracking, clockIn, clockOut, saveEmployee, addTimeEntry, deleteTimeEntry, saveBonus, deleteBonus,
    subscribe, flushQueue
  };
  global.addEventListener("online", flushQueue);
})(globalThis);
