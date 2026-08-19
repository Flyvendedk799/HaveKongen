import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Leaf, MapPin, PawPrint, Ruler, Sprout } from "lucide-react";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import BirdListener from "@/components/companion/BirdListener";
import WildlifeTab, { type FocusKey } from "@/components/companion/WildlifeTab";
import type { WildlifeHabitat, WildlifeHabitat3DMode } from "@/components/companion/WildlifeHabitat3D";
import type { ZonePlant } from "@/components/watering/PlantChips";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { buildWildlifeProfile, type WildlifeProfile } from "@/lib/wildlife";
import { useActiveGarden } from "@/lib/activeGarden";
import { useAuth } from "@/lib/auth";
import "@/styles/companion.css";

const WildlifeHabitat3D = lazy(() => import("@/components/companion/WildlifeHabitat3D"));

const MODE_TO_FOCUS: Record<WildlifeHabitat3DMode, FocusKey> = {
  overview: "all",
  pollinators: "pollinators",
  birds: "birds",
  smallAnimals: "helpers",
  waterLife: "water",
};

const GAP_IMPACT: Record<string, number> = { early: 8, late: 8, host: 9, water: 6, birds: 5, nesting: 4 };

const strengthFromCount = (count: number): WildlifeHabitat["strength"] =>
  count >= 3 ? "strong" : count >= 2 ? "good" : count >= 1 ? "weak" : "missing";

/** Map the Dyreliv profile (score, checks, gaps) into the 8 habitat zones the
 *  3D diorama renders. Strengths come from the real food/structure/water checks;
 *  actions come from the profile's prioritised gaps. */
function buildHabitats(profile: WildlifeProfile, zoneCount: number): WildlifeHabitat[] {
  const met = (key: string) => profile.checks.find((c) => c.key === key)?.met ?? false;
  const gap = (key: string) => profile.gaps.find((g) => g.key === key);
  const nectar = ["early", "summer", "late"].filter(met).length;
  const hasHost = met("host");
  const hasStructure = met("structure");
  const hasWater = met("water");

  const action = (key: string, fallback: { title: string; impact: number }): WildlifeHabitat["action"] => {
    const g = gap(key);
    if (g) return { title: g.title, impact: GAP_IMPACT[key] ?? 5, plants: g.plants?.slice(0, 3) };
    return fallback;
  };

  return [
    { id: "flowers", name: "Blomstereng", kind: "flowers", strength: strengthFromCount(nectar),
      supports: ["wildBees", "butterflies", "beneficialInsects"],
      action: action(gap("early") ? "early" : "late", { title: "Hold blomstring hele sæsonen", impact: 6 }) },
    { id: "shrubs", name: "Bær & buske", kind: "shrubs", strength: gap("birds") ? "missing" : hasStructure ? "strong" : "good",
      supports: ["birds", "wildBees", "butterflies"],
      action: action("birds", { title: "Bevar bær og tæt løv", impact: 6 }) },
    { id: "trees", name: "Træer", kind: "trees", strength: hasStructure ? "good" : gap("birds") ? "missing" : "weak",
      supports: ["birds", "wildBees", "beneficialInsects"],
      action: { title: "Bevar gamle træer og bark", impact: 6 } },
    { id: "water", name: "Vand", kind: "water", strength: hasWater ? "good" : "missing",
      supports: ["frogs", "wildBees", "butterflies"],
      action: action("water", { title: "Hold vandet rent og lavt", impact: 5 }) },
    { id: "deadwood", name: "Dødt ved", kind: "deadwood", strength: hasHost ? "good" : hasStructure ? "weak" : "missing",
      supports: ["hedgehogs", "beneficialInsects", "birds"],
      action: { title: "Lad dødt ved ligge", impact: 10 } },
    { id: "stone", name: "Sten & grus", kind: "stone", strength: gap("nesting") ? "missing" : "good",
      supports: ["hedgehogs", "frogs", "beneficialInsects"],
      action: action("nesting", { title: "Tilføj sten og grus", impact: 9 }) },
    { id: "leafLitter", name: "Løvbunke", kind: "leafLitter", strength: hasHost ? "good" : "weak",
      supports: ["hedgehogs", "beneficialInsects", "frogs"],
      action: action("host", { title: "Gem efterårsløv", impact: 7 }) },
    { id: "corridor", name: "Vildtkorridor", kind: "corridor", strength: zoneCount >= 3 ? "weak" : "missing",
      supports: ["hedgehogs"],
      action: { title: "Lav hul i hæk", impact: 11 } },
  ];
}

type Garden = Tables<"gardens">;
type Zone = Tables<"garden_zones">;
type Plant = Tables<"user_plants"> & {
  plants_catalog?: { name_da: string | null; water_need: string | null; image_url: string | null } | null;
};

