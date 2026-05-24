import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Leaf, MapPin, PawPrint, Ruler, Sprout } from "lucide-react";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import WildlifeTab from "@/components/companion/WildlifeTab";
import type { ZonePlant } from "@/components/watering/PlantChips";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useActiveGarden } from "@/lib/activeGarden";
import { useAuth } from "@/lib/auth";
import "@/styles/companion.css";

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

        <WildlifeTab zones={zones} plantsByZone={plantsByZone} />
      </div>
      <SiteFooter />
    </>
  );
}
