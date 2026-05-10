import { useEffect, useState } from "react";
import { Droplets, Sun, Calendar as CalIcon, Trash2, Save, ArrowRightLeft, Leaf } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ZonePlant } from "./PlantChips";

type CatalogDetail = {
  slug: string;
  name_da: string;
  latin: string | null;
  category: string | null;
  water_need: string | null;
  sun: string | null;
  description: string | null;
  sow_months: number[] | null;
  harvest_months: number[] | null;
  companion_plants: string[] | null;
  frost_risk: string | null;
  image_url: string | null;
};

const MONTHS = ["jan","feb","mar","apr","maj","jun","jul","aug","sep","okt","nov","dec"];

export default function PlantDetailSheet({
  plant, zoneName, zones, onOpenChange, onUpdated, onRemoved, onMoved,
}: {
  plant: (ZonePlant & { planted_at?: string | null; notes?: string | null }) | null;
  zoneName: string;
  zones: { id: string; name: string }[];
  onOpenChange: (v: boolean) => void;
  onUpdated: (id: string, patch: { qty?: number; custom_name?: string | null; planted_at?: string | null; notes?: string | null }) => void;
  onRemoved: (id: string) => void;
  onMoved: (id: string, newZoneId: string, newZoneName: string) => void;
}) {
  const [detail, setDetail] = useState<CatalogDetail | null>(null);
  const [qty, setQty] = useState(1);
  const [planted, setPlanted] = useState("");
  const [notes, setNotes] = useState("");
  const [name, setName] = useState("");
  const [moveTo, setMoveTo] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!plant) return;
    setQty(plant.qty);
    setPlanted(plant.planted_at?.slice(0, 10) ?? "");
    setNotes(plant.notes ?? "");
    setName(plant.custom_name ?? "");
    setMoveTo("");
    setDetail(null);
    if (plant.plant_slug) {
      supabase.from("plants_catalog")
        .select("slug,name_da,latin,category,water_need,sun,description,sow_months,harvest_months,companion_plants,frost_risk,image_url")
        .eq("slug", plant.plant_slug).maybeSingle()
        .then(({ data }) => setDetail(data as any));
    }
  }, [plant?.id]);

  if (!plant) return null;
  const displayName = plant.custom_name || plant.name_da || detail?.name_da || plant.plant_slug || "Plante";

  async function save() {
    setSaving(true);
    const patch: any = {
      qty,
      custom_name: name.trim() ? name.trim() : (plant!.plant_slug ? null : displayName),
      planted_at: planted || null,
      notes: notes || null,
    };
    const { error } = await supabase.from("user_plants").update(patch).eq("id", plant!.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    onUpdated(plant!.id, patch);
    toast.success("Gemt");
  }

  async function move() {
    if (!moveTo) return;
    const { error } = await supabase.from("user_plants").update({ zone_id: moveTo }).eq("id", plant!.id);
    if (error) { toast.error(error.message); return; }
    const z = zones.find(z => z.id === moveTo);
    onMoved(plant!.id, moveTo, z?.name ?? "");
    toast.success(`Flyttet til ${z?.name}`);
    onOpenChange(false);
  }

  async function remove() {
    const { error } = await supabase.from("user_plants").delete().eq("id", plant!.id);
    if (error) { toast.error(error.message); return; }
    onRemoved(plant!.id);
    toast.success("Plante fjernet");
    onOpenChange(false);
  }

  return (
    <Sheet open={!!plant} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Leaf size={18} /> {displayName}
          </SheetTitle>
          <div className="text-xs text-muted-foreground">
            i {zoneName}{detail?.latin ? ` · ${detail.latin}` : ""}
          </div>
        </SheetHeader>

        {detail && (
          <div className="mt-4 grid gap-2 text-sm">
            {detail.description && <p className="text-muted-foreground">{detail.description}</p>}
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Info icon={<Droplets size={14} />} label="Vandbehov" value={waterLabel(detail.water_need)} />
              <Info icon={<Sun size={14} />} label="Sol" value={sunLabel(detail.sun)} />
              {detail.frost_risk && <Info icon={<CalIcon size={14} />} label="Frost" value={detail.frost_risk} />}
              {detail.category && <Info icon={<Leaf size={14} />} label="Kategori" value={detail.category} />}
            </div>
            {(detail.sow_months?.length || detail.harvest_months?.length) ? (
              <div className="mt-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Årshjul</div>
                <div className="grid grid-cols-12 gap-0.5">
                  {MONTHS.map((m, i) => {
                    const sow = detail.sow_months?.includes(i + 1);
                    const harv = detail.harvest_months?.includes(i + 1);
                    return (
                      <div key={m} title={`${m}${sow ? " · så" : ""}${harv ? " · høst" : ""}`}
                        className="text-[9px] text-center rounded py-1"
                        style={{
                          background: sow && harv ? "linear-gradient(90deg,#86efac,#fde68a)"
                            : sow ? "#86efac" : harv ? "#fde68a" : "rgba(20,39,29,0.06)",
                          color: "var(--ink-900)",
                        }}>{m}</div>
                    );
                  })}
                </div>
                <div className="flex gap-3 mt-1.5 text-[10px] text-muted-foreground">
                  <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: "#86efac" }} />så</span>
                  <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: "#fde68a" }} />høst</span>
                </div>
              </div>
            ) : null}
            {detail.companion_plants && detail.companion_plants.length > 0 && (
              <div className="mt-2 text-xs">
                <span className="text-muted-foreground">Trives med: </span>{detail.companion_plants.join(", ")}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 grid gap-3 border-t pt-4">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Detaljer i din have</div>
          <Field label="Eget navn">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder={displayName} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Antal">
              <Input type="number" min={1} value={qty} onChange={e => setQty(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
            <Field label="Plantet">
              <Input type="date" value={planted} onChange={e => setPlanted(e.target.value)} />
            </Field>
          </div>
          <Field label="Noter">
            <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="fx hvor i bedet, sorter, særlige behov…" />
          </Field>
        </div>

        {zones.length > 1 && (
          <div className="mt-4 grid gap-2 border-t pt-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Flyt til andet bed</div>
            <div className="flex gap-2">
              <Select value={moveTo} onValueChange={setMoveTo}>
                <SelectTrigger><SelectValue placeholder="Vælg bed…" /></SelectTrigger>
                <SelectContent>
                  {zones.filter(z => z.id !== plant.zone_id).map(z => (
                    <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" disabled={!moveTo} onClick={move}>
                <ArrowRightLeft size={14} className="mr-1" />Flyt
              </Button>
            </div>
          </div>
        )}

        <div className="mt-6 flex gap-2">
          <Button onClick={save} disabled={saving} className="flex-1">
            <Save size={14} className="mr-1.5" />{saving ? "Gemmer…" : "Gem"}
          </Button>
          <Button variant="outline" onClick={remove}>
            <Trash2 size={14} />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg p-2.5" style={{ background: "rgba(20,39,29,0.05)" }}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">{icon}{label}</div>
      <div className="text-sm font-medium mt-0.5">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function waterLabel(w: string | null | undefined) {
  if (w === "high") return "Højt 💧💧💧";
  if (w === "low") return "Lavt 💧";
  if (w === "medium") return "Middel 💧💧";
  return "—";
}
function sunLabel(s: string | null | undefined) {
  if (s === "sun") return "Fuld sol";
  if (s === "shade") return "Skygge";
  if (s === "part") return "Delvis sol";
  return s || "—";
}
