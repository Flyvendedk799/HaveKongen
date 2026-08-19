// Identify birds from a garden audio recording using OpenAI audio input.
// Returns: { birds: [{ name_da, latin?, confidence, sound_type?, reason? }], summary }
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { audio, format, durationSeconds, context } = await req.json();
    if (!audio || typeof audio !== "string") {
      return json({ error: "audio (base64 WAV/MP3) is required" }, 400);
    }
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY not configured" }, 500);

    // Accept both a bare base64 string and a data URL.
    const base64 = audio.startsWith("data:") ? audio.slice(audio.indexOf(",") + 1) : audio;
    const audioFormat = format === "mp3" ? "mp3" : "wav";
    const duration = typeof durationSeconds === "number" && durationSeconds > 0
      ? Math.round(durationSeconds)
      : null;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-audio-preview",
        modalities: ["text"],
        messages: [
          {
            role: "system",
            content:
              "Du er en dansk ornitolog. Du får en lydoptagelse fra en dansk have og skal identificere de fugle, " +
              "der faktisk kan høres i optagelsen (sang, kald eller trommen). Svar altid på dansk. " +
              "Medtag KUN arter du reelt kan høre — gæt ikke ud fra årstid eller sandsynlighed alene. " +
              "Ignorér menneskestemmer, trafik, vind og andre ikke-fugle-lyde. " +
              "Er der ingen fugle, eller er lyden for utydelig, så returnér en tom liste og forklar det i summary. " +
              "Brug danske artsnavne (fx solsort, musvit, gærdesmutte) og latinske navne hvor du kan.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  `Hvilke fugle kan høres i denne optagelse${duration ? ` (ca. ${duration} sekunder)` : ""}?` +
                  ` Returnér struktureret svar.${context ? `\nHavekontekst: ${JSON.stringify(context)}` : ""}`,
              },
              { type: "input_audio", input_audio: { data: base64, format: audioFormat } },
            ],
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "bird_identification",
            description: "List the bird species audible in the recording",
            parameters: {
              type: "object",
              properties: {
                birds: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name_da: { type: "string", description: "Dansk artsnavn" },
                      latin: { type: "string", description: "Latinsk navn" },
                      confidence: { type: "string", enum: ["high", "medium", "low"] },
                      sound_type: { type: "string", description: "fx sang, kald, alarmkald, trommen" },
                      reason: { type: "string", description: "Kort begrundelse på dansk (1 sætning)" },
                    },
                    required: ["name_da", "confidence"],
                    additionalProperties: false,
                  },
                },
                summary: { type: "string", description: "Kort dansk opsummering af lydbilledet (1-2 sætninger)" },
              },
              required: ["birds", "summary"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "bird_identification" } },
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
    if (!call) return json({ error: "Ingen analyse af optagelsen" }, 500);
    const args = JSON.parse(call.function.arguments);

    const birds = (Array.isArray(args.birds) ? args.birds : [])
      .filter((bird: unknown): bird is Record<string, unknown> =>
        Boolean(bird && typeof bird === "object" && typeof (bird as Record<string, unknown>).name_da === "string" &&
          ((bird as Record<string, unknown>).name_da as string).trim().length > 0))
      .slice(0, 12)
      .map((bird) => ({
        name_da: String(bird.name_da).trim(),
        latin: typeof bird.latin === "string" && bird.latin.trim() ? bird.latin.trim() : null,
        confidence: bird.confidence === "high" || bird.confidence === "medium" ? bird.confidence : "low",
        sound_type: typeof bird.sound_type === "string" && bird.sound_type.trim() ? bird.sound_type.trim() : null,
        reason: typeof bird.reason === "string" && bird.reason.trim() ? bird.reason.trim() : null,
      }));

    return json({ birds, summary: typeof args.summary === "string" ? args.summary : "" }, 200);
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
