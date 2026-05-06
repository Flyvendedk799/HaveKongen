import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const STATUS = ["pending","paid","packed","shipped","delivered","cancelled","refunded"];
const SHIP = ["pending","preparing","shipped","delivered"];

export default function AdminOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!id) return;
    const { data: o } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
    if (!o) return;
    setOrder(o);
    const [{ data: it }, { data: pr }] = await Promise.all([
      supabase.from("order_items").select("*").eq("order_id", id),
      supabase.from("profiles").select("name, address, postal_code").eq("id", o.user_id).maybeSingle(),
    ]);
    setItems(it ?? []);
    setProfile(pr);
  }
  useEffect(() => { load(); }, [id]);

  function update(k: string, v: any) { setOrder((p: any) => ({ ...p, [k]: v })); }

  async function save() {
    setSaving(true);
    const { error } = await supabase.from("orders").update({
      status: order.status, shipping_status: order.shipping_status,
      tracking_number: order.tracking_number, notes: order.notes,
      refunded_at: order.status === "refunded" ? (order.refunded_at ?? new Date().toISOString()) : null,
    }).eq("id", order.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Gemt");
  }

  if (!order) return <div className="p-6 text-muted-foreground">Indlæser…</div>;

  const fmt = (n: number) => new Intl.NumberFormat("da-DK").format(n);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={() => nav("/admin/orders")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1">
            <ArrowLeft className="h-3 w-3" /> Tilbage
          </button>
          <h1 className="text-3xl font-semibold tracking-tight">Ordre #{order.id.slice(0, 8).toUpperCase()}</h1>
          <p className="text-muted-foreground text-sm">{new Date(order.created_at).toLocaleString("da-DK")}</p>
        </div>
        <Button onClick={save} disabled={saving}>{saving ? "Gemmer…" : "Gem"}</Button>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Varer ({items.length})</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground border-b">
                <th className="py-2">Vare</th><th>Antal</th><th className="text-right">Stk. pris</th><th className="text-right">Sum</th>
              </tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b">
                    <td className="py-2">{it.name}</td>
                    <td>{it.qty}</td>
                    <td className="text-right">{fmt(it.unit_price_dkk)} kr</td>
                    <td className="text-right font-medium">{fmt(it.qty * it.unit_price_dkk)} kr</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={3} className="pt-3 text-right font-medium">Total</td>
                  <td className="pt-3 text-right font-semibold">{fmt(order.total_dkk)} kr</td></tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Kunde</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div className="font-medium">{profile?.name ?? "Ukendt"}</div>
            <div className="text-muted-foreground">{profile?.address ?? "—"}</div>
            <div className="text-muted-foreground">{profile?.postal_code ?? ""}</div>
            <div className="text-xs text-muted-foreground pt-2 font-mono break-all">{order.user_id}</div>

            <div className="pt-3">
              <div className="font-medium mb-1">Leveringsadresse</div>
              <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                {JSON.stringify(order.shipping_address ?? {}, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Status & forsendelse</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Status</Label>
            <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={order.status} onChange={(e) => update("status", e.target.value)}>
              {STATUS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <Label>Forsendelse</Label>
            <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={order.shipping_status} onChange={(e) => update("shipping_status", e.target.value)}>
              {SHIP.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <Label>Tracking-nummer</Label>
            <Input value={order.tracking_number ?? ""} onChange={(e) => update("tracking_number", e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>Interne noter</Label>
            <Textarea rows={3} value={order.notes ?? ""} onChange={(e) => update("notes", e.target.value)} />
          </div>
          {order.refunded_at && (
            <div className="md:col-span-2 text-sm text-destructive">
              Refunderet {new Date(order.refunded_at).toLocaleString("da-DK")}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
