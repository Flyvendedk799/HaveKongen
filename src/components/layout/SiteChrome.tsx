import { Link } from "react-router-dom";

export function SiteNav({ onDark = true }: { onDark?: boolean }) {
  return (
    <nav className={`nav ${onDark ? "on-dark" : ""}`} id="nav">
      <Link className="nav-logo" to="/">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 22V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M12 14C8 14 5 11 5 7C9 7 12 10 12 14Z" fill="currentColor" opacity="0.85" />
          <path d="M12 12C16 12 19 9 19 5C15 5 12 8 12 12Z" fill="currentColor" />
        </svg>
        Havelandet
      </Link>
      <div className="nav-links">
        <Link to="/webshop">Webshop</Link>
        <Link to="/havemaaler">Havemåler</Link>
        <Link to="/vanding">Vandingsplan</Link>
        <Link to="/ai">Plantepleje AI</Link>
        <Link to="/konto">Min konto</Link>
      </div>
      <div className="nav-actions">
        <button className="btn btn-ghost btn-sm" aria-label="Søg">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M9.5 9.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          Søg
        </button>
        <Link to="/konto" className="btn btn-primary btn-sm">Min konto</Link>
      </div>
    </nav>
  );
}

export function AppNav({ active }: { active?: string }) {
  const link = (path: string, label: string, key: string) => (
    <Link to={path} className={active === key ? "active" : undefined}>{label}</Link>
  );
  return (
    <nav className="app-nav">
      <Link className="nav-logo" to="/">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
          <path d="M12 22V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M12 14C8 14 5 11 5 7C9 7 12 10 12 14Z" fill="currentColor" opacity="0.85" />
          <path d="M12 12C16 12 19 9 19 5C15 5 12 8 12 12Z" fill="currentColor" />
        </svg>
        Havelandet
      </Link>
      <div className="nav-links">
        {link("/webshop", "Webshop", "shop")}
        {link("/havemaaler", "Havemåler", "sizer")}
        {link("/vanding", "Vandingsplan", "water")}
        {link("/ai", "Plantepleje AI", "ai")}
        {link("/konto", "Min konto", "account")}
      </div>
      <div className="nav-actions">
        <Link className="btn btn-primary btn-sm" to="/konto">Min konto</Link>
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
            <div className="footer-mark">Havelandet<em>.</em></div>
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
              <li><Link to="/vanding">Vandingsplan</Link></li>
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
