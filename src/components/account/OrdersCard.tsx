import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { formatOere } from "@/lib/money";

type OrderRow = Pick<
  Tables<"orders">,
  "id" | "order_no" | "created_at" | "total_oere" | "total_dkk" | "status" | "payment_status" | "shipping_status"
>;

type ReturnRow = Pick<Tables<"order_returns">, "id" | "order_id" | "status">;

const STATUS_LABEL: Record<string, string> = {
  pending: "Afventer betaling",
  confirmed: "Bekræftet",
  paid: "Betalt",
  packed: "Pakket",
  shipped: "Afsendt",
  delivered: "Leveret",
  cancelled: "Annulleret",
  refunded: "Refunderet",
  returned: "Returneret",
  failed: "Mislykkedes",
};

const STATUS_TONE: Record<string, string> = {
  paid: "is-paid",
  packed: "is-paid",
  delivered: "is-paid",
  shipped: "is-shipped",
  cancelled: "is-cancelled",
  refunded: "is-cancelled",
  failed: "is-cancelled",
};

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

/**
 * Full order history. The v1 account showed five rows keyed by a UUID prefix;
 * this shows the human order number, what state it is actually in, and whether
 * a return is running on it.
 */
export function OrdersCard() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: o }, { data: r }] = await Promise.all([
      supabase
        .from("orders")
        .select("id, order_no, created_at, total_oere, total_dkk, status, payment_status, shipping_status")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("order_returns").select("id, order_id, status").neq("status", "cancelled"),
    ]);
    setOrders((o ?? []) as OrderRow[]);
    setReturns((r ?? []) as ReturnRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = showAll ? orders : orders.slice(0, 5);

  if (loading) {
    return (
      <div style={{ padding: "20px 0", color: "var(--ink-500)" }}>
        <Loader2 size={15} className="spin" /> Henter ordrer…
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div style={{ padding: "18px 0", textAlign: "center", color: "var(--ink-500)" }}>
        <Package size={22} style={{ marginBottom: 8 }} />
        <p style={{ margin: "0 0 12px", fontSize: 14 }}>Ingen ordrer endnu.</p>
        <Link to="/webshop" className="btn btn-ghost btn-sm">Se webshop</Link>
      </div>
    );
  }

  return (
    <>
      <div className="acct-orders">
        {visible.map((o) => {
          const activeReturn = returns.find((r) => r.order_id === o.id);
          // Older orders predate total_oere; fall back to the kroner column so
          // history does not read as 0,00 kr.
          const amount = o.total_oere || o.total_dkk * 100;
          return (
            <Link key={o.id} to={`/order/${o.id}`} className="acct-order" style={{ textDecoration: "none", color: "inherit" }}>
              <div>
                <strong>{o.order_no ?? `#${o.id.slice(0, 8).toUpperCase()}`}</strong>
                <div className="who">
                  {fmtDate(o.created_at)}
                  {o.payment_status === "unpaid" && o.status !== "cancelled" && " · afventer betaling"}
                  {activeReturn && ` · returnering ${activeReturn.status}`}
                </div>
              </div>
              <div style={{ textAlign: "right", display: "grid", gap: 6, justifyItems: "end" }}>
                <span className={`status-pill ${STATUS_TONE[o.status] ?? ""}`}>
                  {STATUS_LABEL[o.status] ?? o.status}
                </span>
                <strong style={{ fontFamily: "var(--serif)", fontSize: 16 }}>{formatOere(amount)}</strong>
              </div>
            </Link>
          );
        })}
      </div>

      {orders.length > 5 && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Vis færre" : `Vis alle ${orders.length} ordrer`}
        </button>
      )}
    </>
  );
}
