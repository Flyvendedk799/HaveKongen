# Pinpoint-animation til havemåleren — v3 (ambitiøs)

## Vision
Det øjeblik brugeren vælger sin adresse skal føles som åbningen af en Pixar-film: vi forlader formularen, suser ned gennem skylaget, ortofotoet folder sig ud under os, en pin lander med vægt på præcis dén matrikel — og sekunder efter står de klar til at tegne deres have. Animationen er **ikke** pynt; den er et tillids-signal ("vi har fundet din rigtige have") og en onboarding ("sådan ser dit lærred ud").

Vi genbruger DNA fra ConnectKøge (stage-state-machine, pin-impact-FX, HUD), men hæver ambitionen markant: **rigtige geodata i hver fase, kontinuert kamera, ingen cuts, sømløst handoff til step 2's redigeringskort.**

---

## Sequence 1 — Foundation: Cinematic map engine

Det vigtigste valg: én levende Mapbox-instans der overlever fra animation til redigering. Ingen fake billeder, ingen cross-fades mellem forskellige tile-kilder.

### Dual-source style (én map, to lag)
```text
sources:
  sat   → mapbox://styles/.../satellite-streets-v12   (global, zoom 0-18)
  orto  → SDFE WMS ortofoto (DK, zoom 14-22, skarpere)

layers:
  sat-layer:  raster-opacity = interpolate(zoom, 14→1, 17→0)
  orto-layer: raster-opacity = interpolate(zoom, 14→0, 17→1)
```
Mapbox' egen zoom-expression klarer cross-faden uden manuel timing. Når flyTo passerer zoom 15-16 fader satellit ud i ortofoto helt af sig selv — ingen flicker, ingen tile-snap.

### Cinematic flyTo
```ts
map.flyTo({
  center: [lng, lat],
  zoom: 18.5,
  pitch: 58,
  bearing: -10,
  duration: 1800,
  curve: 1.7,
  speed: 1.2,
  easing: t => 1 - Math.pow(1 - t, 3),  // easeOutCubic
});
```
Vi lytter på `move`-events for at trigger DROP-fasen når kameraet er ~85% gennem flyTo'en (pin'en falder mens kortet stadig zoomer = parallax).

### Filer
- `src/lib/pinpoint/mapEngine.ts` — `createPinpointMap(container, token, ortoTemplate, center)` returnerer Mapbox-instans med dual-source style og helpers `flyToTarget()`, `levelOut()`.

---

## Sequence 2 — Stage choreography & timing

Stage-machine porteret fra ConnectKøges `app.jsx`, udvidet til 7 faser. Alle overlapper via CSS-transitions; én `requestAnimationFrame`-loop holder styr på stage-skift baseret på flyTo-progress.

```text
Fase       Varighed  Hvad sker                                          Trigger
INTRO      180ms     HUD + adressekort fader ind, kort er sort+grain    setStage('intro')
GLOBE      320ms     satellit zoom 4, langsom bearing 0→8, aurora       setStage('globe')
DESCENT   1400ms     flyTo til zoom 18.5 + pitch 58, ortofoto fader ind setStage('descent') + map.flyTo()
DROP       450ms     pin falder fra toppen m. trail+beam (start @85%)   move-event når progress>0.85
IMPACT     320ms     shockwave, dust, sparkles, camera-shake på overlay setStage('impact')
SETTLE     280ms     pitch→0, bearing→0, pin pulserer rolig             easeTo({pitch:0,bearing:0})
HANDOFF    220ms     overlay fader ud, step 2 mounter omkring map       setStage('handoff') → onDone(map)
```

`prefers-reduced-motion`: spring direkte til zoom 18 (jumpTo, ingen pitch), kør kun 250 ms cross-fade. Skip-knap øverst til højre kalder samme fast-path.

---

## Sequence 3 — Pin & impact FX (port fra ConnectKøge)

