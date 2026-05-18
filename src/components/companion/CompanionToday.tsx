import { Bot, Camera, CheckCircle2, CloudRain, Droplets, Leaf, MapPin, Radio, Sparkles, ThermometerSun } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Forecast } from "@/lib/wateringAI";
import type { CareAction, CompanionPreferences } from "@/lib/companionTypes";

type Garden = {
  id: string;
  name: string;
  area_m2?: number | null;
};

type Zone = {
  id: string;
  name: string;
  type: string;
};

type Device = {
  id: string;
  name: string;
  kind: string;
  status: string;
  battery: number | null;
};

type Observation = {
  id: string;
  kind: string;
  image_url: string | null;
  caption: string | null;
  created_at: string;
};

type Props = {
  garden: Garden;
  zones: Zone[];
  plantCount: number;
  openActions: CareAction[];
  suggestions: Omit<CareAction, "id">[];
  forecast: Forecast | null;
  plannedL: number;
  savedL: number;
  devices: Device[];
  observations: Observation[];
  preferences: CompanionPreferences;
  onScan: () => void;
  onMap: () => void;
  onPlan: () => void;
  onDevices: () => void;
  onCompleteAction: (id: string) => void;
};

function priorityLabel(priority: CareAction["priority"]) {
  if (priority === "urgent") return "Akut";
  if (priority === "high") return "Vigtig";
  if (priority === "low") return "Lav";
  return "Normal";
}

