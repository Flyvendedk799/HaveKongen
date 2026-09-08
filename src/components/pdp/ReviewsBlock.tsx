import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Clock, Loader2, Phone, RotateCcw, Star, Truck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { fetchReviews, submitReview, type ProductReview } from "@/lib/shop";
import { toast } from "sonner";

/**
 * Product reviews, read from product_reviews.
 *
 * v1 shipped three invented testimonials that were the same on every product.
 * These are the real thing: only `approved` rows are visible to the public (the
 * RLS policy also lets an author see their own while it waits), verified
 * purchases are marked as such by a database trigger rather than by whoever is
 * typing, and the aggregate is computed from what is actually shown.
 */
export function ReviewsBlock({ productId, productName }: { productId: string; productName: string }) {
  const { user } = useAuth();
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReviews(await fetchReviews(productId));
    } catch (e) {
      console.warn("[reviews] load failed", e);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const approved = useMemo(() => reviews.filter((r) => r.status === "approved"), [reviews]);
  const mine = useMemo(() => (user ? reviews.find((r) => r.user_id === user.id) : undefined), [reviews, user]);

  const avg = approved.length ? approved.reduce((s, r) => s + r.rating, 0) / approved.length : 0;
  const histogram = useMemo(() => {
    const buckets = [5, 4, 3, 2, 1].map((star) => ({
      star,
      count: approved.filter((r) => r.rating === star).length,
    }));
    return buckets;
  }, [approved]);

  return (
    <section className="pdp-reviews">
      <div className="pdp-reviews-head">
        <div style={{ flex: "1 1 320px" }}>
          <div className="eyebrow">Anmeldelser</div>
          {approved.length > 0 ? (
            <>
              <h2>
                {avg.toFixed(1)} af 5 — {approved.length} {approved.length === 1 ? "anmeldelse" : "anmeldelser"}
              </h2>
              <div className="review-summary">
                <div className="review-score">
                  <Stars value={Math.round(avg)} size={18} />
                </div>
                <div className="review-bars">
                  {histogram.map((b) => (
                    <div key={b.star} className="review-bar">
                      <span>{b.star} ★</span>
                      <span className="track">
                        <span
                          className="fill"
                          style={{ width: approved.length ? `${(b.count / approved.length) * 100}%` : "0%" }}
                        />
                      </span>
                      <span>{b.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <h2>Ingen anmeldelser endnu</h2>
          )}
        </div>

        <div className="pdp-trust">
          <div><Truck size={18} /> Fri fragt over 499 kr</div>
          <div><RotateCcw size={18} /> 30 dages retur</div>
          <div><Phone size={18} /> Dansk kundeservice</div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: "26px 0", color: "var(--ink-500)" }}>
          <Loader2 size={16} className="spin" /> Henter anmeldelser…
        </div>
      ) : approved.length === 0 && !mine ? (
        <p style={{ color: "var(--ink-500)", maxWidth: "60ch" }}>
          Vær den første til at fortælle, hvordan {productName} klarer sig i din have. Vi viser
          anmeldelser, når de er gennemlæst — så du kan regne med dem, du ser.
        </p>
      ) : (
        <div className="review-list">
          {mine && mine.status !== "approved" && <ReviewCard review={mine} pending />}
          {approved.map((r) => <ReviewCard key={r.id} review={r} />)}
        </div>
      )}

      {user ? (
        writing || (!mine && approved.length === 0) ? (
          <ReviewForm
            productId={productId}
            existing={mine}
            onDone={() => {
              setWriting(false);
              void load();
            }}
          />
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 20 }} onClick={() => setWriting(true)}>
            {mine ? "Redigér din anmeldelse" : "Skriv en anmeldelse"}
          </button>
        )
      ) : (
        <p style={{ marginTop: 20, fontSize: 13.5, color: "var(--ink-500)" }}>
          <Link to="/login">Log ind</Link> for at skrive en anmeldelse.
        </p>
      )}
    </section>
  );
}

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="pdp-stars" aria-label={`${value} ud af 5 stjerner`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} size={size} fill={i < value ? "currentColor" : "none"} aria-hidden />
      ))}
    </span>
  );
}

function ReviewCard({ review, pending }: { review: ProductReview; pending?: boolean }) {
  return (
    <article className="review-item">
      <Stars value={review.rating} />
      {review.title && <h4>{review.title}</h4>}
      {review.body && <p>{review.body}</p>}
      <div className="review-meta">
        <span>{review.author_name || "Havekongen-kunde"}</span>
        <span>
          {new Intl.DateTimeFormat("da-DK", { year: "numeric", month: "long" }).format(new Date(review.created_at))}
        </span>
        {review.verified_purchase && (
          <span className="verified-badge"><BadgeCheck size={12} /> Verificeret køb</span>
        )}
        {pending && (
          <span className="pending-badge"><Clock size={12} /> Afventer godkendelse — kun du kan se den</span>
        )}
      </div>
    </article>
  );
}

function ReviewForm({
  productId,
  existing,
  onDone,
}: {
  productId: string;
  existing?: ProductReview;
  onDone: () => void;
}) {
  const [rating, setRating] = useState(existing?.rating ?? 5);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [authorName, setAuthorName] = useState(existing?.author_name ?? "");
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await submitReview({ productId, rating, title, body, authorName });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(result.message);
    onDone();
  }

  return (
    <form className="review-form" onSubmit={save}>
      <div>
        <label style={{ display: "block", fontSize: 13, color: "var(--ink-500)", marginBottom: 6 }}>
          Din vurdering
        </label>
        <div className="rating-input" role="radiogroup" aria-label="Vurdering">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} ${n === 1 ? "stjerne" : "stjerner"}`}
              onClick={() => setRating(n)}
            >
              <Star size={24} fill={n <= rating ? "currentColor" : "none"} />
            </button>
          ))}
        </div>
      </div>

      <input
        type="text"
        placeholder="Overskrift (valgfri)"
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 120))}
      />
      <textarea
        rows={4}
        placeholder="Hvordan har den klaret sig i din have?"
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 2000))}
      />
      <input
        type="text"
        placeholder="Navn der vises (fx 'Mette H.')"
        value={authorName}
        onChange={(e) => setAuthorName(e.target.value.slice(0, 60))}
      />

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
          {saving ? "Sender…" : existing ? "Opdatér anmeldelse" : "Send anmeldelse"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>Fortryd</button>
      </div>
      <p style={{ fontSize: 12, color: "var(--ink-500)", margin: 0 }}>
        Anmeldelser læses igennem, før de vises. Har du købt varen her, markeres den automatisk som
        verificeret køb.
      </p>
    </form>
  );
}
