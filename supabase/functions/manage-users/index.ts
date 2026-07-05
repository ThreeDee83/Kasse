import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeLocationIds(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))]
    : [];
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Methode nicht erlaubt." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization") || "";
  if (!supabaseUrl || !anonKey || !serviceKey || !authorization) {
    return response({ error: "Benutzerverwaltung ist nicht vollständig konfiguriert." }, 500);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  const caller = userData.user;
  if (userError || !caller) return response({ error: "Anmeldung ist abgelaufen." }, 401);

  const { data: adminMemberships, error: membershipError } = await adminClient
    .from("user_locations")
    .select("location_id")
    .eq("user_id", caller.id)
    .eq("role", "admin");
  if (membershipError) return response({ error: membershipError.message }, 500);

  const adminLocationIds = (adminMemberships || []).map((entry) => entry.location_id);
  if (!adminLocationIds.length) return response({ error: "Administratorrechte erforderlich." }, 403);

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return response({ error: "Ungültige Anfrage." }, 400);
  }
  const action = String(payload.action || "list");

  if (action === "list") {
    const [{ data: usersData, error: usersError }, { data: memberships, error: linksError }] = await Promise.all([
      adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      adminClient
        .from("user_locations")
        .select("user_id,location_id,role")
        .in("location_id", adminLocationIds),
    ]);
    if (usersError) return response({ error: usersError.message }, 500);
    if (linksError) return response({ error: linksError.message }, 500);

    const linksByUser = new Map<string, Array<{ locationId: string; role: string }>>();
    for (const link of memberships || []) {
      const entries = linksByUser.get(link.user_id) || [];
      entries.push({ locationId: link.location_id, role: link.role });
      linksByUser.set(link.user_id, entries);
    }

    const users = (usersData.users || [])
      .filter((user) => linksByUser.has(user.id))
      .map((user) => ({
        id: user.id,
        email: user.email || "Ohne E-Mail",
        createdAt: user.created_at,
        isCurrentUser: user.id === caller.id,
        memberships: linksByUser.get(user.id) || [],
      }))
      .sort((a, b) => a.email.localeCompare(b.email, "de"));
    return response({ ok: true, users });
  }

  const requestedIds = normalizeLocationIds(payload.locationIds);
  const locationIds = requestedIds.filter((id) => adminLocationIds.includes(id));
  if (!locationIds.length && action !== "remove") {
    return response({ error: "Mindestens einen verwalteten Standort auswählen." }, 400);
  }
  if (locationIds.length !== requestedIds.length) {
    return response({ error: "Keine Berechtigung für einen ausgewählten Standort." }, 403);
  }
  const role = payload.role === "admin" ? "admin" : "staff";

  if (action === "create") {
    const email = String(payload.email || "").trim().toLowerCase();
    const password = String(payload.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return response({ error: "Eine gültige E-Mail-Adresse eingeben." }, 400);
    }
    if (password.length < 8) return response({ error: "Das Passwort muss mindestens 8 Zeichen haben." }, 400);

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) return response({ error: createError?.message || "Benutzer konnte nicht angelegt werden." }, 400);

    const rows = locationIds.map((locationId) => ({
      user_id: created.user.id,
      location_id: locationId,
      role,
    }));
    const { error: insertError } = await adminClient.from("user_locations").insert(rows);
    if (insertError) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      return response({ error: insertError.message }, 500);
    }
    return response({ ok: true });
  }

  if (action !== "update" && action !== "remove") {
    return response({ error: "Unbekannte Aktion." }, 400);
  }

  const targetUserId = String(payload.userId || "");
  if (!targetUserId) return response({ error: "Benutzer fehlt." }, 400);
  if (targetUserId === caller.id) {
    return response({ error: "Das eigene Administratorkonto kann hier nicht geändert oder entfernt werden." }, 400);
  }

  const { data: sharedMemberships, error: sharedError } = await adminClient
    .from("user_locations")
    .select("location_id")
    .eq("user_id", targetUserId)
    .in("location_id", adminLocationIds);
  if (sharedError) return response({ error: sharedError.message }, 500);
  if (!sharedMemberships?.length) return response({ error: "Benutzer gehört zu keinem verwalteten Standort." }, 404);

  if (action === "update") {
    const rows = locationIds.map((locationId) => ({
      user_id: targetUserId,
      location_id: locationId,
      role,
    }));
    const { error: updateError } = await adminClient
      .from("user_locations")
      .upsert(rows, { onConflict: "user_id,location_id" });
    if (updateError) return response({ error: updateError.message }, 500);

    const removedLocationIds = adminLocationIds.filter((locationId) => !locationIds.includes(locationId));
    if (removedLocationIds.length) {
      const { error: removeOldError } = await adminClient
        .from("user_locations")
        .delete()
        .eq("user_id", targetUserId)
        .in("location_id", removedLocationIds);
      if (removeOldError) return response({ error: removeOldError.message }, 500);
    }
    return response({ ok: true });
  }

  if (action === "remove") {
    const { error: deleteLinksError } = await adminClient
      .from("user_locations")
      .delete()
      .eq("user_id", targetUserId)
      .in("location_id", adminLocationIds);
    if (deleteLinksError) return response({ error: deleteLinksError.message }, 500);

    const { count, error: countError } = await adminClient
      .from("user_locations")
      .select("*", { count: "exact", head: true })
      .eq("user_id", targetUserId);
    if (countError) return response({ error: countError.message }, 500);
    if ((count || 0) === 0) {
      const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(targetUserId);
      if (deleteUserError) return response({ error: deleteUserError.message }, 500);
    }
    return response({ ok: true });
  }
});
