import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BarChart3, CalendarDays, Camera, CheckCircle2, CloudSun, Droplets, Gauge, Leaf, MapPin, NotebookPen, PlugZap, Radio, ShieldCheck, Sprout, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import { useActiveGarden } from "@/lib/activeGarden";
import type { CompanionView, CareAction, CompanionPreferences as CompanionPreferencesState, MapAnchor } from "@/lib/companionTypes";
import { readCompanionPreferences } from "@/lib/companionTypes";
import { generateDeviceActions, generateWeatherActions } from "@/lib/companionActions";
import { fetchForecast, type Forecast, type Schedule, weekSummary } from "@/lib/wateringAI";
import CompanionToday from "@/components/companion/CompanionToday";
import GardenMap from "@/components/companion/GardenMap";
import GardenCamera from "@/components/companion/GardenCamera";
import CarePlan from "@/components/companion/CarePlan";
import CompanionPreferences from "@/components/companion/CompanionPreferences";
import MorningBriefing from "@/components/watering/MorningBriefing";
import CalendarTimeline from "@/components/watering/CalendarTimeline";
import JournalTab from "@/components/watering/JournalTab";
import IoTTab from "@/components/watering/IoTTab";
import InsightsTab from "@/components/watering/InsightsTab";
import NeighborsTab from "@/components/watering/NeighborsTab";
import CalendarTab from "@/components/watering/CalendarTab";
import type { ZonePlant } from "@/components/watering/PlantChips";
import "@/styles/companion.css";

type View = CompanionView | "yearwheel" | "community";
type Garden = Tables<"gardens">;
type Zone = Tables<"garden_zones">;
type Plant = Tables<"user_plants"> & {
  plants_catalog?: { name_da: string | null; water_need: string | null; image_url: string | null } | null;
};
type Observation = Tables<"garden_observations">;
type Device = Tables<"devices">;
type DeviceAction = Tables<"device_actions">;
type DeviceReading = Tables<"device_readings">;
type IntegrationConnection = Tables<"integration_connections">;
type Task = Tables<"task_log">;
type EventRow = Tables<"watering_events">;
type CatalogCalendar = {
  slug: string;
  name_da: string;
  sow_months?: number[] | null;
  harvest_months?: number[] | null;
  transplant_months?: number[] | null;
  prune_months?: number[] | null;
  winterize_months?: number[] | null;
};

const PRIMARY: { key: View; label: string }[] = [
  { key: "today", label: "I dag" },
  { key: "map", label: "Kort" },
  { key: "scan", label: "Scan" },
  { key: "plan", label: "Plan" },
];

const SECONDARY: { key: View; label: string; icon: React.ElementType }[] = [
  { key: "plants", label: "Planter", icon: Sprout },
  { key: "water", label: "Vanding", icon: Droplets },
  { key: "journal", label: "Dagbog", icon: NotebookPen },
  { key: "devices", label: "Smart have", icon: Radio },
  { key: "yearwheel", label: "Årshjul", icon: CalendarDays },
  { key: "community", label: "Nabolag", icon: Users },
  { key: "insights", label: "Indsigt", icon: BarChart3 },
];

function priorityOf(value: string | null): CareAction["priority"] {
  if (value === "urgent" || value === "high" || value === "low") return value;
  return "normal";
}

function sourceOf(value: string | null): CareAction["source"] {
  if (value === "ai" || value === "weather" || value === "sensor" || value === "season" || value === "scan") return value;
  return "manual";
}

function statusOf(task: Task): CareAction["status"] {
  if (task.done) return "done";
  if (task.snoozed_until && new Date(task.snoozed_until).getTime() > Date.now()) return "snoozed";
  return "open";
}

function taskToAction(task: Task): CareAction {
  return {
    id: task.id,
    kind: task.kind,
    title: task.title,
    reason: task.reason || task.notes,
    priority: priorityOf(task.priority),
    due_at: task.due_at,
    status: statusOf(task),
    source: sourceOf(task.source),
    confidence: task.confidence,
    garden_id: task.garden_id || "",
    zone_id: task.zone_id,
    plant_id: task.plant_id,
    observation_id: task.observation_id,
    payload: task.payload,
  };
}

