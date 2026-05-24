import type { Json, Tables } from "@/integrations/supabase/types";

export type GardenScanSession = Tables<"garden_scan_sessions">;

export type ScanStatus =
  | "created"
  | "capturing"
  | "uploaded"
  | "processing"
  | "ready"
  | "needs_anchor_correction"
  | "failed"
  | "cancelled";

export type ScanArtifactKind = "manifest" | "tracking" | "keyframes" | "preview" | "video";

export type ScanUploadTarget = {
  kind: ScanArtifactKind;
  path: string;
  contentType: string;
  required: boolean;
  signedUrl?: string | null;
  token?: string | null;
};

export type GardenScanAnchorObservation = {
  id: string;
  label?: string;
  kind?: "house_corner" | "terrace_corner" | "shed_corner" | "gate_or_fence_corner" | "boundary_corner" | "manual";
  mapLngLat?: [number, number] | null;
  arLocal?: { x: number; y: number; z: number } | null;
  confidence?: number | null;
  evidenceFrameIds?: string[];
};

export type GardenScanManifest = {
  version: 1;
  session_id: string;
  garden_id: string;
  device: {
    model?: string | null;
    os?: string | null;
    browser?: string | null;
    client_version?: string | null;
    supports_lidar?: boolean | null;
    supports_device_motion?: boolean | null;
    supports_camera?: boolean | null;
  };
  capture: {
    duration_seconds: number;
    started_at?: string | null;
    completed_at?: string | null;
    tracking_quality: "normal" | "limited" | "not_available";
    frame_count?: number | null;
    keyframe_count?: number | null;
    coverage_score?: number | null;
    low_light?: boolean | null;
  };
  anchors: GardenScanAnchorObservation[];
  files: {
    manifest?: string | null;
    tracking: string;
    keyframes: string;
    preview?: string | null;
    video?: string | null;
  };
};

export type PipelineIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export const SCAN_UPLOAD_TARGETS: Array<Omit<ScanUploadTarget, "path" | "signedUrl" | "token"> & { fileName: string }> = [
  { kind: "manifest", fileName: "manifest.json", contentType: "application/json", required: true },
  { kind: "tracking", fileName: "tracking.json", contentType: "application/json", required: true },
  { kind: "keyframes", fileName: "keyframes.json", contentType: "application/json", required: true },
  { kind: "preview", fileName: "preview.jpg", contentType: "image/jpeg", required: false },
  { kind: "video", fileName: "capture.webm", contentType: "video/webm", required: false },
];

export const SCAN_STATUS_TRANSITIONS: Record<ScanStatus, ScanStatus[]> = {
  created: ["capturing", "uploaded", "failed", "cancelled"],
  capturing: ["uploaded", "failed", "cancelled"],
  uploaded: ["processing", "needs_anchor_correction", "failed", "cancelled"],
  processing: ["ready", "needs_anchor_correction", "failed"],
  ready: [],
  needs_anchor_correction: ["capturing", "uploaded", "processing", "failed", "cancelled"],
  failed: [],
  cancelled: [],
};

export function scanStatusLabel(status: string) {
  if (status === "created") return "Klar til capture";
  if (status === "capturing") return "Scanner på mobil";
  if (status === "uploaded") return "Upload modtaget";
  if (status === "processing") return "Bygger 3D-model";
  if (status === "ready") return "3D-model klar";
  if (status === "needs_anchor_correction") return "Kræver anker-tjek";
  if (status === "failed") return "Scan fejlede";
  if (status === "cancelled") return "Annulleret";
  return "Ukendt status";
}

export function scanActionHint(status: string) {
  if (status === "created") return "Åbn mobilcapture og vælg 2-4 tydelige ankre.";
  if (status === "capturing") return "Hold langsom gang, god belysning og overlap mellem billeder.";
  if (status === "uploaded") return "Scandata er klar til workerens rekonstruktion.";
  if (status === "processing") return "Worker bygger semantisk 3D-model og kvalitetstjekker alignment.";
  if (status === "ready") return "3D-modellen er gemt på haven og kan redigeres videre.";
  if (status === "needs_anchor_correction") return "Ret eller tilføj ankre før modellen kan blive præcis.";
  if (status === "failed") return "Brug 2D-modellen, ret input eller start en ny scan.";
  if (status === "cancelled") return "Scanningen blev afbrudt.";
  return "Ukendt pipeline-status.";
}

export function scanStatusTone(status: string): "neutral" | "working" | "ready" | "warning" | "failed" {
  if (status === "ready") return "ready";
  if (status === "processing" || status === "capturing" || status === "uploaded") return "working";
  if (status === "needs_anchor_correction") return "warning";
  if (status === "failed" || status === "cancelled") return "failed";
  return "neutral";
}

export function scanProgress(status: string) {
  if (status === "created") return 12;
  if (status === "capturing") return 32;
  if (status === "uploaded") return 55;
  if (status === "processing") return 78;
  if (status === "needs_anchor_correction") return 68;
  if (status === "ready") return 100;
  return 0;
}

