(() => {
const $ = id => document.getElementById(id);
const CURRENCIES = [["USD","US dollar"],["EUR","Euro"],["GBP","British pound"],["CAD","Canadian dollar"],["AUD","Australian dollar"],["NZD","New Zealand dollar"],["CHF","Swiss franc"],["JPY","Japanese yen"],["SEK","Swedish krona"],["NOK","Norwegian krone"],["DKK","Danish krone"],["SGD","Singapore dollar"],["HKD","Hong Kong dollar"],["ZAR","South African rand"],["MXN","Mexican peso"]];
const SWATCHES = ["#136F63","#1F3A93","#8A2B4A","#B05A16","#3D4A5C","#2B2B2B"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const KEY_DRAFT = "tally.draft.v1", KEY_SAVED = "tally.saved.v1", KEY_VAULT = "tally.vault.v1", KEY_PREFS = "tally.prefs.v1";
const ITER = 600000, IDLE_MS = 5 * 60 * 1000, AWAY_MS = 60 * 1000;

/* ---------- helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const parseDate = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return iso(d); };
const pretty = s => { if (!validDate(s)) return "—"; const d = parseDate(s); return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); };
const fmtCache = {};
const nf = c => fmtCache[c] || (fmtCache[c] = new Intl.NumberFormat("en-US", {style: "currency", currency: c}));
const money = (n, c) => nf(c).format(n).replace(/[\u00A0\u202F]/g, " ");
const digits = c => nf(c).resolvedOptions().maximumFractionDigits;
const store = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
const termsLabel = t => t === "custom" ? "" : (t === "0" ? "Due on receipt" : "Net " + t);
function nextNumber(s) {
  const m = String(s || "").match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return (s || "INV") + "-0002";
  const n = String(parseInt(m[2], 10) + 1).padStart(m[2].length, "0");
  return m[1] + n + m[3];
}

/* ---------- state ---------- */
function blankState(prev) {
  const today = iso(new Date());
  return {
    example: false,
    biz: prev ? {...prev.biz} : {name: "", address: "", email: "", phone: "", taxId: ""},
    logo: prev ? prev.logo : null,
    client: {name: "", address: "", email: ""},
    number: prev ? nextNumber(prev.number) : "INV-0001",
    currency: prev ? prev.currency : "USD",
    issueDate: today, terms: prev ? prev.terms : "14", dueDate: addDays(today, prev && prev.terms !== "custom" ? +prev.terms : 14),
    items: [{id: uid(), desc: "", qty: "1", price: ""}],
    discount: "", discountType: "pct", taxLabel: prev ? prev.taxLabel : "Tax", taxRate: prev ? prev.taxRate : "", paid: "",
    payment: prev ? prev.payment : "", notes: prev ? prev.notes : "Thank you for your business.",
    accent: prev ? prev.accent : SWATCHES[0], paper: prev ? prev.paper : "a4"
  };
}
function exampleState() {
  const today = iso(new Date());
  return {
    example: true,
    biz: {name: "Northwind Design Co.", address: "48 Harbour Street\nPortland, ME 04101", email: "billing@northwind.example", phone: "(207) 555-0142", taxId: ""},
    logo: null,
    client: {name: "Alder & Finch Bakery", address: "1210 Commercial Avenue\nPortland, ME 04102", email: "accounts@alderfinch.example"},
    number: "INV-0001", currency: "USD",
    issueDate: today, terms: "14", dueDate: addDays(today, 14),
    items: [
      {id: uid(), desc: "Brand identity workshop (half day)", qty: "1", price: "850"},
      {id: uid(), desc: "Logo design: 3 concepts, 2 rounds of revisions", qty: "1", price: "1400"},
      {id: uid(), desc: "Menu board layout (hours)", qty: "6", price: "85"}
    ],
    discount: "5", discountType: "pct", taxLabel: "Tax", taxRate: "8", paid: "",
    payment: "Bank transfer to Example Bank\nAccount 00000000, routing 000000000\nUse the invoice number as the payment reference.",
    notes: "Thank you for your business.",
    accent: SWATCHES[0], paper: "letter"
  };
}
let prefs = Object.assign({noPayment: false, fails: 0, until: 0}, store.get(KEY_PREFS, {}));
let lockEnabled = !!store.get(KEY_VAULT, null);
let cryptoKey = null, vaultSalt = null;
let state = lockEnabled ? blankState(null) : (store.get(KEY_DRAFT, null) || exampleState());
let saved = lockEnabled ? [] : store.get(KEY_SAVED, []);
if (!Array.isArray(saved)) saved = [];

/* ---------- encryption (AES-GCM 256, key from passcode via PBKDF2-SHA256) ---------- */
const hasCrypto = !!(window.crypto && crypto.subtle && window.isSecureContext !== false);
const te = new TextEncoder(), td = new TextDecoder();
function b64(buf) { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(pass, salt, iter) {
  const base = await crypto.subtle.importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({name: "PBKDF2", salt, iterations: iter, hash: "SHA-256"}, base, {name: "AES-GCM", length: 256}, false, ["encrypt", "decrypt"]);
}
async function seal(key, salt, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, te.encode(JSON.stringify(obj)));
  return {v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct)};
}
async function openVault(key, v) {
  const pt = await crypto.subtle.decrypt({name: "AES-GCM", iv: unb64(v.iv)}, key, unb64(v.ct));
  return JSON.parse(td.decode(pt));
}
const scrub = s => prefs.noPayment ? {...s, payment: ""} : s;
const savePrefs = () => store.set(KEY_PREFS, prefs);
let writeChain = Promise.resolve();
function persistAll() {
  if (lockEnabled && !cryptoKey) return false; // locked: never write plain text
  const draft = scrub(state), list = saved.map(e => ({...e, state: scrub(e.state)}));
  if (cryptoKey) {
    const key = cryptoKey, salt = vaultSalt;
    writeChain = writeChain.then(() => seal(key, salt, {draft, saved: list}))
      .then(v => { if (!store.set(KEY_VAULT, v)) toast("Couldn't save. This browser is blocking storage."); })
      .catch(() => toast("Couldn't encrypt your invoices. Try again."));
    return true;
  }
  store.set(KEY_DRAFT, draft);
  return store.set(KEY_SAVED, list);
}

function totals(s) {
  const d = digits(s.currency), f = 10 ** d;
  const r = x => Math.round((x + Number.EPSILON) * f) / f;
  const lines = s.items.map(it => r(num(it.qty) * num(it.price)));
  const subtotal = r(lines.reduce((a, b) => a + b, 0));
  const discount = s.discountType === "pct" ? r(subtotal * Math.min(num(s.discount), 100) / 100) : r(Math.min(num(s.discount), subtotal));
  const taxable = r(subtotal - discount);
  const tax = r(taxable * num(s.taxRate) / 100);
  const total = r(taxable + tax);
  const paid = r(num(s.paid));
  const due = r(total - paid);
  return {lines, subtotal, discount, tax, total, paid, due, isPaid: total > 0 && due <= 0};
}
function status(s) {
  const t = totals(s);
  if (t.isPaid) return "paid";
  if (validDate(s.dueDate) && s.dueDate < iso(new Date())) return "late";
  return "open";
}

/* ---------- form ---------- */
function getPath(o, p) { return p.split(".").reduce((a, k) => a?.[k], o); }
function setPath(o, p, v) { const ks = p.split("."); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; }

function fillForm() {
  document.querySelectorAll("[data-path]").forEach(el => { el.value = getPath(state, el.dataset.path) ?? ""; });
  $("inv-issue").value = state.issueDate || "";
  $("inv-terms").value = state.terms;
  $("inv-due").value = state.dueDate || "";
  setSeg("disc-pct", "disc-flat", state.discountType === "pct");
  setSeg("paper-a4", "paper-letter", state.paper === "a4");
  renderLogo(); renderSwatches(); renderItems();
}
function setSeg(a, b, firstOn) { $(a).setAttribute("aria-pressed", firstOn); $(b).setAttribute("aria-pressed", !firstOn); }

$("inv-currency").innerHTML = CURRENCIES.map(([c, n]) => `<option value="${c}">${c} · ${n}</option>`).join("");

function renderItems() {
  $("items").innerHTML = state.items.map((it, i) => `
    <div class="item" data-id="${it.id}">
      <label class="field"><span class="lbl">Line ${i + 1}</span>
        <textarea id="desc-${it.id}" class="i-desc" rows="1" placeholder="What you did or sold">${esc(it.desc)}</textarea></label>
      <div class="item-nums">
        <label class="field"><span>Qty</span><input id="qty-${it.id}" class="i-qty" type="number" step="any" min="0" inputmode="decimal" value="${esc(it.qty)}"></label>
        <label class="field"><span>Unit price</span><input id="price-${it.id}" class="i-price" type="number" step="any" min="0" inputmode="decimal" value="${esc(it.price)}" placeholder="0.00"></label>
        <div class="amt"><span class="lbl">Amount</span><output id="amt-${it.id}"></output></div>
        <button type="button" class="icon-btn i-del" aria-label="Remove line ${i + 1}" title="Remove line">×</button>
      </div>
    </div>`).join("");
  updateAmounts();
}
function updateAmounts() {
  const t = totals(state);
  state.items.forEach((it, i) => { const o = $("amt-" + it.id); if (o) o.textContent = money(t.lines[i], state.currency); });
}
function renderSwatches() {
  const custom = !SWATCHES.includes(state.accent);
  $("swatches").innerHTML = SWATCHES.map(c => `<button type="button" class="sw" style="background:${c}" data-color="${c}" aria-label="Colour ${c}" aria-pressed="${state.accent === c}"></button>`).join("")
    + `<input type="color" id="accent-custom" aria-label="Custom colour" value="${custom ? state.accent : "#136f63"}">`;
}
function renderLogo() {
  const has = !!state.logo;
  $("logo-thumb").hidden = !has; $("logo-remove").hidden = !has;
  if (has) $("logo-thumb").src = state.logo.data;
}

/* ---------- preview ---------- */
function hexToRgb(h) { const m = /^#?([\da-f]{6})$/i.exec(h || ""); const n = m ? parseInt(m[1], 16) : 0x136F63; return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function tint(rgb, k) { return rgb.map(v => Math.round(v + (255 - v) * k)); }

function renderPreview() {
  const s = state, t = totals(s), c = s.currency, m = n => money(n, c);
  const paper = $("paper");
  paper.style.setProperty("--inv", s.accent);
  paper.style.setProperty("--inv-soft", "rgb(" + tint(hexToRgb(s.accent), .88).join(",") + ")");
  const bizLines = [s.biz.email, s.biz.phone, s.biz.taxId].filter(Boolean).map(esc).join("<br>");
  const rows = s.items.filter(it => it.desc || num(it.price) || num(it.qty) !== 1).map((it) => {
    const i = s.items.indexOf(it);
    return `<tr><td class="pre">${esc(it.desc) || '<span class="p-muted">Untitled item</span>'}</td><td class="n">${esc(num(it.qty))}</td><td class="n">${m(num(it.price))}</td><td class="n">${m(t.lines[i])}</td></tr>`;
  }).join("") || `<tr><td class="empty" colspan="4">Add a line item to see it here</td></tr>`;
  const disc = t.discount ? `<dt>Discount${s.discountType === "pct" ? " (" + esc(num(s.discount)) + "%)" : ""}</dt><dd>\u2212${m(t.discount)}</dd>` : "";
  const tax = num(s.taxRate) ? `<dt>${esc(s.taxLabel || "Tax")} (${esc(num(s.taxRate))}%)</dt><dd>${m(t.tax)}</dd>` : "";
  const paid = t.paid ? `<dt>Paid</dt><dd>\u2212${m(t.paid)}</dd>` : "";
  const tl = termsLabel(s.terms);
  paper.innerHTML = `
    <div class="p-top">
      <div class="p-from">
        ${s.logo ? `<img class="p-logo" src="${s.logo.data}" alt="">` : ""}
        <div class="p-bizname">${esc(s.biz.name) || '<span class="p-muted">Your business name</span>'}</div>
        <div class="p-muted pre">${esc(s.biz.address)}</div>
        <div class="p-muted">${bizLines}</div>
      </div>
      <div class="p-title">
        <h3>INVOICE</h3>
        <div class="p-num">${esc(s.number)}</div>
        ${t.isPaid ? '<div class="stamp">PAID</div>' : ""}
      </div>
    </div>
    <div class="p-mid">
      <div class="p-billto">
        <div class="p-cap">Bill to</div>
        <div style="font-weight:600">${esc(s.client.name) || '<span class="p-muted">Client name</span>'}</div>
        <div class="p-muted pre">${esc(s.client.address)}</div>
        <div class="p-muted">${esc(s.client.email)}</div>
      </div>
      <dl class="p-meta">
        <dt>Issue date</dt><dd>${pretty(s.issueDate)}</dd>
        <dt>Due date</dt><dd>${pretty(s.dueDate)}</dd>
        ${tl ? `<dt>Terms</dt><dd>${tl}</dd>` : ""}
        <dt class="due">Balance due</dt><dd class="due">${m(Math.max(t.due, 0))}</dd>
      </dl>
    </div>
    <div class="tablewrap"><table class="p-table">
      <thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <dl class="p-totals">
      <dt>Subtotal</dt><dd>${m(t.subtotal)}</dd>${disc}${tax}
      <dt class="grand">Total</dt><dd class="grand">${m(t.total)}</dd>${paid}
      <dt class="balance">Balance due</dt><dd class="balance">${m(Math.max(t.due, 0))}</dd>
    </dl>
    ${(s.payment || s.notes) ? `<div class="p-notes">
      ${s.payment ? `<div><div class="p-cap">Payment</div><div class="pre">${esc(s.payment)}</div></div>` : "<div></div>"}
      ${s.notes ? `<div><div class="p-cap">Notes</div><div class="pre">${esc(s.notes)}</div></div>` : ""}
    </div>` : ""}
    <div class="p-foot">${esc(s.number)}${s.biz.name ? " · " + esc(s.biz.name) : ""}</div>`;
}

/* ---------- PDF ---------- */
const CP1252 = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function pdfText(s) {
  return String(s ?? "").replace(/[\u00A0\u202F]/g, " ").replace(/\u2212/g, "-")
    .replace(/[^\n\x20-\x7E\xA0-\xFF]/g, ch => CP1252.includes(ch) ? ch : "?");
}
function buildPdf(s) {
  const {jsPDF} = window.jspdf;
  const doc = new jsPDF({unit: "pt", format: s.paper === "letter" ? "letter" : "a4"});
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 50;
  const acc = hexToRgb(s.accent), soft = tint(acc, .88), ink = [27, 36, 48], mute = [102, 113, 127], hair = [222, 226, 232];
  const t = totals(s), m = n => pdfText(money(n, s.currency));
  const bottom = H - M - 24;
  const font = (style, size, color) => { doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...color); };

  // Header: logo/name left, INVOICE right
  let y = M, left = M;
  if (s.logo) {
    const k = Math.min(170 / s.logo.w, 56 / s.logo.h);
    const w = s.logo.w * k, h = s.logo.h * k;
    try { doc.addImage(s.logo.data, "PNG", M, y, w, h); left = y + h + 12; } catch { left = y; }
  }
  let ly = s.logo ? left : y;
  font("bold", 13, ink);
  doc.text(pdfText(s.biz.name || "Your business"), M, ly + 11); ly += 28;
  font("normal", 9.5, mute);
  const bizLines = [...String(s.biz.address || "").split("\n"), s.biz.email, s.biz.phone, s.biz.taxId].filter(Boolean);
  bizLines.forEach(l => { doc.splitTextToSize(pdfText(l), 260).forEach(w => { doc.text(w, M, ly); ly += 13; }); });

  font("bold", 26, acc); doc.text("INVOICE", W - M, y + 20, {align: "right"});
  font("normal", 10, mute); doc.text(pdfText(s.number), W - M, y + 38, {align: "right"});
  let ry = y + 46;
  if (t.isPaid) {
    const g = [26, 127, 79]; doc.setDrawColor(...g); doc.setLineWidth(1.5);
    doc.roundedRect(W - M - 58, ry, 58, 22, 3, 3); font("bold", 12, g); doc.text("PAID", W - M - 29, ry + 15, {align: "center"}); ry += 30;
  }

  y = Math.max(ly, ry) + 14;
  doc.setDrawColor(...hair); doc.setLineWidth(.75); doc.line(M, y, W - M, y); y += 22;

  // Bill to (left) and meta (right)
  font("bold", 8, mute); doc.text("BILL TO", M, y);
  let by = y + 15;
  font("bold", 11, ink); doc.text(pdfText(s.client.name || "Client name"), M, by); by += 15;
  font("normal", 9.5, mute);
  [...String(s.client.address || "").split("\n"), s.client.email].filter(Boolean)
    .forEach(l => doc.splitTextToSize(pdfText(l), 250).forEach(w => { doc.text(w, M, by); by += 13; }));

  const meta = [["Issue date", pretty(s.issueDate)], ["Due date", pretty(s.dueDate)]];
  const tl = termsLabel(s.terms); if (tl) meta.push(["Terms", tl]);
  let my = y + 2;
  meta.forEach(([k, v]) => { font("normal", 9.5, mute); doc.text(k, W - M - 190, my); font("normal", 9.5, ink); doc.text(pdfText(v), W - M, my, {align: "right"}); my += 15; });
  my += 4; font("bold", 11, acc); doc.text("Balance due", W - M - 190, my); doc.text(m(Math.max(t.due, 0)), W - M, my, {align: "right"}); my += 10;

  y = Math.max(by, my) + 20;

  // Items table
  const xAmt = W - M, xPrice = W - M - 95, xQty = W - M - 185, descW = xQty - 40 - (M + 8);
  const head = () => {
    doc.setFillColor(...acc); doc.rect(M, y, W - 2 * M, 22, "F");
    font("bold", 8.5, [255, 255, 255]);
    doc.text("DESCRIPTION", M + 8, y + 14.5); doc.text("QTY", xQty - 8, y + 14.5, {align: "right"});
    doc.text("UNIT PRICE", xPrice - 8, y + 14.5, {align: "right"}); doc.text("AMOUNT", xAmt - 8, y + 14.5, {align: "right"});
    y += 22;
  };
  head();
  const items = s.items.map((it, i) => ({it, amt: t.lines[i]})).filter(({it}) => it.desc || num(it.price) || num(it.qty) !== 1);
  items.forEach(({it, amt}) => {
    font("normal", 9.5, ink);
    const lines = doc.splitTextToSize(pdfText(it.desc || "Untitled item"), descW);
    const rh = lines.length * 12.5 + 12;
    if (y + rh > bottom) { doc.addPage(); y = M; head(); font("normal", 9.5, ink); }
    doc.text(lines, M + 8, y + 15);
    doc.text(String(num(it.qty)), xQty - 8, y + 15, {align: "right"});
    doc.text(m(num(it.price)), xPrice - 8, y + 15, {align: "right"});
    doc.text(m(amt), xAmt - 8, y + 15, {align: "right"});
    y += rh; doc.setDrawColor(...hair); doc.line(M, y, W - M, y);
  });

  // Totals
  const rowsT = [["Subtotal", m(t.subtotal)]];
  if (t.discount) rowsT.push(["Discount" + (s.discountType === "pct" ? " (" + num(s.discount) + "%)" : ""), "-" + m(t.discount)]);
  if (num(s.taxRate)) rowsT.push([pdfText((s.taxLabel || "Tax") + " (" + num(s.taxRate) + "%)"), m(t.tax)]);
  const need = rowsT.length * 16 + (t.paid ? 16 : 0) + 60;
  y += 18;
  if (y + need > bottom) { doc.addPage(); y = M; }
  const tx = W - M - 230;
  rowsT.forEach(([k, v]) => { font("normal", 9.5, mute); doc.text(k, tx, y); font("normal", 9.5, ink); doc.text(v, W - M - 8, y, {align: "right"}); y += 16; });
  doc.setDrawColor(...hair); doc.line(tx, y - 8, W - M, y - 8); y += 6;
  font("bold", 10.5, ink); doc.text("Total", tx, y); doc.text(m(t.total), W - M - 8, y, {align: "right"}); y += 16;
  if (t.paid) { font("normal", 9.5, mute); doc.text("Paid", tx, y); font("normal", 9.5, ink); doc.text("-" + m(t.paid), W - M - 8, y, {align: "right"}); y += 16; }
  doc.setFillColor(...soft); doc.rect(tx - 8, y - 12, W - M - tx + 8, 22, "F");
  font("bold", 11, acc); doc.text("Balance due", tx, y + 3); doc.text(m(Math.max(t.due, 0)), W - M - 8, y + 3, {align: "right"});
  y += 40;

  // Notes
  const block = (cap, body) => {
    if (!body) return;
    const lines = doc.splitTextToSize(pdfText(body), W - 2 * M);
    if (y + 30 > bottom) { doc.addPage(); y = M; }
    font("bold", 8, mute); doc.text(cap, M, y); y += 14;
    font("normal", 9.5, ink);
    lines.forEach(l => { if (y > bottom) { doc.addPage(); y = M; font("normal", 9.5, ink); } doc.text(l, M, y); y += 13; });
    y += 14;
  };
  block("PAYMENT", s.payment); block("NOTES", s.notes);

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); font("normal", 8, mute);
    doc.text(pdfText(s.number + (s.biz.name ? "  ·  " + s.biz.name : "") + "  ·  Page " + i + " of " + pages), W / 2, H - 28, {align: "center"});
  }
  return doc.output("arraybuffer");
}

