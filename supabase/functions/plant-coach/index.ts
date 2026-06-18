// Per-plant AI care assistant. Streams short Danish answers tailored to a plant + zone context.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { question, plant, zone } = await req.json();
    if (!question) return new Response(JSON.stringify({ error: "question required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return new Response(JSON.stringify({ error: "OPENAI_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const ctx = [
      plant?.name && `Plante: ${plant.name}`,
      plant?.latin && `(${plant.latin})`,
      plant?.water_need && `vandbehov: ${plant.water_need}`,
      plant?.sun && `sol: ${plant.sun}`,
      zone?.name && `bed: ${zone.name}`,
      zone?.sun_exposure && `bed-sol: ${zone.sun_exposure}`,
      zone?.soil && `jord: ${zone.soil}`,
    ].filter(Boolean).join(" · ");

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        stream: true,
        messages: [
          { role: "system", content: `Du er en dansk haveekspert. Svar kort, konkret og venligt på dansk. Maks 4-5 sætninger eller en kort punktliste. Kontekst: ${ctx}` },
          { role: "user", content: question },
        ],
      }),
    });

    if (!r.ok) {
      if (r.status === 429) return new Response(JSON.stringify({ error: "AI er optaget — prøv igen" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (r.status === 402) return new Response(JSON.stringify({ error: "AI-kredit opbrugt" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "AI-fejl" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(r.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "fejl" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
