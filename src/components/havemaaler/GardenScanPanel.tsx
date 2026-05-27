import { Activity, CheckCircle2, ExternalLink, Layers3, Play, ShieldCheck, UploadCloud } from "lucide-react";
import type { GardenDepthModel } from "@/lib/gardenDepth";
import { depthPipelineStage, depthPipelineStageLabel, inspectGardenDepthModel, summarizeDepthModel } from "@/lib/gardenDepth";
import type { GardenScanSession, ScanUploadTarget } from "@/lib/gardenScan";
import { latestUsefulScan, MIN_ROUTE_STEPS, MIN_SCAN_KEYFRAMES, RECOMMENDED_ALIGNED_ANCHORS, scanActionHint, scanCanStartNewSession, scanEvidenceSummary, scanProgress, scanStatusLabel, scanStatusTone } from "@/lib/gardenScan";

type Props = {
  depthModel: GardenDepthModel | null;
  sessions: GardenScanSession[];
  scanLaunch: { sessionId: string; scanUrl: string; uploadPrefix?: string | null; uploadTargets?: ScanUploadTarget[] } | null;
  starting: boolean;
  canPreview: boolean;
  canStartScan: boolean;
  scanButtonLabel?: string;
  onBuildPreview: () => void;
  onStartScan: () => void;
  onShowTwin: () => void;
};

export default function GardenScanPanel({
  depthModel,
  sessions,
  scanLaunch,
  starting,
  canPreview,
  canStartScan,
  scanButtonLabel,
  onBuildPreview,
  onStartScan,
  onShowTwin,
}: Props) {
  const summary = depthModel ? summarizeDepthModel(depthModel) : null;
  const inspection = depthModel ? inspectGardenDepthModel(depthModel) : null;
  const stage = depthPipelineStage(depthModel);
  const isFlatPreview = stage === "satellite_preview" || stage === "outline_only";
  const geometryCount = isFlatPreview ? depthModel?.terrain.lawnRings.length ?? 0 : summary?.objectCount ?? 0;
  const confirmedCount = isFlatPreview ? 0 : summary?.highConfidenceObjects ?? 0;
  const latest = latestUsefulScan(sessions);
  const evidence = latest ? scanEvidenceSummary(latest) : null;
  const canStartAnother = scanCanStartNewSession(sessions);
  const resolvedScanButtonLabel = scanButtonLabel ?? (canStartAnother ? "Scan mobil" : "Fortsæt scan");
  const blockingIssueCount = inspection?.issues.filter((issue) => issue.severity === "error").length ?? 0;
  const warningIssueCount = inspection?.issues.filter((issue) => issue.severity === "warning").length ?? 0;

  return (
    <section className="garden-scan-panel">
      <div className="garden-scan-panel__head">
        <div>
          <span>3D Garden Twin</span>
          <strong>{summary ? `${summary.qualityScore}/100 ${isFlatPreview ? "preview" : "kvalitet"}` : "Klar til mobilscan"}</strong>
        </div>
        <Layers3 size={18} />
      </div>

      <div className="garden-scan-panel__metrics">
        <div><CheckCircle2 size={14} /><strong>{geometryCount}</strong><span>{isFlatPreview ? "plæneflader" : "objekter"}</span></div>
        <div><Activity size={14} /><strong>{evidence ? `${Math.min(evidence.completedRouteSteps, MIN_ROUTE_STEPS)}/${MIN_ROUTE_STEPS}` : depthModel?.captureReadiness.recommendedSeconds.join("-") ?? "45-90"}</strong><span>{evidence ? "rute" : "sek scan"}</span></div>
        <div><ShieldCheck size={14} /><strong>{evidence ? evidence.keyframeCount : confirmedCount}</strong><span>{evidence ? "keyframes" : isFlatPreview ? "scannede" : "bekræftet"}</span></div>
      </div>

      {depthModel && (
        <div className="garden-scan-readiness">
          <span>{depthPipelineStageLabel(stage)}</span>
          <p>
            {depthModel.quality.reasons.join(" ")}
            {blockingIssueCount > 0 ? ` ${blockingIssueCount} blokerende modeltjek.` : ""}
            {warningIssueCount > 0 ? ` ${warningIssueCount} advarsler.` : ""}
          </p>
          <div>
            {depthModel.captureReadiness.anchorSuggestions.map((anchor) => (
              <i key={anchor.id}>{anchor.label}</i>
            ))}
          </div>
        </div>
      )}

      <div className="garden-scan-panel__actions">
        <button type="button" onClick={onBuildPreview} disabled={!canPreview}>
          <Layers3 size={14} /> Flad preview
        </button>
        <button type="button" className="garden-scan-panel__scan-action" onClick={onStartScan} disabled={!canStartScan || starting}>
          {starting ? <UploadCloud size={14} /> : <Play size={14} />} {starting ? "Klargør..." : resolvedScanButtonLabel}
        </button>
        <button type="button" onClick={onShowTwin} disabled={!depthModel}>
          <ExternalLink size={14} /> Vis 3D
        </button>
      </div>

      {scanLaunch && (
        <div className="garden-scan-launch">
          <span>Session {scanLaunch.sessionId.slice(0, 8)}</span>
          <a href={scanLaunch.scanUrl}>Åbn mobilcapture</a>
          {scanLaunch.uploadTargets?.length ? (
            <small>{scanLaunch.uploadTargets.filter((target) => target.required).length} krævede uploadfiler er reserveret.</small>
          ) : (
            <small>Upload-prefix: {scanLaunch.uploadPrefix ?? "klar"}</small>
          )}
        </div>
      )}

      {latest && (
        <div className={`garden-scan-status garden-scan-status--${scanStatusTone(latest.status)}`}>
          <div>
            <span>{scanStatusLabel(latest.status)}</span>
            <strong>{Math.round((latest.confidence ?? 0) * 100) || scanProgress(latest.status)}%</strong>
          </div>
          <i><b style={{ width: `${scanProgress(latest.status)}%` }} /></i>
          <small>
            {evidence ? `${Math.min(evidence.completedRouteSteps, MIN_ROUTE_STEPS)}/${MIN_ROUTE_STEPS} rute · ${Math.min(evidence.keyframeCount, MIN_SCAN_KEYFRAMES)}/${MIN_SCAN_KEYFRAMES} billeder · ${evidence.alignableAnchorCount}/${RECOMMENDED_ALIGNED_ANCHORS} ankre` : "Ingen scandata endnu"}
            {evidence?.processingAttempts ? ` · ${evidence.processingAttempts} forsøg` : ""}
            {latest.error_detail ? ` · ${latest.error_detail}` : ""}
          </small>
          <em>{evidence?.readinessHint ?? scanActionHint(latest.status)}</em>
        </div>
      )}

      {sessions.length > 1 && (
        <div className="garden-scan-history">
          {sessions.slice(1, 4).map((session) => (
            <div key={session.id}>
              <span>{scanStatusLabel(session.status)}</span>
              <small>{new Date(session.created_at).toLocaleDateString("da-DK", { day: "numeric", month: "short" })}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
