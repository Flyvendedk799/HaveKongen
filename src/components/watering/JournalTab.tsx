import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Loader2, Image as ImageIcon, NotebookPen, Sprout, Leaf, Bug, Trophy, Filter, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { uploadPlantPhoto } from "@/lib/plantPhotos";
import { toast } from "sonner";
import type { ZonePlant } from "./PlantChips";

export type JournalEntry = {
  id: string;
  user_id: string;
  garden_id: string | null;
  zone_id: string | null;
  plant_id: string | null;
  kind: string;
  caption: string | null;
  image_url: string | null;
  data: any;
  created_at: string;
};

type Zone = { id: string; name: string };

const KIND_META: Record<string, { label: string; icon: any; color: string }> = {
  photo: { label: "Foto", icon: ImageIcon, color: "#0ea5e9" },
  note: { label: "Notat", icon: NotebookPen, color: "#64748b" },
  harvest: { label: "Høst", icon: Trophy, color: "#ca8a04" },
  disease: { label: "Sygdom", icon: Bug, color: "#dc2626" },
  milestone: { label: "Milepæl", icon: Sprout, color: "#16a34a" },
  watering: { label: "Vanding", icon: Leaf, color: "#2563eb" },
};

export default function JournalTab({
  gardenId,
  zones,
  plantsByZone,
}: {
  gardenId: string;
  zones: Zone[];
  plantsByZone: Record<string, ZonePlant[]>;
}) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterKind, setFilterKind] = useState<string>("all");
  const [filterZone, setFilterZone] = useState<string>("all");
  const [composerOpen, setComposerOpen] = useState(false);

  // composer state
  const [kind, setKind] = useState("note");
  const [caption, setCaption] = useState("");
  const [zoneId, setZoneId] = useState<string>("none");
  const [plantId, setPlantId] = useState<string>("none");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const allPlants = useMemo(() => {
    const out: { id: string; name: string; zone_id: string | null }[] = [];
    for (const z of zones) {
      for (const p of plantsByZone[z.id] ?? []) {
        out.push({
          id: p.id,
          name: p.custom_name || p.name_da || p.plant_slug || "plante",
          zone_id: p.zone_id,
        });
      }
    }
    return out;
  }, [zones, plantsByZone]);

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("garden_journal")
      .select("*")
      .eq("garden_id", gardenId)
      .order("created_at", { ascending: false })
      .limit(200);
    setEntries((data ?? []) as JournalEntry[]);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id, gardenId]);

  const filtered = useMemo(() => {
    return entries.filter(e => {
      if (filterKind !== "all" && e.kind !== filterKind) return false;
      if (filterZone !== "all" && e.zone_id !== filterZone) return false;
      return true;
    });
  }, [entries, filterKind, filterZone]);

  const grouped = useMemo(() => {
    const buckets = new Map<string, JournalEntry[]>();
    for (const e of filtered) {
      const d = new Date(e.created_at);
      const key = weekKey(d);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(e);
    }
    return Array.from(buckets.entries());
  }, [filtered]);

  async function handlePhoto(file: File) {
    if (!user) return;
    setUploading(true);
    try {
      const url = await uploadPlantPhoto(user.id, file);
      setPhotoUrl(url);
      if (kind === "note") setKind("photo");
    } catch (e: any) {
      toast.error(e?.message ?? "Upload fejlede");
    } finally { setUploading(false); }
  }

  async function save() {
    if (!user) return;
    if (!caption.trim() && !photoUrl) {
      toast.error("Skriv en note eller tilføj et foto");
      return;
    }
    setSaving(true);
    const payload: any = {
      user_id: user.id,
      garden_id: gardenId,
      zone_id: zoneId === "none" ? null : zoneId,
      plant_id: plantId === "none" ? null : plantId,
      kind,
      caption: caption.trim() || null,
      image_url: photoUrl,
    };
    const { data, error } = await supabase.from("garden_journal").insert(payload).select().single();
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setEntries(prev => [data as JournalEntry, ...prev]);
    setComposerOpen(false);
    setCaption(""); setPhotoUrl(null); setPlantId("none"); setZoneId("none"); setKind("note");
    toast.success("Tilføjet til journalen");
  }

  async function remove(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id));
    await supabase.from("garden_journal").delete().eq("id", id);
  }

  return (
    <div className="grid gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Filter size={12} /> Filter:
        </div>
        <Select value={filterKind} onValueChange={setFilterKind}>
          <SelectTrigger className="h-9 w-[140px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle typer</SelectItem>
            {Object.entries(KIND_META).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterZone} onValueChange={setFilterZone}>
          <SelectTrigger className="h-9 w-[160px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle bede</SelectItem>
            {zones.map(z => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button size="sm" onClick={() => setComposerOpen(v => !v)}>
            <NotebookPen size={14} className="mr-1.5" />
            {composerOpen ? "Luk" : "Ny entry"}
          </Button>
        </div>
      </div>

      {/* Composer */}
      <AnimatePresence>
        {composerOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="water-card overflow-hidden"
            style={{ padding: 16 }}
          >
            <div className="grid gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(KIND_META).filter(([k]) => k !== "watering").map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={zoneId} onValueChange={(v) => { setZoneId(v); setPlantId("none"); }}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Bed" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Hele haven —</SelectItem>
                    {zones.map(z => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={plantId} onValueChange={setPlantId}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Plante" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Ingen plante —</SelectItem>
                    {allPlants
                      .filter(p => zoneId === "none" || p.zone_id === zoneId)
                      .map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <Textarea
                rows={3}
                placeholder="Hvad sker der i haven? (fx 'Første tomat moden!', 'Bladlus på rosen')"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />

              <div className="flex items-center gap-2 flex-wrap">
                <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
                  onChange={(e) => e.target.files?.[0] && handlePhoto(e.target.files[0])} />
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Camera size={14} className="mr-1.5" />}
                  {photoUrl ? "Skift foto" : "Foto"}
                </Button>
                {photoUrl && (
                  <div className="relative">
                    <img src={photoUrl} alt="" className="w-16 h-16 rounded-lg object-cover" />
                    <button onClick={() => setPhotoUrl(null)}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] flex items-center justify-center">×</button>
                  </div>
                )}
                <div className="ml-auto">
                  <Button size="sm" onClick={save} disabled={saving}>
                    {saving ? "Gemmer…" : "Gem entry"}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Timeline */}
      {loading ? (
        <div className="water-card text-center text-sm text-muted-foreground" style={{ padding: 24 }}>
          Henter journal…
        </div>
      ) : grouped.length === 0 ? (
        <div className="water-card text-center" style={{ padding: 40 }}>
          <NotebookPen size={32} className="mx-auto mb-3" style={{ color: "var(--forest-800)" }} />
          <h3 style={{ fontSize: 18, marginBottom: 6 }}>Tom journal</h3>
          <p style={{ color: "var(--ink-500)", fontSize: 13, marginBottom: 14 }}>
            Dokumentér din have med fotos, høster, sygdomme og milepæle.
          </p>
          <Button onClick={() => setComposerOpen(true)}>
            <NotebookPen size={14} className="mr-1.5" />Lav første entry
          </Button>
        </div>
      ) : (
        grouped.map(([wk, items]) => (
          <div key={wk} className="grid gap-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground sticky top-0 bg-[var(--paper)]/90 backdrop-blur px-1 py-1 rounded">
              {wk}
            </div>
            <div className="grid gap-2">
              {items.map(e => {
                const meta = KIND_META[e.kind] ?? KIND_META.note;
                const Icon = meta.icon;
                const zone = zones.find(z => z.id === e.zone_id);
                const plant = allPlants.find(p => p.id === e.plant_id);
                return (
                  <motion.div
                    key={e.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="water-card group relative"
                    style={{ padding: 14 }}
                  >
                    <div className="flex gap-3">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: meta.color + "15", color: meta.color }}>
                        <Icon size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2 flex-wrap">
                          <div className="text-xs text-muted-foreground">
                            <strong style={{ color: meta.color }}>{meta.label}</strong>
                            {zone && <> · {zone.name}</>}
                            {plant && <> · {plant.name}</>}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {new Date(e.created_at).toLocaleString("da-DK", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>
                        {e.caption && <p className="text-sm mt-1 whitespace-pre-wrap">{e.caption}</p>}
                        {e.image_url && (
                          <img src={e.image_url} alt=""
                            className="mt-2 rounded-lg max-h-72 object-cover"
                            style={{ width: "100%" }} />
                        )}
                      </div>
                      <button
                        onClick={() => remove(e.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-red-50 hover:text-red-600"
                        title="Slet"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function weekKey(d: Date) {
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff < 1) return "I dag";
  if (diff < 2) return "I går";
  if (diff < 7) return "Denne uge";
  if (diff < 14) return "Sidste uge";
  return d.toLocaleDateString("da-DK", { month: "long", year: sameYear ? undefined : "numeric" });
}

/** Helper: log auto journal entries (used elsewhere) */
export async function logJournal(input: {
  userId: string;
  gardenId: string;
  zoneId?: string | null;
  plantId?: string | null;
  kind: string;
  caption?: string;
  image_url?: string | null;
  data?: any;
}) {
  return await supabase.from("garden_journal").insert({
    user_id: input.userId,
    garden_id: input.gardenId,
    zone_id: input.zoneId ?? null,
    plant_id: input.plantId ?? null,
    kind: input.kind,
    caption: input.caption ?? null,
    image_url: input.image_url ?? null,
    data: input.data ?? {},
  });
}
