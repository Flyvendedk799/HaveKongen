import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import GardenThumbnailImage from "@/components/garden/GardenThumbnailImage";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useActiveGarden } from "@/lib/activeGarden";
import {
  Droplets, Leaf, Sun, CloudRain, Sparkles, CheckCircle2, Calendar,
  ShoppingBag, Ruler, MessageSquare, ArrowRight, AlertTriangle, ListTodo,
} from "lucide-react";
import { toast } from "sonner";

type Garden = {
  id: string; name: string; area_m2: number | null;
  thumbnail_url: string | null; address: string | null;
  latitude: number | null; longitude: number | null;
};
type ZoneRow = { id: string; garden_id: string; name: string; type: string; area_m2: number | null };
type Task = { id: string; title: string; kind: string; due_at: string | null; done: boolean; zone_id: string | null };
type Rec = { id: string; title: string; body: string | null; severity: string; kind: string; zone_id: string | null; created_at: string };
type Event = { id: string; zone_id: string | null; scheduled_for: string; ran_at: string | null; weather_skipped: boolean };
type Plant = { id: string; zone_id: string | null; plant_slug: string | null; custom_name: string | null; qty: number };
type Weather = { date: string; precip_mm: number; temp_max: number | null; temp_min: number | null };

const MONTH_TASKS_DA: Record<number, string[]> = {
  0: ["Planlæg sæsonen", "Bestil frø", "Beskær frugttræer i frostfrit vejr"],
  1: ["Forspirning af tomater og chili", "Beskær æble- og pæretræer"],
  2: ["Så indendørs: tomat, peberfrugt", "Klargør drivhus", "Riv plæne"],
  3: ["Så ærter, spinat og radiser ud", "Plant kartofler sidst på måneden", "Første plæneklip"],
  4: ["Plant ud efter sidste frost", "Så græskar og squash", "Gødsk plæne"],
  5: ["Vand regelmæssigt", "Bind tomater op", "Hold øje med bladlus"],
  6: ["Vand om morgenen", "Klip hæk", "Beskær syren efter blomstring"],
  7: ["Høst bær og grøntsager", "Vand i tørke", "Så efterårs-salat"],
  8: ["Plant løg til forår", "Så vinterspinat", "Tag stiklinger"],
  9: ["Plant frugttræer", "Saml æbler", "Ryd bede"],
  10: ["Beskyt mod frost", "Fjern blade fra plænen", "Plant tulipanløg"],
  11: ["Beskær løvfældende træer", "Frostsikring af krukker", "Planlæg næste sæson"],
};

const editMeasurementPath = (gardenId: string, next = "/min-have") =>
  `/havemaaler?garden=${gardenId}&next=${encodeURIComponent(next)}`;