function weatherLine(forecast: Forecast | null) {
  if (!forecast) return "Vejret hentes";
  const bits = [
    `${Math.round(forecast.temp_max)} grader`,
    `${forecast.precip_mm.toFixed(1)} mm regn`,
  ];
  if (forecast.wind_max) bits.push(`${Math.round(forecast.wind_max)} m/s vind`);
  return bits.join(" · ");
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function modeText(mode: CompanionPreferences["automation_mode"]) {
  if (mode === "manual") return "Manual";
  if (mode === "autopilot") return "Autopilot";
  if (mode === "device_autopilot") return "Device autopilot";
  return "Assisteret";
}

export default function CompanionToday({
  garden,
  zones,
  plantCount,
  openActions,
  suggestions,
  forecast,
  plannedL,
  savedL,
  devices,
  observations,
  preferences,
  onScan,
  onMap,
  onPlan,
  onDevices,
  onCompleteAction,
}: Props) {
  const urgent = openActions.filter((a) => a.priority === "urgent" || a.priority === "high");
  const nextActions = (urgent.length ? urgent : openActions).slice(0, 4);
  const sensors = devices.filter((d) => d.kind === "sensor");
  const onlineDevices = devices.filter((d) => d.status === "online" || d.status === "running").length;
  const recentPhotos = observations.filter((obs) => obs.image_url).slice(0, 4);
  const diagnoses = observations.filter((obs) => obs.kind === "diagnosis" || obs.kind === "bed_scan").length;
  const readiness = clampScore(92 - urgent.length * 11 - openActions.length * 3 + onlineDevices * 2 + Math.min(8, recentPhotos.length * 2));
  const mapMemory = clampScore((zones.length ? 24 : 0) + Math.min(28, plantCount * 3) + Math.min(28, observations.length * 2) + Math.min(20, devices.length * 5));

  return (
    <div className="companion-today">
      <section className="companion-hero">
        <div>
          <div className="companion-eyebrow">Havekompagnonen · I dag</div>
          <h1>{garden.name} er klar til dagens runde.</h1>
          <p>{weatherLine(forecast)}</p>
          <div className="companion-hero-actions">
            <Button onClick={onScan}>
              <Camera size={16} className="mr-1.5" /> Scan haven
            </Button>
            <Button variant="outline" onClick={onMap}>
              <MapPin size={16} className="mr-1.5" /> Se kort
            </Button>
            <Button variant="outline" onClick={onPlan}>
              <CheckCircle2 size={16} className="mr-1.5" /> Plan
            </Button>
          </div>
        </div>
        <div className="companion-hero-visual" aria-label="Havehukommelse">
          <div className="companion-hero-score">
            <Sparkles size={18} />
            <div>
              <span>{readiness}</span>
              <small>klarhed</small>
            </div>
          </div>
          <div className="companion-photo-stack">
            {recentPhotos.length > 0 ? recentPhotos.map((photo) => (
              <figure key={photo.id}>
                <img src={photo.image_url || ""} alt="" />
                <figcaption>{photo.caption || photo.kind}</figcaption>
              </figure>
            )) : (
              <>
                <div className="companion-photo-placeholder"><Camera size={22} /><span>Første scan</span></div>
                <div className="companion-photo-placeholder"><MapPin size={22} /><span>Kortpunkt</span></div>
              </>
            )}
          </div>
          <div className="companion-hero-mapline">
            <span style={{ width: `${mapMemory}%` }} />
          </div>
          <small>{mapMemory}% kort-hukommelse · {modeText(preferences.automation_mode)}</small>
        </div>
      </section>

      <div className="companion-kpis">
        <Metric icon={<Leaf size={17} />} label="Planter" value={String(plantCount)} />
        <Metric icon={<MapPin size={17} />} label="Zoner" value={String(zones.length)} />
        <Metric icon={<Droplets size={17} />} label="Vanding uge" value={`${plannedL} L`} />
        <Metric icon={<CloudRain size={17} />} label="Sparet" value={`${savedL} L`} />
        <Metric icon={<Radio size={17} />} label="Smart have" value={`${onlineDevices}/${devices.length}`} hint={sensors.length ? `${sensors.length} sensorer` : "ingen sensorer"} />
        <Metric icon={<ThermometerSun size={17} />} label="Temperatur" value={forecast ? `${Math.round(forecast.temp_max)}°` : "-"} />
      </div>

      <section className="companion-guided-flow">
        <GuidedStep
          icon={<Camera size={17} />}
          label="Scan"
          title={recentPhotos.length ? "Fortsæt med en ny vinkel" : "Start dagens scan"}
          meta={`${observations.length} observationer`}
          active={!recentPhotos.length}
          onClick={onScan}
        />
        <GuidedStep
          icon={<MapPin size={17} />}
          label="Placér"
          title={zones.length ? "Kortet har lokale minder" : "Byg første zone"}
          meta={`${zones.length} zoner · ${plantCount} planter`}
          active={recentPhotos.length > 0 && mapMemory < 70}
          onClick={onMap}
        />
        <GuidedStep
          icon={<CheckCircle2 size={17} />}
          label="Gør"
          title={openActions.length ? "Handlinger venter" : "Planen er rolig"}
          meta={`${openActions.length} åbne · ${suggestions.length} forslag`}
          active={openActions.length > 0}
          onClick={onPlan}
        />
        <GuidedStep
          icon={<Bot size={17} />}
          label="Automatisér"
          title={devices.length ? "Smart signaler er med" : "Klargør smart have"}
          meta={`${onlineDevices}/${devices.length} online · ${diagnoses} helbredsspor`}
          active={preferences.automation_mode === "device_autopilot"}
          onClick={onDevices}
        />
      </section>

      <section className="companion-band">
        <div className="companion-section-head">
          <div>
            <div className="companion-eyebrow">Næste bedste handlinger</div>
            <h2>Din have har sorteret dagen for dig.</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onPlan}>Alle opgaver</Button>
        </div>
        {nextActions.length === 0 ? (
          <div className="companion-empty">
            <CheckCircle2 size={20} />
            Ingen akutte opgaver. Tag en scanrunde for at opdatere kortet.
          </div>
        ) : (
          <div className="companion-action-list">
            {nextActions.map((action) => (
              <article key={action.id} className={`companion-action companion-action--${action.priority}`}>
                <div>
                  <span>{priorityLabel(action.priority)}</span>
                  <h3>{action.title}</h3>
                  {action.reason && <p>{action.reason}</p>}
                </div>
                <Button variant="outline" size="sm" onClick={() => onCompleteAction(action.id)}>
                  <CheckCircle2 size={14} className="mr-1.5" /> Klar
                </Button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="companion-metric">
      <div className="companion-metric-icon">{icon}</div>
      <div>
        <div className="companion-metric-label">{label}</div>
        <div className="companion-metric-value">{value}</div>
        {hint && <div className="companion-metric-hint">{hint}</div>}
      </div>
    </div>
  );
}

function GuidedStep({
  icon,
  label,
  title,
  meta,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  meta: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`companion-guided-step ${active ? "active" : ""}`} onClick={onClick}>
      <span className="companion-guided-icon">{icon}</span>
      <span>
        <small>{label}</small>
        <strong>{title}</strong>
        <em>{meta}</em>
      </span>
    </button>
  );
}
