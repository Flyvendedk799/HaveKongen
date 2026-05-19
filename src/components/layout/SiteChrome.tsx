import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import { useCommandPalette } from "@/components/CommandPalette";
import { NotificationsBell } from "@/components/NotificationsBell";
import { supabase } from "@/integrations/supabase/client";
import { ShoppingCart, Search, User as UserIcon } from "lucide-react";

function Logo() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 22V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 14C8 14 5 11 5 7C9 7 12 10 12 14Z" fill="currentColor" opacity="0.85" />
      <path d="M12 12C16 12 19 9 19 5C15 5 12 8 12 12Z" fill="currentColor" />
    </svg>
  );
}

function AccountButton({ dark = false }: { dark?: boolean }) {
  const { user, loading } = useAuth();
  const [avatar, setAvatar] = useState<string | null>(null);
  useEffect(() => {
    if (!user) { setAvatar(null); return; }
    supabase.from("profiles").select("avatar_url").eq("id", user.id).maybeSingle().then(({ data }) => {
      setAvatar(data?.avatar_url ?? null);
    });
  }, [user?.id]);
  if (loading) return null;
  if (user) {
    const name = (user.user_metadata?.name as string | undefined) || user.email?.split("@")[0] || "Konto";
    const initial = name.charAt(0).toUpperCase();
    return (
      <Link to="/konto" className="nav-account" aria-label={`Min konto (${name})`}>
        {avatar ? (
          <img src={avatar} alt="" className="nav-avatar" style={{ objectFit: "cover" }} />
        ) : (
          <span className="nav-avatar">{initial}</span>
        )}
        <span className="nav-account-name">{name}</span>
      </Link>
    );
  }
  return (
    <Link to="/login" className={`btn ${dark ? "btn-primary" : "btn-primary"} btn-sm`}>
      <UserIcon size={14} /> Log ind
    </Link>
  );
}

function CartButton() {
  const count = useCart((s) => s.count());
  const open = useCart((s) => s.openCart);
  return (
    <button onClick={open} className="nav-cart" aria-label={`Indkøbskurv${count ? `, ${count} varer` : ""}`}>
      <ShoppingCart size={16} />
      {count > 0 && <span className="nav-cart-badge">{count}</span>}
    </button>
  );
}

export function SiteNav({ onDark = true }: { onDark?: boolean }) {
  const openPalette = useCommandPalette((s) => s.open);
  return (
    <nav className={`nav ${onDark ? "on-dark" : ""}`} id="nav">
      <Link className="nav-logo" to="/">
        <Logo />
        Havelandet
      </Link>
      <div className="nav-links">
        <Link to="/min-have">Min have</Link>
        <Link to="/webshop">Webshop</Link>
        <Link to="/havemaaler">Havemåler</Link>
        <Link to="/havekompagnon">Havekompagnon</Link>
        <Link to="/dyreliv">Dyreliv</Link>
        <Link to="/ai">Plantepleje AI</Link>
      </div>
      <div className="nav-actions">
        <button className="btn btn-ghost btn-sm" aria-label="Søg" onClick={openPalette}>
          <Search size={14} /> Søg
          <kbd className="nav-kbd">⌘K</kbd>
        </button>
        <NotificationsBell />
        <CartButton />
        <AccountButton dark />
      </div>
    </nav>
  );
}

export function AppNav({ active }: { active?: string }) {
  const openPalette = useCommandPalette((s) => s.open);
  const link = (path: string, label: string, key: string) => (
    <Link to={path} className={active === key ? "active" : undefined}>
      {label}
    </Link>
  );
  return (
    <nav className="app-nav">
      <Link className="nav-logo" to="/">
        <Logo />
        Havelandet
      </Link>
      <div className="nav-links">
        {link("/min-have", "Min have", "hub")}
        {link("/webshop", "Webshop", "shop")}
        {link("/havemaaler", "Havemåler", "sizer")}
        {link("/havekompagnon", "Havekompagnon", "companion")}
        {link("/dyreliv", "Dyreliv", "wildlife")}
        {link("/ai", "Plantepleje AI", "ai")}
      </div>
      <div className="nav-actions">
        <button className="btn btn-ghost btn-sm" aria-label="Søg" onClick={openPalette}>
          <Search size={14} /> Søg
          <kbd className="nav-kbd">⌘K</kbd>
        </button>
        <NotificationsBell />
        <CartButton />
        <AccountButton />
      </div>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="footer grain">
      <div className="container">
        <div className="footer-grid">
          <div>
            <div className="footer-mark">
              Havelandet<em>.</em>
            </div>
            <p style={{ color: "rgba(237,232,223,0.6)", fontSize: 14, maxWidth: 320, lineHeight: 1.6 }}>
              Lev din have. Fra det første frø, til årets sidste blad.
            </p>
          </div>
          <div className="footer-col">
            <h4>Webshop</h4>
            <ul>
              <li><Link to="/webshop?cat=froe">Frø &amp; planter</Link></li>
              <li><Link to="/webshop?cat=jord">Jord &amp; gødning</Link></li>
              <li><Link to="/webshop?cat=robot">Robotplæneklippere</Link></li>
              <li><Link to="/webshop?cat=vanding">Vanding</Link></li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Værktøjer</h4>
            <ul>
              <li><Link to="/havemaaler">Havemåler</Link></li>
              <li><Link to="/havekompagnon">Havekompagnon</Link></li>
              <li><Link to="/dyreliv">Dyreliv</Link></li>
              <li><Link to="/ai">Plantepleje AI</Link></li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Os</h4>
            <ul>
              <li><a href="#">Om Havelandet</a></li>
              <li><a href="#">Kontakt</a></li>
              <li><a href="#">Presse</a></li>
              <li><a href="#">Vilkår</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 Havelandet ApS — København</span>
          <span>CVR 4488 1230 · Made in Denmark</span>
        </div>
      </div>
    </footer>
  );
}
