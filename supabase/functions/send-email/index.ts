// Emails an invoice or receipt to a client. Pro only, max 50 emails a day per account.
// Secrets: RESEND_API_KEY, RESEND_FROM, APP_URL.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { isEmail, renderEmail, sendResend } from "./email.ts";

const APP_URL = (Deno.env.get("APP_URL") ?? "https://recieptsgen.vercel.app").replace(/\/$/, "");
const DAILY_LIMIT = 50;
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const ok = origin === APP_URL || /^http:\/\/localhost:\d+$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : APP_URL,
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  try {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(token);
    const user = u.user;
    if (!user) return json(req, { error: "Please sign in first" }, 401);

    const { data: pro } = await admin.rpc("is_pro", { uid: user.id });
    if (!pro) return json(req, { error: "Emailing documents is a Pro feature" }, 403);

    const since = new Date(Date.now() - 86400000).toISOString();
    const { count } = await admin.from("email_log").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
    if ((count ?? 0) >= DAILY_LIMIT) return json(req, { error: "Daily email limit reached. Try again tomorrow." }, 429);

    const body = await req.json().catch(() => ({}));
    const to = String(body.to ?? "").trim();
    if (!isEmail(to)) return json(req, { error: "Enter a valid client email" }, 400);
    const doc = body.doc;
    if (!doc || !Array.isArray(doc.items) || doc.items.length > 200) return json(req, { error: "Invalid document" }, 400);

    const { html, subject } = renderEmail(doc, String(body.message ?? "").slice(0, 2000), user.email ?? "RecieptsGen user");
    await sendResend(to, String(body.subject || subject).slice(0, 200), html, user.email ?? undefined);
    await admin.from("email_log").insert({ user_id: user.id, recipient: to, doc_id: String(doc.id ?? "").slice(0, 64) });
    return json(req, { ok: true });
  } catch (e) {
    return json(req, { error: (e as Error).message }, 500);
  }
});
