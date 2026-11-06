/* RecieptsGen admin dashboard. All data comes from admin_* RPCs that check is_admin() server side. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cfg = window.RG_CONFIG || {};
  const PAGE = 25;

  function icon(name) {
    const L = window.lucide;
    if (!L || !L.icons || !L.icons[name]) return "";
    const el = L.createElement(L.icons[name]);
    el.removeAttribute("class");
    return el.outerHTML;
  }
  const paintIcons = (root) => (root || document).querySelectorAll("[data-ico]").forEach((el) => { if (!el.firstChild) el.innerHTML = icon(el.dataset.ico); });

  let toastT;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove("show"), 2600);
  }

  const naira = (n) => "₦" + new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(Number(n) || 0);
  const count = (n) => new Intl.NumberFormat("en-US").format(Number(n) || 0);
  const dt = (s) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
  const dtt = (s) => (s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

  if (!cfg.supabaseUrl || !window.supabase) {
    $("#gateMsg").textContent = "Accounts are not set up for this site.";
    $("#signInForm").hidden = true;
    paintIcons();
    return;
  }
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });

  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args || {});
    if (error) throw new Error(error.message || "Request failed");
    return data;
  }

  // ---------- auth gate ----------
  let me = null;
  async function boot() {
    const { data } = await sb.auth.getSession();
    me = data.session ? data.session.user : null;
    $("#btnSignOut").hidden = !me;
    $("#who").textContent = me ? me.email : "";
    if (!me) return showGate("Sign in with an admin account.", true);
    let ok = false;
    try { ok = await rpc("is_admin"); } catch (_) { ok = false; }
    if (!ok) return showGate("This account does not have admin access.", false);
    $("#gate").hidden = true;
    $("#admNav").hidden = false;
    $("#btnRefresh").hidden = false;
    go(location.hash.slice(1) || "overview");
  }
  function showGate(msg, form) {
    $("#gate").hidden = false;
    $("#gateMsg").textContent = msg;
    $("#signInForm").hidden = !form;
    $("#admNav").hidden = true;
    $("#btnRefresh").hidden = true;
    $$(".view").forEach((v) => (v.hidden = true));
    $("#viewTitle").textContent = "Admin";
  }
  $("#signInForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: $("#g-email").value.trim(), password: $("#g-pass").value });
    btn.disabled = false;
    $("#g-pass").value = "";
    if (error) return toast(error.message);
    boot();
  });
  $("#btnSignOut").addEventListener("click", async () => { await sb.auth.signOut(); boot(); });

  // ---------- routing ----------
  const TITLES = { overview: "Overview", users: "Users", payments: "Payments", activity: "Activity", admins: "Admins" };
  let view = "overview";
  function go(v) {
    if (!TITLES[v]) v = "overview";
    view = v;
    if (location.hash.slice(1) !== v) history.replaceState(null, "", "#" + v);
    $$(".view").forEach((s) => (s.hidden = s.id !== "v-" + v));
    $$("#admNav .nav-item").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === v)));
    $("#viewTitle").textContent = TITLES[v];
    load();
  }
  $$("#admNav .nav-item").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));
  $("#btnRefresh").addEventListener("click", () => load());

  async function load() {
    try {
      if (view === "overview") await loadOverview();
      else if (view === "users") await loadUsers();
      else if (view === "payments") await loadPayments();
      else if (view === "activity") await loadActivity();
      else if (view === "admins") await loadAdmins();
    } catch (e) { toast(e.message); }
  }

  // ---------- overview ----------
  async function loadOverview() {
    const o = await rpc("admin_overview");
    const cards = [
      ["Users", count(o.users_total), `+${count(o.users_7d)} this week`, "Users", true],
      ["Active Pro", count(o.pro_active), o.users_total ? `${Math.round((o.pro_active / o.users_total) * 100)}% of users` : "", "Crown"],
      ["Revenue (30 days)", naira(o.revenue_30d), `${naira(o.revenue_total)} all time`, "Wallet"],
      ["Payments", count(o.payments_success), `${count(o.payments_pending)} pending`, "CreditCard"],
      ["Free clean exports", count(o.exports_total), "used by free accounts", "FileDown"],
      ["Emails (30 days)", count(o.emails_30d), "invoices sent to clients", "Mail"],
      ["Repeating invoices", count(o.recurring_active), "active rules", "Repeat"],
      ["Synced documents", count(o.docs_synced), "stored in the cloud", "Cloud"],
    ];
    $("#stats").innerHTML = cards.map(([k, v, s, ic, dark]) => `<div class="stat${dark ? " dark" : ""}">
        <div class="stat-ico">${icon(ic)}</div>
        <div><div class="stat-k">${esc(k)}</div><div class="stat-v">${esc(v)}</div>${s ? `<div class="stat-s">${esc(s)}</div>` : ""}</div>
      </div>`).join("");
    barChart($("#chSignups"), o.signups_daily || [], count);
    barChart($("#chRevenue"), o.revenue_daily || [], naira);
  }

  function barChart(el, rows, fmt) {
    const max = Math.max(0, ...rows.map((r) => Number(r.n) || 0));
    if (!rows.length || max === 0) { el.innerHTML = `<div class="chart-empty">No data yet</div>`; return; }
    const W = 600, H = 190, padL = 4, padB = 22, gap = 4;
    const bw = (W - padL) / rows.length - gap;
    const bars = rows.map((r, i) => {
      const v = Number(r.n) || 0;
      const h = Math.max(v ? 3 : 0, ((H - padB - 8) * v) / max);
      const x = padL + i * (bw + gap);
      const label = new Date(r.day + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
      return `<rect class="bar" x="${x.toFixed(1)}" y="${(H - padB - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3"><title>${esc(label)}: ${esc(fmt(v))}</title></rect>`;
    }).join("");
    const ticks = [0, Math.floor(rows.length / 2), rows.length - 1].map((i) => {
      const x = padL + i * (bw + gap) + bw / 2;
      const label = new Date(rows[i].day + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
      return `<text class="axis" x="${x.toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(label)}</text>`;
    }).join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Bar chart, highest value ${esc(fmt(max))}">
      <line class="grid" x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}"/>${bars}${ticks}</svg>`;
  }

  // ---------- users ----------
  const uState = { q: "", filter: "all", offset: 0, rows: [] };
  let searchT;
  $("#uSearch").addEventListener("input", (e) => {
    clearTimeout(searchT);
    searchT = setTimeout(() => { uState.q = e.target.value.trim(); uState.offset = 0; loadUsers().catch((x) => toast(x.message)); }, 300);
  });
  $$("[data-ufilter]").forEach((b) => b.addEventListener("click", () => { uState.filter = b.dataset.ufilter; uState.offset = 0; loadUsers().catch((x) => toast(x.message)); }));

  function planPill(until) {
    if (until && new Date(until) > new Date()) return `<span class="pill pro">Pro until ${esc(dt(until))}</span>`;
    return `<span class="pill">Free</span>`;
  }
  async function loadUsers() {
    $$("[data-ufilter]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ufilter === uState.filter)));
    const r = await rpc("admin_users", { p_search: uState.q, p_filter: uState.filter, p_limit: PAGE, p_offset: uState.offset });
    uState.rows = r.rows || [];
    $("#uRows").innerHTML = uState.rows.length
      ? uState.rows.map((u, i) => `<tr>
          <td>${esc(u.email)}${u.confirmed ? "" : ` <span class="pill warn">unconfirmed</span>`}</td>
          <td>${esc(dt(u.created_at))}</td>
          <td>${esc(dt(u.last_sign_in_at))}</td>
          <td>${planPill(u.pro_until)}</td>
          <td class="r">${esc(u.receipts_used)}/2 receipts, ${esc(u.invoices_used)}/1 invoice</td>
          <td class="r">${esc(count(u.docs))}</td>
          <td class="r">${esc(naira(u.paid_total))}</td>
          <td class="r"><button type="button" class="btn ghost small" data-manage="${i}">Manage</button></td>
        </tr>`).join("")
      : `<tr><td colspan="8" class="empty">No users found</td></tr>`;
    pager($("#uPager"), r.total, uState, loadUsers);
  }
  $("#uRows").addEventListener("click", (e) => {
    const b = e.target.closest("[data-manage]");
    if (b) openUser(uState.rows[Number(b.dataset.manage)]);
  });

  function pager(el, total, st, fn) {
    const from = total ? st.offset + 1 : 0, to = Math.min(st.offset + PAGE, total);
    el.innerHTML = `<span>${from}–${to} of ${count(total)}</span><span class="btns">
      <button type="button" class="btn ghost small" data-pg="-1" ${st.offset === 0 ? "disabled" : ""}>Previous</button>
      <button type="button" class="btn ghost small" data-pg="1" ${to >= total ? "disabled" : ""}>Next</button></span>`;
    el.querySelectorAll("[data-pg]").forEach((b) => b.addEventListener("click", () => {
      st.offset = Math.max(0, st.offset + Number(b.dataset.pg) * PAGE);
      fn().catch((x) => toast(x.message));
    }));
  }

  // ---------- manage one user ----------
  let current = null;
  function openUser(u) {
    current = u;
    $("#udEmail").textContent = u.email;
    $("#udMeta").innerHTML = `Joined ${esc(dt(u.created_at))} &middot; Last sign in ${esc(dt(u.last_sign_in_at))}<br>
      Plan: ${planPill(u.pro_until)}<br>Free clean exports used: ${esc(u.receipts_used)} receipts, ${esc(u.invoices_used)} invoice<br>
      Paid so far: ${esc(naira(u.paid_total))}`;
    $("#userDialog").showModal();
  }
  async function act(fn, msg) {
    try { await fn(); toast(msg); $("#userDialog").close(); await loadUsers(); } catch (e) { toast(e.message); }
  }
  $("#udGrant").addEventListener("click", () => {
    const days = Number($("#udDays").value);
    act(() => rpc("admin_set_pro", { p_user: current.id, p_days: days }), `Gave ${days} days of Pro to ${current.email}`);
  });
  $("#udEnd").addEventListener("click", () => {
    if (!confirm(`End Pro for ${current.email} now?`)) return;
    act(() => rpc("admin_set_pro", { p_user: current.id, p_days: 0 }), "Pro ended");
  });
  $("#udReset").addEventListener("click", () => {
    if (!confirm(`Give ${current.email} their 2 receipts and 1 invoice without the footer line again?`)) return;
    act(() => rpc("admin_reset_quota", { p_user: current.id }), "Free exports reset");
  });

  // ---------- payments ----------
  const pState = { filter: "all", offset: 0 };
  $$("[data-pfilter]").forEach((b) => b.addEventListener("click", () => { pState.filter = b.dataset.pfilter; pState.offset = 0; loadPayments().catch((x) => toast(x.message)); }));
  async function loadPayments() {
    $$("[data-pfilter]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pfilter === pState.filter)));
    const r = await rpc("admin_payments", { p_status: pState.filter, p_limit: PAGE, p_offset: pState.offset });
    const rows = r.rows || [];
    $("#pRows").innerHTML = rows.length
      ? rows.map((p) => `<tr>
          <td class="mono">${esc(p.tx_ref)}</td>
          <td>${esc(p.email || "deleted user")}</td>
          <td class="r">${esc(naira(p.amount))}</td>
          <td><span class="pill ${p.status === "successful" ? "ok" : "warn"}">${esc(p.status)}</span></td>
          <td>${esc(dtt(p.created_at))}</td>
          <td>${esc(dtt(p.paid_at))}</td>
          <td class="mono">${esc(p.flw_id || "—")}</td>
        </tr>`).join("")
      : `<tr><td colspan="7" class="empty">No payments yet</td></tr>`;
    pager($("#pPager"), r.total, pState, loadPayments);
  }

  // ---------- activity ----------
  const ACTIONS = { grant_pro: "Gave Pro", end_pro: "Ended Pro", reset_quota: "Reset free exports", add_admin: "Added admin", remove_admin: "Removed admin" };
  let lastActivity = null;
  async function loadActivity() {
    const a = (lastActivity = await rpc("admin_activity", { p_limit: 100 }));
    $("#logRows").innerHTML = (a.log || []).length
      ? a.log.map((l) => {
          const d = l.detail || {};
          const info = l.action === "grant_pro" ? `${d.days} days, until ${dt(d.pro_until)}` : l.action === "reset_quota" ? `${d.removed} removed` : "";
          return `<tr><td>${esc(dtt(l.created_at))}</td><td>${esc(l.admin_email)}</td><td>${esc(ACTIONS[l.action] || l.action)}</td><td>${esc(info || l.target || "")}</td></tr>`;
        }).join("")
      : `<tr><td colspan="4" class="empty">No admin actions yet</td></tr>`;
    $("#mailRows").innerHTML = (a.emails || []).length
      ? a.emails.map((m) => `<tr><td>${esc(dtt(m.created_at))}</td><td>${esc(m.sender || "deleted user")}</td><td>${esc(m.recipient)}</td></tr>`).join("")
      : `<tr><td colspan="3" class="empty">No emails sent yet</td></tr>`;
  }

  // ---------- admins ----------
  async function loadAdmins() {
    const a = await rpc("admin_activity", { p_limit: 1 });
    const mine = (me.email || "").toLowerCase();
    $("#adminList").innerHTML = (a.admins || []).map((x) => `<li><span>${esc(x.email)}${x.email.toLowerCase() === mine ? ` <span class="pill ok">you</span>` : ""}</span>
      ${x.email.toLowerCase() === mine ? "" : `<button type="button" class="btn ghost small danger" data-remove="${esc(x.email)}">Remove</button>`}</li>`).join("");
  }
  $("#adminList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-remove]");
    if (!b || !confirm(`Remove admin access for ${b.dataset.remove}?`)) return;
    try { await rpc("admin_remove", { p_email: b.dataset.remove }); toast("Admin removed"); loadAdmins(); } catch (x) { toast(x.message); }
  });
  $("#addAdminForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#newAdmin").value.trim();
    try { await rpc("admin_add", { p_email: email }); $("#newAdmin").value = ""; toast(`${email} is now an admin`); loadAdmins(); } catch (x) { toast(x.message); }
  });

  paintIcons();
  sb.auth.onAuthStateChange((evt) => { if (evt === "SIGNED_OUT") boot(); });
  boot();
})();