/* ---------- files out (iPhone share sheet, or a normal download elsewhere) ---------- */
async function offerFile(name, blob, title) {
  const file = new File([blob], name, {type: blob.type});
  if (navigator.canShare && navigator.canShare({files: [file]})) {
    try { await navigator.share({files: [file], title}); return "shared"; }
    catch (e) { if (e && e.name === "AbortError") return "cancelled"; }
  }
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return "downloaded";
}
async function downloadPdf() {
  if (!window.jspdf) { toast("The PDF tool didn't load. Close the app and open it again."); return; }
  const btn = $("btn-pdf"); btn.disabled = true;
  try {
    const name = (state.number + (state.client.name ? " " + state.client.name : "")).replace(/[\\/:*?"<>|]+/g, "").trim() || "invoice";
    const blob = new Blob([buildPdf(state)], {type: "application/pdf"});
    const r = await offerFile(name + ".pdf", blob, name);
    if (r === "cancelled") toast("PDF not saved.");
    else if (r === "downloaded") toast("Downloaded " + name + ".pdf");
  } catch (e) {
    toast("Couldn't create the PDF. " + (e && e.message ? e.message : "Try again."));
  } finally { btn.disabled = false; }
}

/* ---------- saved invoices ---------- */
function renderSaved() {
  $("saved-count").textContent = saved.length;
  $("saved-empty").hidden = saved.length > 0;
  $("saved-list").innerHTML = saved.map((e, i) => {
    const t = totals(e.state), st = status(e.state);
    return `<li data-i="${i}">
      <div class="s-main"><span class="s-num">${esc(e.state.number)}</span><span class="s-sub">${esc(e.state.client.name || "No client")} · issued ${pretty(e.state.issueDate)}</span></div>
      <span class="pill ${st}">${st === "late" ? "Overdue" : st === "paid" ? "Paid" : "Open"}</span>
      <span class="s-amt">${esc(money(t.total, e.state.currency))}</span>
      <button type="button" class="btn s-open">Open</button>
      <button type="button" class="btn ghost danger s-del">Delete</button>
    </li>`;
  }).join("");
}
function saveCurrent() {
  const copy = JSON.parse(JSON.stringify(state)); copy.example = false;
  const i = saved.findIndex(e => e.state.number === copy.number);
  const entry = {savedAt: Date.now(), state: copy};
  if (i >= 0) saved[i] = entry; else saved.unshift(entry);
  const ok = persistAll();
  renderSaved();
  toast(ok ? (i >= 0 ? "Updated " : "Saved ") + copy.number : "Couldn't save. This browser is blocking storage.");
}

/* ---------- events ---------- */
let saveTimer;
function changed() {
  if (state.example) { state.example = false; $("example-banner").hidden = true; }
  updateAmounts(); renderPreview();
  clearTimeout(saveTimer); saveTimer = setTimeout(() => persistAll(), 300);
}

$("editor").addEventListener("submit", e => e.preventDefault());
$("editor").addEventListener("input", e => {
  const el = e.target;
  if (el.dataset.path) { setPath(state, el.dataset.path, el.value); if (el.dataset.path === "currency") updateAmounts(); return changed(); }
  const row = el.closest(".item");
  if (row) {
    const it = state.items.find(x => x.id === row.dataset.id); if (!it) return;
    if (el.classList.contains("i-desc")) it.desc = el.value;
    if (el.classList.contains("i-qty")) it.qty = el.value;
    if (el.classList.contains("i-price")) it.price = el.value;
    return changed();
  }
  if (el.id === "accent-custom") { state.accent = el.value; document.querySelectorAll(".sw").forEach(b => b.setAttribute("aria-pressed", "false")); return changed(); }
});
$("inv-issue").addEventListener("change", e => {
  state.issueDate = e.target.value;
  if (state.terms !== "custom" && validDate(state.issueDate)) { state.dueDate = addDays(state.issueDate, +state.terms); $("inv-due").value = state.dueDate; }
  changed();
});
$("inv-terms").addEventListener("change", e => {
  state.terms = e.target.value;
  if (state.terms !== "custom" && validDate(state.issueDate)) { state.dueDate = addDays(state.issueDate, +state.terms); $("inv-due").value = state.dueDate; }
  changed();
});
$("inv-due").addEventListener("change", e => { state.dueDate = e.target.value; state.terms = "custom"; $("inv-terms").value = "custom"; changed(); });

$("items").addEventListener("click", e => {
  const b = e.target.closest(".i-del"); if (!b) return;
  const id = b.closest(".item").dataset.id;
  state.items = state.items.filter(x => x.id !== id);
  if (!state.items.length) state.items.push({id: uid(), desc: "", qty: "1", price: ""});
  renderItems(); changed();
});
$("btn-add-item").addEventListener("click", () => {
  const it = {id: uid(), desc: "", qty: "1", price: ""}; state.items.push(it);
  renderItems(); changed(); $("desc-" + it.id).focus();
});
$("disc-pct").addEventListener("click", () => { state.discountType = "pct"; setSeg("disc-pct", "disc-flat", true); changed(); });
$("disc-flat").addEventListener("click", () => { state.discountType = "flat"; setSeg("disc-pct", "disc-flat", false); changed(); });
$("paper-a4").addEventListener("click", () => { state.paper = "a4"; setSeg("paper-a4", "paper-letter", true); changed(); });
$("paper-letter").addEventListener("click", () => { state.paper = "letter"; setSeg("paper-a4", "paper-letter", false); changed(); });
$("swatches").addEventListener("click", e => {
  const b = e.target.closest(".sw"); if (!b) return;
  state.accent = b.dataset.color; renderSwatches(); changed();
});

$("logo-file").addEventListener("change", e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 600 / img.naturalWidth, 240 / img.naturalHeight);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      state.logo = {data: c.toDataURL("image/png"), w: c.width, h: c.height};
      renderLogo(); changed();
    };
    img.onerror = () => toast("That file couldn't be read as an image. Try a PNG or JPG.");
    img.src = reader.result;
  };
  reader.readAsDataURL(f);
  e.target.value = "";
});
$("logo-remove").addEventListener("click", () => { state.logo = null; renderLogo(); changed(); });

