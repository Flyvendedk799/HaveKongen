import { useEffect, useState } from "react";
import type { ChangeEvent, CSSProperties, ElementType, FormEvent, ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Bell, Bot, CalendarDays, CheckCircle2, CloudSun, Database, Link2, MapPinned, PauseCircle, PlugZap, RefreshCcw, Ruler, ShieldCheck, Sparkles } from "lucide-react";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import GardenThumbnailImage from "@/components/garden/GardenThumbnailImage";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import { useActiveGarden } from "@/lib/activeGarden";
import {
  CROSS_PLATFORM_PROVIDERS,
  TOOL_FLOW,
  connectionFor,
  integrationReadiness,
  integrationStatusLabel,
  isConnectionActive,
  type IntegrationProvider,
} from "@/lib/crossPlatformIntegrations";
import { toast } from "sonner";
import "@/styles/account.css";

type Profile = Pick<Tables<"profiles">, "name" | "address" | "postal_code" | "avatar_url">;
type Garden = Pick<Tables<"gardens">, "id" | "name" | "area_m2" | "address" | "thumbnail_url" | "latitude" | "longitude">;
type Order = Pick<Tables<"orders">, "id" | "created_at" | "total_dkk" | "status">;
type Device = Pick<Tables<"devices">, "id" | "name" | "kind" | "status" | "battery" | "garden_id">;
type WishProduct = Pick<Tables<"products">, "id" | "slug" | "name" | "base_price_dkk" | "gradient" | "svg_art">;
type IntegrationConnection = Tables<"integration_connections">;
type ProfileSync = {
  profileContext: boolean;
  aiMemory: boolean;
  notifications: boolean;
  calendar: boolean;
  deviceSignals: boolean;
  handoff: boolean;
};

const DEFAULT_PROFILE_SYNC: ProfileSync = {
  profileContext: true,
  aiMemory: true,
  notifications: true,
  calendar: true,
  deviceSignals: true,
  handoff: true,
};

const editMeasurementPath = (gardenId: string, next = "/konto") =>
  `/havemaaler?garden=${gardenId}&next=${encodeURIComponent(next)}`;

const PROVIDER_ICONS: Record<string, ElementType> = {
  "profile-context": ShieldCheck,
  "app-handoff": Link2,
  "ai-garden-memory": Bot,
  "calendar-sync": CalendarDays,
  "push-reminders": Bell,
  "smart-garden-devices": PlugZap,
  "local-weather": CloudSun,
};

