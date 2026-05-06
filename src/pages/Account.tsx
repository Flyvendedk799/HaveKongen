import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useActiveGarden } from "@/lib/activeGarden";
import { toast } from "sonner";

type Profile = { name: string | null; address: string | null; postal_code: string | null; avatar_url: string | null };
type Garden = { id: string; name: string; area_m2: number | null; address: string | null; thumbnail_url: string | null };
type Order = { id: string; created_at: string; total_dkk: number; status: string };
type Device = { id: string; name: string; kind: string; status: string; battery: number | null };
type WishProduct = { id: string; slug: string; name: string; base_price_dkk: number; gradient: string | null; svg_art: string | null };
type ZoneCount = { garden_id: string; count: number };

export default function Account() {
  const { user, loading, signOut } = useAuth();
  const nav = useNavigate();
  const { activeGardenId, setActive } = useActiveGarden();
  const [profile, setProfile] = useState<Profile>({ name: "", address: "", postal_code: "", avatar_url: null });
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [gardens, setGardens] = useState<Garden[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [plantCount, setPlantCount] = useState(0);
  const [wishProducts, setWishProducts] = useState<WishProduct[]>([]);
  const [zoneCounts, setZoneCounts] = useState<Record<string, number>>({});
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (!loading && !user) nav("/login?next=/konto");
  }, [user, loading, nav]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: p }, { data: g }, { data: o }, { data: d }, { count }, { data: w }] = await Promise.all([
        supabase.from("profiles").select("name, address, postal_code, avatar_url").eq("id", user.id).maybeSingle(),
        supabase.from("gardens").select("id, name, area_m2, address, thumbnail_url").order("created_at", { ascending: false }),
        supabase.from("orders").select("id, created_at, total_dkk, status").order("created_at", { ascending: false }).limit(5),
        supabase.from("devices").select("id, name, kind, status, battery").order("created_at", { ascending: false }),
        supabase.from("user_plants").select("id", { count: "exact", head: true }),
        supabase.from("wishlists").select("product_id"),
      ]);
      if (p) setProfile({ name: p.name ?? "", address: p.address ?? "", postal_code: p.postal_code ?? "", avatar_url: (p as any).avatar_url ?? null });
      const gardensList = g ?? [];
      setGardens(gardensList);
      setOrders(o ?? []);
      setDevices(d ?? []);
      setPlantCount(count ?? 0);
      // Auto-pick active garden if none chosen
      if (gardensList.length && !activeGardenId) setActive(gardensList[0].id);
      // Zone counts
      if (gardensList.length) {
        const { data: zs } = await supabase
          .from("garden_zones")
          .select("garden_id")
          .in("garden_id", gardensList.map((x: any) => x.id));
        const counts: Record<string, number> = {};
        (zs ?? []).forEach((z: any) => { counts[z.garden_id] = (counts[z.garden_id] || 0) + 1; });
        setZoneCounts(counts);
      }
      const ids = (w ?? []).map((r: any) => r.product_id);
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

  async function saveProfile(e: React.FormEvent) {
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

  async function uploadAvatar(e: React.ChangeEvent<HTMLInputElement>) {
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

  if (loading || !user) return null;

  const fmt = (n: number) => new Intl.NumberFormat("da-DK").format(n);
  const fmtDate = (s: string) => new Date(s).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" });

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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 32 }}>
          <Stat label="Haver" value={String(gardens.length)} link="/havemaaler" />
          <Stat label="Planter" value={String(plantCount)} />
          <Stat label="Enheder" value={String(devices.length)} />
          <Stat label="Ordrer" value={String(orders.length)} link="/webshop" />
        </div>

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
                      background: g.thumbnail_url ? `url(${g.thumbnail_url}) center/cover` : "linear-gradient(135deg, var(--forest-800), var(--ochre-600))",
                    }} />
                    <div style={{ padding: 14, flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{g.name}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{g.address ?? "—"}</div>
                      <div style={{ display: "flex", gap: 10, fontSize: 12, color: "var(--ink-600)", marginTop: 4 }}>
                        <span>{g.area_m2 ? `${fmt(Math.round(g.area_m2))} m²` : "—"}</span>
                        <span>·</span>
                        <span>{zoneCounts[g.id] || 0} zoner</span>
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                        {active ? (
                          <span className="btn btn-ghost btn-sm" style={{ pointerEvents: "none", color: "var(--forest-800)" }}>✓ Aktiv</span>
                        ) : (
                          <button className="btn btn-ghost btn-sm" onClick={() => { setActive(g.id); toast.success(`${g.name} er nu aktiv`); }}>Brug denne</button>
                        )}
                        <Link to="/vanding" className="btn btn-ghost btn-sm">Vanding</Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start", marginTop: 24 }}>
          {/* Devices */}
          <Card title="Mine enheder" action={<Link to="/vanding" className="btn btn-ghost btn-sm">Konfigurer</Link>}>
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

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{
      background: "var(--paper)",
      border: "1px solid var(--ink-100)",
      borderRadius: 20,
      padding: 24,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
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
