# Havemåler 3D Garden Twin Implementation Contract

## Update (2026-06-18): Part 2 is now the in-browser 3D builder

Havemåler Part 1 (draw the lawn outline on the satellite ortofoto and save) is unchanged.

**Part 2 is no longer a phone-camera scan.** It is an in-browser, satellite-first 3D
builder at `/havemaaler/3d?garden=<id>` (`src/pages/GardenTwinBuilder.tsx`). It produces
the same `gardens.depth_model` contract described below, but via:

1. **Denmark's national elevation model (DHM)** for real ground slope/relief and to
   pre-fill object heights — terrain `dhm_terraen` (DTM) and surface `dhm_overflade`
   (DSM); `DSM − DTM` is object height. Fetched by the `get-elevation` edge function
   (Dataforsyningen WCS `dhm_wcs_DAF`, same `DATAFORSYNINGEN_TOKEN`). Helpers in
   `src/lib/gardenElevation.ts`. Everything degrades gracefully to flat terrain.
2. **Interactive object placement** (trees, hedges, sheds, terraces, beds, fences,
   water…) with editable heights — `src/lib/gardenBuilder.ts`.

The built model uses `alignment.mode = "elevation-model"`, object `source =
"elevation_model"` (DHM-measured) or `"manual"`, and `terrain.elevation` holds the
DHM grid. See `buildGardenTwinModel` in `src/lib/gardenDepth.ts`.

The phone-scan pipeline documented below (`garden_scan_sessions`, the scan edge
functions, `GardenMobileScan.tsx`) is **dormant**, not deleted. The DB tables,
`scan-anchored` alignment mode, and manifest contract remain valid for any future
camera-based capture, but are not part of the current user flow.

---

## Runtime Shape

Havemåler is satellite-first. The web app owns garden identity, lawn polygons, exclusions, ortofoto context, and the persisted `gardens.depth_model`. Mobile web capture and backend reconstruction are producers of better evidence for that same depth model. The default user flow must work in the browser without App Store installation.

`gardens.depth_model` is the shared full garden twin contract. It must be both visual and operational: the Three.js viewer, Havekompagnon, watering, wildlife, commerce fit checks, and future devices all read the same model. The model must use `twin.confidencePolicy = "truthful-confidence"`: uncertain heights, hidden surfaces, weak alignment, and unseen regions are stored as estimates, warnings, or `terrain.unknownRegions`, not as fake precision.

## Scan Session Lifecycle

Statuses in `garden_scan_sessions.status`:

- `created`: web app created the session and returned `/havemaaler/scan` plus upload targets.
- `capturing`: mobile browser capture is recording camera frames and optional motion evidence.
- `uploaded`: manifest, tracking, and keyframes are uploaded.
- `processing`: reconstruction worker has claimed the scan.
- `needs_anchor_correction`: worker cannot align capture-local evidence to the satellite garden reliably.
- `ready`: `result_json` is a valid depth model and has been copied to `gardens.depth_model`.
- `failed` / `cancelled`: terminal non-ready states.

Valid transitions are intentionally narrow:

- `created` -> `capturing`, `uploaded`, `failed`, `cancelled`
- `capturing` -> `uploaded`, `failed`, `cancelled`
- `uploaded` -> `processing`, `needs_anchor_correction`, `failed`, `cancelled`
- `processing` -> `ready`, `needs_anchor_correction`, `failed`
- `needs_anchor_correction` -> `capturing`, `uploaded`, `processing`, `failed`, `cancelled`

Terminal statuses do not move forward. The UI should resume the active session instead of creating another session whenever an unfinished scan already exists.

Every state change should be represented in two places:

- `garden_scan_sessions.status_history`: compact session-local history for UI/debugging.
- `garden_scan_events`: append-only event log for worker observability and later analytics.

## Mobile Web Capture Package

The `create-garden-scan-session` Edge Function returns `upload_targets` in the private `garden-scans` bucket. Required files:

- `manifest.json`: session metadata, device, capture duration, file references, anchor list, phone quality summary, and guided route pose hints.
- `tracking.json`: browser device-motion samples, motion/parallax summary, capture-local evidence, anchor observations, route pose hints, and tracking quality.
- `keyframes.json`: selected camera frame metadata with storage paths, timestamps, and frame IDs.

