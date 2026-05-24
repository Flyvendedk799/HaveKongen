import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Camera, CheckCircle2, CircleDot, Compass, UploadCloud, Video } from "lucide-react";
import { toast } from "sonner";
import { AppNav } from "@/components/layout/SiteChrome";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import {
  buildUploadTargets,
  inspectScanManifest,
  scanActionHint,
  scanManifestToJson,
  scanProgress,
  scanStatusLabel,
  type GardenScanAnchorObservation,
  type GardenScanManifest,
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
};

type MotionSample = {
  t: number;
  acceleration?: { x: number | null; y: number | null; z: number | null };
  rotationRate?: { alpha: number | null; beta: number | null; gamma: number | null };
  interval?: number | null;
};

type CaptureState = "loading" | "ready" | "camera" | "uploading" | "uploaded" | "error";

const ANCHOR_PRESETS: Array<NonNullable<GardenScanAnchorObservation["kind"]>> = [
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
  const frameUrlsRef = useRef<string[]>([]);
  const [state, setState] = useState<CaptureState>("loading");
  const [session, setSession] = useState<GardenScanSession | null>(null);
  const [gardenName, setGardenName] = useState("Have");
  const [frames, setFrames] = useState<FrameCapture[]>([]);
  const [anchors, setAnchors] = useState<GardenScanAnchorObservation[]>([]);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const uploadPrefix = session?.upload_prefix ?? (user ? `${user.id}/${sessionId}` : "");
  const uploadTargets = useMemo(() => buildUploadTargets(uploadPrefix || "pending"), [uploadPrefix]);
  const requiredFramesReady = frames.length >= 8;
  const anchorsReady = anchors.length >= 2;
  const readyToUpload = Boolean(session && uploadPrefix && requiredFramesReady && anchorsReady);

  useEffect(() => {
    document.body.classList.add("is-mobile-scan");
    return () => document.body.classList.remove("is-mobile-scan");
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(`/havemaaler/scan?garden_id=${gardenId}&session_id=${sessionId}`)}`);
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
      setState(["uploaded", "processing", "ready"].includes(sessionRow.status) ? "uploaded" : "ready");
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

  async function startCamera() {
    setCameraError(null);
    try {
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
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      captureStartedAtRef.current = new Date().toISOString();
      setState("camera");
      await supabase.functions.invoke("complete-garden-scan-session", {
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
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : "Kamera kunne ikke startes.");
      setState("ready");
    }
  }

  async function captureFrame(): Promise<FrameCapture | null> {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) return null;
    const id = `frame-${String(frames.length + 1).padStart(3, "0")}`;
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
    };
    setFrames((prev) => [...prev, frame]);
    return frame;
  }

  async function addAnchor(kind: NonNullable<GardenScanAnchorObservation["kind"]>) {
    let evidence = frames.at(-1)?.id;
    if (frames.length === 0) {
      const frame = await captureFrame();
      evidence = frame?.id;
    }
    setAnchors((prev) => [
      ...prev,
      {
        id: `anchor-${prev.length + 1}`,
        kind,
        label: anchorLabels[kind],
        confidence: evidence ? 0.7 : 0.55,
        evidenceFrameIds: evidence ? [evidence] : [],
      },
    ]);
  }

  async function uploadCapture() {
    if (!session || !uploadPrefix || !readyToUpload) return;
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
        coverage_score: Math.min(0.92, 0.2 + frames.length * 0.055 + anchors.length * 0.08),
        low_light: null,
      },
      anchors,
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
      })),
    };
    const tracking = {
      version: 1,
      session_id: session.id,
      coordinate_space: "mobile_web_camera",
      device_motion_samples: motionSamplesRef.current,
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
      const { error } = await supabase.functions.invoke("complete-garden-scan-session", {
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
            anchor_count: anchors.length,
            motion_samples: motionSamplesRef.current.length,
          },
        },
      });
      if (error) throw error;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setState("uploaded");
      toast.success("Mobilscan uploadet");
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

  const currentStatus = session?.status ?? "created";

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

        <div className="mobile-scan-camera">
          {state === "camera" || state === "uploading" ? (
            <video ref={videoRef} playsInline muted />
          ) : (
            <div className="mobile-scan-standby">
              <Video size={42} />
              <span>{state === "uploaded" ? "Upload færdig" : "Kamera klar"}</span>
            </div>
          )}
          <canvas ref={canvasRef} aria-hidden="true" />
          <div className="mobile-scan-hud">
            <span><Camera size={13} /> {frames.length}/8 keyframes</span>
            <span><CircleDot size={13} /> {anchors.length}/2 ankre</span>
            <span><Compass size={13} /> {motionEnabled ? "Motion" : "Video"}</span>
          </div>
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
              <button type="button" className="btn btn-primary" onClick={() => void captureFrame()}>
                <Camera size={16} /> Tag keyframe
              </button>
              <button type="button" className="btn btn-ghost" onClick={uploadCapture} disabled={!readyToUpload}>
                <UploadCloud size={16} /> Upload scan
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
              <CheckCircle2 size={16} /> Tilbage til 3D
            </Link>
          )}
        </div>

        {state === "camera" && (
          <div className="mobile-scan-anchors">
            {ANCHOR_PRESETS.map((kind) => (
              <button type="button" key={kind} onClick={() => void addAnchor(kind)}>
                {anchorLabels[kind]}
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
          <span>{scanActionHint(currentStatus)}</span>
          <small>{uploadTargets.filter((target) => target.required).length} krævede filer · {uploadPrefix || "afventer session"}</small>
        </footer>
      </section>
    </div>
  );
}
