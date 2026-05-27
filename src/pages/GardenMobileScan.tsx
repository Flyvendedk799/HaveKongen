import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Camera, CheckCircle2, CircleDot, Footprints, MapPinned, UploadCloud, Video } from "lucide-react";
import { toast } from "sonner";
import { AppNav } from "@/components/layout/SiteChrome";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import type { LngLat, LocalPoint } from "@/lib/gardenDepth";
import {
  buildUploadTargets,
  anchorSpreadMeters,
  countAlignableAnchors,
  inspectScanManifest,
  MIN_ALIGNED_ANCHORS,
  MIN_ANCHOR_SPREAD_M,
  MIN_ROUTE_STEPS,
  MIN_SCAN_KEYFRAMES,
  RECOMMENDED_ALIGNED_ANCHORS,
  RECOMMENDED_ANCHOR_SPREAD_M,
  RECOMMENDED_ROUTE_STEPS,
  RECOMMENDED_SCAN_KEYFRAMES,
  scanActionHint,
  scanManifestToJson,
  scanProgress,
  scanStatusLabel,
  type GardenScanAnchorObservation,
  type GardenScanManifest,
  type GardenScanRouteObservation,
  type GardenScanSession,
} from "@/lib/gardenScan";

type FrameCapture = {
  id: string;
  path: string;
  blob: Blob;
  previewUrl: string;
  capturedAt: string;
  width: number;
  height: number;
  source: "auto" | "manual" | "anchor" | "route";
};

type MotionSample = {
  t: number;
  acceleration?: { x: number | null; y: number | null; z: number | null };
  rotationRate?: { alpha: number | null; beta: number | null; gamma: number | null };
  interval?: number | null;
};

type CaptureState = "loading" | "ready" | "camera" | "uploading" | "uploaded" | "error";
type AnchorKind = NonNullable<GardenScanAnchorObservation["kind"]>;
type AnchorTarget = {
  id: string;
  label: string;
  kind: AnchorKind;
  mapLngLat?: LngLat | null;
  local?: LocalPoint | null;
  priority: number;
};

type AnchorMapFrame = {
  boundary: LngLat[];
  localBoundary: LocalPoint[];
  localLawnRings: LocalPoint[][];
  areaM2?: number | null;
};

type RouteStep = {
  id: string;
  label: string;
  shortLabel: string;
  instruction: string;
};

const ANCHOR_PRESETS: AnchorKind[] = [
  "house_corner",
  "terrace_corner",
  "shed_corner",
  "gate_or_fence_corner",
];

const anchorLabels: Record<NonNullable<GardenScanAnchorObservation["kind"]>, string> = {
  house_corner: "Hushjørne",
  terrace_corner: "Terrasse",
  shed_corner: "Skur",
  gate_or_fence_corner: "Låge/hegn",
  boundary_corner: "Skel",
  manual: "Anker",
};

const ROUTE_STEPS: RouteStep[] = [
  {
    id: "start_near_house",
    label: "Start ved huset eller terrassen",
    shortLabel: "Start",
    instruction: "Stå ved huset eller terrassen. Peg kameraet mod midten af haven og begynd langsomt.",
  },
  {
    id: "left_edge",
    label: "Gå langs venstre kant",
    shortLabel: "Venstre kant",
    instruction: "Gå langs den ene side af plænen. Hold midten af haven i billedet hele tiden.",
  },
  {
    id: "far_end",
    label: "Dæk den fjerneste ende",
    shortLabel: "Fjern ende",
    instruction: "Stop ved den fjerneste ende. Panorer langsomt fra venstre mod højre.",
  },
  {
    id: "right_edge_return",
    label: "Gå tilbage langs modsatte kant",
    shortLabel: "Tilbage",
    instruction: "Gå tilbage langs den anden side. Hold træer, hegn og skure i kanten af billedet.",
  },
];

type MotionPermissionCtor = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

function jsonBlob(value: unknown) {
  return new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
}

function browserDeviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone web";
  if (/iPad/i.test(ua)) return "iPad web";
  if (/Android/i.test(ua)) return "Android web";
  return "Mobile web";
}

function supportsDeviceMotionPermission() {
  const ctor = window.DeviceMotionEvent as MotionPermissionCtor | undefined;
  return typeof ctor?.requestPermission === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readLngLat(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [lng, lat] = value;
  return typeof lng === "number" && typeof lat === "number" ? [lng, lat] : null;
}

function readLocalPoint(value: unknown): LocalPoint | null {
  if (!isRecord(value)) return null;
  return typeof value.x === "number" && typeof value.z === "number" ? { x: value.x, z: value.z } : null;
}

function readLocalPointArray(value: unknown): LocalPoint[] {
  if (!Array.isArray(value)) return [];
  return value.map(readLocalPoint).filter((point): point is LocalPoint => Boolean(point));
}

function readLocalRings(value: unknown): LocalPoint[][] {
  if (!Array.isArray(value)) return [];
  return value.map(readLocalPointArray).filter((ring) => ring.length >= 3);
}

function fallbackAnchorTargets(): AnchorTarget[] {
  return ANCHOR_PRESETS.map((kind, index) => ({
    id: `manual-anchor-${index + 1}`,
    label: anchorLabels[kind],
    kind,
    mapLngLat: null,
    priority: index + 1,
  }));
}

function readAnchorTargets(metadata: unknown): AnchorTarget[] {
  if (!isRecord(metadata)) return [];
  const raw = Array.isArray(metadata.map_anchor_targets) ? metadata.map_anchor_targets : [];
  return raw
    .filter(isRecord)
    .map((row, index): AnchorTarget => {
      const kind = typeof row.kind === "string" && row.kind in anchorLabels ? row.kind as AnchorKind : "boundary_corner";
      return {
        id: typeof row.id === "string" ? row.id : `map-anchor-${index + 1}`,
        label: typeof row.label === "string" ? row.label : anchorLabels[kind],
        kind,
        mapLngLat: readLngLat(row.lngLat),
        local: readLocalPoint(row.local),
        priority: typeof row.priority === "number" ? row.priority : index + 1,
      };
    })
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 6);
}

