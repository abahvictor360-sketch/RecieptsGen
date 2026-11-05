/* RecieptsGen: invoice and receipt generator. */
(function () {
  "use strict";

  const A = window.RG_ACCOUNT;
  const T = window.RG_TEMPLATES;
  const FONTS = window.RG_FONTS;

  // ---------- storage helpers (never throw) ----------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
    },
  };
  try { localStorage.removeItem("rg.current"); } catch {}
  const K = { current: "rg.current.v2", docs: "rg.docs", settings: "rg.settings", templates: "rg.templates" };

  // ---------- small utils ----------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const fmtNum = (n) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const money = (sym, n) => sym + fmtNum(n);
  const fmtDate = (iso) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };
  const randRef = () => {
    const a = Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(8, "X");
    const b = Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
    return `PFX-${a}-${b}`;
  };
  const safeHttps = (u) => { try { const x = new URL(String(u).trim()); return x.protocol === "https:" ? x.toString() : ""; } catch { return ""; } };
  const isHex = (c) => /^#[0-9a-f]{6}$/i.test(c || "");
  function tint(hex, amount) {
    if (!isHex(hex)) return "#eeeeee";
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) => Math.round(c + (255 - c) * amount);
    const r = mix(n >> 16), g = mix((n >> 8) & 255), b = mix(n & 255);
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  }
  const download = (name, text, type) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // ---------- icons (Lucide, ISC licence) ----------
  const ICONS = [
    "Zap*", "Zap", "AppWindow", "MonitorUp", "Server", "Globe", "Database", "Cloud", "Code", "Smartphone",
    "Laptop", "Monitor", "ShoppingCart", "ShoppingBag", "Package", "Truck", "Wrench", "Hammer", "Palette",
    "PenTool", "Camera", "Video", "Music", "Megaphone", "Mail", "MessageCircle", "Shield", "Lock", "Key",
    "CreditCard", "Wallet", "Receipt", "FileText", "Briefcase", "GraduationCap", "BookOpen", "Users",
    "Calendar", "Clock", "Car", "Plane", "House", "Building2", "Utensils", "Coffee", "Scissors", "Sparkles",
    "Heart", "Star", "Gift", "Tag", "Printer", "Wifi", "Cpu", "HardDrive", "Rocket", "Leaf", "Shirt",
  ];
  const lucideOK = () => typeof window.lucide !== "undefined" && window.lucide.icons && window.lucide.createElement;
  function iconSVG(icon) {
    if (!icon) return "";
    if (icon.kind === "img") return /^data:image\//.test(icon.src || "") ? `<img src="${esc(icon.src)}" alt="" />` : "";
    if (!lucideOK()) return "";
    const filled = icon.name.endsWith("*");
    const node = window.lucide.icons[icon.name.replace("*", "")];
    if (!node) return "";
    const el = window.lucide.createElement(node);
    el.setAttribute("stroke-width", "2");
    if (filled) el.setAttribute("fill", "currentColor");
    el.removeAttribute("class");
    return el.outerHTML;
  }

  // ---------- state ----------
  let settings = Object.assign({ prefix: "INV", next: 1 }, store.get(K.settings, {}));
  const makeNumber = (n) => `${settings.prefix || "INV"}-${new Date().getFullYear()}-${String(n).padStart(4, "0")}`;
  const blankItem = () => ({ id: uid(), icon: { kind: "lucide", name: "Package" }, name: "", vendor: "", desc: "", coverage: "One time", qty: 1, price: "", inHeader: true, headerLabel: "" });

  function normalize(d) {
    d.from = Object.assign({ name: "", address: "", phone: "", email: "", logo: null }, d.from || {});
    d.bill = Object.assign({ name: "", email: "", extra: "" }, d.bill || {});
    d.pay = Object.assign({ method: "", ref: "", txn: "" }, d.pay || {});
    d.fx = Object.assign({ on: false, symbol: "US$", rate: "" }, d.fx || {});
    if (!Array.isArray(d.items)) d.items = [blankItem()];
    d.template = d.template || "classic";
    d.accent = d.accent || "";
    d.font = d.font || "";
    d.payLink = d.payLink || "";
    return d;
  }

  function sampleDoc() {
    return normalize({
      id: uid(), type: "invoice", number: makeNumber(settings.next), status: "auto",
      issued: today(), paid: today(), due: "",
      from: { name: "Your Business", address: "12 Example Street, Lagos", phone: "+234 800 000 0000", email: "hello@yourbusiness.com" },
      bill: { name: "Customer Name", email: "customer@example.com", extra: "" },
      pay: { method: "Bank transfer", ref: randRef(), txn: "" },
      currency: "₦", discount: "", taxLabel: "VAT", taxRate: "", amountPaid: "",
      fx: { on: true, symbol: "US$", rate: 1365 }, note: "",
      items: [
        { id: uid(), icon: { kind: "lucide", name: "Package" }, name: "Product or service", vendor: "", desc: "Short description of what the customer is paying for.", coverage: "12 months", qty: 1, price: 100000, inHeader: true, headerLabel: "Product" },
        { id: uid(), icon: { kind: "lucide", name: "Wrench" }, name: "Setup service", vendor: "", desc: "One-off setup or installation work.", coverage: "One time", qty: 1, price: 50000, inHeader: true, headerLabel: "Service" },
      ],
      updated: Date.now(),
    });
  }

  function emptyDoc(type) {
    const prev = doc || {};
    return normalize({
      id: uid(), type: type || prev.type || "invoice", number: makeNumber(settings.next), status: "auto",
      issued: today(), paid: today(), due: "",
      from: JSON.parse(JSON.stringify(prev.from || {})),
      bill: { name: "", email: "", extra: "" },
      pay: { method: prev.pay?.method || "", ref: randRef(), txn: "" },
      currency: prev.currency || "₦", discount: "", taxLabel: prev.taxLabel || "VAT", taxRate: "", amountPaid: "",
      fx: Object.assign({ on: false, symbol: "US$", rate: "" }, prev.fx || {}),
      note: "", items: [blankItem()],
      template: prev.template, accent: prev.accent, font: prev.font, payLink: prev.payLink,
      updated: Date.now(),
    });
  }

  let doc = null;
  let docs = store.get(K.docs, []).map(normalize);
  let customTpls = store.get(K.templates, []);
  doc = store.get(K.current, null);
  if (!doc || !Array.isArray(doc.items)) {
    doc = sampleDoc();
    settings.next += 1;
    store.set(K.settings, settings);
    store.set(K.current, doc);
  }
  normalize(doc);

  // ---------- calculations ----------
  function calc(d) {
    const lines = d.items.map((it) => num(it.qty === "" ? 1 : it.qty) * num(it.price));
    const subtotal = lines.reduce((a, b) => a + b, 0);
    const discount = Math.min(num(d.discount), subtotal);
    const taxRate = num(d.taxRate);
    const tax = (subtotal - discount) * (taxRate / 100);
    const total = subtotal - discount + tax;
    const paidSet = d.type === "receipt" && d.amountPaid !== "" && d.amountPaid != null;
    const paid = paidSet ? num(d.amountPaid) : total;
    const balance = Math.max(0, total - paid);
    return { lines, subtotal, discount, taxRate, tax, total, paidSet, paid, balance };
  }
  function statusOf(d, c) {
    if (d.status !== "auto") return d.status;
    if (d.type === "invoice") return "UNPAID";
    return c.paidSet && c.balance > 0.004 ? "PARTIALLY PAID" : "PAID";
  }
  function defaultNote(d) {
    if (d.type === "receipt") return "Thank you, your payment has been received.";
    const m = (d.pay.method || "").trim();
    return m ? `Please make payment via ${m}.` : "Thank you for your business.";
  }

  // ---------- template resolution ----------
  function resolveTpl(d) {
    let custom = null;
    if (String(d.template).startsWith("c:")) custom = customTpls.find((t) => "c:" + t.id === d.template) || null;
    const base = custom ? custom.base : d.template;
    const def = T[base] || T.classic;
    const accent = (custom && isHex(custom.accent) && custom.accent) || (isHex(d.accent) && d.accent) || def.accent;
    const accent2 = (custom && isHex(custom.accent2) && custom.accent2) || tint(accent === "#000000" ? "#888888" : accent, 0.72);
    const font = (custom && FONTS.includes(custom.font) && custom.font) || (FONTS.includes(d.font) && d.font) || def.font;
    const usesPro = def.pro || !!custom || (isHex(d.accent) && d.accent.toLowerCase() !== def.accent.toLowerCase()) || (!!d.font && d.font !== def.font) || !!safeHttps(d.payLink);
    return { key: T[base] ? base : "classic", def, custom, accent, accent2, font, usesPro };
  }

  // ---------- render document ----------
  let forceWm = null; // null = decide from account, true/false while printing
  function renderDoc() {
    const d = doc;
    const c = calc(d);
    const sym = d.currency || "";
    const isRec = d.type === "receipt";
    const status = statusOf(d, c);
    const r = resolveTpl(d);
    const cu = r.custom || {};

    const seen = new Set();
    const logos = d.items
      .filter((it) => it.inHeader && it.icon)
      .map((it) => ({ icon: it.icon, label: (it.headerLabel || it.vendor || it.name || "").trim() }))
      .filter((l) => { const k = l.label.toLowerCase() + JSON.stringify(l.icon); if (seen.has(k)) return false; seen.add(k); return true; });

    const metaRows = [["No.", d.number], ["Issued", fmtDate(d.issued)], isRec ? ["Paid", fmtDate(d.paid)] : d.due ? ["Due", fmtDate(d.due)] : null].filter((x) => x && x[1]);
    const payRows = [["Method", d.pay.method], ["Reference", d.pay.ref], ["Transaction ID", d.pay.txn]].filter((x) => (x[1] || "").trim());

    const totalRows = [{ label: "Subtotal", value: money(sym, c.subtotal), cls: "sub" }];
    if (c.discount > 0) totalRows.push({ label: "Discount", value: "−" + money(sym, c.discount), cls: "sub" });
    if (c.taxRate > 0) totalRows.push({ label: `${d.taxLabel || "Tax"} (${c.taxRate}%)`, value: money(sym, c.tax), cls: "sub" });
    const partial = isRec && c.paidSet && Math.abs(c.paid - c.total) > 0.004;
    totalRows.push({ label: partial ? "Total" : isRec ? "Total paid" : "Total due", value: money(sym, c.total), cls: "grand" });
    if (partial) {
      totalRows.push({ label: "Amount paid", value: money(sym, c.paid), cls: "after" });
      totalRows.push({ label: "Balance due", value: money(sym, c.balance), cls: "" });
    }
    const rate = num(d.fx.rate);
    const fxLine = d.fx.on && rate > 0 ? `Approx. ${d.fx.symbol}${fmtNum(c.total / rate)} at ${d.fx.symbol}1 = ${money(sym, rate)}` : "";

    const wm = forceWm !== null ? forceWm : !(A && A.wouldBeClean(d.id, d.type));
    const ctx = {
      d, c, esc, iconSVG, fmtDate, status, logos, metaRows, payRows, totalRows, fxLine,
      money: (n) => money(sym, n),
      qtyNote: (it) => (it.qty !== "" && num(it.qty) !== 1 ? `<div class="qty">${esc(num(it.qty))} × ${esc(money(sym, num(it.price)))}</div>` : ""),
      qtyNoteInline: (it) => (it.qty !== "" && num(it.qty) !== 1 ? ` <span class="qty">×${esc(num(it.qty))}</span>` : ""),
      title: (cu.title || (isRec ? "RECEIPT" : "INVOICE")).toUpperCase(),
      note: (d.note || "").trim() || defaultNote(d),
      thanks: cu.thanks || "Thank You!",
      terms: cu.terms || "",
      showLogos: cu.showLogos !== false,
      showSignatures: cu.showSignatures !== false,
      bg: cu.bg && /^data:image\//.test(cu.bg) ? cu.bg : "",
      bgOpacity: Number(cu.bgOpacity) || 0.25,
      payLink: !isRec ? safeHttps(d.payLink) : "",
      wm,
    };

    const sheet = $("#sheet");
    sheet.className = `sheet page-${r.def.page}`;
    sheet.style.setProperty("--acc", r.accent);
    sheet.style.setProperty("--acc2", r.accent2);
    sheet.style.setProperty("--font", `"${r.font}"`);
    sheet.innerHTML = r.def.render(ctx);

    const note = $("#stageNote");
    const pro = A && A.state.pro;
    if (r.usesPro && !pro) {
      note.hidden = false;
      note.innerHTML = `This design uses Pro features. <button type="button" class="link" data-upgrade>Upgrade to download it</button>`;
    } else if (wm && A && A.state.enabled && !A.state.user) {
      note.hidden = false;
      note.innerHTML = `Sign in free to get 2 receipts and 1 invoice without the footer line. <button type="button" class="link" data-signin>Sign in</button>`;
    } else note.hidden = true;
    fitPreview();
  }

  // ---------- preview scaling ----------
  function fitPreview() {
    const stage = $("#stage"), inner = $("#stageInner"), sheet = $("#sheet");
    sheet.style.transform = "";
    const avail = stage.clientWidth - 32;
    const w = sheet.offsetWidth, h = sheet.offsetHeight;
    const s = Math.min(1, avail / w);
    sheet.style.transform = s < 1 ? `scale(${s})` : "";
    sheet.style.transformOrigin = "top left";
    inner.style.width = w * s + "px";
    inner.style.height = h * s + "px";
  }
  window.addEventListener("resize", fitPreview);

  // ---------- form binding ----------
  const bind = [
    ["#f-number", "number"], ["#f-status", "status"], ["#f-issued", "issued"], ["#f-paid", "paid"], ["#f-due", "due"],
    ["#f-fromName", "from.name"], ["#f-fromAddress", "from.address"], ["#f-fromPhone", "from.phone"], ["#f-fromEmail", "from.email"],
    ["#f-billName", "bill.name"], ["#f-billEmail", "bill.email"], ["#f-billExtra", "bill.extra"],
    ["#f-payMethod", "pay.method"], ["#f-payRef", "pay.ref"], ["#f-payTxn", "pay.txn"], ["#f-payLink", "payLink"],
    ["#f-currency", "currency"], ["#f-discount", "discount"], ["#f-taxLabel", "taxLabel"], ["#f-taxRate", "taxRate"],
    ["#f-amountPaid", "amountPaid"], ["#f-fxSymbol", "fx.symbol"], ["#f-fxRate", "fx.rate"], ["#f-note", "note"],
    ["#f-font", "font"],
  ];
  const getPath = (o, p) => p.split(".").reduce((a, k) => (a ? a[k] : undefined), o);
  const setPath = (o, p, v) => { const ks = p.split("."); const last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; };

  $("#f-font").innerHTML = `<option value="">Template default</option>` + FONTS.map((f) => `<option>${esc(f)}</option>`).join("");

  function fillForm() {
    bind.forEach(([sel, path]) => { $(sel).value = getPath(doc, path) ?? ""; });
    $("#f-accent").value = resolveTpl(doc).accent;
    $("#f-fxOn").checked = !!doc.fx.on;
    $("#fxFields").hidden = !doc.fx.on;
    $("#f-note").placeholder = defaultNote(doc);
    $("#s-prefix").value = settings.prefix;
    $("#s-next").value = settings.next;
    document.body.dataset.type = doc.type;
    document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.type === doc.type)));
    $("#btnConvert").textContent = doc.type === "invoice" ? "Make receipt" : "Make invoice";
    paintFromLogo();
    renderItems();
    renderTplGrid();
  }

  let saveTimer;
  function changed() {
    doc.updated = Date.now();
    $("#f-note").placeholder = defaultNote(doc);
    renderDoc();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.set(K.current, doc), 250);
  }

  bind.forEach(([sel, path]) => {
    $(sel).addEventListener("input", (e) => { setPath(doc, path, e.target.value); changed(); });
  });
  $("#f-accent").addEventListener("input", (e) => { doc.accent = e.target.value; changed(); });
  $("#f-fxOn").addEventListener("change", (e) => { doc.fx.on = e.target.checked; $("#fxFields").hidden = !doc.fx.on; changed(); });
  $("#btnRef").addEventListener("click", () => { doc.pay.ref = randRef(); $("#f-payRef").value = doc.pay.ref; changed(); });
  $("#btnNoteDefault").addEventListener("click", () => { doc.note = ""; $("#f-note").value = ""; changed(); });
  $("#s-prefix").addEventListener("input", (e) => { settings.prefix = e.target.value.trim(); store.set(K.settings, settings); });
  $("#s-next").addEventListener("input", (e) => { settings.next = Math.max(1, parseInt(e.target.value, 10) || 1); store.set(K.settings, settings); });

  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => { if (doc.type !== b.dataset.type) setType(b.dataset.type); }));
  function setType(type) {
    const oldDefault = defaultNote(doc);
    doc.type = type;
    if (!doc.note || doc.note.trim() === oldDefault || /^This invoice is payable|^Please make payment via|^Thank you, your payment/.test(doc.note)) doc.note = "";
    if (type === "receipt" && !doc.paid) doc.paid = today();
    fillForm();
    changed();
  }

  // ---------- design / templates ----------
  function renderTplGrid() {
    const grid = $("#tplGrid");
    grid.innerHTML = Object.entries(T).map(([key, t]) => {
      const sel = doc.template === key;
      return `<button type="button" class="tpl-card tpl-${key}${sel ? " sel" : ""}" data-tpl="${key}" style="--acc:${t.accent};--acc2:${tint(t.accent === "#000000" ? "#888888" : t.accent, 0.72)}">
        <span class="tpl-thumb"><i></i><i></i><i></i></span>
        <span class="tpl-name">${esc(t.name)}${t.pro ? ` <em>PRO</em>` : ""}</span></button>`;
    }).join("");
    grid.querySelectorAll("[data-tpl]").forEach((b) => b.addEventListener("click", () => {
      doc.template = b.dataset.tpl;
      doc.accent = "";
      $("#f-accent").value = resolveTpl(doc).accent;
      renderTplGrid(); changed();
    }));
    renderMyTemplates();
  }

  function renderMyTemplates() {
    const ul = $("#myTemplates");
    if (!customTpls.length) { ul.innerHTML = `<li class="empty">Create your own layout, colors, terms and background, or import one.</li>`; return; }
    ul.innerHTML = "";
    customTpls.forEach((t) => {
      const li = document.createElement("li");
      if (doc.template === "c:" + t.id) li.classList.add("active");
      li.innerHTML = `<span class="swatch" style="background:${isHex(t.accent) ? t.accent : "#000"}"></span>
        <div class="h-main"><div class="h-title">${esc(t.name)}</div><div class="h-sub">${esc((T[t.base] || T.classic).name)} layout</div></div>
        <button type="button" class="btn small ghost" data-edit>Edit</button>`;
      li.addEventListener("click", (e) => {
        if (e.target.closest("[data-edit]")) { openTplEditor(t); return; }
        doc.template = "c:" + t.id;
        renderTplGrid(); changed();
      });
      ul.appendChild(li);
    });
  }

  const tplDlg = $("#tplDialog");
  let editingTpl = null;
  $("#tp-base").innerHTML = Object.entries(T).map(([k, t]) => `<option value="${k}">${esc(t.name)}</option>`).join("");
  $("#tp-font").innerHTML = FONTS.map((f) => `<option>${esc(f)}</option>`).join("");

  function openTplEditor(t) {
    const r = resolveTpl(doc);
    editingTpl = t ? JSON.parse(JSON.stringify(t)) : {
      id: uid(), name: "My template", base: r.key, accent: r.accent, accent2: r.accent2, font: r.font,
      title: "", terms: "", thanks: "", showLogos: true, showSignatures: true, bg: "", bgOpacity: 0.25,
    };
    const e = editingTpl;
    $("#tp-name").value = e.name; $("#tp-base").value = e.base; $("#tp-font").value = e.font;
    $("#tp-accent").value = isHex(e.accent) ? e.accent : "#000000";
    $("#tp-accent2").value = isHex(e.accent2) ? e.accent2 : "#eeeeee";
    $("#tp-title").value = e.title || ""; $("#tp-terms").value = e.terms || ""; $("#tp-thanks").value = e.thanks || "";
    $("#tp-logos").checked = e.showLogos !== false; $("#tp-sign").checked = e.showSignatures !== false;
    $("#tp-bgOpacity").value = e.bgOpacity || 0.25;
    $("#tp-delete").hidden = !t;
    tplDlg.showModal();
  }
  function readTplForm() {
    const e = editingTpl;
    e.name = $("#tp-name").value.trim() || "My template";
    e.base = T[$("#tp-base").value] ? $("#tp-base").value : "classic";
    e.font = $("#tp-font").value; e.accent = $("#tp-accent").value; e.accent2 = $("#tp-accent2").value;
    e.title = $("#tp-title").value.trim(); e.terms = $("#tp-terms").value; e.thanks = $("#tp-thanks").value.trim();
    e.showLogos = $("#tp-logos").checked; e.showSignatures = $("#tp-sign").checked;
    e.bgOpacity = Number($("#tp-bgOpacity").value) || 0.25;
    e.updated = Date.now();
    return e;
  }
  $("#btnTplNew").addEventListener("click", () => openTplEditor(null));
  $("#tplForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const t = readTplForm();
    const i = customTpls.findIndex((x) => x.id === t.id);
    if (i >= 0) customTpls[i] = t; else customTpls.unshift(t);
    if (!store.set(K.templates, customTpls)) toast("Template too large for this browser. Use a smaller background image.");
    doc.template = "c:" + t.id;
    tplDlg.close();
    renderTplGrid(); changed();
    if (A.state.pro) A.pushTemplate(t).catch(() => toast("Saved here. Cloud sync failed."));
  });
  $("#tp-bgFile").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f || !editingTpl) return;
    downscale(f, 1300, "image/jpeg").then((src) => { editingTpl.bg = src; toast("Background added"); }).catch(() => toast("Could not read that image"));
  });
  $("#tp-bgClear").addEventListener("click", () => { if (editingTpl) { editingTpl.bg = ""; toast("Background removed"); } });
  $("#tp-export").addEventListener("click", () => {
    const t = readTplForm();
    download(`recieptsgen-template-${t.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`, JSON.stringify({ app: "RecieptsGen-template", version: 1, template: t }, null, 2), "application/json");
  });
  $("#tp-delete").addEventListener("click", () => {
    if (!editingTpl || !confirm(`Delete template "${editingTpl.name}"? This cannot be undone.`)) return;
    const id = editingTpl.id;
    customTpls = customTpls.filter((x) => x.id !== id);
    store.set(K.templates, customTpls);
    if (doc.template === "c:" + id) doc.template = "classic";
    tplDlg.close(); renderTplGrid(); changed();
    if (A.state.pro) A.deleteTemplate(id).catch(() => {});
  });
  $("#tplImport").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    f.text().then((txt) => {
      const data = JSON.parse(txt);
      const s = data && data.template;
      if (!s || typeof s !== "object") throw new Error();
      const t = {
        id: uid(), name: String(s.name || "Imported template").slice(0, 60),
        base: T[s.base] ? s.base : "classic",
        accent: isHex(s.accent) ? s.accent : "#000000", accent2: isHex(s.accent2) ? s.accent2 : "",
        font: FONTS.includes(s.font) ? s.font : "Onest",
        title: String(s.title || "").slice(0, 40), terms: String(s.terms || "").slice(0, 2000), thanks: String(s.thanks || "").slice(0, 80),
        showLogos: s.showLogos !== false, showSignatures: s.showSignatures !== false,
        bg: typeof s.bg === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(s.bg) ? s.bg : "",
        bgOpacity: Math.min(1, Math.max(0.05, Number(s.bgOpacity) || 0.25)), updated: Date.now(),
      };
      customTpls.unshift(t);
      store.set(K.templates, customTpls);
      doc.template = "c:" + t.id;
      renderTplGrid(); changed();
      if (A.state.pro) A.pushTemplate(t).catch(() => {});
      toast(`Imported "${t.name}"`);
    }).catch(() => toast("That file is not a RecieptsGen template"));
  });

  // ---------- business logo ----------
  function paintFromLogo() {
    const b = $("#fromLogo");
    const html = iconSVG(doc.from.logo);
    b.innerHTML = html || "+";
    b.classList.toggle("empty", !html);
  }
  $("#fromLogo").addEventListener("click", () => openIconPicker((icon) => { doc.from.logo = icon; paintFromLogo(); changed(); }));

  // ---------- items editor ----------
  function renderItems() {
    const wrap = $("#items");
    wrap.innerHTML = "";
    doc.items.forEach((it, idx) => {
      const node = $("#tpl-item").content.firstElementChild.cloneNode(true);
      const ib = $(".icon-btn", node);
      const paintIcon = () => { const html = iconSVG(it.icon); ib.innerHTML = html || "+"; ib.classList.toggle("empty", !html); };
      paintIcon();
      ib.addEventListener("click", () => openIconPicker((icon) => { it.icon = icon; paintIcon(); changed(); }));
      const fields = { ".i-name": "name", ".i-vendor": "vendor", ".i-coverage": "coverage", ".i-qty": "qty", ".i-price": "price", ".i-desc": "desc", ".i-headerLabel": "headerLabel" };
      Object.entries(fields).forEach(([sel, key]) => {
        const el = $(sel, node);
        el.value = it[key] ?? "";
        el.addEventListener("input", () => { it[key] = el.value; changed(); });
      });
      const hl = $(".i-headerLabel", node);
      hl.placeholder = "Header label (defaults to vendor or name)";
      const hc = $(".i-header", node);
      hc.checked = !!it.inHeader;
      hl.disabled = !it.inHeader;
      hc.addEventListener("change", () => { it.inHeader = hc.checked; hl.disabled = !hc.checked; changed(); });
      $(".x", node).addEventListener("click", () => {
        doc.items.splice(idx, 1);
        if (!doc.items.length) doc.items.push(blankItem());
        renderItems(); changed();
      });
      $(".up", node).disabled = idx === 0;
      $(".down", node).disabled = idx === doc.items.length - 1;
      $(".up", node).addEventListener("click", () => move(idx, -1));
      $(".down", node).addEventListener("click", () => move(idx, 1));
      wrap.appendChild(node);
    });
  }
  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= doc.items.length) return;
    [doc.items[i], doc.items[j]] = [doc.items[j], doc.items[i]];
    renderItems(); changed();
  }
  $("#btnAddItem").addEventListener("click", () => {
    doc.items.push(blankItem());
    renderItems(); changed();
    const last = $("#items").lastElementChild;
    last && $(".i-name", last).focus();
  });

  // ---------- icon picker ----------
  const dlg = $("#iconDialog");
  let pickCb = null;
  function buildIconGrid() {
    const grid = $("#iconGrid");
    grid.innerHTML = "";
    ICONS.forEach((name) => {
      const svg = iconSVG({ kind: "lucide", name });
      if (!svg) return;
      const b = document.createElement("button");
      b.type = "button";
      b.title = name.replace("*", " (filled)").replace(/([a-z])([A-Z0-9])/g, "$1 $2");
      b.innerHTML = svg;
      b.addEventListener("click", () => pick({ kind: "lucide", name }));
      grid.appendChild(b);
    });
  }
  function openIconPicker(cb) {
    pickCb = cb;
    if (!$("#iconGrid").children.length) buildIconGrid();
    dlg.showModal();
  }
  function pick(icon) { if (pickCb) pickCb(icon); dlg.close(); }
  $("#iconNone").addEventListener("click", () => pick(null));
  $("#iconFile").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    downscale(f, 200, "image/png").then((src) => pick({ kind: "img", src })).catch(() => toast("Could not read that image"));
  });
  function downscale(file, max, type) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(img.width * s)); cv.height = Math.max(1, Math.round(img.height * s));
        const g = cv.getContext("2d");
        if (type === "image/jpeg") { g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); }
        g.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(img.src);
        resolve(cv.toDataURL(type, 0.85));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  // ---------- saved documents ----------
  function persistDocs() { docs.sort((a, b) => b.updated - a.updated); return store.set(K.docs, docs); }
  function saveDoc(silent) {
    const i = docs.findIndex((x) => x.id === doc.id);
    const copy = JSON.parse(JSON.stringify(doc));
    if (i >= 0) docs[i] = copy; else docs.unshift(copy);
    const ok = persistDocs();
    store.set(K.current, doc);
    renderHistory();
    if (A.state.pro) A.pushDoc(copy).catch(() => toast("Saved here. Cloud sync failed."));
    if (!silent) toast(ok ? (A.state.pro ? "Saved and synced" : "Saved") : "Could not save (storage full or blocked)");
  }
  function renderHistory() {
    const ul = $("#history");
    $("#syncNote").textContent = A.state.pro ? "Synced to your account across devices." : "Saved in this browser only. Pro syncs across devices.";
    if (!docs.length) { ul.innerHTML = `<li class="empty">Nothing saved yet. Press Save to keep this document.</li>`; return; }
    ul.innerHTML = "";
    docs.forEach((d) => {
      const c = calc(d);
      const li = document.createElement("li");
      if (d.id === doc.id) li.classList.add("active");
      li.innerHTML = `<div class="h-main"><div class="h-title">${d.type === "receipt" ? "Receipt" : "Invoice"} ${esc(d.number)}</div>
        <div class="h-sub">${esc(d.bill?.name || "No name")} · ${esc(money(d.currency || "", c.total))}</div></div>
        <button type="button" class="x" title="Delete" aria-label="Delete saved document">&times;</button>`;
      li.addEventListener("click", (e) => {
        if (e.target.closest(".x")) return;
        doc = normalize(JSON.parse(JSON.stringify(d)));
        store.set(K.current, doc);
        fillForm(); renderDoc(); renderHistory();
      });
      $(".x", li).addEventListener("click", () => {
        if (!confirm(`Delete ${d.type} ${d.number}? This cannot be undone.`)) return;
        docs = docs.filter((x) => x.id !== d.id);
        persistDocs();
        if (A.state.pro) A.deleteDoc(d.id).catch(() => {});
        renderHistory();
      });
      ul.appendChild(li);
    });
  }

  $("#btnSave").addEventListener("click", () => saveDoc());
  $("#btnNew").addEventListener("click", () => {
    doc = emptyDoc(doc.type);
    settings.next += 1;
    store.set(K.settings, settings);
    store.set(K.current, doc);
    fillForm(); renderDoc(); renderHistory();
    toast(`New ${doc.type} ${doc.number}`);
  });
  $("#btnConvert").addEventListener("click", () => {
    if (docs.some((x) => x.id === doc.id)) saveDoc(true);
    const next = JSON.parse(JSON.stringify(doc));
    next.id = uid();
    next.status = "auto";
    doc = next;
    setType(doc.type === "invoice" ? "receipt" : "invoice");
    if (doc.type === "receipt") { doc.paid = today(); $("#f-paid").value = doc.paid; }
    renderHistory();
    toast(`Copied as ${doc.type}. Press Save to keep it.`);
  });
  $("#btnExport").addEventListener("click", () => {
    download(`recieptsgen-backup-${today()}.json`, JSON.stringify({ app: "RecieptsGen", version: 1, settings, docs, templates: customTpls }, null, 2), "application/json");
  });
  $("#fileImport").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    f.text().then((t) => {
      const data = JSON.parse(t);
      if (!Array.isArray(data.docs)) throw new Error("bad file");
      const ids = new Set(docs.map((d) => d.id));
      data.docs.forEach((d) => { if (d && d.id && Array.isArray(d.items) && !ids.has(d.id)) docs.push(normalize(d)); });
      persistDocs();
      renderHistory();
      toast(`Imported ${data.docs.length} document(s)`);
    }).catch(() => toast("That file is not a RecieptsGen backup"));
  });

  // ---------- cloud sync (Pro) ----------
  async function syncCloud() {
    if (!A.state.pro) return;
    try {
      const remote = await A.pullDocs();
      const byId = new Map(docs.map((d) => [d.id, d]));
      for (const row of remote) {
        const local = byId.get(row.id);
        if (row.deleted) { if (local) byId.delete(row.id); continue; }
        if (!local || (row.data.updated || 0) > (local.updated || 0)) byId.set(row.id, normalize(row.data));
      }
      const remoteIds = new Set(remote.map((r) => r.id));
      for (const d of docs) if (!remoteIds.has(d.id)) await A.pushDoc(d);
      docs = [...byId.values()];
      persistDocs();

      const rt = await A.pullTemplates();
      const tById = new Map(customTpls.map((t) => [t.id, t]));
      for (const row of rt) {
        if (row.deleted) { tById.delete(row.id); continue; }
        const l = tById.get(row.id);
        if (!l || (row.data.updated || 0) > (l.updated || 0)) tById.set(row.id, row.data);
      }
      const rtIds = new Set(rt.map((r) => r.id));
      for (const t of customTpls) if (!rtIds.has(t.id)) await A.pushTemplate(t);
      customTpls = [...tById.values()];
      store.set(K.templates, customTpls);
      renderHistory(); renderTplGrid(); renderDoc(); renderRecurring();
    } catch (e) { console.warn(e); toast("Cloud sync failed. Your work is still saved here."); }
  }

  // ---------- account UI ----------
  const authDlg = $("#authDialog");
  let authMode = "signin";
  function openAuth(mode, intro) {
    if (!A.state.enabled) { toast("Accounts are being set up. Check back soon."); return; }
    authMode = mode || "signin";
    $("#authErr").textContent = "";
    if (intro) $("#authIntro").textContent = intro;
    paintAuth();
    authDlg.showModal();
  }
  function paintAuth() {
    const m = authMode;
    $("#authTitle").textContent = { signin: "Sign in", signup: "Create your free account", forgot: "Reset password", newpw: "Choose a new password" }[m];
    $("#authSubmit").textContent = { signin: "Sign in", signup: "Create account", forgot: "Send reset link", newpw: "Save password" }[m];
    $("#authPwWrap").hidden = m === "forgot";
    $("#authPw").required = m !== "forgot";
    $("#authEmail").closest("label").hidden = m === "newpw";
    $("#authEmail").required = m !== "newpw";
    $("#authPw").autocomplete = m === "signin" ? "current-password" : "new-password";
    $("#authSwitch").textContent = m === "signup" ? "Have an account? Sign in" : "New here? Create an account";
    $("#authForgot").hidden = m !== "signin";
  }
  $("#authSwitch").addEventListener("click", () => { authMode = authMode === "signup" ? "signin" : "signup"; paintAuth(); });
  $("#authForgot").addEventListener("click", () => { authMode = "forgot"; paintAuth(); });
  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#authEmail").value.trim(), pw = $("#authPw").value;
    const btn = $("#authSubmit");
    btn.disabled = true; $("#authErr").textContent = "";
    try {
      if (authMode === "signin") { await A.signIn(email, pw); authDlg.close(); toast("Signed in"); }
      else if (authMode === "signup") {
        const r = await A.signUp(email, pw);
        authDlg.close();
        toast(r.needsConfirm ? "Check your email to confirm your account" : "Account created");
      } else if (authMode === "forgot") { await A.resetPassword(email); authDlg.close(); toast("Reset link sent. Check your email."); }
      else { await A.updatePassword(pw); authDlg.close(); toast("Password updated"); }
    } catch (err) { $("#authErr").textContent = err.message || "Something went wrong"; }
    finally { btn.disabled = false; }
  });

  function paintAccount() {
    const s = A.state;
    const pill = $("#planPill");
    $("#btnAccount").textContent = s.user ? "Account" : "Sign in";
    if (s.user) {
      pill.hidden = false;
      pill.className = "plan-pill" + (s.pro ? " pro" : "");
      pill.textContent = s.pro ? "Pro" : `Free · ${s.receiptsLeft} receipt${s.receiptsLeft === 1 ? "" : "s"}, ${s.invoicesLeft} invoice${s.invoicesLeft === 1 ? "" : "s"} clean`;
    } else pill.hidden = true;
    document.body.classList.toggle("is-pro", !!s.pro);
    $("#houseAd").hidden = !!s.pro;
  }
  $("#btnAccount").addEventListener("click", () => {
    if (!A.state.user) { openAuth("signin", "Free accounts get 2 receipts and 1 invoice without the \"Made with RecieptsGen\" line."); return; }
    const s = A.state;
    $("#accountBody").innerHTML = `<p><b>${esc(s.user.email)}</b></p>` + (s.pro
      ? `<p>Plan: <b>Pro</b> until ${esc(new Date(s.proUntil).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }))}.</p><p>Pay again any time to add another 30 days.</p>`
      : `<p>Plan: <b>Free</b>. Clean exports left: ${s.receiptsLeft} receipt(s), ${s.invoicesLeft} invoice(s).</p>`);
    $("#accUpgrade").textContent = s.pro ? "Add 30 days" : "Upgrade to Pro";
    $("#accountDialog").showModal();
  });
  $("#btnSignOut").addEventListener("click", async () => { await A.signOut(); $("#accountDialog").close(); toast("Signed out"); });

  function openUpgrade() {
    if (!A.state.enabled) { toast("Pro is being set up. Check back soon."); return; }
    if (!A.state.user) { openAuth("signup", "Create a free account first, then upgrade to Pro."); return; }
    $("#upgradeErr").textContent = "";
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
    $("#upgradeDialog").showModal();
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-upgrade]")) openUpgrade();
    else if (e.target.closest("[data-signin]")) openAuth("signin");
    else if (e.target.closest("[data-close]")) e.target.closest("dialog").close();
  });
  $("#btnPay").addEventListener("click", async () => {
    const b = $("#btnPay");
    b.disabled = true; b.textContent = "Opening Flutterwave...";
    try { await A.startPayment(); }
    catch (err) { $("#upgradeErr").textContent = err.message; b.disabled = false; b.textContent = "Pay with Flutterwave"; }
  });

  // ---------- email + recurring (Pro) ----------
  const requirePro = () => { if (A.state.pro) return true; openUpgrade(); return false; };
  $("#btnEmail").addEventListener("click", () => {
    if (!requirePro()) return;
    $("#emTo").value = doc.bill.email || "";
    $("#emSubject").value = `${doc.type === "receipt" ? "Receipt" : "Invoice"} ${doc.number}${doc.from.name ? ` from ${doc.from.name}` : ""}`;
    $("#emErr").textContent = "";
    $("#emailDialog").showModal();
  });
  $("#emailForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = $("#emSend");
    b.disabled = true; $("#emErr").textContent = "";
    try {
      await A.email(doc, $("#emTo").value.trim(), $("#emSubject").value.trim(), $("#emMsg").value);
      $("#emailDialog").close(); toast("Email sent");
    } catch (err) { $("#emErr").textContent = err.message; }
    finally { b.disabled = false; }
  });
  $("#btnRepeat").addEventListener("click", () => {
    if (!requirePro()) return;
    if (doc.type !== "invoice") { toast("Only invoices can repeat. Switch to Invoice first."); return; }
    const d = new Date(); d.setMonth(d.getMonth() + 1);
    $("#rpStart").value = d.toISOString().slice(0, 10);
    $("#rpErr").textContent = "";
    $("#repeatDialog").showModal();
  });
  $("#repeatForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await A.addRecurring(JSON.parse(JSON.stringify(doc)), $("#rpEvery").value, $("#rpStart").value, $("#rpEmail").checked);
      $("#repeatDialog").close(); toast("This invoice will repeat automatically");
      renderRecurring();
    } catch (err) { $("#rpErr").textContent = err.message; }
  });
  async function renderRecurring() {
    const ul = $("#recurringList");
    if (!A.state.pro) { ul.innerHTML = ""; return; }
    try {
      const rows = await A.listRecurring();
      const label = { weekly: "every week", monthly: "every month", quarterly: "every 3 months", yearly: "every year" };
      ul.innerHTML = rows.length ? "" : `<li class="empty">No repeating invoices yet.</li>`;
      rows.forEach((r) => {
        const li = document.createElement("li");
        li.innerHTML = `<div class="h-main"><div class="h-title">${esc(r.doc.bill?.name || "No name")} · ${esc(r.doc.number)}</div>
          <div class="h-sub">${esc(label[r.every])}, next ${esc(fmtDate(r.next_run))}${r.send_email ? ", emailed" : ""}</div></div>
          <button type="button" class="x" title="Stop repeating" aria-label="Stop repeating">&times;</button>`;
        $(".x", li).addEventListener("click", async () => {
          if (!confirm("Stop repeating this invoice?")) return;
          await A.removeRecurring(r.id).catch((err) => toast(err.message));
          renderRecurring();
        });
        ul.appendChild(li);
      });
    } catch (e) { ul.innerHTML = `<li class="empty">Could not load repeating invoices.</li>`; }
  }

  // ---------- PDF ----------
  function setPageSize() {
    const r = resolveTpl(doc);
    let css = "@page { size: letter; margin: 0; }";
    if (r.def.page === "thermal") {
      const sheet = $("#sheet");
      sheet.style.transform = "";
      const mm = Math.ceil((sheet.offsetHeight * 25.4) / 96) + 2;
      css = `@page { size: 80mm ${mm}mm; margin: 0; }`;
    }
    $("#pageStyle").textContent = css;
  }
  function printNow(clean) {
    forceWm = !clean;
    renderDoc();
    setPageSize();
    const old = document.title;
    document.title = `${doc.type === "receipt" ? "Receipt" : "Invoice"} ${doc.number}`;
    const restore = () => { document.title = old; forceWm = null; renderDoc(); window.removeEventListener("afterprint", restore); };
    window.addEventListener("afterprint", restore);
    window.print();
    setTimeout(() => { if (forceWm !== null) restore(); }, 4000);
  }
  $("#btnPdf").addEventListener("click", async () => {
    const r = resolveTpl(doc);
    const s = A.state;
    if (r.usesPro && !s.pro) { openUpgrade(); return; }
    if (s.pro) { printNow(true); return; }
    if (!s.user) {
      printNow(false);
      if (s.enabled) toast("Sign in free to remove the footer line on 2 receipts and 1 invoice");
      return;
    }
    const b = $("#btnPdf");
    b.disabled = true;
    try {
      const res = await A.claim(doc.id, doc.type);
      paintAccount();
      if (res && res.allowed) printNow(true);
      else { printNow(false); toast(`Free clean ${doc.type}s used up. Upgrade to remove the footer line.`); }
    } catch (e) { printNow(false); toast("Could not check your free exports"); }
    finally { b.disabled = false; }
  });
  window.addEventListener("beforeprint", () => { $("#sheet").style.transform = ""; });
  window.addEventListener("afterprint", fitPreview);

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
  }

  // ---------- boot ----------
  fillForm();
  renderDoc();
  renderHistory();
  paintAccount();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitPreview);

  let wasPro = false;
  A.onChange((s) => {
    paintAccount();
    renderDoc();
    renderHistory();
    if (s.pro && !wasPro) { syncCloud(); renderRecurring(); }
    wasPro = !!s.pro;
  });
  A.init().then(async () => {
    const r = await A.handlePaymentReturn();
    if (r) toast(r.ok ? "Payment received. Welcome to Pro!" : r.error || "Payment not completed");
    if (new URLSearchParams(location.search).get("reset") === "1" && A.state.user) {
      history.replaceState(null, "", location.pathname);
      openAuth("newpw");
    }
  });
})();
