/* RecieptsGen document templates. Each template turns a prepared context into HTML. */
(function () {
  "use strict";

  // ---------- Code 128 (set B) barcode, real and scannable ----------
  const C128 = ["212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112"];
  function barcodeSVG(text, height) {
    const chars = String(text || "").replace(/[^\x20-\x7E]/g, "").slice(0, 40) || "0";
    const codes = [104];
    for (const ch of chars) codes.push(ch.charCodeAt(0) - 32);
    let sum = 104;
    for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
    codes.push(sum % 103, 106);
    let x = 10, bars = "";
    codes.forEach((code) => {
      C128[code].split("").forEach((w, i) => {
        const width = Number(w);
        if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${width}" height="${height}"/>`;
        x += width;
      });
    });
    return `<svg class="barcode" viewBox="0 0 ${x + 10} ${height}" preserveAspectRatio="none" fill="#000">${bars}</svg>`;
  }

  function qrSVG(url) {
    if (typeof window.qrcode !== "function" || !url) return "";
    try {
      const q = window.qrcode(0, "M");
      q.addData(url);
      q.make();
      return q.createSvgTag({ cellSize: 2, margin: 0, scalable: true });
    } catch { return ""; }
  }

  const lines = (s) => String(s || "").split(/\n/).map((x) => x.trim()).filter(Boolean);

  // Shared small pieces
  function payBlock(x) {
    if (!x.payLink) return "";
    const esc = x.esc;
    return `<div class="paybox"><div class="qr">${qrSVG(x.payLink)}</div>
      <div><div class="pay-h">Pay online</div><div class="pay-u">${esc(x.payLink.replace(/^https:\/\//, ""))}</div></div></div>`;
  }
  // "Pay to" bank details. cls picks the template's styling.
  function bankBlock(x, cls, heading) {
    if (!x.bankRows.length && !x.bankExtra) return "";
    const esc = x.esc;
    return `<div class="bank ${cls}">${heading ? `<div class="bank-h">${esc(heading)}</div>` : ""}${x.bankRows
      .map((r) => `<div class="bank-r"><span class="bank-k">${r[0]}</span> <span class="bank-v">${esc(r[1])}</span></div>`)
      .join("")}${x.bankExtra ? `<div class="bank-x pre">${esc(x.bankExtra)}</div>` : ""}</div>`;
  }
  const watermark = (x) => (x.wm ? `<div class="wm">Made with RecieptsGen &middot; recieptsgen.vercel.app</div>` : "");
  const bg = (x) => (x.bg ? `<img class="tpl-bg" src="${x.esc(x.bg)}" alt="" style="opacity:${x.bgOpacity}" />` : "");
  const fromBlock = (x, cls) => {
    const f = x.d.from || {};
    const esc = x.esc;
    const rows = [...lines(f.address), f.phone, f.email].filter(Boolean);
    if (!f.name && !rows.length) return "";
    return `<div class="${cls}">${f.name ? `<div class="from-name">${esc(f.name)}</div>` : ""}${rows.map((r) => `<div>${esc(r)}</div>`).join("")}</div>`;
  };
  const brandGlyph = (x) => {
    const f = x.d.from || {};
    if (f.logo) return x.iconSVG(f.logo);
    const first = x.d.items.find((it) => it.icon);
    return first ? x.iconSVG(first.icon) : "";
  };

  // ---------- 1. Classic (free) ----------
  function classic(x) {
    const { d, esc, c } = x;
    const rows = d.items.map((it, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td><div class="prod">
          ${it.icon ? `<span class="ibox">${x.iconSVG(it.icon)}</span>` : ""}
          <div>
            <div class="prod-name">${esc(it.name)}${it.vendor ? `<span class="vendor"><span class="dot">·</span>${esc(it.vendor)}</span>` : ""}</div>
            ${it.desc ? `<div class="prod-desc">${esc(it.desc)}</div>` : ""}
          </div>
        </div></td>
        <td class="cov">${esc(it.coverage)}${x.qtyNote(it)}</td>
        <td class="amt">${x.money(c.lines[i])}</td>
      </tr>`).join("");
    return `<div class="doc t-classic">
      ${bg(x)}
      <div class="doc-head">
        <div>
          ${x.showLogos ? `<div class="logos">${x.logos.map((l) => `<div class="logo"><div class="glyph">${x.iconSVG(l.icon)}</div><div>${esc(l.label)}</div></div>`).join("")}</div>` : ""}
          ${fromBlock(x, "from")}
        </div>
        <div class="meta">
          <div class="doc-title">${esc(x.title)}</div>
          ${x.metaRows.map((r) => `<div class="meta-row"><span class="muted">${r[0]}</span>${esc(r[1])}</div>`).join("")}
          ${x.status ? `<div class="badge">${esc(x.status)}</div>` : ""}
        </div>
      </div>
      <div class="parties">
        <div>
          <div class="label">Billed to</div>
          ${d.bill.name ? `<div class="kv party-name">${esc(d.bill.name)}</div>` : ""}
          ${d.bill.email ? `<div class="kv">${esc(d.bill.email)}</div>` : ""}
          ${d.bill.extra ? `<div class="kv pre">${esc(d.bill.extra)}</div>` : ""}
        </div>
        <div>${x.payRows.length ? `<div class="label">Payment</div>${x.payRows.map((r) => `<div class="kv"><span class="muted">${r[0]}</span> ${esc(r[1])}</div>`).join("")}` : ""}</div>
      </div>
      <table class="items">
        <thead><tr><th class="num">#</th><th>Item or product</th><th class="cov">Coverage</th><th class="amt">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="bottom">
        <div class="bottom-left">${bankBlock(x, "bank-classic", "Pay to")}${payBlock(x)}${x.terms ? `<div class="terms"><div class="label">Terms</div><div class="pre">${esc(x.terms)}</div></div>` : ""}</div>
        <div class="totals">${x.totalRows.map((r) => `<div class="trow ${r.cls}"><span>${esc(r.label)}</span><span>${esc(r.value)}</span></div>`).join("")}${x.fxLine ? `<div class="fx">${esc(x.fxLine)}</div>` : ""}</div>
      </div>
      ${x.note ? `<div class="doc-foot">${esc(x.note)}</div>` : ""}
      ${watermark(x)}
    </div>`;
  }

  // ---------- 2. Thermal till slip (Pro) ----------
  function thermal(x) {
    const { d, esc, c } = x;
    const f = d.from || {};
    const info = [
      ["No.", d.number],
      ["Payment type", d.pay.method],
      ["Reference", d.pay.ref],
      ["Transaction ID", d.pay.txn],
      ["Customer", d.bill.name],
      ["Status", x.status ? x.status.charAt(0) + x.status.slice(1).toLowerCase() : ""],
    ].filter((r) => (r[1] || "").trim());
    return `<div class="doc t-thermal">
      ${bg(x)}
      <div class="th-name">${esc(f.name || x.title)}</div>
      <div class="th-addr">${[...lines(f.address), f.phone, f.email].filter(Boolean).map((r) => `<div>${esc(r)}</div>`).join("")}</div>
      <div class="th-dash"></div>
      <div class="th-row"><span>${esc(x.fmtDate(d.issued))}</span><span>${esc(x.title)}</span></div>
      <div class="th-dash"></div>
      <div class="th-row th-head"><span>ITEM</span><span>AMOUNT</span></div>
      ${d.items.map((it, i) => `<div class="th-row"><span>${esc(it.name)}${x.qtyNoteInline(it)}</span><span>${x.money(c.lines[i])}</span></div>`).join("")}
      ${x.totalRows.map((r) => `<div class="th-row ${r.cls === "grand" ? "th-total" : ""}"><span>${esc(r.label)}${r.cls === "grand" ? ":" : ""}</span><span>${esc(r.value)}</span></div>`).join("")}
      ${x.fxLine ? `<div class="th-fx">${esc(x.fxLine)}</div>` : ""}
      <div class="th-dash"></div>
      ${info.map((r) => `<div class="th-row"><span>${r[0]}</span><span>${esc(r[1])}</span></div>`).join("")}
      <div class="th-dash"></div>
      ${x.bankRows.length || x.bankExtra ? `${x.bankRows.map((r) => `<div class="th-row"><span>${r[0]}</span><span>${esc(r[1])}</span></div>`).join("")}${x.bankExtra ? `<div class="th-fx pre">${esc(x.bankExtra)}</div>` : ""}<div class="th-dash"></div>` : ""}
      <div class="th-thanks">${esc(x.thanks)}</div>
      ${payBlock(x)}
      <div class="th-bar">${barcodeSVG(d.number, 40)}</div>
      ${watermark(x)}
    </div>`;
  }

  // ---------- 3. Warm colored (Pro) ----------
  function warm(x) {
    const { d, esc, c } = x;
    const f = d.from || {};
    const pad = Math.max(0, 7 - d.items.length);
    const body = d.items.map((it, i) => `<tr>
        <td><div class="w-item">${esc(it.name)}${it.vendor ? ` · ${esc(it.vendor)}` : ""}</div>${it.desc ? `<div class="w-desc">${esc(it.desc)}</div>` : ""}</td>
        <td class="c">${esc(it.qty === "" ? 1 : it.qty)}</td>
        <td class="r">${x.money(Number(it.price) || 0)}</td>
        <td class="r">${x.money(c.lines[i])}</td></tr>`).join("") + "<tr class=\"blank\"><td></td><td></td><td></td><td></td></tr>".repeat(pad);
    return `<div class="doc t-warm">
      ${bg(x)}
      <svg class="w-blob" viewBox="0 0 400 190" aria-hidden="true">
        <path d="M0 0h400c-22 30-60 30-92 22-36-9-62 6-80 34-22 34-58 58-112 52C64 103 30 128 0 170z" fill="var(--acc2)"/>
        <path d="M0 0h250c-10 26-40 36-70 34-34-2-52 22-62 44-16 34-58 44-118 36z" fill="var(--acc)" opacity=".55"/>
        <circle cx="70" cy="34" r="20" fill="var(--acc)" opacity=".35"/>
        <circle cx="170" cy="22" r="14" fill="none" stroke="var(--acc)" stroke-width="3" opacity=".6"/>
        <path d="M300 10c20 4 34 18 40 36" fill="none" stroke="var(--acc)" stroke-width="2.5" opacity=".5"/>
      </svg>
      <div class="w-top">
        <div class="w-title">${esc(x.title)}</div>
        <div class="w-meta">
          <div><span>Date</span>: ${esc(x.fmtDate(d.issued))}</div>
          <div><span>No.</span>: ${esc(d.number)}</div>
          ${x.status ? `<div><span>Status</span>: ${esc(x.status)}</div>` : ""}
        </div>
      </div>
      <div class="w-parties">
        <div>
          <div class="w-brand"><span class="w-glyph">${brandGlyph(x)}</span><span>${esc(f.name || "Your Business")}</span></div>
          <div class="w-addr">${[...lines(f.address), f.phone, f.email].filter(Boolean).map((r) => `<div>${esc(r)}</div>`).join("")}</div>
        </div>
        <div>
          <div class="w-to-label">To:</div>
          <div class="w-to">${d.bill.name ? `<b>${esc(d.bill.name)}</b>` : ""}${d.bill.email ? `<div>${esc(d.bill.email)}</div>` : ""}${d.bill.extra ? `<div class="pre">${esc(d.bill.extra)}</div>` : ""}</div>
        </div>
      </div>
      <table class="w-table">
        <thead><tr><th>DESCRIPTIONS</th><th class="c alt">QTY</th><th class="r">PRICE</th><th class="r alt">TOTAL</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="w-bottom">
        <div class="w-terms">
          <div class="w-terms-h">Terms and Conditions</div>
          <div class="pre">${esc(x.terms || x.note || "Payment is due on receipt of this document.")}</div>
          ${x.payRows.length ? `<div class="w-pay">${x.payRows.map((r) => `<div><b>${r[0]}:</b> ${esc(r[1])}</div>`).join("")}</div>` : ""}
          ${bankBlock(x, "bank-warm", "Pay to")}
          ${payBlock(x)}
        </div>
        <div class="w-totals">
          ${x.totalRows.map((r) => `<div class="w-trow ${r.cls === "grand" ? "grand" : ""}"><span>${esc(r.label)}</span><span>${esc(r.value)}</span></div>`).join("")}
          ${x.fxLine ? `<div class="w-fx">${esc(x.fxLine)}</div>` : ""}
        </div>
      </div>
      ${x.showSignatures ? `<div class="w-sign"><div><div class="w-sign-h">Received By</div><div class="w-sign-b"></div></div><div><div class="w-sign-h">Client</div><div class="w-sign-b"></div></div></div>` : ""}
      ${watermark(x)}
    </div>`;
  }

  // ---------- 4. Bold sales slip (Pro) ----------
  function bold(x) {
    const { d, esc, c } = x;
    const f = d.from || {};
    const pad = Math.max(0, 8 - d.items.length);
    const body = d.items.map((it, i) => `<tr>
        <td class="c">${esc(it.qty === "" ? 1 : it.qty)}</td>
        <td><div class="b-item">${esc(it.name)}${it.vendor ? ` · ${esc(it.vendor)}` : ""}</div>${it.desc ? `<div class="b-desc">${esc(it.desc)}</div>` : ""}</td>
        <td class="r">${x.money(Number(it.price) || 0)}</td>
        <td class="r">${x.money(c.lines[i])}</td></tr>`).join("") + "<tr class=\"blank\"><td></td><td></td><td></td><td></td></tr>".repeat(pad);
    const extraRows = x.totalRows.filter((r) => r.cls !== "grand");
    const grand = x.totalRows.find((r) => r.cls === "grand");
    return `<div class="doc t-bold">
      ${bg(x)}
      <div class="b-name">${esc(f.name || "YOUR BUSINESS")}</div>
      <div class="b-addr">${[...lines(f.address), f.phone, f.email].filter(Boolean).map((r) => `<div>${esc(r)}</div>`).join("")}</div>
      <div class="b-sub">${esc(x.title)} No. ${esc(d.number)}${x.status ? ` &middot; ${esc(x.status)}` : ""}</div>
      <div class="b-fields">
        <div class="b-f wide"><label>Sold to:</label><div class="b-box">${esc(d.bill.name)}</div></div>
        <div class="b-f"><label>Date:</label><div class="b-box">${esc(x.fmtDate(d.issued))}</div></div>
        <div class="b-f wide"><label>Address:</label><div class="b-box">${esc(lines(d.bill.extra).join(", "))}</div></div>
        <div class="b-f"><label>Contact:</label><div class="b-box">${esc(d.bill.email)}</div></div>
      </div>
      <table class="b-table">
        <thead><tr><th class="c">Qty</th><th>Description</th><th>Price</th><th>Amount</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="b-bottom">
        <div class="b-left">
          ${extraRows.length > 1 || x.fxLine ? `<div class="b-extra">${extraRows.map((r) => `<div><span>${esc(r.label)}</span><span>${esc(r.value)}</span></div>`).join("")}${x.fxLine ? `<div class="b-fx">${esc(x.fxLine)}</div>` : ""}</div>` : ""}
          ${x.payRows.length ? `<div class="b-pay">${x.payRows.map((r) => `${r[0]}: ${esc(r[1])}`).join(" &nbsp;·&nbsp; ")}</div>` : ""}
          ${bankBlock(x, "bank-bold", "Pay to")}
          ${payBlock(x)}
          <div class="b-note">${esc(x.note || "")}</div>
        </div>
        <div class="b-right">
          <div class="b-total"><div>${esc(grand.label)}</div><div>${esc(grand.value)}</div></div>
          <div class="b-thanks">THANK YOU</div>
        </div>
      </div>
      ${watermark(x)}
    </div>`;
  }

  window.RG_TEMPLATES = {
    classic: { name: "Classic", pro: false, page: "letter", accent: "#000000", font: "Onest", render: classic },
    thermal: { name: "Till slip", pro: true, page: "thermal", accent: "#000000", font: "Poppins", render: thermal },
    warm: { name: "Warm", pro: true, page: "letter", accent: "#F47B3B", font: "Poppins", render: warm },
    bold: { name: "Bold", pro: true, page: "letter", accent: "#E8114B", font: "Archivo", render: bold },
  };
  window.RG_FONTS = ["Onest", "Poppins", "Inter", "Archivo", "Playfair Display", "Roboto Mono"];
})();
