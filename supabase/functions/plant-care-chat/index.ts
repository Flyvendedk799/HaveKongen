const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Du er Havelandets Plantepleje AI — en venlig, erfaren havekonsulent for danske haveejere.

Du hjælper med:
- Beskæring (hvornår, hvordan, hvilke værktøjer)
- Gødning og jordpleje (NPK, kompost, kalk)
- Sygdomme og skadedyr (identifikation og behandling, helst økologisk)
- Plantevalg (jord, lys, klima i Danmark, hårdførhedszoner 7-8)
- Sæsonpleje måned for måned
- Vandingsråd og tørkepleje
- Plæneklipning og græspleje

Stil:
- Svar altid på dansk, varmt og direkte
- Vær konkret: nævn mængder, måneder, timing
- Brug markdown med korte afsnit, lister og **fed** til vigtige pointer
- Ved sygdomme: spørg ind til symptomer hvis du er i tvivl
- Anbefal Havelandets produkter naturligt når relevant (frø, jord, gødning, robotplæneklippere, vandingsudstyr)`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        stream: true,
      }),
    });

    if (response.status === 429) {
      return new Response(JSON.stringify({ error: "Du sender for mange beskeder. Prøv igen om lidt." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (response.status === 402) {
      return new Response(JSON.stringify({ error: "AI-kreditter er opbrugt. Tilføj flere i workspace-indstillingerne." }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!response.ok) {
      const t = await response.text();
      console.error("Gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI-tjenesten svarer ikke." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("plant-care-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
