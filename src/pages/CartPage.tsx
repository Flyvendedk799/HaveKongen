import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { useCart } from "@/lib/cart";
import { formatOere } from "@/lib/money";
import { usePageMeta } from "@/hooks/usePageMeta";
import { quoteCart, type CartQuote, type QuoteProblem } from "@/lib/shop";

/**
 * The basket, priced by the server.
 *
 * v1 added up `unitPriceDkk × qty` from localStorage and applied a hard-coded
 * 499 kr free-shipping rule. That meant a price change, a sold-out product or a
 * stale cart from three weeks ago all showed the wrong number until the
 * checkout corrected it. Now the same quote_cart() the checkout uses prices this
 * page too, so what you see here is what you will be charged — and problems
 * surface where they can still be fixed.
 */
export default function CartPage() {
  const cart = useCart();
  const items = cart.items;
  const nav = useNavigate();

  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);

  usePageMeta({ title: "Kurv · Havekongen", noindex: true });

  const refresh = useCallback(async () => {
    if (items.length === 0) {
      setQuote(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setQuote(await quoteCart(items, "standard", null));
      setStale(false);
    } catch (e) {
      console.warn("[cart] could not price the basket", e);
      // Falling back to the stored prices is better than an empty page, but say so.
      setStale(true);
    } finally {
      setLoading(false);
    }
  }, [items]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const problems = quote?.problems ?? [];

  const fixProblem = (p: QuoteProblem) => {
    if (!p.product_id) return;
    if (p.max_qty && p.max_qty > 0) cart.setQty(p.product_id, p.max_qty, p.variant_id ?? undefined);
    else cart.remove(p.product_id, p.variant_id ?? undefined);
  };

  // Line totals come from the quote when we have one; the stored price is only a
  // fallback for the moment before it arrives.
  const lineFor = (productId: string, variantId?: string) =>
    quote?.lines.find((l) => l.product_id === productId && (l.variant_id ?? undefined) === variantId);

  return (
    <>
      <AppNav active="shop" />
      <div className="container">
        <header className="page-head">
          <div className="eyebrow" style={{ marginBottom: 14 }}>Kurv</div>
          <h1>Din kurv ({cart.count()} {cart.count() === 1 ? "vare" : "varer"})</h1>
        </header>

        {items.length === 0 ? (
          <div style={{ padding: "60px 0", color: "var(--ink-500)" }}>
            <p style={{ marginBottom: 24 }}>Din kurv er tom.</p>
            <Link to="/webshop" className="btn btn-primary">Se sortimentet</Link>
          </div>
        ) : (
          <>
            {problems.length > 0 && (
              <div className="checkout-alert" role="alert">
                <AlertTriangle size={18} />
                <div>
                  <strong>Kurven skal opdateres</strong>
                  <ul>
                    {problems.map((p, i) => (
                      <li key={i}>
                        {p.message}
                        {p.product_id && (
                          <button type="button" className="linkish" onClick={() => fixProblem(p)}>
                            {p.max_qty && p.max_qty > 0 ? `Sæt til ${p.max_qty}` : "Fjern varen"}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {stale && (
              <div className="checkout-alert" role="status">
                <AlertTriangle size={18} />
                <div>
                  <strong>Priserne kunne ikke opdateres lige nu</strong>
                  <p>Beløbene herunder er dem, varerne kostede, da du lagde dem i kurven. Den endelige pris beregnes i kassen.</p>
                </div>
              </div>
            )}

            <div className="cart-layout">
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {items.map((i) => {
                  const line = lineFor(i.productId, i.variantId);
                  const unit = line?.unit_price_oere ?? i.unitPriceDkk * 100;
                  const lineTotal = line?.line_total_oere ?? i.unitPriceDkk * i.qty * 100;
                  const priceChanged = line && line.unit_price_oere !== i.unitPriceDkk * 100;

                  return (
                    <div key={i.productId + (i.variantId ?? "")} className="card cart-row">
                      <div className="cart-thumb" style={{ background: i.imageGradient || "var(--mist-100)" }}>
                        {i.imageSvg && <div dangerouslySetInnerHTML={{ __html: i.imageSvg }} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "var(--serif)", fontSize: 18 }}>{line?.name ?? i.name}</div>
                        {(line?.variant_name ?? i.variantName) && (
                          <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{line?.variant_name ?? i.variantName}</div>
                        )}
                        <div style={{ fontSize: 13, color: "var(--ink-700)", marginTop: 4 }}>
                          {formatOere(unit)} stk.
                          {priceChanged && <span className="price-changed"> (prisen er ændret)</span>}
                        </div>
                      </div>
                      <label className="qty-field">
                        <span className="sr-only">Antal af {i.name}</span>
                        <input
                          type="number"
                          min={0}
                          max={line?.max_qty ?? 99}
                          value={i.qty}
                          onChange={(e) => cart.setQty(i.productId, Math.max(0, parseInt(e.target.value) || 0), i.variantId)}
                        />
                      </label>
                      <div className="cart-line-total">{formatOere(lineTotal)}</div>
                      <button
                        onClick={() => cart.remove(i.productId, i.variantId)}
                        className="cart-remove"
                        aria-label={`Fjern ${i.name} fra kurven`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="card cart-summary">
                <h2 style={{ fontSize: 22, marginBottom: 18 }}>Opsummering</h2>
                <Row label="Subtotal" value={quote ? formatOere(quote.subtotal_oere) : <Loader2 size={14} className="spin" />} />
                <Row
                  label="Fragt (standard)"
                  value={quote ? (quote.shipping_oere === 0 ? "Gratis" : formatOere(quote.shipping_oere)) : "—"}
                />
                <div style={{ borderTop: "1px solid rgba(20,39,29,0.1)", marginTop: 14, paddingTop: 14 }}>
                  <Row
                    label={<strong>Total</strong>}
                    value={<strong style={{ fontFamily: "var(--serif)", fontSize: 20 }}>{quote ? formatOere(quote.total_oere) : "—"}</strong>}
                  />
                  {quote && <div className="vat-note">Heraf moms (25%): {formatOere(quote.vat_oere)}</div>}
                </div>

                <button
                  className="btn btn-primary"
                  style={{ width: "100%", marginTop: 24, height: 48, justifyContent: "center" }}
                  onClick={() => nav("/checkout")}
                  disabled={loading || problems.length > 0}
                >
                  {loading ? <Loader2 size={16} className="spin" /> : "Til kassen"}
                </button>
                {problems.length > 0 && (
                  <p className="code-error" style={{ marginTop: 10 }}>Ret ovenstående for at fortsætte.</p>
                )}
                <button onClick={() => cart.clear()} className="cart-clear">Tøm kurv</button>
                <p className="order-legal">
                  Fragten vælges i kassen. Priser er inkl. moms.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
      <SiteFooter />
    </>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 14 }}>
      <span style={{ color: "var(--ink-500)" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
