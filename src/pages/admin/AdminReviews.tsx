import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Check, Loader2, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type ReviewRow = {
  id: string;
  product_id: string;
  rating: number;
  title: string | null;
  body: string | null;
  status: string;
  verified_purchase: boolean;
  author_name: string | null;
  created_at: string;
  products: { name: string; slug: string } | null;
};

const STATUSES = ["pending", "approved", "rejected", "all"] as const;

/**
 * Review moderation. Reviews land as `pending` and are invisible to shoppers
 * until approved here — the products.rating_avg trigger only counts approved
 * rows, so nothing published moves the score until a human has looked at it.
 */
export default function AdminReviews() {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("pending");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("product_reviews")
      .select("id, product_id, rating, title, body, status, verified_purchase, author_name, created_at, products(name, slug)")
      .order("created_at", { ascending: false })
      .limit(300);
    if (status !== "all") query = query.eq("status", status);

    const { data, error } = await query;
    if (error) toast.error(error.message);
    setRows((data ?? []) as unknown as ReviewRow[]);
    setLoading(false);
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function moderate(id: string, next: "approved" | "rejected") {
    setBusyId(id);
    const { error } = await supabase
      .from("product_reviews")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", id);
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(next === "approved" ? "Anmeldelse offentliggjort" : "Anmeldelse afvist");
    // Optimistic: drop it from a filtered list, otherwise just restamp it.
    setRows((prev) =>
      status === "all" ? prev.map((r) => (r.id === id ? { ...r, status: next } : r)) : prev.filter((r) => r.id !== id),
    );
  }

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        (r.products?.name ?? "").toLowerCase().includes(needle) ||
        (r.title ?? "").toLowerCase().includes(needle) ||
        (r.body ?? "").toLowerCase().includes(needle),
    );
  }, [rows, q]);

  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Anmeldelser</h1>
        <p className="text-muted-foreground">
          {status === "pending"
            ? `${pendingCount} venter på godkendelse`
            : `${visible.length} anmeldelser`}{" "}
          · kun godkendte tæller med i produktets score
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Søg i produkt eller tekst…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1 min-w-[220px]"
        />
        <div className="flex gap-1">
          {STATUSES.map((s) => (
            <Button key={s} variant={status === s ? "default" : "outline"} size="sm" onClick={() => setStatus(s)}>
              {s === "pending" ? "Afventer" : s === "approved" ? "Godkendt" : s === "rejected" ? "Afvist" : "Alle"}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <Card className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></Card>
      ) : visible.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          Ingen anmeldelser i denne visning.
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => (
            <Card key={r.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex text-amber-500" aria-label={`${r.rating} ud af 5`}>
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className="h-4 w-4" fill={i < r.rating ? "currentColor" : "none"} />
                      ))}
                    </span>
                    {r.verified_purchase && (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                        <BadgeCheck className="h-3.5 w-3.5" /> Verificeret køb
                      </span>
                    )}
                    {r.status !== "pending" && (
                      <span className="text-xs rounded-full bg-muted px-2 py-0.5">{r.status}</span>
                    )}
                  </div>

                  {r.title && <h3 className="mt-2 font-medium">{r.title}</h3>}
                  {r.body && <p className="mt-1 text-sm text-muted-foreground whitespace-pre-line">{r.body}</p>}

                  <div className="mt-3 text-xs text-muted-foreground">
                    {r.products ? (
                      <Link to={`/webshop/${r.products.slug}`} className="underline underline-offset-2">
                        {r.products.name}
                      </Link>
                    ) : (
                      "Ukendt produkt"
                    )}
                    {" · "}
                    {r.author_name || "Anonym"}
                    {" · "}
                    {new Intl.DateTimeFormat("da-DK", { dateStyle: "medium" }).format(new Date(r.created_at))}
                  </div>
                </div>

                {r.status !== "approved" || status === "all" ? (
                  <div className="flex gap-2 shrink-0">
                    {r.status !== "approved" && (
                      <Button size="sm" disabled={busyId === r.id} onClick={() => void moderate(r.id, "approved")}>
                        <Check className="h-4 w-4" /> Godkend
                      </Button>
                    )}
                    {r.status !== "rejected" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === r.id}
                        onClick={() => void moderate(r.id, "rejected")}
                      >
                        <X className="h-4 w-4" /> Afvis
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
