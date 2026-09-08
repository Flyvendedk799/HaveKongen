import { useEffect, useRef, useState } from "react";
import { Camera, Sparkles, Loader2, Droplets, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { invokeFunction } from "@/lib/shop";
import { fileToDataUrl } from "@/lib/plantPhotos";
import { toast } from "sonner";

type BedScanResult = {
  diagnosis: string;
  severity: "low" | "medium" | "high";
  treatment: string;
  symptoms?: string[];
};

export default function BedScanDialog({
  open, onOpenChange, zoneName, plantNames, onWaterNow,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  zoneName: string;
  plantNames: string[];
  onWaterNow?: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<BedScanResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!open) { setPreview(null); setResult(null); } }, [open]);

  async function handleFile(f: File) {
    const url = await fileToDataUrl(f);
    setPreview(url);
    setResult(null);
  }

  async function analyze() {
    if (!preview) return;
    setAnalyzing(true);
    try {
      const note = `Vurder DETTE BED som helhed (ikke en enkelt plante). Bedet hedder "${zoneName}"${plantNames.length ? ` og indeholder: ${plantNames.slice(0, 8).join(", ")}` : ""}. Bedøm: jordfugtighed (tør/passende/våd), planters vitalitet, om der skal vandes nu, og næste handling.`;
      const data = await invokeFunction<any>("plant-diagnose", { imageDataUrl: preview, note });
      if ((data as any)?.error) throw new Error((data as any).message ?? (data as any).error);
      setResult({
        diagnosis: (data as any).diagnosis ?? "Ingen tydelig konklusion",
        severity: (data as any).severity ?? "low",
        treatment: (data as any).treatment ?? "",
        symptoms: (data as any).symptoms ?? [],
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Scan-fejl");
    } finally { setAnalyzing(false); }
  }

  const sevColor = result?.severity === "high" ? "#c0392b" : result?.severity === "medium" ? "#a36b00" : "var(--forest-800)";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>📷 Scan {zoneName}</DialogTitle>
        </DialogHeader>

        {!preview ? (
          <div className="grid gap-3 py-2">
            <p className="text-sm text-muted-foreground">Tag et foto af bedet — AI vurderer fugt, vitalitet og næste handling.</p>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => camRef.current?.click()} variant="default">
                <Camera size={16} className="mr-2" /> Tag foto
              </Button>
              <Button onClick={() => fileRef.current?.click()} variant="outline">
                <Upload size={16} className="mr-2" /> Upload
              </Button>
            </div>
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden
              onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <input ref={fileRef} type="file" accept="image/*" hidden
              onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </div>
        ) : (
          <div className="grid gap-3">
            <img src={preview} alt="Bed" style={{ width: "100%", borderRadius: 12, maxHeight: 280, objectFit: "cover" }} />
            {!result && (
              <Button onClick={analyze} disabled={analyzing}>
                {analyzing ? <><Loader2 size={16} className="mr-2 animate-spin" />Analyserer…</> : <><Sparkles size={16} className="mr-2" />Vurder bed</>}
              </Button>
            )}
            {result && (
              <div className="rounded-lg border p-3" style={{ borderColor: "rgba(20,39,29,0.08)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs uppercase tracking-wide" style={{ color: sevColor, fontWeight: 600 }}>
                    {result.severity === "high" ? "Akut" : result.severity === "medium" ? "Bemærk" : "OK"}
                  </span>
                </div>
                <div className="font-medium mb-1.5">{result.diagnosis}</div>
                {result.treatment && <div className="text-sm text-muted-foreground mb-2">{result.treatment}</div>}
                {result.symptoms && result.symptoms.length > 0 && (
                  <ul className="text-xs text-muted-foreground list-disc pl-4">
                    {result.symptoms.slice(0, 4).map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {preview && <Button variant="ghost" onClick={() => { setPreview(null); setResult(null); }}>Nyt foto</Button>}
          {result && onWaterNow && (
            <Button onClick={() => { onWaterNow(); onOpenChange(false); }}>
              <Droplets size={14} className="mr-1.5" />Vand nu
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