export default function MinHave() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { activeGardenId, setActive } = useActiveGarden();

  const [profile, setProfile] = useState<{ name: string | null } | null>(null);
  const [gardens, setGardens] = useState<Garden[]>([]);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [todayWeather, setTodayWeather] = useState<Weather | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapboxToken, setMapboxToken] = useState<string | null>(null);

  useEffect(() => { document.title = "Min have — Havekongen"; }, []);
  useEffect(() => {
    let cancelled = false;
    supabase.functions.invoke("get-mapbox-token").then(({ data, error }) => {
      if (!cancelled && !error && typeof data?.token === "string") setMapboxToken(data.token);
    }).catch(() => {
      /* Satellite thumbnails are best effort in Min have. */
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { if (!authLoading && !user) navigate("/login?next=/min-have"); }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const [{ data: p }, { data: g }, { data: z }, { data: pl }, { data: t }, { data: r }, { data: e }] = await Promise.all([
        supabase.from("profiles").select("name").eq("id", user.id).maybeSingle(),
        supabase.from("gardens").select("id, name, area_m2, thumbnail_url, address, latitude, longitude").order("created_at", { ascending: false }),
        supabase.from("garden_zones").select("id, garden_id, name, type, area_m2"),
        supabase.from("user_plants").select("id, zone_id, plant_slug, custom_name, qty"),
        supabase.from("task_log").select("id, title, kind, due_at, done, zone_id").eq("done", false).order("due_at", { ascending: true, nullsFirst: false }).limit(20),
        supabase.from("ai_recommendations").select("id, title, body, severity, kind, zone_id, created_at").eq("status", "open").order("created_at", { ascending: false }).limit(10),
        supabase.from("watering_events").select("id, zone_id, scheduled_for, ran_at, weather_skipped").gte("scheduled_for", new Date(Date.now() - 7 * 86400000).toISOString()).order("scheduled_for", { ascending: false }).limit(40),
      ]);
      setProfile((p as any) || { name: null });
      setGardens((g as Garden[]) || []);
      setZones((z as ZoneRow[]) || []);
      setPlants((pl as Plant[]) || []);
      setTasks((t as Task[]) || []);
      setRecs((r as Rec[]) || []);
      setEvents((e as Event[]) || []);

      // pick active garden if needed
      const list = (g as Garden[]) || [];
      const active = list.find((x) => x.id === activeGardenId) || list[0];
      if (active && active.id !== activeGardenId) setActive(active.id);

      // today's weather (cached)
      if (active?.latitude && active?.longitude) {
        const today = new Date().toISOString().slice(0, 10);
        const { data: w } = await supabase
          .from("weather_cache")
          .select("date, precip_mm, temp_max, temp_min")
          .eq("date", today)
          .order("fetched_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        setTodayWeather((w as any) || null);
      }
      setLoading(false);
    })();
  }, [user]);

  const activeGarden = useMemo(
    () => gardens.find((g) => g.id === activeGardenId) || gardens[0] || null,
    [gardens, activeGardenId]
  );
  const gardenZones = useMemo(
    () => (activeGarden ? zones.filter((z) => z.garden_id === activeGarden.id) : []),
    [zones, activeGarden]
  );
  const gardenPlants = useMemo(
    () => (activeGarden ? plants.filter((p) => gardenZones.some((z) => z.id === p.zone_id)) : []),
    [plants, gardenZones, activeGarden]
  );
  const totalPlantQty = useMemo(() => gardenPlants.reduce((s, p) => s + (p.qty || 1), 0), [gardenPlants]);
  const bedCount = useMemo(() => gardenZones.filter((z) => z.type === "bed").length, [gardenZones]);
  const lawnArea = useMemo(
    () => Math.round(gardenZones.filter((z) => z.type === "lawn").reduce((s, z) => s + Number(z.area_m2 || 0), 0)),
    [gardenZones]
  );

  // build today's actions feed
  const todayItems = useMemo(() => {
    const items: { id: string; icon: React.ReactNode; title: string; sub: string; tone: "info" | "warn" | "ok" | "do"; cta?: { to: string; label: string } }[] = [];
    // rain skip
    if (todayWeather && todayWeather.precip_mm >= 4) {
      items.push({
        id: "w-rain",
        icon: <CloudRain size={18} />,
        title: `Spring vanding over i dag`,
        sub: `${todayWeather.precip_mm.toFixed(1)} mm regn forventet`,
        tone: "info",
        cta: { to: "/havekompagnon", label: "Se plan" },
      });
    }
    // overdue / due-today tasks
    const now = Date.now();
    tasks.slice(0, 6).forEach((t) => {
      const due = t.due_at ? new Date(t.due_at).getTime() : null;
      const overdue = due !== null && due < now;
      items.push({
        id: `t-${t.id}`,
        icon: <ListTodo size={18} />,
        title: t.title,
        sub: due ? (overdue ? "Forfalden" : new Date(due).toLocaleDateString("da-DK", { weekday: "short", day: "numeric", month: "short" })) : "Opgave",
        tone: overdue ? "warn" : "do",
      });
    });
    // AI recommendations
    recs.slice(0, 4).forEach((r) => {
      items.push({
        id: `r-${r.id}`,
        icon: r.severity === "warning" ? <AlertTriangle size={18} /> : <Sparkles size={18} />,
        title: r.title,
        sub: r.body ? r.body.slice(0, 80) : "AI-anbefaling",
        tone: r.severity === "warning" ? "warn" : "info",
      });
    });
    return items;
  }, [tasks, recs, todayWeather]);

  const monthIdx = new Date().getMonth();
  const seasonalTips = MONTH_TASKS_DA[monthIdx] || [];
  const monthName = new Date().toLocaleDateString("da-DK", { month: "long" });
  const today = new Date().toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long" });

  async function completeTask(id: string) {
    const { error } = await supabase.from("task_log").update({ done: true, done_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    setTasks((arr) => arr.filter((t) => t.id !== id));
    toast.success("Opgave klaret 🌱");
  }
  async function dismissRec(id: string) {
    const { error } = await supabase.from("ai_recommendations").update({ status: "dismissed", resolved_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    setRecs((arr) => arr.filter((r) => r.id !== id));
  }

  if (authLoading || !user) return null;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 10) return "Godmorgen";
    if (h < 17) return "Goddag";
    return "Godaften";
  })();
  const name = profile?.name?.split(" ")[0] || user.email?.split("@")[0] || "havemester";

  return (
    <>
      <AppNav active="hub" />
      <div className="container" style={{ paddingBottom: 80, paddingTop: 28 }}>
        {/* HERO */}
        <header style={{ marginBottom: 28 }}>
          <div className="eyebrow" style={{ marginBottom: 10, textTransform: "capitalize" }}>{today}</div>
          <h1 style={{ fontSize: "clamp(32px, 4vw, 48px)", margin: 0, lineHeight: 1.1 }}>
            {greeting}, {name}.
          </h1>
          <p className="lede" style={{ marginTop: 10, maxWidth: 640 }}>
            {activeGarden
              ? `Din have lever — ${bedCount} bede, ${totalPlantQty} planter, ${lawnArea} m² plæne.`
              : "Lad os komme i gang. Mål din have for at låse op for plan, vanding og pleje."}
          </p>
        </header>

        {!activeGarden && (
          <EmptyState />
        )}

        {activeGarden && (
          <>
            {/* QUICK STATS */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 14, marginBottom: 28,
            }}>
              <KpiTile icon={<Leaf size={18} />} label="Planter" value={String(totalPlantQty)} />
              <KpiTile icon={<Ruler size={18} />} label="Bede" value={String(bedCount)} />
              <KpiTile icon={<Sun size={18} />} label="Plæne" value={`${lawnArea} m²`} />
              <KpiTile
                icon={<CloudRain size={18} />}
                label="I dag"
                value={todayWeather ? `${todayWeather.precip_mm.toFixed(1)} mm` : "—"}
                sub={todayWeather?.temp_max ? `${Math.round(todayWeather.temp_max)}°` : undefined}
              />
            </div>

            {/* MAIN GRID */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
              gap: 20,
              alignItems: "start",
            }} className="hub-grid">
              {/* TODAY FEED */}
              <Panel
                title="Dagens have"
                subtitle="Det vigtigste lige nu"
                action={<Link to="/havekompagnon" className="btn btn-ghost btn-sm">Plan <ArrowRight size={14} /></Link>}
              >
                {todayItems.length === 0 ? (
                  <div style={{ padding: "28px 8px", textAlign: "center", color: "var(--ink-500)" }}>
                    <CheckCircle2 size={32} style={{ marginBottom: 8, color: "var(--forest-800)" }} />
                    <p style={{ margin: 0 }}>Alt er fanget op. Nyd haven 🌿</p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {todayItems.map((it) => (
                      <FeedRow
                        key={it.id}
                        item={it}
                        onComplete={it.id.startsWith("t-") ? () => completeTask(it.id.slice(2)) : it.id.startsWith("r-") ? () => dismissRec(it.id.slice(2)) : undefined}
                      />
                    ))}
                  </div>
                )}
              </Panel>

              {/* GARDEN SNAPSHOT */}
              <Panel
                title="Haven"
                subtitle={activeGarden.address || "Din have"}
                action={<Link to={editMeasurementPath(activeGarden.id)} className="btn btn-ghost btn-sm">Rediger</Link>}
              >
                <div style={{
                  position: "relative",
                  borderRadius: 14,
                  overflow: "hidden",
                  aspectRatio: "16/10",
                  background: "var(--ink-50)",
                  marginBottom: 14,
                }}>
                  <GardenThumbnailImage
                    garden={activeGarden}
                    mapboxToken={mapboxToken}
                    alt={activeGarden.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    fallback={
                      <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--ink-500)" }}>
                        Intet kortbillede endnu
                      </div>
                    }
                  />
                  {activeGarden.area_m2 && (
                    <div style={{
                      position: "absolute", bottom: 10, left: 10,
                      background: "rgba(0,0,0,0.6)", color: "#fff",
                      padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                    }}>{Math.round(Number(activeGarden.area_m2))} m²</div>
                  )}
                </div>
                {gardens.length > 1 && (
                  <select
                    value={activeGardenId || ""}
                    onChange={(e) => setActive(e.target.value)}
                    style={{
                      width: "100%", padding: "10px 12px", borderRadius: 10,
                      border: "1px solid var(--ink-100)", background: "var(--ink-50)", marginBottom: 12,
                    }}
                  >
                    {gardens.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <Link to="/havekompagnon" className="btn btn-ghost btn-sm" style={{ justifyContent: "center" }}>
                    <Droplets size={14} /> Kompagnon
                  </Link>
                  <Link to="/ai" className="btn btn-ghost btn-sm" style={{ justifyContent: "center" }}>
                    <MessageSquare size={14} /> Spørg AI
                  </Link>
                </div>
              </Panel>
            </div>

            {/* SHORTCUTS */}
            <div style={{ marginTop: 28 }}>
              <h2 style={{ fontSize: 20, marginBottom: 14 }}>Genveje</h2>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 14,
              }}>
                <Shortcut to="/havekompagnon" icon={<Droplets />} title="Havekompagnon" sub="Kort, scan og smart vanding" />
                <Shortcut to="/ai" icon={<MessageSquare />} title="Plantepleje AI" sub="Diagnose & rådgivning" />
                <Shortcut to={editMeasurementPath(activeGarden.id)} icon={<Ruler />} title="Havemåler" sub="Mål bede, plæne, terrasse" />
                <Shortcut to="/webshop" icon={<ShoppingBag />} title="Webshop" sub="Frø, gødning, redskaber" />
              </div>
            </div>

            {/* SEASONAL */}
            <div style={{ marginTop: 28 }}>
              <Panel
                title={`I ${monthName}`}
                subtitle="Sæsonens opgaver i danske haver"
                action={<Link to="/havekompagnon" className="btn btn-ghost btn-sm">Sæson <ArrowRight size={14} /></Link>}
              >
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                  {seasonalTips.map((tip, i) => (
                    <div key={i} style={{
                      padding: "14px 16px",
                      background: "var(--ink-50)",
                      borderRadius: 12,
                      display: "flex", gap: 12, alignItems: "flex-start",
                    }}>
                      <Calendar size={16} style={{ color: "var(--forest-800)", flexShrink: 0, marginTop: 2 }} />
                      <span style={{ fontSize: 14, lineHeight: 1.45 }}>{tip}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </>
        )}
      </div>
      <SiteFooter />
      <style>{`
        @media (max-width: 880px) {
          .hub-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  );
}

function KpiTile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div style={{
      background: "var(--paper)",
      border: "1px solid var(--ink-100)",
      borderRadius: 16, padding: "16px 18px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink-500)", fontSize: 12, marginBottom: 6 }}>
        {icon}<span>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: "var(--forest-800)", letterSpacing: "-0.02em" }}>
        {value}{sub && <span style={{ fontSize: 14, color: "var(--ink-500)", fontWeight: 500, marginLeft: 6 }}>{sub}</span>}
      </div>
    </div>
  );
}

function Panel({
  title, subtitle, action, children,
}: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{
      background: "var(--paper)",
      border: "1px solid var(--ink-100)",
      borderRadius: 20, padding: 22,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h3>
          {subtitle && <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>{subtitle}</div>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function FeedRow({
  item, onComplete,
}: {
  item: { icon: React.ReactNode; title: string; sub: string; tone: "info" | "warn" | "ok" | "do" };
  onComplete?: () => void;
}) {
  const toneColor = item.tone === "warn"
    ? "hsl(20 80% 45%)"
    : item.tone === "ok"
      ? "var(--forest-800)"
      : item.tone === "info"
        ? "hsl(210 60% 45%)"
        : "var(--forest-800)";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "12px 14px", background: "var(--ink-50)", borderRadius: 12,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 10,
        background: "var(--paper)", display: "grid", placeItems: "center",
        color: toneColor, flexShrink: 0,
      }}>{item.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-900)", lineHeight: 1.3 }}>{item.title}</div>
        <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.sub}</div>
      </div>
      {onComplete && (
        <button
          onClick={onComplete}
          aria-label="Markér som klaret"
          style={{
            border: "none", background: "transparent", cursor: "pointer",
            color: "var(--ink-500)", padding: 6, borderRadius: 8,
          }}
        >
          <CheckCircle2 size={20} />
        </button>
      )}
    </div>
  );
}

function Shortcut({ to, icon, title, sub }: { to: string; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <Link
      to={to}
      style={{
        background: "var(--paper)",
        border: "1px solid var(--ink-100)",
        borderRadius: 16, padding: "18px 20px",
        textDecoration: "none", color: "inherit",
        display: "flex", alignItems: "center", gap: 14,
        transition: "transform 150ms, border-color 150ms",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = "var(--forest-800)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.borderColor = "var(--ink-100)"; }}
    >
      <div style={{
        width: 42, height: 42, borderRadius: 12,
        background: "var(--ink-50)", color: "var(--forest-800)",
        display: "grid", placeItems: "center", flexShrink: 0,
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>{sub}</div>
      </div>
      <ArrowRight size={18} style={{ color: "var(--ink-500)" }} />
    </Link>
  );
}

function EmptyState() {
  return (
    <div style={{
      background: "var(--paper)",
      border: "1px solid var(--ink-100)",
      borderRadius: 20, padding: 40, textAlign: "center",
    }}>
      <Leaf size={40} style={{ color: "var(--forest-800)", marginBottom: 12 }} />
      <h2 style={{ margin: "0 0 8px", fontSize: 22 }}>Lad os opdage din have</h2>
      <p style={{ color: "var(--ink-500)", marginBottom: 20, maxWidth: 420, marginInline: "auto" }}>
        Mål din have, og vi sætter automatisk vandingsplan, sæsonens opgaver og personlige anbefalinger op.
      </p>
      <Link to="/havemaaler" className="btn btn-primary">
        <Ruler size={16} /> Mål min have
      </Link>
    </div>
  );
}
