import { useEffect } from "react";
import { Link } from "react-router-dom";
import { initScene } from "@/scene/scene.js";
import { SiteNav, SiteFooter } from "@/components/layout/SiteChrome";

export default function Index() {
  useEffect(() => {
    document.title = "Havelandet — Lev din have";
    let cleanup: undefined | (() => void);
    // Defer to next frame so DOM (canvas, .stage, etc.) is mounted
    const id = requestAnimationFrame(() => {
      cleanup = initScene() as unknown as () => void;
    });
    return () => {
      cancelAnimationFrame(id);
      cleanup?.();
      // Hide loader if still present
      document.getElementById("hl-loader")?.remove();
    };
  }, []);

  return (
    <>
      {/* Loader */}
      <div className="loader" id="hl-loader">
        <div className="loader-mark" />
        <div className="loader-label">Havelandet</div>
        <div className="loader-progress">Forbereder haven</div>
      </div>

      <SiteNav onDark />

      <div className="progress-rail">
        <div className="progress-dot" data-label="Overblik" />
        <div className="progress-dot" data-label="Haven lever" />
        <div className="progress-dot" data-label="Året rundt" />
        <div className="progress-dot" data-label="Årstider" />
        <div className="progress-dot" data-label="Platformen" />
      </div>

      {/* 3D STAGE — 4 acts */}
      <section className="stage">
        <canvas id="scene" />
        <div className="stage-overlay">
          <div className="hero-intro" id="heroIntro">
            <h1>Hele din have. <em>Ét sted.</em></h1>
            <p className="lede">
              Havelandet er platformen der binder hele din have sammen — vanding, robotklipper,
              frø, planter og daglig pleje. Bygget til danske haver.
            </p>
          </div>

          <div className="act-marker" data-act="1">
            <div className="ix">Akt 01 — Det store overblik</div>
            <h2>Hver kvadratmeter, kortlagt.</h2>
            <p>Bede, plæne, terrasse, drivhus, pergola. Havelandet kender din have — fra hækken i øst til kompostbunken i vest.</p>
          </div>
          <div className="act-marker" data-act="2">
            <div className="ix">Akt 02 — Haven arbejder selv</div>
            <h2>Vand, klip og pas — automatisk.</h2>
            <p>Robotklipperen kører sine ruter. Sprinklerne tænder når jorden er tør. Drivhuset lufter ud når solen står højt.</p>
          </div>
          <div className="act-marker" data-act="3">
            <div className="ix">Akt 03 — Året rundt</div>
            <h2>Fra forårsknopper til efterårsløv.</h2>
            <p>Havelandet følger sæsonerne. Påmindelser om hvornår du skal beskære, så, høste og dække til — alt uden at du skal tænke over det.</p>
          </div>
          <div className="act-marker" data-act="4">
            <div className="ix">Akt 04 — Platformen</div>
            <h2>Tre værktøjer. Én have. Ét sted.</h2>
            <p>Mål haven på kortet. Planlæg vandingen for hvert bed. Spørg plante-AI'en om råd. Alt sammenkoblet — uden fem apps og tre konti.</p>
          </div>

          <div className="scroll-cue">
            <span>Scroll</span>
            <div className="line" />
          </div>
        </div>
      </section>

      {/* TOOLS */}
      <section className="section tools-section">
        <div className="container">
          <div className="tools-head">
            <div>
              <div className="eyebrow" style={{ marginBottom: 16 }}>Platformen</div>
              <h2>Tre værktøjer. Én have.</h2>
            </div>
            <p>Havelandet er bygget op om de værktøjer du bruger ugentligt — fra forår til vinter. Mål, planlæg, og spørg AI'en om råd. Alt sammen ét sted, uden abonnement på det vi bruger.</p>
          </div>

          <div className="tools-grid">
            <Link to="/havemaaler" className="tool-card span-7">
              <span className="stripe" />
              <div className="tool-visual sizer-mini">
                <svg viewBox="0 0 400 240" fill="none">
                  <defs>
                    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path d="M20 0H0V20" stroke="rgba(237,232,223,0.06)" strokeWidth="1" />
                    </pattern>
                  </defs>
                  <rect width="400" height="240" fill="url(#grid)" />
                  <path d="M60 60 L320 50 L340 180 L80 200 Z" fill="rgba(216,166,81,0.18)" stroke="#ecc784" strokeWidth="2" strokeLinejoin="round" />
                  <circle cx="60" cy="60" r="5" fill="#ecc784" />
                  <circle cx="320" cy="50" r="5" fill="#ecc784" />
                  <circle cx="340" cy="180" r="5" fill="#ecc784" />
                  <circle cx="80" cy="200" r="5" fill="#ecc784" />
                  <text x="200" y="130" fill="#ede8df" fontFamily="Tenor Sans" fontSize="32" textAnchor="middle">412 m²</text>
                </svg>
              </div>
              <h3>Havemåler</h3>
              <p>Tegn din græsplæne på kortet. Få straks anbefaling af den rette robotplæneklipper og estimat på klippetid.</p>
              <span className="tool-card-link">Mål din have <Arrow /></span>
            </Link>

            <Link to="/vanding" className="tool-card span-5">
              <span className="stripe" />
              <div className="tool-visual water-mini">
                <div className="drops">
                  {[20, 35, 50, 65, 80, 25, 60].map((l, i) => (
                    <span key={i} className="drop" style={{ left: `${l}%`, animationDelay: `${i * 0.4}s` }} />
                  ))}
                </div>
              </div>
              <h3>Vandingsplan</h3>
              <p>Lav timere for hvert bed. AI'en justerer efter vejrudsigten og planternes behov.</p>
              <span className="tool-card-link">Planlæg vanding <Arrow /></span>
            </Link>

            <Link to="/ai" className="tool-card span-12">
              <span className="stripe" />
              <div className="tool-visual ai-mini" style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                <div className="bubble">Mine tomater har gule blade nederst — hvad skal jeg gøre?</div>
                <div className="bubble user">Det lyder som overvanding. Lad jorden tørre 2–3 dage. Vil du have en justeret vandingsplan?</div>
              </div>
              <h3>Plantepleje AI</h3>
              <p>Spørg om alt — fra gule blade til hvornår du skal beskære. Den husker dine planter og din have.</p>
              <span className="tool-card-link">Stil et spørgsmål <Arrow /></span>
            </Link>
          </div>
        </div>
      </section>

      {/* WEBSHOP STRIP */}
      <section className="section shop-section">
        <div className="container">
          <div className="tools-head">
            <div>
              <div className="eyebrow" style={{ marginBottom: 16 }}>Også i webshoppen</div>
              <h2>Et håndplukket sortiment.</h2>
            </div>
            <p>Når du har brug for frø, jord eller en ny robotplæneklipper — vi har valgt det vi selv bruger. Det er ikke det vigtigste her, men det er der.</p>
          </div>

          <div className="shop-grid">
            {SAMPLE_PRODUCTS.map((p) => (
              <Link key={p.name} className="product" to="/webshop">
                <div className="product-img" style={{ background: p.bg }}>
                  <div dangerouslySetInnerHTML={{ __html: p.svg }} />
                </div>
                <div className="name">{p.name}</div>
                <div className="meta">{p.meta}</div>
                <div className="price">{p.price}</div>
              </Link>
            ))}
          </div>

          <div style={{ textAlign: "center", marginTop: 64 }}>
            <Link to="/webshop" className="btn btn-ghost">Se hele sortimentet <Arrow /></Link>
          </div>
        </div>
      </section>

      {/* SEASONS */}
      <section className="seasons-band">
        <div className="container">
          <div className="eyebrow" style={{ color: "var(--gold-300)", marginBottom: 16 }}>Året rundt</div>
          <h2>Vi følger haven gennem alle fire årstider.</h2>
          <div className="seasons-grid">
            <Season cls="s-spring" name="Forår" desc="Sårtid. Vi minder dig om hvornår jorden er klar — og sender de første frø ud." />
            <Season cls="s-summer" name="Sommer" desc="Vanding, klipning og høst. Robotterne arbejder, du nyder eftermiddagene." />
            <Season cls="s-autumn" name="Efterår" desc="Beskæring, dvale, løg i jorden. Forberedelse til næste sæson." />
            <Season cls="s-winter" name="Vinter" desc="Hvilen. Vi planlægger den næste have sammen — over en kop kaffe." />
          </div>
        </div>
      </section>

      {/* MANIFESTO */}
      <section className="manifesto">
        <div className="container">
          <div className="manifesto-grid">
            <div>
              <div className="eyebrow" style={{ marginBottom: 24 }}>Vores tilgang</div>
              <h2>Bygget til danske haver. Ikke importeret.</h2>
            </div>
            <div className="manifesto-body">
              <p>Vi startede Havelandet fordi vi savnede ét sted hvor man kunne handle og passe sin have — uden at skulle hoppe mellem fem apps og tre webshops.</p>
              <p>I dag arbejder vi med danske gartnerier, lokale frøavlere og dygtige danske ingeniører. Alt vi anbefaler er testet i dansk klima — fra en regnvåd marts til en tør juli.</p>
              <div className="manifesto-stats">
                <Stat n="38.000+" l="Aktive haver" />
                <Stat n="120" l="Danske leverandører" />
                <Stat n="4,8" l="Trustpilot" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}

function Arrow() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
      <path d="M1 5h12m0 0L9 1m4 4L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function Season({ cls, name, desc }: { cls: string; name: string; desc: string }) {
  return (
    <div className={`season-card ${cls}`}>
      <div className="swatch" />
      <h3>{name}</h3>
      <p>{desc}</p>
    </div>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div className="stat">
      <div className="num">{n}</div>
      <div className="lbl">{l}</div>
    </div>
  );
}

