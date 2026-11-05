// RecieptsGen Pro payments through Flutterwave Standard checkout.
// Actions: start (returns checkout link), verify (after redirect), webhook (from Flutterwave).
// Secrets: FLW_SECRET_KEY, FLW_SECRET_HASH, APP_URL, optional FLW_PLAN_ID, PRO_PRICE_NGN.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const FLW = "https://api.flutterwave.com/v3";
const PRICE = Number(Deno.env.get("PRO_PRICE_NGN") ?? "2000");
const APP_URL = (Deno.env.get("APP_URL") ?? "https://recieptsgen.vercel.app").replace(/\/$/, "");
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

async function userFrom(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  return data.user ?? null;
}

async function flw(path: string, init: RequestInit = {}) {
  const key = Deno.env.get("FLW_SECRET_KEY");
  if (!key) throw new Error("Payments are not configured yet");
  const res = await fetch(FLW + path, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message ?? `Flutterwave error ${res.status}`);
  return body;
}

// Marks the payment successful once and adds 30 days of Pro.
async function grant(txRef: string, flwId: string, userId: string) {
  const { data: updated } = await admin
    .from("payments")
    .update({ status: "successful", flw_id: flwId, paid_at: new Date().toISOString() })
    .eq("tx_ref", txRef)
    .neq("status", "successful")
    .select("user_id");
  if (!updated || !updated.length) return false;
  const { data: prof } = await admin.from("profiles").select("pro_until").eq("id", userId).single();
  const base = Math.max(Date.now(), prof?.pro_until ? Date.parse(prof.pro_until) : 0);
  const until = new Date(base + 30 * 86400000).toISOString();
  await admin.from("profiles").update({ pro_until: until }).eq("id", userId);
  return true;
}

// Checks a Flutterwave transaction with their API; never trusts the client or webhook body.
async function checkTransaction(id: string) {
  const v = await flw(`/transactions/${encodeURIComponent(id)}/verify`);
  const t = v?.data;
  const ok = v?.status === "success" && t?.status === "successful" && t?.currency === "NGN" && Number(t?.amount) >= PRICE;
  return { ok, t };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  const url = new URL(req.url);

  try {
    // ---------- webhook from Flutterwave ----------
    if (url.searchParams.get("webhook") === "1") {
      const hash = Deno.env.get("FLW_SECRET_HASH");
      if (!hash || req.headers.get("verif-hash") !== hash) return new Response("unauthorised", { status: 401 });
      const body = await req.json().catch(() => ({}));
      const id = String(body?.data?.id ?? "");
      if (!id) return new Response("ok");
      const { ok, t } = await checkTransaction(id);
      if (!ok) return new Response("ok");
      let { data: pay } = await admin.from("payments").select("user_id").eq("tx_ref", t.tx_ref).maybeSingle();
      if (!pay && t?.customer?.email) {
        // Renewal charge from a payment plan: match the customer by email.
        const { data: prof } = await admin.from("profiles").select("id").ilike("email", t.customer.email).maybeSingle();
        if (prof) {
          await admin.from("payments").insert({ tx_ref: t.tx_ref, user_id: prof.id, amount: t.amount, status: "pending" });
          pay = { user_id: prof.id };
        }
      }
      if (pay) await grant(t.tx_ref, String(t.id), pay.user_id);
      return new Response("ok");
    }

    const user = await userFrom(req);
    if (!user) return json(req, { error: "Please sign in first" }, 401);
    const body = await req.json().catch(() => ({}));

    // ---------- start checkout ----------
    if (body.action === "start") {
      const txRef = `RG-${user.id.slice(0, 8)}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
      await admin.from("payments").insert({ tx_ref: txRef, user_id: user.id, amount: PRICE, status: "pending" });
      const payload: Record<string, unknown> = {
        tx_ref: txRef,
        amount: String(PRICE),
        currency: "NGN",
        redirect_url: `${APP_URL}/?pay=return`,
        customer: { email: user.email },
        customizations: { title: "RecieptsGen Pro", description: "RecieptsGen Pro for 1 month" },
        meta: { user_id: user.id },
      };
      const plan = Deno.env.get("FLW_PLAN_ID");
      if (plan) payload.payment_plan = plan;
      const res = await flw("/payments", { method: "POST", body: JSON.stringify(payload) });
      return json(req, { link: res?.data?.link });
    }

    // ---------- verify after redirect ----------
    if (body.action === "verify") {
      const id = String(body.transaction_id ?? "");
      if (!/^\d+$/.test(id)) return json(req, { error: "Missing transaction" }, 400);
      const { ok, t } = await checkTransaction(id);
      if (!ok) return json(req, { ok: false, error: "Payment was not completed" });
      const { data: pay } = await admin.from("payments").select("user_id").eq("tx_ref", t.tx_ref).maybeSingle();
      if (!pay || pay.user_id !== user.id) return json(req, { ok: false, error: "This payment belongs to another account" }, 403);
      await grant(t.tx_ref, String(t.id), user.id);
      const { data: prof } = await admin.from("profiles").select("pro_until").eq("id", user.id).single();
      return json(req, { ok: true, pro_until: prof?.pro_until });
    }

    return json(req, { error: "Unknown action" }, 400);
  } catch (e) {
    return json(req, { error: (e as Error).message }, 500);
  }
});
