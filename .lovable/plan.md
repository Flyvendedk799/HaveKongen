# Vandingsplan v2 — "Den komplette have-companion"

Målet: Gør Vandingsplan til en personlig have-assistent der husker, advarer, lærer og forbinder. Alle nye features samles i tabs på `/vanding` og deler data med resten af platformen.

## Nye tabs i Vandingsplan

```text
[ I dag ] [ Planter ] [ Journal ] [ Kalender ] [ Naboer ] [ Indsigt ] [ Enheder ]
```

- **I dag** (eksisterende TodayHero) — nu med daglig AI-briefing øverst
- **Planter** (eksisterende) — udvides med companion-badges
- **Journal** (NY) — fotodagbog + timeline pr. plante/bed
- **Kalender** (NY) — så/høst/beskær årshjul
- **Naboer** (NY) — community feed på postnummer
- **Indsigt** (eksisterende)
- **Enheder** (NY) — sensorer & ventiler

---

## 1. Companion-planting & samdyrkning

**Hvad:** Vis hvilke planter der trives/skader hinanden i samme bed. Live-advarsler og forslag.

- Udvid `plants_catalog` med `companion_plants` (findes) + nyt `antagonist_plants` array
- I `PlantsTab` og `PlantDetailSheet`: companion-badges (grøn ✓ / rød ✗) for andre planter i samme zone
- Ved tilføj-plante (`AddPlantsDialog`): "Passer godt med dine planter i bedet" sektion
- AI-kald (`companion-suggest` edge function) genererer forslag baseret på eksisterende planter i bedet
- Konflikt-banner i bed-kort: "⚠ Tomat + kål trives dårligt sammen"

## 2. Have-journal & timeline

**Hvad:** Fotodagbog pr. plante/bed med vækst-tracking og før/efter-slider.

Ny tabel `garden_journal`:
- `id, user_id, garden_id, zone_id, plant_id, kind` (`photo|note|harvest|disease|milestone`)
- `image_url, caption, data jsonb, created_at`

Ny komponent `JournalTab.tsx`:
- Vertikal timeline grupperet pr. uge
- Filter: alle / pr. plante / pr. bed / kun fotos
- "Tilføj entry"-FAB med kamera + tekst
- Auto-entries: når bruger logger vanding, høst eller AI-diagnose → entry oprettes

Pr. plante i `PlantDetailSheet`:
- Ny "Journal"-fane med foto-grid
- Før/efter slider (første foto vs. seneste)
- Højde/antal-tracker over tid (chart)

Storage: genbrug `plant-photos` bucket, ny mappe `journal/`.

## 3. Høst- & så-kalender

**Hvad:** Personligt årshjul med opgaver pr. plante baseret på `sow_months`/`harvest_months` + DK-klima.

Ny komponent `CalendarTab.tsx`:
- 12-måneders cirkel-/grid-visning af årshjul
- Pr. plante i brugerens have: så-vindue, udplant, beskær, høst, vinterbeskyt
- Klik på opgave → opret task i `task_log` (eksisterer)
- Push/notifikation 2 dage før via eksisterende `notifications` tabel

Udvid `plants_catalog`:
- `prikle_weeks_after_sow int`, `transplant_months int[]`, `prune_months int[]`, `winterize_months int[]`

Ny edge function `seasonal-tasks-generate`:
- Kører ugentligt via pg_cron
- Genererer tasks for kommende uge baseret på brugerens planter + region

## 4. Naboer & community (privat-først)

**Hvad:** Følg haver i samme postnummer, del tips, bytte frø/stiklinger.

Nye tabeller:
- `neighbor_posts` — `id, user_id, postal_code, kind` (`tip|harvest|swap|question`), `title, body, image_url, created_at`
- `neighbor_comments` — `id, post_id, user_id, body, created_at`
- `neighbor_likes` — `id, post_id, user_id`
- `seed_swaps` — `id, user_id, postal_code, plant_slug, kind` (`offer|want`), `qty, notes, status`

RLS: alle kan læse posts hvor `postal_code` matcher brugerens (fra `profiles`); kun ejer kan redigere/slette.

Ny komponent `NeighborsTab.tsx`:
- Feed filtreret på postnummer (radius dropdown: 0/5/10 km via lat/lng)
- Kompose-knap (tip/spørgsmål/byttebørs)
- "Aktive haver i nærheden" tæller
- Privat have-deling: invitér via email → `garden_collaborators` tabel (`role: viewer|editor`)

Moderation: rapportér-knap → admin queue (`admin/moderation` route, senere).

## 5. Proaktiv AI-coach + global have-chat

**Daglig briefing (kl. 07:00 lokal):**
- Edge function `daily-briefing` (cron) genererer pr. bruger:
  - Dagens vejr-resume
  - Planlagte vandinger i dag
  - Top-3 opgaver fra `task_log`
  - Advarsler (frost, hede, sygdomsrisiko)
  - 1 sæson-tip
- Skrives til `notifications` + ny `daily_briefings` tabel (cache så bruger kan se historik)
- "Morgen-kort" øverst på `I dag`-tab

**Global have-chat:**
- Genbrug eksisterende `chat_conversations` + `chat_messages` (allerede i DB)
- Ny edge function `garden-chat` (streaming) — system-prompt indeholder:
  - Have-metadata (zoner, planter, vejr, seneste vandinger, aktuelle tasks)
  - Memory: sidste N samtaler
