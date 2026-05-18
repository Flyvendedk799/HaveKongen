import { CalendarDays, CheckCircle2, Clock, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CareAction } from "@/lib/companionTypes";

type Props = {
  actions: CareAction[];
  suggestions: Omit<CareAction, "id">[];
  zoneNames: Record<string, string>;
  onComplete: (id: string) => void;
  onSnooze: (id: string) => void;
  onCreateSuggestion: (action: Omit<CareAction, "id">) => void;
  onGenerateSuggestions?: () => void;
  generatingSuggestions?: boolean;
};

function dueLabel(iso?: string | null) {
  if (!iso) return "uden dato";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return `i dag kl. ${d.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString("da-DK", { weekday: "short", day: "numeric", month: "short" });
}

function priorityText(p: CareAction["priority"]) {
  if (p === "urgent") return "Akut";
  if (p === "high") return "Vigtig";
  if (p === "low") return "Lav";
  return "Normal";
}

export default function CarePlan({ actions, suggestions, zoneNames, onComplete, onSnooze, onCreateSuggestion, onGenerateSuggestions, generatingSuggestions }: Props) {
  const open = actions.filter((a) => a.status === "open").sort((a, b) => {
    const order = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
    return order[a.priority] - order[b.priority];
  });

  return (
    <div className="companion-plan">
      <section className="companion-band">
        <div className="companion-section-head">
          <div>
            <div className="companion-eyebrow">Plejeplan</div>
            <h2>Alt der skal gøres, sorteret efter risiko og timing.</h2>
          </div>
          <div className="companion-plan-tools">
            {onGenerateSuggestions && (
              <Button variant="outline" size="sm" onClick={onGenerateSuggestions} disabled={generatingSuggestions}>
                {generatingSuggestions ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Sparkles size={14} className="mr-1.5" />}
                Hent AI-forslag
              </Button>
            )}
            <div className="companion-plan-count">
              <CalendarDays size={15} /> {open.length} åbne
            </div>
          </div>
        </div>

        {open.length === 0 ? (
          <div className="companion-empty">
            <CheckCircle2 size={18} />
            Ingen åbne opgaver. Scan et bed eller tilføj planter for at få en skarpere plan.
          </div>
        ) : (
          <div className="companion-task-grid">
            {open.map((action) => (
              <article key={action.id} className={`companion-task companion-task--${action.priority}`}>
                <div className="companion-task-top">
                  <span>{priorityText(action.priority)}</span>
                  <small>{action.source}</small>
                </div>
                <h3>{action.title}</h3>
                {action.reason && <p>{action.reason}</p>}
                <div className="companion-task-meta">
                  <span><Clock size={12} /> {dueLabel(action.due_at)}</span>
                  {action.zone_id && <span>{zoneNames[action.zone_id] ?? "Zone"}</span>}
                  {typeof action.confidence === "number" && <span>{Math.round(action.confidence * 100)}% sikker</span>}
                </div>
                <div className="companion-task-actions">
                  <Button variant="outline" size="sm" onClick={() => onSnooze(action.id)}>Snooze</Button>
                  <Button size="sm" onClick={() => onComplete(action.id)}>
                    <CheckCircle2 size={14} className="mr-1.5" /> Klar
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {suggestions.length > 0 && (
        <section className="companion-band">
          <div className="companion-section-head">
            <div>
              <div className="companion-eyebrow">Forslag fra kompagnonen</div>
              <h2>Handlinger vi kan lægge ind i planen.</h2>
            </div>
          </div>
          <div className="companion-suggestions">
            {suggestions.slice(0, 6).map((action, index) => (
              <article key={`${action.kind}-${index}`} className="companion-suggestion">
                <Sparkles size={16} />
                <div>
                  <h3>{action.title}</h3>
                  {action.reason && <p>{action.reason}</p>}
                </div>
                <Button variant="outline" size="sm" onClick={() => onCreateSuggestion(action)}>
                  Tilføj
                </Button>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
