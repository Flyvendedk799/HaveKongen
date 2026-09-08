import { guard, isBlocked } from "../_shared/http.ts";
// Centralized weather sync. Fetches 14d Open-Meteo daily data, caches per (lat,lng,date)
// in `weather_cache`. Returns the array.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-havekongen-anon",
};

function round(n: number, p = 3) { return Math.round(n * 10 ** p) / 10 ** p; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const guarded = await guard(req, { fn: "weather-sync", limit: 60, windowSeconds: 60, skipIdentity: true });
  if (isBlocked(guarded)) return guarded.response;
  try {
    const { lat, lng, force } = await req.json();
    if (typeof lat !== "number" || typeof lng !== "number") {
      return new Response(JSON.stringify({ error: "lat/lng required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const rlat = round(lat, 3), rlng = round(lng, 3);

    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(url, key);

    // Try cache first (today + future)
    const today = new Date().toISOString().slice(0, 10);
    if (!force) {
      const { data: cached } = await sb.from("weather_cache")
        .select("date, precip_mm, temp_max, temp_min, et0, wind_max, fetched_at")
        .eq("lat", rlat).eq("lng", rlng).gte("date", today)
        .order("date", { ascending: true });
      const fresh = (cached ?? []).filter((r) => Date.now() - new Date(r.fetched_at).getTime() < 6 * 3600_000);
      if (fresh.length >= 7) {
        return new Response(JSON.stringify({ days: fresh, source: "cache" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${rlat}&longitude=${rlng}&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration,wind_speed_10m_max&timezone=Europe%2FCopenhagen&forecast_days=14`;
    const om = await fetch(omUrl).then((r) => r.json());
    const dates: string[] = om?.daily?.time ?? [];
    const days = dates.map((d, i) => ({
      date: d,
      precip_mm: om.daily.precipitation_sum?.[i] ?? 0,
      temp_max: om.daily.temperature_2m_max?.[i] ?? null,
      temp_min: om.daily.temperature_2m_min?.[i] ?? null,
      et0: om.daily.et0_fao_evapotranspiration?.[i] ?? null,
      wind_max: om.daily.wind_speed_10m_max?.[i] ?? null,
    }));

    if (days.length) {
      const rows = days.map((d) => ({ lat: rlat, lng: rlng, ...d, fetched_at: new Date().toISOString() }));
      await sb.from("weather_cache").upsert(rows, { onConflict: "lat,lng,date" });
    }

    return new Response(JSON.stringify({ days, source: "live" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("weather-sync", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
