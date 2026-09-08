import { guard, isBlocked } from "../_shared/http.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-havekongen-anon",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const guarded = await guard(req, { fn: "generate-companion-actions", requireAuth: true, limit: 10, windowSeconds: 60, aiDailyLimit: 30 });
  if (isBlocked(guarded)) return guarded.response;

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { garden_id, persist = false } = await req.json().catch(() => ({}));
    if (!garden_id) return json({ error: "garden_id required" }, 400);

    const [{ data: zones }, { data: observations }, { data: devices }] = await Promise.all([
      sb.from("garden_zones").select("id,name,type,sun_exposure,soil").eq("garden_id", garden_id),
      sb.from("garden_observations").select("id,kind,zone_id,plant_id,ai_result,confidence,created_at").eq("garden_id", garden_id).order("created_at", { ascending: false }).limit(30),
      sb.from("devices").select("id,name,kind,status,battery,metadata").eq("garden_id", garden_id),
    ]);

    const actions = deterministicActions(garden_id, zones ?? [], observations ?? [], devices ?? []);

    if (persist && actions.length > 0) {
      const rows = actions.map((a) => ({
        user_id: user.id,
        garden_id,
        zone_id: a.zone_id ?? null,
        plant_id: a.plant_id ?? null,
        observation_id: a.observation_id ?? null,
        kind: a.kind,
        title: a.title,
        notes: a.reason,
        due_at: a.due_at,
        priority: a.priority,
        source: a.source,
        reason: a.reason,
        confidence: a.confidence,
        payload: a.payload ?? {},
      }));
      await sb.from("task_log").insert(rows);
    }

    return json({ actions }, 200);
  } catch (e) {
    console.error("generate-companion-actions", e);
    return json({ error: e instanceof Error ? e.message : "Ukendt fejl" }, 500);
  }
});

type ZoneRow = { id: string; name: string };
type ObservationRow = {
  id: string;
  kind: string;
  zone_id: string | null;
  plant_id: string | null;
  ai_result: Record<string, unknown> | null;
  confidence: number | null;
};
type DeviceRow = {
  id: string;
  name: string;
  kind: string;
  battery: number | null;
  metadata: Record<string, unknown> | null;
};

function deterministicActions(gardenId: string, zones: ZoneRow[], observations: ObservationRow[], devices: DeviceRow[]) {
  const now = Date.now();
  const due = (hours: number) => new Date(now + hours * 3600_000).toISOString();
  const actions: Record<string, unknown>[] = [];

  for (const observation of observations) {
    const result = observation.ai_result || {};
    const severity = result.severity;
    if ((observation.kind === "diagnosis" || observation.kind === "bed_scan") && (severity === "high" || severity === "medium")) {
      actions.push({
        kind: observation.kind === "bed_scan" ? "bed_followup" : "diagnose",
        title: severity === "high" ? `Akut opfølgning: ${String(result.diagnosis || result.summary || "scan")}` : `Følg op: ${String(result.diagnosis || result.summary || "scan")}`,
        reason: String(result.treatment || result.next_action || "Kontroller området og følg anbefalingen fra scanningen."),
        priority: severity === "high" ? "urgent" : "high",
        due_at: due(severity === "high" ? 6 : 24),
        source: "scan",
        confidence: typeof result.confidence === "number" ? result.confidence : observation.confidence,
        garden_id: gardenId,
        zone_id: observation.zone_id,
        plant_id: observation.plant_id,
        observation_id: observation.id,
        payload: { symptoms: result.symptoms ?? [], causes: result.causes ?? [] },
      });
    }
  }

  for (const device of devices) {
    const zoneId = typeof device.metadata?.zone_id === "string" ? device.metadata.zone_id : null;
    if (typeof device.battery === "number" && device.battery <= 20) {
      actions.push({
        kind: "device_battery",
        title: `Skift batteri på ${device.name}`,
        reason: `Batteriet er nede på ${device.battery}%.`,
        priority: "normal",
        due_at: due(48),
        source: "sensor",
        confidence: 0.95,
        garden_id: gardenId,
        zone_id: zoneId,
        payload: { device_id: device.id, battery: device.battery },
      });
    }
    const moisture = device.metadata?.moisture_pct;
    if (device.kind === "sensor" && typeof moisture === "number" && moisture < 28) {
      const zone = zones.find((z) => z.id === zoneId);
      actions.push({
        kind: "sensor_dry",
        title: `${zone?.name || device.name} er tør`,
        reason: `Sensoren melder ${Math.round(moisture)}% jordfugt. Bekræft før vanding.`,
        priority: "high",
        due_at: due(4),
        source: "sensor",
        confidence: 0.78,
        garden_id: gardenId,
        zone_id: zoneId,
        payload: { device_id: device.id, moisture_pct: moisture },
      });
    }
  }

  return actions.slice(0, 12);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