export default function Account() {
  const { user, loading, signOut } = useAuth();
  const nav = useNavigate();
  const { activeGardenId, setActive } = useActiveGarden();
  const [profile, setProfile] = useState<Profile>({ name: "", address: "", postal_code: "", avatar_url: null });
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [gardens, setGardens] = useState<Garden[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [plantCount, setPlantCount] = useState(0);
  const [wishProducts, setWishProducts] = useState<WishProduct[]>([]);
  const [zoneCounts, setZoneCounts] = useState<Record<string, number>>({});
  const [profileSync, setProfileSync] = useState<ProfileSync>(DEFAULT_PROFILE_SYNC);
  const [savingProfile, setSavingProfile] = useState(false);
  const [integrationBusy, setIntegrationBusy] = useState<string | null>(null);
  const [mapboxToken, setMapboxToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.functions.invoke("get-mapbox-token").then(({ data, error }) => {
      if (!cancelled && !error && typeof data?.token === "string") setMapboxToken(data.token);
    }).catch(() => {
      /* Satellite thumbnails are best effort on account cards. */
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loading && !user) nav("/login?next=/konto");
  }, [user, loading, nav]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: p }, { data: g }, { data: o }, { data: d }, { data: c }, { count }, { data: w }] = await Promise.all([
        supabase.from("profiles").select("name, address, postal_code, avatar_url").eq("id", user.id).maybeSingle(),
        supabase.from("gardens").select("id, name, area_m2, address, thumbnail_url, latitude, longitude").order("created_at", { ascending: false }),
        supabase.from("orders").select("id, created_at, total_dkk, status").order("created_at", { ascending: false }).limit(5),
        supabase.from("devices").select("id, name, kind, status, battery, garden_id").order("created_at", { ascending: false }),
        supabase.from("integration_connections").select("*").order("updated_at", { ascending: false }),
        supabase.from("user_plants").select("id", { count: "exact", head: true }),
        supabase.from("wishlists").select("product_id"),
      ]);
      if (p) setProfile({ name: p.name ?? "", address: p.address ?? "", postal_code: p.postal_code ?? "", avatar_url: p.avatar_url ?? null });
      const gardensList = (g ?? []) as Garden[];
      setGardens(gardensList);
      setOrders((o ?? []) as Order[]);
      setDevices((d ?? []) as Device[]);
      const connectionRows = (c ?? []) as IntegrationConnection[];
      setConnections(connectionRows);
      const profileContext = connectionRows.find((row) => row.provider === "profile-context");
      const settings = profileContext?.settings && typeof profileContext.settings === "object" ? profileContext.settings as Partial<ProfileSync> : {};
      setProfileSync({ ...DEFAULT_PROFILE_SYNC, ...settings });
      setPlantCount(count ?? 0);
      // Auto-pick active garden if none chosen
      if (gardensList.length && !activeGardenId) setActive(gardensList[0].id);
      // Zone counts
      if (gardensList.length) {
        const { data: zs } = await supabase
          .from("garden_zones")
          .select("garden_id")
          .in("garden_id", gardensList.map((garden) => garden.id));
        const counts: Record<string, number> = {};
        ((zs ?? []) as { garden_id: string }[]).forEach((zone) => { counts[zone.garden_id] = (counts[zone.garden_id] || 0) + 1; });
        setZoneCounts(counts);
      }
      const ids = ((w ?? []) as { product_id: string | null }[])
        .map((row) => row.product_id)
        .filter((id): id is string => Boolean(id));
      if (ids.length) {
        const { data: prods } = await supabase
          .from("products")
          .select("id, slug, name, base_price_dkk, gradient, svg_art")
          .in("id", ids);
        setWishProducts((prods as WishProduct[]) || []);
      } else {
        setWishProducts([]);
      }
    })();
  }, [user]);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSavingProfile(true);
    const { error } = await supabase.from("profiles").update({
      name: profile.name,
      address: profile.address,
      postal_code: profile.postal_code,
    }).eq("id", user.id);
    setSavingProfile(false);
    if (error) toast.error(error.message);
    else toast.success("Profil opdateret.");
  }

  async function uploadAvatar(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !user) return;
    if (f.size > 4 * 1024 * 1024) { toast.error("Billede er for stort (max 4 MB)."); return; }
    setUploadingAvatar(true);
    const ext = f.name.split(".").pop() || "jpg";
    const path = `${user.id}/avatar-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, f, { contentType: f.type, upsert: true });
    if (upErr) { toast.error(upErr.message); setUploadingAvatar(false); return; }
    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    const url = pub.publicUrl;
    const { error: updErr } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", user.id);
    if (updErr) { toast.error(updErr.message); setUploadingAvatar(false); return; }
    setProfile((p) => ({ ...p, avatar_url: url }));
    setUploadingAvatar(false);
    toast.success("Profilbillede opdateret.");
    e.target.value = "";
  }

  async function logout() {
    await signOut();
    nav("/");
  }

  async function saveIntegration(provider: IntegrationProvider, status: "connected" | "paused" | "planned" = "connected", settings: Json = {}) {
    if (!user) return;
    setIntegrationBusy(provider.provider);
    try {
      const existing = connectionFor(provider, connections);
      const payload = {
        kind: provider.kind,
        provider: provider.provider,
        display_name: provider.name,
        status,
        garden_id: provider.scope === "garden" || provider.scope === "device" ? activeGardenId ?? gardens[0]?.id ?? null : null,
        settings,
        last_sync_at: status === "connected" ? new Date().toISOString() : existing?.last_sync_at ?? null,
        updated_at: new Date().toISOString(),
      };
      if (existing) {
        const { error } = await supabase.from("integration_connections").update(payload).eq("id", existing.id);
        if (error) throw error;
        setConnections((prev) => prev.map((row) => row.id === existing.id ? { ...row, ...payload } as IntegrationConnection : row));
      } else {
        const { data, error } = await supabase.from("integration_connections").insert({
          user_id: user.id,
          ...payload,
        }).select().single();
        if (error) throw error;
        setConnections((prev) => [data as IntegrationConnection, ...prev]);
      }
      toast.success(status === "paused" ? "Integration sat på pause" : "Integration aktiveret");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke opdatere integration");
    } finally {
      setIntegrationBusy(null);
    }
  }

  async function activateProvider(provider: IntegrationProvider) {
    const settings = provider.provider === "profile-context"
      ? profileSync as unknown as Json
      : { activated_from: "account", active_garden_id: activeGardenId } as Json;
    await saveIntegration(provider, provider.canActivateLocally ? "connected" : "planned", settings);
  }

  async function pauseProvider(provider: IntegrationProvider) {
    await saveIntegration(provider, "paused", { paused_from: "account" } as Json);
  }

  async function syncProfileContext(next = profileSync) {
    const provider = CROSS_PLATFORM_PROVIDERS.find((item) => item.provider === "profile-context");
    if (!provider) return;
    setProfileSync(next);
    await saveIntegration(provider, "connected", next as unknown as Json);
  }

  async function syncAllActive() {
    if (!user) return;
    setIntegrationBusy("sync-all");
    const activeIds = connections.filter((row) => isConnectionActive(row)).map((row) => row.id);
    if (activeIds.length === 0) {
      setIntegrationBusy(null);
      toast.info("Aktivér mindst én integration først");
      return;
    }
    const stamp = new Date().toISOString();
    const { error } = await supabase.from("integration_connections").update({ last_sync_at: stamp, updated_at: stamp }).in("id", activeIds);
    setIntegrationBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setConnections((prev) => prev.map((row) => activeIds.includes(row.id) ? { ...row, last_sync_at: stamp, updated_at: stamp } : row));
    toast.success("Tværgående profil synkroniseret");
  }

  if (loading || !user) return null;

  const fmt = (n: number) => new Intl.NumberFormat("da-DK").format(n);
  const fmtDate = (s: string) => new Date(s).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" });
  const readiness = integrationReadiness(connections);

  return (
    <>
      <AppNav active="account" />
      <div className="container" style={{ paddingBottom: 60 }}>
        <header className="page-head">
          <div className="eyebrow" style={{ marginBottom: 14 }}>Min konto</div>
          <h1>Hej {profile.name || user.email?.split("@")[0]}.</h1>
          <p className="lede">Din have, dine ordrer, dine enheder — alt på ét sted.</p>
        </header>

        {/* KPIs */}
        <div className="account-grid">
          <Stat label="Haver" value={String(gardens.length)} link="/havemaaler" />
          <Stat label="Planter" value={String(plantCount)} />
          <Stat label="Enheder" value={String(devices.length)} />
          <Stat label="Integrationer" value={`${readiness.active}/${readiness.total}`} />
          <Stat label="Ordrer" value={String(orders.length)} link="/webshop" />
        </div>

        <Card
          title="Tværgående profil og integrationer"
          action={(
            <button className="btn btn-ghost btn-sm" onClick={() => void syncAllActive()} disabled={integrationBusy === "sync-all"}>
              <RefreshCcw size={14} /> {integrationBusy === "sync-all" ? "Synker..." : "Synk nu"}
            </button>
          )}
        >
          <div className="account-integration-hero">
            <div className="account-integration-copy">
              <div className="eyebrow">Cross-platform garden OS</div>
              <h2>Din profil forbinder værktøjerne, så hvert scan, kortpunkt og plejeråd kan følge med videre.</h2>
              <p>
                Brug dette som kontrolrum for kalender, notifikationer, AI-hukommelse, device-signaler og værktøjshandoff.
                Når det er aktivt, kan Havekongen dele den rigtige havekontekst mellem Havemåler, Min have,
                Havekompagnon og Plantepleje AI.
              </p>
              <div className="account-integration-actions">
                <button className="btn btn-primary" onClick={() => void syncProfileContext()}>
                  <ShieldCheck size={15} /> Aktivér fælles profil
                </button>
                <Link className="btn btn-ghost" to="/havekompagnon">
                  <MapPinned size={15} /> Åbn Havekompagnon
                </Link>
                <Link className="btn btn-ghost" to="/ai">
                  <Sparkles size={15} /> Åbn Plantepleje AI
                </Link>
              </div>
            </div>
            <div className="account-integration-score">
              <div className="account-score-ring" style={{ "--score": readiness.score } as CSSProperties}>{readiness.score}%</div>
              <strong>{readiness.active} af {readiness.total} forbindelser aktive</strong>
              <span>{readiness.missing.length === 0 ? "Alt er forbundet." : `Næste bedste kobling: ${readiness.missing[0].name}.`}</span>
            </div>
          </div>

          <div style={{ marginTop: 22 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Hvad må deles på tværs?</h3>
            <div className="account-profile-sync">
              <SyncToggle label="Haveprofil" text="Adresse, aktiv have og zoner." checked={profileSync.profileContext}
                onChange={(checked) => void syncProfileContext({ ...profileSync, profileContext: checked })} />
              <SyncToggle label="AI-hukommelse" text="Observationer, diagnoser og opgaver." checked={profileSync.aiMemory}
                onChange={(checked) => void syncProfileContext({ ...profileSync, aiMemory: checked })} />
              <SyncToggle label="Påmindelser" text="Push, klokker og opfølgninger." checked={profileSync.notifications}
                onChange={(checked) => void syncProfileContext({ ...profileSync, notifications: checked })} />
              <SyncToggle label="Kalender" text="Plejeplaner og sæsonopgaver." checked={profileSync.calendar}
                onChange={(checked) => void syncProfileContext({ ...profileSync, calendar: checked })} />
              <SyncToggle label="Device-signaler" text="Sensorer og autopilotstatus." checked={profileSync.deviceSignals}
                onChange={(checked) => void syncProfileContext({ ...profileSync, deviceSignals: checked })} />
              <SyncToggle label="Handoff" text="Samme zone/plante åbnes i næste værktøj." checked={profileSync.handoff}
                onChange={(checked) => void syncProfileContext({ ...profileSync, handoff: checked })} />
            </div>
          </div>

          <div style={{ marginTop: 22 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Forbindelser</h3>
            <div className="account-provider-grid">
              {CROSS_PLATFORM_PROVIDERS.map((provider) => {
                const connection = connectionFor(provider, connections);
                const active = isConnectionActive(connection);
                const Icon = PROVIDER_ICONS[provider.provider] ?? Database;
                return (
                  <article key={provider.provider} className={`account-provider-card ${active ? "active" : ""}`}>
                    <div className="account-provider-top">
                      <div className="account-provider-icon"><Icon size={18} /></div>
                      <span className="account-provider-status">{integrationStatusLabel(connection)}</span>
                    </div>
                    <div>
                      <h4>{provider.name}</h4>
                      <p>{provider.description}</p>
                    </div>
                    <div className="account-provider-tools">
                      {provider.tools.slice(0, 4).map((tool) => <span key={tool}>{tool}</span>)}
                    </div>
                    <div className="account-provider-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => void activateProvider(provider)} disabled={integrationBusy === provider.provider}>
                        <CheckCircle2 size={14} /> {active ? "Synk" : provider.canActivateLocally ? "Aktivér" : "Klargør"}
                      </button>
                      {connection && connection.status !== "paused" && (
                        <button className="btn btn-ghost btn-sm" onClick={() => void pauseProvider(provider)} disabled={integrationBusy === provider.provider}>
                          <PauseCircle size={14} /> Pause
                        </button>
                      )}
                      <Link className="btn btn-ghost btn-sm" to={provider.route}>
                        Åbn <ArrowRight size={13} />
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <div style={{ marginTop: 22 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Værktøjsflow</h3>
            <div className="account-flow">
              {TOOL_FLOW.map((tool, index) => (
                <Link key={tool.name} to={tool.route} className="account-flow-row">
                  <span className="account-flow-index">{index + 1}</span>
                  <span>
                    <strong>{tool.name}</strong>
                    <span>{tool.shares}</span>
                  </span>
                  <ArrowRight size={15} />
                </Link>
              ))}
            </div>
          </div>
        </Card>

        {/* Min have hub — full width */}
        <Card title="Min have" action={<Link to="/havemaaler" className="btn btn-ghost btn-sm">+ Ny opmåling</Link>}>
          {gardens.length === 0 ? (
            <Empty text="Ingen haver endnu — start med Havemåleren." cta={{ to: "/havemaaler", label: "Mål din have" }} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
              {gardens.map(g => {
                const active = g.id === activeGardenId;
                return (
                  <div key={g.id} style={{
                    border: active ? "2px solid var(--forest-800)" : "1px solid var(--ink-100)",
                    borderRadius: 14, overflow: "hidden", background: "var(--paper)",
                    display: "flex", flexDirection: "column",
                  }}>
                    <div style={{
                      aspectRatio: "16/10",
                      background: "linear-gradient(135deg, var(--forest-800), var(--ochre-600))",
                    }}>
                      <GardenThumbnailImage
                        garden={g}
                        mapboxToken={mapboxToken}
                        alt={g.name}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                    </div>
                    <div style={{ padding: 14, flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{g.name}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{g.address ?? "—"}</div>
                      <div style={{ display: "flex", gap: 10, fontSize: 12, color: "var(--ink-600)", marginTop: 4 }}>
                        <span>{g.area_m2 ? `${fmt(Math.round(g.area_m2))} m²` : "—"}</span>
                        <span>·</span>
                        <span>{zoneCounts[g.id] || 0} zoner</span>
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                        {active ? (
                          <span className="btn btn-ghost btn-sm" style={{ pointerEvents: "none", color: "var(--forest-800)" }}>✓ Aktiv</span>
                        ) : (
                          <button className="btn btn-ghost btn-sm" onClick={() => { setActive(g.id); toast.success(`${g.name} er nu aktiv`); }}>Brug denne</button>
                        )}
                        <Link to={editMeasurementPath(g.id)} className="btn btn-ghost btn-sm">
                          <Ruler size={14} /> Rediger måling
                        </Link>
                        <Link to="/havekompagnon" onClick={() => setActive(g.id)} className="btn btn-ghost btn-sm">Havekompagnon</Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <div className="account-main-grid">
          {/* Devices */}
          <Card title="Mine enheder" action={<Link to="/havekompagnon" className="btn btn-ghost btn-sm">Konfigurer</Link>}>
            {devices.length === 0 ? (
              <Empty text="Ingen enheder tilknyttet endnu." />
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {devices.map(d => (
                  <Row key={d.id}
                    title={d.name}
                    sub={`${d.kind} · ${d.status}`}
                    right={d.battery !== null ? `${d.battery}%` : ""}
                  />
                ))}
              </div>
            )}
          </Card>

          {/* Orders */}
          <Card title="Seneste ordrer" action={<Link to="/webshop" className="btn btn-ghost btn-sm">Til webshop</Link>}>
            {orders.length === 0 ? (
              <Empty text="Ingen ordrer endnu." cta={{ to: "/webshop", label: "Se webshop" }} />
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {orders.map(o => (
                  <Link to={`/order/${o.id}`} key={o.id} style={{ textDecoration: "none" }}>
                    <Row
                      title={`Ordre #${o.id.slice(0, 8).toUpperCase()}`}
                      sub={`${fmtDate(o.created_at)} · ${o.status}`}
                      right={`${fmt(o.total_dkk)} kr`}
                    />
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {/* Wishlist */}
          <Card title="Favoritter" action={<Link to="/webshop" className="btn btn-ghost btn-sm">Til webshop</Link>}>
            {wishProducts.length === 0 ? (
              <Empty text="Du har ingen favoritter endnu." cta={{ to: "/webshop", label: "Find produkter" }} />
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {wishProducts.map(w => (
                  <Link to={`/webshop/${w.slug}`} key={w.id} style={{ textDecoration: "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 10, background: "var(--ink-50)", borderRadius: 12 }}>
                      <div style={{ width: 44, height: 44, borderRadius: 8, background: w.gradient || "var(--mist-100)", flex: "0 0 44px", overflow: "hidden" }}>
                        {w.svg_art && <div dangerouslySetInnerHTML={{ __html: w.svg_art }} />}
                      </div>
                      <div style={{ flex: 1, fontSize: 14, color: "var(--ink-900)", fontWeight: 500 }}>{w.name}</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--forest-800)" }}>{fmt(w.base_price_dkk)} kr</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {/* Profile */}
          <Card title="Profil">
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
              <div style={{
                width: 64, height: 64, borderRadius: 32, overflow: "hidden",
                background: "var(--ink-50)", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 24, fontWeight: 600, color: "var(--forest-800)",
              }}>
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : ((profile.name || user.email || "?").charAt(0).toUpperCase())}
              </div>
              <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>
                {uploadingAvatar ? "Uploader…" : profile.avatar_url ? "Skift billede" : "Upload billede"}
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={uploadAvatar} disabled={uploadingAvatar} />
              </label>
            </div>
            <form onSubmit={saveProfile} style={{ display: "grid", gap: 12 }}>
              <div className="field">
                <label>Navn</label>
                <input value={profile.name ?? ""} onChange={e => setProfile({ ...profile, name: e.target.value })} />
              </div>
              <div className="field">
                <label>Adresse</label>
                <input value={profile.address ?? ""} onChange={e => setProfile({ ...profile, address: e.target.value })} />
              </div>
              <div className="field">
                <label>Postnummer</label>
                <input value={profile.postal_code ?? ""} onChange={e => setProfile({ ...profile, postal_code: e.target.value })} />
              </div>
              <div className="field">
                <label>Email</label>
                <input value={user.email ?? ""} disabled />
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button className="btn btn-primary" disabled={savingProfile}>
                  {savingProfile ? "Gemmer…" : "Gem ændringer"}
                </button>
                <button type="button" onClick={logout} className="btn btn-ghost">Log ud</button>
              </div>
            </form>
          </Card>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}

function Stat({ label, value, link }: { label: string; value: string; link?: string }) {
  const inner = (
    <div style={{
      background: "var(--paper)",
      border: "1px solid var(--ink-100)",
      borderRadius: 16,
      padding: "20px 22px",
    }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--ink-500)" }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 600, color: "var(--forest-800)", marginTop: 4 }}>{value}</div>
    </div>
  );
  return link ? <Link to={link} style={{ textDecoration: "none" }}>{inner}</Link> : inner;
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="account-card">
      <div className="account-card-head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function SyncToggle({ label, text, checked, onChange }: { label: string; text: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="account-sync-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <strong>{label}</strong>
      <span>{text}</span>
    </label>
  );
}

function Row({ title, sub, right }: { title: string; sub: string; right: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "12px 14px", background: "var(--ink-50)", borderRadius: 12,
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-900)" }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>{sub}</div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--forest-800)" }}>{right}</div>
    </div>
  );
}

function Empty({ text, cta }: { text: string; cta?: { to: string; label: string } }) {
  return (
    <div style={{ padding: "20px 0", textAlign: "center", color: "var(--ink-500)", fontSize: 14 }}>
      <p style={{ marginBottom: cta ? 12 : 0 }}>{text}</p>
      {cta && <Link to={cta.to} className="btn btn-primary btn-sm">{cta.label}</Link>}
    </div>
  );
}
