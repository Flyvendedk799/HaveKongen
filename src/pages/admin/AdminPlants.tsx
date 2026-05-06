import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Plant = {
  slug: string; name_da: string; latin: string | null;
  category: string | null; sun: string | null; water_need: string | null;
  image_url: string | null;
};

export default function AdminPlants() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Plant[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("plants_catalog")
      .select("slug,name_da,latin,category,sun,water_need,image_url")
      .order("name_da");
    if (error) toast.error(error.message);
    setRows((data ?? []) as Plant[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(
    () => rows.filter((r) =>
      q === "" ||
      r.name_da.toLowerCase().includes(q.toLowerCase()) ||
      (r.latin ?? "").toLowerCase().includes(q.toLowerCase())
    ), [rows, q],
  );

  async function createNew() {
    const slug = `ny-plante-${Date.now().toString(36)}`;
    const { error } = await supabase.from("plants_catalog").insert({
      slug, name_da: "Ny plante",
    });
    if (error) return toast.error(error.message);
    nav(`/admin/plants/${slug}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Plante-katalog</h1>
          <p className="text-muted-foreground">{rows.length} planter</p>
        </div>
        <Button onClick={createNew}><Plus className="h-4 w-4" /> Ny plante</Button>
      </div>

      <div className="relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Søg navn eller latin…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-3">Navn</th>
                <th className="p-3">Latin</th>
                <th className="p-3">Kategori</th>
                <th className="p-3">Sol</th>
                <th className="p-3">Vand</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Indlæser…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Ingen resultater.</td></tr>
              ) : filtered.map((p) => (
                <tr key={p.slug} className="border-t hover:bg-muted/30">
                  <td className="p-3">
                    <Link to={`/admin/plants/${p.slug}`} className="font-medium hover:underline">{p.name_da}</Link>
                    <div className="text-xs text-muted-foreground">/{p.slug}</div>
                  </td>
                  <td className="p-3 italic text-muted-foreground">{p.latin ?? "—"}</td>
                  <td className="p-3">{p.category ?? "—"}</td>
                  <td className="p-3">{p.sun ?? "—"}</td>
                  <td className="p-3">{p.water_need ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
