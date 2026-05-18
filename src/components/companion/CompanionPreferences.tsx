import { Bot, Bell, CheckCircle2, Clock3, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CompanionPreferences as Preferences } from "@/lib/companionTypes";

type Props = {
  preferences: Preferences;
  onChange: (preferences: Preferences) => void;
};

const GOALS = ["Grøntsager", "Blomster", "Bede", "Drivhus", "Græsplæne", "Høst", "Biodiversitet", "Lav indsats"];
const DEVICES = ["Fugtsensor", "Vandingsventil", "Irrigation controller", "Drivhussensor", "Vejrstation", "Robotplæneklipper"];
const WATERING = ["Manuelt", "Drypvanding", "Siveslange", "Sprinkler", "Smart ventil", "Ved ikke"];

const AUTOMATION = [
  { key: "manual", label: "Manual", text: "Kun anbefalinger. Du gør resten selv." },
  { key: "assisted", label: "Assisteret", text: "Kompagnonen opretter opgaver og påmindelser." },
  { key: "autopilot", label: "Autopilot", text: "Planer justeres automatisk efter vejr, sæson og scans." },
  { key: "device_autopilot", label: "Enheds-autopilot", text: "Kan foreslå device-handlinger, men kræver opt-in pr. zone og enhed." },
] as const;

export default function CompanionPreferences({ preferences, onChange }: Props) {
  const patch = (next: Partial<Preferences>) => onChange({ ...preferences, ...next });
  const toggle = (field: "goals" | "device_ownership", value: string) => {
    const set = new Set(preferences[field]);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    patch({ [field]: Array.from(set) } as Partial<Preferences>);
  };

  return (
    <section className="companion-band companion-preferences">
      <div className="companion-section-head">
        <div>
          <div className="companion-eyebrow">Driftsprofil</div>
          <h2>Sådan skal Havekompagnonen arbejde for dig.</h2>
        </div>
        <Button
          variant={preferences.onboarding_done ? "outline" : "default"}
          size="sm"
          onClick={() => patch({ onboarding_done: true })}
        >
          <CheckCircle2 size={14} className="mr-1.5" />
          {preferences.onboarding_done ? "Profil gemt" : "Gem profil"}
        </Button>
      </div>

      <div className="companion-preference-grid">
        <Panel icon={<SlidersHorizontal size={16} />} title="Mål">
          <div className="companion-chip-grid">
            {GOALS.map((goal) => (
              <button key={goal} className={preferences.goals.includes(goal) ? "active" : ""} onClick={() => toggle("goals", goal)}>
                {goal}
              </button>
            ))}
          </div>
        </Panel>

        <Panel icon={<Clock3 size={16} />} title="Tid pr. uge">
          <div className="companion-slider-row">
            <input
              type="range"
              min="15"
              max="420"
              step="15"
              value={preferences.weekly_time_budget_minutes}
              onChange={(e) => patch({ weekly_time_budget_minutes: Number(e.target.value) })}
            />
            <strong>{Math.round(preferences.weekly_time_budget_minutes / 15) * 15} min</strong>
          </div>
        </Panel>

        <Panel icon={<Bell size={16} />} title="Vanding og beskeder">
          <div className="companion-field-pair">
            <label>
              Vandingsmetode
              <select value={preferences.watering_method ?? ""} onChange={(e) => patch({ watering_method: e.target.value || null })}>
                <option value="">Vælg</option>
                {WATERING.map((method) => <option key={method} value={method}>{method}</option>)}
              </select>
            </label>
            <label>
              Påmindelser
              <select value={preferences.notification_preference} onChange={(e) => patch({ notification_preference: e.target.value as Preferences["notification_preference"] })}>
                <option value="none">Ingen</option>
                <option value="urgent">Kun akut</option>
                <option value="daily">Daglig briefing</option>
                <option value="all">Alle relevante</option>
              </select>
            </label>
          </div>
        </Panel>

        <Panel icon={<Bot size={16} />} title="Smart udstyr">
          <div className="companion-chip-grid">
            {DEVICES.map((device) => (
              <button key={device} className={preferences.device_ownership.includes(device) ? "active" : ""} onClick={() => toggle("device_ownership", device)}>
                {device}
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <div className="companion-autopilot">
        {AUTOMATION.map((mode) => (
          <button
            key={mode.key}
            className={preferences.automation_mode === mode.key ? "active" : ""}
            onClick={() => patch({
              automation_mode: mode.key,
              device_autopilot_confirmed: mode.key === "device_autopilot" ? preferences.device_autopilot_confirmed : false,
            })}
          >
            <span>{mode.label}</span>
            <small>{mode.text}</small>
          </button>
        ))}
      </div>

      {preferences.automation_mode === "device_autopilot" && !preferences.device_autopilot_confirmed && (
        <div className="companion-device-consent">
          <ShieldCheck size={18} />
          <div>
            <strong>Fysisk vanding kræver ekstra godkendelse.</strong>
            <p>Havekompagnonen kan lægge device-handlinger klar, men ventiler må ikke aktiveres uden særskilt opt-in på enhed eller zone.</p>
          </div>
          <Button size="sm" onClick={() => patch({ device_autopilot_confirmed: true })}>Forstået</Button>
        </div>
      )}
    </section>
  );
}

function Panel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <article className="companion-preference-panel">
      <div className="companion-preference-title">
        {icon}
        <strong>{title}</strong>
      </div>
      {children}
    </article>
  );
}
