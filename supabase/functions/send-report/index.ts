import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Methode nicht erlaubt." }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "Anmeldung erforderlich." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const brevoApiKey = Deno.env.get("BREVO_API_KEY");
  const fromEmail = Deno.env.get("BREVO_FROM_EMAIL");
  const fromName = Deno.env.get("BREVO_FROM_NAME") || "Kassenraum";
  if (!supabaseUrl || !supabaseAnonKey || !brevoApiKey || !fromEmail) {
    return json({ error: "E-Mail-Versand ist serverseitig nicht vollständig konfiguriert." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Ungültige Anfrage." }, 400);
  }

  const locationId = String(body.locationId || "");
  const filename = String(body.filename || "Abrechnung.xlsx").replace(/[^\p{L}\p{N}._ -]/gu, "_");
  const attachmentBase64 = String(body.attachmentBase64 || "");
  const period = String(body.period || "Abrechnung").slice(0, 120);
  const summary = body.summary || {};

  if (!locationId || !attachmentBase64) return json({ error: "Abrechnung oder Standort fehlt." }, 400);
  if (attachmentBase64.length > 20_000_000) return json({ error: "Die Exceldatei ist für den E-Mail-Versand zu groß." }, 413);

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json({ error: "Anmeldung ist abgelaufen." }, 401);

  const [locationResult, stateResult] = await Promise.all([
    supabase.from("locations").select("name").eq("id", locationId).maybeSingle(),
    supabase.from("location_state").select("settings").eq("location_id", locationId).maybeSingle(),
  ]);
  if (locationResult.error || !locationResult.data || stateResult.error || !stateResult.data) {
    return json({ error: "Kein Zugriff auf diesen Standort." }, 403);
  }

  const recipient = String(stateResult.data.settings?.billingEmail || "").trim();
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return json({ error: "Im Adminbereich ist keine gültige Abrechnungs-E-Mail hinterlegt." }, 400);
  }

  const locationName = String(locationResult.data.name || "Standort");
  const revenue = Number(summary.revenue || 0).toLocaleString("de-AT", { style: "currency", currency: "EUR" });
  const text = [
    `Abrechnung für ${locationName}`,
    `Zeitraum: ${period}`,
    `Umsatz: ${revenue}`,
    `Bons: ${Number(summary.receipts || 0)}`,
    `Artikel: ${Number(summary.itemCount || 0)}`,
    "",
    "Die vollständige Excelabrechnung befindet sich im Anhang.",
  ].join("\n");

  const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": brevoApiKey,
      accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email: recipient }],
      subject: `Abrechnung ${locationName} – ${period}`,
      textContent: text,
      attachment: [{ name: filename, content: attachmentBase64 }],
      headers: { "Idempotency-Key": `${locationId}-${crypto.randomUUID()}` },
    }),
  });

  const brevoData = await brevoResponse.json();
  if (!brevoResponse.ok) {
    console.error("Brevo error", brevoData);
    return json({ error: "Der E-Mail-Dienst hat den Versand abgelehnt." }, 502);
  }

  return json({ ok: true, id: brevoData.messageId });
});