function actionToTaskInsert(userId: string, action: Omit<CareAction, "id">) {
  return {
    user_id: userId,
    garden_id: action.garden_id,
    zone_id: action.zone_id ?? null,
    plant_id: action.plant_id ?? null,
    observation_id: action.observation_id ?? null,
    kind: action.kind,
    title: action.title,
    notes: action.reason ?? null,
    due_at: action.due_at ?? null,
    priority: action.priority,
    source: action.source,
    reason: action.reason ?? null,
    confidence: action.confidence ?? null,
    payload: action.payload ?? {},
  };
}

function readAnchor(anchor: unknown): MapAnchor {
  return (anchor && typeof anchor === "object" ? anchor : {}) as MapAnchor;
}

function normalizeSuggestion(gardenId: string, value: unknown): Omit<CareAction, "id"> | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const title = typeof row.title === "string" ? row.title : null;
  if (!title) return null;
  return {
    kind: typeof row.kind === "string" ? row.kind : "companion_action",
    title,
    reason: typeof row.reason === "string" ? row.reason : null,
    priority: row.priority === "urgent" || row.priority === "high" || row.priority === "normal" || row.priority === "low" ? row.priority : "normal",
    due_at: typeof row.due_at === "string" ? row.due_at : null,
    status: "open",
    source: sourceOf(typeof row.source === "string" ? row.source : null),
    confidence: typeof row.confidence === "number" ? row.confidence : null,
    garden_id: typeof row.garden_id === "string" ? row.garden_id : gardenId,
    zone_id: typeof row.zone_id === "string" ? row.zone_id : null,
    plant_id: typeof row.plant_id === "string" ? row.plant_id : null,
    observation_id: typeof row.observation_id === "string" ? row.observation_id : null,
    payload: (row.payload && typeof row.payload === "object" ? row.payload : {}) as Json,
  };
}

