import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Copy, Landmark, Loader2, PackageCheck, RotateCcw, XCircle } from "lucide-react";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { OrderTimeline } from "@/components/order/OrderTimeline";
import { usePageMeta } from "@/hooks/usePageMeta";
import { formatOere } from "@/lib/money";
import {
  cancelOrder,
  fetchOrder,
  fetchOrderEvents,
  fetchPayment,
  preparePayment,
  requestReturn,
  type OrderWithItems,
} from "@/lib/shop";
import type { Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";

type Address = {
  name?: string;
  street?: string;
  street2?: string;
  postal_code?: string;
  city?: string;
};

const RETURN_REASONS = [
  "Fortrudt købet",
  "Varen er beskadiget",
  "Forkert vare leveret",
  "Passer ikke i haven",
  "Andet",
];

export default function OrderConfirmation() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [order, setOrder] = useState<OrderWithItems | null>(null);
  const [payment, setPayment] = useState<Tables<"payments"> | null>(null);
  const [events, setEvents] = useState<Tables<"order_events">[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState(RETURN_REASONS[0]);
  const [returnComment, setReturnComment] = useState("");

  usePageMeta({
    title: order?.order_no ? `Ordre ${order.order_no} · Havekongen` : "Din ordre · Havekongen",
    description: "Status, kvittering og betalingsoplysninger for din Havekongen-ordre.",
    noindex: true,
  });

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [o, p, e] = await Promise.all([fetchOrder(id), fetchPayment(id), fetchOrderEvents(id)]);
      setOrder(o);
      setPayment(p);
      setEvents(e);
    } catch (err) {
      console.error("[order] load failed", err);
      toast.error("Kunne ikke hente ordren.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Coming back from a card payment, the webhook may land a second or two after
  // the redirect. Re-read once so the page does not greet a paying customer
  // with "afventer betaling".
  useEffect(() => {
    if (params.get("betaling") !== "ok" || !order || order.payment_status === "paid") return;
    const timer = setTimeout(() => void load(), 2500);
    return () => clearTimeout(timer);
  }, [params, order, load]);

  async function retryPayment() {
    if (!order) return;
    setBusy(true);
    try {
      const result = await preparePayment(order.id, (order.payment_provider as "invoice" | "stripe") ?? "invoice");
      if (result.redirect_url) {
        window.location.href = result.redirect_url;
        return;
      }
      await load();
      toast.success("Betalingsoplysninger er klar.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke forberede betalingen.");
    } finally {
      setBusy(false);
    }
  }

  async function doCancel() {
    if (!order || !confirm("Vil du annullere ordren? Varerne lægges tilbage på lager.")) return;
    setBusy(true);
    try {
      const res = await cancelOrder(order.id, "Annulleret af kunden");
      if (!res.ok) {
        toast.error(res.message ?? "Ordren kunne ikke annulleres.");
      } else {
        toast.success("Ordren er annulleret.");
        await load();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Noget gik galt.");
    } finally {
      setBusy(false);
    }
  }

  async function submitReturn(e: React.FormEvent) {
    e.preventDefault();
    if (!order) return;
    setBusy(true);
    try {
      const res = await requestReturn(order.id, returnReason, returnComment);
      if (!res.ok) {
        toast.error(res.message ?? "Returneringen kunne ikke oprettes.");
      } else {
        toast.success("Returnering registreret. Vi sender en returlabel på mail.");
        setReturnOpen(false);
        setReturnComment("");
        await load();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Noget gik galt.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <>
        <AppNav active="shop" />
        <div className="container" style={{ padding: "100px 0", textAlign: "center" }}>
          <Loader2 size={28} className="spin" />
        </div>
        <SiteFooter />
      </>
    );
  }

  if (!order) {
    return (
      <>
        <AppNav active="shop" />
        <div className="container" style={{ padding: "90px 0", textAlign: "center" }}>
          <h1 style={{ marginBottom: 12 }}>Ordren blev ikke fundet</h1>
          <p style={{ color: "var(--ink-500)", marginBottom: 24 }}>
            Tjek linket, eller find ordren under din konto.
          </p>
          <Link to="/konto?tab=ordrer" className="btn btn-primary">Mine ordrer</Link>
        </div>
        <SiteFooter />
      </>
    );
  }

  const addr = (order.shipping_address ?? {}) as Address;
  const cancelled = order.status === "cancelled";
  const paid = order.payment_status === "paid";
  const awaitingTransfer = !paid && order.payment_provider === "invoice" && !cancelled;
  const instructions = (payment?.instructions ?? null) as Record<string, string | number> | null;
  const canCancel = ["pending", "confirmed", "paid"].includes(order.status) && order.shipping_status !== "shipped";
  const canReturn = ["shipped", "delivered"].includes(order.status);

  return (
    <>
      <AppNav active="shop" />
      <div className="container order-page">
        <header className="order-hero">
          {cancelled ? (
            <XCircle size={48} color="var(--ink-500)" />
          ) : paid ? (
            <PackageCheck size={48} color="var(--forest-700)" />
          ) : (
            <CheckCircle2 size={48} color="var(--forest-700)" />
          )}
          <h1>
            {cancelled ? "Ordren er annulleret" : paid ? "Betaling modtaget" : "Tak for din ordre!"}
          </h1>
          <p>
            {cancelled
              ? "Vi har lagt varerne tilbage på lager. Du er ikke blevet opkrævet."
              : paid
                ? "Vi pakker den nu og sender en mail, når den er afsted."
                : `En bekræftelse er sendt${order.email ? ` til ${order.email}` : ""}.`}
          </p>
        </header>

        {params.get("betaling") === "fejlet" && (
          <div className="checkout-alert" role="alert">
            <AlertTriangle size={18} />
            <div>
              <strong>Ordren er oprettet, men betalingen blev ikke sat op</strong>
              <p>Dine varer er reserveret. Prøv at forberede betalingen igen herunder.</p>
            </div>
          </div>
        )}

        {awaitingTransfer && instructions && (
          <section className="card pay-instructions">
            <h2><Landmark size={18} /> Betal med bankoverførsel</h2>
            <p className="muted-note">
              Overfør {formatOere(order.total_oere)} og anfør ordrenummeret som besked til modtager.
              Vi pakker, så snart betalingen er registreret.
            </p>
            <dl className="pay-grid">
              <PayRow label="Beløb" value={formatOere(order.total_oere)} />
              <PayRow label="Besked til modtager" value={order.order_no ?? order.id.slice(0, 8)} copyable />
              <PayRow label="Reg.nr." value={String(instructions.reg_no ?? "—")} />
              <PayRow label="Kontonummer" value={String(instructions.account_no ?? "—")} copyable />
              <PayRow label="IBAN" value={String(instructions.iban ?? "—")} copyable />
              <PayRow label="SWIFT/BIC" value={String(instructions.swift ?? "—")} />
            </dl>
          </section>
        )}

        {!paid && !cancelled && !instructions && (
          <div className="card" style={{ padding: 20, marginBottom: 24, textAlign: "center" }}>
            <p style={{ marginBottom: 12 }}>Betalingen er ikke sat op endnu.</p>
            <button className="btn btn-primary" onClick={() => void retryPayment()} disabled={busy}>
              {busy ? <Loader2 size={15} className="spin" /> : "Forbered betaling"}
            </button>
          </div>
        )}

        <div className="order-columns">
          <section className="card receipt">
            <div className="receipt-head">
              <div>
                <div className="eyebrow">Ordrenr.</div>
                <div className="receipt-no">{order.order_no ?? `#${order.id.slice(0, 8).toUpperCase()}`}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="eyebrow">Total</div>
                <div className="receipt-total">{formatOere(order.total_oere)}</div>
              </div>
            </div>

            <div className="receipt-lines">
              {order.order_items.map((i) => (
                <div key={i.id} className="receipt-line">
                  <span>
                    {i.qty} × {i.name}
                    {i.variant_name && <em> — {i.variant_name}</em>}
                  </span>
                  <span>{formatOere(i.line_total_oere || i.unit_price_dkk * i.qty * 100)}</span>
                </div>
              ))}
            </div>

            <div className="receipt-totals">
              <TotalRow label="Subtotal" value={formatOere(order.subtotal_oere)} />
              {order.discount_oere > 0 && (
                <TotalRow
                  label={`Rabat${order.discount_code ? ` (${order.discount_code})` : ""}`}
                  value={`−${formatOere(order.discount_oere)}`}
                />
              )}
              <TotalRow label="Fragt" value={order.shipping_oere === 0 ? "Gratis" : formatOere(order.shipping_oere)} />
              <TotalRow label="Heraf moms (25%)" value={formatOere(order.vat_oere)} muted />
              <TotalRow label="Total" value={formatOere(order.total_oere)} strong />
            </div>

            {addr.name && (
              <div className="receipt-address">
                <div className="eyebrow">Leveres til</div>
                <div>{addr.name}</div>
                <div>{addr.street}</div>
                {addr.street2 && <div>{addr.street2}</div>}
                <div>{addr.postal_code} {addr.city}</div>
              </div>
            )}

            {order.tracking_number && (
              <div className="receipt-address">
                <div className="eyebrow">Pakkenummer</div>
                <div>{order.tracking_number}</div>
              </div>
            )}
          </section>

          <aside className="order-side">
            <section className="card" style={{ padding: 22 }}>
              <h2 style={{ fontSize: 17, marginBottom: 14 }}>Forløb</h2>
              <OrderTimeline order={order} events={events} />
            </section>

            <div className="order-actions">
              {canCancel && (
                <button className="btn btn-ghost" onClick={() => void doCancel()} disabled={busy}>
                  Annullér ordre
                </button>
              )}
              {canReturn && !returnOpen && (
                <button className="btn btn-ghost" onClick={() => setReturnOpen(true)} disabled={busy}>
                  <RotateCcw size={15} /> Opret returnering
                </button>
              )}
              <Link to="/webshop" className="btn btn-ghost">Fortsæt med at handle</Link>
              <Link to="/konto?tab=ordrer" className="btn btn-primary">Mine ordrer</Link>
            </div>

            {returnOpen && (
              <form className="card return-form" onSubmit={submitReturn}>
                <h2 style={{ fontSize: 17, marginBottom: 12 }}>Returnering</h2>
                <div className="field">
                  <label htmlFor="return-reason">Årsag</label>
                  <select id="return-reason" value={returnReason} onChange={(e) => setReturnReason(e.target.value)}>
                    {RETURN_REASONS.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="return-comment">Uddyb (valgfrit)</label>
                  <textarea
                    id="return-comment"
                    rows={3}
                    value={returnComment}
                    onChange={(e) => setReturnComment(e.target.value.slice(0, 500))}
                  />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Send anmodning</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReturnOpen(false)}>Fortryd</button>
                </div>
              </form>
            )}
          </aside>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}

function PayRow({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  return (
    <div className="pay-row">
      <dt>{label}</dt>
      <dd>
        <span>{value}</span>
        {copyable && (
          <button
            type="button"
            className="copy-btn"
            aria-label={`Kopiér ${label}`}
            onClick={() => {
              navigator.clipboard?.writeText(value).then(
                () => toast.success(`${label} kopieret`),
                () => toast.error("Kunne ikke kopiere"),
              );
            }}
          >
            <Copy size={13} />
          </button>
        )}
      </dd>
    </div>
  );
}

function TotalRow({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`total-row${strong ? " is-strong" : ""}${muted ? " is-muted" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