$("btn-new").addEventListener("click", () => {
  const prev = state.example ? null : state;
  state = blankState(prev);
  if (prev && saved.some(e => e.state.number === state.number)) {
    let n = state.number; while (saved.some(e => e.state.number === n)) n = nextNumber(n); state.number = n;
  }
  $("example-banner").hidden = true; fillForm(); renderPreview(); persistAll();
  toast("Started " + state.number + ". Your business details carried over.");
});
$("btn-clear-example").addEventListener("click", () => {
  state = blankState(null); $("example-banner").hidden = true; fillForm(); renderPreview(); persistAll();
});
$("btn-save").addEventListener("click", saveCurrent);
$("btn-pdf").addEventListener("click", downloadPdf);
$("btn-saved").addEventListener("click", () => {
  const open = $("drawer").hidden; $("drawer").hidden = !open; $("btn-saved").setAttribute("aria-expanded", open);
});
$("saved-list").addEventListener("click", e => {
  const li = e.target.closest("li"); if (!li) return;
  const i = +li.dataset.i, entry = saved[i]; if (!entry) return;
  if (e.target.closest(".s-open")) {
    state = JSON.parse(JSON.stringify(entry.state)); state.example = false;
    $("example-banner").hidden = true; fillForm(); renderPreview(); persistAll();
    toast("Opened " + state.number); window.scrollTo({top: 0});
  } else if (e.target.closest(".s-del")) {
    const b = e.target.closest(".s-del");
    if (b.dataset.armed) { saved.splice(i, 1); persistAll(); renderSaved(); toast("Deleted " + entry.state.number); }
    else { b.dataset.armed = "1"; b.textContent = "Confirm delete"; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "Delete"; } }, 4000); }
  }
});

