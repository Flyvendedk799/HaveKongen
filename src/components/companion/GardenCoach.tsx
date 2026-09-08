import { useMemo, useState } from "react";
import { Bot, Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { invokeFunction } from "@/lib/shop";
import type { Tables } from "@/integrations/supabase/types";
import type { CareAction, CompanionPreferences, HealthScore, ZoneInsight } from "@/lib/companionTypes";

type Garden = Pick<Tables<"gardens">, "id" | "name">;
type Zone = Pick<Tables<"garden_zones">, "id" | "name" | "type">;
type Plant = Tables<"user_plants"> & {
  plants_catalog?: { name_da: string | null; water_need: string | null; image_url: string | null } | null;
};
type Observation = Pick<Tables<"garden_observations">, "kind" | "caption" | "zone_id" | "plant_id" | "created_at">;

type Message = { role: "user" | "assistant"; content: string };

type Props = {
  garden: Garden;
  zones: Zone[];
  plants: Plant[];
  observations: Observation[];
  openActions: CareAction[];
  preferences: CompanionPreferences;
  selectedZoneId?: string | null;
  selectedPlantId?: string | null;
  zoneInsights: Record<string, ZoneInsight[]>;
  gardenHealth: HealthScore;
};

function plantName(plant: Plant) {
  return plant.custom_name || plant.plants_catalog?.name_da || plant.plant_slug || "plante";
}

function fallbackAnswer(prompt: string, props: Props) {
  const selectedZone = props.zones.find((zone) => zone.id === props.selectedZoneId);
  const selectedPlant = props.plants.find((plant) => plant.id === props.selectedPlantId);
  const insight = selectedZone ? props.zoneInsights[selectedZone.id]?.[0] : Object.values(props.zoneInsights).flat()[0];
  const target = selectedPlant ? plantName(selectedPlant) : selectedZone?.name || props.garden.name;
  if (insight) {
    return `${target}: ${insight.title}. ${insight.reason} Næste skridt: ${insight.action_kind}.`;
  }
  if (props.openActions.length > 0) {
    return `${target}: start med "${props.openActions[0].title}". ${props.openActions[0].reason || "Det er den vigtigste åbne handling lige nu."}`;
  }
  return `${target}: haven ser rolig ud. Tag en scanrunde, hvis du vil opdatere kortets hukommelse. Spørgsmål: ${prompt}`;
}

export default function GardenCoach(props: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const prompts = useMemo(() => [
    "Hvad skal jeg gøre i weekenden?",
    "Er denne zone sund?",
    "Hvorfor gulner planten?",
    "Hvad bør jeg scanne næste gang?",
  ], []);

  async function ask(text = input) {
    const prompt = text.trim();
    if (!prompt) return;
    const nextMessages: Message[] = [...messages, { role: "user", content: prompt }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    try {
      const context = {
        garden: props.garden.name,
        selected_zone: props.zones.find((zone) => zone.id === props.selectedZoneId)?.name ?? null,
        selected_plant: props.plants.find((plant) => plant.id === props.selectedPlantId)?.custom_name ?? null,
        health: props.gardenHealth,
        open_actions: props.openActions.slice(0, 6).map((action) => ({ title: action.title, reason: action.reason })),
        recent_observations: props.observations.slice(0, 8),
        preferences: props.preferences,
      };
      // invokeFunction so a rate-limit or daily-quota rejection reaches the
      // user as its own message rather than the generic transport one.
      const data = await invokeFunction<{ content?: string } | string>("garden-chat", {
        messages: [
          { role: "system", content: `Havekompagnon kontekst: ${JSON.stringify(context)}` },
          ...nextMessages,
        ],
      });
      const content = typeof data === "string" ? data : typeof data?.content === "string" ? data.content : fallbackAnswer(prompt, props);
      setMessages((prev) => [...prev, { role: "assistant", content }]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Coach kører på fallback");
      setMessages((prev) => [...prev, { role: "assistant", content: fallbackAnswer(prompt, props) }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="companion-band companion-coach">
      <div className="companion-section-head">
        <div>
          <div className="companion-eyebrow">Havecoach</div>
          <h2>Spørg med hele havens kontekst.</h2>
        </div>
        <Bot size={20} />
      </div>

      <div className="companion-coach-prompts">
        {prompts.map((prompt) => (
          <button key={prompt} onClick={() => ask(prompt)}><Sparkles size={13} /> {prompt}</button>
        ))}
      </div>

      <div className="companion-coach-log">
        {messages.map((message, index) => (
          <article key={index} className={message.role}>
            <strong>{message.role === "user" ? "Dig" : "Havekompagnonen"}</strong>
            <p>{message.content}</p>
          </article>
        ))}
        {messages.length === 0 && <div className="companion-empty"><Bot size={18} /> Vælg et forslag eller stil dit eget spørgsmål.</div>}
      </div>

      <div className="companion-coach-input">
        <Textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Spørg om zone, plante, opgaver eller weekendplan..." rows={2} />
        <Button onClick={() => ask()} disabled={loading || !input.trim()}>
          {loading ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <Send size={15} className="mr-1.5" />}
          Spørg
        </Button>
      </div>
    </section>
  );
}