Direkte port af `pin.jsx` med disse opgraderinger:
- **Themed pin-SVG:** `currentColor` styres af `--primary` (HSL-token), ingen hardcoded farve.
- **Pin-skygge på kortet:** I stedet for kun DOM-skygge tilføjer vi en Mapbox `circle`-layer på `[lng, lat]` med `circle-blur: 1`, `circle-radius: interpolate(zoom, 17→8, 19→24)` der vokser i takt med zoomen — så skyggen "ankommer" sammen med pin'en.
- **Beam-justering:** Beam'en projiceres så den rammer skærm-koordinatet for `[lng, lat]` (ikke nødvendigvis skærmens midte hvis kortet er panoreret undervejs). Vi bruger `map.project([lng, lat])` hver frame under DROP.
- **Impact-ripples i kortrummet:** Ud over DOM-ripples tilføjer vi en Mapbox `circle`-layer hvis `circle-radius` animeres 0→200px over 1.8s med opacity 0.9→0 — så bølgen ses "i kortet" og ikke kun ovenpå.
- **Sparkles:** Beholdes som DOM (14 partikler, port af `sparkFly`-keyframe).

### Filer
- `src/components/havemaaler/PinpointPin.tsx` — SVG + DOM-FX.
- `src/lib/pinpoint/mapFx.ts` — `addPinShadow(map, lngLat)`, `pulseRipple(map, lngLat)`, `removeAllFx(map)`.

---

## Sequence 4 — Real-world imagery in every phase

| Fase     | Zoom     | Hvad ses                          | Imagery                              |
|----------|----------|-----------------------------------|--------------------------------------|
| GLOBE    | 4        | Skandinavien fra rummet           | satellite-streets-v12                |
| DESCENT  | 4 → 16   | Sky → land → by, accelereret      | satellite → orto cross-fade (auto)   |
| CITY     | 16 → 17  | Kvarter, gader, tag-strukturer    | orto fader ind, sat fader ud         |
| STREET   | 17 → 18.5| Matrikel, hæk, terrasse synlig    | ortofoto 100%                        |
| HANDOFF  | 18.5     | Identisk med step 2               | ortofoto 100% (samme kilde)          |

**Forberedelse af ortofoto-tiles:** Under INTRO-fasen kalder vi `map.preloadTiles()`-mønster: et usynligt `<img>` per forventet tile rundt om destinationen ved zoom 18 så de er i browser-cachen før DESCENT rammer dem. Reducerer risiko for grå tomme felter under landing.

**Skydækkesimulering (valgfri polish):** Et tyndt SVG-cloud-pattern lag (`opacity: 0.4`) der scroll'er forbi under DESCENT (zoom 4-12) og forsvinder ved zoom 13. Føles som "vi bryder gennem skyer". Kan toggles via prop `showClouds={true}`.

---

## Sequence 5 — Sømløst handoff til step 2

Ambitionen: nul reload, nul blink, samme map-instans hele vejen.

### Strategi A (foretrukken): DOM-portering
1. PinpointSequence mounter map i `<div ref={overlayMapContainer}>`.
2. På HANDOFF kalder vi `onDone(map)`.
3. Parent (GardenSizer) flytter `map.getContainer()` ind i step 2's `<div ref={editorMapContainer}>` via `appendChild` — Mapbox' WebGL-state, tiles og kamera bevares.
4. `map.resize()` kaldes efter flytning. Step 2's drawing-sources/layers tilføjes oven på det levende kort.

### Strategi B (fallback): Kamera-match cross-fade
Hvis DOM-portering bryder Mapbox' resize-observer:
1. Step 2 opretter sin egen map med eksakt samme `center/zoom/pitch/bearing` og `preserveDrawingBuffer: true`.
2. Når step 2's første frame er klar (`idle`-event) → fade overlay ud over 200 ms.

Vi bygger Strategi A først, har Strategi B som flag bag `VITE_PINPOINT_HANDOFF=fade`.

### Filer
- `src/lib/pinpoint/handoff.ts` — `portMapTo(map, newContainer)`, `cloneCameraState(map)`.
- `src/pages/GardenSizer.tsx` — refaktorér map-init til at acceptere en eksisterende map-instans via `handoffMapRef`.

