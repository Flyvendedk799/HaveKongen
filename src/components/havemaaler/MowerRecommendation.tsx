import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Bot, Check, Info, Loader2, Ruler, TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatKroner } from "@/lib/money";
import {
  computeMowerProfile,
  matchMowers,
  type FitVerdict,
  type MowerMatch,
  type MowerProduct,
} from "@/lib/mowerFit";
import type { GardenDepthModel } from "@/lib/gardenDepth";

/**
 * The payoff for Havemåler step 2.
 *
 * The builder measures a garden — area, slope, obstacles, the tightest gap the
 * machine has to fit through — and this turns that into "buy this one, not that
 * one, and here is why". It recomputes on every change, so confirming one more
 * tree visibly sharpens the answer rather than just adding to a 3D render.
 */

const VERDICT: Record<FitVerdict, { label: string; className: string }> = {
  good: { label: "Passer", className: "is-good" },
  tight: { label: "Tæt på", className: "is-tight" },
  unsuitable: { label: "Passer ikke", className: "is-bad" },
};

export function MowerRecommendation({ model }: { model: GardenDepthModel }) {
  const [products, setProducts] = useState<MowerProduct[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  const profile = useMemo(() => computeMowerProfile(model), [model]);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("products")
      .select("id, slug, name, base_price_dkk, mower_specs")
      .eq("category", "robot")
      .eq("active", true)
      .not("mower_specs", "is", null)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn("[mower] could not load the catalogue", error.message);
          setProducts([]);
          return;
        }
        setProducts((data ?? []) as MowerProduct[]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const matches = useMemo(
    () => (products ? matchMowers(profile, products) : []),
    [profile, products],
  );

  const fitting = matches.filter((m) => m.verdict !== "unsuitable");
  const visible = showAll ? matches : matches.slice(0, 3);

  return (
    <section className="mower-rec">
      <div className="mower-rec__head">
        <Bot size={16} />
        <div>
          <strong>Hvilken robotklipper passer?</strong>
          <span>Beregnet ud fra din opmåling — jo mere du bekræfter, jo skarpere svar.</span>
        </div>
      </div>

      <dl className="mower-rec__facts">
        <Fact label="Græsflade" value={`${profile.areaM2} m²`} />
        <Fact
          label="Stejleste fald"
          value={profile.slopeUnknown ? "ukendt" : `${Math.round(profile.maxSlopePct ?? 0)}%`}
          muted={profile.slopeUnknown}
        />
        <Fact label="Forhindringer" value={String(profile.obstacleCount)} />
        <Fact
          label="Smalleste passage"
          value={profile.narrowestPassageM == null ? "—" : `${Math.round(profile.narrowestPassageM * 100)} cm`}
          muted={profile.narrowestPassageM == null}
        />
      </dl>

      {profile.zoneCount > 1 && (
        <p className="mower-rec__note">
          <Info size={12} /> Haven har {profile.zoneCount} adskilte græsflader. De fleste modeller skal
          hjælpes imellem dem.
        </p>
      )}
      {profile.hasLevelChange && (
        <p className="mower-rec__note">
          <TriangleAlert size={12} /> Der er trin eller støttemur i haven — en robotklipper kan ikke
          forcere niveauspring.
        </p>
      )}
      {profile.obstacleCount === 0 && (
        <p className="mower-rec__note">
          <Ruler size={12} /> Bekræft træer, bede og skure på kortet, så kan vi regne på passager og
          forhindringer.
        </p>
      )}

      {products === null ? (
        <div className="mower-rec__empty"><Loader2 size={14} className="spin" /> Henter modeller…</div>
      ) : matches.length === 0 ? (
        <div className="mower-rec__empty">
          <AlertTriangle size={14} />
          <span>
            Ingen robotklippere har specifikationer endnu. Udfyld areal, hældning og passagebredde
            på produkterne i admin, så beregner vi anbefalingen her.
          </span>
        </div>
      ) : (
        <>
          <div className="mower-rec__verdict">
            {fitting.length > 0
              ? `${fitting.length} af ${matches.length} modeller passer til din have`
              : "Ingen af vores modeller dækker hele haven"}
          </div>

          <ul className="mower-list">
            {visible.map((match) => (
              <MowerRow key={match.productId} match={match} />
            ))}
          </ul>

          {matches.length > 3 && (
            <button type="button" className="mower-rec__more" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Vis færre" : `Vis alle ${matches.length} modeller`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Fact({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`mower-fact${muted ? " is-muted" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function MowerRow({ match }: { match: MowerMatch }) {
  const verdict = VERDICT[match.verdict];
  // The blocking reasons are what a customer needs first; a clean fit shows its
  // headline reason instead.
  const shown =
    match.verdict === "unsuitable"
      ? match.reasons.filter((r) => r.tone === "bad")
      : match.reasons.filter((r) => r.tone === "warn").length > 0
        ? match.reasons.filter((r) => r.tone === "warn")
        : match.reasons.slice(0, 1);

  return (
    <li className={`mower-row ${verdict.className}`}>
      <div className="mower-row__head">
        <Link to={`/webshop/${match.slug}`} className="mower-row__name">
          {match.name}
        </Link>
        <span className={`mower-badge ${verdict.className}`}>
          {match.verdict === "good" && <Check size={11} />}
          {verdict.label}
        </span>
      </div>

      <div className="mower-row__meta">
        {formatKroner(match.priceDkk)} · op til {match.spec.maxAreaM2} m² · {match.spec.maxSlopePct}% fald
      </div>

      <ul className="mower-row__reasons">
        {shown.slice(0, 3).map((reason, i) => (
          <li key={i} className={`tone-${reason.tone}`}>{reason.text}</li>
        ))}
      </ul>

      {match.verdict !== "unsuitable" && (
        <Link to={`/webshop/${match.slug}`} className="mower-row__cta">
          Se model <ArrowRight size={12} />
        </Link>
      )}
    </li>
  );
}