const SAMPLE_PRODUCTS = [
  {
    name: "Solsikke 'Velvet Queen'",
    meta: "Frøpose · 25 frø",
    price: "39 kr",
    bg: "linear-gradient(160deg, #c5d4ca, #7a9e88 70%, #3a6249)",
    svg: `<svg viewBox='0 0 200 250' style='position:absolute; inset:0; width:100%; height:100%;'><ellipse cx='100' cy='180' rx='40' ry='50' fill='#5a4232' opacity='0.6'/><path d='M100 170 Q90 130 70 110 Q90 100 100 80 Q110 100 130 110 Q110 130 100 170Z' fill='#3a6249'/><circle cx='100' cy='80' r='8' fill='#ecc784'/></svg>`,
  },
  {
    name: "Spagnumjord, økologisk",
    meta: "40 liter",
    price: "89 kr",
    bg: "linear-gradient(160deg, #ede8df, #b89c80)",
    svg: `<svg viewBox='0 0 200 250' style='position:absolute; inset:0; width:100%; height:100%;'><rect x='50' y='100' width='100' height='120' rx='6' fill='#5a4232'/><rect x='55' y='105' width='90' height='20' fill='#8b6f56'/><text x='100' y='170' fill='#ede8df' font-family='Tenor Sans' font-size='14' text-anchor='middle'>Økologisk</text><text x='100' y='190' fill='#ede8df' font-family='Tenor Sans' font-size='14' text-anchor='middle'>Spagnum</text></svg>`,
  },
  {
    name: "Klipper R3 Pro",
    meta: "Op til 1500 m²",
    price: "12.499 kr",
    bg: "linear-gradient(160deg, #faf8f3, #c5d4ca)",
    svg: `<svg viewBox='0 0 200 250' style='position:absolute; inset:0; width:100%; height:100%;'><ellipse cx='100' cy='180' rx='60' ry='20' fill='#284836' opacity='0.3'/><rect x='50' y='120' width='100' height='40' rx='8' fill='#ede8df' stroke='#14271d' stroke-width='1.5'/><ellipse cx='100' cy='135' rx='35' ry='6' fill='#284836' opacity='0.4'/><rect x='50' y='118' width='100' height='6' fill='#c89441'/><circle cx='65' cy='155' r='4' fill='#0c1a13'/><circle cx='135' cy='155' r='4' fill='#0c1a13'/></svg>`,
  },
  {
    name: "Sprinkler, justerbar",
    meta: "Dækker op til 80 m²",
    price: "249 kr",
    bg: "linear-gradient(160deg, #c5d4ca, #284836)",
    svg: `<svg viewBox='0 0 200 250' style='position:absolute; inset:0; width:100%; height:100%;'><rect x='90' y='60' width='20' height='130' fill='#5a655e'/><circle cx='100' cy='60' r='22' fill='#3a6249'/><g stroke='#ecc784' stroke-width='2' fill='none'><path d='M100 60 L60 100'/><path d='M100 60 L70 130'/><path d='M100 60 L100 140'/><path d='M100 60 L130 130'/><path d='M100 60 L140 100'/></g></svg>`,
  },
];
