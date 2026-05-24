import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE_PROMPT = `Du er Havekongens Plantepleje AI — en venlig, erfaren havekonsulent for danske haveejere.

Du hjælper med:
- Beskæring (hvornår, hvordan, hvilke værktøjer)
- Gødning og jordpleje (NPK, kompost, kalk)
- Sygdomme og skadedyr (helst økologisk behandling)
- Plantevalg (jord, lys, dansk klima, hårdførhedszoner 7-8)
- Sæsonpleje måned for måned
- Vandingsråd og tørkepleje
- Plæneklipning og græspleje
- Billed-diagnose: identificér plante/sygdom og giv konkrete råd

Stil:
- Svar altid på dansk, varmt og direkte
- Vær konkret: nævn mængder, måneder, timing
- Brug markdown med korte afsnit, lister, **fed** til vigtige pointer
- Når brugerens have-data er relevant: REFERÉR konkret til den ("din tomatzone", "i går fik dit staudebed 6 mm regn")
- Når rådet bør blive til handling, foreslå tydeligt: opret opgave, gem i journal, scan igen, åbn Havekompagnon eller mål haven
- Ved komplekse problemer: slut med en kort "Handlingsplan" med 2-5 konkrete punkter, hver med timing
- Hvis billed- eller diagnoseconfidence er lav, sig hvad brugeren skal fotografere eller observere næste gang
- Anbefal kun produkter når det faktisk løser problemet; prioriter praktiske plejehandlinger først`;

function buildClientContext(payload: {
  mode?: string;
  uiContext?: unknown;
  diagnosis?: unknown;
  identify?: unknown;
  growth?: unknown;
}) {
  const lines: string[] = [];
  if (payload.mode) lines.push(`AKTUEL ARBEJDSGANG: ${payload.mode}`);
  if (payload.uiContext) {
    lines.push(`VALGT APP-KONTEKST: ${JSON.stringify(payload.uiContext).slice(0, 6000)}`);
  }
  if (payload.diagnosis) {
    lines.push(`STRUKTURERET DIAGNOSE FRA FOTO: ${JSON.stringify(payload.diagnosis).slice(0, 2500)}`);
  }
  if (payload.identify) {
    lines.push(`STRUKTURERET PLANTEIDENTIFIKATION FRA FOTO: ${JSON.stringify(payload.identify).slice(0, 2500)}`);
  }
  if (payload.growth) {
    lines.push(`STRUKTURERET VÆKSTTJEK FRA FOTO: ${JSON.stringify(payload.growth).slice(0, 2500)}`);
  }
  if (!lines.length) return "";
  return `\n\n--- AKTUELT PLANTEPLEJE-WORKSPACE ---\n${lines.join("\n")}\n--- SLUT WORKSPACE ---`;
}

async function buildContext(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const sb = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;

    const [{ data: gardens }, { data: zones }, { data: plants }, { data: events }] = await Promise.all([
      sb.from("gardens").select("id,name,latitude,longitude,address").eq("user_id", user.id).limit(3),
      sb.from("garden_zones").select("id,garden_id,name,type,area_m2,sun_exposure,soil").eq("user_id", user.id).limit(20),
      sb.from("user_plants").select("zone_id,custom_name,plant_slug,qty,planted_at").eq("user_id", user.id).limit(30),
      sb.from("watering_events").select("zone_id,scheduled_for,ran_at,weather_skipped,reason,mm_delivered").eq("user_id", user.id).order("scheduled_for", { ascending: false }).limit(10),
    ]);

    const lines: string[] = [];
    if (gardens?.length) {
      lines.push(`HAVE: ${gardens.map(g => `"${g.name}"${g.address ? ` (${g.address})` : ""}`).join(", ")}.`);
    }
    if (zones?.length) {
      lines.push(`ZONER (${zones.length}):`);
      for (const z of zones) {
        lines.push(`- ${z.name} · ${z.type}${z.area_m2 ? ` ${Math.round(Number(z.area_m2))}m²` : ""}${z.sun_exposure ? ` · sol=${z.sun_exposure}` : ""}${z.soil ? ` · jord=${z.soil}` : ""}`);
      }
    }
    if (plants?.length) {
      const byZone: Record<string, string[]> = {};
      for (const p of plants) {
        const k = p.zone_id ?? "uden_zone";
        (byZone[k] ||= []).push(`${p.custom_name || p.plant_slug || "plante"}${p.qty > 1 ? ` ×${p.qty}` : ""}`);
      }
      lines.push(`PLANTER pr zone: ${Object.entries(byZone).map(([z, arr]) => {
        const zname = zones?.find(zz => zz.id === z)?.name ?? "uden zone";
        return `${zname}: ${arr.join(", ")}`;
      }).join(" | ")}`);
    }
    if (events?.length) {
      lines.push(`SENESTE VANDINGER:`);
      for (const e of events.slice(0, 6)) {
        const zname = zones?.find(z => z.id === e.zone_id)?.name ?? "zone";
        const when = new Date(e.scheduled_for).toLocaleDateString("da-DK", { weekday: "short", day: "numeric", month: "short" });
        lines.push(`- ${zname} · ${when} · ${e.weather_skipped ? `sprunget over (${e.reason ?? "regn"})` : `vandet ${e.mm_delivered ?? "?"} mm`}`);
      }
    }

    // Fetch weather for first garden
    if (gardens?.[0]?.latitude && gardens[0].longitude) {
      try {
        const om = `https://api.open-meteo.com/v1/forecast?latitude=${gardens[0].latitude}&longitude=${gardens[0].longitude}&daily=precipitation_sum,temperature_2m_max&timezone=Europe%2FCopenhagen&forecast_days=5`;
        const j = await fetch(om).then(r => r.json());
        const dates = j?.daily?.time ?? [];
        if (dates.length) {
          lines.push(`VEJR (5d): ${dates.map((d: string, i: number) => `${d}: ${j.daily.precipitation_sum[i]}mm/${Math.round(j.daily.temperature_2m_max[i])}°`).join(" · ")}`);
        }
      } catch {
        console.warn("Weather context unavailable for plant-care-chat");
      }
    }

    if (!lines.length) return null;
    return `\n\n--- BRUGERENS HAVE-KONTEKST (brug det aktivt i svar) ---\n${lines.join("\n")}\n--- SLUT KONTEKST ---`;
  } catch (e) {
    console.error("ctx build", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, hasImage, mode, uiContext, diagnosis, identify, growth } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const ctx = await buildContext(req.headers.get("Authorization"));
    const sys = BASE_PROMPT + (ctx ?? "") + buildClientContext({ mode, uiContext, diagnosis, identify, growth });

    const model = hasImage ? "google/gemini-2.5-pro" : "google/gemini-2.5-flash";

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: sys }, ...messages],
        stream: true,
      }),
    });

    if (response.status === 429) {
      return new Response(JSON.stringify({ error: "Du sender for mange beskeder. Prøv igen om lidt." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (response.status === 402) {
      return new Response(JSON.stringify({ error: "AI-kreditter er opbrugt. Tilføj flere i workspace-indstillingerne." }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!response.ok) {
      const t = await response.text();
      console.error("Gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI-tjenesten svarer ikke." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("plant-care-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