let toastTimer;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ---------- security controls ---------- */
function renderSecurity() {
  const on = lockEnabled;
  const st = $("sec-status");
  st.className = "status" + (on ? " on" : "");
  st.textContent = !hasCrypto ? "Passcode lock isn't available in this view because the browser's encryption feature is missing."
    : on ? "Passcode lock is on. Your invoices are encrypted on this device. The app locks after 5 minutes without use, or when you've been away from it for over a minute."
    : "Passcode lock is off. Anyone who can open this page on this device can read your draft and saved invoices.";
  $("sec-setup").hidden = !hasCrypto;
  $("sec-enable").hidden = on || !hasCrypto;
  ["sec-change", "sec-locknow", "sec-disable", "btn-lock"].forEach(id => { $(id).hidden = !on; });
  $("sec-new-lbl").textContent = on ? "New passcode (to change it)" : "Choose a passcode (6+ characters)";
  $("sec-nopay").checked = !!prefs.noPayment;
}
function secErr(msg) { $("sec-err").textContent = msg; }
function readNewPass() {
  const a = $("sec-new").value, b = $("sec-confirm").value;
  if (a.length < 6) { secErr("Use at least 6 characters. Longer is stronger."); return null; }
  if (a !== b) { secErr("The two passcodes don't match."); return null; }
  secErr(""); return a;
}
async function setPass(pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pass, salt, ITER);
  cryptoKey = key; vaultSalt = salt; lockEnabled = true;
  persistAll(); await writeChain;
  store.del(KEY_DRAFT); store.del(KEY_SAVED);
  $("sec-new").value = ""; $("sec-confirm").value = "";
  renderSecurity();
}
function armed(btn, label, fn) {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; fn(); return; }
  btn.dataset.label = btn.textContent; btn.dataset.armed = "1"; btn.textContent = label;
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; } }, 4000);
}
async function lock() {
  if (!lockEnabled || !cryptoKey) return;
  clearTimeout(saveTimer); persistAll(); await writeChain;
  cryptoKey = null; state = blankState(null); saved = [];
  fillForm(); renderPreview(); renderSaved();
  $("drawer").hidden = true; $("btn-saved").setAttribute("aria-expanded", "false");
  document.body.classList.add("is-locked"); $("lock").hidden = false;
  $("lock-pass").value = ""; $("lock-err").textContent = "";
}
async function eraseAll() {
  clearTimeout(saveTimer); await writeChain;
  [KEY_VAULT, KEY_DRAFT, KEY_SAVED, KEY_PREFS].forEach(k => store.del(k));
  prefs = {noPayment: false, fails: 0, until: 0};
  lockEnabled = false; cryptoKey = null; vaultSalt = null;
  state = blankState(null); saved = [];
  document.body.classList.remove("is-locked"); $("lock").hidden = true; $("example-banner").hidden = true;
  fillForm(); renderPreview(); renderSaved(); renderSecurity();
  toast("Everything on this device has been erased.");
}

