# Havemåler 3D Garden Twin Implementation Contract

## Runtime Shape

Havemåler is satellite-first. The web app owns garden identity, lawn polygons, exclusions, ortofoto context, and the persisted `gardens.depth_model`. Mobile web capture and backend reconstruction are producers of better evidence for that same depth model. The default user flow must work in the browser without App Store installation.

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

- `manifest.json`: session metadata, device, capture duration, file references, anchor list.
- `tracking.json`: browser device-motion samples, capture-local evidence, anchor observations, and tracking quality.
- `keyframes.json`: selected camera frame metadata with storage paths, timestamps, and frame IDs.

Optional:

- `preview.jpg`: user-visible capture preview.
- `capture.webm`: browser video where supported.
- `frames/*.jpg`: individual uploaded keyframes referenced by `keyframes.json`.

Mobile capture should include 2-4 anchors that are visible in both satellite and real-world capture. Each anchor should include map lng/lat when known, capture-local evidence when known, label, confidence, and evidence frame IDs.

Minimum manifest quality gates:

- `version = 1`
- `session_id` and `garden_id` match the session
- at least 2 anchors, 4 recommended
- `tracking.json` and `keyframes.json` are present
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
2. Mark it `processing`.
3. Fetch scan package files by storage path.
4. Align browser capture evidence to garden lng/lat using anchors.
5. Fuse keyframe segmentation, multi-view reconstruction, and satellite geometry.
6. Produce `GardenDepthModel`.
7. Call `complete-garden-scan-session` with `status = "ready"` and `result_json`.

If alignment residual is too high, call `complete-garden-scan-session` with `status = "needs_anchor_correction"`, `warnings`, and `error_detail`.

The worker should claim work by moving `uploaded` to `processing`, incrementing `processing_attempts`, and setting `claimed_by`. Repeated attempts should be visible in the UI and event log.
