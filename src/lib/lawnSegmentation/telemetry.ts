import { supabase } from "@/integrations/supabase/client";
import type { Json, TablesInsert } from "@/integrations/supabase/types";
import { track } from "@/lib/analytics";
import type { LawnCropPayload, LawnSegmentationResult, SegmentationSeed } from "./types";

type TelemetryEventName =
  | "havemaaler_wand_result"
  | "havemaaler_wand_accept"
  | "havemaaler_wand_refine"
  | "havemaaler_wand_retry"
  | "havemaaler_wand_failure";

type TelemetryExtra = {
  accepted?: boolean;
  action?: string;
  errorCode?: string;
  errorDetail?: string;
  cached?: boolean;
  candidateCount?: number;
};
type TelemetryInsert = TablesInsert<"havemaaler_segmentation_events">;

const SESSION_KEY = "havemaaler:segmentation-session:v1";

function hashString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h) ^ input.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function sessionId() {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const next = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : hashString(`${Date.now()}:${Math.random()}`);
    localStorage.setItem(SESSION_KEY, next);
    return next;
  } catch {
    return "session-unavailable";
  }
}

function cropHash(crop?: LawnCropPayload | null) {
  if (!crop) return undefined;
  const bbox = crop.bbox.map((n) => Number(n.toFixed(7))).join(",");
  const imageHash = hashString(crop.imageBase64.slice(0, 256) + crop.imageBase64.slice(-256));
  return hashString(`${bbox}:${crop.clickPx.map((n) => Math.round(n)).join(",")}:${imageHash}`);
}

function seedCounts(seeds: SegmentationSeed[]) {
  let positive = 0;
  let negative = 0;
  for (const seed of seeds) {
    if (seed.kind === "positive") positive++;
    if (seed.kind === "negative") negative++;
  }
  return { positive, negative, total: seeds.length };
}

function cleanDiagnostics(result?: LawnSegmentationResult | null, crop?: LawnCropPayload | null, extra?: TelemetryExtra) {
  const diagnostics = result?.diagnostics;
  return {
    areaM2: diagnostics?.areaM2,
    maskAreaPx: diagnostics?.maskAreaPx,
    threshold: diagnostics?.threshold,
    meanGrassScore: diagnostics?.meanGrassScore,
    hardscapeLeakage: diagnostics?.hardscapeLeakage,
    edgeSupport: diagnostics?.edgeSupport,
    contourPoints: diagnostics?.contourPoints,
    simplifiedPoints: diagnostics?.simplifiedPoints,
    selectedCandidate: diagnostics?.selectedCandidate,
    candidateCount: diagnostics?.candidateCount ?? extra?.candidateCount,
    candidateScores: diagnostics?.candidateScores,
    recoveredBy: diagnostics?.recoveredBy,
    cropMetersPerPx: crop?.metersPerPx,
    parcelPresent: !!crop?.parcelPx?.length,
    cropFallbacks: Array.isArray(crop?.diagnostics?.fallbacks) ? crop.diagnostics.fallbacks : undefined,
    errorCode: extra?.errorCode,
    errorDetail: extra?.errorDetail ? String(extra.errorDetail).slice(0, 180) : undefined,
    cached: extra?.cached,
    action: extra?.action,
  };
}

function clientContext() {
  return {
    viewport: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : undefined,
    devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio : undefined,
  };
}

export function logHavemaalerSegmentationEvent(
  eventName: TelemetryEventName,
  crop: LawnCropPayload | null,
  result: LawnSegmentationResult | null,
  seeds: SegmentationSeed[] = [],
  extra: TelemetryExtra = {},
) {
  const payload = {
    session_id: sessionId(),
    event_name: eventName,
    crop_hash: cropHash(crop),
    imagery_source: crop?.imagerySource ?? result?.diagnostics.imagerySource,
    algorithm_version: result?.diagnostics.algorithmVersion,
    strictness: result?.diagnostics.strictness,
    confidence: typeof result?.confidence === "number" ? Number(result.confidence.toFixed(4)) : null,
    needs_review: result?.needsReview ?? null,
    accepted: extra.accepted ?? null,
    seed_counts: seedCounts(seeds) as Json,
    warnings: result?.diagnostics.warnings ?? [],
    diagnostics: cleanDiagnostics(result, crop, extra) as Json,
    client_context: clientContext() as Json,
  } satisfies TelemetryInsert;

  track(eventName, payload);

  // Best-effort production telemetry. This intentionally stores no raw imagery,
  // address, or exact coordinates; crop_hash lets us group repeated failures.
  Promise.resolve(
    supabase.from("havemaaler_segmentation_events").insert(payload)
  )
    .then(({ error }) => {
      if (error && import.meta.env.DEV) {
        console.debug("[havemaaler telemetry]", error.message);
      }
    })
    .catch((error) => {
      if (import.meta.env.DEV) {
        console.debug("[havemaaler telemetry]", error?.message ?? error);
      }
    });
}
