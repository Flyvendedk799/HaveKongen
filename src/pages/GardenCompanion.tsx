import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Camera, CloudSun, Droplets, GaugeCircle, Leaf, Pencil, Plus, Sparkles, Sprout, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useActiveGarden } from "@/lib/activeGarden";
import {
  decide,
  fetchForecast,
  litersForSession,
  upcomingOccurrences,
  weekSummary,
  type Forecast,
  type Schedule,
  type Zone,
} from "@/lib/wateringAI";
import AddBedDialog, { type BedDraft } from "@/components/watering/AddBedDialog";
import AddPlantsDialog from "@/components/watering/AddPlantsDialog";
import IdentifyPlantDialog from "@/components/watering/IdentifyPlantDialog";
import PlantDetailSheet from "@/components/watering/PlantDetailSheet";
import QuickWaterDialog from "@/components/watering/QuickWaterDialog";
import ScheduleRow from "@/components/watering/ScheduleRow";
import type { ZonePlant } from "@/components/watering/PlantChips";
import type { CompanionGarden3DBed } from "@/components/companion/CompanionGarden3D";
import "@/styles/watering.css";
import "@/styles/companion.css";

const CompanionGarden3D = lazy(() => import("@/components/companion/CompanionGarden3D"));

type Garden = { id: string; name: string; latitude: number | null; longitude: number | null };
type ZoneRow = Zone & { garden_id: string };
type EventRow = {
  id: string;
  zone_id: string | null;
  scheduled_for: string;
  ran_at: string | null;
  weather_skipped: boolean;
  reason: string | null;
  mm_delivered: number | null;
};
type View = "beds" | "plants" | "water";

const VIEW_TABS: { key: View; label: string; icon: typeof Leaf }[] = [
  { key: "beds", label: "Bede", icon: Leaf },
  { key: "plants", label: "Planter", icon: Sprout },
  { key: "water", label: "Vanding", icon: Droplets },
];

const todayKey = () => new Date().toISOString().slice(0, 10);
const plantName = (plant: ZonePlant) => plant.custom_name || plant.name_da || plant.plant_slug || "Plante";

