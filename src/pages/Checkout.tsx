import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Check, CreditCard, Landmark, Loader2, Tag } from "lucide-react";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import { formatOere, formatEta } from "@/lib/money";
import { usePageMeta } from "@/hooks/usePageMeta";
import { track } from "@/lib/analytics";
import {
  listShippingMethods,
  placeOrder,
  preparePayment,
  quoteCart,
  type CartQuote,
  type QuoteProblem,
} from "@/lib/shop";
import type { Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";

type AddressForm = {
  name: string;
  street: string;
  street2: string;
  postal_code: string;
  city: string;
  email: string;
  phone: string;
};

const EMPTY_ADDRESS: AddressForm = {
  name: "",
  street: "",
  street2: "",
  postal_code: "",
  city: "",
  email: "",
  phone: "",
};

type PaymentProvider = "invoice" | "stripe";

export default function Checkout() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const items = useCart((s) => s.items);
  const setQty = useCart((s) => s.setQty);
  const remove = useCart((s) => s.remove);
  const clear = useCart((s) => s.clear);

  const [addr, setAddr] = useState<AddressForm>(EMPTY_ADDRESS);
  const [savedAddresses, setSavedAddresses] = useState<Tables<"addresses">[]>([]);
  const [saveAddress, setSaveAddress] = useState(true);
  const [methods, setMethods] = useState<Tables<"shipping_methods">[]>([]);
  const [shippingMethod, setShippingMethod] = useState("standard");
  const [provider, setProvider] = useState<PaymentProvider>("invoice");
  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [problems, setProblems] = useState<QuoteProblem[]>([]);

  // One key per checkout attempt. Regenerated only after a *successful* order,
  // so a double-click or a retry after a network blip replays into the same
  // order instead of creating a second one.
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  usePageMeta({
    title: "Kassen · Havekongen",
    description: "Gennemfør din ordre hos Havekongen.",
    noindex: true,
  });

  useEffect(() => {
    if (!loading && !user) nav("/login?next=/checkout", { replace: true });
  }, [loading, user, nav]);

  // Shipping methods come from the database so a price change does not need a
  // deploy — and so the checkout cannot disagree with what place_order charges.
  useEffect(() => {
    listShippingMethods()
      .then((rows) => {
        setMethods(rows);
        if (rows.length && !rows.some((r) => r.code === shippingMethod)) {
          setShippingMethod(rows[0].code);
        }
      })
      .catch((e) => console.warn("[checkout] shipping methods", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const [{ data: addresses }, { data: profile }] = await Promise.all([
        supabase.from("addresses").select("*").order("is_default_shipping", { ascending: false }),
        supabase.from("profiles").select("name, address, postal_code, phone").eq("id", user.id).maybeSingle(),
      ]);

      setSavedAddresses(addresses ?? []);

      const preferred = (addresses ?? []).find((a) => a.is_default_shipping) ?? (addresses ?? [])[0];
      if (preferred) {
        setAddr({
          name: preferred.name,
          street: preferred.street,
          street2: preferred.street2 ?? "",
          postal_code: preferred.postal_code,
          city: preferred.city,
          email: user.email ?? "",
          phone: preferred.phone ?? "",
        });
        setSaveAddress(false);
      } else {
        setAddr((a) => ({
          ...a,
          name: profile?.name ?? a.name,
          street: profile?.address ?? a.street,
          postal_code: profile?.postal_code ?? a.postal_code,
          phone: profile?.phone ?? a.phone,
          email: user.email ?? a.email,
        }));
      }
    })();
  }, [user]);

  // Re-price on every change that can move the total. The server is the only
  // thing that decides the number shown next to "Total".
  const refreshQuote = useCallback(async () => {
    if (items.length === 0) {
      setQuote(null);
      return;
    }
    setQuoting(true);
    try {
      const q = await quoteCart(items, shippingMethod, appliedCode);
      setQuote(q);
      setProblems(q.problems ?? []);
    } catch (e) {
      console.error("[checkout] quote failed", e);
      toast.error("Kunne ikke beregne totalen. Prøv at genindlæse siden.");
    } finally {
      setQuoting(false);
    }
  }, [items, shippingMethod, appliedCode]);

  useEffect(() => {
    void refreshQuote();
  }, [refreshQuote]);

  const method = useMemo(
    () => methods.find((m) => m.code === shippingMethod) ?? null,
    [methods, shippingMethod],
  );

  const blockingProblems = problems.filter(
    (p) => p.code !== "invalid_code" && !p.code.startsWith("code_") && p.code !== "below_minimum",
  );
  const codeProblem = problems.find((p) => p.code === "invalid_code" || p.code.startsWith("code_") || p.code === "below_minimum");

  async function applyCode(e: React.FormEvent) {
    e.preventDefault();
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    setAppliedCode(code);
  }

  function clearCode() {
    setAppliedCode(null);
    setCodeInput("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || submitting) return;

    if (!addr.name || !addr.street || !addr.postal_code || !addr.city) {
      toast.error("Udfyld navn, adresse, postnummer og by.");
      return;
    }
    if (!acceptedTerms) {
      toast.error("Accepter handelsbetingelserne for at fortsætte.");
      return;
    }
    if (blockingProblems.length > 0) {
      toast.error("Ret problemerne i kurven, før du bestiller.");
      return;
    }

    setSubmitting(true);
    try {
      const shippingAddress = {
        name: addr.name.trim(),
        street: addr.street.trim(),
        street2: addr.street2.trim() || undefined,
        postal_code: addr.postal_code.trim(),
        city: addr.city.trim(),
        country: "DK",
      };

      const result = await placeOrder({
        items,
        shippingAddress,
        shippingMethod,
        email: addr.email.trim() || user.email || undefined,
        phone: addr.phone.trim() || undefined,
        discountCode: appliedCode,
        note: note.trim() || undefined,
        paymentProvider: provider,
        idempotencyKey: idempotencyKey.current,
      });

      if (!result.ok || !result.order_id) {
        const found = result.problems ?? [];
        setProblems(found);
        if (result.quote) setQuote(result.quote);
        track("checkout_error", { reason: found[0]?.code });
        toast.error(found[0]?.message ?? "Ordren kunne ikke oprettes.");
        return;
      }

      track("order_placed", { order_no: result.order_no, total_oere: result.total_oere });

      if (saveAddress && !result.replayed) {
        // Best-effort: a failed address save must not affect a placed order.
        await supabase
          .from("addresses")
          .insert({
            user_id: user.id,
            name: shippingAddress.name,
            street: shippingAddress.street,
            street2: shippingAddress.street2 ?? null,
            postal_code: shippingAddress.postal_code,
            city: shippingAddress.city,
            phone: addr.phone.trim() || null,
            is_default_shipping: savedAddresses.length === 0,
          })
          .then(({ error }) => error && console.warn("[checkout] address save", error.message));
      }

      // The order exists and stock is reserved. Payment preparation is a
      // separate step so a provider hiccup leaves a recoverable order rather
      // than losing the whole basket.
      let paymentFailed = false;
      try {
        const payment = await preparePayment(result.order_id, provider);
        track("payment_prepared", { provider, order_no: result.order_no });
        if (payment.redirect_url) {
          clear();
          window.location.href = payment.redirect_url;
          return;
        }
      } catch (err) {
        paymentFailed = true;
        console.error("[checkout] payment prep failed", err);
      }

      clear();
      idempotencyKey.current = crypto.randomUUID();
      nav(`/order/${result.order_id}${paymentFailed ? "?betaling=fejlet" : ""}`);
    } catch (err) {
      console.error("[checkout] submit failed", err);
      track("checkout_error", { reason: "exception" });
      toast.error(err instanceof Error ? err.message : "Noget gik galt. Prøv igen.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !user) return null;

  if (items.length === 0) {
    return (
      <>
        <AppNav active="shop" />
        <div className="container" style={{ padding: "80px 0", textAlign: "center" }}>
          <h1 style={{ marginBottom: 16 }}>Din kurv er tom</h1>
          <Link to="/webshop" className="btn btn-primary">Se sortimentet</Link>
        </div>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <AppNav active="shop" />
      <div className="container">
        <header className="page-head">
          <div className="eyebrow" style={{ marginBottom: 14 }}>Kassen</div>
          <h1>Færdiggør din ordre.</h1>
        </header>

        {blockingProblems.length > 0 && (
          <div className="checkout-alert" role="alert">
            <AlertTriangle size={18} />
            <div>
              <strong>Kurven skal rettes</strong>
              <ul>
                {blockingProblems.map((p, i) => (
                  <li key={i}>
                    {p.message}
                    {p.product_id && (
                      <button
                        type="button"
                        className="linkish"
                        onClick={() =>
                          p.max_qty && p.max_qty > 0
                            ? setQty(p.product_id!, p.max_qty, p.variant_id ?? undefined)
                            : remove(p.product_id!, p.variant_id ?? undefined)
                        }
                      >
                        {p.max_qty && p.max_qty > 0 ? `Sæt til ${p.max_qty}` : "Fjern varen"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <form onSubmit={submit} className="checkout-grid">
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {savedAddresses.length > 0 && (
              <section className="card" style={{ padding: 24 }}>
                <h3 style={{ fontSize: 20, marginBottom: 14 }}>Gemte adresser</h3>
                <div className="addr-chips">
                  {savedAddresses.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={`addr-chip${addr.street === a.street && addr.postal_code === a.postal_code ? " is-active" : ""}`}
                      onClick={() => {
                        setAddr((prev) => ({
                          ...prev,
                          name: a.name,
                          street: a.street,
                          street2: a.street2 ?? "",
                          postal_code: a.postal_code,
                          city: a.city,
                          phone: a.phone ?? prev.phone,
                        }));
                        setSaveAddress(false);
                      }}
                    >
                      <strong>{a.label || a.name}</strong>
                      <span>{a.street}, {a.postal_code} {a.city}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="card" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 20, marginBottom: 18 }}>Leveringsadresse</h3>
              <div className="checkout-fields">
                <Field label="Navn" value={addr.name} onChange={(v) => setAddr({ ...addr, name: v })} required autoComplete="name" />
                <Field label="E-mail" type="email" value={addr.email} onChange={(v) => setAddr({ ...addr, email: v })} required autoComplete="email" />
                <Field label="Adresse" value={addr.street} onChange={(v) => setAddr({ ...addr, street: v })} required full autoComplete="street-address" />
                <Field label="Etage, dør (valgfrit)" value={addr.street2} onChange={(v) => setAddr({ ...addr, street2: v })} full />
                <Field label="Postnummer" value={addr.postal_code} onChange={(v) => setAddr({ ...addr, postal_code: v })} required inputMode="numeric" autoComplete="postal-code" />
                <Field label="By" value={addr.city} onChange={(v) => setAddr({ ...addr, city: v })} required autoComplete="address-level2" />
                <Field label="Telefon (til fragtmanden)" value={addr.phone} onChange={(v) => setAddr({ ...addr, phone: v })} type="tel" full autoComplete="tel" />
              </div>
              <label className="check-line" style={{ marginTop: 14 }}>
                <input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} />
                <span>Gem adressen til næste gang</span>
              </label>
            </section>

            <section className="card" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 20, marginBottom: 18 }}>Levering</h3>
              {methods.length === 0 && <p className="muted-note">Henter fragtmuligheder…</p>}
              {methods.map((m) => {
                const free = m.free_over_oere != null && quote != null && quote.subtotal_oere - quote.discount_oere >= m.free_over_oere;
                return (
                  <label key={m.code} className="ship-opt">
                    <input
                      type="radio"
                      name="ship"
                      checked={shippingMethod === m.code}
                      onChange={() => setShippingMethod(m.code)}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500 }}>
                        {m.name} <span style={{ color: "var(--ink-500)", fontWeight: 400 }}>({formatEta(m.eta_min_days, m.eta_max_days)})</span>
                      </div>
                      <div style={{ fontSize: 13, color: "var(--ink-500)" }}>
                        {m.description}
                        {m.free_over_oere != null && !free && ` · Gratis over ${formatOere(m.free_over_oere)}`}
                      </div>
                    </div>
                    <div>{free || m.price_oere === 0 ? "Gratis" : formatOere(m.price_oere)}</div>
                  </label>
                );
              })}
            </section>

            <section className="card" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 20, marginBottom: 18 }}>Betaling</h3>
              <label className="ship-opt">
                <input type="radio" name="pay" checked={provider === "invoice"} onChange={() => setProvider("invoice")} />
                <Landmark size={18} style={{ color: "var(--ink-500)" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>Bankoverførsel</div>
                  <div style={{ fontSize: 13, color: "var(--ink-500)" }}>
                    Du får kontooplysninger og ordrenummer med det samme. Vi pakker, når betalingen er registreret.
                  </div>
                </div>
              </label>
              <label className="ship-opt">
                <input type="radio" name="pay" checked={provider === "stripe"} onChange={() => setProvider("stripe")} />
                <CreditCard size={18} style={{ color: "var(--ink-500)" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>Betalingskort</div>
                  <div style={{ fontSize: 13, color: "var(--ink-500)" }}>
                    Du sendes videre til vores betalingsside. Er kortbetaling ikke aktiv endnu, får du besked med det samme.
                  </div>
                </div>
              </label>
            </section>

            <section className="card" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 20, marginBottom: 12 }}>Besked til os (valgfrit)</h3>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="Fx: stil pakken bag skuret"
                className="checkout-note"
              />
            </section>
          </div>

          <aside className="card checkout-summary">
            <h3 style={{ fontSize: 20, marginBottom: 18 }}>Opsummering</h3>

            <div className="summary-lines">
              {(quote?.lines ?? []).map((l) => (
                <div key={l.product_id + (l.variant_id ?? "")} className="summary-line">
                  <span>
                    {l.qty} × {l.name}
                    {l.variant_name && <em> — {l.variant_name}</em>}
                  </span>
                  <span>{formatOere(l.line_total_oere)}</span>
                </div>
              ))}
              {!quote && <div className="summary-line"><span>Beregner…</span><span /></div>}
            </div>

            <form onSubmit={applyCode} className="code-row">
              <Tag size={15} />
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="Rabatkode"
                aria-label="Rabatkode"
                disabled={Boolean(quote?.discount)}
              />
              {quote?.discount ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearCode}>Fjern</button>
              ) : (
                <button type="submit" className="btn btn-ghost btn-sm" disabled={!codeInput.trim()}>Brug</button>
              )}
            </form>
            {codeProblem && <p className="code-error">{codeProblem.message}</p>}
            {quote?.discount && (
              <p className="code-ok"><Check size={14} /> {quote.discount.code} anvendt{quote.discount.description ? ` — ${quote.discount.description}` : ""}</p>
            )}

            <Row label="Subtotal" value={quote ? formatOere(quote.subtotal_oere) : "—"} />
            {quote && quote.discount_oere > 0 && <Row label="Rabat" value={`−${formatOere(quote.discount_oere)}`} />}
            <Row
              label="Fragt"
              value={quote ? (quote.shipping_oere === 0 ? "Gratis" : formatOere(quote.shipping_oere)) : "—"}
            />
            <div className="summary-total">
              <Row
                label={<strong>Total</strong>}
                value={
                  <strong style={{ fontFamily: "var(--serif)", fontSize: 22 }}>
                    {quoting && !quote ? <Loader2 size={16} className="spin" /> : quote ? formatOere(quote.total_oere) : "—"}
                  </strong>
                }
              />
              {quote && (
                <div className="vat-note">Heraf moms (25%): {formatOere(quote.vat_oere)}</div>
              )}
            </div>

            <label className="check-line" style={{ marginTop: 16 }}>
              <input type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} />
              <span>
                Jeg accepterer <Link to="/handelsbetingelser" target="_blank">handelsbetingelserne</Link> og har læst{" "}
                <Link to="/privatliv" target="_blank">privatlivspolitikken</Link>.
              </span>
            </label>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: "100%", marginTop: 18, height: 48, justifyContent: "center" }}
              disabled={submitting || quoting || !quote?.ok || blockingProblems.length > 0}
            >
              {submitting ? <><Loader2 size={16} className="spin" /> Behandler…</> : "Afgiv bestilling"}
            </button>
            <p className="order-legal">
              Ved at bestille indgår du en aftale om køb med betalingsforpligtelse. Du har 14 dages
              fortrydelsesret og 30 dages retur.
            </p>
          </aside>
        </form>
      </div>
      <SiteFooter />
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  full,
  autoComplete,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  full?: boolean;
  autoComplete?: string;
  inputMode?: "numeric" | "text" | "tel" | "email";
}) {
  return (
    <div className="field" style={{ gridColumn: full ? "1 / -1" : undefined }}>
      <label>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoComplete={autoComplete}
        inputMode={inputMode}
      />
    </div>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 14 }}>
      <span style={{ color: "var(--ink-500)" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
