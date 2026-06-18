// Identify a plant from a photo using Lovable AI (Gemini vision).
// Returns: { name_da, latin?, category?, confidence, candidate_slugs[], care_tip }
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { image, catalog, context } = await req.json();
    if (!image || typeof image !== "string") {
      return json({ error: "image (data URL or http URL) is required" }, 400);
    }
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY not configured" }, 500);

    const catalogRows = Array.isArray(catalog)
      ? catalog as { slug: string; name_da: string; latin?: string | null }[]
      : [];
    const catalogHint = catalogRows.length > 0
      ? `\n\nIf one of these slugs match, prefer it:\n${catalogRows.slice(0, 200).map((c) => `- ${c.slug}: ${c.name_da}${c.latin ? " (" + c.latin + ")" : ""}`).join("\n")}`
      : "";

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Du er en dansk haveekspert. Identificér planten på billedet. Svar altid på dansk. Vær præcis. " +
              "Hvis du ikke er sikker, sæt confidence=low og foreslå 2-3 muligheder. " +
              "Giv også et praktisk forslag til placering/zone-fit hvis havekontekst er med." + catalogHint,
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Hvad er det for en plante? Returnér struktureret svar.${context ? `\nHavekontekst: ${JSON.stringify(context)}` : ""}` },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "plant_identification",
            description: "Identify a plant from a photo",
            parameters: {
              type: "object",
              properties: {
                name_da: { type: "string", description: "Dansk navn" },
                latin: { type: "string", description: "Latinsk navn" },
                category: { type: "string", description: "fx grøntsag, krydderurt, busk, blomst, frugttræ" },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                candidate_slugs: {
                  type: "array",
                  items: { type: "string" },
                  description: "Matchende slugs fra kataloget (kan være tom)",
                },
                care_tip: { type: "string", description: "Kort plejetip på dansk (1-2 sætninger)" },
                water_need: { type: "string", enum: ["low", "medium", "high"] },
                sun: { type: "string", enum: ["sun", "part", "shade"] },
                suggested_zone_fit: { type: "string", description: "Kort vurdering af om den valgte zone passer til planten" },
                lifecycle_stage: { type: "string", description: "fx frøplante, vegetativ, blomstrer, frugtsætter, moden" },
                care_metadata: {
                  type: "object",
                  properties: {
                    edible: { type: "boolean" },
                    perennial: { type: "boolean" },
                    frost_sensitive: { type: "boolean" },
                    map_hint: { type: "string" },
                  },
                  additionalProperties: false,
                },
              },
              required: ["name_da", "confidence", "care_tip"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "plant_identification" } },
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      console.error("AI gateway error", res.status, t);
      if (res.status === 429) return json({ error: "AI er optaget — prøv igen om lidt" }, 429);
      if (res.status === 402) return json({ error: "AI-kredit opbrugt" }, 402);
      return json({ error: "AI-fejl" }, 500);
    }
    const data = await res.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) return json({ error: "Ingen identifikation" }, 500);
    const args = JSON.parse(call.function.arguments);
    return json(args, 200);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "Ukendt fejl" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
