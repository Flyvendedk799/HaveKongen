import { Link } from "react-router-dom";
import { LegalPage } from "./LegalLayout";
import { useConsent } from "@/lib/consent";

export default function Cookies() {
  const { choice, reopen } = useConsent();

  return (
    <LegalPage
      title="Cookiepolitik"
      description="Hvilke cookies og lokal lagring Havekongen bruger, hvad de gør, og hvordan du ændrer dit valg."
      updated="8. september 2026"
    >
      <p>
        Havekongen bruger cookies og tilsvarende lokal lagring i din browser. Kun de nødvendige
        sættes uden dit samtykke — resten kræver, at du siger ja, og du kan skifte mening når som
        helst.
      </p>

      <div className="fact-box">
        <p>
          <strong>Dit nuværende valg:</strong>{" "}
          {choice
            ? [
                "Nødvendige",
                choice.functional && "Funktionelle",
                choice.analytics && "Statistik",
                choice.marketing && "Marketing",
              ]
                .filter(Boolean)
                .join(", ")
            : "Du har ikke taget stilling endnu."}{" "}
          <button type="button" className="linkish" onClick={reopen}>Skift valg</button>
        </p>
      </div>

      <h2>Nødvendige</h2>
      <p>Uden disse virker siden ikke. De sættes altid og kan ikke fravælges.</p>
      <table>
        <thead><tr><th>Navn</th><th>Formål</th><th>Levetid</th></tr></thead>
        <tbody>
          <tr><td>sb-*-auth-token</td><td>Holder dig logget ind</td><td>Til du logger ud</td></tr>
          <tr><td>havekongen-cart</td><td>Husker din kurv mellem besøg</td><td>Til du rydder den</td></tr>
          <tr><td>havekongen-consent</td><td>Husker dette valg</td><td>12 måneder</td></tr>
          <tr><td>havekongen-anon-id</td><td>Knytter samtykket til denne browser</td><td>12 måneder</td></tr>
        </tbody>
      </table>

      <h2>Funktionelle</h2>
      <p>Bekvemmelighed. Siden virker uden dem, men husker mindre.</p>
      <table>
        <thead><tr><th>Navn</th><th>Formål</th><th>Levetid</th></tr></thead>
        <tbody>
          <tr><td>havekongen-active-garden</td><td>Husker hvilken have du sidst arbejdede i</td><td>12 måneder</td></tr>
          <tr><td>companion.simpleView</td><td>Husker din valgte fane i Havekompagnon</td><td>12 måneder</td></tr>
          <tr><td>havemaaler.*</td><td>Gemmer en igangværende opmåling, så den overlever en genindlæsning</td><td>30 dage</td></tr>
        </tbody>
      </table>

      <h2>Statistik</h2>
      <p>
        Anonym viden om, hvilke sider der bruges, og hvor noget går galt. Vi gemmer hændelserne
        lokalt i din browser og sender dem ikke videre til en tredjepart.
      </p>
      <table>
        <thead><tr><th>Navn</th><th>Formål</th><th>Levetid</th></tr></thead>
        <tbody>
          <tr><td>havekongen-analytics</td><td>Sidevisninger og hændelser, maks. 500 ad gangen</td><td>Til du rydder browserdata</td></tr>
        </tbody>
      </table>

      <h2>Marketing</h2>
      <p>
        Vi sætter <strong>ingen</strong> marketing-cookies i dag. Kategorien står her, fordi
        samtykket skal være indhentet på forhånd, hvis vi en dag begynder at måle effekten af
        annoncer — ikke fordi der ligger noget nu.
      </p>

      <h2>Fejlsøgning uden samtykke</h2>
      <p>
        Nogle få driftshændelser registreres uanset dit valg: at en ordre blev afgivet, og at et
        checkout eller en betaling fejlede. De indeholder ingen personoplysninger og bruges
        udelukkende til at opdage, at kassen er i stykker.
      </p>

      <h2>Sådan sletter du dem</h2>
      <p>
        Du kan slette cookies og lokal lagring i din browsers indstillinger. Sletter du{" "}
        <code>havekongen-consent</code>, bliver du spurgt igen ved næste besøg.
      </p>

      <p>
        Læs også vores <Link to="/privatliv">privatlivspolitik</Link>.
      </p>
    </LegalPage>
  );
}