$("sec-enable").addEventListener("click", async e => {
  const p = readNewPass(); if (!p) return;
  e.currentTarget.disabled = true;
  try { await setPass(p); toast("Passcode lock is on. Your invoices are now encrypted."); }
  catch { secErr("Couldn't turn on the lock. Try again."); }
  finally { $("sec-enable").disabled = false; }
});
$("sec-change").addEventListener("click", async () => {
  const p = readNewPass(); if (!p) return;
  try { await setPass(p); toast("Passcode changed."); } catch { secErr("Couldn't change the passcode. Try again."); }
});
$("sec-locknow").addEventListener("click", lock);
$("btn-lock").addEventListener("click", lock);
$("sec-disable").addEventListener("click", e => armed(e.currentTarget, "Confirm: store unencrypted", async () => {
  await writeChain;
  lockEnabled = false; cryptoKey = null; vaultSalt = null;
  store.del(KEY_VAULT); persistAll(); renderSecurity();
  toast("Passcode lock is off.");
}));
$("sec-erase").addEventListener("click", e => armed(e.currentTarget, "Confirm: erase everything", eraseAll));
$("lock-forgot").addEventListener("click", e => armed(e.currentTarget, "Confirm: erase all invoices", eraseAll));
$("sec-nopay").addEventListener("change", e => {
  prefs.noPayment = e.target.checked; savePrefs(); persistAll();
  toast(prefs.noPayment ? "Payment instructions won't be kept on this device." : "Payment instructions will be kept on this device.");
});

