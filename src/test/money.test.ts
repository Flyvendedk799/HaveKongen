import { describe, expect, it } from "vitest";
import {
  DEFAULT_VAT_RATE,
  computeLocalQuote,
  formatEta,
  formatKroner,
  formatOere,
  kronerToOere,
  netOfGross,
  oereToKroner,
  vatOfGross,
} from "@/lib/money";

describe("unit conversion", () => {
  it("round-trips kroner through øre", () => {
    expect(kronerToOere(49)).toBe(4900);
    expect(oereToKroner(4900)).toBe(49);
  });

  it("rounds fractional kroner to whole øre", () => {
    // 0.1 + 0.2 style float noise must not leak into a stored amount.
    expect(kronerToOere(19.995)).toBe(2000);
    expect(kronerToOere(19.994)).toBe(1999);
  });
});

describe("formatting", () => {
  it("omits decimals for whole-krone amounts and shows them otherwise", () => {
    // Intl uses a non-breaking space before the currency word; compare on the
    // digits so the test does not depend on that codepoint.
    expect(formatOere(4900).startsWith("49")).toBe(true);
    expect(formatOere(4900)).not.toContain(",");
    expect(formatOere(4950)).toContain("49,50");
  });

  it("can force decimals", () => {
    expect(formatOere(4900, { alwaysDecimals: true })).toContain("49,00");
  });

  it("groups thousands in Danish style", () => {
    expect(formatKroner(12995)).toMatch(/12\.995/);
  });

  it("describes delivery windows", () => {
    expect(formatEta(2, 4)).toBe("2-4 hverdage");
    expect(formatEta(1, 1)).toBe("1 hverdag");
    expect(formatEta(3, 3)).toBe("3 hverdage");
  });
});

describe("VAT", () => {
  it("extracts 25% moms from a gross amount", () => {
    // 125 kr incl. VAT contains exactly 25 kr of VAT.
    expect(vatOfGross(12500, 0.25)).toBe(2500);
    expect(netOfGross(12500, 0.25)).toBe(10000);
  });

  it("defaults to the Danish rate", () => {
    expect(DEFAULT_VAT_RATE).toBe(0.25);
    expect(vatOfGross(12500)).toBe(2500);
  });

  it("rounds to whole øre", () => {
    // 49 kr gross → 9.80 kr VAT exactly.
    expect(vatOfGross(4900)).toBe(980);
    // 33 kr gross → 6.60 kr.
    expect(vatOfGross(3300)).toBe(660);
    // An amount that does not divide evenly still yields an integer.
    expect(Number.isInteger(vatOfGross(3333))).toBe(true);
  });

  it("handles a zero-rated line", () => {
    expect(vatOfGross(10000, 0)).toBe(0);
    expect(netOfGross(10000, 0)).toBe(10000);
  });
});

describe("computeLocalQuote", () => {
  it("sums lines and adds shipping", () => {
    const q = computeLocalQuote(
      [
        { unitPriceOere: 4900, qty: 2 },
        { unitPriceOere: 12500, qty: 1 },
      ],
      { shippingOere: 4900 },
    );
    expect(q.subtotalOere).toBe(9800 + 12500);
    expect(q.totalOere).toBe(9800 + 12500 + 4900);
  });

  it("puts the whole discount into the lines, with no rounding leak", () => {
    // Three odd-priced lines and a discount that cannot divide evenly: the
    // allocated parts must still sum back to the discount exactly.
    const lines = [
      { unitPriceOere: 3333, qty: 1 },
      { unitPriceOere: 6667, qty: 1 },
      { unitPriceOere: 1000, qty: 3 },
    ];
    const discountOere = 1777;
    const q = computeLocalQuote(lines, { discountOere });

    expect(q.discountOere).toBe(discountOere);
    expect(q.totalOere).toBe(q.subtotalOere - discountOere);
    // VAT is 20% of a 25%-inclusive gross; check it tracks the discounted total.
    expect(q.vatOere).toBe(vatOfGross(q.totalOere));
  });

  it("never discounts below zero", () => {
    const q = computeLocalQuote([{ unitPriceOere: 1000, qty: 1 }], { discountOere: 5000 });
    expect(q.discountOere).toBe(1000);
    expect(q.totalOere).toBe(0);
  });

  it("charges VAT on shipping at the standard rate", () => {
    const q = computeLocalQuote([{ unitPriceOere: 10000, qty: 1, vatRate: 0 }], { shippingOere: 4900 });
    // Goods are zero-rated here, so all the VAT comes from the shipping line.
    expect(q.vatOere).toBe(vatOfGross(4900, 0.25));
  });

  it("treats an empty basket as zero, not NaN", () => {
    const q = computeLocalQuote([], { shippingOere: 4900, discountOere: 100 });
    expect(q.subtotalOere).toBe(0);
    expect(q.discountOere).toBe(0);
    expect(q.totalOere).toBe(4900);
    expect(Number.isNaN(q.vatOere)).toBe(false);
  });

  it("mixes VAT rates per line", () => {
    const q = computeLocalQuote([
      { unitPriceOere: 12500, qty: 1, vatRate: 0.25 },
      { unitPriceOere: 10000, qty: 1, vatRate: 0 },
    ]);
    expect(q.vatOere).toBe(2500);
  });
});
