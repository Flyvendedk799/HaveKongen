import { Link } from "react-router-dom";
import { LegalPage, useCompany } from "./LegalLayout";

const TOC = [
  { id: "ansvarlig", label: "1. Dataansvarlig" },
  { id: "hvad", label: "2. Hvad vi indsamler" },
  { id: "hvorfor", label: "3. Formål og hjemmel" },
  { id: "placering", label: "4. Placering og haveopmåling" },
  { id: "ai", label: "5. Fotos, lyd og AI" },
  { id: "modtagere", label: "6. Hvem vi deler med" },
  { id: "opbevaring", label: "7. Hvor længe vi gemmer" },
  { id: "rettigheder", label: "8. Dine rettigheder" },
  { id: "sikkerhed", label: "9. Sikkerhed" },
  { id: "klage", label: "10. Klage" },
];

export default function Privacy() {
  const company = useCompany();

  return (
    <LegalPage
      title="Privatlivspolitik"
      description="Sådan behandler Havekongen dine personoplysninger: hvad vi indsamler, hvorfor, hvor længe, og hvordan du får indsigt eller sletning."
      updated="8. september 2026"
      toc={TOC}
    >
      <p>
        Havekongen ved en del om din have. Det er hele pointen — men det stiller også krav til,
        hvordan vi passer på oplysningerne. Denne politik beskriver præcis hvad vi gemmer, hvorfor,
        og hvordan du får det hele udleveret eller slettet.
      </p>

      <h2 id="ansvarlig">1. Dataansvarlig</h2>
      <table>
        <tbody>
          <tr><th>Dataansvarlig</th><td>{company.name}, CVR {company.cvr}</td></tr>
          <tr><th>Adresse</th><td>{company.address}</td></tr>
          <tr><th>Kontakt</th><td><a href={`mailto:${company.email}`}>{company.email}</a></td></tr>
        </tbody>
      </table>

      <h2 id="hvad">2. Hvad vi indsamler</h2>
      <table>
        <thead>
          <tr><th>Kategori</th><th>Eksempler</th></tr>
        </thead>
        <tbody>
          <tr><td>Konto</td><td>Navn, e-mail, adgangskode (hashet), telefon, avatar</td></tr>
          <tr><td>Ordrer</td><td>Ordrelinjer, beløb, leveringsadresse, betalingsstatus, returneringer</td></tr>
          <tr><td>Have</td><td>Adresse, koordinater, matrikel, polygoner, arealer, højdemodel, bede og zoner</td></tr>
          <tr><td>Planter og pleje</td><td>Dine planter, vandingsplaner, opgaver, journal, observationer</td></tr>
          <tr><td>Medier</td><td>Fotos af planter og bede, lydoptagelser fra fugle-lytteren</td></tr>
          <tr><td>Enheder</td><td>Tilknyttede robotklippere, sensorer og deres målinger</td></tr>
          <tr><td>Brug</td><td>Sidevisninger og hændelser — kun hvis du har sagt ja til statistik</td></tr>
          <tr><td>Samtykke</td><td>Dit cookievalg, tidspunkt og politikversion</td></tr>
        </tbody>
      </table>

      <h2 id="hvorfor">3. Formål og hjemmel</h2>
      <table>
        <thead>
          <tr><th>Formål</th><th>Hjemmel (GDPR)</th></tr>
        </thead>
        <tbody>
          <tr><td>Levere konto, have-funktioner og pleje-planer</td><td>Art. 6(1)(b) — opfyldelse af aftale</td></tr>
          <tr><td>Behandle ordrer, betalinger og returneringer</td><td>Art. 6(1)(b) — opfyldelse af aftale</td></tr>
          <tr><td>Bogføring af salg</td><td>Art. 6(1)(c) — retlig forpligtelse (bogføringsloven)</td></tr>
          <tr><td>Statistik om brug af siden</td><td>Art. 6(1)(a) — dit samtykke</td></tr>
          <tr><td>Nyhedsbrev</td><td>Art. 6(1)(a) — dit samtykke</td></tr>
          <tr><td>Sikkerhed, misbrugsbegrænsning og fejlsøgning</td><td>Art. 6(1)(f) — legitim interesse</td></tr>
        </tbody>
      </table>
      <p>
        Samtykke kan altid trækkes tilbage — i cookiebanneret via linket i bunden af siden, eller på
        din konto for nyhedsbrevet. Det påvirker ikke lovligheden af den behandling, der skete
        inden.
      </p>

      <h2 id="placering">4. Placering og haveopmåling</h2>
      <p>
        Når du bruger Havemåler, sender vi din adresse eller dine koordinater til{" "}
        <strong>Dataforsyningen (Styrelsen for Dataforsyning og Infrastruktur)</strong> for at hente
        matrikelgrænser, ortofoto og Danmarks Højdemodel. Dataforsyningen får den geografiske
        forespørgsel, men hverken dit navn eller din konto.
      </p>
      <p>
        Vejrdata hentes fra en åben vejrtjeneste ud fra havens omtrentlige koordinater. Vi gemmer
        vejrsvar i en cache, så vi ikke skal spørge igen for hver sideindlæsning.
      </p>
      <p>
        Din haves polygon og areal gemmes på din konto, indtil du sletter haven eller kontoen.
      </p>

      <h2 id="ai">5. Fotos, lyd og AI</h2>
      <p>
        Når du beder om en plantediagnose, en plantebestemmelse eller et fugle-ID, sender vi det
        pågældende billede eller lydklip til <strong>OpenAI</strong> som databehandler for at få
        svaret. Vi sender ikke dit navn eller din e-mail med.
      </p>
      <p>
        Dine fotos gemmes på din konto, så du kan følge en plantes udvikling over tid. Du kan slette
        dem enkeltvis i appen, og de forsvinder med kontoen.
      </p>
      <div className="fact-box">
        <p>
          AI-svar er vejledende. De er gode til at pege dig i den rigtige retning, men de er ikke en
          plantelæge, og de skal ikke bruges som eneste grundlag for at sprøjte eller fælde.
        </p>
      </div>

      <h2 id="modtagere">6. Hvem vi deler med</h2>
      <ul>
        <li><strong>Supabase</strong> — database, login og filer (EU)</li>
        <li><strong>OpenAI</strong> — AI-svar på tekst, billeder og lyd (USA, EU-standardkontrakt)</li>
        <li><strong>Dataforsyningen</strong> — kort, matrikel og højdemodel (DK)</li>
        <li><strong>Resend</strong> — udsendelse af ordre- og servicemails</li>
        <li><strong>Stripe</strong> — kortbetaling, hvis du vælger det (vi ser aldrig kortnummeret)</li>
        <li><strong>GLS</strong> — fragt: navn, adresse og telefonnummer til levering</li>
      </ul>
      <p>Vi sælger ikke dine oplysninger. Vi bruger dem ikke til profilering eller automatiske afgørelser med retsvirkning.</p>

      <h2 id="opbevaring">7. Hvor længe vi gemmer</h2>
      <table>
        <thead><tr><th>Data</th><th>Slettes</th></tr></thead>
        <tbody>
          <tr><td>Konto og havedata</td><td>Når du sletter kontoen</td></tr>
          <tr><td>Ordrer og fakturagrundlag</td><td>5 år efter regnskabsårets udløb (bogføringsloven)</td></tr>
          <tr><td>Support-henvendelser</td><td>2 år</td></tr>
          <tr><td>Samtykkelog</td><td>2 år efter tilbagekaldelse</td></tr>
          <tr><td>Fejl- og sikkerhedslog</td><td>90 dage</td></tr>
        </tbody>
      </table>
      <p>
        Sletter du din konto, mens vi stadig skal gemme ordredata af hensyn til bogføringsloven,
        anonymiserer vi ordren: beløb og varelinjer bliver stående, navn, adresse, telefon og e-mail
        fjernes.
      </p>

      <h2 id="rettigheder">8. Dine rettigheder</h2>
      <p>Du har ret til indsigt, berigtigelse, sletning, begrænsning, dataportabilitet og indsigelse. To af dem kan du bruge med det samme:</p>
      <ul>
        <li>
          <strong>Hent alle dine data</strong> som JSON under{" "}
          <Link to="/konto?tab=privatliv">Konto → Privatliv</Link>.
        </li>
        <li>
          <strong>Slet din konto</strong> samme sted. Sletningen udføres med det samme, når du
          bekræfter — der er ingen aktive ordrer i vejen.
        </li>
      </ul>
      <p>
        For de øvrige rettigheder: skriv til <a href={`mailto:${company.email}`}>{company.email}</a>.
        Vi svarer inden for en måned.
      </p>

      <h2 id="sikkerhed">9. Sikkerhed</h2>
      <p>
        Al trafik er krypteret med TLS. Adgang til data i databasen styres af row level security, så
        din konto kun kan læse sine egne rækker — ikke andres. Adgangskoder gemmes hashet og kan
        ikke læses af os. Adgang til produktionsdata er begrænset til de personer, der har brug for
        det.
      </p>
      <p>Ved et sikkerhedsbrud, der udgør en risiko for dig, giver vi besked i overensstemmelse med GDPR art. 33-34.</p>

      <h2 id="klage">10. Klage</h2>
      <p>
        Du kan klage til Datatilsynet, Carl Jacobsens Vej 35, 2500 Valby,{" "}
        <a href="https://www.datatilsynet.dk" target="_blank" rel="noreferrer noopener">datatilsynet.dk</a>.
        Vi hører gerne fra dig først — så kan vi nå at rette det.
      </p>
      <p>Se også vores <Link to="/cookies">cookiepolitik</Link>.</p>
    </LegalPage>
  );
}
