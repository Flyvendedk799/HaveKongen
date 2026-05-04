import { Link } from "react-router-dom";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { useCart, formatDkk } from "@/lib/cart";
import { toast } from "sonner";

export default function CartPage() {
  const cart = useCart();
  const items = cart.items;
  const total = cart.total();
  const shipping = total > 499 || total === 0 ? 0 : 49;

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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 48, marginBottom: 80 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {items.map((i) => (
                <div key={i.productId + (i.variantId ?? "")} className="card" style={{ padding: 16, display: "flex", gap: 16, alignItems: "center" }}>
                  <div style={{ width: 80, height: 80, borderRadius: 8, background: i.imageGradient || "var(--mist-100)", overflow: "hidden", position: "relative" }}>
                    {i.imageSvg && <div dangerouslySetInnerHTML={{ __html: i.imageSvg }} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: "var(--serif)", fontSize: 18 }}>{i.name}</div>
                    {i.variantName && <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{i.variantName}</div>}
                    <div style={{ fontSize: 13, color: "var(--ink-700)", marginTop: 4 }}>{formatDkk(i.unitPriceDkk)} stk.</div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    value={i.qty}
                    onChange={(e) => cart.setQty(i.productId, Math.max(0, parseInt(e.target.value) || 0), i.variantId)}
                    style={{ width: 64, padding: 8, borderRadius: 6, border: "1px solid rgba(20,39,29,0.15)" }}
                  />
                  <div style={{ width: 100, textAlign: "right", fontWeight: 500 }}>{formatDkk(i.unitPriceDkk * i.qty)}</div>
                  <button onClick={() => cart.remove(i.productId, i.variantId)} style={{ color: "var(--ink-500)", fontSize: 13 }}>×</button>
                </div>
              ))}
            </div>

            <div className="card" style={{ padding: 24, height: "fit-content", position: "sticky", top: 96 }}>
              <h3 style={{ fontSize: 22, marginBottom: 18 }}>Opsummering</h3>
              <Row label="Subtotal" value={formatDkk(total)} />
              <Row label="Fragt" value={shipping === 0 ? "Gratis" : formatDkk(shipping)} />
              <div style={{ borderTop: "1px solid rgba(20,39,29,0.1)", marginTop: 14, paddingTop: 14 }}>
                <Row label={<strong>Total</strong>} value={<strong>{formatDkk(total + shipping)}</strong>} />
              </div>
              <button
                className="btn btn-primary"
                style={{ width: "100%", marginTop: 24, height: 48 }}
                onClick={() => toast("Betaling kommer snart — gem kurven så er den her når den åbner.")}
              >
                Til kassen
              </button>
              <button onClick={() => cart.clear()} style={{ width: "100%", marginTop: 12, fontSize: 13, color: "var(--ink-500)" }}>
                Tøm kurv
              </button>
            </div>
          </div>
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
