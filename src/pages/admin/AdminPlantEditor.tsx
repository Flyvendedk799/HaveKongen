import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Plant = {
  slug: string; name_da: string; latin: string | null; category: string | null;
  sun: string | null; water_need: string | null; description: string | null;
  image_url: string | null; sow_months: number[] | null; harvest_months: number[] | null;
};

const MONTHS = ["jan","feb","mar","apr","maj","jun","jul","aug","sep","okt","nov","dec"];

export default function AdminPlantEditor() {
  const { slug } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const [p, setP] = useState<Plant | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      const { data } = await supabase.from("plants_catalog").select("*").eq("slug", slug).maybeSingle();
      setP(data as Plant | null);
    })();
  }, [slug]);

  function update<K extends keyof Plant>(k: K, v: Plant[K]) {
    setP((prev) => prev ? { ...prev, [k]: v } : prev);
  }
  function toggleMonth(field: "sow_months" | "harvest_months", m: number) {
    if (!p) return;
    const cur = (p[field] ?? []) as number[];
    const next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m].sort((a, b) => a - b);
    update(field, next as any);
  }

  async function save() {
    if (!p) return;
    if (!p.name_da.trim()) return toast.error("Navn er påkrævet");
    setSaving(true);
    const { error } = await supabase.from("plants_catalog").update({
      name_da: p.name_da, latin: p.latin, category: p.category,
      sun: p.sun, water_need: p.water_need, description: p.description,
      image_url: p.image_url, sow_months: p.sow_months, harvest_months: p.harvest_months,
    }).eq("slug", p.slug);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Gemt");
  }

  async function remove() {
    if (!p) return;
    if (!confirm("Slet plante?")) return;
    const { error } = await supabase.from("plants_catalog").delete().eq("slug", p.slug);
    if (error) return toast.error(error.message);
    nav("/admin/plants");
  }

  if (!p) return <div className="p-6 text-muted-foreground">Indlæser…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={() => nav("/admin/plants")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1">
            <ArrowLeft className="h-3 w-3" /> Tilbage
          </button>
          <h1 className="text-3xl font-semibold tracking-tight">{p.name_da}</h1>
          <p className="text-muted-foreground text-sm">/{p.slug}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="destructive" onClick={remove}><Trash2 className="h-4 w-4" /> Slet</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Gemmer…" : "Gem"}</Button>
        </div>
      </div>

      <Card><CardContent className="pt-6 grid gap-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Navn (dansk)</Label>
            <Input value={p.name_da} onChange={(e) => update("name_da", e.target.value)} />
          </div>
          <div>
            <Label>Latin</Label>
            <Input value={p.latin ?? ""} onChange={(e) => update("latin", e.target.value)} />
          </div>
          <div>
            <Label>Kategori</Label>
            <Input value={p.category ?? ""} onChange={(e) => update("category", e.target.value)} placeholder="Grøntsag, krydderurt, blomst…" />
          </div>
          <div>
            <Label>Billede URL</Label>
            <Input value={p.image_url ?? ""} onChange={(e) => update("image_url", e.target.value)} />
          </div>
          <div>
            <Label>Sol</Label>
            <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={p.sun ?? ""} onChange={(e) => update("sun", e.target.value || null)}>
              <option value="">—</option>
              <option value="sol">Sol</option>
              <option value="halvskygge">Halvskygge</option>
              <option value="skygge">Skygge</option>
            </select>
          </div>
          <div>
            <Label>Vandbehov</Label>
            <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={p.water_need ?? ""} onChange={(e) => update("water_need", e.target.value || null)}>
              <option value="">—</option>
              <option value="lavt">Lavt</option>
              <option value="medium">Medium</option>
              <option value="højt">Højt</option>
            </select>
          </div>
        </div>

        <div>
          <Label>Beskrivelse</Label>
          <Textarea rows={5} value={p.description ?? ""} onChange={(e) => update("description", e.target.value)} />
        </div>

        <div>
          <Label>Så-måneder</Label>
          <div className="flex flex-wrap gap-1 mt-1">
            {MONTHS.map((m, i) => {
              const on = (p.sow_months ?? []).includes(i + 1);
              return (
                <button key={m} type="button" onClick={() => toggleMonth("sow_months", i + 1)}
                  className={`px-3 py-1 text-xs rounded border ${on ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>
                  {m}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <Label>Høst-måneder</Label>
          <div className="flex flex-wrap gap-1 mt-1">
            {MONTHS.map((m, i) => {
              const on = (p.harvest_months ?? []).includes(i + 1);
              return (
                <button key={m} type="button" onClick={() => toggleMonth("harvest_months", i + 1)}
                  className={`px-3 py-1 text-xs rounded border ${on ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>
                  {m}
                </button>
              );
            })}
          </div>
        </div>
      </CardContent></Card>
    </div>
  );
}
