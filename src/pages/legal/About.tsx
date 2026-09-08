import { Link } from "react-router-dom";
import { Layers3, Leaf, Ruler, ShieldCheck, Sparkles, Bird } from "lucide-react";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useCompany } from "./LegalLayout";

const PILLARS = [
  {
    icon: Ruler,
    title: "Havemåler",
    body: "Tegn haven på et ortofoto og få arealet målt mod matriklen. Terræn og højder kommer fra Danmarks Højdemodel, så et skrånende bed ikke bliver regnet som fladt.",
    to: "/havemaaler",
  },
  {
    icon: Layers3,
    title: "3D-haven",
    body: "Vi finder træer, hække og skure i højdemodellen og foreslår dem — du godkender dem, der passer. Resultatet er en digital tvilling, du kan flytte rundt i.",
    to: "/havemaaler/3d",
  },
  {
    icon: Leaf,
    title: "Havekompagnon",
    body: "Bede, planter og vanding samlet ét sted. Planen tager højde for jordtype, sol og hvad vejret rent faktisk har gjort de sidste døgn.",
    to: "/havekompagnon",
  },
  {
    icon: Bird,
    title: "Dyreliv",
    body: "Lyt efter fuglene i haven og byg en artsliste. Havens dyreliv er en måling af, om det du planter virker.",
    to: "/dyreliv",
  },
  {
    icon: Sparkles,
    title: "Plantepleje AI",
    body: "Tag et billede af et sygt blad og få en diagnose, en behandling og en forebyggelse — på dansk, og med forbehold, hvor der skal tages forbehold.",
    to: "/ai",
  },
  {
    icon: ShieldCheck,
    title: "Webshop",
    body: "Frø, planter, jord og værktøj vi selv bruger. Priser inklusive moms, lager der passer, og en ordre du kan følge fra kurv til hoveddør.",
    to: "/webshop",
  },
];

export default function About() {
  const company = useCompany();

  usePageMeta({
    title: "Om Havekongen",
    description:
      "Havekongen binder hele haven sammen — opmåling, 3D-tvilling, pleje, dyreliv og webshop. Bygget til danske haver og dansk vejr.",
  });

  return (
    <>
      <AppNav />
      <div className="container legal-page">
        <header className="page-head">
          <div className="eyebrow" style={{ marginBottom: 14 }}>Om os</div>
          <h1>Din have, dit kongerige.</h1>
          <p className="lede">
            Havekongen begyndte med en irritation: at det er nemmere at få vejrudsigten for hele
            Danmark end at få at vide, hvor stort ens eget græsplæne egentlig er.
          </p>
        </header>

        <h2 style={{ borderTop: "none", paddingTop: 0 }}>Hvad vi bygger</h2>
        <p>
          De fleste haveapps starter med en tom database og beder dig fylde den. Vi starter det
          modsatte sted: Danmark har allerede matrikelkort, ortofotos og en højdemodel med
          centimeterpræcision. Den viden burde ligge i din have-app, ikke i et fagsystem.
        </p>
        <p>
          Så vi henter den, tegner din have oven på den, og bygger alt det andet — vandingsplan,
          plantevalg, opgaver, dyreliv — oven på et grundlag, der faktisk kender din grund.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, margin: "28px 0 8px" }}>
          {PILLARS.map((p) => (
            <Link key={p.title} to={p.to} className="card" style={{ padding: 20, textDecoration: "none", display: "block" }}>
              <p.icon size={20} style={{ color: "var(--forest-600)" }} />
              <h3 style={{ margin: "10px 0 6px", fontSize: 16 }}>{p.title}</h3>
              <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0, color: "var(--ink-500)" }}>{p.body}</p>
            </Link>
          ))}
        </div>

        <h2>Sådan tænker vi om tal</h2>
        <p>
          Et areal fra et ortofoto er et estimat. Et træs højde aflæst i en overflademodel er et
          estimat. Vi siger det, hvor det gælder, i stedet for at pynte på det med to decimaler.
          Skal tallet bruges til et skel eller en entreprise, så få en landinspektør — vi er et
          godt udgangspunkt, ikke en autoritet.
        </p>
        <p>
          Det samme gælder AI. Den er god til at pege dig i retning af, hvad der er galt med et
          blad. Den er ikke en plantelæge, og vi lader som om den er det.
        </p>

        <h2>Sådan tænker vi om dine data</h2>
        <p>
          Din have er personlige oplysninger — den ligger på din adresse. Vi sælger dem ikke, vi
          profilerer ikke på dem, og du kan hente hele bundtet som JSON eller slette kontoen med to
          klik under <Link to="/konto?tab=privatliv">Konto → Privatliv</Link>. Statistik kører kun,
          hvis du siger ja.
        </p>
        <p>
          Detaljerne står i <Link to="/privatliv">privatlivspolitikken</Link>.
        </p>

        <h2>Havekongen</h2>
        <p>
          {company.name} · CVR {company.cvr}<br />
          {company.address}<br />
          <a href={`mailto:${company.email}`}>{company.email}</a> · {company.phone}
        </p>
        <p>
          <Link to="/kontakt" className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>Skriv til os</Link>
        </p>
      </div>
      <SiteFooter />
    </>
  );
}
