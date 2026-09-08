import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { supabase } from "@/integrations/supabase/client";
import { useCart } from "@/lib/cart";
import { useWishlist } from "@/lib/wishlist";
import { useAuth } from "@/lib/auth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { track } from "@/lib/analytics";
import { toast } from "sonner";
import { HeroStage } from "@/components/pdp/HeroStage";
import { StickyMediaStage } from "@/components/pdp/StickyMediaStage";
import { StickyBuyBar } from "@/components/pdp/StickyBuyBar";
import { FitInGarden } from "@/components/pdp/FitInGarden";
import { SpecsGrid } from "@/components/pdp/SpecsGrid";
import { StoryBand } from "@/components/pdp/StoryBand";
import { ReviewsBlock } from "@/components/pdp/ReviewsBlock";
import { BundleRow } from "@/components/pdp/BundleRow";
import { ProductCarousel } from "@/components/pdp/ProductCarousel";

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
  image_url: string | null;
  in_stock: boolean;
  stock_qty: number;
  track_inventory: boolean;
  low_stock_threshold: number;
  rating_avg: number;
  rating_count: number;
  active: boolean;
  sku: string | null;
};

const RV_KEY = "havekongen-recently-viewed";
function pushRecent(slug: string) {
  try {
    const arr: string[] = JSON.parse(localStorage.getItem(RV_KEY) || "[]");
    const next = [slug, ...arr.filter((s) => s !== slug)].slice(0, 6);
    localStorage.setItem(RV_KEY, JSON.stringify(next));
  } catch {}
}