export default function GardenCompanion() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { activeGardenId, setActive } = useActiveGarden();
  const [view, setView] = useState<View>(() => (localStorage.getItem("companion.view") as View) || "today");
  const [loading, setLoading] = useState(true);
  const [gardens, setGardens] = useState<Garden[]>([]);
  const [garden, setGarden] = useState<Garden | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [deviceReadings, setDeviceReadings] = useState<DeviceReading[]>([]);
  const [deviceActions, setDeviceActions] = useState<DeviceAction[]>([]);
  const [remoteSuggestions, setRemoteSuggestions] = useState<Omit<CareAction, "id">[]>([]);
  const [generatingActions, setGeneratingActions] = useState(false);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [catalogBySlug, setCatalogBySlug] = useState<Record<string, CatalogCalendar>>({});

  const setViewPersist = (next: View) => {
    setView(next);
    localStorage.setItem("companion.view", next);
  };

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data: gardenRows } = await supabase
      .from("gardens")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    const gardenList = (gardenRows ?? []) as Garden[];
    setGardens(gardenList);
    const active = gardenList.find((g) => g.id === activeGardenId) ?? gardenList[0] ?? null;
    setGarden(active);
    if (active && active.id !== activeGardenId) setActive(active.id);

    if (!active) {
      setZones([]);
      setPlants([]);
      setObservations([]);
      setTasks([]);
      setDevices([]);
      setConnections([]);
      setDeviceReadings([]);
      setDeviceActions([]);
      setRemoteSuggestions([]);
      setSchedules([]);
      setEvents([]);
      setLoading(false);
      return;
    }

    const [
      { data: zoneRows },
      { data: plantRows },
      { data: observationRows },
      { data: taskRows },
      { data: deviceRows },
      { data: connectionRows },
      { data: readingRows },
      { data: deviceActionRows },
      { data: scheduleRows },
      { data: eventRows },
    ] = await Promise.all([
      supabase.from("garden_zones").select("*").eq("garden_id", active.id).order("created_at", { ascending: true }),
      supabase.from("user_plants")
        .select("*,plants_catalog(name_da,water_need,image_url)")
        .eq("garden_id", active.id)
        .order("created_at", { ascending: false }),
      supabase.from("garden_observations").select("*").eq("garden_id", active.id).order("created_at", { ascending: false }).limit(200),
      supabase.from("task_log").select("*").eq("garden_id", active.id).order("due_at", { ascending: true, nullsFirst: false }).limit(120),
      supabase.from("devices").select("*").eq("garden_id", active.id).order("created_at", { ascending: false }),
      supabase.from("integration_connections").select("*").eq("garden_id", active.id).order("updated_at", { ascending: false }),
      supabase.from("device_readings").select("*").eq("garden_id", active.id).order("observed_at", { ascending: false }).limit(120),
      supabase.from("device_actions").select("*").eq("garden_id", active.id).order("created_at", { ascending: false }).limit(60),
      supabase.from("watering_schedules").select("*").eq("user_id", user.id),
      supabase.from("watering_events").select("*").eq("user_id", user.id).order("scheduled_for", { ascending: false }).limit(250),
    ]);

    setZones((zoneRows ?? []) as Zone[]);
    setPlants((plantRows ?? []) as Plant[]);
    setObservations((observationRows ?? []) as Observation[]);
    setTasks((taskRows ?? []) as Task[]);
    setDevices((deviceRows ?? []) as Device[]);
    setConnections((connectionRows ?? []) as IntegrationConnection[]);
    setDeviceReadings((readingRows ?? []) as DeviceReading[]);
    setDeviceActions((deviceActionRows ?? []) as DeviceAction[]);
    setRemoteSuggestions([]);
    setSchedules((scheduleRows ?? []) as Schedule[]);
    setEvents((eventRows ?? []) as EventRow[]);
    setLoading(false);
  }, [activeGardenId, setActive, user]);

  useEffect(() => {
    if (!authLoading && !user) navigate("/login?next=/havekompagnon");
  }, [authLoading, navigate, user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!garden?.latitude || !garden?.longitude) {
      setForecasts([]);
      return;
    }
    fetchForecast(garden.latitude, garden.longitude).then(setForecasts).catch(() => setForecasts([]));
  }, [garden?.latitude, garden?.longitude]);

  useEffect(() => {
    const slugs = Array.from(new Set(plants.map((p) => p.plant_slug).filter(Boolean) as string[]));
    if (slugs.length === 0) {
      setCatalogBySlug({});
      return;
    }
    supabase.from("plants_catalog")
      .select("slug,name_da,sow_months,harvest_months,transplant_months,prune_months,winterize_months")
      .in("slug", slugs)
      .then(({ data }) => {
        const map: Record<string, CatalogCalendar> = {};
        ((data ?? []) as CatalogCalendar[]).forEach((row) => { map[row.slug] = row; });
        setCatalogBySlug(map);
      });
  }, [plants]);

  const zoneNames = useMemo(() => Object.fromEntries(zones.map((z) => [z.id, z.name])), [zones]);
  const preferences = useMemo(() => readCompanionPreferences(garden?.preferences), [garden?.preferences]);
  const plantsByZone = useMemo(() => {
    const map: Record<string, ZonePlant[]> = {};
    plants.forEach((plant) => {
      if (!plant.zone_id) return;
      (map[plant.zone_id] ||= []).push({
        id: plant.id,
        zone_id: plant.zone_id,
        plant_slug: plant.plant_slug,
        custom_name: plant.custom_name,
        qty: plant.qty,
        planted_at: plant.planted_at,
        notes: plant.notes,
        image_url: plant.image_url || plant.plants_catalog?.image_url,
        name_da: plant.plants_catalog?.name_da,
        water_need: plant.plants_catalog?.water_need,
      });
    });
    return map;
  }, [plants]);

  const summary = useMemo(() => weekSummary(schedules, zones, forecasts), [forecasts, schedules, zones]);
  const actions = useMemo(() => tasks.map(taskToAction), [tasks]);
  const suggestions = useMemo(() => {
    if (!garden) return [];
    const existingTitles = new Set(actions.filter((a) => a.status !== "done").map((a) => a.title));
    return [
      ...remoteSuggestions,
      ...generateWeatherActions(garden.id, zones, forecasts),
      ...generateDeviceActions(garden.id, devices),
    ].filter((a) => !existingTitles.has(a.title));
  }, [actions, devices, forecasts, garden, remoteSuggestions, zones]);

  async function completeAction(id: string) {
    const { error } = await supabase.from("task_log").update({ done: true, done_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setTasks((prev) => prev.map((task) => task.id === id ? { ...task, done: true, done_at: new Date().toISOString() } : task));
    toast.success("Opgave markeret som klar");
  }

  async function snoozeAction(id: string) {
    const snoozed = new Date(Date.now() + 24 * 3600_000).toISOString();
    const { error } = await supabase.from("task_log").update({ snoozed_until: snoozed }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setTasks((prev) => prev.map((task) => task.id === id ? { ...task, snoozed_until: snoozed } : task));
    toast.success("Snoozet til i morgen");
  }

  async function createSuggestion(action: Omit<CareAction, "id">) {
    if (!user) return;
    const { data, error } = await supabase.from("task_log").insert(actionToTaskInsert(user.id, action)).select().single();
    if (error || !data) {
      toast.error(error?.message ?? "Kunne ikke oprette opgave");
      return;
    }
    setTasks((prev) => [...prev, data as Task]);
    toast.success("Tilføjet til plejeplanen");
  }

  async function savePreferences(next: CompanionPreferencesState) {
    if (!garden) return;
    const preferencesJson = next as unknown as Json;
    const { error } = await supabase.from("gardens").update({
      preferences: preferencesJson,
      updated_at: new Date().toISOString(),
    }).eq("id", garden.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setGarden((prev) => prev ? { ...prev, preferences: preferencesJson } as Garden : prev);
    setGardens((prev) => prev.map((row) => row.id === garden.id ? { ...row, preferences: preferencesJson } as Garden : row));
    toast.success("Driftsprofil gemt");
  }

  async function generateCompanionActions(persist = false) {
    if (!garden) return;
    setGeneratingActions(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-companion-actions", {
        body: { garden_id: garden.id, persist },
      });
      if (error) throw error;
      const rawActions = Array.isArray(data?.actions) ? data.actions : [];
      const next = rawActions
        .map((action) => normalizeSuggestion(garden.id, action))
        .filter(Boolean) as Omit<CareAction, "id">[];
      if (persist) {
        await load();
        toast.success(next.length ? "Kompagnonen lagde nye opgaver i planen" : "Ingen nye opgaver fundet");
      } else {
        setRemoteSuggestions(next);
        toast.success(next.length ? "Nye forslag er hentet" : "Ingen nye forslag lige nu");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke hente AI-forslag");
    } finally {
      setGeneratingActions(false);
    }
  }

  async function movePlant(id: string, x: number, y: number) {
    const patch = { normalized_x: x, normalized_y: y, accuracy: "manual" };
    await supabase.from("user_plants").update({ map_position: patch }).eq("id", id);
    setPlants((prev) => prev.map((p) => p.id === id ? { ...p, map_position: patch as Json } as Plant : p));
  }

  async function moveObservation(id: string, x: number, y: number) {
    const current = observations.find((o) => o.id === id);
    const next = { ...readAnchor(current?.anchor), normalized_x: x, normalized_y: y, accuracy: "manual" };
    await supabase.from("garden_observations").update({ anchor: next }).eq("id", id);
    setObservations((prev) => prev.map((o) => o.id === id ? { ...o, anchor: next as Json } as Observation : o));
  }

  async function moveDevice(id: string, x: number, y: number) {
    const patch = { normalized_x: x, normalized_y: y, accuracy: "manual" };
    await supabase.from("devices").update({ map_position: patch }).eq("id", id);
    setDevices((prev) => prev.map((d) => d.id === id ? { ...d, map_position: patch as Json } as Device : d));
  }

  if (authLoading || (!user && !authLoading)) return null;

  if (loading) {
    return (
      <>
        <AppNav active="companion" />
        <div className="container companion-loading">Havekompagnonen vågner...</div>
      </>
    );
  }

  if (!garden || !user) {
    return (
      <>
        <AppNav active="companion" />
        <div className="container companion-empty-page">
          <div className="companion-eyebrow">Havekompagnonen</div>
          <h1>Start med at måle din have.</h1>
          <p>Så kan vi placere bede, planter, fotos, sygdomme, sensorer og vandingszoner på et levende kort.</p>
          <Link to="/havemaaler" className="btn btn-primary">Mål min have</Link>
        </div>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <AppNav active="companion" />
      <div className="container companion-page">
        <header className="companion-page-head">
          <div>
            <div className="companion-eyebrow">Havekompagnonen</div>
            <h1>Din levende have på kort, kamera og plan.</h1>
            <p>Scan planter, placer fotos, følg vækst, opdage sygdomme og lad smart vanding arbejde sammen med vejret.</p>
          </div>
          {gardens.length > 1 && (
            <div className="companion-garden-switch">
              {gardens.map((g) => (
                <button key={g.id} className={g.id === garden.id ? "active" : ""} onClick={() => setActive(g.id)}>
                  {g.name}
                </button>
              ))}
            </div>
          )}
        </header>

        <ExperienceRail
          view={view}
          observations={observations.length}
          zones={zones.length}
          plants={plants.length}
          actions={actions.filter((a) => a.status === "open").length}
          devices={devices.length}
          onSelect={setViewPersist}
        />

        <nav className="companion-primary-nav" aria-label="Havekompagnon hovedvisning">
          {PRIMARY.map((item) => (
            <button key={item.key} className={view === item.key ? "active" : ""} onClick={() => setViewPersist(item.key)}>
              {item.label}
            </button>
          ))}
        </nav>

        {view === "today" && (
          <>
            <CompanionToday
              garden={garden}
              zones={zones}
              plantCount={plants.reduce((sum, p) => sum + (p.qty || 1), 0)}
              openActions={actions.filter((a) => a.status === "open")}
              suggestions={suggestions}
              forecast={forecasts[0] ?? null}
              plannedL={summary.plannedL}
              savedL={summary.savedL}
              devices={devices}
              observations={observations}
              preferences={preferences}
              onScan={() => setViewPersist("scan")}
              onMap={() => setViewPersist("map")}
              onPlan={() => setViewPersist("plan")}
              onDevices={() => setViewPersist("devices")}
              onCompleteAction={completeAction}
            />
            <CompanionPreferences preferences={preferences} onChange={savePreferences} />
            <MorningBriefing userId={user.id} />
          </>
        )}

        {view === "map" && (
          <GardenMap
            garden={garden}
            zones={zones}
            plants={plants}
            observations={observations}
            devices={devices}
            selectedZoneId={selectedZoneId}
            onSelectZone={setSelectedZoneId}
            onMovePlant={movePlant}
            onMoveObservation={moveObservation}
            onMoveDevice={moveDevice}
          />
        )}

        {view === "scan" && (
          <GardenCamera
            userId={user.id}
            garden={garden}
            zones={zones}
            plants={plants}
            observations={observations}
            defaultZoneId={selectedZoneId}
            onSaved={load}
          />
        )}

        {view === "plan" && (
          <CarePlan
            actions={actions}
            suggestions={suggestions}
            zoneNames={zoneNames}
            onComplete={completeAction}
            onSnooze={snoozeAction}
            onCreateSuggestion={createSuggestion}
            onGenerateSuggestions={() => generateCompanionActions(false)}
            generatingSuggestions={generatingActions}
          />
        )}

        <section className="companion-secondary">
          <div className="companion-secondary-head">
            <div>
              <div className="companion-eyebrow">Dybdeværktøjer</div>
              <h2>Alt det kraftige ligger stadig lige under overfladen.</h2>
            </div>
          </div>
          <div className="companion-secondary-nav">
            {SECONDARY.map(({ key, label, icon: Icon }) => (
              <button key={key} className={view === key ? "active" : ""} onClick={() => setViewPersist(key)}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>

          {view === "plants" && <PlantInventory plants={plants} zones={zones} onScan={() => setViewPersist("scan")} />}
          {view === "water" && (
            <CalendarTimeline
              schedules={schedules}
              zones={zones}
              forecasts={forecasts}
              opts={{}}
              onSnooze={() => toast.success("Vanding sprunget over for denne visning")}
            />
          )}
          {view === "journal" && <JournalTab gardenId={garden.id} zones={zones} plantsByZone={plantsByZone} />}
          {view === "devices" && (
            <>
              <SmartGardenPanel
                userId={user.id}
                gardenId={garden.id}
                zones={zones}
                devices={devices}
                connections={connections}
                readings={deviceReadings}
                deviceActions={deviceActions}
                preferences={preferences}
                onRefresh={load}
              />
              <IoTTab gardenId={garden.id} zones={zones} />
            </>
          )}
          {view === "yearwheel" && <CalendarTab gardenId={garden.id} zones={zones} plantsByZone={plantsByZone} catalogBySlug={catalogBySlug} />}
          {view === "community" && <NeighborsTab />}
          {view === "insights" && <InsightsTab events={events} zones={zones} />}
        </section>
      </div>
      <SiteFooter />
    </>
  );
}

const SMART_PROVIDERS = [
  { kind: "sensor", provider: "soil-moisture", name: "Fugtsensorer", icon: Gauge, text: "Jordfugt og temperatur pr. zone." },
  { kind: "irrigation", provider: "smart-valves", name: "Smart ventiler", icon: Droplets, text: "Klargør godkendte vandingshandlinger." },
  { kind: "greenhouse", provider: "greenhouse-climate", name: "Drivhus klima", icon: Radio, text: "Luftfugt, varme og ventilation." },
  { kind: "weather", provider: "local-weather", name: "Lokal vejrstation", icon: CloudSun, text: "Mere præcise regn- og vindsignaler." },
  { kind: "mower", provider: "robot-mower", name: "Robotplæneklipper", icon: PlugZap, text: "Plænestatus og vedligeholdelsesvinduer." },
] as const;

function ExperienceRail({
  view,
  observations,
  zones,
  plants,
  actions,
  devices,
  onSelect,
}: {
  view: View;
  observations: number;
  zones: number;
  plants: number;
  actions: number;
  devices: number;
  onSelect: (view: View) => void;
}) {
  const steps = [
    { key: "scan", label: "Foto", value: observations, target: 4, icon: Camera },
    { key: "map", label: "Kort", value: zones + plants, target: 8, icon: MapPin },
    { key: "plan", label: "Plan", value: actions, target: 3, icon: CheckCircle2 },
    { key: "devices", label: "Smart", value: devices, target: 2, icon: Radio },
  ] as const;

  return (
    <section className="companion-experience-rail" aria-label="Havekompagnon status">
      {steps.map((step) => {
        const Icon = step.icon;
        const progress = Math.min(100, Math.round((step.value / step.target) * 100));
        return (
          <button key={step.key} className={view === step.key ? "active" : ""} onClick={() => onSelect(step.key)}>
            <span className="companion-rail-icon"><Icon size={16} /></span>
            <span>
              <strong>{step.label}</strong>
              <small>{step.value}</small>
            </span>
            <i><b style={{ width: `${progress}%` }} /></i>
          </button>
        );
      })}
    </section>
  );
}

function zoneName(zones: Pick<Zone, "id" | "name">[], zoneId?: string | null) {
  if (!zoneId) return "Hele haven";
  return zones.find((zone) => zone.id === zoneId)?.name ?? "Zone";
}

function deviceZone(device: Device) {
  const metadata = device.metadata && typeof device.metadata === "object" ? device.metadata as Record<string, unknown> : {};
  return typeof metadata.zone_id === "string" ? metadata.zone_id : null;
}

function actionStatus(status: string) {
  if (status === "approved") return "Godkendt";
  if (status === "executed") return "Udført";
  if (status === "cancelled") return "Annulleret";
  return "Afventer";
}

function SmartGardenPanel({
  userId,
  gardenId,
  zones,
  devices,
  connections,
  readings,
  deviceActions,
  preferences,
  onRefresh,
}: {
  userId: string;
  gardenId: string;
  zones: Zone[];
  devices: Device[];
  connections: IntegrationConnection[];
  readings: DeviceReading[];
  deviceActions: DeviceAction[];
  preferences: CompanionPreferencesState;
  onRefresh: () => void;
}) {
  async function connect(provider: typeof SMART_PROVIDERS[number]) {
    const existing = connections.find((row) => row.provider === provider.provider && row.kind === provider.kind);
    if (existing) {
      const { error } = await supabase.from("integration_connections").update({
        status: "planned",
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id);
      if (error) toast.error(error.message);
      else toast.success("Integration markeret til opsætning");
      onRefresh();
      return;
    }

    const { error } = await supabase.from("integration_connections").insert({
      user_id: userId,
      garden_id: gardenId,
      kind: provider.kind,
      provider: provider.provider,
      display_name: provider.name,
      status: "planned",
      settings: { requested_from: "havekompagnon" } as Json,
    });
    if (error) toast.error(error.message);
    else toast.success("Integration lagt klar");
    onRefresh();
  }

  async function toggleDeviceAutopilot(device: Device) {
    if (!preferences.device_autopilot_confirmed && !device.autopilot_enabled) {
      toast.error("Bekræft enheds-autopilot i driftsprofilen først");
      return;
    }
    const { error } = await supabase.from("devices").update({ autopilot_enabled: !device.autopilot_enabled }).eq("id", device.id);
    if (error) toast.error(error.message);
    else toast.success(device.autopilot_enabled ? "Enheds-autopilot slået fra" : "Enheds-autopilot slået til");
    onRefresh();
  }

  async function updateAction(action: DeviceAction, status: "approved" | "cancelled") {
    const { error } = await supabase.from("device_actions").update({
      status,
      approved_at: status === "approved" ? new Date().toISOString() : action.approved_at,
    }).eq("id", action.id);
    if (error) toast.error(error.message);
    else toast.success(status === "approved" ? "Device-handling godkendt" : "Device-handling annulleret");
    onRefresh();
  }

  const pendingActions = deviceActions.filter((action) => action.status === "pending" || action.status === "requested").slice(0, 5);
  const latestReadings = readings.slice(0, 8);

  return (
    <div className="companion-integrations">
      <section className="companion-band">
        <div className="companion-section-head">
          <div>
            <div className="companion-eyebrow">Smart have</div>
            <h2>Sensorer, ventiler og lokale signaler kobles til kortet.</h2>
          </div>
          <div className="companion-plan-count">
            <Radio size={15} /> {connections.length} forbindelser
          </div>
        </div>

        <div className="companion-provider-grid">
          {SMART_PROVIDERS.map((provider) => {
            const Icon = provider.icon;
            const connection = connections.find((row) => row.provider === provider.provider && row.kind === provider.kind);
            return (
              <article key={provider.provider} className="companion-provider">
                <div className="companion-provider-icon"><Icon size={17} /></div>
                <div>
                  <h3>{provider.name}</h3>
                  <p>{provider.text}</p>
                  <small>{connection ? `Status: ${connection.status}` : "Ikke forbundet"}</small>
                </div>
                <Button variant="outline" size="sm" onClick={() => connect(provider)}>
                  {connection ? "Klargør igen" : "Klargør"}
                </Button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="companion-smart-grid">
        <article className="companion-band">
          <div className="companion-section-head">
            <div>
              <div className="companion-eyebrow">Enheder på kortet</div>
              <h2>Autopilot er opt-in pr. enhed.</h2>
            </div>
          </div>
          {devices.length === 0 ? (
            <div className="companion-empty"><Radio size={18} /> Ingen enheder endnu.</div>
          ) : (
            <div className="companion-device-list">
              {devices.map((device) => (
                <div key={device.id} className="companion-device-row">
                  <div>
                    <strong>{device.name}</strong>
                    <span>{device.kind} · {zoneName(zones, deviceZone(device))} · {device.status}</span>
                  </div>
                  <button className={device.autopilot_enabled ? "active" : ""} onClick={() => toggleDeviceAutopilot(device)}>
                    {device.autopilot_enabled ? "Autopilot" : "Manual"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="companion-band">
          <div className="companion-section-head">
            <div>
              <div className="companion-eyebrow">Målinger</div>
              <h2>Seneste signaler der påvirker anbefalinger.</h2>
            </div>
          </div>
          {latestReadings.length === 0 ? (
            <div className="companion-empty"><Gauge size={18} /> Ingen sensorhistorik endnu.</div>
          ) : (
            <div className="companion-reading-list">
              {latestReadings.map((reading) => (
                <div key={reading.id}>
                  <strong>{reading.kind}</strong>
                  <span>{reading.value ?? "-"}{reading.unit ? ` ${reading.unit}` : ""}</span>
                  <small>{zoneName(zones, reading.zone_id)} · {new Date(reading.observed_at).toLocaleDateString("da-DK")}</small>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="companion-band">
        <div className="companion-section-head">
          <div>
            <div className="companion-eyebrow">Device-handlinger</div>
            <h2>Ventiler og fysiske handlinger kræver tydelig godkendelse.</h2>
          </div>
          <ShieldCheck size={18} />
        </div>
        {pendingActions.length === 0 ? (
          <div className="companion-empty"><CheckCircle2 size={18} /> Ingen afventende device-handlinger.</div>
        ) : (
          <div className="companion-device-actions">
            {pendingActions.map((action) => (
              <article key={action.id}>
                <div>
                  <span>{actionStatus(action.status)}</span>
                  <h3>{action.action}</h3>
                  {action.reason && <p>{action.reason}</p>}
                  <small>{zoneName(zones, action.zone_id)}</small>
                </div>
                <div className="companion-task-actions">
                  <Button variant="outline" size="sm" onClick={() => updateAction(action, "cancelled")}><XCircle size={14} className="mr-1.5" /> Nej</Button>
                  <Button size="sm" onClick={() => updateAction(action, "approved")}><CheckCircle2 size={14} className="mr-1.5" /> Godkend</Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PlantInventory({ plants, zones, onScan }: { plants: Plant[]; zones: Zone[]; onScan: () => void }) {
  if (plants.length === 0) {
    return (
      <div className="companion-band companion-empty">
        <Leaf size={20} />
        Ingen planter endnu. Brug Scan til at identificere og placere den første plante.
        <Button onClick={onScan}>Scan plante</Button>
      </div>
    );
  }
  return (
    <div className="companion-plant-grid">
      {plants.map((plant) => (
        <article key={plant.id} className="companion-plant-card">
          {plant.image_url ? <img src={plant.image_url} alt="" /> : <div className="companion-plant-fallback"><Sprout size={20} /></div>}
          <div>
            <h3>{plant.custom_name || plant.plants_catalog?.name_da || plant.plant_slug || "Plante"}</h3>
            <p>{zones.find((z) => z.id === plant.zone_id)?.name ?? "Ikke placeret"} · {plant.health_status || "ukendt helbred"}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
