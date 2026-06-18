import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ZoneIn = {
  id: string;
  name: string;
  type: string;
  area_m2: number | null;
  sun_exposure?: string | null;
  soil?: string | null;
  plants?: { name: string; water_need?: string | null }[];
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { zones, lat, lng } = await req.json() as { zones: ZoneIn[]; lat: number; lng: number };
    if (!Array.isArray(zones) || zones.length === 0) {
      return new Response(JSON.stringify({ error: "zones required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Forecast (14d)
    let forecast: any = null;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=precipitation_sum,temperature_2m_max,et0_fao_evapotranspiration&timezone=Europe%2FCopenhagen&forecast_days=14`;
      forecast = await fetch(url).then((r) => r.json());
    } catch (_e) { /* tolerate */ }

    const fcSummary = forecast?.daily ? {
      total_precip_mm: (forecast.daily.precipitation_sum ?? []).reduce((a: number, b: number) => a + b, 0).toFixed(1),
      max_temp: Math.max(...(forecast.daily.temperature_2m_max ?? [18])),
      avg_et0: ((forecast.daily.et0_fao_evapotranspiration ?? []).reduce((a: number, b: number) => a + b, 0) / Math.max(1, (forecast.daily.et0_fao_evapotranspiration ?? []).length)).toFixed(2),
      days: (forecast.daily.time ?? []).slice(0, 7).map((t: string, i: number) => ({
        date: t,
        precip_mm: forecast.daily.precipitation_sum?.[i] ?? 0,
        temp_max: forecast.daily.temperature_2m_max?.[i] ?? 0,
      })),
    } : null;

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");

    const month = new Date().toLocaleString("da-DK", { month: "long" });

    const sysPrompt = `Du er en dansk havemand-AI. Lav en vandingsplan for hver zone for de næste 7 dage.
Regler:
- Brug zone-type, areal, sol, jord og planternes vandingsbehov.
- Vand tidligt om morgenen (05:30-07:30) for at undgå fordampning.
- Sandet jord: hyppigere, kortere. Lerjord: sjældnere, længere.
- Højt vandbehov + fuld sol + sandet jord = 4-5 gange/uge, 15-20 min.
- Lavt vandbehov eller skygge = 1-2 gange/uge, 10 min.
- Plæner i Danmark i ${month}: typisk 1-2 gange/uge, 20-30 min hvis tørt.
- Drivhus: dagligt, 5-10 min.
- Aldrig vand på dage med mere end 4mm regn ventet.
- weekday_mask: bit 0 = mandag, bit 6 = søndag. Eksempler: alle dage = 127, man/ons/fre = 21.
- Returnér KUN via tool-kaldet, ingen prosa.`;

    const userPrompt = `Have ved (${lat}, ${lng}). Måned: ${month}.
Vejr (14 dage): ${fcSummary ? JSON.stringify(fcSummary) : "ukendt"}.

Zoner:
${zones.map((z) => `- ${z.id} · ${z.name} · type=${z.type} · ${z.area_m2 ?? "?"} m² · sol=${z.sun_exposure ?? "?"} · jord=${z.soil ?? "?"}${z.plants?.length ? ` · planter: ${z.plants.map(p => `${p.name}(${p.water_need ?? "med"})`).join(", ")}` : ""}`).join("\n")}`;

    const aiBody = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: sysPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [{
        type: "function",
        function: {
          name: "set_watering_plan",
          description: "Returner vandingsplan pr zone",
          parameters: {
            type: "object",
            properties: {
              summary: { type: "string", description: "Kort dansk opsummering (1-2 sætninger) der forklarer planen overordnet" },
              zones: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    zone_id: { type: "string" },
                    reasoning: { type: "string", description: "Kort forklaring på dansk for denne zones plan" },
                    schedules: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          weekday_mask: { type: "integer", minimum: 1, maximum: 127 },
                          start_time: { type: "string", description: "HH:MM" },
                          duration_min: { type: "integer", minimum: 3, maximum: 60 },
                        },
                        required: ["name", "weekday_mask", "start_time", "duration_min"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["zone_id", "reasoning", "schedules"],
                  additionalProperties: false,
                },
              },
            },
            required: ["summary", "zones"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "set_watering_plan" } },
    };

    const aiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(aiBody),
    });

    if (aiResp.status === 429) {
      return new Response(JSON.stringify({ error: "AI er optaget, prøv igen om lidt." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (aiResp.status === 402) {
      return new Response(JSON.stringify({ error: "AI-kreditter brugt op." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI gateway error", aiResp.status, t);
      return new Response(JSON.stringify({ error: "AI-fejl" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await aiResp.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify({ error: "Tomt AI-svar" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const plan = JSON.parse(toolCall.function.arguments);
    return new Response(JSON.stringify(plan), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-watering-plan", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