---

## Sequence 6 — HUD, address card & micro-interactions

Direkte inspireret af ConnectKøges HUD, men dansk og knyttet til vores backend-kald.

### HUD (top-center, glas-pille)
```text
● Finder adresse   ● Henter ortofoto   ● Placerer pin   ○ Klar
```
Fire steps, hver med dot der animerer fra grå → primary (active, pulserende glow) → grøn (done). Bundet til stage-machine. `aria-live="polite"` annoncerer aktiv step.

### Adressekort (bottom-center, glas-kort, slide-up under DROP)
```text
┌─────────────────────────────────────────┐
│ 📍 Strandvejen 42, 4600 Køge            │
│    Matrikel 17a · Køge Bygrunde         │ ← hentet fra get-matrikel under DESCENT
│    Areal: ~840 m² jordstykke            │
└─────────────────────────────────────────┘
```
**Bonus-ambition:** Vi pre-fetch'er `get-matrikel`-edge-funktionen under GLOBE/DESCENT så matrikel-data er klar at vise i kortet samtidig med pin'en lander. Dette giver brugeren et "wow, den kender allerede min grund"-øjeblik. Step 2 har dataen klar → ingen ekstra spinner.

### Micro-interactions
- Skip-knap (top-right): "Spring over →", calls `onDone()` straks.
- Adresse-tekst i HUD har subtil typewriter-effekt (60 ms/char) under INTRO.
- Vibration (`navigator.vibrate(8)`) ved IMPACT på mobil.
- Subtil "whoosh"-lyd ved DESCENT + "thunk" ved IMPACT — bag en `audioEnabled`-toggle (default off; respekt for stille browsing).

### Filer
- `src/components/havemaaler/PinpointHUD.tsx` — step-indikator + adressekort.
- `src/components/havemaaler/PinpointSkipButton.tsx`.
- `public/sounds/whoosh.mp3` + `thunk.mp3` (kun hvis vi går videre med audio — 5-10 KB hver).

---

## Sequence 7 — Background atmosphere (ConnectKøge-style)

Tre lag der lever oven på kortet under GLOBE/DESCENT og fader ud i CITY:
- **Vignette** (`bg-vignette`): radial gradient kanter mørkere → fokuserer øjet.
- **Aurora glow** (`bg-aurora`): blød rød/orange/blå glow der "ånder" (port af `auroraBreathe` 6s alt.). Kun zoom 4-12.
- **Star/grain field** (`bg-grain`): SVG-noise-pattern på lav opacity for filmisk korn — beholdes hele vejen, fader til 50% i CITY.
- **Cloud layer** (valgfri, jf. Sequence 4).

Alle deaktiveres ved `prefers-reduced-motion`.

### Filer
- `src/components/havemaaler/pinpoint.css` — alle keyframes og atmosphere-klasser.

---

## Sequence 8 — Edge cases, polish & a11y

### Edge cases
- **Adresse uden for DK:** Ortofoto-source returnerer 404. Fallback: bliv på satellite-streets ved zoom 18 (samme adfærd som GardenSizer i dag). HUD-step "Henter ortofoto" → "Henter satellitbillede".
- **Token-fejl:** Hvis `get-mapbox-token` fejler, vis kort fejl-toast og spring direkte til step 2 uden animation.
- **Bruger navigerer væk under sekvens:** `useEffect`-cleanup kalder `map.remove()` for at undgå WebGL-leak.
- **Window resize under flyTo:** Lyt på `resize` og kald `map.resize()` + juster pin-overlay-projektion.
- **Slow connection:** Hvis tiles ikke er loadet ved IMPACT, vis blød pulserende skeleton bag pin'en indtil `idle`-event fyrer.

### Performance
- Mål FPS via `performance.now()`-loop; hvis <45fps i 200ms, deaktiver aurora+grain automatisk.
- `will-change: transform, opacity` på pin og overlay-lag.
- Mapbox `antialias: true` kun på desktop (via `matchMedia('(pointer: fine)')`).

