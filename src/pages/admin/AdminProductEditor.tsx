import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Trash2, Upload, Plus, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";
import type { MowerSpec } from "@/lib/mowerFit";

type Product = {
  id: string; name: string; slug: string; category: string;
  base_price_dkk: number; in_stock: boolean; featured: boolean;
  description: string | null; short_description: string | null;
  image_url: string | null; gradient: string | null; svg_art: string | null; meta: string | null;
  mower_specs: MowerSpec | null;
};
type Variant = {
  id: string; product_id: string; name: string; sku: string | null;
  price_dkk: number; in_stock: boolean;
  stock_qty: number; low_stock_threshold: number; track_inventory: boolean;
};
type Media = { id: string; product_id: string; url: string; alt: string | null; sort: number; is_primary: boolean };

function slugify(s: string) {
  return s.toLowerCase().trim()
    .replace(/[æå]/g, "a").replace(/ø/g, "o")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function AdminProductEditor() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [p, setP] = useState<Product | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    if (!id) return;
    const [{ data: prod }, { data: vs }, { data: ms }] = await Promise.all([
      supabase.from("products").select("*").eq("id", id).maybeSingle(),
      supabase.from("product_variants").select("*").eq("product_id", id).order("name"),
      supabase.from("product_media").select("*").eq("product_id", id).order("sort"),
    ]);
    // mower_specs is Json in the generated types; the shape is guaranteed by a
    // check constraint on the column, so narrow it here rather than defensively
    // parsing it in every consumer.
    setP(prod as unknown as Product | null);
    setVariants((vs ?? []) as Variant[]);
    setMedia((ms ?? []) as Media[]);
  }
  useEffect(() => { load(); }, [id]);

  function update<K extends keyof Product>(k: K, v: Product[K]) {
    setP((prev) => prev ? { ...prev, [k]: v } : prev);
  }

  async function save() {
    if (!p) return;
    if (!p.name.trim()) return toast.error("Navn er påkrævet");
    if (!p.slug.trim()) return toast.error("Slug er påkrævet");
    setSaving(true);
    const { error } = await supabase.from("products").update({
      name: p.name, slug: p.slug, category: p.category,
      base_price_dkk: p.base_price_dkk, in_stock: p.in_stock, featured: p.featured,
      description: p.description, short_description: p.short_description,
      image_url: p.image_url, gradient: p.gradient, svg_art: p.svg_art, meta: p.meta,
      mower_specs: (p.mower_specs ?? null) as unknown as Json,
    }).eq("id", p.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Gemt");
  }

  async function remove() {
    if (!p) return;
    if (!confirm("Slet dette produkt? Handlingen kan ikke fortrydes.")) return;
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Slettet");
    nav("/admin/products");
  }

  async function addVariant() {
    if (!p) return;
    const { error } = await supabase.from("product_variants").insert({
      product_id: p.id, name: "Ny variant", price_dkk: p.base_price_dkk,
    });
    if (error) return toast.error(error.message);
    load();
  }
  async function updateVariant(v: Variant, patch: Partial<Variant>) {
    const { error } = await supabase.from("product_variants").update(patch).eq("id", v.id);
    if (error) return toast.error(error.message);
    setVariants((prev) => prev.map((x) => x.id === v.id ? { ...x, ...patch } : x));
  }
  async function deleteVariant(v: Variant) {
    if (!confirm(`Slet variant "${v.name}"?`)) return;
    const { error } = await supabase.from("product_variants").delete().eq("id", v.id);
    if (error) return toast.error(error.message);
    setVariants((prev) => prev.filter((x) => x.id !== v.id));
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || !p) return;
    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop();
      const path = `${p.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("product-media").upload(path, file);
      if (upErr) { toast.error(upErr.message); continue; }
      const { data: pub } = supabase.storage.from("product-media").getPublicUrl(path);
      const isPrimary = media.length === 0;
      const { error: insErr } = await supabase.from("product_media").insert({
        product_id: p.id, url: pub.publicUrl, alt: p.name,
        sort: media.length, is_primary: isPrimary,
      });
      if (insErr) toast.error(insErr.message);
    }
    toast.success("Uploadet");
    load();
  }

  async function deleteMedia(m: Media) {
    if (!confirm("Slet billede?")) return;
    const { error } = await supabase.from("product_media").delete().eq("id", m.id);
    if (error) return toast.error(error.message);
    load();
  }

  async function setPrimary(m: Media) {
    if (!p) return;
    await supabase.from("product_media").update({ is_primary: false }).eq("product_id", p.id);
    await supabase.from("product_media").update({ is_primary: true }).eq("id", m.id);
    await supabase.from("products").update({ image_url: m.url }).eq("id", p.id);
    toast.success("Sat som primær");
    load();
  }

  if (!p) return <div className="p-6 text-muted-foreground">Indlæser…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={() => nav("/admin/products")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1">
            <ArrowLeft className="h-3 w-3" /> Tilbage
          </button>
          <h1 className="text-3xl font-semibold tracking-tight">{p.name || "Uden navn"}</h1>
          <p className="text-muted-foreground text-sm">/webshop/{p.slug}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="destructive" onClick={remove}><Trash2 className="h-4 w-4" /> Slet</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Gemmer…" : "Gem"}</Button>
        </div>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Detaljer</TabsTrigger>
          <TabsTrigger value="variants">Varianter ({variants.length})</TabsTrigger>
          <TabsTrigger value="media">Medier ({media.length})</TabsTrigger>
          <TabsTrigger value="seo">SEO & visuelt</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-4">
          <Card><CardContent className="pt-6 grid gap-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Navn</Label>
                <Input value={p.name} onChange={(e) => update("name", e.target.value)}
                  onBlur={() => { if (!p.slug) update("slug", slugify(p.name)); }} />
              </div>
              <div>
                <Label>Slug</Label>
                <Input value={p.slug} onChange={(e) => update("slug", slugify(e.target.value))} />
              </div>
              <div>
                <Label>Kategori</Label>
                <Input value={p.category} onChange={(e) => update("category", e.target.value)} />
              </div>
              <div>
                <Label>Pris (DKK)</Label>
                <Input type="number" value={p.base_price_dkk} onChange={(e) => update("base_price_dkk", Number(e.target.value))} />
              </div>
            </div>
            {/* Havemåler step 2 matches a measured garden against these numbers.
                Without them the product cannot be recommended at all, so the
                section shows up as soon as the category is a mower. */}
            {p.category === "robot" && (
              <MowerSpecFields
                specs={p.mower_specs}
                onChange={(next) => update("mower_specs", next as Product["mower_specs"])}
              />
            )}

            <div>
              <Label>Kort beskrivelse</Label>
              <Textarea rows={2} value={p.short_description ?? ""} onChange={(e) => update("short_description", e.target.value)} />
            </div>
            <div>
              <Label>Lang beskrivelse (markdown)</Label>
              <Textarea rows={8} value={p.description ?? ""} onChange={(e) => update("description", e.target.value)} />
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2">
                <Switch checked={p.in_stock} onCheckedChange={(v) => update("in_stock", v)} />
                <span className="text-sm">På lager</span>
              </label>
              <label className="flex items-center gap-2">
                <Switch checked={p.featured} onCheckedChange={(v) => update("featured", v)} />
                <span className="text-sm">Featured</span>
              </label>
            </div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="variants" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={addVariant}><Plus className="h-4 w-4" /> Tilføj variant</Button>
          </div>
          <Card><CardContent className="pt-6">
            {variants.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ingen varianter. Produktet sælges som hovedprodukt.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left border-b">
                    <th className="py-2">Navn</th><th>SKU</th><th>Pris</th><th>Lager</th>
                    <th>Track</th><th>Lav-grænse</th><th>På lager</th><th></th>
                  </tr></thead>
                  <tbody>
                    {variants.map((v) => (
                      <tr key={v.id} className="border-b">
                        <td className="py-2 pr-2"><Input value={v.name} onChange={(e) => updateVariant(v, { name: e.target.value })} /></td>
                        <td className="pr-2"><Input value={v.sku ?? ""} onChange={(e) => updateVariant(v, { sku: e.target.value })} /></td>
                        <td className="pr-2"><Input type="number" value={v.price_dkk} onChange={(e) => updateVariant(v, { price_dkk: Number(e.target.value) })} className="w-24" /></td>
                        <td className="pr-2"><Input type="number" value={v.stock_qty} onChange={(e) => updateVariant(v, { stock_qty: Number(e.target.value) })} className="w-20" /></td>
                        <td className="pr-2 text-center"><Switch checked={v.track_inventory} onCheckedChange={(c) => updateVariant(v, { track_inventory: c })} /></td>
                        <td className="pr-2"><Input type="number" value={v.low_stock_threshold} onChange={(e) => updateVariant(v, { low_stock_threshold: Number(e.target.value) })} className="w-20" /></td>
                        <td className="pr-2 text-center"><Switch checked={v.in_stock} onCheckedChange={(c) => updateVariant(v, { in_stock: c })} /></td>
                        <td><Button size="sm" variant="ghost" onClick={() => deleteVariant(v)}><Trash2 className="h-4 w-4" /></Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="media" className="mt-4 space-y-3">
          <div className="flex justify-end gap-2">
            <input ref={fileInput} type="file" multiple accept="image/*" hidden
              onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />
            <Button size="sm" onClick={() => fileInput.current?.click()}>
              <Upload className="h-4 w-4" /> Upload billeder
            </Button>
          </div>
          {media.length === 0 ? (
            <Card><CardContent className="pt-6 text-sm text-muted-foreground">Ingen billeder endnu.</CardContent></Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {media.map((m) => (
                <div key={m.id} className="relative group border rounded overflow-hidden bg-muted">
                  <img src={m.url} alt={m.alt ?? ""} className="w-full h-40 object-cover" />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-2">
                    {!m.is_primary && (
                      <Button size="sm" variant="secondary" onClick={() => setPrimary(m)}>Sæt primær</Button>
                    )}
                    <Button size="sm" variant="destructive" onClick={() => deleteMedia(m)}>Slet</Button>
                  </div>
                  {m.is_primary && (
                    <span className="absolute top-2 left-2 text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">Primær</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="seo" className="mt-4">
          <Card><CardContent className="pt-6 grid gap-4">
            <div>
              <Label>Meta beskrivelse (SEO)</Label>
              <Textarea rows={3} value={p.meta ?? ""} onChange={(e) => update("meta", e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">{(p.meta ?? "").length}/160 tegn</p>
            </div>
            <div>
              <Label>Hovedbillede URL (legacy)</Label>
              <Input value={p.image_url ?? ""} onChange={(e) => update("image_url", e.target.value)} />
            </div>
            <div>
              <Label>Gradient (CSS)</Label>
              <Input value={p.gradient ?? ""} onChange={(e) => update("gradient", e.target.value)} placeholder="linear-gradient(...)" />
            </div>
            <div>
              <Label>SVG art (inline)</Label>
              <Textarea rows={6} value={p.svg_art ?? ""} onChange={(e) => update("svg_art", e.target.value)} className="font-mono text-xs" />
            </div>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Robot mower capability, matched against a measured garden in Havemåler step 2.
 *
 * The three required numbers are what decide whether a machine can do a given
 * garden at all; the rest sharpen the wording of the recommendation. A spec
 * missing any of the three is rejected by a check constraint rather than
 * silently dropping the product out of the results.
 */
function MowerSpecFields({
  specs,
  onChange,
}: {
  specs: MowerSpec | null;
  onChange: (next: MowerSpec | null) => void;
}) {
  const enabled = specs != null;

  const set = (patch: Partial<MowerSpec>) =>
    onChange({ maxAreaM2: 500, maxSlopePct: 35, minPassageCm: 60, ...specs, ...patch });

  return (
    <Card className="p-4 space-y-4 border-dashed">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium">Robotklipper-specifikationer</h3>
          <p className="text-sm text-muted-foreground">
            Bruges til at anbefale modellen ud fra kundens opmålte have. Uden disse tal kan
            produktet ikke anbefales.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm shrink-0">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) =>
              onChange(e.target.checked ? { maxAreaM2: 500, maxSlopePct: 35, minPassageCm: 60 } : null)
            }
          />
          Aktiv
        </label>
      </div>

      {enabled && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label>Maks. areal (m²) *</Label>
              <Input
                type="number"
                min={1}
                value={specs.maxAreaM2}
                onChange={(e) => set({ maxAreaM2: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Maks. hældning (%) *</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={specs.maxSlopePct}
                onChange={(e) => set({ maxSlopePct: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground mt-1">Producentens tal, fx 35 for 35%.</p>
            </div>
            <div>
              <Label>Smalleste passage (cm) *</Label>
              <Input
                type="number"
                min={10}
                max={200}
                value={specs.minPassageCm}
                onChange={(e) => set({ minPassageCm: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground mt-1">Typisk 60-75 cm.</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label>Antal zoner</Label>
              <Input
                type="number"
                min={1}
                value={specs.zones ?? 1}
                onChange={(e) => set({ zones: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground mt-1">Adskilte græsflader den selv kan nå.</p>
            </div>
            <div>
              <Label>Klippebredde (cm)</Label>
              <Input
                type="number"
                min={1}
                value={specs.cuttingWidthCm ?? ""}
                onChange={(e) => set({ cuttingWidthCm: e.target.value ? Number(e.target.value) : undefined })}
              />
            </div>
            <div>
              <Label>Forhindringer</Label>
              <select
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={specs.obstacleAvoidance ?? "bump"}
                onChange={(e) => set({ obstacleAvoidance: e.target.value as MowerSpec["obstacleAvoidance"] })}
              >
                <option value="bump">Støder ind i dem</option>
                <option value="sensor">Sensorer</option>
                <option value="camera">Kamera</option>
                <option value="lidar">LiDAR</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(specs.needsGuideWire)}
              onChange={(e) => set({ needsGuideWire: e.target.checked })}
            />
            Kræver begrænsningskabel
          </label>
        </>
      )}
    </Card>
  );
}