export default function GardenWildlife() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { activeGardenId, setActive } = useActiveGarden();
  const [loading, setLoading] = useState(true);
  const [gardens, setGardens] = useState<Garden[]>([]);
  const [garden, setGarden] = useState<Garden | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [mode, setMode] = useState<WildlifeHabitat3DMode>("overview");
  const [selectedHabitatId, setSelectedHabitatId] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Dyreliv - Havekongen";
  }, []);

  useEffect(() => {
    if (!authLoading && !user) navigate("/login?next=/dyreliv");
  }, [authLoading, navigate, user]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data: gardenRows } = await supabase
      .from("gardens")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    const gardenList = (gardenRows ?? []) as Garden[];
    const active = gardenList.find((row) => row.id === activeGardenId) ?? gardenList[0] ?? null;

    setGardens(gardenList);
    setGarden(active);
    if (active && active.id !== activeGardenId) setActive(active.id);

    if (!active) {
      setZones([]);
      setPlants([]);
      setLoading(false);
      return;
    }

    const [{ data: zoneRows }, { data: plantRows }] = await Promise.all([
      supabase.from("garden_zones").select("*").eq("garden_id", active.id).order("created_at", { ascending: true }),
      supabase.from("user_plants")
        .select("*,plants_catalog(name_da,water_need,image_url)")
        .eq("garden_id", active.id)
        .order("created_at", { ascending: false }),
    ]);

    setZones((zoneRows ?? []) as Zone[]);
    setPlants((plantRows ?? []) as Plant[]);
    setLoading(false);
  }, [activeGardenId, setActive, user]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const totalPlants = useMemo(() => plants.reduce((sum, plant) => sum + (plant.qty || 1), 0), [plants]);

  const profile = useMemo(() => buildWildlifeProfile(zones, plantsByZone), [zones, plantsByZone]);
  const habitats = useMemo(() => buildHabitats(profile, zones.length), [profile, zones.length]);

  if (authLoading || (!user && !authLoading)) return null;

  if (loading) {
    return (
      <>
        <AppNav active="wildlife" />
        <div className="container companion-loading">Dyrelivet vågner...</div>
      </>
    );
  }

  if (!garden || !user) {
    return (
      <>
        <AppNav active="wildlife" />
        <div className="container companion-empty-page">
          <div className="companion-eyebrow">Dyreliv</div>
          <h1>Start med at måle din have.</h1>
          <p>Så kan vi se zoner, planter og levesteder og foreslå det bedste mix til bier, fugle, sommerfugle og smådyr.</p>
          <Link to="/havemaaler" className="btn btn-primary">Mål min have</Link>
        </div>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <AppNav active="wildlife" />
      <div className="container companion-page">
        <header className="companion-page-head wildlife-page-head">
          <div>
            <div className="companion-eyebrow">Dyreliv</div>
            <h1>Planlæg haven for bier, fugle, sommerfugle og smådyr.</h1>
            <p>Se hvad der sandsynligvis trives i haven nu, hvilke huller der mangler i fødekæden, og hvilke plantemix der giver mest liv.</p>
          </div>
          <div className="wildlife-page-actions">
            <Link to="/havekompagnon" className="btn btn-ghost btn-sm">
              <Leaf size={14} /> Havekompagnon
            </Link>
            <Link to="/havemaaler" className="btn btn-primary btn-sm">
              <Ruler size={14} /> Mål have
            </Link>
          </div>
        </header>

        {gardens.length > 1 && (
          <div className="companion-garden-switch wildlife-garden-switch" aria-label="Vælg have">
            {gardens.map((row) => (
              <button key={row.id} className={row.id === garden.id ? "active" : ""} onClick={() => setActive(row.id)}>
                {row.name}
              </button>
            ))}
          </div>
        )}

        <section className="wildlife-page-kpis" aria-label="Dyrelivsgrundlag">
          <span><PawPrint size={15} /> Dyrelivsvurdering</span>
          <span><MapPin size={15} /> {zones.length} zone{zones.length === 1 ? "" : "r"}</span>
          <span><Sprout size={15} /> {totalPlants} planter</span>
          <Link to="/havekompagnon" className="wildlife-page-link">
            Plejeplan <ArrowRight size={13} />
          </Link>
        </section>

        <section className="wildlife-3d-section" aria-label="Interaktivt dyrelivskort">
          <Suspense
            fallback={
              <div className="wl3d-skeleton" aria-hidden="true">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                  <circle cx="20" cy="20" r="18" stroke="#4A7820" strokeWidth="3" strokeDasharray="30 84" strokeLinecap="round" />
                </svg>
              </div>
            }
          >
            <WildlifeHabitat3D
              score={profile.score}
              habitats={habitats}
              mode={mode}
              selectedHabitatId={selectedHabitatId}
              onModeChange={setMode}
              onSelectHabitat={setSelectedHabitatId}
            />
          </Suspense>
        </section>

        <BirdListener userId={user.id} gardenId={garden.id} />

        <WildlifeTab zones={zones} plantsByZone={plantsByZone} focus={MODE_TO_FOCUS[mode]} />
      </div>
      <SiteFooter />
    </>
  );
}