function readMapFrame(metadata: unknown): AnchorMapFrame | null {
  if (!isRecord(metadata)) return null;
  const rawFrame = metadata.map_frame;
  if (!isRecord(rawFrame)) return null;
  const boundary = Array.isArray(rawFrame.boundary)
    ? rawFrame.boundary.map(readLngLat).filter((point): point is LngLat => Boolean(point))
    : [];
  const localBoundary = readLocalPointArray(rawFrame.local_boundary);
  const localLawnRings = readLocalRings(rawFrame.local_lawn_rings);
  if (localBoundary.length < 3 && !localLawnRings.length) return null;
  return {
    boundary,
    localBoundary,
    localLawnRings,
    areaM2: typeof rawFrame.area_m2 === "number" ? rawFrame.area_m2 : null,
  };
}

function readRouteProgress(metadata: unknown): GardenScanRouteObservation[] {
  if (!isRecord(metadata) || !Array.isArray(metadata.route_steps)) return [];
  const validStepIds = new Set(ROUTE_STEPS.map((step) => step.id));
  return metadata.route_steps
    .filter(isRecord)
    .map((row): GardenScanRouteObservation | null => {
      const id = typeof row.id === "string" ? row.id : "";
      if (!validStepIds.has(id)) return null;
      const routeStep = ROUTE_STEPS.find((step) => step.id === id);
      return {
        id,
        label: typeof row.label === "string" ? row.label : routeStep?.label ?? id,
        completedAt: typeof row.completedAt === "string" ? row.completedAt : new Date().toISOString(),
        captureSeconds: typeof row.captureSeconds === "number" ? row.captureSeconds : null,
        evidenceFrameId: typeof row.evidenceFrameId === "string" ? row.evidenceFrameId : null,
      };
    })
    .filter((row): row is GardenScanRouteObservation => Boolean(row))
    .slice(0, ROUTE_STEPS.length);
}

function captureStateForStatus(status: string): CaptureState {
  if (status === "uploaded" || status === "processing" || status === "ready") return "uploaded";
  if (status === "failed" || status === "cancelled") return "error";
  return "ready";
}