export default function ProductDetail() {
  const { slug } = useParams();
  const [p, setP] = useState<Product | null>(null);
  const [related, setRelated] = useState<Product[]>([]);
  const [recent, setRecent] = useState<Product[]>([]);
  const [qty, setQty] = useState(1);
  const cart = useCart();
  const wishlist = useWishlist();
  const { user } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (!slug) return;
    setP(null);
    supabase.from("products").select("*").eq("slug", slug).eq("active", true).maybeSingle().then(async ({ data }) => {
      const prod = data as Product | null;
      setP(prod);
      if (prod) {
        track("pdp_view", { slug: prod.slug, category: prod.category });
        pushRecent(prod.slug);
        const { data: rel } = await supabase
          .from("products")
          .select("*")
          .eq("category", prod.category)
          .eq("active", true)
          .neq("id", prod.id)
          .limit(6);
        setRelated((rel as Product[]) || []);
        const slugs: string[] = JSON.parse(localStorage.getItem(RV_KEY) || "[]");
        const others = slugs.filter((s) => s !== prod.slug).slice(0, 6);
        if (others.length) {
          const { data: rv } = await supabase.from("products").select("*").in("slug", others);
          setRecent((rv as Product[]) || []);
        } else setRecent([]);
        window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
      }
    });
  }, [slug]);

  useEffect(() => { if (user) wishlist.load(); }, [user]); // eslint-disable-line

  // Availability follows the same rule as the pricing engine: a counted item is
  // limited by stock_qty, an uncounted one by the in_stock flag.
  const availability = useMemo(() => {
    if (!p) return { sellable: false, label: "Udsolgt", tone: "out" as const, max: 0 };
    if (p.track_inventory) {
      if (p.stock_qty <= 0) return { sellable: false, label: "Udsolgt", tone: "out" as const, max: 0 };
      if (p.stock_qty <= p.low_stock_threshold) {
        return { sellable: true, label: `Kun ${p.stock_qty} tilbage`, tone: "low" as const, max: p.stock_qty };
      }
      return { sellable: true, label: "På lager", tone: "in" as const, max: p.stock_qty };
    }
    return p.in_stock
      ? { sellable: true, label: "På lager", tone: "in" as const, max: 99 }
      : { sellable: false, label: "Udsolgt", tone: "out" as const, max: 0 };
  }, [p]);

  // JSON-LD. aggregateRating is only emitted when real approved reviews exist —
  // Google treats a fabricated rating as a structured-data violation, and it
  // would be a lie besides.
  const jsonLd = useMemo(() => (p ? {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: p.description || p.short_description || undefined,
    category: p.category,
    sku: p.sku || undefined,
    brand: { "@type": "Brand", name: "Havekongen" },
    offers: {
      "@type": "Offer",
      url: typeof window !== "undefined" ? window.location.href : undefined,
      price: p.base_price_dkk,
      priceCurrency: "DKK",
      availability: availability.sellable ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      hasMerchantReturnPolicy: {
        "@type": "MerchantReturnPolicy",
        applicableCountry: "DK",
        returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
        merchantReturnDays: 30,
      },
    },
    ...(p.rating_count > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: Number(p.rating_avg).toFixed(1),
            reviewCount: p.rating_count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  } : null), [p, availability]);

  usePageMeta({
    title: p ? `${p.name} · Havekongen` : "Produkt · Havekongen",
    description: p?.short_description || p?.meta || undefined,
    image: p?.image_url || undefined,
    jsonLd,
  });

  const specs = useMemo(() => {
    if (!p) return [];
    return [
      { label: "Kategori", value: p.category },
      { label: "Lager", value: availability.label },
      p.sku ? { label: "Varenummer", value: p.sku } : null,
      { label: "Egnet til", value: p.meta || "Have & terrasse" },
      { label: "Oprindelse", value: "Designet i Danmark" },
      { label: "Moms", value: "Prisen er inkl. 25% moms" },
      { label: "Retur", value: "30 dages retur · 14 dages fortrydelsesret" },
    ].filter(Boolean) as { label: string; value: string }[];
  }, [p, availability]);

  if (!p) {
    return (
      <>
        <AppNav active="shop" />
        <div className="container" style={{ padding: "120px 32px" }}>Henter…</div>
        <SiteFooter />
      </>
    );
  }

  const addToCart = () => {
    if (!availability.sellable) {
      toast.error(`${p.name} er udsolgt lige nu.`);
      return;
    }
    // Clamp here as well as in the database: better to tell someone now than to
    // let them reach the checkout and be told the basket has to shrink.
    const wanted = Math.min(qty, availability.max);
    if (wanted < qty) {
      toast.warning(`Vi har kun ${availability.max} stk. på lager — kurven er sat til det.`);
      setQty(wanted);
    }
    cart.add({
      productId: p.id,
      name: p.name,
      unitPriceDkk: p.base_price_dkk,
      qty: wanted,
      imageGradient: p.gradient || undefined,
      imageSvg: p.svg_art || undefined,
    });
    toast.success(`${p.name} tilføjet`);
  };
  const buyNow = () => { addToCart(); nav("/checkout"); };

  const wished = wishlist.has(p.id);
  const onWish = async () => {
    if (!user) { toast("Log ind for at gemme favoritter."); return; }
    await wishlist.toggle(p.id);
  };


  const bundleItems = related.slice(0, 2).length === 2
    ? [{ id: p.id, name: p.name, base_price_dkk: p.base_price_dkk, gradient: p.gradient, svg_art: p.svg_art }, ...related.slice(0, 2)]
    : [];

  return (
    <>
      <AppNav active="shop" />

      <div className="pdp-crumbs container">
        <Link to="/webshop">← Webshop</Link>
        <span> / {p.category} / {p.name}</span>
      </div>

      <HeroStage
        name={p.name}
        category={p.category}
        meta={p.meta}
        short={p.short_description}
        price={p.base_price_dkk}
        inStock={availability.sellable}
        gradient={p.gradient}
        svg={p.svg_art}
        qty={qty}
        setQty={setQty}
        onAdd={addToCart}
        onBuy={buyNow}
        onWish={onWish}
        wished={wished}
      />

      <StickyMediaStage gradient={p.gradient} svg={p.svg_art} />

      <div className="container">
        <FitInGarden productName={p.name} />
        <SpecsGrid specs={specs} />
      </div>

      <StoryBand gradient={p.gradient} name={p.name} body={p.description || p.short_description} />

      <div className="container">
        <ReviewsBlock productId={p.id} productName={p.name} />
        {bundleItems.length > 0 && <BundleRow items={bundleItems} />}
        <ProductCarousel title="Relaterede produkter" items={related.slice(0, 6)} />
        {recent.length > 0 && <ProductCarousel title="Set for nylig" items={recent} />}
      </div>

      <StickyBuyBar
        name={p.name}
        price={p.base_price_dkk}
        qty={qty}
        setQty={setQty}
        onAdd={addToCart}
        onBuy={buyNow}
        inStock={availability.sellable}
      />

      <SiteFooter />
    </>
  );
}
