// Transactional email for Havekongen.
//
// Delivery goes through Resend when RESEND_API_KEY is configured. When it is
// not — local development, a preview stack — send() logs the rendered message
// and reports `skipped` instead of throwing, so an order can still be placed on
// a machine with no mail credentials. Callers must treat email as best-effort:
// a failed receipt never rolls back a paid order.

const FROM = Deno.env.get("EMAIL_FROM") ?? "Havekongen <ordre@havekongen.dk>";
const REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") ?? "hej@havekongen.dk";
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://havekongen.dk";

export type SendResult = { ok: boolean; skipped?: boolean; id?: string; error?: string };

export async function sendEmail(to: string, subject: string, html: string, text?: string): Promise<SendResult> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    console.log(`[email] no RESEND_API_KEY — would have sent "${subject}" to ${to}`);
    return { ok: true, skipped: true };
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        reply_to: REPLY_TO,
        subject,
        html,
        text: text ?? stripHtml(html),
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error(`[email] resend rejected (${r.status}): ${detail.slice(0, 400)}`);
      return { ok: false, error: `resend_${r.status}` };
    }
    const body = await r.json().catch(() => ({}));
    return { ok: true, id: body?.id };
  } catch (e) {
    console.error("[email] send failed", String(e));
    return { ok: false, error: "network" };
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|tr|h1|h2|h3|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const kr = (oere: number) => new Intl.NumberFormat("da-DK", { minimumFractionDigits: 2 }).format(oere / 100) + " kr";

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(heading: string, intro: string, bodyHtml: string, cta?: { label: string; href: string }): string {
  return `<!doctype html>
<html lang="da"><body style="margin:0;background:#f5f3ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#14271d">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden">
        <tr><td style="padding:28px 32px;background:#14271d;color:#f5f3ee">
          <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;opacity:.7">Havekongen</div>
          <div style="font-size:24px;margin-top:6px">${escapeHtml(heading)}</div>
        </td></tr>
        <tr><td style="padding:28px 32px">
          <p style="margin:0 0 18px;font-size:15px;line-height:1.6">${intro}</p>
          ${bodyHtml}
          ${
            cta
              ? `<p style="margin:26px 0 0"><a href="${escapeHtml(cta.href)}" style="display:inline-block;background:#14271d;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:14px">${escapeHtml(cta.label)}</a></p>`
              : ""
          }
        </td></tr>
        <tr><td style="padding:20px 32px;background:#f5f3ee;font-size:12px;color:#5c6b62;line-height:1.6">
          Havekongen ApS · CVR 44881230 · <a href="${SITE_URL}" style="color:#5c6b62">havekongen.dk</a><br>
          Spørgsmål? Svar på denne mail, så vender vi tilbage inden for 1-2 hverdage.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export type OrderLine = { name: string; variant_name?: string | null; qty: number; line_total_oere: number };

export type OrderEmailData = {
  order_no: string;
  order_id: string;
  lines: OrderLine[];
  subtotal_oere: number;
  discount_oere: number;
  shipping_oere: number;
  vat_oere: number;
  total_oere: number;
  shipping_address: Record<string, unknown> | null;
  payment?: { provider: string; instructions?: Record<string, unknown> | null } | null;
};

function lineTable(data: OrderEmailData): string {
  const rows = data.lines
    .map(
      (l) => `<tr>
        <td style="padding:8px 0;font-size:14px">${escapeHtml(l.qty)} × ${escapeHtml(l.name)}${
          l.variant_name ? ` <span style="color:#5c6b62">— ${escapeHtml(l.variant_name)}</span>` : ""
        }</td>
        <td style="padding:8px 0;font-size:14px;text-align:right;white-space:nowrap">${kr(l.line_total_oere)}</td>
      </tr>`,
    )
    .join("");

  const totalRow = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:4px 0;font-size:14px;color:#5c6b62">${label}</td>
     <td style="padding:4px 0;font-size:${strong ? "17px" : "14px"};text-align:right;${strong ? "font-weight:600" : ""}">${value}</td></tr>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e3ded4;border-bottom:1px solid #e3ded4;margin:8px 0">
      ${rows}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px">
      ${totalRow("Subtotal", kr(data.subtotal_oere))}
      ${data.discount_oere > 0 ? totalRow("Rabat", "−" + kr(data.discount_oere)) : ""}
      ${totalRow("Fragt", data.shipping_oere === 0 ? "Gratis" : kr(data.shipping_oere))}
      ${totalRow("Heraf moms (25%)", kr(data.vat_oere))}
      ${totalRow("Total", kr(data.total_oere), true)}
    </table>`;
}

function addressBlock(addr: Record<string, unknown> | null): string {
  if (!addr) return "";
  const parts = [addr.name, addr.street, addr.street2, `${addr.postal_code ?? ""} ${addr.city ?? ""}`.trim()]
    .filter((p) => p && String(p).trim())
    .map((p) => escapeHtml(p));
  return `<p style="margin:22px 0 0;font-size:13px;color:#5c6b62;line-height:1.6"><strong style="color:#14271d">Leveres til</strong><br>${parts.join("<br>")}</p>`;
}

export function orderConfirmationEmail(data: OrderEmailData): { subject: string; html: string } {
  const invoice = data.payment?.provider === "invoice" ? data.payment?.instructions ?? null : null;
  const payBlock = invoice
    ? `<div style="margin-top:22px;padding:16px 18px;background:#f5f3ee;border-radius:12px;font-size:13px;line-height:1.7">
         <strong>Betaling ved bankoverførsel</strong><br>
         Reg.nr. ${escapeHtml(invoice.reg_no)} · Konto ${escapeHtml(invoice.account_no)}<br>
         IBAN ${escapeHtml(invoice.iban)} · SWIFT ${escapeHtml(invoice.swift)}<br>
         Anfør <strong>${escapeHtml(data.order_no)}</strong> som besked til modtager.<br>
         Beløbet bedes overført inden ${escapeHtml(invoice.due_days ?? 8)} dage — vi pakker, så snart betalingen er registreret.
       </div>`
    : "";

  return {
    subject: `Ordrebekræftelse ${data.order_no} — Havekongen`,
    html: layout(
      `Tak for din ordre`,
      `Vi har modtaget ordre <strong>${escapeHtml(data.order_no)}</strong>. Her er kvitteringen.`,
      lineTable(data) + payBlock + addressBlock(data.shipping_address),
      { label: "Se ordren", href: `${SITE_URL}/order/${data.order_id}` },
    ),
  };
}

export function orderShippedEmail(data: {
  order_no: string;
  order_id: string;
  tracking_number?: string | null;
  carrier?: string | null;
}): { subject: string; html: string } {
  return {
    subject: `${data.order_no} er sendt — Havekongen`,
    html: layout(
      "Din pakke er på vej",
      `Ordre <strong>${escapeHtml(data.order_no)}</strong> har forladt vores lager.`,
      data.tracking_number
        ? `<p style="margin:0;font-size:14px;line-height:1.7">Pakkenummer: <strong>${escapeHtml(data.tracking_number)}</strong>${
            data.carrier ? ` (${escapeHtml(data.carrier)})` : ""
          }</p>`
        : `<p style="margin:0;font-size:14px">Du modtager et pakkenummer fra fragtmanden, så snart det er klar.</p>`,
      { label: "Følg ordren", href: `${SITE_URL}/order/${data.order_id}` },
    ),
  };
}

export function paymentReceivedEmail(data: { order_no: string; order_id: string; total_oere: number }): {
  subject: string;
  html: string;
} {
  return {
    subject: `Betaling modtaget for ${data.order_no}`,
    html: layout(
      "Betaling registreret",
      `Vi har modtaget ${kr(data.total_oere)} for ordre <strong>${escapeHtml(data.order_no)}</strong>. Den ryger på pakkebordet nu.`,
      "",
      { label: "Se ordren", href: `${SITE_URL}/order/${data.order_id}` },
    ),
  };
}
