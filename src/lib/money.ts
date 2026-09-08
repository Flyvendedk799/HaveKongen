// Money handling for the shop.
//
// Two units live in this codebase and mixing them up is the classic way to
// charge someone 100× too much, so they are named apart everywhere:
//
//   kroner — whole DKK, what the catalogue stores (base_price_dkk, price_dkk)
//            and what an admin types into the product editor.
//   øre    — 1/100 kr, what every computed amount uses (orders.total_oere,
//            line_total_oere …) so 25% moms and percentage discounts round
//            exactly once instead of drifting across a basket.
//
// The functions below mirror the SQL in 20260908100100_commerce_v2_functions.sql.
// They exist so the browser can show a total before the round-trip; the number
// that gets charged always comes back from the database.

export const DEFAULT_VAT_RATE = 0.25;

export const kronerToOere = (kroner: number): number => Math.round(kroner * 100);
export const oereToKroner = (oere: number): number => oere / 100;

/** "1.234,50 kr" — Danish grouping, always two decimals when they matter. */
export function formatOere(oere: number, opts: { alwaysDecimals?: boolean } = {}): string {
  const kroner = oere / 100;
  const hasFraction = oere % 100 !== 0;
  return (
    new Intl.NumberFormat("da-DK", {
      minimumFractionDigits: opts.alwaysDecimals || hasFraction ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(kroner) + " kr"
  );
}

/** For catalogue prices that are already whole kroner. */
export function formatKroner(kroner: number): string {
  return new Intl.NumberFormat("da-DK").format(kroner) + " kr";
}

/**
 * Danish VAT is quoted inclusive, so the tax already inside a gross amount is
 * gross × rate / (1 + rate). Rounded once, in øre — the same expression as
 * public.vat_of_gross().
 */
export function vatOfGross(grossOere: number, rate: number = DEFAULT_VAT_RATE): number {
  return Math.round((grossOere * rate) / (1 + rate));
}

/** The part of a gross amount that is not VAT. */
export function netOfGross(grossOere: number, rate: number = DEFAULT_VAT_RATE): number {
  return grossOere - vatOfGross(grossOere, rate);
}

export type QuoteLineInput = {
  unitPriceOere: number;
  qty: number;
  vatRate?: number;
};

export type LocalQuote = {
  subtotalOere: number;
  discountOere: number;
  shippingOere: number;
  vatOere: number;
  totalOere: number;
};

/**
 * Optimistic basket maths for instant UI feedback. Deliberately a mirror, not a
 * source of truth: quote_cart() re-derives all of this server-side and the
 * checkout shows *that* result before anything is charged.
 *
 * The discount is spread across lines in proportion to their value, with the
 * last line absorbing the rounding remainder, so the parts always sum back to
 * the whole — exactly what price_cart() does.
 */
export function computeLocalQuote(
  lines: QuoteLineInput[],
  opts: { discountOere?: number; shippingOere?: number; shippingVatRate?: number } = {},
): LocalQuote {
  const lineTotals = lines.map((l) => l.unitPriceOere * l.qty);
  const subtotalOere = lineTotals.reduce((s, n) => s + n, 0);
  const discountOere = Math.min(Math.max(0, opts.discountOere ?? 0), subtotalOere);
  const shippingOere = Math.max(0, opts.shippingOere ?? 0);

  let allocated = 0;
  let vatOere = 0;
  lineTotals.forEach((lineTotal, i) => {
    const isLast = i === lineTotals.length - 1;
    let lineDiscount = 0;
    if (discountOere > 0 && subtotalOere > 0) {
      if (isLast) {
        lineDiscount = discountOere - allocated;
      } else {
        lineDiscount = Math.floor((lineTotal * discountOere) / subtotalOere);
        allocated += lineDiscount;
      }
    }
    vatOere += vatOfGross(lineTotal - lineDiscount, lines[i].vatRate ?? DEFAULT_VAT_RATE);
  });

  vatOere += vatOfGross(shippingOere, opts.shippingVatRate ?? DEFAULT_VAT_RATE);

  return {
    subtotalOere,
    discountOere,
    shippingOere,
    vatOere,
    totalOere: subtotalOere - discountOere + shippingOere,
  };
}

/** "2-4 hverdage" / "1 hverdag" for a shipping method's ETA. */
export function formatEta(minDays: number, maxDays: number): string {
  if (minDays === maxDays) return `${minDays} ${minDays === 1 ? "hverdag" : "hverdage"}`;
  return `${minDays}-${maxDays} hverdage`;
}