function boundsForMap(frame: AnchorMapFrame | null, targets: AnchorTarget[]) {
  const points = [
    ...(frame?.localBoundary ?? []),
    ...(frame?.localLawnRings.flat() ?? []),
    ...targets.map((target) => target.local).filter((point): point is LocalPoint => Boolean(point)),
  ];
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const zs = points.map((point) => point.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const width = Math.max(1, maxX - minX);
  const depth = Math.max(1, maxZ - minZ);
  return { minX, maxX, minZ, maxZ, width, depth };
}

function mapPoint(point: LocalPoint, bounds: NonNullable<ReturnType<typeof boundsForMap>>) {
  const padding = 12;
  const drawable = 100 - padding * 2;
  return {
    x: padding + ((point.x - bounds.minX) / bounds.width) * drawable,
    y: padding + ((point.z - bounds.minZ) / bounds.depth) * drawable,
  };
}

function pathFromRing(ring: LocalPoint[], bounds: NonNullable<ReturnType<typeof boundsForMap>>) {
  return ring.map((point) => {
    const mapped = mapPoint(point, bounds);
    return `${mapped.x.toFixed(2)},${mapped.y.toFixed(2)}`;
  }).join(" ");
}

function routePointsForBounds(bounds: NonNullable<ReturnType<typeof boundsForMap>>) {
  const insetX = bounds.width * 0.18;
  const insetZ = bounds.depth * 0.16;
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midZ = (bounds.minZ + bounds.maxZ) / 2;
  return [
    { x: midX, z: bounds.maxZ - insetZ },
    { x: bounds.minX + insetX, z: midZ },
    { x: midX, z: bounds.minZ + insetZ },
    { x: bounds.maxX - insetX, z: midZ },
  ] satisfies LocalPoint[];
}

function MobileRouteMap({
  frame,
  targets,
  selectedAnchorId,
  anchors,
  routeSteps,
  routeProgress,
  onSelect,
}: {
  frame: AnchorMapFrame | null;
  targets: AnchorTarget[];
  selectedAnchorId: string | null;
  anchors: GardenScanAnchorObservation[];
  routeSteps: RouteStep[];
  routeProgress: GardenScanRouteObservation[];
  onSelect: (id: string) => void;
}) {
  const bounds = boundsForMap(frame, targets);
  const doneIds = new Set(anchors.map((anchor) => anchor.id));
  const completedRouteIds = new Set(routeProgress.map((step) => step.id));
  if (!bounds) return null;
  const routePoints = routePointsForBounds(bounds);
  const routePolyline = routePoints.map((point) => {
    const mapped = mapPoint(point, bounds);
    return `${mapped.x.toFixed(2)},${mapped.y.toFixed(2)}`;
  }).join(" ");

  return (
    <div className="mobile-scan-map" aria-label="Guidet haverute">
      <div>
        <span>Rute</span>
        <strong>{Math.min(routeProgress.length, MIN_ROUTE_STEPS)}/{MIN_ROUTE_STEPS}</strong>
      </div>
      <svg viewBox="0 0 100 100" role="img" aria-label="Skitse af have, gangrute og manuelle ankerpunkter">
        {frame?.localBoundary.length ? (
          <polygon className="mobile-scan-map__boundary" points={pathFromRing(frame.localBoundary, bounds)} />
        ) : null}
        {frame?.localLawnRings.map((ring, index) => (
          <polygon className="mobile-scan-map__lawn" points={pathFromRing(ring, bounds)} key={`lawn-${index}`} />
        ))}
        <polyline className="mobile-scan-map__route" points={routePolyline} />
        {routeSteps.map((step, index) => {
          const point = routePoints[index];
          if (!point) return null;
          const mapped = mapPoint(point, bounds);
          const done = completedRouteIds.has(step.id);
          return (
            <g key={step.id} className={`mobile-scan-map__route-step ${done ? "is-done" : ""}`}>
              <circle cx={mapped.x} cy={mapped.y} r={done ? 4.8 : 4.2} />
              <text x={mapped.x} y={mapped.y + 1.5}>{index + 1}</text>
            </g>
          );
        })}
        {targets.map((target, index) => {
          if (!target.local) return null;
          const point = mapPoint(target.local, bounds);
          const selected = selectedAnchorId === target.id;
          const done = doneIds.has(target.id);
          return (
            <g
              key={target.id}
              role="button"
              tabIndex={0}
              className={`mobile-scan-map__anchor ${selected ? "is-selected" : ""} ${done ? "is-done" : ""}`}
              onClick={() => onSelect(target.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelect(target.id);
              }}
              aria-label={target.label}
            >
              <circle cx={point.x} cy={point.y} r={selected ? 3.7 : 3.1} />
              <text x={point.x} y={point.y + 1.5}>{index + 1}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function GardenMobileScan() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const gardenId = params.get("garden_id") ?? "";
  const sessionId = params.get("session_id") ?? "";
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const motionSamplesRef = useRef<MotionSample[]>([]);
  const captureStartedAtRef = useRef<string | null>(null);
  const frameIndexRef = useRef(0);
  const captureInFlightRef = useRef(false);
  const frameUrlsRef = useRef<string[]>([]);
  const [state, setState] = useState<CaptureState>("loading");
  const [session, setSession] = useState<GardenScanSession | null>(null);
  const [gardenName, setGardenName] = useState("Have");
  const [frames, setFrames] = useState<FrameCapture[]>([]);
  const [anchors, setAnchors] = useState<GardenScanAnchorObservation[]>([]);
  const [routeProgress, setRouteProgress] = useState<GardenScanRouteObservation[]>([]);
  const [anchorTargets, setAnchorTargets] = useState<AnchorTarget[]>([]);
  const [mapFrame, setMapFrame] = useState<AnchorMapFrame | null>(null);
  const [selectedAnchorId, setSelectedAnchorId] = useState<string | null>(null);
  const [manualAnchorMode, setManualAnchorMode] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraLive, setCameraLive] = useState(false);
  const [captureSeconds, setCaptureSeconds] = useState(0);

  const uploadPrefix = session?.upload_prefix ?? (user ? `${user.id}/${sessionId}` : "");
  const alignedAnchorCount = countAlignableAnchors(anchors);
  const anchorSpreadM = anchorSpreadMeters(anchors);
  const requiredFramesReady = frames.length >= MIN_SCAN_KEYFRAMES;
  const routeReady = routeProgress.length >= MIN_ROUTE_STEPS;
  const anchorCountReady = alignedAnchorCount >= MIN_ALIGNED_ANCHORS;
  const anchorSpreadReady = alignedAnchorCount < MIN_ALIGNED_ANCHORS || anchorSpreadM >= MIN_ANCHOR_SPREAD_M;
  const manualAnchorsStrong = anchorCountReady && anchorSpreadReady;
  const readyToUpload = Boolean(session && uploadPrefix && requiredFramesReady && routeReady);
  const selectedAnchor = anchorTargets.find((candidate) => candidate.id === selectedAnchorId) ?? null;
  const hasMapAnchorTargets = anchorTargets.some((target) => Boolean(target.mapLngLat && target.local));
  const currentStatus = session?.status ?? "created";
  const uploadedStateTitle = currentStatus === "ready"
    ? "3D-model klar"
    : currentStatus === "processing"
      ? "Rekonstruktion i gang"
      : "Scan modtaget";
  const currentRouteStep = ROUTE_STEPS.find((step) => !routeProgress.some((done) => done.id === step.id)) ?? null;
  const routeProgressLabel = `${Math.min(routeProgress.length, MIN_ROUTE_STEPS)}/${MIN_ROUTE_STEPS}`;
  const uploadBlockedReason = !routeReady
    ? `${Math.max(0, MIN_ROUTE_STEPS - routeProgress.length)} rutepunkter mangler`
    : !requiredFramesReady
      ? `${Math.max(0, MIN_SCAN_KEYFRAMES - frames.length)} keyframes mangler`
      : "";
  const readinessHint = !routeReady
    ? currentRouteStep?.instruction ?? "Følg ruten og hold kameraet peget mod havens midte."
    : !requiredFramesReady
      ? "Ruten er dækket. Gå lidt langsommere videre, så kameraet får flere vinkler."
      : !manualAnchorsStrong
        ? "Klar til upload. Manuelle ankre er valgfrie, men giver bedre alignment på kortet."
        : anchorSpreadM < RECOMMENDED_ANCHOR_SPREAD_M
          ? "Klar til upload. Et ekstra anker længere væk kan styrke alignment."
          : "Klar til upload med stærk rute og manuelle ankre.";
  const selectedAnchorIndex = selectedAnchor ? anchorTargets.findIndex((target) => target.id === selectedAnchor.id) : -1;
  const captureGuide = state === "ready"
    ? "Start kameraet. Havemåler guider dig rundt, mens du holder midten af haven i billedet."
    : manualAnchorMode && selectedAnchor
      ? `Manuelt anker: tryk samme faste punkt i kameraet for ${selectedAnchor.label}.`
      : !routeReady
        ? currentRouteStep?.instruction ?? "Følg ruten rundt om haven."
        : !requiredFramesReady
          ? "Bliv ved med langsom bevægelse, så kameraet samler flere vinkler automatisk."
          : "Scan er klar til upload. Manuelle ankre er kun et plus.";
  const footerHint = state === "uploaded"
    ? currentStatus === "ready"
      ? "3D-modellen er gemt på haven og kan åbnes i Havemåler."
      : "Scandata er modtaget. Worker-rekonstruktionen opdaterer haven, når modellen er klar."
    : state === "camera"
      ? readinessHint
    : state === "ready"
        ? "Start kameraet og gå den guidede rute med kameraet peget mod havens midte."
        : scanActionHint(currentStatus);

  useEffect(() => {
    document.body.classList.add("is-mobile-scan");
    return () => document.body.classList.remove("is-mobile-scan");
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/havemaaler/scan?garden_id=${gardenId}&session_id=${sessionId}`)}`);
      return;
    }
    if (!gardenId || !sessionId) {
      setState("error");
      setCameraError("Scan-linket mangler garden_id eller session_id.");
      return;
    }
    let alive = true;
    async function load() {
      const [{ data: sessionRow, error: sessionError }, { data: gardenRow }] = await Promise.all([
        supabase.from("garden_scan_sessions").select("*").eq("id", sessionId).eq("garden_id", gardenId).maybeSingle(),
        supabase.from("gardens").select("name").eq("id", gardenId).maybeSingle(),
      ]);
      if (!alive) return;
      if (sessionError || !sessionRow) {
        setState("error");
        setCameraError(sessionError?.message ?? "Scan-session blev ikke fundet.");
        return;
      }
      setSession(sessionRow as GardenScanSession);
      setGardenName(gardenRow?.name ?? "Have");
      const targets = readAnchorTargets(sessionRow.capture_metadata);
      const nextTargets = targets.length ? targets : fallbackAnchorTargets();
      setAnchorTargets(nextTargets);
      setMapFrame(readMapFrame(sessionRow.capture_metadata));
      if (Array.isArray(sessionRow.anchors)) setAnchors(sessionRow.anchors as GardenScanAnchorObservation[]);
      setRouteProgress(readRouteProgress(sessionRow.capture_metadata));
      setSelectedAnchorId(nextTargets[0]?.id ?? null);
      if (sessionRow.status === "failed" || sessionRow.status === "cancelled") {
        setCameraError(sessionRow.error_detail ?? scanActionHint(sessionRow.status));
      }
      setState(captureStateForStatus(sessionRow.status));
    }
    void load();
    return () => { alive = false; };
  }, [gardenId, loading, navigate, sessionId, user]);

  useEffect(() => {
    const frameUrls = frameUrlsRef.current;
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      frameUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (state !== "camera") return;
    const timer = window.setInterval(() => {
      const started = captureStartedAtRef.current ? new Date(captureStartedAtRef.current).getTime() : Date.now();
      setCaptureSeconds(Math.max(0, Math.round((Date.now() - started) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  useEffect(() => {
    if (!motionEnabled) return;
    const onMotion = (event: DeviceMotionEvent) => {
      if (motionSamplesRef.current.length >= 600) return;
      motionSamplesRef.current.push({
        t: Date.now(),
        acceleration: {
          x: event.acceleration?.x ?? null,
          y: event.acceleration?.y ?? null,
          z: event.acceleration?.z ?? null,
        },
        rotationRate: {
          alpha: event.rotationRate?.alpha ?? null,
          beta: event.rotationRate?.beta ?? null,
          gamma: event.rotationRate?.gamma ?? null,
        },
        interval: event.interval ?? null,
      });
    };
    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [motionEnabled]);

  const attachStreamToVideo = useCallback(async (stream: MediaStream) => {
    const video = videoRef.current;
    if (!video) return false;
    if (video.srcObject !== stream) video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    setCameraLive(true);
    return true;
  }, []);

  useEffect(() => {
    if (state !== "camera" && state !== "uploading") return;
    const stream = streamRef.current;
    if (!stream) return;
    void attachStreamToVideo(stream).catch((error) => {
      setCameraLive(false);
      setCameraError(error instanceof Error ? error.message : "Kameravisningen kunne ikke starte.");
    });
  }, [attachStreamToVideo, state]);

  async function startCamera() {
    setCameraError(null);
    setCameraLive(false);
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("Kamera kræver HTTPS på telefonen. Åbn scan-linket fra den sikre Havemåler-side og prøv igen.");
      }
      let motionGranted = false;
      if (supportsDeviceMotionPermission()) {
        const ctor = window.DeviceMotionEvent as MotionPermissionCtor;
        const permission = await ctor.requestPermission?.();
        motionGranted = permission === "granted";
      } else {
        motionGranted = "DeviceMotionEvent" in window;
      }
      setMotionEnabled(motionGranted);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      await attachStreamToVideo(stream);
      captureStartedAtRef.current = new Date().toISOString();
      setCaptureSeconds(0);
      setState("camera");
      try {
        const { data, error } = await supabase.functions.invoke("complete-garden-scan-session", {
          body: {
            session_id: sessionId,
            status: "capturing",
            actor: "mobile_web",
            reason: "camera_started",
            capture_metadata: {
              client: "mobile_web",
              user_agent: navigator.userAgent,
              device_motion: motionGranted,
            },
          },
        });
        if (error) console.warn("Could not mark scan session as capturing", error);
        if (data?.session) setSession(data.session as GardenScanSession);
      } catch (statusError) {
        console.warn("Could not mark scan session as capturing", statusError);
      }
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraLive(false);
      setCameraError(error instanceof Error ? error.message : "Kamera kunne ikke startes.");
      setState("ready");
    }
  }

  const captureFrame = useCallback(async (source: FrameCapture["source"] = "manual"): Promise<FrameCapture | null> => {
    if (captureInFlightRef.current || !uploadPrefix) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) return null;
    captureInFlightRef.current = true;
    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (!blob) return null;
      const id = `frame-${String(frameIndexRef.current + 1).padStart(3, "0")}`;
      frameIndexRef.current += 1;
      const previewUrl = URL.createObjectURL(blob);
      frameUrlsRef.current.push(previewUrl);
      const frame: FrameCapture = {
        id,
        path: `${uploadPrefix}/frames/${id}.jpg`,
        blob,
        previewUrl,
        capturedAt: new Date().toISOString(),
        width: canvas.width,
        height: canvas.height,
        source,
      };
      setFrames((prev) => [...prev, frame]);
      return frame;
    } finally {
      captureInFlightRef.current = false;
    }
  }, [uploadPrefix]);

  useEffect(() => {
    if (state !== "camera") return;
    let cancelled = false;
    const run = () => {
      if (cancelled || frameIndexRef.current >= 36) return;
      void captureFrame("auto");
    };
    const first = window.setTimeout(run, 900);
    const interval = window.setInterval(run, 2800);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [captureFrame, state]);

  async function markAnchor(target: AnchorTarget, imagePoint: { x: number; y: number }) {
    const frame = await captureFrame("anchor");
    const evidence = frame?.id ?? frames.at(-1)?.id;
    const markedIds = new Set([...anchors.map((anchor) => anchor.id), target.id]);
    setAnchors((prev) => [
      ...prev.filter((anchor) => anchor.id !== target.id),
      {
        id: target.id,
        kind: target.kind,
        label: target.label,
        mapLngLat: target.mapLngLat ?? null,
        imagePoint,
        confidence: evidence && target.mapLngLat ? 0.82 : evidence ? 0.62 : 0.45,
        evidenceFrameIds: evidence ? [evidence] : [],
      },
    ]);
    const nextTarget = anchorTargets.find((candidate) => !markedIds.has(candidate.id));
    setSelectedAnchorId(nextTarget?.id ?? target.id);
  }

  async function completeCurrentRouteStep() {
    if (state !== "camera") return;
    if (!currentRouteStep) {
      toast.success("Ruten er allerede dækket");
      return;
    }
    const frame = await captureFrame("route");
    if (!frame && !frames.length) {
      toast("Kameraet samler første billede", {
        description: "Hold telefonen roligt mod havens midte et øjeblik.",
      });
      return;
    }
    setRouteProgress((prev) => {
      if (prev.some((step) => step.id === currentRouteStep.id)) return prev;
      return [
        ...prev,
        {
          id: currentRouteStep.id,
          label: currentRouteStep.label,
          completedAt: new Date().toISOString(),
          captureSeconds,
          evidenceFrameId: frame?.id ?? frames.at(-1)?.id ?? null,
        },
      ];
    });
  }

  function imagePointFromEvent(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Number(((event.clientX - rect.left) / Math.max(1, rect.width)).toFixed(4)),
      y: Number(((event.clientY - rect.top) / Math.max(1, rect.height)).toFixed(4)),
    };
  }

  async function handleCameraTap(event: PointerEvent<HTMLDivElement>) {
    if (state !== "camera") return;
    if (!manualAnchorMode) return;
    if (!selectedAnchor) {
      toast("Vælg et anker først");
      return;
    }
    await markAnchor(selectedAnchor, imagePointFromEvent(event));
  }

  function explainUploadBlock() {
    if (!session || !uploadPrefix) {
      toast.error("Scan-sessionen er ikke klar endnu");
      return;
    }
    toast("Scan mangler stadig lidt", {
      description: uploadBlockedReason ? `${uploadBlockedReason}. ${readinessHint}` : readinessHint,
    });
  }

  async function handleUploadAction() {
    if (!readyToUpload) {
      explainUploadBlock();
      return;
    }
    await uploadCapture();
  }

  async function uploadCapture() {
    if (!session || !uploadPrefix) {
      toast.error("Scan-sessionen er ikke klar endnu");
      return;
    }
    if (!readyToUpload) {
      explainUploadBlock();
      return;
    }
    setState("uploading");
    const targets = buildUploadTargets(uploadPrefix);
    const byKind = Object.fromEntries(targets.map((target) => [target.kind, target.path])) as Record<string, string>;
    const completedAt = new Date().toISOString();
    const manifest: GardenScanManifest = {
      version: 1,
      session_id: session.id,
      garden_id: gardenId,
      device: {
        model: browserDeviceLabel(),
        browser: navigator.userAgent,
        client_version: "mobile-web-v1",
        supports_lidar: false,
        supports_camera: Boolean(navigator.mediaDevices?.getUserMedia),
        supports_device_motion: motionEnabled,
      },
      capture: {
        duration_seconds: Math.max(1, Math.round((Date.now() - new Date(captureStartedAtRef.current ?? completedAt).getTime()) / 1000)),
        started_at: captureStartedAtRef.current,
        completed_at: completedAt,
        tracking_quality: motionSamplesRef.current.length > 10 ? "normal" : "limited",
        frame_count: frames.length,
        keyframe_count: frames.length,
        automatic_keyframes: true,
        frame_interval_seconds: 2.8,
        anchor_count: anchors.length,
        aligned_anchor_count: alignedAnchorCount,
        manual_anchor_count: alignedAnchorCount,
        route_guided: true,
        route_step_count: ROUTE_STEPS.length,
        completed_route_steps: routeProgress.length,
        route_progress: Number(Math.min(1, routeProgress.length / MIN_ROUTE_STEPS).toFixed(2)),
        coverage_score: Math.min(0.96, 0.18 + frames.length * 0.045 + routeProgress.length * 0.12 + Math.min(alignedAnchorCount, RECOMMENDED_ALIGNED_ANCHORS) * 0.04),
        low_light: null,
      },
      anchors,
      route: {
        mode: "guided_center_route",
        camera_target: "garden_center",
        required_step_count: MIN_ROUTE_STEPS,
        steps: routeProgress,
      },
      files: {
        manifest: byKind.manifest,
        tracking: byKind.tracking,
        keyframes: byKind.keyframes,
        preview: byKind.preview,
      },
    };
    const inspection = inspectScanManifest(manifest);
    if (!inspection.ready) {
      setState("camera");
      toast.error("Scan mangler data", {
        description: inspection.issues.map((issue) => issue.message).join(" "),
      });
      return;
    }

    const keyframes = {
      version: 1,
      session_id: session.id,
      frames: frames.map((frame) => ({
        id: frame.id,
        path: frame.path,
        captured_at: frame.capturedAt,
        width: frame.width,
        height: frame.height,
        source: frame.source,
      })),
    };
    const tracking = {
      version: 1,
      session_id: session.id,
      coordinate_space: "mobile_web_camera",
      map_frame: mapFrame,
      anchor_targets: anchorTargets,
      capture_quality: {
        keyframe_count: frames.length,
        route_guided: true,
        completed_route_steps: routeProgress.length,
        required_route_steps: MIN_ROUTE_STEPS,
        route_progress: Number(Math.min(1, routeProgress.length / MIN_ROUTE_STEPS).toFixed(2)),
        aligned_anchor_count: alignedAnchorCount,
        anchor_spread_m: anchorSpreadM,
        capture_seconds: manifest.capture.duration_seconds,
        recommended_keyframes: RECOMMENDED_SCAN_KEYFRAMES,
        recommended_route_steps: RECOMMENDED_ROUTE_STEPS,
        recommended_anchors: RECOMMENDED_ALIGNED_ANCHORS,
        recommended_anchor_spread_m: RECOMMENDED_ANCHOR_SPREAD_M,
      },
      device_motion_samples: motionSamplesRef.current,
      route_steps: routeProgress,
      anchors,
    };

    try {
      const bucket = supabase.storage.from("garden-scans");
      for (const frame of frames) {
        const { error } = await bucket.upload(frame.path, frame.blob, { contentType: "image/jpeg", upsert: true });
        if (error) throw error;
      }
      await uploadJson(byKind.manifest, scanManifestToJson(manifest));
      await uploadJson(byKind.tracking, tracking);
      await uploadJson(byKind.keyframes, keyframes);
      if (frames[0] && byKind.preview) {
        const { error } = await bucket.upload(byKind.preview, frames[0].blob, { contentType: "image/jpeg", upsert: true });
        if (error) throw error;
      }
      const { data, error } = await supabase.functions.invoke("complete-garden-scan-session", {
        body: {
          session_id: session.id,
          status: "uploaded",
          actor: "mobile_web",
          reason: "browser_capture_uploaded",
          manifest_path: byKind.manifest,
          anchors,
          warnings: inspection.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.code),
          capture_metadata: {
            client: "mobile_web",
            capture_seconds: manifest.capture.duration_seconds,
            frame_count: frames.length,
            keyframe_count: frames.length,
            capture_mode: "guided_center_route",
            route_guided: true,
            route_step_count: ROUTE_STEPS.length,
            completed_route_steps: routeProgress.length,
            route_progress: manifest.capture.route_progress,
            route_steps: routeProgress,
            anchor_count: anchors.length,
            aligned_anchor_count: alignedAnchorCount,
            anchor_spread_m: anchorSpreadM,
            motion_samples: motionSamplesRef.current.length,
          },
        },
      });
      if (error) throw error;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraLive(false);
      if (data?.session) setSession(data.session as GardenScanSession);
      setState("uploaded");
      toast.success("Scan modtaget", {
        description: "Scandata er uploadet og klar til rekonstruktion.",
      });
    } catch (error) {
      setState("camera");
      toast.error(error instanceof Error ? error.message : "Upload fejlede");
    }
  }

  async function uploadJson(path: string, value: Json | unknown) {
    const { error } = await supabase.storage
      .from("garden-scans")
      .upload(path, jsonBlob(value), { contentType: "application/json", upsert: true });
    if (error) throw error;
  }

  return (
    <div className="mobile-scan-page">
      <AppNav active="sizer" />
      <section className="mobile-scan-shell">
        <header className="mobile-scan-header">
          <Link to={`/havemaaler?garden=${gardenId}`} className="mobile-scan-back"><ArrowLeft size={16} /> Havemåler</Link>
          <div>
            <span>Mobil web scan</span>
            <h1>{gardenName}</h1>
          </div>
          <small>{scanStatusLabel(currentStatus)} · {scanProgress(currentStatus)}%</small>
        </header>

        {state !== "loading" && state !== "error" && state !== "uploaded" && (
          <div className="mobile-scan-flow" aria-label="Scantrin">
            <span className={state === "ready" ? "is-active" : "is-done"}><b>1</b>Kamera</span>
            <span className={routeReady ? "is-done" : state === "camera" ? "is-active" : ""}><b>2</b>Rute</span>
            <span className={requiredFramesReady ? "is-done" : state === "camera" && routeReady ? "is-active" : ""}><b>3</b>Vinkler</span>
            <span className={readyToUpload ? "is-active" : ""}><b>4</b>Upload</span>
          </div>
        )}

        {state !== "uploaded" && (
          <MobileRouteMap
            frame={mapFrame}
            targets={anchorTargets}
            selectedAnchorId={selectedAnchorId}
            anchors={anchors}
            routeSteps={ROUTE_STEPS}
            routeProgress={routeProgress}
            onSelect={setSelectedAnchorId}
          />
        )}

        {state !== "loading" && state !== "error" && state !== "uploaded" && (
          <div className="mobile-scan-guide">
            <strong>{state === "ready" ? "Klar til rutescan" : manualAnchorMode && selectedAnchor ? `Manuelt anker: ${selectedAnchor.label}` : currentRouteStep ? `Rute: ${currentRouteStep.shortLabel}` : "Rute dækket"}</strong>
            <span>{captureGuide}</span>
          </div>
        )}

        <div className={`mobile-scan-camera ${state === "camera" && manualAnchorMode ? "is-marking" : ""}`} onPointerDown={(event) => { void handleCameraTap(event); }}>
          <video
            ref={videoRef}
            className={cameraLive ? "is-live" : ""}
            playsInline
            muted
            autoPlay
            onLoadedData={() => setCameraLive(true)}
            onCanPlay={() => setCameraLive(true)}
            onPlaying={() => setCameraLive(true)}
          />
          {state !== "camera" && state !== "uploading" && (
            <div className="mobile-scan-standby">
              <Video size={42} />
              <span>{state === "uploaded" ? uploadedStateTitle : state === "error" ? "Scan stoppet" : "Kamera klar"}</span>
            </div>
          )}
          {state === "camera" && !cameraLive && (
            <div className="mobile-scan-camera-loading">
              <Video size={30} />
              <span>Starter kamera...</span>
            </div>
          )}
          <canvas ref={canvasRef} aria-hidden="true" />
          <div className="mobile-scan-hud">
            <span><Camera size={13} /> {frames.length}/{RECOMMENDED_SCAN_KEYFRAMES} auto</span>
            <span><Footprints size={13} /> {routeProgressLabel} rute</span>
            <span><CircleDot size={13} /> {alignedAnchorCount} ankre</span>
          </div>
          {state === "camera" && manualAnchorMode && selectedAnchor && (
            <div className="mobile-scan-target-hint">
              Tryk samme punkt i kameraet: {selectedAnchorIndex + 1}. {selectedAnchor.label}
            </div>
          )}
          {state === "camera" && !manualAnchorMode && currentRouteStep && (
            <div className="mobile-scan-target-hint">
              {currentRouteStep.shortLabel}: peg mod havens midte
            </div>
          )}
        </div>

        {cameraError && <p className="mobile-scan-error">{cameraError}</p>}

        <div className="mobile-scan-actions">
          {state === "ready" && (
            <button type="button" className="btn btn-primary" onClick={startCamera}>
              <Video size={16} /> Start kamera
            </button>
          )}
          {state === "camera" && (
            <>
              <button type="button" className={readyToUpload ? "btn btn-primary" : "btn btn-ghost"} onClick={() => void handleUploadAction()}>
                <UploadCloud size={16} /> {readyToUpload ? "Upload scan" : uploadBlockedReason || "Tjek scan"}
              </button>
              <button type="button" className={!routeReady ? "btn btn-primary" : "btn btn-ghost"} onClick={() => void completeCurrentRouteStep()}>
                <Footprints size={16} /> {currentRouteStep ? `Næste: ${currentRouteStep.shortLabel}` : "Rute færdig"}
              </button>
              <button type="button" className={manualAnchorMode ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setManualAnchorMode((value) => !value)} disabled={!hasMapAnchorTargets}>
                <MapPinned size={16} /> {manualAnchorMode ? "Luk anker" : "Manuelt anker"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => void captureFrame()}>
                <Camera size={16} /> Ekstra keyframe
              </button>
            </>
          )}
          {state === "uploading" && (
            <button type="button" className="btn btn-primary" disabled>
              <UploadCloud size={16} /> Uploader...
            </button>
          )}
          {state === "uploaded" && (
            <Link className="btn btn-primary" to={`/havemaaler?garden=${gardenId}`}>
              <CheckCircle2 size={16} /> {currentStatus === "ready" ? "Tilbage til 3D" : "Tilbage til Havemåler"}
            </Link>
          )}
          {state === "error" && (
            <Link className="btn btn-primary" to={`/havemaaler?garden=${gardenId}`}>
              <ArrowLeft size={16} /> Tilbage til Havemåler
            </Link>
          )}
        </div>

        {state === "camera" && (
          <div className="mobile-scan-anchors">
            <p>{readinessHint}</p>
            <div className="mobile-scan-readiness" aria-live="polite">
              <span className={routeReady ? "is-done" : ""}><Footprints size={14} /> {routeProgressLabel} rute</span>
              <span className={requiredFramesReady ? "is-done" : ""}><CheckCircle2 size={14} /> {Math.min(frames.length, MIN_SCAN_KEYFRAMES)}/{MIN_SCAN_KEYFRAMES} billeder</span>
              <span className={manualAnchorsStrong ? "is-done" : ""}><CircleDot size={14} /> {alignedAnchorCount} manuelle</span>
            </div>
            {ROUTE_STEPS.map((step, index) => (
              <button
                type="button"
                key={step.id}
                className={`${routeProgress.some((done) => done.id === step.id) ? "is-done" : ""} ${currentRouteStep?.id === step.id ? "is-current" : ""}`}
                onClick={() => {
                  if (currentRouteStep?.id === step.id) void completeCurrentRouteStep();
                }}
              >
                <b>{index + 1}</b>
                <span>{step.shortLabel}</span>
              </button>
            ))}
            {manualAnchorMode && anchorTargets.map((target, index) => (
              <button
                type="button"
                key={target.id}
                className={`${selectedAnchorId === target.id ? "is-selected" : ""} ${anchors.some((anchor) => anchor.id === target.id) ? "is-done" : ""}`}
                onClick={() => setSelectedAnchorId(target.id)}
              >
                <b>{index + 1}</b>
                <span>{target.label}</span>
              </button>
            ))}
          </div>
        )}

        <div className="mobile-scan-strip" aria-label="Keyframes">
          {frames.slice(-10).map((frame) => (
            <img key={frame.id} src={frame.previewUrl} alt="" />
          ))}
        </div>

        <footer className="mobile-scan-footer">
          <span>{footerHint}</span>
          <small>{routeProgressLabel} rute · {frames.length}/{RECOMMENDED_SCAN_KEYFRAMES} billeder · {alignedAnchorCount}/{RECOMMENDED_ALIGNED_ANCHORS} manuelle ankre</small>
        </footer>
      </section>
    </div>
  );
}
