import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

type Profile = { name: string | null; address: string | null; postal_code: string | null };
type Garden = { id: string; name: string; area_m2: number | null; address: string | null };
type Order = { id: string; created_at: string; total_dkk: number; status: string };
type Device = { id: string; name: string; kind: string; status: string; battery: number | null };

export default function Account() {
  const { user, loading, signOut } = useAuth();
  const nav = useNavigate();
  const [profile, setProfile] = useState<Profile>({ name: "", address: "", postal_code: "" });
  const [gardens, setGardens] = useState<Garden[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [plantCount, setPlantCount] = useState(0);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (!loading && !user) nav("/login?next=/konto");
  }, [user, loading, nav]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: p }, { data: g }, { data: o }, { data: d }, { count }] = await Promise.all([
        supabase.from("profiles").select("name, address, postal_code").eq("id", user.id).maybeSingle(),
        supabase.from("gardens").select("id, name, area_m2, address").order("created_at", { ascending: false }),
        supabase.from("orders").select("id, created_at, total_dkk, status").order("created_at", { ascending: false }).limit(5),
        supabase.from("devices").select("id, name, kind, status, battery").order("created_at", { ascending: false }),
        supabase.from("user_plants").select("id", { count: "exact", head: true }),
      ]);
      if (p) setProfile({ name: p.name ?? "", address: p.address ?? "", postal_code: p.postal_code ?? "" });
      setGardens(g ?? []);
      setOrders(o ?? []);
      setDevices(d ?? []);
      setPlantCount(count ?? 0);
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>
          {/* Gardens */}
          <Card title="Mine haver" action={<Link to="/havemaaler" className="btn btn-ghost btn-sm">+ Ny opmåling</Link>}>
            {gardens.length === 0 ? (
              <Empty text="Ingen haver endnu — start med Havemåleren." cta={{ to: "/havemaaler", label: "Mål din have" }} />
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {gardens.map(g => (
                  <Row key={g.id}
                    title={g.name}
                    sub={g.address ?? "—"}
                    right={g.area_m2 ? `${fmt(Math.round(g.area_m2))} m²` : ""}
                  />
                ))}
              </div>
            )}
          </Card>

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
                  <Row key={o.id}
                    title={`Ordre #${o.id.slice(0, 8)}`}
                    sub={`${fmtDate(o.created_at)} · ${o.status}`}
                    right={`${fmt(o.total_dkk)} kr`}
                  />
                ))}
              </div>
            )}
          </Card>

          {/* Profile */}
          <Card title="Profil">
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
