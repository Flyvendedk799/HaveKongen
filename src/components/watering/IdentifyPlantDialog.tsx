import { useEffect, useState } from "react";
import { Camera, Sparkles, Upload, Loader2, Check, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fileToDataUrl, uploadPlantPhoto } from "@/lib/plantPhotos";
import { toast } from "sonner";

type Zone = { id: string; name: string; sun_exposure?: string | null };

type IdResult = {
  name_da: string;
  latin?: string;
  category?: string;
  confidence: "high" | "medium" | "low";
  candidate_slugs?: string[];
  care_tip: string;
  water_need?: "low" | "medium" | "high";
  sun?: "sun" | "part" | "shade";
};

export default function IdentifyPlantDialog({
  open, onOpenChange, zones, defaultZoneId, onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  zones: Zone[];
  defaultZoneId?: string | null;
  onAdded: () => void;
}) {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<IdResult | null>(null);
  const [matchedSlug, setMatchedSlug] = useState<string | null>(null);
  const [zoneId, setZoneId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) { setFile(null); setPreview(null); setResult(null); setMatchedSlug(null); setZoneId(defaultZoneId ?? zones[0]?.id ?? ""); }
    else setZoneId(defaultZoneId ?? zones[0]?.id ?? "");
  }, [open, defaultZoneId, zones]);

  async function handleFile(f: File) {
    setFile(f);
    const url = await fileToDataUrl(f);
    setPreview(url);
    setResult(null); setMatchedSlug(null);
  }

  async function identify() {
    if (!preview) return;
    setAnalyzing(true);
    try {
      // Send a small subset of catalog to help slug matching
      const { data: cat } = await supabase.from("plants_catalog").select("slug,name_da,latin").limit(300);
      const { data, error } = await supabase.functions.invoke("identify-plant", {
        body: { image: preview, catalog: cat ?? [] },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const r = data as IdResult;
      setResult(r);
      // Pick first candidate slug if exists in catalog
      if (r.candidate_slugs && r.candidate_slugs.length > 0 && cat) {
        const exists = cat.find(c => c.slug === r.candidate_slugs![0]);
        if (exists) setMatchedSlug(exists.slug);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Kunne ikke identificere");
    } finally { setAnalyzing(false); }
  }

  async function addToGarden() {
    if (!user || !file || !result || !zoneId) return;
    setSaving(true);
    try {
      const url = await uploadPlantPhoto(user.id, file);
      const z = zones.find(z => z.id === zoneId);
      // Find garden_id via zone
      const { data: zoneRow } = await supabase.from("garden_zones").select("garden_id").eq("id", zoneId).maybeSingle();
      const gardenId = zoneRow?.garden_id;
      if (!gardenId) throw new Error("Bed uden have");
      const { error } = await supabase.from("user_plants").insert({
        user_id: user.id,
        garden_id: gardenId,
        zone_id: zoneId,
        plant_slug: matchedSlug,
        custom_name: matchedSlug ? null : result.name_da,
        qty: 1,
        image_url: url,
        notes: result.care_tip,
      });
      if (error) throw error;
      toast.success(`${result.name_da} tilføjet til ${z?.name}`);
      onAdded();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Kunne ikke tilføje");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles size={18} /> Identificér plante med AI</DialogTitle>
        </DialogHeader>

        {!preview ? (
          <label className="cursor-pointer block">
            <input type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <div className="rounded-2xl border-2 border-dashed flex flex-col items-center justify-center text-center p-10 transition-colors hover:bg-muted/40"
              style={{ borderColor: "rgba(20,39,29,0.2)" }}>
              <Camera size={32} className="text-muted-foreground mb-2" />
              <div className="font-medium">Tag et billede eller upload</div>
              <div className="text-xs text-muted-foreground mt-1">AI identificerer planten og foreslår pleje</div>
            </div>
          </label>
        ) : (
          <div className="grid gap-3">
            <div className="relative rounded-xl overflow-hidden" style={{ aspectRatio: "4/3", background: "#000" }}>
              <img src={preview} alt="Plante" className="w-full h-full object-cover" />
              <button onClick={() => { setPreview(null); setFile(null); setResult(null); }}
                className="absolute top-2 right-2 rounded-full p-1.5 bg-black/50 text-white">
                <X size={14} />
              </button>
            </div>

            {!result && (
              <Button onClick={identify} disabled={analyzing} className="w-full">
                {analyzing ? <><Loader2 size={14} className="mr-1.5 animate-spin" />Analyserer billede…</> : <><Sparkles size={14} className="mr-1.5" />Identificér med AI</>}
              </Button>
            )}

            {result && (
              <div className="rounded-xl p-4 grid gap-2" style={{ background: "rgba(20,39,29,0.05)" }}>
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <div className="text-lg font-semibold">{result.name_da}</div>
                    {result.latin && <div className="text-xs text-muted-foreground italic">{result.latin}</div>}
                  </div>
                  <ConfidenceBadge level={result.confidence} />
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {result.category && <Tag>{result.category}</Tag>}
                  {result.water_need && <Tag>💧 {result.water_need}</Tag>}
                  {result.sun && <Tag>☀ {result.sun === "sun" ? "fuld sol" : result.sun === "shade" ? "skygge" : "delvis"}</Tag>}
                  {matchedSlug && <Tag>✓ i katalog</Tag>}
                </div>
                <p className="text-sm">{result.care_tip}</p>

                <div className="grid gap-1.5 mt-2">
                  <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Tilføj til bed</label>
                  <Select value={zoneId} onValueChange={setZoneId}>
                    <SelectTrigger><SelectValue placeholder="Vælg bed" /></SelectTrigger>
                    <SelectContent>
                      {zones.map(z => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Luk</Button>
          {result && (
            <Button onClick={addToGarden} disabled={saving || !zoneId}>
              {saving ? <><Loader2 size={14} className="mr-1.5 animate-spin" />Gemmer…</> : <><Check size={14} className="mr-1.5" />Tilføj til min have</>}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  const map = { high: ["#22c55e", "Høj sikkerhed"], medium: ["#f59e0b", "Middel"], low: ["#ef4444", "Lav — tjek selv"] } as const;
  const [color, label] = map[level];
  return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: color + "20", color }}>{label}</span>;
}
function Tag({ children }: { children: React.ReactNode }) {
  return <span className="px-2 py-0.5 rounded-full bg-white text-[11px]" style={{ border: "1px solid rgba(20,39,29,0.1)" }}>{children}</span>;
}