export function isScanStatus(status: string): status is ScanStatus {
  return status in SCAN_STATUS_TRANSITIONS;
}

export function isTerminalScanStatus(status: string) {
  return status === "ready" || status === "failed" || status === "cancelled";
}

export function canTransitionScanStatus(from: string | null | undefined, to: string) {
  if (!isScanStatus(to)) return false;
  if (!from || from === to) return true;
  if (!isScanStatus(from)) return false;
  return SCAN_STATUS_TRANSITIONS[from].includes(to);
}

export function scanCanStartNewSession(sessions: GardenScanSession[]) {
  return !sessions.some((session) => !isTerminalScanStatus(session.status));
}

export function requiredAnchorCount(status: string, anchors: unknown) {
  const count = Array.isArray(anchors) ? anchors.length : 0;
  return {
    count,
    recommended: 4,
    minimum: 2,
    ready: count >= 2 || status === "created",
  };
}

export function buildUploadTargets(prefix: string): ScanUploadTarget[] {
  return SCAN_UPLOAD_TARGETS.map((target) => ({
    kind: target.kind,
    contentType: target.contentType,
    required: target.required,
    path: `${prefix}/${target.fileName}`,
  }));
}

export function expectedArtifactPaths(prefix: string) {
  return buildUploadTargets(prefix).reduce<Record<ScanArtifactKind, string>>((acc, target) => {
    acc[target.kind] = target.path;
    return acc;
  }, {} as Record<ScanArtifactKind, string>);
}

export function latestUsefulScan(sessions: GardenScanSession[]) {
  return sessions.find((session) => session.status === "ready")
    ?? sessions.find((session) => session.status === "processing" || session.status === "uploaded")
    ?? sessions[0]
    ?? null;
}

export function normalizeScanWarnings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((warning) => warning.trim()).filter(Boolean).slice(0, 24);
}

export function inspectScanManifest(value: unknown): { manifest: GardenScanManifest | null; issues: PipelineIssue[]; ready: boolean } {
  const issues: PipelineIssue[] = [];
  if (!value || typeof value !== "object") {
    return {
      manifest: null,
      issues: [{ severity: "error", code: "invalid_manifest_shape", message: "Manifestet skal være et JSON-objekt." }],
      ready: false,
    };
  }

  const row = value as Partial<GardenScanManifest>;
  if (row.version !== 1) issues.push({ severity: "error", code: "manifest_version", message: "Manifest version 1 er påkrævet." });
  if (!row.session_id) issues.push({ severity: "error", code: "missing_session_id", message: "Manifest mangler session_id." });
  if (!row.garden_id) issues.push({ severity: "error", code: "missing_garden_id", message: "Manifest mangler garden_id." });
  if (!row.device || typeof row.device !== "object") issues.push({ severity: "warning", code: "missing_device", message: "Device metadata mangler." });
  if (!row.capture || typeof row.capture !== "object") {
    issues.push({ severity: "error", code: "missing_capture", message: "Capture metadata mangler." });
  } else {
    if (typeof row.capture.duration_seconds !== "number" || row.capture.duration_seconds < 20) {
      issues.push({ severity: "warning", code: "short_capture", message: "Capture bør være mindst 45 sekunder, helst 60-90." });
    }
    if (row.capture.tracking_quality !== "normal") {
      issues.push({ severity: "warning", code: "limited_tracking", message: "Browserens motion/tracking er begrænset gennem scanningen." });
    }
    if (typeof row.capture.keyframe_count === "number" && row.capture.keyframe_count < 18) {
      issues.push({ severity: "warning", code: "few_keyframes", message: "For få keyframes kan give svag rekonstruktion." });
    }
    if (row.capture.low_light) {
      issues.push({ severity: "warning", code: "low_light", message: "Lavt lys reducerer objekt- og dybdekvalitet." });
    }
  }
  if (!Array.isArray(row.anchors) || row.anchors.length < 2) {
    issues.push({ severity: "error", code: "too_few_anchors", message: "Mindst 2 ankre er nødvendige for alignment." });
  } else if (row.anchors.length < 4) {
    issues.push({ severity: "warning", code: "less_than_recommended_anchors", message: "4 ankre anbefales for stærkere alignment." });
  }
  if (!row.files?.tracking) issues.push({ severity: "error", code: "missing_tracking_file", message: "tracking.json mangler." });
  if (!row.files?.keyframes) issues.push({ severity: "error", code: "missing_keyframes_file", message: "keyframes.json mangler." });

  const hasErrors = issues.some((issue) => issue.severity === "error");
  return {
    manifest: hasErrors ? null : row as GardenScanManifest,
    issues,
    ready: !hasErrors,
  };
}

export function validateScanManifest(value: unknown) {
  return inspectScanManifest(value).issues.map((issue) => issue.code);
}

export function scanManifestToJson(manifest: GardenScanManifest): Json {
  return manifest as unknown as Json;
}

export function webGardenScanUrl(gardenId: string, sessionId: string) {
  const params = new URLSearchParams({ garden_id: gardenId, session_id: sessionId });
  return `/havemaaler/scan?${params.toString()}`;
}
