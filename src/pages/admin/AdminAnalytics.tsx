import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";

const STATUS_COLORS: Record<string, string> = {
  pending: "hsl(var(--muted-foreground))",
  paid: "hsl(var(--primary))",
  packed: "hsl(var(--accent))",
  shipped: "hsl(var(--chart-3, var(--primary)))",
  delivered: "hsl(var(--chart-2, var(--primary)))",
  refunded: "hsl(var(--destructive))",
};

export default function AdminAnalytics() {
  const [revenue, setRevenue] = useState<{ day: string; total: number }[]>([]);
  const [topProducts, setTopProducts] = useState<{ name: string; qty: number }[]>([]);
  const [statusBreakdown, setStatusBreakdown] = useState<{ status: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 90 * 86400000).toISOString();

      const [{ data: orders }, { data: items }] = await Promise.all([
        supabase.from("orders").select("created_at, total_dkk, status").gte("created_at", since),
        supabase.from("order_items").select("name, qty").limit(5000),
      ]);

      const byDay = new Map<string, number>();
      (orders ?? []).forEach((o: any) => {
        if (o.status === "refunded") return;
        const d = new Date(o.created_at).toISOString().slice(0, 10);
        byDay.set(d, (byDay.get(d) ?? 0) + (o.total_dkk ?? 0));
      });
      const days: { day: string; total: number }[] = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        days.push({ day: d.slice(5), total: Math.round((byDay.get(d) ?? 0) / 100) });
      }
      setRevenue(days);

      const byName = new Map<string, number>();
      (items ?? []).forEach((it: any) => byName.set(it.name, (byName.get(it.name) ?? 0) + (it.qty ?? 0)));
      setTopProducts([...byName.entries()]
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty).slice(0, 8));

      const byStatus = new Map<string, number>();
      (orders ?? []).forEach((o: any) => byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1));
      setStatusBreakdown([...byStatus.entries()].map(([status, count]) => ({ status, count })));

      setLoading(false);
    })();
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Indlæser…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Analyse</h1>
        <p className="text-sm text-muted-foreground">Sidste 30/90 dage.</p>
      </div>

      <Card className="p-4">
        <h2 className="font-medium mb-3">Omsætning – 30 dage (DKK)</h2>
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={revenue}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" />
              <YAxis stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
              <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-4">
          <h2 className="font-medium mb-3">Top produkter (antal solgt)</h2>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={topProducts} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" />
                <YAxis type="category" dataKey="name" width={120} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Bar dataKey="qty" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="font-medium mb-3">Ordre-status (90 dage)</h2>
          <div className="h-72">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={statusBreakdown} dataKey="count" nameKey="status" innerRadius={50} outerRadius={90}>
                  {statusBreakdown.map((s) => (
                    <Cell key={s.status} fill={STATUS_COLORS[s.status] ?? "hsl(var(--muted))"} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}
