import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { formatOere } from "@/lib/money";
import { toast } from "sonner";

type Code = Tables<"discount_codes">;

type Draft = {
  code: string;
  kind: "percent" | "fixed" | "free_shipping";
  value: string;
  description: string;
  min_subtotal_kr: string;
  category: string;
  max_redemptions: string;
  per_user_limit: string;
  ends_at: string;
};

const EMPTY: Draft = {
  code: "",
  kind: "percent",
  value: "10",
  description: "",
  min_subtotal_kr: "0",
  category: "",
  max_redemptions: "",
  per_user_limit: "1",
  ends_at: "",
};

const CATEGORIES = [
  { value: "", label: "Hele kurven" },
  { value: "froe", label: "Frø & planter" },
  { value: "jord", label: "Jord & gødning" },
  { value: "robot", label: "Robotplæneklippere" },
  { value: "vanding", label: "Vanding" },
];

/**
 * Discount codes. The table has no public read policy — codes are validated
 * server-side by quote_cart — so this page is the only way to see them, and
 * only for admins.
 */
export default function AdminDiscounts() {
  const [rows, setRows] = useState<Code[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("discount_codes").select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    const code = draft.code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
      toast.error("Koden skal være 3-32 tegn: A-Z, 0-9, bindestreg eller understreg.");
      return;
    }
    const numericValue = Number(draft.value.replace(",", "."));
    if (draft.kind === "percent" && !(numericValue > 0 && numericValue <= 100)) {
      toast.error("En procentrabat skal være mellem 1 og 100.");
      return;
    }
    if (draft.kind === "fixed" && !(numericValue > 0)) {
      toast.error("Et fast beløb skal være større end 0.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("discount_codes").insert({
      code,
      kind: draft.kind,
      // Percent is stored as a percentage; a fixed amount is entered in kroner
      // and stored in øre, matching every other computed amount in the schema.
      value: draft.kind === "fixed" ? Math.round(numericValue * 100) : draft.kind === "percent" ? numericValue : 0,
      description: draft.description.trim() || null,
      min_subtotal_oere: Math.round(Number(draft.min_subtotal_kr.replace(",", ".") || 0) * 100),
      category: draft.category || null,
      max_redemptions: draft.max_redemptions ? Number(draft.max_redemptions) : null,
      per_user_limit: Number(draft.per_user_limit || 1),
      ends_at: draft.ends_at ? new Date(draft.ends_at).toISOString() : null,
    });
    setSaving(false);

    if (error) {
      toast.error(error.message.includes("duplicate") ? "Koden findes allerede." : error.message);
      return;
    }
    toast.success(`${code} oprettet`);
    setDraft(EMPTY);
    setCreating(false);
    void load();
  }

  async function toggleActive(code: Code) {
    const { error } = await supabase.from("discount_codes").update({ active: !code.active }).eq("code", code.code);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((prev) => prev.map((r) => (r.code === code.code ? { ...r, active: !r.active } : r)));
  }

  const describe = (c: Code) => {
    if (c.kind === "percent") return `${c.value}%`;
    if (c.kind === "fixed") return formatOere(Number(c.value));
    return "Gratis fragt";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Rabatkoder</h1>
          <p className="text-muted-foreground">{rows.length} koder · valideres server-side i kassen</p>
        </div>
        <Button onClick={() => setCreating((v) => !v)}>
          <Plus className="h-4 w-4" /> Ny kode
        </Button>
      </div>

      {creating && (
        <Card className="p-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Kode *</Label>
              <Input
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                placeholder="FORAAR26"
              />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as Draft["kind"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Procent af kurven</SelectItem>
                  <SelectItem value="fixed">Fast beløb</SelectItem>
                  <SelectItem value="free_shipping">Gratis fragt</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {draft.kind !== "free_shipping" && (
              <div>
                <Label>{draft.kind === "percent" ? "Procent" : "Beløb (kr)"}</Label>
                <Input value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} inputMode="decimal" />
              </div>
            )}
            <div>
              <Label>Minimumskøb (kr)</Label>
              <Input
                value={draft.min_subtotal_kr}
                onChange={(e) => setDraft({ ...draft, min_subtotal_kr: e.target.value })}
                inputMode="decimal"
              />
            </div>
            <div>
              <Label>Gælder for</Label>
              <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c.value || "all"} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Maks. antal brug (tomt = ubegrænset)</Label>
              <Input
                value={draft.max_redemptions}
                onChange={(e) => setDraft({ ...draft, max_redemptions: e.target.value })}
                inputMode="numeric"
              />
            </div>
            <div>
              <Label>Pr. kunde</Label>
              <Input
                value={draft.per_user_limit}
                onChange={(e) => setDraft({ ...draft, per_user_limit: e.target.value })}
                inputMode="numeric"
              />
            </div>
            <div>
              <Label>Udløber</Label>
              <Input type="date" value={draft.ends_at} onChange={(e) => setDraft({ ...draft, ends_at: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label>Beskrivelse (vises i kassen)</Label>
              <Input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Forårskampagne 2026"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void create()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Opret kode"}
            </Button>
            <Button variant="outline" onClick={() => { setCreating(false); setDraft(EMPTY); }}>Fortryd</Button>
          </div>
        </Card>
      )}

      {loading ? (
        <Card className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></Card>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <Tag className="mx-auto mb-3 h-6 w-6" />
          Ingen rabatkoder endnu.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-3">Kode</th>
                  <th className="p-3">Rabat</th>
                  <th className="p-3">Betingelser</th>
                  <th className="p-3">Brugt</th>
                  <th className="p-3">Udløber</th>
                  <th className="p-3">Aktiv</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.code} className="border-t">
                    <td className="p-3 font-mono">{c.code}</td>
                    <td className="p-3">{describe(c)}</td>
                    <td className="p-3 text-muted-foreground">
                      {c.min_subtotal_oere > 0 && `Min. ${formatOere(c.min_subtotal_oere)}`}
                      {c.min_subtotal_oere > 0 && c.category && " · "}
                      {c.category && CATEGORIES.find((x) => x.value === c.category)?.label}
                      {!c.min_subtotal_oere && !c.category && "Ingen"}
                    </td>
                    <td className="p-3">
                      {c.redemptions}
                      {c.max_redemptions != null && ` / ${c.max_redemptions}`}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {c.ends_at ? new Intl.DateTimeFormat("da-DK", { dateStyle: "short" }).format(new Date(c.ends_at)) : "—"}
                    </td>
                    <td className="p-3">
                      <Switch checked={c.active} onCheckedChange={() => void toggleActive(c)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
