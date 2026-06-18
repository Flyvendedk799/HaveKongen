// Global garden assistant: streaming chat with tool calling.
// Tools execute server-side against the authenticated user's garden data.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "add_task",
      description: "Tilføj en have-opgave til brugerens task-liste.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          kind: { type: "string", description: "fx 'sow', 'prune', 'harvest', 'water', 'note'" },
          zone_name: { type: "string", description: "Valgfrit: navn på bedet" },
          due_in_days: { type: "number", description: "Valgfrit: antal dage frem" },
          notes: { type: "string" },
        },
        required: ["title"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "log_watering",
      description: "Log at brugeren har vandet et bed.",
      parameters: {
        type: "object",
        properties: {
          zone_name: { type: "string" },
          minutes: { type: "number" },
          notes: { type: "string" },
        },
        required: ["zone_name"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_journal_entry",
      description: "Tilføj en note til have-journalen.",
      parameters: {
        type: "object",
        properties: {
          caption: { type: "string" },
          kind: { type: "string", enum: ["note", "milestone", "harvest", "disease"] },
          zone_name: { type: "string" },
        },
        required: ["caption"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_plant",
      description: "Slå en plante op i kataloget.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"], additionalProperties: false,
      },
    },
  },
];

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

    const { messages = [] } = await req.json();
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "AI ikke konfigureret" }, 500);

    // Build live garden context for system prompt
    const { data: gardens } = await supabase.from("gardens")
      .select("id,name,latitude,longitude").eq("user_id", user.id).limit(1);
    const garden = gardens?.[0];
    const [{ data: zones }, { data: plants }, { data: openTasks }] = await Promise.all([
      supabase.from("garden_zones").select("id,name,type,sun_exposure,soil").eq("garden_id", garden?.id ?? ""),
      supabase.from("user_plants")
        .select("zone_id,custom_name,plant_slug,plants_catalog(name_da,water_need)")
        .eq("garden_id", garden?.id ?? ""),
      supabase.from("task_log").select("title,kind,due_at").eq("user_id", user.id).eq("done", false).limit(10),
    ]);

    const zoneByName = new Map<string, any>();
    (zones ?? []).forEach((z: any) => zoneByName.set(z.name.toLowerCase(), z));

    const systemPrompt = `Du er have-assistent for ${garden?.name ?? "brugerens have"}. Svar kort og konkret på dansk. Brug værktøjer når brugeren beder dig handle (oprette opgaver, logge vanding, journal-note, slå planter op). Bekræft kort efter handlinger.

HAVE-KONTEKST:
${JSON.stringify({
  zones: (zones ?? []).map((z: any) => ({ name: z.name, type: z.type, sun: z.sun_exposure, soil: z.soil })),
  plants: (plants ?? []).map((p: any) => ({
    name: p.custom_name || p.plants_catalog?.name_da || p.plant_slug,
    water: p.plants_catalog?.water_need,
  })),
  open_tasks: (openTasks ?? []).map((t: any) => ({ title: t.title, due: t.due_at })),
})}`;

    // Tool execution loop (non-streaming until tools resolved, then stream final answer)
    let convo: any[] = [{ role: "system", content: systemPrompt }, ...messages];

    for (let i = 0; i < 4; i++) {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: convo,
          tools: TOOLS,
          stream: false,
        }),
      });
      if (!r.ok) {
        if (r.status === 429) return json({ error: "AI er optaget — prøv igen" }, 429);
        if (r.status === 402) return json({ error: "AI-kredit opbrugt" }, 402);
        const t = await r.text(); console.error("AI err", r.status, t);
        return json({ error: "AI-fejl" }, 500);
      }
      const j = await r.json();
      const msg = j?.choices?.[0]?.message;
      if (!msg) return json({ error: "Tomt svar" }, 500);

      const toolCalls = msg.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        // Final answer — stream it back as a single chunk SSE
        const text = msg.content ?? "";
        const sse = sseFor(text);
        return new Response(sse, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
      }

      convo.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });
      for (const tc of toolCalls) {
        const name = tc.function?.name;
        let args: any = {};
        try { args = JSON.parse(tc.function?.arguments ?? "{}"); } catch { /* ignore */ }
        const result = await runTool(supabase, user.id, garden?.id, zoneByName, name, args);
        convo.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      }
    }
    return json({ error: "Tool-loop limit" }, 500);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "fejl" }, 500);
  }
});

async function runTool(supabase: any, userId: string, gardenId: string | undefined, zoneByName: Map<string, any>, name: string, args: any) {
  try {
    if (name === "add_task") {
      const due = args.due_in_days ? new Date(Date.now() + args.due_in_days * 86400_000).toISOString() : null;
      const zone = args.zone_name ? zoneByName.get(String(args.zone_name).toLowerCase()) : null;
      const { data, error } = await supabase.from("task_log").insert({
        user_id: userId, garden_id: gardenId ?? null, zone_id: zone?.id ?? null,
        kind: args.kind ?? "note", title: args.title, notes: args.notes ?? null, due_at: due,
      }).select().single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, task_id: data.id };
    }
    if (name === "log_watering") {
      const zone = zoneByName.get(String(args.zone_name ?? "").toLowerCase());
      if (!zone) return { ok: false, error: "Ukendt bed" };
      const min = Math.max(1, Number(args.minutes ?? 10));
      const mm = Math.round((min / 15) * 5);
      const { data, error } = await supabase.from("watering_events").insert({
        user_id: userId, zone_id: zone.id, schedule_id: null,
        scheduled_for: new Date().toISOString(), ran_at: new Date().toISOString(),
        weather_skipped: false, reason: `Chat · ${min} min`, mm_delivered: mm,
      }).select().single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, event_id: data.id, mm };
    }
    if (name === "add_journal_entry") {
      const zone = args.zone_name ? zoneByName.get(String(args.zone_name).toLowerCase()) : null;
      const { data, error } = await supabase.from("garden_journal").insert({
        user_id: userId, garden_id: gardenId ?? null, zone_id: zone?.id ?? null,
        kind: args.kind ?? "note", caption: args.caption,
      }).select().single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, entry_id: data.id };
    }
    if (name === "lookup_plant") {
      const q = String(args.query ?? "").trim();
      const { data } = await supabase.from("plants_catalog")
        .select("slug,name_da,latin,sun,water_need,sow_months,harvest_months,description")
        .or(`name_da.ilike.%${q}%,latin.ilike.%${q}%,slug.ilike.%${q}%`)
        .limit(3);
      return { ok: true, results: data ?? [] };
    }
    return { ok: false, error: "Ukendt værktøj" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fejl" };
  }
}

function sseFor(text: string) {
  // chunk into ~20 char pieces for token-like feel
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 24) chunks.push(text.slice(i, i + 24));
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const c of chunks) {
        const payload = { choices: [{ delta: { content: c } }] };
        controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`));
        await new Promise(r => setTimeout(r, 18));
      }
      controller.enqueue(enc.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });
  return stream;
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
