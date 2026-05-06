# Pinpoint v3.1 — Smoother & Longer

Goal: make the cinematic pinpoint sequence feel **noticeably longer** and **buttery smooth**, especially on mobile. Total runtime grows from ~2.2s to ~5.5s, with no abrupt stage cuts.

## What's wrong today

- `flyTo` runs only 1500ms with `curve: 1.7, speed: 1.2` — on mobile this plays as one quick swoop with visible tile pop-in.
- Stage timers are tight (180 → 320 → 1500 → 450 → 320 → 280 ms) so impact, settle and handoff stack on top of each other.
- Handoff fade is 280ms and discards the map → user sees a flash before step 2 mounts its own map.
- Easing `t => 1 - Math.pow(1 - t, 3)` (easeOutCubic) decelerates hard at the end → looks like it "stops" right before impact.

## Changes

### 1. Stretched, multi-phase camera path (PinpointSequence.tsx)

Replace the single `flyTo` with a **3-leg choreographed descent** so the camera always feels alive:

```text
intro      0      → 600   ms   fade map in, HUD slides in
globe      600    → 1500  ms   slow bearing drift + zoom 4 → 7
approach   1500   → 3300  ms   flyTo zoom 7 → 15, pitch 0 → 35
descent    3300   → 4700  ms   easeTo zoom 15 → 18.7, pitch 35 → 60, bearing -10
drop       4500   → 5050  ms   pin falls (overlaps tail of descent)
impact     5050   → 5350  ms   shake + FX
settle     5350   → 6000  ms   easeTo pitch/bearing → 0, gentle zoom nudge
handoff    6000   → 6450  ms   crossfade out
```

- Use `cubic-bezier(.65,.05,.36,1)` style easing (`easeInOutCubic`) for legs so the deceleration is gentler at both ends.
- Each leg uses `essential: true` and the next leg starts on `moveend` (not a fixed timer) so slow networks don't desync — fall back to a max timeout.
- Pre-warm tiles: kick a hidden `Image()` request for the target tile during `intro` so the final zoom doesn't pop.

### 2. Smoother stage transitions (pinpoint.css)

- Bump CSS transitions from 280–500ms → **600–900ms** with `cubic-bezier(.22,.61,.36,1)` (Apple-style ease-out).
- `.pp-map` opacity fade-in: 320ms → **700ms**.
- Aurora/vignette/clouds opacity transitions: → **900ms**.
- Pin drop: `transition: transform 0.65s` → **transform 1.0s `cubic-bezier(.55,.05,.35,1)`** (less abrupt landing).
- Add `pp-stage[data-stage]` transition on `background-color` so the dark intro bleeds into the map color rather than cutting.

### 3. Seamless handoff (no flash)

- Currently `setFadingOut(true)` drops the whole overlay in 280ms while step 2 mounts a fresh Mapbox instance → visible flash on mobile.
- New approach: extend fade to **600ms**, and during `settle` start an opacity tween of HUD/aurora/grain/vignette/skip/address-card to 0 **before** the map fades — so only the map remains, identical to step 2's view. Then fade `.pp-stage` out.
- Make the impact camera-shake gentler (amplitudes halved) so it doesn't feel jarring when followed by a long settle.

### 4. Longer, gentler FX

- Ripples: 1.6s → **2.2s**, stagger 0.18/0.36s → **0.25/0.5s**.
- Dust: 0.95s → **1.4s**.
- Shock flash: 0.7s → **0.9s**, lower peak opacity (1 → 0.8).
- Sparkles: 0.95s → **1.3s**.
- Pin float (settle/handoff): 3s → **4s** with smaller amplitude.

### 5. Mobile polish

- Detect `useIsMobile()` and shave 20% off durations on mobile so total stays ~4.5s instead of 5.5s (still much longer than today, but respects mobile attention).
- Reduce `.pp-grain` opacity on mobile (perf + readability).
- Disable `.pp-aurora` `filter: blur(40px)` on mobile (replace with pre-blurred radial via lower opacity) — big perf win that prevents jank during the longer animation.

### 6. Reduced-motion path

Bump from 450ms hold to **900ms** so the address card and HUD are actually readable before handoff, but still no motion.

## Files

- **Edit** `src/components/havemaaler/PinpointSequence.tsx` — new stage timeline, multi-leg camera, mobile branch, tile pre-warm, staged HUD fade-out before map fade.
- **Edit** `src/components/havemaaler/pinpoint.css` — longer/softer transitions and keyframes, mobile media-query overrides.

## Risk / fallback

- If chained `moveend` listeners desync on flaky networks, the max-timeout fallback fires the next leg anyway.
- If the longer animation feels *too* long once you see it live, durations are centralized in a `TIMINGS` object at the top of the component so we can tune in one place.