Optional:

- `preview.jpg`: user-visible capture preview.
- `capture.webm`: browser video where supported.
- `frames/*.jpg`: individual uploaded keyframes referenced by `keyframes.json`.

Mobile capture should include 2-4 anchors that are visible in both satellite and real-world capture. Each anchor should include map lng/lat, camera image point or AR-local evidence, label, confidence, and evidence frame IDs. Anchors without both a map point and a camera/capture point are stored as weak evidence but do not count toward manual-anchor readiness.

When manual anchors are missing, the mobile browser can still contribute low-confidence no-GPU alignment through guided route poses. Each completed route checkpoint should store approximate map lng/lat, local garden coordinate, evidence frame, device image quality, phone motion/parallax score, and confidence. Route poses are not precise photogrammetry; they allow a truthful `needs_review` twin when evidence is good enough, and otherwise trigger `needs_anchor_correction`.

The browser capture flow should automatically collect keyframes while the camera is open. Manual keyframe buttons are only for extra coverage. V1 gates use 8 keyframes as the minimum upload threshold and 18 keyframes as the recommended threshold for stronger reconstruction.

Minimum manifest quality gates:

- `version = 1`
- `session_id` and `garden_id` match the session
- at least 2 alignable anchors, or 4 guided route poses with enough spread for low-confidence no-GPU alignment; 4 manual anchors are recommended
- alignable anchors should be separated by at least 3 meters on the map; 8+ meters is preferred
- route poses should be separated by at least 3 meters on the map; 8+ meters is preferred
- at least 8 keyframes, 18 recommended
- phone-side usable keyframe, brightness, contrast, sharpness, motion, and parallax summaries should be persisted
- `tracking.json` and `keyframes.json` are present
- uploaded manifest paths must stay inside the session upload prefix
- capture duration is ideally 45-90 seconds
- browser motion/tracking should be `normal` for strong reconstruction
- low light, few keyframes, weak anchors, or limited tracking must be warnings, not silent failures

## Depth Model Rules

`gardens.depth_model` and `garden_scan_sessions.result_json` use `GardenDepthModel` from `src/lib/gardenDepth.ts`.

Rules:

- Existing 2D lawn area stays authoritative unless the user edits it.
- Every object must have a footprint, local footprint, source, confidence, and height range when height is uncertain.
- Hidden regions are stored as `terrain.unknownRegions`; do not hallucinate geometry.
- Satellite-only models must keep `alignment.mode = "satellite-only"` and low/mid confidence.
- Scan-aligned models should use `alignment.mode = "scan-anchored"` and include anchor residual error.
- `ready` scans require a valid depth model with alignment, quality score, terrain boundary, object footprints, and confidence values in range.
- A strong model should be scan-anchored; satellite-only models remain useful previews but not final precision claims.

## Worker Contract

The worker should:

1. Read a session in `uploaded`.
2. Claim it atomically with `claim_garden_scan_session` or `claim_next_garden_scan_session`, which moves it to `processing`.
3. Fetch scan package files by storage path.
4. Align browser capture evidence to garden lng/lat using manual anchors when available, or guided route poses as a low-confidence no-GPU fallback.
5. Fuse keyframe quality, phone motion/parallax, route coverage, future segmentation/multi-view reconstruction, and satellite geometry.
6. Produce `GardenDepthModel`.
7. Call `complete-garden-scan-session` with `status = "ready"` and `result_json`.

If alignment residual is too high, call `complete-garden-scan-session` with `status = "needs_anchor_correction"`, `warnings`, and `error_detail`.

The worker should claim work by moving `uploaded` to `processing`, incrementing `processing_attempts`, and setting `claimed_by`. Repeated attempts should be visible in the UI and event log.

`process-garden-scan-session` is the browser-first worker entrypoint. It is protected by `GARDEN_SCAN_WORKER_SECRET`, reads private `garden-scans` artifacts with the service role, requires either strong map/camera anchor evidence or truthful guided-route pose evidence before writing a scan-anchored twin, and records model/provider/license metadata under `twin.model`. Production-ready `ready` results require commercially approved model metadata.
