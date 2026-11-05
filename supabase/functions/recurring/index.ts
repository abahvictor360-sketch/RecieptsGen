// Runs once a day (pg_cron). Creates the next invoice for every due recurring rule of a Pro
// account, saves it to the owner's cloud documents and optionally emails the client.
// Safe to call more than once: each rule only runs when next_run is due, then moves forward.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { isEmail, renderEmail, sendResend } from "./email.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

function addInterval(dateIso: string, every: string) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (every === "weekly") dt.setUTCDate(dt.getUTCDate() + 7);
  else if (every === "monthly") dt.setUTCMonth(dt.getUTCMonth() + 1);
  else if (every === "quarterly") dt.setUTCMonth(dt.getUTCMonth() + 3);
  else dt.setUTCFullYear(dt.getUTCFullYear() + 1);
  return dt.toISOString().slice(0, 10);
}

function nextNumber(base: string, run: number) {
  // INV-2026-0007 -> INV-2026-0007-R2, keeps numbers unique per rule.
  return `${base}-R${run}`;
}

Deno.serve(async (req) => {
  // Only the pg_cron job knows this secret (stored in Supabase Vault).
  const secret = req.headers.get("x-cron-secret") ?? "";
  const { data: allowed } = await admin.rpc("check_cron_secret", { p: secret });
  if (!secret || allowed !== true) return new Response("unauthorised", { status: 401 });

  const today = new Date().toISOString().slice(0, 10);
  const { data: rules, error } = await admin.from("recurring").select("*").eq("active", true).lte("next_run", today).limit(200);
  if (error) return new Response(error.message, { status: 500 });
  let made = 0;
  for (const r of rules ?? []) {
    const { data: pro } = await admin.rpc("is_pro", { uid: r.user_id });
    // Move the date forward first so a crash never creates duplicates.
    const next = addInterval(r.next_run, r.every);
    const { data: claimed } = await admin
      .from("recurring")
      .update({ next_run: next, last_run: new Date().toISOString(), runs: r.runs + 1 })
      .eq("id", r.id)
      .eq("next_run", r.next_run)
      .select("id");
    if (!claimed?.length || !pro) continue;

    const doc = structuredClone(r.doc);
    doc.id = `${Date.now().toString(36)}${crypto.randomUUID().slice(0, 6)}`;
    doc.type = "invoice";
    doc.status = "auto";
    doc.number = nextNumber(String(r.doc.number ?? "INV"), r.runs + 1);
    doc.issued = today;
    doc.updated = Date.now();
    doc.recurringFrom = r.id;
    await admin.from("documents").upsert({ user_id: r.user_id, id: doc.id, data: doc, updated_at: new Date().toISOString() });
    made++;

    if (r.send_email && isEmail(doc.bill?.email)) {
      try {
        const { data: prof } = await admin.from("profiles").select("email").eq("id", r.user_id).single();
        const { html, subject } = renderEmail(doc, "", prof?.email ?? "RecieptsGen user");
        await sendResend(doc.bill.email, subject, html, prof?.email ?? undefined);
        await admin.from("email_log").insert({ user_id: r.user_id, recipient: doc.bill.email, doc_id: doc.id });
      } catch (_) {
        // The invoice is saved even if the email fails.
      }
    }
  }
  return new Response(JSON.stringify({ due: rules?.length ?? 0, made }), { headers: { "Content-Type": "application/json" } });
});