$("lock-form").addEventListener("submit", async e => {
  e.preventDefault();
  const now = Date.now();
  if (prefs.until > now) { $("lock-err").textContent = "Too many wrong tries. Try again in " + Math.ceil((prefs.until - now) / 1000) + " seconds."; return; }
  if (!hasCrypto) { $("lock-err").textContent = "This view can't decrypt your invoices. Open the page in Safari or the Claude app."; return; }
  const pass = $("lock-pass").value; if (!pass) return;
  const btn = $("lock-submit"); btn.disabled = true; btn.textContent = "Unlocking…";
  try {
    const v = store.get(KEY_VAULT, null); if (!v) throw new Error("missing");
    const salt = unb64(v.salt);
    const key = await deriveKey(pass, salt, v.iter || ITER);
    const data = await openVault(key, v);
    cryptoKey = key; vaultSalt = salt; prefs.fails = 0; prefs.until = 0; savePrefs();
    state = data.draft || blankState(null); saved = Array.isArray(data.saved) ? data.saved : [];
    document.body.classList.remove("is-locked"); $("lock").hidden = true; $("lock-pass").value = "";
    $("example-banner").hidden = !state.example;
    fillForm(); renderPreview(); renderSaved(); renderSecurity(); lastActive = Date.now();
  } catch {
    prefs.fails = (prefs.fails || 0) + 1;
    if (prefs.fails >= 5) prefs.until = Date.now() + Math.min(30000 * 2 ** (prefs.fails - 5), 15 * 60000);
    savePrefs();
    $("lock-err").textContent = prefs.fails >= 5 ? "Wrong passcode. Wait a moment before trying again." : "Wrong passcode.";
  } finally { btn.disabled = false; btn.textContent = "Unlock"; }
});

