/* RecieptsGen accounts: sign-in, Pro plan, free export quota, cloud sync, email, recurring. */
(function () {
  "use strict";
  const cfg = window.RG_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase && window.supabase.createClient);
  const sb = enabled ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

  const state = {
    enabled,
    ready: !enabled,
    user: null,
    pro: false,
    proUntil: null,
    receiptsLeft: 0,
    invoicesLeft: 0,
    claimed: new Set(),
  };
  const listeners = [];
  const emit = () => listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } });

  async function refresh() {
    if (!sb) return state;
    const { data: s } = await sb.auth.getSession();
    state.user = s.session ? s.session.user : null;
    if (state.user) {
      const { data, error } = await sb.rpc("quota_status");
      if (!error && data) {
        state.pro = !!data.pro;
        state.proUntil = data.pro_until;
        state.receiptsLeft = data.receipts_left ?? 0;
        state.invoicesLeft = data.invoices_left ?? 0;
        state.claimed = new Set(data.claimed || []);
      }
    } else {
      state.pro = false; state.proUntil = null; state.receiptsLeft = 0; state.invoicesLeft = 0; state.claimed = new Set();
    }
    state.ready = true;
    emit();
    return state;
  }

  async function token() {
    const { data } = await sb.auth.getSession();
    return data.session ? data.session.access_token : "";
  }
  async function callFn(name, body, query) {
    const res = await fetch(`${cfg.supabaseUrl}/functions/v1/${name}${query || ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.supabaseKey, Authorization: `Bearer ${await token()}` },
      body: JSON.stringify(body || {}),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error) throw new Error(out.error || `Request failed (${res.status})`);
    return out;
  }
  const need = () => { if (!sb) throw new Error("Accounts are not set up yet"); };

  const api = {
    state,
    onChange(fn) { listeners.push(fn); },
    async init() {
      if (!sb) { emit(); return; }
      sb.auth.onAuthStateChange((evt) => { if (evt === "SIGNED_IN" || evt === "SIGNED_OUT" || evt === "USER_UPDATED") refresh(); });
      await refresh();
    },
    refresh,

    async signUp(email, password) {
      need();
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
      if (error) throw error;
      await refresh();
      return { needsConfirm: !data.session };
    },
    async signIn(email, password) {
      need();
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await refresh();
    },
    async resetPassword(email) {
      need();
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/?reset=1" });
      if (error) throw error;
    },
    async updatePassword(password) {
      need();
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
    },
    async signOut() { if (sb) await sb.auth.signOut(); await refresh(); },

    // Free accounts: 2 receipts + 1 invoice without the footer line. Server decides.
    async claim(docId, type) {
      if (!sb || !state.user) return { allowed: false, reason: "signin" };
      const { data, error } = await sb.rpc("claim_clean_export", { p_doc_id: docId, p_type: type });
      if (error) throw error;
      if (data && data.allowed && !data.pro) state.claimed.add(docId);
      await refresh();
      return data;
    },
    wouldBeClean(docId, type) {
      if (state.pro) return true;
      if (!state.user) return false;
      if (state.claimed.has(docId)) return true;
      return type === "receipt" ? state.receiptsLeft > 0 : state.invoicesLeft > 0;
    },

    // Flutterwave checkout
    async startPayment() {
      need();
      if (!state.user) throw new Error("Sign in first");
      const { link } = await callFn("pay", { action: "start" });
      if (!link) throw new Error("Could not start payment");
      location.href = link;
    },
    async handlePaymentReturn() {
      const p = new URLSearchParams(location.search);
      if (p.get("pay") !== "return") return null;
      history.replaceState(null, "", location.pathname);
      if (!sb) return null;
      await refresh();
      if (p.get("status") === "cancelled") return { ok: false, error: "Payment cancelled" };
      const id = p.get("transaction_id");
      if (!id) return { ok: false, error: "Payment was not completed" };
      try {
        const out = await callFn("pay", { action: "verify", transaction_id: id });
        await refresh();
        return out;
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // Cloud sync (Pro)
    async pullDocs() {
      if (!sb || !state.pro) return [];
      const { data, error } = await sb.from("documents").select("id,data,deleted,updated_at").order("updated_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return data || [];
    },
    async pushDoc(doc) {
      if (!sb || !state.pro) return;
      const { error } = await sb.from("documents").upsert({ user_id: state.user.id, id: doc.id, data: doc, deleted: false, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    async deleteDoc(id) {
      if (!sb || !state.pro) return;
      await sb.from("documents").update({ deleted: true, updated_at: new Date().toISOString() }).eq("id", id);
    },
    async pullTemplates() {
      if (!sb || !state.pro) return [];
      const { data, error } = await sb.from("templates").select("id,data,deleted,updated_at");
      if (error) throw error;
      return data || [];
    },
    async pushTemplate(t) {
      if (!sb || !state.pro) return;
      const { error } = await sb.from("templates").upsert({ user_id: state.user.id, id: t.id, data: t, deleted: false, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    async deleteTemplate(id) {
      if (!sb || !state.pro) return;
      await sb.from("templates").update({ deleted: true, updated_at: new Date().toISOString() }).eq("id", id);
    },

    // Email (Pro)
    async email(doc, to, subject, message) { need(); return callFn("send-email", { doc, to, subject, message }); },

    // Recurring invoices (Pro)
    async listRecurring() {
      if (!sb || !state.pro) return [];
      const { data, error } = await sb.from("recurring").select("id,doc,every,next_run,send_email,active,runs").order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    async addRecurring(doc, every, nextRun, sendEmail) {
      need();
      const { error } = await sb.from("recurring").insert({ user_id: state.user.id, doc, every, next_run: nextRun, send_email: sendEmail });
      if (error) throw error;
    },
    async removeRecurring(id) { need(); const { error } = await sb.from("recurring").delete().eq("id", id); if (error) throw error; },
  };

  window.RG_ACCOUNT = api;
})();
