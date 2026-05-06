import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

type Row = {
  id: string; entity: string; entity_id: string | null;
  action: string; actor_id: string | null; created_at: string; diff: any;
};

const ACTION_VARIANT: Record<string, any> = { INSERT: "default", UPDATE: "secondary", DELETE: "destructive" };

export default function AdminAudit() {
  const [rows, setRows] = useState<Row[]>([]);
  const [entity, setEntity] = useState("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      let query = supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(300);
      if (entity !== "all") query = query.eq("entity", entity);
      const { data } = await query;
      setRows((data ?? []) as Row[]);
      setLoading(false);
    })();
  }, [entity]);

  const filtered = rows.filter((r) =>
    !q || r.entity_id?.includes(q) || JSON.stringify(r.diff).toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">Seneste 300 hændelser i CMS-tabeller.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Select value={entity} onValueChange={setEntity}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle entities</SelectItem>
            <SelectItem value="products">products</SelectItem>
            <SelectItem value="product_variants">product_variants</SelectItem>
            <SelectItem value="plants_catalog">plants_catalog</SelectItem>
            <SelectItem value="orders">orders</SelectItem>
            <SelectItem value="content_blocks">content_blocks</SelectItem>
          </SelectContent>
        </Select>
        <Input className="max-w-sm" placeholder="Søg i diff / id…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Indlæser…</p>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">Ingen hændelser.</Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <Collapsible key={r.id}>
              <Card className="p-3">
                <CollapsibleTrigger className="flex items-center gap-3 w-full text-left">
                  <Badge variant={ACTION_VARIANT[r.action] ?? "outline"}>{r.action}</Badge>
                  <span className="font-mono text-xs">{r.entity}</span>
                  <span className="font-mono text-xs text-muted-foreground truncate flex-1">
                    {r.entity_id?.slice(0, 8)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("da-DK")}
                  </span>
                  <ChevronDown className="h-4 w-4" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-3 text-xs bg-muted p-3 rounded overflow-auto max-h-96">
                    {JSON.stringify(r.diff, null, 2)}
                  </pre>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          ))}
        </div>
      )}
    </div>
  );
}