### Tilgængelighed
- `role="status" aria-live="polite"` på HUD så skærmlæsere annoncerer faser.
- Skip-knap fokuserbar med tab; Esc kalder også `onDone()`.
- `prefers-reduced-motion`: jumpTo, ingen FX, 250 ms fade.
- Keyboard fokus returneres til step 2's første interaktive element efter HANDOFF.

### Analytics
- Track `pinpoint_started`, `pinpoint_skipped`, `pinpoint_completed` med duration.
- Hjælper os iterere på timing baseret på rigtig brug.

---

## Filer der oprettes (samlet)
```text
src/components/havemaaler/
  PinpointSequence.tsx       (orchestrator: stage-machine, map-mount, FX-trigger)
  PinpointPin.tsx            (SVG + DOM-FX, port af pin.jsx)
  PinpointHUD.tsx            (4-step indikator + adressekort)
  PinpointSkipButton.tsx
  pinpoint.css               (alle keyframes + atmosphere-klasser)

src/lib/pinpoint/
  mapEngine.ts               (createPinpointMap, flyToTarget, levelOut)
  mapFx.ts                   (addPinShadow, pulseRipple på map-layers)
  handoff.ts                 (portMapTo, cloneCameraState)
  stages.ts                  (stage-konstanter, timing-tabel, types)
```

## Filer der redigeres
- `src/pages/GardenSizer.tsx`:
  - State: `pinpointing`, `handoffMapRef`.
  - `chooseAddress` sætter `pinpointing` i stedet for `setStep(2)` direkte.
  - Render `<PinpointSequence ... onDone={(map) => { handoffMapRef.current = map; setPinpointing(null); setStep(2); }}/>`.
  - Map-init i step 2 refaktoreret til at modtage eksisterende map via ref; tilføjer kun manglende drawing-sources.

## Ingen ændringer
- Ingen nye dependencies.
- Ingen DB-migrationer.
- Ingen ændringer i AI-wand, drawing, edit, save-flow.
- Ingen ændringer i edge functions (men vi pre-warm'er `get-matrikel`-kaldet — eksisterende endpoint).

---

## Sekvens af arbejde
1. **Sequence 1+2** — Map engine + stage choreography. Verificér flyTo + dual-source cross-fade isoleret.
2. **Sequence 3+7** — Pin, impact-FX, atmosphere. Visuel QA på 3 testadresser (urban / forstad / land).
3. **Sequence 4** — Real-world imagery polish: tile-preload, evt. cloud-layer.
4. **Sequence 5** — Handoff Strategi A (DOM-portering). Test at step 2's tegne/edit/AI fungerer uændret.
5. **Sequence 6** — HUD, adressekort med matrikel-prefetch, skip-knap, micro-interactions.
6. **Sequence 8** — Edge cases, a11y, reduced-motion, analytics.
7. **Final QA** — Lighthouse-perf, screen-reader walkthrough, mobile (iOS Safari + Android Chrome).

## Risikoregister
| Risiko                                    | Sandsynlighed | Mitigation                                           |
|-------------------------------------------|---------------|------------------------------------------------------|
| DOM-portering bryder Mapbox-resize        | Mellem        | Strategi B (kamera-match fade) bag feature-flag      |
| Ortofoto-tiles loader for langsomt        | Mellem        | Tile-preload under INTRO + skeleton fallback         |
| Cross-fade flicker mellem sat→orto        | Lav           | Manuel `setPaintProperty` i RAF-loop som fallback    |
| Pitch-zoom føles tungt på low-end mobil   | Mellem        | Auto-detect FPS, falder tilbage til zoom uden pitch  |
| Brugere finder animation irriterende      | Lav           | Skip-knap synlig fra første frame; auto-skip 2. gang |

**Bonus (post-launch):** Husk i localStorage at brugeren har set animationen. Anden gang de pinpointer en adresse → kun 600ms hurtig version (jumpTo + kort pin-drop).
