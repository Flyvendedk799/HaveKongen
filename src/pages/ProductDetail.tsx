import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { supabase } from "@/integrations/supabase/client";
import { useCart, formatDkk } from "@/lib/cart";
import { toast } from "sonner";

type Product = {
  id: string;
  slug: string;
  name: string;
  category: string;
  short_description: string | null;
  description: string | null;
  base_price_dkk: number;
  gradient: string | null;
  svg_art: string | null;
  meta: string | null;
  in_stock: boolean;
};

export default function ProductDetail() {
  const { slug } = useParams();
  const [p, setP] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);
  const cart = useCart();
  const nav = useNavigate();

  useEffect(() => {
    if (!slug) return;
    supabase.from("products").select("*").eq("slug", slug).maybeSingle().then(({ data }) => {
      setP(data as Product | null);
      if (data) document.title = `${(data as Product).name} · Havelandet`;
    });
  }, [slug]);

  if (!p) {
    return (
      <>
        <AppNav active="shop" />
        <div className="container" style={{ padding: "60px 32px" }}>Henter…</div>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <AppNav active="shop" />
      <div className="container" style={{ padding: "40px 0" }}>
        <Link to="/webshop" style={{ fontSize: 13, color: "var(--ink-500)" }}>← Webshop</Link>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60, marginTop: 24, alignItems: "start" }}>
          <div className="product-img" style={{ background: p.gradient || "var(--mist-100)", aspectRatio: "1", borderRadius: "var(--r-lg)" }}>
            {p.svg_art && <div dangerouslySetInnerHTML={{ __html: p.svg_art }} />}
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 12 }}>{p.category}</div>
            <h1 style={{ fontSize: 48, marginBottom: 8 }}>{p.name}</h1>
            <p style={{ color: "var(--ink-500)", marginBottom: 24 }}>{p.meta}</p>
            <p style={{ fontSize: 17, lineHeight: 1.6, marginBottom: 32 }}>{p.description || p.short_description}</p>
            <div style={{ fontSize: 32, fontFamily: "var(--serif)", marginBottom: 24 }}>{formatDkk(p.base_price_dkk)}</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <input
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                style={{ width: 72, padding: 12, borderRadius: 8, border: "1px solid rgba(20,39,29,0.15)" }}
              />
              <button
                className="btn btn-primary"
                onClick={() => {
                  cart.add({
                    productId: p.id,
                    name: p.name,
                    unitPriceDkk: p.base_price_dkk,
                    qty,
                    imageGradient: p.gradient || undefined,
                    imageSvg: p.svg_art || undefined,
                  });
                  toast.success(`${p.name} tilføjet til kurven`);
                }}
              >
                Læg i kurv
              </button>
              <button
                className="btn btn-gold"
                onClick={() => {
                  cart.add({
                    productId: p.id,
                    name: p.name,
                    unitPriceDkk: p.base_price_dkk,
                    qty,
                    imageGradient: p.gradient || undefined,
                    imageSvg: p.svg_art || undefined,
                  });
                  nav("/cart");
                }}
              >
                Køb nu
              </button>
            </div>
          </div>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
