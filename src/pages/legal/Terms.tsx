import { Link } from "react-router-dom";
import { LegalPage, useCompany } from "./LegalLayout";

const TOC = [
  { id: "sælger", label: "1. Sælger" },
  { id: "priser", label: "2. Priser og moms" },
  { id: "bestilling", label: "3. Bestilling og aftale" },
  { id: "betaling", label: "4. Betaling" },
  { id: "levering", label: "5. Levering" },
  { id: "fortrydelse", label: "6. Fortrydelsesret" },
  { id: "retur", label: "7. Returnering og refusion" },
  { id: "reklamation", label: "8. Reklamationsret" },
  { id: "planter", label: "9. Levende planter og frø" },
  { id: "digitale", label: "10. Havemåler, AI og abonnementer" },
  { id: "ansvar", label: "11. Ansvar" },
  { id: "klage", label: "12. Klageadgang" },
];

export default function Terms() {
  const company = useCompany();

  return (
    <LegalPage
      title="Handelsbetingelser"
      description="Havekongens salgs- og leveringsbetingelser: priser, betaling, levering, fortrydelsesret, returnering og reklamation."
      updated="8. september 2026"
      toc={TOC}
    >
      <p>
        Disse betingelser gælder for alle køb på havekongen.dk. Ved at afgive en bestilling
        accepterer du dem. De begrænser ikke dine ufravigelige rettigheder efter dansk
        forbrugerlovgivning.
      </p>

      <h2 id="sælger">1. Sælger</h2>
      <table>
        <tbody>
          <tr><th>Virksomhed</th><td>{company.name}</td></tr>
          <tr><th>CVR-nr.</th><td>{company.cvr}</td></tr>
          <tr><th>Adresse</th><td>{company.address}</td></tr>
          <tr><th>E-mail</th><td><a href={`mailto:${company.email}`}>{company.email}</a></td></tr>
          <tr><th>Telefon</th><td>{company.phone} ({company.support_hours})</td></tr>
        </tbody>
      </table>

      <h2 id="priser">2. Priser og moms</h2>
      <p>
        Alle priser er i danske kroner og <strong>inklusive 25% moms</strong>. Momsbeløbet vises
        særskilt i kassen og på din ordrebekræftelse. Fragt lægges til og fremgår, før du bestiller.
      </p>
      <p>
        Prisen beregnes på vores server ud fra det aktuelle katalog på bestillingstidspunktet — ikke
        ud fra hvad din browser måtte have gemt. Ligger en vare i kurven, når prisen ændres, er det
        den nye pris, du ser i kassen, og den, du betaler.
      </p>
      <p>
        Vi tager forbehold for åbenlyse pris- og trykfejl. Er en pris tydeligt forkert (fx en
        robotplæneklipper til 9 kr.), er vi ikke forpligtet til at levere til den pris. Vi
        kontakter dig og annullerer ordren uden omkostninger for dig.
      </p>

      <h2 id="bestilling">3. Bestilling og aftale</h2>
      <p>
        Din bestilling er et tilbud om køb. Aftalen er indgået, når vi bekræfter ordren på e-mail.
        Vi reserverer varerne på lageret i det øjeblik, ordren oprettes, så en vare ikke kan sælges
        to gange.
      </p>
      <p>
        Vi kan annullere en ordre, hvis en vare mod forventning er udsolgt, hvis der er tale om en
        åbenlys fejl, eller hvis betalingen ikke gennemføres. Du får naturligvis pengene retur.
      </p>
      <p>
        Du kan selv annullere en ordre fra ordresiden eller din konto, så længe den ikke er pakket
        og afsendt. Varerne lægges automatisk tilbage på lager.
      </p>

      <h2 id="betaling">4. Betaling</h2>
      <p>Vi tilbyder:</p>
      <ul>
        <li>
          <strong>Bankoverførsel.</strong> Du modtager kontooplysninger og et ordrenummer med det
          samme. Beløbet skal være os i hænde inden 8 dage. Vi pakker ordren, når betalingen er
          registreret.
        </li>
        <li>
          <strong>Betalingskort.</strong> Håndteres af vores betalingsudbyder. Havekongen gemmer
          ikke kortnumre. Beløbet trækkes, når betalingen godkendes.
        </li>
      </ul>
      <p>Ejendomsretten overgår først til dig, når hele beløbet er betalt.</p>

      <h2 id="levering">5. Levering</h2>
      <p>
        Vi leverer i hele Danmark. Fragtpriser og forventet leveringstid vises i kassen, før du
        bestiller. Leveringstider er vejledende og regnes i hverdage fra det tidspunkt, betalingen
        er registreret.
      </p>
      <p>
        Du får en mail med pakkenummer, når ordren forlader vores lager, og kan følge status på
        ordresiden.
      </p>

      <h2 id="fortrydelse">6. Fortrydelsesret</h2>
      <p>
        Du har <strong>14 dages fortrydelsesret</strong> fra den dag, du modtager varen. Du skal
        give os besked inden fristen udløber — brug ordresiden, eller skriv til{" "}
        <a href={`mailto:${company.email}`}>{company.email}</a>. En besked er nok; du behøver ikke
        begrunde den.
      </p>
      <p>
        Varen skal returneres senest 14 dage efter, du har fortrudt. Du betaler selv returfragten,
        medmindre varen er defekt eller forkert leveret. Du hæfter for en eventuel forringelse, hvis
        varen er brugt ud over, hvad der er nødvendigt for at fastslå dens art og funktion.
      </p>
      <div className="fact-box">
        <p>
          <strong>Undtagelser.</strong> Fortrydelsesretten gælder ikke for varer, der er fremstillet
          efter dine specifikationer, forseglede varer, som af sundhedsmæssige grunde ikke kan
          returneres efter åbning, eller varer, der efter levering er blandet uadskilleligt med
          andre — fx jord, der er spredt ud i bedet.
        </p>
      </div>

      <h2 id="retur">7. Returnering og refusion</h2>
      <p>
        Ud over den lovpligtige fortrydelsesret giver vi dig <strong>30 dages retur</strong> på
        ubrugte varer i original emballage. Opret returneringen på ordresiden, så sender vi en
        vejledning.
      </p>
      <p>
        Vi refunderer beløbet senest 14 dage efter, vi har modtaget varen retur, med samme
        betalingsmiddel som du betalte med. Fragtomkostninger refunderes svarende til den billigste
        leveringsform, vi tilbyder.
      </p>

      <h2 id="reklamation">8. Reklamationsret</h2>
      <p>
        Der er <strong>2 års reklamationsret</strong> efter købeloven. Er der en mangel ved varen,
        har du ret til at få den repareret, ombyttet, få pengene tilbage eller et afslag i prisen —
        afhængigt af situationen.
      </p>
      <p>
        Reklamationen skal ske inden for rimelig tid, efter du har opdaget manglen. Reklamerer du
        inden for to måneder, er det altid rettidigt. Er reklamationen berettiget, refunderer vi
        dine rimelige fragtomkostninger.
      </p>

      <h2 id="planter">9. Levende planter og frø</h2>
      <p>
        Planter, løg og frø er levende varer. Vi garanterer, at de er sunde og korrekt sorteret ved
        afsendelse, og vi pakker dem til at tåle transporten.
      </p>
      <ul>
        <li>
          Kontrollér forsendelsen ved modtagelse og giv os besked inden for <strong>48 timer</strong>,
          hvis noget er beskadiget. Send gerne et billede — det gør sagen hurtig.
        </li>
        <li>
          Vi kan ikke garantere spireevne eller overlevelse efter plantning, da det afhænger af
          jord, vanding, vejr og pasning hos dig. Frø leveres med den spireprocent, der står på
          pakken.
        </li>
        <li>
          I perioder med frost eller vedvarende hedebølge kan vi udskyde afsendelsen af levende
          planter for at undgå transportskader. Du får besked, hvis det sker.
        </li>
      </ul>

      <h2 id="digitale">10. Havemåler, AI og abonnementer</h2>
      <p>
        Havemåler, Havekompagnon, Dyreliv og Plantepleje AI stilles til rådighed som de er.
        Målinger fra Danmarks Højdemodel og ortofoto er <strong>estimater</strong> og må ikke
        bruges som grundlag for matrikulære, juridiske eller entreprenørmæssige beslutninger. Ved
        tvivl: få en landinspektør til at måle op.
      </p>
      <p>
        AI-svar om planter, sygdomme og pleje er vejledende og erstatter ikke rådgivning fra en
        fagperson. Følg altid producentens anvisninger på gødning og bekæmpelsesmidler.
      </p>

      <h2 id="ansvar">11. Ansvar</h2>
      <p>
        Vi er ansvarlige efter dansk rets almindelige regler. Vi er ikke ansvarlige for indirekte
        tab som driftstab, tabt arbejdsfortjeneste eller følgeskader, og heller ikke for forhold vi
        ikke er herre over (force majeure), herunder ekstremt vejr, strejke og nedbrud hos
        transportører eller underleverandører.
      </p>

      <h2 id="klage">12. Klageadgang</h2>
      <p>
        Er du ikke tilfreds, så skriv til <a href={`mailto:${company.email}`}>{company.email}</a> —
        vi vil hellere løse det end have en sag.
      </p>
      <p>
        Får vi det ikke løst, kan du klage til Nævnenes Hus, Toldboden 2, 8800 Viborg
        (<a href="https://www.naevneneshus.dk" target="_blank" rel="noreferrer noopener">naevneneshus.dk</a>).
        Du kan også bruge EU-Kommissionens online klageportal på{" "}
        <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noreferrer noopener">ec.europa.eu/consumers/odr</a>{" "}
        — angiv vores e-mailadresse, når du opretter klagen.
      </p>
      <p>
        Se også vores <Link to="/privatliv">privatlivspolitik</Link> og{" "}
        <Link to="/levering-og-retur">levering og retur</Link>.
      </p>
    </LegalPage>
  );
}
