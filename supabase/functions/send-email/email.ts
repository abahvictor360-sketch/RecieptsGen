// Builds a plain, safe HTML email from a RecieptsGen document and sends it with Resend.
// All values are escaped; the email never contains HTML supplied by the user.

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const n = (v: unknown) => {
  const x = parseFloat(String(v));
  return Number.isFinite(x) ? x : 0;
};
const fmt = (sym: string, v: number) =>
  sym + new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const safeUrl = (u: unknown) => {
  try {
    const x = new URL(String(u));
    return x.protocol === "https:" ? x.toString() : "";
  } catch {
    return "";
  }
};

// deno-lint-ignore no-explicit-any
export function totals(d: any) {
  const items = Array.isArray(d.items) ? d.items : [];
  const lines = items.map((it: any) => n(it.qty === "" || it.qty == null ? 1 : it.qty) * n(it.price));
  const subtotal = lines.reduce((a: number, b: number) => a + b, 0);
  const discount = Math.min(n(d.discount), subtotal);
  const tax = (subtotal - discount) * (n(d.taxRate) / 100);
  return { items, lines, subtotal, discount, tax, total: subtotal - discount + tax };
}

// deno-lint-ignore no-explicit-any
export function renderEmail(d: any, message: string, sender: string) {
  const t = totals(d);
  const sym = String(d.currency ?? "");
  const isRec = d.type === "receipt";
  const title = isRec ? "Receipt" : "Invoice";
  const from = d.from?.name || sender;
  const payLink = safeUrl(d.payLink);
  const rows = t.items
    .map(
      (it: any, i: number) => `<tr>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e5e5;vertical-align:top">
          <div style="font-weight:600">${esc(it.name)}${it.vendor ? ` &middot; ${esc(it.vendor)}` : ""}</div>
          ${it.desc ? `<div style="color:#666;font-size:13px">${esc(it.desc)}</div>` : ""}
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e5e5;vertical-align:top;white-space:nowrap">${esc(it.coverage)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e5e5;vertical-align:top;text-align:right;white-space:nowrap">${esc(fmt(sym, t.lines[i]))}</td>
      </tr>`,
    )
    .join("");
  const msg = esc(message || "").replace(/\n/g, "<br>");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#111">
  <div style="max-width:600px;margin:0 auto;padding:24px 12px">
    <div style="background:#fff;border-radius:10px;padding:24px">
      <div style="font-size:13px;color:#666">${esc(from)}</div>
      <h1 style="margin:4px 0 16px;font-size:22px;letter-spacing:2px">${title.toUpperCase()} ${esc(d.number)}</h1>
      ${msg ? `<p style="margin:0 0 16px;line-height:1.5">${msg}</p>` : ""}
      <p style="margin:0 0 16px;color:#444;font-size:14px">Billed to: <b>${esc(d.bill?.name)}</b>${d.bill?.email ? ` (${esc(d.bill.email)})` : ""}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead><tr>
          <th style="text-align:left;padding:8px;border-top:2px solid #111;border-bottom:1px solid #111">Item</th>
          <th style="text-align:left;padding:8px;border-top:2px solid #111;border-bottom:1px solid #111">Coverage</th>
          <th style="text-align:right;padding:8px;border-top:2px solid #111;border-bottom:1px solid #111">Amount</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <table style="width:100%;margin-top:12px;font-size:14px">
        <tr><td>Subtotal</td><td style="text-align:right">${esc(fmt(sym, t.subtotal))}</td></tr>
        ${t.discount > 0 ? `<tr><td>Discount</td><td style="text-align:right">-${esc(fmt(sym, t.discount))}</td></tr>` : ""}
        ${t.tax > 0 ? `<tr><td>${esc(d.taxLabel || "Tax")}</td><td style="text-align:right">${esc(fmt(sym, t.tax))}</td></tr>` : ""}
        <tr><td style="font-weight:700;font-size:16px;padding-top:8px;border-top:2px solid #111">${isRec ? "Total paid" : "Total due"}</td>
            <td style="font-weight:700;font-size:16px;padding-top:8px;border-top:2px solid #111;text-align:right">${esc(fmt(sym, t.total))}</td></tr>
      </table>
      ${payLink && !isRec ? `<p style="margin:20px 0 0;text-align:center"><a href="${esc(payLink)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">Pay now</a></p>` : ""}
    </div>
    <p style="text-align:center;color:#999;font-size:12px;margin-top:14px">Sent with RecieptsGen</p>
  </div></body></html>`;
  return { html, subject: `${title} ${d.number} from ${from}` };
}

export async function sendResend(to: string, subject: string, html: string, replyTo?: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM");
  if (!key || !from) throw new Error("Email is not configured yet");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, reply_to: replyTo ? [replyTo] : undefined }),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b?.message ?? `Email failed (${res.status})`);
  }
}

export const isEmail = (s: unknown) => typeof s === "string" && s.length < 255 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s);
