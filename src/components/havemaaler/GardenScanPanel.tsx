import { Activity, CheckCircle2, ExternalLink, Layers3, Play, ShieldCheck, UploadCloud } from "lucide-react";
import type { GardenDepthModel } from "@/lib/gardenDepth";
import { depthPipelineStage, depthPipelineStageLabel, inspectGardenDepthModel, summarizeDepthModel } from "@/lib/gardenDepth";
import type { GardenScanSession, ScanUploadTarget } from "@/lib/gardenScan";
import { requiredAnchorCount, scanActionHint, scanCanStartNewSession, scanProgress, scanStatusLabel, scanStatusTone } from "@/lib/gardenScan";

type Props = {
  depthModel: GardenDepthModel | null;
  sessions: GardenScanSession[];
  scanLaunch: { sessionId: string; scanUrl: string; uploadPrefix?: string | null; uploadTargets?: ScanUploadTarget[] } | null;
  starting: boolean;
  canPreview: boolean;
  canStartScan: boolean;
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
  onBuildPreview,
  onStartScan,
  onShowTwin,
}: Props) {
  const summary = depthModel ? summarizeDepthModel(depthModel) : null;
  const inspection = depthModel ? inspectGardenDepthModel(depthModel) : null;
  const stage = depthPipelineStage(depthModel);
  const latest = sessions[0] ?? null;
  const anchorState = latest ? requiredAnchorCount(latest.status, latest.anchors) : null;
  const canStartAnother = scanCanStartNewSession(sessions);
  const scanButtonLabel = canStartAnother ? "Scan mobil" : "Fortsæt scan";
  const blockingIssueCount = inspection?.issues.filter((issue) => issue.severity === "error").length ?? 0;
  const warningIssueCount = inspection?.issues.filter((issue) => issue.severity === "warning").length ?? 0;

  return (
    <section className="garden-scan-panel">
      <div className="garden-scan-panel__head">
        <div>
          <span>3D Garden Twin</span>
          <strong>{summary ? `${summary.qualityScore}/100 kvalitet` : "Klar til første model"}</strong>
        </div>
        <Layers3 size={18} />
      </div>

      <div className="garden-scan-panel__metrics">
        <div><CheckCircle2 size={14} /><strong>{summary?.objectCount ?? 0}</strong><span>objekter</span></div>
        <div><ShieldCheck size={14} /><strong>{summary?.highConfidenceObjects ?? 0}</strong><span>bekræftet</span></div>
        <div><Activity size={14} /><strong>{depthModel?.captureReadiness.recommendedSeconds.join("-") ?? "45-90"}</strong><span>sek scan</span></div>
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
          <Layers3 size={14} /> Byg preview
        </button>
        <button type="button" onClick={onStartScan} disabled={!canStartScan || starting}>
          {starting ? <UploadCloud size={14} /> : <Play size={14} />} {starting ? "Klargør..." : scanButtonLabel}
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
            {anchorState ? `${anchorState.count}/${anchorState.recommended} ankre` : "Ingen ankre endnu"}
            {latest.processing_attempts ? ` · ${latest.processing_attempts} forsøg` : ""}
            {latest.error_detail ? ` · ${latest.error_detail}` : ""}
          </small>
          <em>{scanActionHint(latest.status)}</em>
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
