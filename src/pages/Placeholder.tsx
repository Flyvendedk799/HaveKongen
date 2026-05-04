import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { Link } from "react-router-dom";

export default function Placeholder({
  active,
  title,
  eyebrow,
  description,
}: {
  active: string;
  title: string;
  eyebrow: string;
  description: string;
}) {
  return (
    <>
      <AppNav active={active} />
      <div className="container">
        <header className="page-head">
          <div className="eyebrow" style={{ marginBottom: 14 }}>{eyebrow}</div>
          <h1>{title}</h1>
          <p className="lede">{description}</p>
        </header>
        <div style={{ padding: "60px 0", color: "var(--ink-500)" }}>
          <p>Denne side bygges i næste fase. <Link to="/" style={{ color: "var(--forest-800)", textDecoration: "underline" }}>Tilbage til forsiden</Link></p>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
