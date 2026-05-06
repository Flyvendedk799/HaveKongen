import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Order = {
  id: string; created_at: string; total_dkk: number;
  status: string; shipping_status: string; user_id: string;
  tracking_number: string | null;
};

const STATUS = ["all", "pending", "paid", "packed", "shipped", "delivered", "cancelled"];

export default function AdminOrders() {
  const [rows, setRows] = useState<Order[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select("id,created_at,total_dkk,status,shipping_status,user_id,tracking_number")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) toast.error(error.message);
    setRows((data ?? []) as Order[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter((r) =>
    (status === "all" || r.status === status) &&
    (q === "" || r.id.toLowerCase().includes(q.toLowerCase()) || r.user_id.includes(q))
  ), [rows, q, status]);

  function exportCsv() {
    const header = ["id","created_at","total_dkk","status","shipping_status","user_id","tracking_number"];
    const lines = [header.join(",")].concat(
      filtered.map((r) => header.map((k) => JSON.stringify((r as any)[k] ?? "")).join(","))
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `orders-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const fmt = (n: number) => new Intl.NumberFormat("da-DK").format(n);
  const total = filtered.reduce((s, r) => s + r.total_dkk, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Ordrer</h1>
          <p className="text-muted-foreground">{filtered.length} ordrer · {fmt(total)} kr</p>
        </div>
        <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4" /> Eksporter CSV</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Søg ordre-ID eller bruger…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-3">Ordre</th>
                <th className="p-3">Dato</th>
                <th className="p-3 text-right">Beløb</th>
                <th className="p-3">Status</th>
                <th className="p-3">Forsendelse</th>
                <th className="p-3">Tracking</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Indlæser…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Ingen ordrer.</td></tr>
              ) : filtered.map((o) => (
                <tr key={o.id} className="border-t hover:bg-muted/30">
                  <td className="p-3">
                    <Link to={`/admin/orders/${o.id}`} className="font-medium hover:underline">
                      #{o.id.slice(0, 8).toUpperCase()}
                    </Link>
                  </td>
                  <td className="p-3 text-muted-foreground">{new Date(o.created_at).toLocaleString("da-DK")}</td>
                  <td className="p-3 text-right">{fmt(o.total_dkk)} kr</td>
                  <td className="p-3"><span className="text-xs px-2 py-0.5 bg-muted rounded">{o.status}</span></td>
                  <td className="p-3 text-muted-foreground">{o.shipping_status}</td>
                  <td className="p-3 font-mono text-xs">{o.tracking_number ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
