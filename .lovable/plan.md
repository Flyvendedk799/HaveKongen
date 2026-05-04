# Havelandet — Build Plan

A Danish garden platform with cinematic landing, webshop, garden area measurement, watering plan, AI plant chat, and account dashboard. We'll port the static design 1:1 and wire real functionality, sequenced to avoid corner-cutting.

## Tech foundation

- React + Vite + Tailwind (existing). Add: Three.js + @react-three/fiber@^8.18, @react-three/drei@^9.122, react-router (already), react-markdown, mapbox-gl, @turf/turf, zustand (cart + UI state), date-fns.
- Lovable Cloud for auth, database, storage, edge functions.
- Lovable AI Gateway for the plantepleje chat.
- Mapbox for the Havemåler (token via secret `MAPBOX_PUBLIC_TOKEN`, public, used client-side).
- All copy stays in Danish.

## Design system port (Phase 0)

- Copy `tokens.css` colors/fonts into `index.css` as HSL CSS variables and extend `tailwind.config.ts` (Tenor Sans, Inter Tight, JetBrains Mono; gold/mist/leaf/night palette).
- Build shared layout primitives: `<SiteNav>` (dark, landing) and `<AppNav>` (light, app pages), `<Footer>`, `<Container>`, button variants, eyebrow, page-head.

## Phase 1 — Landing page (`/`)

- Port `index.html` exactly: loader, sticky nav, hero, 4-act scroll narrative with Three.js scene (`js/scene.js`), progress rail, tools grid, webshop strip, seasons band, manifesto, footer.
- Convert `scene.js` to a `<HeroScene>` R3F component; preserve the 4-act camera/lighting choreography driven by scroll position.
- Tools grid + webshop strip link to real routes.

## Phase 2 — Auth + database (Lovable Cloud)

- Email/password + Google sign-in. `/login`, `/signup`, `/reset-password` pages styled to match.
- `profiles` table (id → auth.users, name, address, lat, lng, postal_code, avatar_url).
- Tables (all RLS, owner-only):
  - `gardens` (user_id, name, address, polygon geojson, area_m2, created_at)
  - `garden_zones` (garden_id, name, type [bed/lawn/greenhouse], polygon, area_m2)
  - `plants_catalog` (slug, name_da, latin, water_need, sun, season info) — seeded
  - `user_plants` (user_id, garden_id, zone_id, plant_slug, qty, planted_at)
  - `watering_schedules` (zone_id, weekday_mask, start_time, duration_min, enabled, ai_adjusted)
  - `watering_events` (schedule_id, ran_at, mm_delivered, weather_skipped)
  - `devices` (user_id, kind [mower/sprinkler/sensor], name, status, battery, last_seen)
  - `products`, `product_variants`, `orders`, `order_items` (seeded catalog from design)
  - `chat_conversations`, `chat_messages` (role, content, created_at)
- `app_role` enum + `user_roles` + `has_role()` for admin product editing.
- Auto-create profile trigger on signup.

## Phase 3 — Webshop (`/webshop`, `/webshop/:slug`, `/cart`)

- Port `webshop.html` tabs/grid. Product list from DB with categories: Frø & planter, Jord & gødning, Robotplæneklippere, Vanding.
- Product detail page (gallery, description, variants, add-to-cart).
- Cart in zustand, persisted to localStorage; cart drawer + `/cart` page with quantities, totals, shipping estimate. Checkout button shows "Betaling kommer snart" — no payment in v1 per scope.
- Admin route `/admin/products` (role-gated) for CRUD.

## Phase 4 — Havemåler (`/havemaaler`)

- Port `garden-sizer.html` exactly (address step, map step, results step).
- Address autocomplete via Mapbox Geocoding (Denmark-restricted).
- Mapbox satellite map; user clicks polygon points around lawn/garden; @turf/turf computes area in m².
- Multi-zone drawing with zone type (lawn / bed / greenhouse / terrace).
- Recommendation engine: maps area → robot mower model from product catalog, with klippetid estimate.
- Save garden + zones to DB (logged-in users); guest gets a "save → log in" prompt.

## Phase 5 — Vandingsplan (`/vanding`)

- Port `watering.html` cinematic stage (animated rain, sun arc, droplets) as React + CSS.
- Per-zone schedule editor: weekdays, start time, duration, soil-type, plants in zone.
- Edge function `weather-adjust` (daily cron) calls Open-Meteo for the user's lat/lng, marks scheduled events as skipped if rain forecast > threshold or soil moist.
- Calendar/timeline view of upcoming waterings; manual "vand nu" button writes to `watering_events`.
- "AI justerer" toggle per schedule.

## Phase 6 — Plantepleje AI (`/ai`)

- Port `ai-chat.html` (sidebar conversations + chat shell).
- Edge function `plant-chat` calling Lovable AI Gateway (`google/gemini-2.5-flash`) with streaming SSE.
- System prompt is built from the user's gardens, zones, plants, recent watering events, and current weather → "den kender din have".
- Tool calls: `get_my_plants`, `get_watering_plan`, `update_watering_schedule`, `recommend_product`. Results render inline.
- Markdown rendering via react-markdown. Conversations persisted in DB; new chat / rename / delete.

## Phase 7 — Min konto (`/konto`)

- Port `account.html` layout (sidebar + sections):
  - Oversigt (next watering, mower status, weather, latest order, AI tips)
  - Ordrer (from `orders`)
  - Min have (plants list grouped by zone, add/remove)
  - Vandingsplan (link/embed of phase 5)
  - Enheder (devices CRUD, mock status updates)
  - Profil + adresse + log ud
- Realtime subscription so device status / watering events update live.

## Phase 8 — Polish + QA

- Mobile responsive pass on every page (design currently desktop-leaning).
- Loading skeletons, empty states, error toasts in Danish.
- SEO meta per route, OpenGraph, sitemap.
- Lighthouse pass on landing (lazy-load Three scene below the fold on mobile).

## Technical details

- Routes: `/`, `/login`, `/signup`, `/reset-password`, `/webshop`, `/webshop/:slug`, `/cart`, `/havemaaler`, `/vanding`, `/ai`, `/konto`, `/konto/:section`, `/admin/products`.
- Secrets to add: `MAPBOX_PUBLIC_TOKEN` (after Phase 1, before Phase 4). Lovable AI key is auto-provisioned.
- Edge functions: `plant-chat` (streaming), `weather-adjust` (scheduled), `recommend-mower` (pure compute, can be client too).
- Three.js scene runs only on landing, suspended while off-screen.
- Roles: separate `user_roles` table with `has_role()` security-definer function for admin gating.

## Sequence

Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8, each phase independently usable. After your approval I'll start with Phase 0 + 1 (design system + landing) so you see the hero come alive first, then continue through the sequence.
