import { CheckCircle2, ExternalLink, Layers3, Mountain, Play, Ruler } from "lucide-react";
import type { GardenDepthModel } from "@/lib/gardenDepth";
import { depthPipelineStage, depthPipelineStageLabel, summarizeDepthModel } from "@/lib/gardenDepth";

type Props = {
  depthModel: GardenDepthModel | null;
  starting: boolean;
  canPreview: boolean;
  canStartBuild: boolean;
  buildButtonLabel: string;
  saveLaterLabel?: string;
  onBuildPreview: () => void;
  onStartBuild: () => void;
  onSaveLater?: () => void;
  onShowTwin: () => void;
  canSaveLater?: boolean;
};

/**
 * The Part 2 hand-off shown in the Havemåler sidebar. Replaces the old phone-scan
 * panel: Part 2 is now the in-browser 3D builder (DHM elevation + objects).
 */
export default function GardenBuilderHandoff({
  depthModel,
  starting,
  canPreview,
  canStartBuild,
  buildButtonLabel,
  saveLaterLabel,
  onBuildPreview,
  onStartBuild,
  onSaveLater,
  onShowTwin,
  canSaveLater = true,
}: Props) {
  const summary = depthModel ? summarizeDepthModel(depthModel) : null;
  const stage = depthPipelineStage(depthModel);
  const built = stage === "elevation_built";
  const lawnZones = depthModel?.terrain.lawnRings.length ?? 0;
  const reliefM = depthModel?.terrain.elevation?.stats.reliefM ?? null;

  return (
    <section className="garden-scan-panel">
      <div className="garden-scan-panel__head">
        <div>
          <span>3D Garden Twin</span>
          <strong>{summary ? `${summary.qualityScore}/100 ${built ? "kvalitet" : "preview"}` : "Klar til 3D-bygning"}</strong>
        </div>
        <Layers3 size={18} />
      </div>

      <div className="garden-scan-panel__metrics">
        <div><CheckCircle2 size={14} /><strong>{lawnZones}</strong><span>plæneflader</span></div>
        <div><Mountain size={14} /><strong>{reliefM != null ? `${reliefM.toFixed(1)}m` : built ? "fladt" : "—"}</strong><span>terrænfald</span></div>
        <div><Ruler size={14} /><strong>{summary?.objectCount ?? 0}</strong><span>objekter</span></div>
      </div>

      {depthModel && (
        <details className="garden-scan-readiness">
          <summary>
            <span>{depthPipelineStageLabel(stage)}</span>
            <b>Detaljer</b>
          </summary>
          <p>
            {depthModel.quality.reasons.join(" ")}{" "}
            {built
              ? "Bygget i 3D-byggeren med terræn og objekt-højder under truthful-confidence."
              : "Byg 3D-haven for at få rigtige højder, terrænfald og objekter fra Danmarks Højdemodel — ingen telefon nødvendig."}
          </p>
        </details>
      )}

      <div className="garden-scan-panel__actions garden-scan-panel__actions--four">
        <button type="button" onClick={onBuildPreview} disabled={!canPreview}>
          <Layers3 size={14} /> Flad preview
        </button>
        <button type="button" className="garden-scan-panel__scan-action" onClick={onStartBuild} disabled={!canStartBuild || starting}>
          <Play size={14} /> {starting ? "Klargør…" : buildButtonLabel}
        </button>
        {onSaveLater && (
          <button type="button" onClick={onSaveLater} disabled={!canSaveLater || starting}>
            <CheckCircle2 size={14} /> {saveLaterLabel ?? "Gem til senere"}
          </button>
        )}
        <button type="button" onClick={onShowTwin} disabled={!depthModel}>
          <ExternalLink size={14} /> Vis 3D
        </button>
      </div>
    </section>
  );
}
