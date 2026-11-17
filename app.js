(() => {
const $ = id => document.getElementById(id);
const SWATCHES = ["#136F63","#1F3A93","#8A2B4A","#B05A16","#3D4A5C","#2B2B2B"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const KEY_DRAFT = "tally.draft.v1", KEY_SAVED = "tally.saved.v1", KEY_VAULT = "tally.vault.v1", KEY_PREFS = "tally.prefs.v1", KEY_CONTACTS = "tally.contacts.v1";
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
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const prettyDay = s => validDate(s) ? DAYS[parseDate(s).getDay()] + " " + pretty(s) : "Date to add";
const GBP = new Intl.NumberFormat("en-GB", {style: "currency", currency: "GBP"});
const money = n => GBP.format(n).replace(/[\u00A0\u202F]/g, " ");
const store = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
const termsLabel = t => t === "custom" ? "" : (t === "0" ? "Due on receipt" : "Within " + t + " days");
function nextNumber(s) {
  const m = String(s || "").match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return (s || "INV") + "-0002";
  const n = String(parseInt(m[2], 10) + 1).padStart(m[2].length, "0");
  return m[1] + n + m[3];
}

/* ---------- state ---------- */
const newPerf = (artist = "") => ({id: uid(), date: "", venue: "", artist, fee: ""});
function blankState(prev) {
  const today = iso(new Date());
  const terms = prev && prev.terms ? prev.terms : "14";
  return {
    example: false, currency: "GBP",
    biz: prev ? {...prev.biz} : {name: "", address: "", email: "", phone: ""},
    logo: prev ? prev.logo : null,
    client: {name: "", contact: "", address: "", email: "", phone: ""},
    number: prev ? nextNumber(prev.number) : "INV-0001",
    issueDate: today, terms, dueDate: addDays(today, terms === "custom" ? 14 : +terms),
    items: [newPerf(prev && prev.items && prev.items[0] ? prev.items[0].artist : "")],
    paid: "",
    payment: prev ? prev.payment : "", notes: prev ? prev.notes : "Thank you for booking us.",
    accent: prev ? prev.accent : SWATCHES[0]
  };
}
function exampleState() {
  const today = iso(new Date());
  return {
    example: true, currency: "GBP",
    biz: {name: "Sam Carter Music", address: "12 Example Road\nBristol", email: "bookings@samcarter.example", phone: "07700 900123"},
    logo: null,
    client: {name: "The Lantern Rooms", contact: "Jo Bennett", address: "Old Market Street\nBristol", email: "events@lanternrooms.example", phone: "0117 496 0123"},
    number: "INV-0001",
    issueDate: today, terms: "14", dueDate: addDays(today, 14),
    items: [
      {id: uid(), date: addDays(today, -9), venue: "The Lantern Rooms, Bristol", artist: "The Midnight Owls", fee: "450"},
      {id: uid(), date: addDays(today, -2), venue: "The Lantern Rooms, Bristol", artist: "The Midnight Owls", fee: "450"}
    ],
    paid: "100",
    payment: "Bank transfer\nAccount name: S Carter\nSort code: 00-00-00\nAccount number: 00000000\nPlease use the invoice number as the reference.",
    notes: "Thank you for booking us.",
    accent: SWATCHES[0]
  };
}
// Bring invoices saved by earlier versions into the gig layout without losing anything.
function normalize(s) {
  if (!s || typeof s !== "object") return s;
  s.currency = "GBP";
  s.client = {name: "", contact: "", address: "", email: "", phone: "", ...(s.client || {})};
  s.items = (Array.isArray(s.items) ? s.items : []).map(it => {
    const q = it.qty === undefined || it.qty === "" ? 1 : num(it.qty);
    return {
      id: it.id || uid(), date: it.date || "", venue: it.venue ?? (it.desc || ""), artist: it.artist || "",
      fee: it.fee ?? (it.price !== undefined && it.price !== "" ? String(Math.round(q * num(it.price) * 100) / 100) : "")
    };
  });
  if (!s.items.length) s.items.push(newPerf());
  ["discount", "discountType", "taxLabel", "taxRate", "paper"].forEach(k => delete s[k]);
  if (s.biz) delete s.biz.taxId;
  return s;
}
/* Contacts: clients you bill again. Old saved invoices are turned into contacts, then dropped. */
const sortContacts = l => l.sort((a, b) => a.name.localeCompare(b.name, "en-GB", {sensitivity: "base"}));
const sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
function cleanContact(c) {
  return {id: c.id || uid(), name: String(c.name).trim(), contact: c.contact || "", address: c.address || "", email: c.email || "", phone: c.phone || "", venue: c.venue || ""};
}
function loadContacts(list, oldInvoices) {
  const out = (Array.isArray(list) ? list : []).filter(c => c && c.name).map(cleanContact);
  (Array.isArray(oldInvoices) ? oldInvoices : []).forEach(e => {
    const c = e && e.state && e.state.client;
    if (c && c.name && !out.some(x => sameName(x.name, c.name))) {
      const venue = ((e.state.items || []).find(it => it.venue) || {}).venue || "";
      out.push(cleanContact({...c, venue}));
    }
  });
  return sortContacts(out);
}
let prefs = Object.assign({noPayment: false, fails: 0, until: 0}, store.get(KEY_PREFS, {}));
let lockEnabled = !!store.get(KEY_VAULT, null);
let cryptoKey = null, vaultSalt = null;
let state = lockEnabled ? blankState(null) : (normalize(store.get(KEY_DRAFT, null)) || exampleState());
const oldInvoices = lockEnabled ? null : store.get(KEY_SAVED, null);
let contacts = lockEnabled ? [] : loadContacts(store.get(KEY_CONTACTS, []), oldInvoices);

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
  const draft = scrub(state), list = contacts.slice();
  if (cryptoKey) {
    const key = cryptoKey, salt = vaultSalt;
    writeChain = writeChain.then(() => seal(key, salt, {draft, contacts: list}))
      .then(v => { if (!store.set(KEY_VAULT, v)) toast("Couldn't save. This browser is blocking storage."); })
      .catch(() => toast("Couldn't encrypt your invoices. Try again."));
    return true;
  }
  store.set(KEY_DRAFT, draft);
  return store.set(KEY_CONTACTS, list);
}

function totals(s) {
  const r = x => Math.round((x + Number.EPSILON) * 100) / 100;
  const lines = s.items.map(it => r(num(it.fee)));
  const total = r(lines.reduce((a, b) => a + b, 0));
  const paid = r(num(s.paid));
  const due = r(total - paid);
  return {lines, total, paid, due, isPaid: total > 0 && due <= 0};
}
/* ---------- form ---------- */
function getPath(o, p) { return p.split(".").reduce((a, k) => a?.[k], o); }
function setPath(o, p, v) { const ks = p.split("."); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; }

function fillForm() {
  document.querySelectorAll("[data-path]").forEach(el => { el.value = getPath(state, el.dataset.path) ?? ""; });
  $("inv-issue").value = state.issueDate || "";
  $("inv-terms").value = state.terms;
  $("inv-due").value = state.dueDate || "";
  renderLogo(); renderSwatches(); renderItems();
}

function renderItems() {
  $("items").innerHTML = state.items.map((it, i) => `
    <div class="item" data-id="${it.id}">
      <div class="item-head"><span class="lbl">Performance ${i + 1}</span>
        <button type="button" class="icon-btn i-del" aria-label="Remove performance ${i + 1}" title="Remove performance">×</button></div>
      <div class="row">
        <label class="field"><span>Date of performance</span><input id="date-${it.id}" class="i-date" type="date" value="${esc(it.date)}"></label>
        <label class="field"><span>Fee (£)</span><input id="fee-${it.id}" class="i-fee" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(it.fee)}" placeholder="0.00"></label>
      </div>
      <label class="field"><span>Venue</span><input id="venue-${it.id}" class="i-venue" type="text" value="${esc(it.venue)}" placeholder="Venue name and town"></label>
      <label class="field"><span>Band or artist</span><input id="artist-${it.id}" class="i-artist" type="text" value="${esc(it.artist)}" placeholder="Who performed"></label>
    </div>`).join("");
}
function updateAmounts() {}
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
  const s = state, t = totals(s), m = money;
  const paper = $("paper");
  paper.style.setProperty("--inv", s.accent);
  paper.style.setProperty("--inv-soft", "rgb(" + tint(hexToRgb(s.accent), .88).join(",") + ")");
  const bizLines = [s.biz.email, s.biz.phone].filter(Boolean).map(esc).join("<br>");
  const rows = s.items.filter(it => it.date || it.venue || it.artist || num(it.fee)).map(it =>
    `<tr><td class="nw">${prettyDay(it.date)}</td><td class="pre">${esc(it.artist) || "—"}</td><td class="pre">${esc(it.venue) || "—"}</td><td class="n">${m(num(it.fee))}</td></tr>`
  ).join("") || `<tr><td class="empty" colspan="4">Add a performance to see it here</td></tr>`;
  const paid = t.paid ? `<dt>Deposit paid</dt><dd>\u2212${m(t.paid)}</dd>` : "";
  const tl = termsLabel(s.terms);
  paper.innerHTML = `
    <div class="p-top">
      <div class="p-from">
        ${s.logo ? `<img class="p-logo" src="${s.logo.data}" alt="">` : ""}
        <div class="p-bizname">${esc(s.biz.name) || '<span class="p-muted">Your name</span>'}</div>
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
        ${s.client.contact ? `<div>FAO ${esc(s.client.contact)}</div>` : ""}
        <div class="p-muted pre">${esc(s.client.address)}</div>
        <div class="p-muted">${esc(s.client.email)}</div>
      </div>
      <dl class="p-meta">
        <dt>Invoice date</dt><dd>${pretty(s.issueDate)}</dd>
        <dt>Due date</dt><dd>${pretty(s.dueDate)}</dd>
        ${tl ? `<dt>Terms</dt><dd>${tl}</dd>` : ""}
        <dt class="due">Balance due</dt><dd class="due">${m(Math.max(t.due, 0))}</dd>
      </dl>
    </div>
    <div class="tablewrap"><table class="p-table">
      <thead><tr><th>Date of performance</th><th>Band / artist</th><th>Venue</th><th class="n">Fee</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <dl class="p-totals">
      <dt class="grand">Total fee</dt><dd class="grand">${m(t.total)}</dd>${paid}
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
  const doc = new jsPDF({unit: "pt", format: "a4"});
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 50;
  const acc = hexToRgb(s.accent), soft = tint(acc, .88), ink = [27, 36, 48], mute = [102, 113, 127], hair = [222, 226, 232];
  const t = totals(s), m = n => pdfText(money(n));
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
  doc.text(pdfText(s.biz.name || "Your name"), M, ly + 11); ly += 28;
  font("normal", 9.5, mute);
  const bizLines = [...String(s.biz.address || "").split("\n"), s.biz.email, s.biz.phone].filter(Boolean);
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
  if (s.client.contact) { font("normal", 9.5, ink); doc.text(pdfText("FAO " + s.client.contact), M, by); by += 13; }
  font("normal", 9.5, mute);
  [...String(s.client.address || "").split("\n"), s.client.email].filter(Boolean)
    .forEach(l => doc.splitTextToSize(pdfText(l), 250).forEach(w => { doc.text(w, M, by); by += 13; }));

  const meta = [["Invoice date", pretty(s.issueDate)], ["Due date", pretty(s.dueDate)]];
  const tl = termsLabel(s.terms); if (tl) meta.push(["Terms", tl]);
  let my = y + 2;
  meta.forEach(([k, v]) => { font("normal", 9.5, mute); doc.text(k, W - M - 190, my); font("normal", 9.5, ink); doc.text(pdfText(v), W - M, my, {align: "right"}); my += 15; });
  my += 4; font("bold", 11, acc); doc.text("Balance due", W - M - 190, my); doc.text(m(Math.max(t.due, 0)), W - M, my, {align: "right"}); my += 10;

  y = Math.max(by, my) + 20;

  // Performances table
  const xDate = M + 8, xArtist = M + 126, xVenue = M + 276, xFee = W - M - 8;
  const artistW = xVenue - xArtist - 14, venueW = (xFee - 70) - xVenue;
  const head = () => {
    doc.setFillColor(...acc); doc.rect(M, y, W - 2 * M, 22, "F");
    font("bold", 8, [255, 255, 255]);
    doc.text("DATE OF PERFORMANCE", xDate, y + 14.5); doc.text("BAND / ARTIST", xArtist, y + 14.5);
    doc.text("VENUE", xVenue, y + 14.5); doc.text("FEE", xFee, y + 14.5, {align: "right"});
    y += 22;
  };
  head();
  s.items.map((it, i) => ({it, fee: t.lines[i]})).filter(({it}) => it.date || it.venue || it.artist || num(it.fee)).forEach(({it, fee}) => {
    font("normal", 9.5, ink);
    const a = doc.splitTextToSize(pdfText(it.artist || "-"), artistW);
    const v = doc.splitTextToSize(pdfText(it.venue || "-"), venueW);
    const rh = Math.max(a.length, v.length) * 12.5 + 12;
    if (y + rh > bottom) { doc.addPage(); y = M; head(); font("normal", 9.5, ink); }
    doc.text(pdfText(prettyDay(it.date)), xDate, y + 15);
    doc.text(a, xArtist, y + 15); doc.text(v, xVenue, y + 15);
    doc.text(m(fee), xFee, y + 15, {align: "right"});
    y += rh; doc.setDrawColor(...hair); doc.line(M, y, W - M, y);
  });

  // Totals
  y += 22;
  if (y + 80 > bottom) { doc.addPage(); y = M; }
  const tx = W - M - 230;
  font("bold", 10.5, ink); doc.text("Total fee", tx, y); doc.text(m(t.total), xFee, y, {align: "right"}); y += 16;
  if (t.paid) { font("normal", 9.5, mute); doc.text("Deposit paid", tx, y); font("normal", 9.5, ink); doc.text("-" + m(t.paid), xFee, y, {align: "right"}); y += 16; }
  doc.setFillColor(...soft); doc.rect(tx - 8, y - 12, W - M - tx + 8, 22, "F");
  font("bold", 11, acc); doc.text("Balance due", tx, y + 3); doc.text(m(Math.max(t.due, 0)), xFee, y + 3, {align: "right"});
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
    else if (r === "shared") toast("Done. Find it in the Files app.");
    else if (r === "downloaded") toast("Downloaded " + name + ".pdf");
  } catch (e) {
    toast("Couldn't create the PDF. " + (e && e.message ? e.message : "Try again."));
  } finally { btn.disabled = false; }
}

/* ---------- contacts ---------- */
let contactQuery = "";
const oneLine = s => String(s || "").split("\n").map(x => x.trim()).filter(Boolean).join(", ");
function renderContacts() {
  $("contacts-count").textContent = contacts.length;
  const q = contactQuery.trim().toLowerCase();
  const list = contacts.filter(c => !q || [c.name, c.contact, c.address, c.email, c.venue].join(" ").toLowerCase().includes(q));
  const empty = $("contacts-empty");
  empty.textContent = !contacts.length ? "No contacts yet. Fill in Bill to, then tap Save to contacts." : "No contacts match that search.";
  empty.hidden = list.length > 0;
  $("contacts-list").innerHTML = list.map(c => `<li data-id="${c.id}">
      <div class="s-main"><span class="c-name">${esc(c.name)}</span><span class="s-sub">${esc([c.contact, oneLine(c.address), c.venue ? "Usual venue: " + c.venue : ""].filter(Boolean).join(" · "))}</span></div>
      <button type="button" class="btn primary c-use">Use</button>
      <button type="button" class="btn ghost danger c-del">Delete</button>
    </li>`).join("");
}
function openContacts() {
  $("drawer").hidden = false; $("btn-contacts").setAttribute("aria-expanded", "true");
  window.scrollTo({top: 0}); renderContacts();
}
function closeContacts() { $("drawer").hidden = true; $("btn-contacts").setAttribute("aria-expanded", "false"); }
function useContact(c) {
  state.client = {name: c.name, contact: c.contact, address: c.address, email: c.email, phone: c.phone};
  if (c.venue) state.items.forEach(it => { if (!it.venue) it.venue = c.venue; });
  fillForm(); changed(); closeContacts();
  toast("Billing " + c.name);
}
function saveContact() {
  const c = state.client;
  if (!c.name || !c.name.trim()) { toast("Add the client's name first."); return; }
  const i = contacts.findIndex(x => sameName(x.name, c.name));
  const venue = (state.items.find(it => it.venue) || {}).venue || (i >= 0 ? contacts[i].venue : "");
  const rec = cleanContact({...c, id: i >= 0 ? contacts[i].id : undefined, venue});
  if (i >= 0) contacts[i] = rec; else contacts.push(rec);
  sortContacts(contacts);
  const ok = persistAll(); renderContacts();
  toast(!ok ? "Couldn't save. This browser is blocking storage." : (i >= 0 ? "Updated " : "Saved ") + rec.name + " in contacts.");
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
  if (el.dataset.path) { setPath(state, el.dataset.path, el.value); return changed(); }
  const row = el.closest(".item");
  if (row) {
    const it = state.items.find(x => x.id === row.dataset.id); if (!it) return;
    if (el.classList.contains("i-date")) it.date = el.value;
    if (el.classList.contains("i-venue")) it.venue = el.value;
    if (el.classList.contains("i-artist")) it.artist = el.value;
    if (el.classList.contains("i-fee")) it.fee = el.value;
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
  if (!state.items.length) state.items.push(newPerf());
  renderItems(); changed();
});
$("btn-add-item").addEventListener("click", () => {
  const last = state.items[state.items.length - 1];
  const it = newPerf(last ? last.artist : ""); if (last) it.venue = last.venue;
  state.items.push(it);
  renderItems(); changed(); $("date-" + it.id).focus();
});
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
  $("example-banner").hidden = true; fillForm(); renderPreview(); persistAll();
  toast("Started " + state.number + ". Your details carried over.");
});
$("btn-clear-example").addEventListener("click", () => {
  state = blankState(null); $("example-banner").hidden = true; fillForm(); renderPreview(); persistAll();
});
$("btn-pdf").addEventListener("click", downloadPdf);
$("btn-contacts").addEventListener("click", () => { if ($("drawer").hidden) openContacts(); else closeContacts(); });
$("btn-pick-contact").addEventListener("click", () => { openContacts(); $("contacts-search").focus(); });
$("contacts-close").addEventListener("click", closeContacts);
$("btn-save-contact").addEventListener("click", saveContact);
$("contacts-search").addEventListener("input", e => { contactQuery = e.target.value; renderContacts(); });
$("contacts-list").addEventListener("click", e => {
  const li = e.target.closest("li"); if (!li) return;
  const c = contacts.find(x => x.id === li.dataset.id); if (!c) return;
  if (e.target.closest(".c-use")) useContact(c);
  else if (e.target.closest(".c-del")) armed(e.target.closest(".c-del"), "Confirm delete", () => {
    contacts = contacts.filter(x => x.id !== c.id); persistAll(); renderContacts(); toast("Deleted " + c.name);
  });
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
    : on ? "Passcode lock is on. Your details and contacts are encrypted on this device. The app locks after 5 minutes without use, or when you've been away from it for over a minute."
    : "Passcode lock is off. Anyone who can open this page on this device can read your details, bank details and contacts.";
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
  store.del(KEY_DRAFT); store.del(KEY_SAVED); store.del(KEY_CONTACTS);
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
  cryptoKey = null; state = blankState(null); contacts = [];
  fillForm(); renderPreview(); renderContacts(); closeContacts();
  document.body.classList.add("is-locked"); $("lock").hidden = false;
  $("lock-pass").value = ""; $("lock-err").textContent = "";
}
async function eraseAll() {
  clearTimeout(saveTimer); await writeChain;
  [KEY_VAULT, KEY_DRAFT, KEY_SAVED, KEY_CONTACTS, KEY_PREFS].forEach(k => store.del(k));
  prefs = {noPayment: false, fails: 0, until: 0};
  lockEnabled = false; cryptoKey = null; vaultSalt = null;
  state = blankState(null); contacts = [];
  document.body.classList.remove("is-locked"); $("lock").hidden = true; $("example-banner").hidden = true;
  fillForm(); renderPreview(); renderContacts(); renderSecurity();
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
    state = normalize(data.draft) || blankState(null); contacts = loadContacts(data.contacts, data.saved);
    if (data.saved) persistAll(); // re-save without old invoices
    document.body.classList.remove("is-locked"); $("lock").hidden = true; $("lock-pass").value = "";
    $("example-banner").hidden = !state.example;
    fillForm(); renderPreview(); renderContacts(); renderSecurity(); lastActive = Date.now();
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
    payload = {app: "tally-invoices", kind: "plain", exportedAt: new Date().toISOString(), data: {draft: scrub(state), contacts}};
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
    if (!b || b.app !== "tally-invoices" || (b.kind === "encrypted" ? !(b.vault && b.vault.ct) : !(b.data && (Array.isArray(b.data.contacts) || Array.isArray(b.data.saved))))) {
      toast("That file isn't a Tally Invoices backup."); return;
    }
    pendingRestore = b;
    const when = b.exportedAt ? pretty(iso(new Date(b.exportedAt))) : "an unknown date";
    $("bk-msg").textContent = "Restore the backup from " + when + "? This replaces your details and contacts currently on this phone." + (b.kind === "encrypted" ? " You'll need the passcode that was in use when the backup was made." : "");
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
    state = blankState(null); contacts = [];
    fillForm(); renderPreview(); renderContacts(); renderSecurity();
    document.body.classList.add("is-locked"); $("lock").hidden = false;
    $("lock-err").textContent = "Backup restored. Enter the passcode it was made with.";
  } else {
    lockEnabled = false;
    state = normalize(b.data.draft) || blankState(null); state.example = false; contacts = loadContacts(b.data.contacts, b.data.saved);
    persistAll(); fillForm(); renderPreview(); renderContacts(); renderSecurity();
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
fillForm(); renderPreview(); renderContacts(); renderSecurity();
if (!lockEnabled && oldInvoices) { persistAll(); store.del(KEY_SAVED); } // invoices are no longer kept
if (lockEnabled) { document.body.classList.add("is-locked"); $("lock").hidden = false; }
})();