let lastActive = Date.now(), hiddenAt = 0;
["pointerdown", "keydown", "input", "scroll", "touchstart"].forEach(ev => addEventListener(ev, () => { lastActive = Date.now(); }, {passive: true, capture: true}));
setInterval(() => { if (cryptoKey && Date.now() - lastActive > IDLE_MS) lock(); }, 15000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { hiddenAt = Date.now(); if (cryptoKey) document.body.classList.add("privacy-blur"); }
  else {
    document.body.classList.remove("privacy-blur");
    if (cryptoKey && hiddenAt && Date.now() - hiddenAt > AWAY_MS) lock();
    else if (cryptoKey && Date.now() - lastActive > IDLE_MS) lock();
  }
});

/* ---------- backup and restore ---------- */
const today = () => iso(new Date());
$("bk-export").addEventListener("click", async () => {
  clearTimeout(saveTimer);
  let payload;
  if (lockEnabled) {
    const v = store.get(KEY_VAULT, null);
    if (!v) { toast("Nothing to back up yet."); return; }
    payload = {app: "tally-invoices", kind: "encrypted", exportedAt: new Date().toISOString(), vault: v};
  } else {
    persistAll();
    payload = {app: "tally-invoices", kind: "plain", exportedAt: new Date().toISOString(), data: {draft: scrub(state), saved: saved.map(e => ({...e, state: scrub(e.state)}))}};
  }
  const blob = new Blob([JSON.stringify(payload)], {type: "application/json"});
  const r = await offerFile("tally-backup-" + today() + ".json", blob, "Invoice backup");
  if (r === "cancelled") toast("Backup not saved.");
  else toast(lockEnabled ? "Encrypted backup ready." : "Backup ready. It isn't encrypted: turn on the passcode lock for encrypted backups.");
});
let pendingRestore = null;
$("bk-file").addEventListener("change", e => {
  const f = e.target.files && e.target.files[0]; e.target.value = "";
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    let b;
    try { b = JSON.parse(reader.result); } catch { b = null; }
    if (!b || b.app !== "tally-invoices" || (b.kind === "encrypted" ? !(b.vault && b.vault.ct) : !(b.data && Array.isArray(b.data.saved)))) {
      toast("That file isn't a Tally Invoices backup."); return;
    }
    pendingRestore = b;
    const when = b.exportedAt ? pretty(iso(new Date(b.exportedAt))) : "an unknown date";
    $("bk-msg").textContent = "Restore the backup from " + when + "? This replaces every invoice and detail currently on this phone." + (b.kind === "encrypted" ? " You'll need the passcode that was in use when the backup was made." : "");
    $("bk-confirm").hidden = false;
  };
  reader.readAsText(f);
});
$("bk-no").addEventListener("click", () => { pendingRestore = null; $("bk-confirm").hidden = true; });
$("bk-yes").addEventListener("click", async () => {
  const b = pendingRestore; if (!b) return;
  pendingRestore = null; $("bk-confirm").hidden = true;
  clearTimeout(saveTimer); await writeChain;
  store.del(KEY_DRAFT); store.del(KEY_SAVED); store.del(KEY_VAULT);
  cryptoKey = null; vaultSalt = null;
  if (b.kind === "encrypted") {
    store.set(KEY_VAULT, b.vault); lockEnabled = true;
    state = blankState(null); saved = [];
    fillForm(); renderPreview(); renderSaved(); renderSecurity();
    document.body.classList.add("is-locked"); $("lock").hidden = false;
    $("lock-err").textContent = "Backup restored. Enter the passcode it was made with.";
  } else {
    lockEnabled = false;
    state = b.data.draft || blankState(null); state.example = false; saved = b.data.saved;
    persistAll(); fillForm(); renderPreview(); renderSaved(); renderSecurity();
    toast("Backup restored.");
  }
});

/* ---------- offline app: service worker and updates ---------- */
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").then(reg => {
    const show = () => { $("update-banner").hidden = false; };
    if (reg.waiting && hadController) show();
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      if (w) w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) show(); });
    });
    navigator.serviceWorker.ready.then(() => { $("pdf-note").textContent = "Works offline"; });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!hadController || reloading) return; reloading = true; location.reload(); });
  $("btn-update").addEventListener("click", async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    clearTimeout(saveTimer); persistAll(); await writeChain;
    if (reg && reg.waiting) reg.waiting.postMessage("skipWaiting"); else location.reload();
  });
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ---------- boot ---------- */
$("example-banner").hidden = !state.example;
fillForm(); renderPreview(); renderSaved(); renderSecurity();
if (lockEnabled) { document.body.classList.add("is-locked"); $("lock").hidden = false; }
})();