- Floating chat-bubble på `/vanding` (alle tabs)
- Tools (function calling): `add_task`, `log_watering`, `add_journal_entry`, `lookup_plant`

## 6. IoT — sensorer & ventiler

**Hvad:** Ægte data fra jordfugt-sensorer + automatisk styring af smart-ventiler.

Udvid `devices` tabel (eksisterer):
- `kind` enum allerede der — tilføj `moisture_sensor`, `valve`, `rain_gauge`, `weather_station`
- `vendor text` (`gardena|hunter|ecowitt|xiaomi|generic-mqtt`)
- `external_id text`, `auth jsonb` (krypteret token), `zone_id uuid`

Ny tabel `sensor_readings`:
- `id, device_id, user_id, zone_id, metric` (`moisture_pct|temp|ec|ph|battery|rain_mm`)
- `value numeric, recorded_at`
- Indeks: `(zone_id, metric, recorded_at desc)`

Ny tabel `valve_commands`:
- `id, device_id, user_id, action` (`open|close`), `duration_min, status, sent_at, ack_at`

Edge functions:
- `iot-ingest` — generisk POST endpoint (HMAC-signeret) til at modtage sensor-data fra hub/bridge
- `iot-gardena` — OAuth-flow + poll Gardena Smart System API
- `iot-ecowitt` — webhook-modtager for Ecowitt vejrstationer
- `valve-command` — sender kommando til ventil + opdaterer `valve_commands`
- Genbrug `generate-watering-plan` — hvis zone har sensor: brug aktuel jordfugt i stedet for kun ET₀-modellen

Ny komponent `DevicesTab.tsx`:
- Liste af enheder grupperet på zone
- "Tilføj enhed"-wizard: vælg vendor → OAuth/API-key → vælg zone
- Live-graf (jordfugt sidste 7 dage) pr. sensor — genbruger Recharts
- Manuel "Åbn ventil 10 min"-knap

`MoistureGauge` får nyt prop `liveSensorValue` der overrider model-estimat når tilgængeligt.

---

## Datamodel-ændringer (oversigt)

```text
plants_catalog        + antagonist_plants, prikle_weeks_after_sow,
                        transplant_months, prune_months, winterize_months
garden_journal        NY
neighbor_posts        NY
neighbor_comments     NY
neighbor_likes        NY
seed_swaps            NY
garden_collaborators  NY
daily_briefings       NY
sensor_readings       NY
valve_commands        NY
devices               + vendor, external_id, auth
```

Alle nye user-tabeller får RLS `auth.uid() = user_id` (community-tabeller får `postal_code`-baseret read policy via security-definer-funktion `same_postal(_uid uuid, _post text)`).

## Nye edge functions

```text
companion-suggest         AI: companion-forslag for et bed
seasonal-tasks-generate   Cron: ugentlig task-generering
daily-briefing            Cron: morgen-briefing pr. bruger
garden-chat               Streaming AI med tools
iot-ingest                Generisk sensor-modtager (HMAC)
iot-gardena               Gardena OAuth + poll
iot-ecowitt               Ecowitt webhook
valve-command             Send ventil-kommando
neighbor-moderate         AI-tjek af nye posts (spam/abuse)
```

## Implementeringsrækkefølge (faser)

**Fase 1 — Companion + Journal** (mest værdi, lav risiko)
1. Migration: catalog-felter + `garden_journal` tabel
2. Companion-badges i Plants/Detail/AddPlants
3. JournalTab + foto-upload + auto-entries

**Fase 2 — Sæson-kalender + proaktiv AI** ✅ FÆRDIG
4. Catalog-udvidelser (transplant/prune/winterize) ✅
5. CalendarTab (Årshjul) ✅
6. `daily-briefing` edge function + MorningBriefing-kort + `daily_briefings` tabel ✅
7. Global `garden-chat` med tools + floating bubble ✅

**Fase 3 — Naboer**
8. Migration: 4 community-tabeller + `same_postal` helper
9. NeighborsTab feed + kompose + likes/kommentarer
10. Seed-swap UI + `garden_collaborators` invitér-flow
11. `neighbor-moderate` AI-filter

**Fase 4 — IoT**
12. Migration: device-felter + `sensor_readings` + `valve_commands`
13. DevicesTab + `iot-ingest` + manual valve control
14. Gardena OAuth integration (kræver Gardena API key fra bruger via `add_secret`)
15. Ecowitt webhook + integrér jordfugt i `generate-watering-plan`

## Sikkerheds-noter

- IoT-tokens krypteres via Vault eller mindst markeres så de aldrig sendes til frontend
- Community RLS bruger `security definer`-funktion for at undgå rekursive policies
- `valve-command` rate-limit pr. enhed (max 1 åbning/5 min)
- AI-tools i `garden-chat` validerer alt input server-side før DB-writes
- Naboer-feed kræver verificeret postnummer på `profiles`

## Hvad jeg vil bekræfte før Fase 4

- Hvilke IoT-vendors prioriteres først? (foreslår Gardena + Ecowitt — bredest i DK)
- OK at bede om Gardena API-key via secret når vi når dertil?

Klar til at implementere Fase 1 så snart du godkender.
