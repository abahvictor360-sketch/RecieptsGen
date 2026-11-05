/* RecieptsGen: invoice and receipt generator. Everything runs in the browser. */
(function () {
  "use strict";

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
  const K = { current: "rg.current.v2", docs: "rg.docs", settings: "rg.settings" };

  // ---------- small utils ----------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const money = (sym, n) => sym + new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
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
    if (icon.kind === "img") return `<img src="${esc(icon.src)}" alt="" />`;
    if (!lucideOK()) return "";
    const filled = icon.name.endsWith("*");
    const name = icon.name.replace("*", "");
    const node = window.lucide.icons[name];
    if (!node) return "";
    const el = window.lucide.createElement(node);
    el.setAttribute("stroke-width", "2");
    if (filled) el.setAttribute("fill", "currentColor");
    el.removeAttribute("class");
    return el.outerHTML;
  }

  // ---------- state ----------
  const defaults = {
    settings: { prefix: "INV", next: 1 },
  };
  let settings = Object.assign({}, defaults.settings, store.get(K.settings, {}));

  const makeNumber = (n) => `${settings.prefix || "INV"}-${new Date().getFullYear()}-${String(n).padStart(4, "0")}`;

  function blankItem() {
    return { id: uid(), icon: { kind: "lucide", name: "Package" }, name: "", vendor: "", desc: "", coverage: "One time", qty: 1, price: "", inHeader: true, headerLabel: "" };
  }

  function sampleDoc() {
    return {
      id: uid(),
      type: "invoice",
      number: makeNumber(settings.next),
      status: "auto",
      issued: today(),
      paid: today(),
      due: "",
      bill: { name: "Customer Name", email: "customer@example.com", extra: "" },
      pay: { method: "Bank transfer", ref: randRef(), txn: "" },
      currency: "₦",
      discount: "",
      taxLabel: "VAT",
      taxRate: "",
      amountPaid: "",
      fx: { on: true, symbol: "US$", rate: 1365 },
      note: "",
      items: [
        { id: uid(), icon: { kind: "lucide", name: "Package" }, name: "Product or service", vendor: "", desc: "Short description of what the customer is paying for.", coverage: "12 months", qty: 1, price: 100000, inHeader: true, headerLabel: "Product" },
        { id: uid(), icon: { kind: "lucide", name: "Wrench" }, name: "Setup service", vendor: "", desc: "One-off setup or installation work.", coverage: "One time", qty: 1, price: 50000, inHeader: true, headerLabel: "Service" },
      ],
      updated: Date.now(),
    };
  }

  function emptyDoc(type) {
    const prev = doc || {};
    return {
      id: uid(),
      type: type || prev.type || "invoice",
      number: makeNumber(settings.next),
      status: "auto",
      issued: today(),
      paid: today(),
      due: "",
      bill: { name: "", email: "", extra: "" },
      pay: { method: prev.pay?.method || "", ref: randRef(), txn: "" },
      currency: prev.currency || "₦",
      discount: "",
      taxLabel: prev.taxLabel || "VAT",
      taxRate: "",
      amountPaid: "",
      fx: Object.assign({ on: false, symbol: "US$", rate: "" }, prev.fx || {}),
      note: "",
      items: [blankItem()],
      updated: Date.now(),
    };
  }

  let doc = null;
  let docs = store.get(K.docs, []);
  doc = store.get(K.current, null);
  if (!doc || !Array.isArray(doc.items)) {
    doc = sampleDoc();
    settings.next += 1;
    store.set(K.settings, settings);
    store.set(K.current, doc);
  }

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

  // ---------- render document ----------
  function renderDoc() {
    const d = doc;
    const c = calc(d);
    const sym = d.currency || "";
    const isRec = d.type === "receipt";
    const status = statusOf(d, c);

    // header logos (deduped by label)
    const seen = new Set();
    const logos = d.items
      .filter((it) => it.inHeader && it.icon)
      .map((it) => ({ icon: it.icon, label: (it.headerLabel || it.vendor || it.name || "").trim() }))
      .filter((l) => { const k = l.label.toLowerCase() + JSON.stringify(l.icon); if (seen.has(k)) return false; seen.add(k); return true; });

    const metaRows = [
      ["No.", d.number],
      ["Issued", fmtDate(d.issued)],
      isRec ? ["Paid", fmtDate(d.paid)] : d.due ? ["Due", fmtDate(d.due)] : null,
    ].filter((r) => r && r[1]);

    const payRows = [
      ["Method", d.pay.method],
      ["Reference", d.pay.ref],
      ["Transaction ID", d.pay.txn],
    ].filter((r) => (r[1] || "").trim());

    const rows = d.items.map((it, i) => {
      const q = num(it.qty === "" ? 1 : it.qty);
      const showQty = it.qty !== "" && q !== 1;
      return `<tr>
        <td class="num">${i + 1}</td>
        <td><div class="prod">
          ${it.icon ? `<span class="ibox">${iconSVG(it.icon)}</span>` : ""}
          <div>
            <div class="prod-name">${esc(it.name)}${it.vendor ? `<span class="vendor"><span class="dot">·</span>${esc(it.vendor)}</span>` : ""}</div>
            ${it.desc ? `<div class="prod-desc">${esc(it.desc)}</div>` : ""}
          </div>
        </div></td>
        <td class="cov">${esc(it.coverage)}${showQty ? `<div class="qty">${esc(q)} × ${esc(money(sym, num(it.price)))}</div>` : ""}</td>
        <td class="amt">${money(sym, c.lines[i])}</td>
      </tr>`;
    }).join("");

    const trows = [];
    trows.push(`<div class="trow sub"><span>Subtotal</span><span>${money(sym, c.subtotal)}</span></div>`);
    if (c.discount > 0) trows.push(`<div class="trow sub"><span>Discount</span><span>−${money(sym, c.discount)}</span></div>`);
    if (c.taxRate > 0) trows.push(`<div class="trow sub"><span>${esc(d.taxLabel || "Tax")} (${esc(c.taxRate)}%)</span><span>${money(sym, c.tax)}</span></div>`);

    const partial = isRec && c.paidSet && Math.abs(c.paid - c.total) > 0.004;
    const grandLabel = partial ? "Total" : isRec ? "Total paid" : "Total due";
    trows.push(`<div class="trow grand"><span>${grandLabel}</span><span>${money(sym, c.total)}</span></div>`);
    if (partial) {
      trows.push(`<div class="trow after"><span>Amount paid</span><span>${money(sym, c.paid)}</span></div>`);
      trows.push(`<div class="trow"><span>Balance due</span><span>${money(sym, c.balance)}</span></div>`);
    }
    const rate = num(d.fx.rate);
    const fxLine = d.fx.on && rate > 0
      ? `<div class="fx">Approx. ${esc(d.fx.symbol)}${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(c.total / rate)} at ${esc(d.fx.symbol)}1 = ${money(sym, rate)}</div>`
      : "";

    const note = (d.note || "").trim() || defaultNote(d);

    $("#sheet").innerHTML = `<div class="doc">
      <div class="doc-head">
        <div class="logos">${logos.map((l) => `<div class="logo"><div class="glyph">${iconSVG(l.icon)}</div><div>${esc(l.label)}</div></div>`).join("")}</div>
        <div class="meta">
          <div class="doc-title">${isRec ? "RECEIPT" : "INVOICE"}</div>
          ${metaRows.map((r) => `<div class="meta-row"><span class="muted">${r[0]}</span>${esc(r[1])}</div>`).join("")}
          ${status ? `<div class="badge">${esc(status)}</div>` : ""}
        </div>
      </div>
      <div class="parties">
        <div>
          <div class="label">Billed to</div>
          ${d.bill.name ? `<div class="kv party-name">${esc(d.bill.name)}</div>` : ""}
          ${d.bill.email ? `<div class="kv">${esc(d.bill.email)}</div>` : ""}
          ${d.bill.extra ? `<div class="kv pre">${esc(d.bill.extra)}</div>` : ""}
        </div>
        <div>
          ${payRows.length ? `<div class="label">Payment</div>${payRows.map((r) => `<div class="kv"><span class="muted">${r[0]}</span> ${esc(r[1])}</div>`).join("")}` : ""}
        </div>
      </div>
      <table class="items">
        <thead><tr><th class="num">#</th><th>Item or product</th><th class="cov">Coverage</th><th class="amt">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals">${trows.join("")}${fxLine}</div>
      ${note ? `<div class="doc-foot">${esc(note)}</div>` : ""}
    </div>`;
    fitPreview();
  }

  // ---------- preview scaling ----------
  function fitPreview() {
    const stage = $("#stage"), inner = $("#stageInner"), sheet = $("#sheet");
    const pad = window.innerWidth <= 860 ? 32 : 32;
    const avail = stage.clientWidth - pad;
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
    ["#f-billName", "bill.name"], ["#f-billEmail", "bill.email"], ["#f-billExtra", "bill.extra"],
    ["#f-payMethod", "pay.method"], ["#f-payRef", "pay.ref"], ["#f-payTxn", "pay.txn"],
    ["#f-currency", "currency"], ["#f-discount", "discount"], ["#f-taxLabel", "taxLabel"], ["#f-taxRate", "taxRate"],
    ["#f-amountPaid", "amountPaid"], ["#f-fxSymbol", "fx.symbol"], ["#f-fxRate", "fx.rate"], ["#f-note", "note"],
  ];
  const getPath = (o, p) => p.split(".").reduce((a, k) => (a ? a[k] : undefined), o);
  const setPath = (o, p, v) => { const ks = p.split("."); const last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; };

  function fillForm() {
    bind.forEach(([sel, path]) => { const el = $(sel); const v = getPath(doc, path); el.value = v ?? ""; });
    $("#f-fxOn").checked = !!doc.fx.on;
    $("#fxFields").hidden = !doc.fx.on;
    $("#f-note").placeholder = defaultNote(doc);
    $("#s-prefix").value = settings.prefix;
    $("#s-next").value = settings.next;
    document.body.dataset.type = doc.type;
    document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.type === doc.type)));
    $("#btnConvert").textContent = doc.type === "invoice" ? "Make receipt" : "Make invoice";
    renderItems();
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
  $("#f-fxOn").addEventListener("change", (e) => { doc.fx.on = e.target.checked; $("#fxFields").hidden = !doc.fx.on; changed(); });
  $("#btnRef").addEventListener("click", () => { doc.pay.ref = randRef(); $("#f-payRef").value = doc.pay.ref; changed(); });
  $("#btnNoteDefault").addEventListener("click", () => { doc.note = ""; $("#f-note").value = ""; changed(); });
  $("#s-prefix").addEventListener("input", (e) => { settings.prefix = e.target.value.trim(); store.set(K.settings, settings); });
  $("#s-next").addEventListener("input", (e) => { settings.next = Math.max(1, parseInt(e.target.value, 10) || 1); store.set(K.settings, settings); });

  document.querySelectorAll(".seg button").forEach((b) =>
    b.addEventListener("click", () => {
      if (doc.type === b.dataset.type) return;
      setType(b.dataset.type);
    })
  );

  function setType(type) {
    const oldDefault = defaultNote(doc);
    doc.type = type;
    if (!doc.note || doc.note.trim() === oldDefault || /^This invoice is payable|^Please make payment via|^Thank you, your payment/.test(doc.note)) doc.note = "";
    if (type === "receipt" && !doc.paid) doc.paid = today();
    fillForm();
    changed();
  }

  // ---------- items editor ----------
  function renderItems() {
    const wrap = $("#items");
    wrap.innerHTML = "";
    doc.items.forEach((it, idx) => {
      const node = $("#tpl-item").content.firstElementChild.cloneNode(true);
      const ib = $(".icon-btn", node);
      const paintIcon = () => {
        const html = iconSVG(it.icon);
        ib.innerHTML = html || "+";
        ib.classList.toggle("empty", !html);
      };
      paintIcon();
      ib.addEventListener("click", () => openIconPicker(it, () => { paintIcon(); changed(); }));

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
      $(".up", node).addEventListener("click", () => { move(idx, -1); });
      $(".down", node).addEventListener("click", () => { move(idx, 1); });
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
  let pickTarget = null, pickDone = null;
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
      b.addEventListener("click", () => { pick({ kind: "lucide", name }); });
      grid.appendChild(b);
    });
  }
  function openIconPicker(item, done) {
    pickTarget = item; pickDone = done;
    if (!$("#iconGrid").children.length) buildIconGrid();
    dlg.showModal();
  }
  function pick(icon) {
    if (pickTarget) { pickTarget.icon = icon; pickDone && pickDone(); }
    dlg.close();
  }
  $("#iconNone").addEventListener("click", () => pick(null));
  $("#iconFile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    downscale(f, 160).then((src) => pick({ kind: "img", src })).catch(() => toast("Could not read that image"));
  });
  function downscale(file, max) {
    return new Promise((resolve, reject) => {
      if (file.type === "image/svg+xml") {
        const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); return;
      }
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(img.src);
        resolve(cv.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  // ---------- saved documents ----------
  function saveDoc(silent) {
    const i = docs.findIndex((x) => x.id === doc.id);
    const copy = JSON.parse(JSON.stringify(doc));
    if (i >= 0) docs[i] = copy; else docs.unshift(copy);
    docs.sort((a, b) => b.updated - a.updated);
    const ok = store.set(K.docs, docs);
    store.set(K.current, doc);
    renderHistory();
    if (!silent) toast(ok ? "Saved" : "Could not save (storage full or blocked)");
  }
  function renderHistory() {
    const ul = $("#history");
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
        doc = JSON.parse(JSON.stringify(d));
        store.set(K.current, doc);
        fillForm(); renderDoc(); renderHistory();
      });
      $(".x", li).addEventListener("click", () => {
        if (!confirm(`Delete ${d.type} ${d.number}? This cannot be undone.`)) return;
        docs = docs.filter((x) => x.id !== d.id);
        store.set(K.docs, docs);
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
    const blob = new Blob([JSON.stringify({ app: "RecieptsGen", version: 1, settings, docs }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `recieptsgen-backup-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("#fileImport").addEventListener("change", (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    f.text().then((t) => {
      const data = JSON.parse(t);
      if (!Array.isArray(data.docs)) throw new Error("bad file");
      const ids = new Set(docs.map((d) => d.id));
      data.docs.forEach((d) => { if (d && d.id && Array.isArray(d.items) && !ids.has(d.id)) docs.push(d); });
      docs.sort((a, b) => b.updated - a.updated);
      store.set(K.docs, docs);
      renderHistory();
      toast(`Imported ${data.docs.length} document(s)`);
    }).catch(() => toast("That file is not a RecieptsGen backup"));
  });

  // ---------- PDF ----------
  $("#btnPdf").addEventListener("click", () => {
    const old = document.title;
    document.title = `${doc.type === "receipt" ? "Receipt" : "Invoice"} ${doc.number}`;
    const restore = () => { document.title = old; window.removeEventListener("afterprint", restore); };
    window.addEventListener("afterprint", restore);
    window.print();
    setTimeout(restore, 3000);
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
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ---------- boot ----------
  const mark = $(".brand-mark");
  if (mark) mark.innerHTML = iconSVG({ kind: "lucide", name: "Receipt" });
  fillForm();
  renderDoc();
  renderHistory();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitPreview);
})();
