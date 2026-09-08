import type { Tables } from "@/integrations/supabase/types";

/**
 * The lifecycle of an order, drawn from two sources: the milestone timestamps on
 * the order row (which say where it is) and order_events (which say what
 * happened). The milestones give a stable skeleton even for an order placed
 * before the event log existed.
 */

export type Step = { key: string; label: string; at: string | null; note?: string };

export type TimelineOrder = Pick<
  Tables<"orders">,
  "created_at" | "placed_at" | "paid_at" | "shipped_at" | "delivered_at" | "cancelled_at" | "refunded_at" | "status"
>;

/**
 * Turn an order's milestone timestamps into the steps to draw.
 *
 * A cancelled order does not show "afventer betaling" for a payment that will
 * never come — it collapses to received → cancelled. Extracted from the
 * component so the branching is unit-testable.
 */
export function deriveSteps(order: TimelineOrder): { steps: Step[]; nextIndex: number } {
  const cancelled = Boolean(order.cancelled_at) || order.status === "cancelled";

  const steps: Step[] = cancelled
    ? [
        { key: "placed", label: "Modtaget", at: order.placed_at ?? order.created_at },
        { key: "cancelled", label: "Annulleret", at: order.cancelled_at },
      ]
    : [
        { key: "placed", label: "Modtaget", at: order.placed_at ?? order.created_at },
        { key: "paid", label: "Betalt", at: order.paid_at },
        { key: "shipped", label: "Afsendt", at: order.shipped_at },
        { key: "delivered", label: "Leveret", at: order.delivered_at },
      ];

  if (order.refunded_at) steps.push({ key: "refunded", label: "Refunderet", at: order.refunded_at });

  // The first step without a timestamp is the one we are waiting on.
  return { steps, nextIndex: steps.findIndex((s) => !s.at) };
}

const EVENT_LABELS: Record<string, string> = {
  order_placed: "Ordre modtaget",
  payment_initiated: "Betaling forberedt",
  payment_captured: "Betaling bekræftet",
  payment_failed: "Betaling mislykkedes",
  payment_rejected: "Betaling afvist",
  admin_update: "Opdateret af Havekongen",
  order_cancelled: "Annulleret",
  return_requested: "Returnering anmodet",
  return_approved: "Returnering godkendt",
  return_received: "Retur modtaget",
  return_refunded: "Beløb refunderet",
  return_rejected: "Returnering afvist",
};

const fmt = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
        new Date(iso),
      )
    : null;

export function OrderTimeline({ order, events }: { order: TimelineOrder; events: Tables<"order_events">[] }) {
  const { steps, nextIndex } = deriveSteps(order);

  return (
    <div className="order-timeline">
      <ol className="timeline-steps">
        {steps.map((s, i) => {
          const done = Boolean(s.at);
          const current = !done && i === nextIndex;
          return (
            <li key={s.key} className={`timeline-step${done ? " is-done" : ""}${current ? " is-current" : ""}`}>
              <span className="dot" aria-hidden />
              <span className="label">{s.label}</span>
              <span className="when">{fmt(s.at) ?? (current ? "Afventer" : "")}</span>
            </li>
          );
        })}
      </ol>

      {events.length > 0 && (
        <details className="timeline-log">
          <summary>Detaljeret log ({events.length})</summary>
          <ul>
            {events.map((e) => (
              <li key={e.id}>
                <time dateTime={e.created_at}>{fmt(e.created_at)}</time>
                <span>{EVENT_LABELS[e.kind] ?? e.kind}</span>
                {e.message && <em>{e.message}</em>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
