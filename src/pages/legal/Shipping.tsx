import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LegalPage, useCompany } from "./LegalLayout";
import { listShippingMethods } from "@/lib/shop";
import { formatOere, formatEta } from "@/lib/money";
import type { Tables } from "@/integrations/supabase/types";

export default function Shipping() {
  const company = useCompany();
  const [methods, setMethods] = useState<Tables<"shipping_methods">[]>([]);

  // The table below is the same data the checkout prices against, so this page
  // cannot drift out of date the way a hand-written price list does.
  useEffect(() => {
    listShippingMethods()
      .then(setMethods)
      .catch(() => setMethods([]));
  }, []);

  return (
    <LegalPage
      title="Levering og retur"
      description="Fragtpriser, leveringstider, fortrydelsesret og hvordan du returnerer en vare til Havekongen."
      updated="8. september 2026"
    >
      <h2>Fragtpriser</h2>
      {methods.length === 0 ? (
        <p className="muted-note">Henter aktuelle fragtpriser…</p>
      ) : (
        <table>
          <thead>
            <tr><th>Metode</th><th>Leveringstid</th><th>Pris</th><th>Gratis fra</th></tr>
          </thead>
          <tbody>
            {methods.map((m) => (
              <tr key={m.code}>
                <td>
                  <strong>{m.name}</strong>
                  {m.carrier && <div className="muted-note">{m.carrier}</div>}
                </td>
                <td>{formatEta(m.eta_min_days, m.eta_max_days)}</td>
                <td>{formatOere(m.price_oere)}</td>
                <td>{m.free_over_oere != null ? formatOere(m.free_over_oere) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p>
        Priserne er inklusive moms og gælder levering i Danmark. Leveringstiden regnes i hverdage
        fra det tidspunkt, betalingen er registreret — ikke fra ordretidspunktet.
      </p>

      <h2>Sådan følger du pakken</h2>
      <p>
        Du får en mail med pakkenummer, når ordren forlader lageret. Nummeret står også på
        ordresiden sammen med et forløb, der viser præcis hvor ordren er: modtaget, betalt,
        afsendt, leveret.
      </p>

      <h2>Levende planter</h2>
      <p>
        Planter, løg og frø sendes, så de er kortest muligt undervejs. I hårdt frostvejr eller
        vedvarende hedebølge udskyder vi afsendelsen for at undgå transportskader — du får besked,
        hvis det sker, og kan naturligvis annullere i stedet.
      </p>
      <p>
        Tjek forsendelsen ved modtagelse. Er noget beskadiget, så skriv til os inden for{" "}
        <strong>48 timer</strong> med et billede, så sender vi en ny.
      </p>

      <h2>Fortrydelsesret — 14 dage</h2>
      <p>
        Du har 14 dages fortrydelsesret fra den dag, du modtager varen. Giv os besked inden fristen
        udløber; du behøver ikke begrunde det. Varen skal derefter sendes retur senest 14 dage
        efter.
      </p>

      <h2>Retur — 30 dage</h2>
      <p>
        Ud over fortrydelsesretten tager vi ubrugte varer i original emballage retur i 30 dage.
      </p>
      <ol>
        <li>Åbn ordren under <Link to="/konto?tab=ordrer">Min konto → Ordrer</Link>.</li>
        <li>Vælg <em>Opret returnering</em> og angiv årsagen.</li>
        <li>Du får en vejledning på mail. Pak varen forsvarligt — gerne i den kasse, den kom i.</li>
        <li>Vi refunderer inden for 14 dage, efter vi har modtaget varen.</li>
      </ol>
      <div className="fact-box">
        <p>
          Er varen defekt eller forkert leveret, betaler vi returfragten. Har du fortrudt, betaler
          du selv returfragten.
        </p>
      </div>

      <h2>Reklamation</h2>
      <p>
        Der er 2 års reklamationsret efter købeloven. Opdager du en mangel, så skriv til{" "}
        <a href={`mailto:${company.email}`}>{company.email}</a> med ordrenummer og gerne et billede.
        Er reklamationen berettiget, dækker vi fragten begge veje.
      </p>

      <h2>Returadresse</h2>
      <p>
        {company.name}<br />
        {company.address}
      </p>
      <p className="muted-note">
        Send ikke pakker retur uden at have oprettet en returnering først — så ved vi ikke, hvem de
        er fra, og refusionen bliver unødigt langsom.
      </p>

      <p>
        Detaljerne står i vores <Link to="/handelsbetingelser">handelsbetingelser</Link>.
      </p>
    </LegalPage>
  );
}