export default function GardenCompanion() {
  const { user, loading: authLoading } = useAuth();
  const { activeGardenId, setActive } = useActiveGarden();
  const [loading, setLoading] = useState(true);
  const [gardens, setGardens] = useState<Garden[]>([]);
  const [garden, setGarden] = useState<Garden | null>(null);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [plantsByZone, setPlantsByZone] = useState<Record<string, ZonePlant[]>>({});
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [view, setView] = useState<View>(() => (localStorage.getItem("companion.simpleView") as View) || "beds");
  const [heroBedId, setHeroBedId] = useState<string | null>(null);

  const [bedOpen, setBedOpen] = useState(false);
  const [editingBed, setEditingBed] = useState<BedDraft | undefined>();
  const [addPlantsZone, setAddPlantsZone] = useState<ZoneRow | null>(null);
  const [identifyZone, setIdentifyZone] = useState<ZoneRow | null>(null);
  const [quickWaterZone, setQuickWaterZone] = useState<ZoneRow | null>(null);
  const [openPlant, setOpenPlant] = useState<{ plant: ZonePlant; zone: ZoneRow } | null>(null);

  function switchView(next: View) {
    setView(next);
    localStorage.setItem("companion.simpleView", next);
  }

  const reload = async () => {
    if (!user) return;
    setLoading(true);
    const { data: gardenRows } = await supabase
      .from("gardens")
      .select("id,name,latitude,longitude")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    const list = (gardenRows ?? []) as Garden[];
    const selected = list.find((item) => item.id === activeGardenId) ?? list[0] ?? null;
    setGardens(list);
    setGarden(selected);
    if (selected && !activeGardenId) setActive(selected.id);

    if (!selected) {
      setZones([]);
      setPlantsByZone({});
      setSchedules([]);
      setEvents([]);
      setLoading(false);
      return;
    }

    const [{ data: zoneRows }, { data: scheduleRows }, { data: eventRows }, { data: plantRows }] = await Promise.all([
      supabase.from("garden_zones").select("id,garden_id,name,type,area_m2,sun_exposure,soil").eq("garden_id", selected.id).order("created_at"),
      supabase.from("watering_schedules").select("id,zone_id,name,weekday_mask,start_time,duration_min,enabled,ai_adjusted").eq("user_id", user.id),
      supabase.from("watering_events").select("id,zone_id,scheduled_for,ran_at,weather_skipped,reason,mm_delivered").eq("user_id", user.id).order("scheduled_for", { ascending: false }).limit(60),
      supabase.from("user_plants").select("id,zone_id,plant_slug,custom_name,qty,planted_at,notes,image_url,plants_catalog(name_da,water_need,image_url)").eq("garden_id", selected.id),
    ]);

    setZones((zoneRows ?? []) as ZoneRow[]);
    setSchedules((scheduleRows ?? []) as Schedule[]);
    setEvents((eventRows ?? []) as EventRow[]);
    setPlantsByZone(groupPlants(plantRows ?? []));
    setLoading(false);
  };

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    void reload();
  }, [user, activeGardenId]);

  useEffect(() => {
    if (!garden?.latitude || !garden?.longitude) {
      setForecasts([]);
      return;
    }
    fetchForecast(garden.latitude, garden.longitude).then(setForecasts).catch(() => setForecasts([]));
  }, [garden?.latitude, garden?.longitude]);

  const allPlants = useMemo(() => Object.values(plantsByZone).flat(), [plantsByZone]);
  const summary = useMemo(() => weekSummary(schedules, zones, forecasts), [schedules, zones, forecasts]);
  const last48 = useMemo(() => forecasts.slice(0, 2).reduce((sum, item) => sum + item.precip_mm, 0), [forecasts]);
  const nextRun = useMemo(() => {
    let next: { at: Date; schedule: Schedule; zone: ZoneRow } | null = null;
    for (const schedule of schedules) {
      const zone = zones.find((item) => item.id === schedule.zone_id);
      if (!zone) continue;
      for (const occurrence of upcomingOccurrences(schedule, 10)) {
        if (!next || occurrence.getTime() < next.at.getTime()) next = { at: occurrence, schedule, zone };
      }
    }
    return next;
  }, [schedules, zones]);

  const heroBeds = useMemo<CompanionGarden3DBed[]>(() => {
    const timeForZone = (zoneId: string): string | null => {
      let soonest: Date | null = null;
      let time: string | null = null;
      for (const schedule of schedules) {
        if (schedule.zone_id !== zoneId || !schedule.enabled) continue;
        const occ = upcomingOccurrences(schedule, 7)[0];
        if (occ && (!soonest || occ.getTime() < soonest.getTime())) {
          soonest = occ;
          time = (schedule.start_time ?? "").slice(0, 5) || null;
        }
      }
      return time;
    };

    return zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      areaM2: zone.area_m2 ?? 0,
      sun: (zone.sun_exposure ?? "sun") as CompanionGarden3DBed["sun"],
      soil: (zone.soil ?? "loam") as CompanionGarden3DBed["soil"],
      plants: (plantsByZone[zone.id] ?? []).map((plant) => ({
        id: plant.id,
        name: plantName(plant),
        waterNeed: (plant.water_need === "low" || plant.water_need === "high" ? plant.water_need : "medium") as CompanionGarden3DBed["plants"][number]["waterNeed"],
        qty: plant.qty,
      })),
      nextWatering: timeForZone(zone.id),
    }));
  }, [zones, plantsByZone, schedules]);

  async function saveBed(bed: BedDraft) {
    if (!user || !garden) return;
    const payload = {
      name: bed.name,
      type: bed.type as ZoneRow["type"],
      area_m2: bed.area_m2,
      sun_exposure: bed.sun_exposure,
      soil: bed.soil,
    };

    if (bed.id) {
      const { error } = await supabase.from("garden_zones").update(payload).eq("id", bed.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      setZones((prev) => prev.map((zone) => (zone.id === bed.id ? { ...zone, ...payload } : zone)));
      toast.success("Bed opdateret");
      return;
    }

    const { data, error } = await supabase.from("garden_zones").insert({
      ...payload,
      user_id: user.id,
      garden_id: garden.id,
    }).select("id,garden_id,name,type,area_m2,sun_exposure,soil").single();
    if (error || !data) {
      toast.error(error?.message ?? "Kunne ikke gemme bed");
      return;
    }
    setZones((prev) => [...prev, data as ZoneRow]);
    toast.success("Bed tilføjet");
  }

  async function deleteBed(zone: ZoneRow) {
    await supabase.from("watering_schedules").delete().eq("zone_id", zone.id);
    await supabase.from("user_plants").delete().eq("zone_id", zone.id);
    const { error } = await supabase.from("garden_zones").delete().eq("id", zone.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setZones((prev) => prev.filter((item) => item.id !== zone.id));
    setSchedules((prev) => prev.filter((item) => item.zone_id !== zone.id));
    setPlantsByZone((prev) => {
      const next = { ...prev };
      delete next[zone.id];
      return next;
    });
    toast.success(`${zone.name} slettet`);
  }

  async function addPlants(zone: ZoneRow, items: { slug?: string; custom_name?: string; qty: number; meta?: { name_da?: string; water_need?: string | null; image_url?: string | null } }[]) {
    if (!user || !garden) return;
    const rows = items.map((item) => ({
      user_id: user.id,
      garden_id: garden.id,
      zone_id: zone.id,
      plant_slug: item.slug ?? null,
      custom_name: item.custom_name ?? null,
      qty: item.qty,
    }));
    const { data, error } = await supabase.from("user_plants").insert(rows).select("id,zone_id,plant_slug,custom_name,qty,planted_at,notes,image_url,plants_catalog(name_da,water_need,image_url)");
    if (error) throw error;
    setPlantsByZone((prev) => mergePlants(prev, groupPlants(data ?? [])));
  }

  async function addSchedule(zoneId: string) {
    if (!user) return;
    const { data, error } = await supabase.from("watering_schedules").insert({
      user_id: user.id,
      zone_id: zoneId,
      name: "Vanding",
      weekday_mask: 21,
      start_time: "06:30:00",
      duration_min: 15,
      enabled: true,
      ai_adjusted: true,
    }).select("id,zone_id,name,weekday_mask,start_time,duration_min,enabled,ai_adjusted").single();
    if (error || !data) {
      toast.error(error?.message ?? "Kunne ikke oprette vanding");
      return;
    }
    setSchedules((prev) => [...prev, data as Schedule]);
    switchView("water");
  }

  async function duplicateSchedule(schedule: Schedule) {
    if (!user) return;
    const { id: _id, ...rest } = schedule;
    const { data, error } = await supabase.from("watering_schedules").insert({ ...rest, user_id: user.id, name: `${schedule.name} kopi` }).select("id,zone_id,name,weekday_mask,start_time,duration_min,enabled,ai_adjusted").single();
    if (error || !data) {
      toast.error(error?.message ?? "Kunne ikke kopiere vanding");
      return;
    }
    setSchedules((prev) => [...prev, data as Schedule]);
  }

  async function updateSchedule(id: string, patch: Partial<Schedule>) {
    setSchedules((prev) => prev.map((schedule) => (schedule.id === id ? { ...schedule, ...patch } : schedule)));
    const { error } = await supabase.from("watering_schedules").update(patch).eq("id", id);
    if (error) toast.error(error.message);
  }

  async function deleteSchedule(id: string) {
    setSchedules((prev) => prev.filter((schedule) => schedule.id !== id));
    const { error } = await supabase.from("watering_schedules").delete().eq("id", id);
    if (error) toast.error(error.message);
  }

  async function waterNow(zone: ZoneRow, minutes: number) {
    if (!user) return;
    const liters = litersForSession(zone, minutes);
    const { data, error } = await supabase.from("watering_events").insert({
      user_id: user.id,
      zone_id: zone.id,
      schedule_id: null,
      scheduled_for: new Date().toISOString(),
      ran_at: new Date().toISOString(),
      weather_skipped: false,
      reason: `Manuel · ${minutes} min`,
      mm_delivered: Math.round((minutes / 15) * 5),
    }).select("id,zone_id,scheduled_for,ran_at,weather_skipped,reason,mm_delivered").single();
    if (error || !data) {
      toast.error(error?.message ?? "Kunne ikke logge vanding");
      return;
    }
    setEvents((prev) => [data as EventRow, ...prev]);
    toast.success(`Vander ${zone.name} · cirka ${liters} L`);
  }

  if (authLoading || loading) return null;

  if (!user) {
    return (
      <>
        <AppNav active="companion" />
        <main className="container">
          <header className="page-head">
            <div className="eyebrow">Havekompagnon</div>
            <h1>Log ind for at styre bede, planter og vanding.</h1>
            <Link to="/login" className="btn btn-primary" style={{ marginTop: 24 }}>Log ind</Link>
          </header>
        </main>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <AppNav active="companion" />
      <main className="container companion-simple">
        <header className="page-head companion-simple-hero">
          <div className="companion-simple-hero-copy">
            <div className="eyebrow">Havekompagnon</div>
            <h1>Din have som et roligt kontrolrum.</h1>
            <p className="lede">Planlæg bede, følg planterne og vand præcist fra én poleret arbejdsside med tydelige næste skridt.</p>
            <div className="companion-simple-hero-actions">
              <button type="button" onClick={() => garden && switchView("beds")} disabled={!garden}>
                <Leaf size={16} /> Bede
              </button>
              <button type="button" onClick={() => garden && switchView("plants")} disabled={!garden}>
                <Sprout size={16} /> Planter
              </button>
              <button type="button" onClick={() => garden && switchView("water")} disabled={!garden}>
                <Droplets size={16} /> Vanding
              </button>
            </div>
          </div>
          <div className="companion-simple-orbit-card" aria-label="Havekompagnon status">
            <div className="companion-orbit-glow" />
            <div className="companion-orbit-badge"><Sparkles size={14} /> Live haveplan</div>
            <div className="companion-orbit-ring">
              <span>{garden ? zones.length + allPlants.length + schedules.length : 0}</span>
              <small>aktive spor</small>
            </div>
            <div className="companion-orbit-list">
              <span><Leaf size={14} /> {garden?.name ?? "Ingen have valgt"}</span>
              <span><CloudSun size={14} /> {forecasts[0] ? `${forecasts[0].precip_mm.toFixed(1)} mm regn i dag` : "Vejr kobles på automatisk"}</span>
              <span><GaugeCircle size={14} /> {summary.savedL} L sparet af vejret</span>
            </div>
          </div>
        </header>

        {gardens.length > 1 && (
          <div className="companion-garden-switcher" aria-label="Vælg aktiv have">
            {gardens.map((item) => (
              <button key={item.id} onClick={() => setActive(item.id)} className={item.id === garden?.id ? "active" : ""}>
                {item.name}
              </button>
            ))}
          </div>
        )}

        {!garden ? (
          <section className="water-card companion-empty-state">
            <Leaf size={36} />
            <h2>Start med din første have</h2>
            <p>Mål haven op, og kom tilbage for at styre bede, planter og vanding.</p>
            <Link to="/havemaaler" className="btn btn-primary">Mål min have</Link>
          </section>
        ) : (
          <>
            {zones.length > 0 && (
              <section className="companion-3d-section" aria-label="Have-overblik i 3D">
                <Suspense fallback={<div className="companion-3d-skeleton" aria-hidden="true" />}>
                  <CompanionGarden3D
                    beds={heroBeds}
                    mode={view}
                    selectedBedId={heroBedId}
                    onModeChange={(next) => switchView(next)}
                    onSelectBed={setHeroBedId}
                  />
                </Suspense>
              </section>
            )}

            <section className="companion-simple-stats" aria-label="Havekompagnon overblik">
              <Stat icon={<Leaf size={18} />} label="Bede" value={zones.length} tone="leaf" />
              <Stat icon={<Sprout size={18} />} label="Planter" value={allPlants.reduce((sum, plant) => sum + plant.qty, 0)} tone="sprout" />
              <Stat icon={<Droplets size={18} />} label="Planlagt vand" value={`${summary.plannedL} L`} tone="water" />
              <Stat icon={<Sparkles size={18} />} label="Sparet af vejr" value={`${summary.savedL} L`} tone="gold" />
            </section>

            <section className="companion-simple-commandbar" aria-label="Hurtige havehandlinger">
              <button type="button" onClick={() => { setEditingBed(undefined); setBedOpen(true); }}>
                <span><Plus size={16} /></span>
                <strong>Tilføj bed</strong>
                <small>Navn, areal, sol og jord</small>
                <ArrowRight size={16} />
              </button>
              <button type="button" onClick={() => zones[0] ? setAddPlantsZone(zones[0]) : setBedOpen(true)}>
                <span><Sprout size={16} /></span>
                <strong>Registrér planter</strong>
                <small>{zones[0] ? `Start i ${zones[0].name}` : "Opret et bed først"}</small>
                <ArrowRight size={16} />
              </button>
              <button type="button" onClick={() => switchView("water")}>
                <span><Droplets size={16} /></span>
                <strong>Se vandplan</strong>
                <small>{nextRun ? nextRun.zone.name : "Manuel eller timer"}</small>
                <ArrowRight size={16} />
              </button>
            </section>

            <nav className="companion-simple-tabs" aria-label="Havekompagnon funktioner">
              {VIEW_TABS.map(({ key, label, icon: Icon }) => (
                <button key={key} onClick={() => switchView(key)} className={view === key ? "active" : ""}>
                  <Icon size={16} /> {label}
                </button>
              ))}
            </nav>

            {view === "beds" && (
              <BedsView
                zones={zones}
                plantsByZone={plantsByZone}
                schedules={schedules}
                onAddBed={() => { setEditingBed(undefined); setBedOpen(true); }}
                onEditBed={(zone) => { setEditingBed(toBedDraft(zone)); setBedOpen(true); }}
                onDeleteBed={deleteBed}
                onAddPlants={setAddPlantsZone}
                onIdentify={setIdentifyZone}
                onAddSchedule={addSchedule}
                onWaterNow={setQuickWaterZone}
              />
            )}

            {view === "plants" && (
              <PlantsView
                zones={zones}
                plantsByZone={plantsByZone}
                onAddPlants={setAddPlantsZone}
                onIdentify={setIdentifyZone}
                onOpenPlant={(plant, zone) => setOpenPlant({ plant, zone })}
              />
            )}

            {view === "water" && (
              <WaterView
                zones={zones}
                schedules={schedules}
                forecasts={forecasts}
                last48={last48}
                nextRun={nextRun}
                events={events}
                plantsByZone={plantsByZone}
                onAddSchedule={addSchedule}
                onUpdateSchedule={updateSchedule}
                onDeleteSchedule={deleteSchedule}
                onDuplicateSchedule={duplicateSchedule}
                onWaterNow={setQuickWaterZone}
              />
            )}
          </>
        )}
      </main>

      <AddBedDialog open={bedOpen} onOpenChange={setBedOpen} initial={editingBed} onSave={saveBed} />
      <AddPlantsDialog
        open={!!addPlantsZone}
        onOpenChange={(open) => !open && setAddPlantsZone(null)}
        zoneName={addPlantsZone?.name ?? "bed"}
        zoneSun={addPlantsZone?.sun_exposure}
        onAdd={(items) => addPlants(addPlantsZone!, items)}
      />
      <IdentifyPlantDialog
        open={!!identifyZone}
        onOpenChange={(open) => !open && setIdentifyZone(null)}
        zones={zones}
        defaultZoneId={identifyZone?.id}
        onAdded={(plant) => setPlantsByZone((prev) => mergePlants(prev, { [plant.zone_id]: [plant as ZonePlant] }))}
      />
      <QuickWaterDialog
        open={!!quickWaterZone}
        onOpenChange={(open) => !open && setQuickWaterZone(null)}
        zone={quickWaterZone}
        plantNames={(quickWaterZone ? plantsByZone[quickWaterZone.id] ?? [] : []).map(plantName)}
        onConfirm={(minutes) => waterNow(quickWaterZone!, minutes)}
      />
      <PlantDetailSheet
        plant={openPlant?.plant ?? null}
        zoneName={openPlant?.zone.name ?? ""}
        zone={openPlant?.zone ?? null}
        zones={zones}
        bedPlants={openPlant ? plantsByZone[openPlant.zone.id] ?? [] : []}
        onOpenChange={(open) => !open && setOpenPlant(null)}
        onUpdated={(id, patch) => setPlantsByZone((prev) => updatePlant(prev, id, patch))}
        onRemoved={(id) => setPlantsByZone((prev) => removePlant(prev, id))}
        onMoved={(id, newZoneId) => {
          if (!openPlant) return;
          setPlantsByZone((prev) => movePlant(prev, id, openPlant.zone.id, newZoneId));
        }}
      />
      <SiteFooter />
    </>
  );
}

function BedsView({
  zones,
  plantsByZone,
  schedules,
  onAddBed,
  onEditBed,
  onDeleteBed,
  onAddPlants,
  onIdentify,
  onAddSchedule,
  onWaterNow,
}: {
  zones: ZoneRow[];
  plantsByZone: Record<string, ZonePlant[]>;
  schedules: Schedule[];
  onAddBed: () => void;
  onEditBed: (zone: ZoneRow) => void;
  onDeleteBed: (zone: ZoneRow) => void;
  onAddPlants: (zone: ZoneRow) => void;
  onIdentify: (zone: ZoneRow) => void;
  onAddSchedule: (zoneId: string) => void;
  onWaterNow: (zone: ZoneRow) => void;
}) {
  if (zones.length === 0) {
    return (
      <section className="water-card companion-empty-state">
        <Leaf size={36} />
        <h2>Ingen bede endnu</h2>
        <p>Opret et bed for at tilføje planter og vanding.</p>
        <Button onClick={onAddBed}><Plus size={16} className="mr-1.5" />Tilføj bed</Button>
      </section>
    );
  }

  return (
    <section className="companion-simple-grid">
      <button className="companion-add-card" onClick={onAddBed}>
        <Plus size={22} />
        <strong>Tilføj bed</strong>
        <span>Navn, areal, sol og jord.</span>
      </button>
      {zones.map((zone) => {
        const plants = plantsByZone[zone.id] ?? [];
        const zoneSchedules = schedules.filter((schedule) => schedule.zone_id === zone.id);
        return (
          <article key={zone.id} className="water-card companion-bed-card">
            <div className="companion-bed-card-head">
              <div>
                <h2>{zone.name}</h2>
                <p>{zone.area_m2 ?? 0} m² · {readableSun(zone.sun_exposure)} · {readableSoil(zone.soil)}</p>
              </div>
              <div className="companion-icon-actions">
                <button onClick={() => onEditBed(zone)} aria-label={`Rediger ${zone.name}`}><Pencil size={14} /></button>
                <button onClick={() => onDeleteBed(zone)} aria-label={`Slet ${zone.name}`}><Trash2 size={14} /></button>
              </div>
            </div>
            <div className="companion-bed-metrics">
              <span><Sprout size={14} /> {plants.reduce((sum, plant) => sum + plant.qty, 0)} planter</span>
              <span><Droplets size={14} /> {zoneSchedules.length || "Ingen"} timer</span>
            </div>
            <div className="companion-plant-chips">
              {plants.slice(0, 5).map((plant) => <span key={plant.id}>{plantName(plant)}</span>)}
              {plants.length > 5 && <span>+{plants.length - 5}</span>}
              {plants.length === 0 && <em>Ingen planter endnu</em>}
            </div>
            <div className="companion-card-actions">
              <Button variant="outline" size="sm" onClick={() => onAddPlants(zone)}><Plus size={14} className="mr-1.5" />Planter</Button>
              <Button variant="outline" size="sm" onClick={() => onIdentify(zone)}><Camera size={14} className="mr-1.5" />Scan</Button>
              <Button variant="outline" size="sm" onClick={() => onAddSchedule(zone.id)}><Droplets size={14} className="mr-1.5" />Timer</Button>
              <Button size="sm" onClick={() => onWaterNow(zone)}>Vand nu</Button>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function PlantsView({
  zones,
  plantsByZone,
  onAddPlants,
  onIdentify,
  onOpenPlant,
}: {
  zones: ZoneRow[];
  plantsByZone: Record<string, ZonePlant[]>;
  onAddPlants: (zone: ZoneRow) => void;
  onIdentify: (zone: ZoneRow) => void;
  onOpenPlant: (plant: ZonePlant, zone: ZoneRow) => void;
}) {
  if (zones.length === 0) {
    return <section className="water-card companion-empty-state"><Sprout size={36} /><h2>Opret et bed først</h2><p>Planter bor i bede, så start der.</p></section>;
  }

  return (
    <section className="companion-plant-list">
      {zones.map((zone) => {
        const plants = plantsByZone[zone.id] ?? [];
        return (
          <article key={zone.id} className="water-card companion-zone-plants">
            <header>
              <div>
                <h2>{zone.name}</h2>
                <p>{plants.reduce((sum, plant) => sum + plant.qty, 0)} planter</p>
              </div>
              <div className="companion-card-actions">
                <Button variant="outline" size="sm" onClick={() => onIdentify(zone)}><Camera size={14} className="mr-1.5" />Scan</Button>
                <Button size="sm" onClick={() => onAddPlants(zone)}><Plus size={14} className="mr-1.5" />Tilføj</Button>
              </div>
            </header>
            <div className="companion-plant-rows">
              {plants.map((plant) => (
                <button key={plant.id} onClick={() => onOpenPlant(plant, zone)}>
                  <span>{plantName(plant)}</span>
                  <small>{plant.qty} stk · {readableWaterNeed(plant.water_need)}</small>
                </button>
              ))}
              {plants.length === 0 && <p>Tilføj manuelt eller scan en plante med kameraet.</p>}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function WaterView({
  zones,
  schedules,
  forecasts,
  last48,
  nextRun,
  events,
  plantsByZone,
  onAddSchedule,
  onUpdateSchedule,
  onDeleteSchedule,
  onDuplicateSchedule,
  onWaterNow,
}: {
  zones: ZoneRow[];
  schedules: Schedule[];
  forecasts: Forecast[];
  last48: number;
  nextRun: { at: Date; schedule: Schedule; zone: ZoneRow } | null;
  events: EventRow[];
  plantsByZone: Record<string, ZonePlant[]>;
  onAddSchedule: (zoneId: string) => void;
  onUpdateSchedule: (id: string, patch: Partial<Schedule>) => void;
  onDeleteSchedule: (id: string) => void;
  onDuplicateSchedule: (schedule: Schedule) => void;
  onWaterNow: (zone: ZoneRow) => void;
}) {
  if (zones.length === 0) {
    return <section className="water-card companion-empty-state"><Droplets size={36} /><h2>Ingen vanding uden bede</h2><p>Opret et bed for at lave en vandingsplan.</p></section>;
  }

  return (
    <section className="companion-water-layout">
      <div className="water-card companion-next-water">
        <div className="eyebrow">Næste vanding</div>
        <h2>{nextRun ? `${nextRun.zone.name} · ${nextRun.at.toLocaleString("da-DK", { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : "Ingen timer planlagt"}</h2>
        <p>{forecasts.find((item) => item.date === todayKey()) ? `I dag: ${forecasts.find((item) => item.date === todayKey())?.precip_mm.toFixed(1)} mm regn` : "Tilføj en timer eller vand manuelt."}</p>
      </div>

      <div className="companion-water-zones">
        {zones.map((zone) => {
          const zoneSchedules = schedules.filter((schedule) => schedule.zone_id === zone.id);
          return (
            <article key={zone.id} className="water-card companion-water-zone">
              <header>
                <div>
                  <h2>{zone.name}</h2>
                  <p>{(plantsByZone[zone.id] ?? []).map(plantName).slice(0, 4).join(", ") || "Ingen planter"}</p>
                </div>
                <div className="companion-card-actions">
                  <Button variant="outline" size="sm" onClick={() => onAddSchedule(zone.id)}><Plus size={14} className="mr-1.5" />Timer</Button>
                  <Button size="sm" onClick={() => onWaterNow(zone)}>Vand nu</Button>
                </div>
              </header>
              <div className="companion-schedule-list">
                {zoneSchedules.map((schedule) => {
                  const next = upcomingOccurrences(schedule, 7)[0];
                  const decision = next ? decide(schedule, zone, next, forecasts, last48) : null;
                  return (
                    <ScheduleRow
                      key={schedule.id}
                      s={schedule}
                      decision={decision}
                      nextLabel={next ? `Næste: ${next.toLocaleDateString("da-DK", { weekday: "short", day: "numeric", month: "short" })}` : undefined}
                      onChange={(patch) => onUpdateSchedule(schedule.id, patch)}
                      onDelete={() => onDeleteSchedule(schedule.id)}
                      onDuplicate={() => onDuplicateSchedule(schedule)}
                    />
                  );
                })}
                {zoneSchedules.length === 0 && <p>Ingen timer endnu. Tilføj en enkel plan for dette bed.</p>}
              </div>
            </article>
          );
        })}
      </div>

      <aside className="water-card companion-water-history">
        <h2>Seneste vanding</h2>
        {events.slice(0, 6).map((event) => (
          <div key={event.id}>
            <strong>{zones.find((zone) => zone.id === event.zone_id)?.name ?? "Bed"}</strong>
            <span>{new Date(event.scheduled_for).toLocaleDateString("da-DK")} · {event.reason ?? "Vanding"}</span>
          </div>
        ))}
        {events.length === 0 && <p>Ingen vanding logget endnu.</p>}
      </aside>
    </section>
  );
}

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string | number; tone: "leaf" | "sprout" | "water" | "gold" }) {
  return (
    <div className={`water-card companion-simple-stat companion-simple-stat--${tone}`}>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function groupPlants(rows: unknown[]) {
  const map: Record<string, ZonePlant[]> = {};
  rows.forEach((row) => {
    const plant = row as {
      id: string;
      zone_id: string | null;
      plant_slug: string | null;
      custom_name: string | null;
      qty: number;
      planted_at?: string | null;
      notes?: string | null;
      image_url?: string | null;
      plants_catalog?: { name_da: string | null; water_need: string | null; image_url: string | null } | null;
    };
    if (!plant.zone_id) return;
    (map[plant.zone_id] ||= []).push({
      id: plant.id,
      zone_id: plant.zone_id,
      plant_slug: plant.plant_slug,
      custom_name: plant.custom_name,
      qty: plant.qty,
      planted_at: plant.planted_at ?? null,
      notes: plant.notes ?? null,
      image_url: plant.image_url ?? plant.plants_catalog?.image_url ?? null,
      name_da: plant.plants_catalog?.name_da ?? undefined,
      water_need: plant.plants_catalog?.water_need ?? null,
    });
  });
  return map;
}

function mergePlants(current: Record<string, ZonePlant[]>, nextPlants: Record<string, ZonePlant[]>) {
  const next = { ...current };
  for (const [zoneId, plants] of Object.entries(nextPlants)) next[zoneId] = [...(next[zoneId] ?? []), ...plants];
  return next;
}

function updatePlant(current: Record<string, ZonePlant[]>, id: string, patch: Partial<ZonePlant>) {
  const next: Record<string, ZonePlant[]> = {};
  for (const [zoneId, plants] of Object.entries(current)) next[zoneId] = plants.map((plant) => (plant.id === id ? { ...plant, ...patch } : plant));
  return next;
}

function removePlant(current: Record<string, ZonePlant[]>, id: string) {
  const next: Record<string, ZonePlant[]> = {};
  for (const [zoneId, plants] of Object.entries(current)) next[zoneId] = plants.filter((plant) => plant.id !== id);
  return next;
}

function movePlant(current: Record<string, ZonePlant[]>, id: string, fromZoneId: string, toZoneId: string) {
  const plant = current[fromZoneId]?.find((item) => item.id === id);
  if (!plant) return current;
  const next = removePlant(current, id);
  next[toZoneId] = [...(next[toZoneId] ?? []), { ...plant, zone_id: toZoneId }];
  return next;
}

function toBedDraft(zone: ZoneRow): BedDraft {
  return {
    id: zone.id,
    name: zone.name,
    type: zone.type,
    area_m2: zone.area_m2 ?? 10,
    sun_exposure: zone.sun_exposure ?? "sun",
    soil: zone.soil ?? "loam",
  };
}

function readableSun(value?: string | null) {
  if (value === "shade") return "skygge";
  if (value === "part") return "delvis sol";
  return "sol";
}

function readableSoil(value?: string | null) {
  if (value === "sand") return "sandet";
  if (value === "clay") return "leret";
  return "muldet";
}

function readableWaterNeed(value?: string | null) {
  if (value === "high") return "højt vandbehov";
  if (value === "low") return "lavt vandbehov";
  return "middel vandbehov";
}
