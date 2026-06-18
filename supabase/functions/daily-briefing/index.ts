// Generates a personalised daily morning briefing for the authenticated user.
// On-demand: called from the client when the user opens the "I dag" tab.
// Caches one briefing per user per day in `daily_briefings`.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Brief = {
  weather: string;
  summary: string;
  tasks: { title: string; why?: string }[];
  alerts: { kind: "frost" | "heat" | "rain" | "disease" | "info"; text: string }[];
  tip: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: u } = await supabase.auth.getUser();
    const user = u?.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const force: boolean = !!body?.force;
    const today = new Date().toISOString().slice(0, 10);

    if (!force) {
      const { data: cached } = await supabase
        .from("daily_briefings").select("*")
        .eq("user_id", user.id).eq("for_date", today).maybeSingle();
      if (cached) return json({ briefing: cached, cached: true });
    }

    // Pull garden context
    const { data: gardens } = await supabase.from("gardens")
      .select("id,name,latitude,longitude").eq("user_id", user.id).limit(1);
    const garden = gardens?.[0];

    let weather = "Ukendt vejr";
    let weatherData: any = null;
    if (garden?.latitude && garden?.longitude) {
      try {
        const r = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${garden.latitude}&longitude=${garden.longitude}&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max&timezone=auto&forecast_days=3`
        );
        const j = await r.json();
        const d = j?.daily;
        if (d) {
          weatherData = {
            today: { tmax: d.temperature_2m_max?.[0], tmin: d.temperature_2m_min?.[0], precip: d.precipitation_sum?.[0], wind: d.wind_speed_10m_max?.[0] },
            tomorrow: { tmax: d.temperature_2m_max?.[1], tmin: d.temperature_2m_min?.[1], precip: d.precipitation_sum?.[1] },
          };
          weather = `I dag ${Math.round(weatherData.today.tmax)}° / ${Math.round(weatherData.today.tmin)}°, ${weatherData.today.precip.toFixed(1)} mm regn`;
        }
      } catch { /* ignore */ }
    }

    const [{ data: zones }, { data: tasks }, { data: plants }] = await Promise.all([
      supabase.from("garden_zones").select("id,name,type,sun_exposure,soil")
        .eq("garden_id", garden?.id ?? "00000000-0000-0000-0000-000000000000"),
      supabase.from("task_log").select("id,title,kind,due_at,done")
        .eq("user_id", user.id).eq("done", false).order("due_at", { ascending: true }).limit(20),
      supabase.from("user_plants")
        .select("custom_name,plant_slug,plants_catalog(name_da,water_need,frost_risk)")
        .eq("garden_id", garden?.id ?? "00000000-0000-0000-0000-000000000000"),
    ]);

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "AI ikke konfigureret" }, 500);

    const ctx = {
      garden: garden?.name ?? "haven",
      date: today,
      weather: weatherData,
      zones: (zones ?? []).map((z: any) => ({ name: z.name, type: z.type, sun: z.sun_exposure, soil: z.soil })),
      open_tasks: (tasks ?? []).map((t: any) => ({ title: t.title, kind: t.kind, due: t.due_at })),
      plants: (plants ?? []).map((p: any) => ({
        name: p.custom_name || p.plants_catalog?.name_da || p.plant_slug,
        water: p.plants_catalog?.water_need, frost: p.plants_catalog?.frost_risk,
      })),
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Du er en venlig dansk have-coach. Lav en kort morgen-briefing på dansk. Vær konkret, rolig og praktisk. Brug have-data nøjagtigt." },
          { role: "user", content: `Lav dagens briefing baseret på denne kontekst:\n${JSON.stringify(ctx)}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "set_briefing",
            description: "Strukturér dagens briefing.",
            parameters: {
              type: "object",
              properties: {
                weather: { type: "string", description: "1 sætning om dagens vejr i haven" },
                summary: { type: "string", description: "2-3 sætninger der opsummerer dagens fokus" },
                tasks: {
                  type: "array", maxItems: 3,
                  items: {
                    type: "object",
                    properties: { title: { type: "string" }, why: { type: "string" } },
                    required: ["title"], additionalProperties: false,
                  },
                },
                alerts: {
                  type: "array", maxItems: 3,
                  items: {
                    type: "object",
                    properties: {
                      kind: { type: "string", enum: ["frost", "heat", "rain", "disease", "info"] },
                      text: { type: "string" },
                    },
                    required: ["kind", "text"], additionalProperties: false,
                  },
                },
                tip: { type: "string", description: "1 sæson-tip relateret til brugerens planter" },
              },
              required: ["weather", "summary", "tasks", "alerts", "tip"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "set_briefing" } },
      }),
    });

    if (!r.ok) {
      if (r.status === 429) return json({ error: "AI er optaget — prøv igen" }, 429);
      if (r.status === 402) return json({ error: "AI-kredit opbrugt" }, 402);
      const t = await r.text(); console.error("AI err", r.status, t);
      return json({ error: "AI-fejl" }, 500);
    }
    const j = await r.json();
    const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return json({ error: "Tomt AI-svar" }, 500);
    const brief: Brief = JSON.parse(args);

    const { data: saved, error: saveErr } = await supabase
      .from("daily_briefings")
      .upsert({
        user_id: user.id, garden_id: garden?.id ?? null, for_date: today,
        weather: brief.weather, summary: brief.summary,
        tasks: brief.tasks, alerts: brief.alerts, tip: brief.tip,
      }, { onConflict: "user_id,for_date" })
      .select().single();
    if (saveErr) console.error("save err", saveErr);

    return json({ briefing: saved ?? { ...brief, for_date: today }, cached: false });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "fejl" }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
