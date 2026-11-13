// Private owner dashboard. Every request is authorized on the server; nothing here is a security boundary.
import { api, money, esc, fmtDate, statusPill, SERVICE_NAMES, toast, compressImage, uploadSigned } from "./api.js";
import { session, signOut, loginForm, supabase } from "./auth.js";

const root = document.getElementById("admin-app");
let token, who;
const call = (route, body = {}) => api(`admin/${route}`, body, { token });
const $ = (sel, el = root) => el.querySelector(sel);
const $$ = (sel, el = root) => [...el.querySelectorAll(sel)];
const TABS = ["Overview", "Bookings", "Schedule", "Customers", "Memberships", "Pricing", "Finances", "Gallery", "Reviews", "Emails", "Settings"];

async function main() {
  const s = await session();
  if (!s.session) {
    loginForm(root, { title: "Owner sign-in", sub: "Private dashboard for All Season Yard Care Long Island.", target: "admin", allowPassword: true });
    if (s.error) root.insertAdjacentHTML("afterbegin", `<div class="notice err" style="max-width:480px;margin:0 auto 14px"><p>${esc(s.error)}</p></div>`);
    return;
  }
  token = s.session.access_token;
  supabase.auth.onAuthStateChange((_e, sess) => { if (sess) token = sess.access_token; });
  try { who = await call("whoami"); }
  catch (e) { root.innerHTML = `<div class="notice err" style="max-width:520px;margin:0 auto"><p>${e.status === 403 ? "This account doesn't have owner access." : esc(e.message)}</p><p><button class="btn ghost sm" id="so">Sign out</button></p></div>`; $("#so").onclick = signOut; return; }
  root.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px"><div><div class="eyebrow">Owner dashboard</div><h1 style="font-size:1.7rem;margin:0">All Season Yard Care</h1></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="pill ${who.stripe === "live" ? "ok" : who.stripe === "test" ? "warn" : "err"}">Stripe: ${who.stripe === "off" ? "not connected" : who.stripe + " mode"}</span><span class="pill ${who.email_provider ? "ok" : "err"}">Email: ${who.email_provider ? "on" : "not set up"}</span><button class="btn ghost sm" data-new>+ Phone booking</button><button class="btn ghost sm" data-signout>Sign out</button></div></div>
    <div class="tabs" role="tablist">${TABS.map((t, i) => `<button role="tab" data-tab="${t}" aria-selected="${i === 0}">${t}</button>`).join("")}</div><div id="pane"></div>
    <div class="drawer" id="drawer"><div class="sheet" id="sheet"></div></div>`;
  $("[data-signout]").onclick = signOut;
  $("[data-new]").onclick = newBooking;
  $$("[data-tab]").forEach((b) => (b.onclick = () => show(b.dataset.tab)));
  $("#drawer").addEventListener("click", (e) => { if (e.target.id === "drawer") closeDrawer(); });
  show(location.hash.slice(1) || "Overview");
}

function show(tab) {
  if (!TABS.includes(tab)) tab = "Overview";
  history.replaceState(null, "", "#" + tab);
  $$("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  $("#pane").innerHTML = `<div class="empty"><span class="spinner dark"></span></div>`;
  ({ Overview, Bookings, Schedule, Customers, Memberships, Pricing, Finances, Gallery, Reviews, Emails, Settings })[tab]().catch((e) => ($("#pane").innerHTML = `<div class="notice err"><p>${esc(e.message)}</p></div>`));
}
const pane = () => $("#pane");
const openDrawer = (html) => { $("#sheet").innerHTML = `<button class="btn ghost sm" style="float:right" data-close>Close</button>` + html; $("#drawer").classList.add("open"); $("[data-close]", $("#sheet")).onclick = closeDrawer; };
const closeDrawer = () => $("#drawer").classList.remove("open");
const svcName = (s) => SERVICE_NAMES[s] || s;
const winLabel = (w) => ({ am: "AM", pm: "PM", storm: "Storm" }[w] || "");

// ---------------- Overview
async function Overview() {
  const d = await call("overview");
  const setup = [];
  if (d.setup.stripe === "off") setup.push("Stripe isn't connected yet — online payments are off (bookings come in as requests).");
  else if (d.setup.stripe === "test") setup.push("Stripe is in <b>test mode</b> — no real money is collected. Switch to live keys when you're ready.");
  if (!d.setup.products && d.setup.stripe !== "off") setup.push(`Membership products aren't set up in Stripe yet. <button class="link-btn" data-stripe-setup>Set them up now</button>`);
  if (!d.setup.email) setup.push("Email sending isn't set up — customers won't get confirmations or reminders yet.");
  if (!d.setup.googleReviewUrl) setup.push("Add your Google Business Profile review link in Settings.");
  pane().innerHTML = `${setup.length ? `<div class="notice warn" style="margin-bottom:18px"><p><b>Setup checklist</b></p><ul style="margin:6px 0 0;padding-left:18px">${setup.map((s) => `<li>${s}</li>`).join("")}</ul></div>` : ""}
  <div class="kpis">
    <div class="kpi"><span>Jobs today</span><b>${d.todayJobs.length}</b></div>
    <div class="kpi"><span>Needs attention</span><b>${d.pending.length}</b></div>
    <div class="kpi"><span>Collected this month</span><b>${money(d.monthRevenueCents, true)}</b><span class="fine" style="text-transform:none;letter-spacing:0;font-weight:400">gross, not profit</span></div>
    <div class="kpi"><span>Active members</span><b>${d.activeSubscriptions}</b></div>
    <div class="kpi"><span>Balances owed</span><b>${money(d.outstandingCents, true)}</b></div>
    <div class="kpi"><span>Cancelled this month</span><b>${d.cancelledThisMonth}</b></div></div>
  <div class="grid g2">
   <div><h3>Today — ${fmtDate(d.today, { weekday: "long", month: "short", day: "numeric" })}</h3>${list(d.todayJobs, (b) => `${winLabel(b.time_window)} · <b>${esc(b.customers?.name)}</b> · ${esc(svcName(b.service))}<br><span class="fine">${esc(b.properties?.address || "")} ${b.customers?.phone ? "· " + esc(b.customers.phone) : ""}</span>${b.weather_flag ? `<br><span class="pill warn">${esc(b.weather_flag)}</span>` : ""}`, "No jobs today.")}
   <h3 style="margin-top:22px">Needs attention</h3>${list(d.pending, (b) => `<b>${esc(b.ref)}</b> · ${esc(b.customers?.name)} · ${statusPill(b.status)}<br><span class="fine">${esc(svcName(b.service))}${b.cancel_requested_at ? " · <b>cancellation requested</b>" : ""}${b.reschedule_request ? " · <b>reschedule requested</b>" : ""}${b.review_reasons?.length ? " · " + esc(b.review_reasons.join("; ")) : ""}</span>`, "All caught up.")}</div>
   <div><h3>Next 14 days</h3>${list(d.upcoming, (b) => `${fmtDate(b.service_date)} ${winLabel(b.time_window)} · <b>${esc(b.customers?.name)}</b> · ${esc(svcName(b.service))} ${statusPill(b.status)}${b.weather_flag ? ` <span class="pill warn">${esc(b.weather_flag)}</span>` : ""}`, "Nothing scheduled.")}
   <h3 style="margin-top:22px">Recent payments</h3>${list(d.recentPayments, (p) => `${money(p.amount_cents, true)} · ${esc(p.customers?.name || "")} · ${esc(p.kind)}${p.method !== "card" ? " (" + esc(p.method) + ")" : ""}<br><span class="fine">${fmtDate(p.created_at)}${p.refunded_cents ? " · refunded " + money(p.refunded_cents, true) : ""}</span>`, "No payments yet.")}
   ${d.recentErrors?.length ? `<h3 style="margin-top:22px">Recent system errors</h3>${list(d.recentErrors, (e) => `<span class="fine">${fmtDate(e.at)} · ${esc(e.source)}: ${esc(e.message)}</span>`)}` : ""}</div></div>
  <p style="margin-top:16px"><button class="btn ghost sm" data-wx>Check weather for upcoming jobs</button></p><div id="wx"></div>`;
  wireBookingLinks(d);
  $("[data-wx]").onclick = weather;
  $("[data-stripe-setup]")?.addEventListener("click", stripeSetup);
}
function list(arr, fn, empty = "") {
  if (!arr?.length) return `<p class="fine">${empty}</p>`;
  return `<div class="tbl-wrap"><table class="tbl"><tbody>${arr.map((x) => `<tr class="${x.id && x.ref ? "click" : ""}" ${x.id && x.ref ? `data-bid="${x.id}"` : ""}><td>${fn(x)}</td></tr>`).join("")}</tbody></table></div>`;
}
function wireBookingLinks() { $$("[data-bid]").forEach((tr) => (tr.onclick = () => openBooking(tr.dataset.bid))); }
async function weather() {
  const out = $("#wx"); out.innerHTML = `<p class="fine"><span class="spinner dark"></span></p>`;
  const r = await call("weather");
  if (!r.ok) { out.innerHTML = `<div class="notice warn"><p>${esc(r.message)}</p></div>`; return; }
  out.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Rain</th><th>Snow</th><th>Gusts</th><th>Low</th></tr></thead><tbody>${r.days.map((d) => `<tr><td>${fmtDate(d.date)}</td><td>${d.rainChance}% · ${d.rainIn}"</td><td>${d.snowIn}"</td><td>${d.gustMph} mph</td><td>${Math.round(d.lowF)}°F</td></tr>`).join("")}</tbody></table></div>
  ${r.flagged.length ? `<div class="notice warn" style="margin-top:10px"><p>${r.flagged.map((f) => `${esc(f.date)} · ${esc(f.ref)} · ${esc(f.customer)} — ${esc(f.flag)}`).join("<br>")}</p></div>` : `<p class="fine">No weather problems flagged for scheduled jobs.</p>`}
  ${r.storms.length ? `<div class="notice info" style="margin-top:10px"><p>Snow at or above your trigger forecast: ${r.storms.map((s) => `${esc(s.date)} (${s.snowIn}")`).join(", ")}. Nothing is cancelled automatically.</p></div>` : ""}<p class="fine">Forecast: Open-Meteo, Islip area.</p>`;
}

// ---------------- Bookings
async function Bookings(status = "active", search = "") {
  const d = await call("bookings", { status, search });
  pane().innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"><select id="bf" style="width:auto">${[["active", "Open"], ["all", "All"], ["quote_requested", "Quote requests"], ["pending_review", "Needs review"], ["approved", "Approved (unpaid)"], ["pending_payment", "Awaiting payment"], ["confirmed", "Confirmed"], ["completed", "Completed"], ["cancelled", "Cancelled"], ["expired", "Expired"]].map(([v, l]) => `<option value="${v}" ${v === status ? "selected" : ""}>${l}</option>`).join("")}</select><input id="bs" type="search" placeholder="Search by reference (AS-…)" value="${esc(search)}" style="max-width:260px"></div>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Ref</th><th>Customer</th><th>Service</th><th>Date</th><th>Status</th><th>Total / paid</th></tr></thead><tbody>
  ${d.bookings.map((b) => `<tr class="click" data-bid="${b.id}"><td><b>${esc(b.ref)}</b>${b.needs_review ? ' <span class="pill warn">review</span>' : ""}${b.cancel_requested_at ? ' <span class="pill err">cancel req.</span>' : ""}${b.reschedule_request ? ' <span class="pill info">reschedule</span>' : ""}</td><td>${esc(b.customers?.name)}<br><span class="fine">${esc(b.customers?.phone || "")}</span></td><td>${esc(svcName(b.service))}<br><span class="fine">${esc(b.properties?.address || "")}</span></td><td>${b.service_date ? fmtDate(b.service_date) + " " + winLabel(b.time_window) : "—"}${b.weather_flag ? `<br><span class="pill warn">${esc(b.weather_flag)}</span>` : ""}</td><td>${statusPill(b.status)}</td><td>${money(b.total_cents, true)}<br><span class="fine">${money(b.paid_cents - b.refunded_cents, true)} paid</span></td></tr>`).join("") || `<tr><td colspan="6" class="fine">No bookings.</td></tr>`}</tbody></table></div>`;
  $("#bf").onchange = (e) => Bookings(e.target.value, $("#bs").value);
  $("#bs").onkeydown = (e) => { if (e.key === "Enter") Bookings($("#bf").value, e.target.value); };
  wireBookingLinks();
}

async function openBooking(id) {
  openDrawer(`<p><span class="spinner dark"></span></p>`);
  const d = await call("booking", { id });
  const b = d.booking, c = b.customers, p = b.properties, k = d.costs;
  const net = b.paid_cents - b.refunded_cents;
  const lines = b.quote?.lines || [];
  openDrawer(`<div class="eyebrow">${esc(b.ref)} · ${esc(b.kind)}</div><h2 style="margin-bottom:6px">${esc(svcName(b.service))}</h2>${statusPill(b.status)}
  ${b.review_reasons?.length && b.needs_review ? `<div class="notice warn" style="margin-top:12px"><p>${b.review_reasons.map(esc).join("<br>")}</p></div>` : ""}
  ${b.cancel_requested_at ? `<div class="notice err" style="margin-top:12px"><p><b>Customer asked to cancel</b> (${fmtDate(b.cancel_requested_at)}). Apply your policy: cancel the booking and refund below if due.</p></div>` : ""}
  ${b.reschedule_request ? `<div class="notice info" style="margin-top:12px"><p><b>Reschedule request:</b> ${esc(b.reschedule_request)}</p></div>` : ""}
  <div class="grid g2" style="margin-top:16px">
   <div class="card flat"><h3>Customer</h3><dl class="kv"><dt>Name</dt><dd>${esc(c.name)}</dd><dt>Phone</dt><dd><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></dd><dt>Email</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd><dt>Address</dt><dd>${esc(p?.address || "")}<br><span class="fine">${p?.drive_minutes != null ? `~${Math.round(p.drive_minutes)} min drive (estimated)` : "drive time unknown"}</span></dd><dt>Access</dt><dd>${esc(b.access_notes || "—")}</dd><dt>Customer notes</dt><dd>${esc(b.customer_notes || "—")}</dd></dl>
   <p style="margin-top:10px"><a class="btn ghost sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p?.address || "")}">Open in Maps</a> <button class="btn ghost sm" data-cust="${c.id}">Customer history</button></p></div>
   <div class="card flat"><h3>Price</h3><ul class="sum-lines">${lines.map((l) => `<li><span>${esc(l.label)}</span><span>${money(l.amount)}</span></li>`).join("")}${b.tax_cents ? `<li><span>Sales tax</span><span>${money(b.tax_cents, true)}</span></li>` : ""}</ul>
    <div class="sum-total"><span>Total</span><b>${money(b.total_cents, true)}</b></div><p class="fine">Deposit ${money(b.deposit_cents, true)} · Paid ${money(net, true)} · Owed ${money(Math.max(0, (b.total_cents || 0) - net), true)}</p>
    ${k ? `<details><summary class="fine" style="cursor:pointer">Internal cost &amp; margin (private)</summary><dl class="kv fine" style="margin-top:8px"><dt>Crew hours</dt><dd>${k.crewHours} h × ${k.crewSize} people</dd><dt>Labor</dt><dd>${money(k.labor)}</dd><dt>Fuel/travel</dt><dd>${money(k.fuel)}</dd><dt>Equipment</dt><dd>${money(k.equipment)}</dd><dt>Bags/materials</dt><dd>${money(k.materials)}</dd><dt>Disposal</dt><dd>${money(k.disposal)}</dd><dt>Card fees</dt><dd>${money(k.processing)}</dd><dt>Est. cost</dt><dd><b>${money(k.totalCost)}</b></dd><dt>Est. profit</dt><dd><b>${money(k.profit)}</b> (${k.marginPercent}%)</dd>${k.raisedToFloorBy ? `<dt>Note</dt><dd>Price raised ${money(k.raisedToFloorBy)} to meet your minimum margin</dd>` : ""}${k.ownerApprovedBelowMargin ? `<dt>Note</dt><dd>You approved this below your minimum margin</dd>` : ""}</dl></details>` : ""}
    <details style="margin-top:8px"><summary class="fine" style="cursor:pointer">Adjust price / travel</summary><div class="row2" style="margin-top:8px"><div class="field"><label>Custom price before tax ($)</label><input type="number" id="po" min="0" step="1"></div><div class="field"><label>Travel fee override ($)</label><input type="number" id="to" min="0" step="1"></div></div><button class="btn ghost sm" data-reprice>Update price</button></details></div></div>

  <div class="card flat" style="margin-top:16px"><h3>Schedule &amp; status</h3>
   <div class="row2"><div class="field"><label>Date</label><input type="date" id="sd" value="${b.service_date || ""}"></div><div class="field"><label>Window</label><select id="sw"><option value="">—</option><option value="am" ${b.time_window === "am" ? "selected" : ""}>Morning</option><option value="pm" ${b.time_window === "pm" ? "selected" : ""}>Afternoon</option><option value="storm" ${b.time_window === "storm" ? "selected" : ""}>Storm (no slot)</option></select></div></div>
   <div class="row2"><div class="field"><label>Status</label><select id="st">${["quote_requested", "pending_review", "approved", "confirmed", "in_progress", "completed", "cancelled"].map((s) => `<option value="${s}" ${s === b.status ? "selected" : ""}>${s.replace("_", " ")}</option>`).join("")}</select></div><div class="field"><label>Assigned to</label><input id="as" value="${esc(b.assigned_to || "")}" placeholder="e.g. Crew A"></div></div>
   <div class="field"><label>Message to customer if rescheduling (optional)</label><input id="rr" placeholder="e.g. Rain moved us to Thursday"></div>
   <div class="field"><label>Internal notes (private)</label><textarea id="inote">${esc(b.internal_notes || "")}</textarea></div>
   <label class="check"><input type="checkbox" id="nt" checked><span>Email the customer about changes</span></label>
   <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn" data-save>Save changes</button>
   ${["pending_review", "quote_requested"].includes(b.status) ? `<button class="btn gold" data-approve>Approve &amp; send pay link</button>` : ""}
   ${["approved", "completed", "confirmed"].includes(b.status) ? `<button class="btn ghost" data-paylink>Email pay link</button>` : ""}
   ${b.reschedule_request ? `<button class="btn ghost" data-clear-rs>Clear reschedule request</button>` : ""}
   ${b.status !== "completed" && b.status !== "cancelled" ? `<button class="btn ghost" data-complete>Mark completed</button>` : ""}</div></div>

  <div class="card flat" style="margin-top:16px"><h3>Payments</h3>${d.payments.length ? `<div class="tbl-wrap"><table class="tbl"><tbody>${d.payments.map((p) => `<tr><td>${fmtDate(p.created_at)}</td><td>${esc(p.kind)} · ${esc(p.method)}</td><td>${money(p.amount_cents, true)}${p.fee_cents ? `<br><span class="fine">fee ${money(p.fee_cents, true)}</span>` : ""}${p.refunded_cents ? `<br><span class="fine">refunded ${money(p.refunded_cents, true)}</span>` : ""}</td><td>${p.amount_cents - p.refunded_cents > 0 ? `<button class="btn ghost sm" data-refund="${p.id}" data-max="${(p.amount_cents - p.refunded_cents) / 100}">Refund</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="fine">No payments recorded.</p>`}
   <details style="margin-top:10px"><summary class="fine" style="cursor:pointer">Record a cash / check payment</summary><div class="row2" style="margin-top:8px"><div class="field"><label>Amount ($)</label><input id="ma" type="number" min="0" step="0.01" value="${Math.max(0, ((b.total_cents || 0) - net) / 100).toFixed(2)}"></div><div class="field"><label>Method</label><select id="mm"><option value="cash">Cash</option><option value="check">Check</option><option value="other">Other</option></select></div></div><button class="btn ghost sm" data-manual>Record payment</button></details></div>

  <div class="card flat" style="margin-top:16px"><h3>Photos</h3>${d.photoUrls?.length ? `<div class="photo-thumbs">${d.photoUrls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Customer photo" style="width:110px;height:110px"></a>`).join("")}</div>` : `<p class="fine">No customer photos.</p>`}
   <h4 style="margin-top:12px;font-family:var(--sans);font-size:.9rem">Completed-job photos</h4>${d.afterPhotoUrls?.length ? `<div class="photo-thumbs">${d.afterPhotoUrls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Job photo" style="width:110px;height:110px"></a>`).join("")}</div>` : ""}
   <input type="file" id="ap" accept="image/*" multiple><p class="fine">Add after photos as a record of the finished work.</p></div>

  <div class="card flat" style="margin-top:16px"><h3>Emails sent</h3>${d.notifications.length ? `<ul class="fine" style="padding-left:18px">${d.notifications.map((n) => `<li>${fmtDate(n.created_at)} · ${esc(n.subject)} → ${esc(n.to_email)} · <b>${esc(n.status)}</b>${n.error ? " (" + esc(n.error) + ")" : ""}</li>`).join("")}</ul>` : `<p class="fine">None.</p>`}<p class="fine">"Accepted" means our email provider took the message; it doesn't guarantee it reached the inbox.</p></div>
  <div style="height:40px"></div>`);
  const sh = $("#sheet");
  const save = async (fields, msg = "Saved") => {
    try {
      let r = await call("booking-update", { id, fields });
      if (r.needsConfirm) { if (!confirm(r.message)) return; r = await call("booking-update", { id, fields: { ...fields, confirmBelowMargin: true, forceSlot: true } }); }
      toast(msg); openBooking(id); refreshPane();
    } catch (e) { toast(e.message, 5000); }
  };
  const notify = () => $("#nt", sh).checked;
  $("[data-save]", sh).onclick = () => {
    const f = { internal_notes: $("#inote", sh).value, assigned_to: $("#as", sh).value, notify: notify(), reason: $("#rr", sh).value };
    if ($("#sd", sh).value !== (b.service_date || "") || $("#sw", sh).value !== (b.time_window || "")) { f.service_date = $("#sd", sh).value || null; f.time_window = $("#sw", sh).value || null; }
    if ($("#st", sh).value !== b.status) f.status = $("#st", sh).value;
    save(f);
  };
  $("[data-approve]", sh)?.addEventListener("click", () => {
    if (!b.total_cents) { toast("Set a custom price first (Adjust price)."); return; }
    const f = { status: "approved", notify: notify() };
    if ($("#sd", sh).value && $("#sw", sh).value) { f.service_date = $("#sd", sh).value; f.time_window = $("#sw", sh).value; }
    save(f, "Approved — pay link emailed");
  });
  $("[data-paylink]", sh)?.addEventListener("click", async () => { try { const r = await call("send-pay-link", { id }); prompt("Pay link emailed. You can also text this link:", r.link); } catch (e) { toast(e.message); } });
  $("[data-clear-rs]", sh)?.addEventListener("click", () => save({ reschedule_request: null }));
  $("[data-complete]", sh)?.addEventListener("click", () => { if (confirm("Mark this job completed? The customer gets a thank-you email with any balance and a review link.")) save({ status: "completed", notify: notify() }, "Marked completed"); });
  $("[data-reprice]", sh).onclick = () => {
    const f = {}; const po = $("#po", sh).value, to = $("#to", sh).value;
    if (po !== "") f.priceOverride = Number(po); if (to !== "") f.travelOverride = Number(to);
    if (!Object.keys(f).length) return toast("Enter a price or travel fee.");
    save(f, "Price updated");
  };
  $("[data-manual]", sh).onclick = async () => { try { await call("payment-manual", { booking_id: id, amount: Number($("#ma", sh).value), method: $("#mm", sh).value }); toast("Payment recorded"); openBooking(id); } catch (e) { toast(e.message); } };
  $$("[data-refund]", sh).forEach((btn) => (btn.onclick = async () => {
    const amt = prompt(`Refund how much? (up to $${btn.dataset.max})`, btn.dataset.max);
    if (!amt) return;
    if (!confirm(`Refund $${amt}? This can't be undone.`)) return;
    try { const r = await call("refund", { payment_id: btn.dataset.refund, amount: Number(amt) }); toast(r.message, 5000); openBooking(id); } catch (e) { toast(e.message, 5000); }
  }));
  $("[data-cust]", sh).onclick = () => openCustomer(c.id);
  $("#ap", sh).onchange = async (e) => {
    const files = [...e.target.files].slice(0, 8); if (!files.length) return;
    toast("Uploading…");
    const { uploads } = await call("gallery", { afterUploadUrls: files.length });
    const paths = [];
    for (let i = 0; i < files.length; i++) { const blob = await compressImage(files[i]); paths.push(await uploadSigned("job-photos", uploads[i].path, uploads[i].token, blob)); }
    save({ after_photos: [...(b.after_photos || []), ...paths], notify: false }, "Photos added");
  };
}
function refreshPane() { const t = location.hash.slice(1); if (["Overview", "Bookings", "Schedule"].includes(t)) show(t); }

async function newBooking() {
  openDrawer(`<h2>New phone booking</h2><p class="fine">Creates a booking priced by your engine. You can then set a custom price, date, and approve it.</p>
  <form id="nb"><div class="row2"><div class="field"><label>Name</label><input name="name" required></div><div class="field"><label>Phone</label><input name="phone" required></div></div>
  <div class="field"><label>Email</label><input name="email" type="email" required></div><div class="field"><label>Address</label><input name="address" required></div>
  <div class="row2"><div class="field"><label>Service</label><select name="service"><option value="fall">Fall</option><option value="winter">Winter</option><option value="spring">Spring</option><option value="summer">Summer</option></select></div>
  <div class="field"><label>Size / driveway</label><select name="tier"><option>small</option><option selected>medium</option><option>large</option><option>xl</option></select></div></div>
  <div class="row2"><div class="field"><label>Lawn sq ft (summer)</label><input name="lawnSqft" type="number" value="5000"></div><div class="field"><label>Disposal (fall/spring)</label><select name="disposal"><option value="bag">Bag on site</option><option value="haul">Haul-away</option></select></div></div>
  <div class="field"><label>Notes</label><textarea name="notes"></textarea></div><button class="btn">Create booking</button></form>`);
  $("#nb", $("#sheet")).onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    const inputs = { service: f.service, tier: f.service === "winter" && f.tier === "xl" ? "large" : f.tier, leafVolume: "normal", debris: "normal", disposal: f.disposal, lawnSqft: Number(f.lawnSqft) };
    try { const r = await call("booking-create", { contact: { name: f.name, phone: f.phone, email: f.email }, address: f.address, inputs, notes: f.notes }); toast(`Created ${r.ref}`); openBooking(r.id); }
    catch (err) { toast(err.message, 5000); }
  };
}

// ---------------- Schedule / availability
async function Schedule(from) {
  const d = await call("availability", from ? { from } : {});
  const ov = new Map(d.overrides.map((o) => [`${o.date}:${o.time_window}`, o]));
  const used = new Map(d.usage.map((u) => [`${u.date}:${u.time_window}`, Number(u.used)]));
  const jobs = {};
  d.jobs.forEach((j) => (jobs[`${j.service_date}:${j.time_window}`] ||= []).push(j));
  const start = new Date(d.from + "T12:00:00"); start.setDate(start.getDate() - start.getDay());
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const dt = new Date(start); dt.setDate(start.getDate() + i);
    const iso = dt.toISOString().slice(0, 10);
    const work = d.defaults.workDays.includes(dt.getDay());
    cells += `<div class="d ${work ? "" : "off"}"><b>${dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</b>${["am", "pm"].map((w) => {
      const o = ov.get(`${iso}:${w}`); const cap = o?.capacity_hours ?? (work ? d.defaults.windows[w].capacityHours : 0); const u = used.get(`${iso}:${w}`) || 0;
      const js = jobs[`${iso}:${w}`] || [];
      return `<div class="w ${o?.blocked ? "blocked" : u >= cap && cap > 0 ? "full" : ""}" data-slot="${iso}|${w}" title="${js.map((j) => j.ref + " " + (j.customers?.name || "")).join(", ")}"><span>${w.toUpperCase()}</span><span>${o?.blocked ? "off" : `${u.toFixed(1)}/${cap}h`}</span></div>`;
    }).join("")}</div>`;
  }
  pane().innerHTML = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px"><button class="btn ghost sm" data-prev>← Earlier</button><button class="btn ghost sm" data-next>Later →</button><span class="fine">Each window shows crew-hours booked / available. Tap a window to block it or change its hours.</span></div>
  <div class="cal">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((x) => `<div class="hd fine" style="text-align:center">${x}</div>`).join("")}${cells}</div>
  <div class="card flat" style="margin-top:16px"><h3>Block a range (vacation, equipment down, weather)</h3><div class="row2"><div class="field"><label>From</label><input type="date" id="rf"></div><div class="field"><label>To</label><input type="date" id="rt"></div></div><button class="btn ghost sm" data-block-range>Block these days</button> <button class="btn ghost sm" data-open-range>Re-open these days</button>
  <p class="fine" style="margin-top:8px">Default hours and working days are in Settings. Existing bookings aren't moved when you block days — reschedule them from Bookings.</p></div>`;
  const shift = (n) => { const x = new Date(d.from + "T12:00:00"); x.setDate(x.getDate() + n); Schedule(x.toISOString().slice(0, 10)); };
  $("[data-prev]").onclick = () => shift(-28); $("[data-next]").onclick = () => shift(28);
  $$("[data-slot]").forEach((el) => (el.onclick = async () => {
    const [date, w] = el.dataset.slot.split("|"); const o = ov.get(`${date}:${w}`);
    const v = prompt(`${date} ${w.toUpperCase()}\nEnter crew-hours available (e.g. 4), "off" to block, or "reset" for the default:`, o?.blocked ? "off" : o?.capacity_hours ?? "");
    if (v == null) return;
    const set = v.trim().toLowerCase() === "reset" ? { date, time_window: w, clear: true } : v.trim().toLowerCase() === "off" ? { date, time_window: w, blocked: true } : { date, time_window: w, blocked: false, capacity_hours: Number(v) };
    await call("availability", { set: [set], from: d.from }); Schedule(d.from);
  }));
  const range = async (blocked) => {
    const a = $("#rf").value, b = $("#rt").value; if (!a || !b || b < a) return toast("Pick a valid range");
    const set = []; for (let x = new Date(a + "T12:00:00"); x.toISOString().slice(0, 10) <= b; x.setDate(x.getDate() + 1)) for (const w of ["am", "pm"]) set.push(blocked ? { date: x.toISOString().slice(0, 10), time_window: w, blocked: true } : { date: x.toISOString().slice(0, 10), time_window: w, clear: true });
    await call("availability", { set, from: d.from }); toast("Updated"); Schedule(d.from);
  };
  $("[data-block-range]").onclick = () => range(true); $("[data-open-range]").onclick = () => range(false);
}

// ---------------- Customers
async function Customers(search = "") {
  const d = await call("customers", { search });
  pane().innerHTML = `<input type="search" id="cs" placeholder="Search name, email or phone" value="${esc(search)}" style="max-width:340px;margin-bottom:14px">
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Contact</th><th>Since</th></tr></thead><tbody>${d.customers.map((c) => `<tr class="click" data-cid="${c.id}"><td><b>${esc(c.name)}</b>${c.notes ? `<br><span class="fine">${esc(c.notes.slice(0, 80))}</span>` : ""}</td><td>${esc(c.phone || "")}<br><span class="fine">${esc(c.email)}</span></td><td>${fmtDate(c.created_at, { month: "short", year: "numeric" })}</td></tr>`).join("") || `<tr><td colspan="3" class="fine">No customers yet.</td></tr>`}</tbody></table></div>`;
  $("#cs").onkeydown = (e) => { if (e.key === "Enter") Customers(e.target.value); };
  $$("[data-cid]").forEach((tr) => (tr.onclick = () => openCustomer(tr.dataset.cid)));
}
async function openCustomer(id) {
  const d = await call("customer", { id });
  const c = d.customer;
  const paid = d.payments.reduce((a, p) => a + p.amount_cents - p.refunded_cents, 0);
  openDrawer(`<h2>${esc(c.name)}</h2><dl class="kv"><dt>Phone</dt><dd><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></dd><dt>Email</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd><dt>Lifetime paid</dt><dd>${money(paid, true)}</dd><dt>Addresses</dt><dd>${d.properties.map((p) => esc(p.address)).join("<br>")}</dd></dl>
  <div class="field" style="margin-top:14px"><label>Customer notes (private)</label><textarea id="cn">${esc(c.notes || "")}</textarea></div><button class="btn ghost sm" data-sn>Save notes</button>
  <h3 style="margin-top:20px">Bookings</h3>${list(d.bookings, (b) => `<b>${esc(b.ref)}</b> · ${esc(svcName(b.service))} · ${b.service_date ? fmtDate(b.service_date) : "—"} ${statusPill(b.status)} · ${money(b.total_cents, true)}`, "None")}
  <h3 style="margin-top:20px">Memberships</h3>${list(d.memberships, (m) => `${esc(svcName(m.service))} (${esc(m.tier)}) · ${money(m.monthly_cents, true)}/mo · <b>${esc(m.status)}</b>`, "None")}
  <h3 style="margin-top:20px">Payments</h3>${list(d.payments, (p) => `${fmtDate(p.created_at)} · ${money(p.amount_cents, true)} · ${esc(p.kind)} · ${esc(p.method)}${p.refunded_cents ? " · refunded " + money(p.refunded_cents, true) : ""}`, "None")}`);
  $("[data-sn]", $("#sheet")).onclick = async () => { await call("customer", { id, notes: $("#cn", $("#sheet")).value }); toast("Saved"); };
  $$("[data-bid]", $("#sheet")).forEach((tr) => (tr.onclick = () => openBooking(tr.dataset.bid)));
}

// ---------------- Memberships
async function Memberships() {
  const d = await call("memberships");
  const S = ["spring", "summer", "fall", "winter"];
  pane().innerHTML = `<div class="notice info" style="margin-bottom:16px"><p>Memberships stay <b>off</b> until you check each plan's numbers and switch it on. The margin column uses your cost settings and assumes every included visit is used.</p></div>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Plan</th><th>Small</th><th>Medium</th><th>Large</th><th>Sign-ups</th></tr></thead><tbody>${S.map((s) => `<tr><td><b>${esc(svcName(s))}</b><br><span class="fine">${esc(d.status[s].reason || "Open")}</span></td>${["small", "medium", "large"].map((t) => { const q = d.quotes[`${s}:${t}`]; const m = q?.internal?.marginPercent; return `<td>${money(q?.monthly)}/mo<br><span class="pill ${m >= 25 ? "ok" : m >= 15 ? "warn" : "err"}">${m}% margin</span></td>`; }).join("")}<td><label class="check"><input type="checkbox" data-act="${s}" ${d.active[s] ? "checked" : ""}><span>Accept sign-ups</span></label></td></tr>`).join("")}</tbody></table></div>
  <p class="fine">Change membership prices on the Pricing tab. Price changes apply to new members; existing members keep the price they agreed to.</p>
  <h3 style="margin-top:24px">Members</h3>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Customer</th><th>Plan</th><th>Status</th><th>Renews / ends</th><th>Snow visits</th></tr></thead><tbody>${d.memberships.map((m) => `<tr><td><b>${esc(m.customers?.name)}</b><br><span class="fine">${esc(m.customers?.phone || "")} · ${esc(m.properties?.address || "")}</span></td><td>${esc(svcName(m.service))} · ${esc(m.tier)}<br><span class="fine">${money(m.monthly_cents, true)}/mo</span></td><td>${esc(m.status)}${m.cancel_at_period_end ? " · cancelling" : ""}</td><td>${m.current_period_end ? fmtDate(m.current_period_end) : "—"}<br><span class="fine">ends ${m.cancel_at ? fmtDate(m.cancel_at) : "—"}</span></td><td>${m.service === "winter" && ["active", "past_due"].includes(m.status) ? `${Object.entries(m.storm_visits_used || {}).map(([k, v]) => `${k}: ${v}`).join(", ") || "none"}<br><button class="btn ghost sm" data-storm="${m.id}">Log snow visit</button>` : "—"}</td></tr>`).join("") || `<tr><td colspan="5" class="fine">No members yet.</td></tr>`}</tbody></table></div>`;
  $$("[data-act]").forEach((cb) => (cb.onchange = async () => {
    const st = await call("settings"); const ma = { ...st.business.membershipsActive, [cb.dataset.act]: cb.checked };
    await call("settings", { save: { business: { ...st.business, membershipsActive: ma } } }); toast(cb.checked ? "Sign-ups on" : "Sign-ups off"); Memberships();
  }));
  $$("[data-storm]").forEach((b) => (b.onclick = async () => {
    const date = prompt("Date of the snow visit (YYYY-MM-DD):", new Date().toISOString().slice(0, 10)); if (!date) return;
    const salting = confirm("Did you salt? OK = yes, Cancel = no");
    try { const r = await call("storm-visit", { id: b.dataset.storm, date, salting }); toast(`Logged. Visit ${r.visitsThisMonth} of ${r.included} included this month${r.chargedCents ? ` · charged ${money(r.chargedCents, true)}` : ""}`, 5000); Memberships(); }
    catch (e) { toast(e.message, 5000); }
  }));
}

// ---------------- Pricing editor (form generated from your current settings)
const LABELS = { base: "Base price by size ($)", haulAway: "Haul-away fee by size ($)", leafVolume: "Leaf volume multiplier", debris: "Debris multiplier", trees: "Trees add-on ($)", areas: "Area multiplier", access: "Access multiplier", extras: "Add-ons ($)", crewHours: "Crew hours by size (wall-clock)", bagsPerHour: "Bags used per crew-hour", areaBands: "Lawn bands [max sq ft, price $]", reviewOverSqft: "Custom quote above (sq ft)", condition: "Grass condition multiplier", obstacles: "Obstacle multiplier", trimming: "Trimming add-on ($)", crewHoursPerBand: "Crew hours per lawn band", driveway: "Price per visit by driveway ($)", walkway: "Walkway add-on ($)", depth: "Snow depth multiplier", ice: "Ice add-on ($)", salting: "Salting by driveway ($)", saltBagsPerVisit: "Salt bags per visit", minimumCharge: "Minimum charge per visit ($)", freeMinutes: "Free travel up to (minutes)", bands: "Travel fee bands [up to minutes, fee $]", reviewOverMinutes: "Manual review beyond (minutes)", percent: "Percent", minimum: "Minimum deposit ($)", fullPrepayUnder: "Full prepay if total under ($)", visitsPerMonth: "Visits per month (spring/summer/fall)", triggerInches: "Snowfall trigger (inches)", includedVisitsPerMonth: "Included snow visits per month", maxDepthPerVisitInches: "Max depth per visit (inches)", extraVisitDiscountPercent: "Member discount on extra visits (%)", saltingIncluded: "Salting included in membership", maxMembers: "Maximum winter members", enrollmentCutoff: "Winter enrollment cutoff (MM-DD)", laborPerWorkerHour: "Labor cost per worker per hour ($)", crewSize: "Crew size by service", fuelPerJob: "Fuel per job ($)", fuelPerDriveMinute: "Fuel per drive-minute ($)", paidTravelMinutesPerJob: "Paid travel minutes per job", equipmentPerCrewHour: "Equipment cost per crew-hour ($)", bagCost: "Cost per leaf bag ($)", saltBagCost: "Cost per salt bag ($)", disposalPerHaul: "Disposal cost per haul ($)", processingPercent: "Card fee (%)", processingFixed: "Card fee fixed ($)", minMarginPercent: "Minimum profit margin (%)", autoRaiseToMarginFloor: "Auto-raise quotes that fall below the minimum margin", enabled: "Charge sales tax", label: "Label" };
const SKIP = new Set(["currency", "tiers", "tierLabels", "drivewayLabels", "measurement"]);
function fields(obj, path = []) {
  return Object.entries(obj).filter(([k]) => !SKIP.has(k)).map(([k, v]) => {
    const p = [...path, k].join(".");
    const label = LABELS[k] || k;
    if (Array.isArray(v)) return `<div class="field"><label>${esc(label)}</label><input data-path="${p}" data-type="json" value='${esc(JSON.stringify(v))}'></div>`;
    if (v && typeof v === "object") return `<fieldset style="border:1px solid var(--line);border-radius:10px;padding:10px 12px 2px;margin:0 0 12px;grid-column:1/-1"><legend class="lg" style="padding:0 6px">${esc(label)}</legend><div class="settings-grid">${fields(v, [...path, k])}</div></fieldset>`;
    if (typeof v === "boolean") return `<label class="check"><input type="checkbox" data-path="${p}" data-type="bool" ${v ? "checked" : ""}><span>${esc(label)}</span></label>`;
    return `<div class="field"><label>${esc(label)}</label><input data-path="${p}" data-type="${typeof v === "number" ? "num" : "str"}" value="${esc(v)}" ${typeof v === "number" ? 'type="number" step="any"' : ""}></div>`;
  }).join("");
}
function collect(el, base) {
  const out = structuredClone(base);
  $$("[data-path]", el).forEach((i) => {
    const keys = i.dataset.path.split("."); let o = out;
    keys.slice(0, -1).forEach((k) => (o = o[k]));
    const k = keys.at(-1);
    o[k] = i.dataset.type === "num" ? Number(i.value) : i.dataset.type === "bool" ? i.checked : i.dataset.type === "json" ? JSON.parse(i.value) : i.value;
  });
  return out;
}
async function Pricing() {
  const st = await call("settings");
  const sections = [["Fall cleanup", "fall"], ["Spring renewal", "spring"], ["Summer mowing", "summer"], ["Winter snow", "winter"], ["Memberships (monthly $)", "memberships"], ["Winter membership terms", "winterTerms"], ["Seasons (MM-DD)", "seasons"], ["Travel", "travel"], ["Deposits", "deposit"], ["Sales tax", "salesTax"]];
  pane().innerHTML = `<div class="notice warn" style="margin-bottom:16px"><p>These are the <b>draft starting prices</b>. Check them against your real costs (Costs section below) before switching on live payments. Changes apply to new estimates immediately; existing bookings keep their price.</p></div>
  <div class="grid g2" style="align-items:start"><form id="pf"><div class="card flat" id="pp"><h3>Customer prices</h3><div class="field"><label>Minimum charge per visit ($)</label><input data-path="minimumCharge" data-type="num" type="number" value="${st.pricing.minimumCharge}"></div>
  <label class="check" style="margin-bottom:12px"><input type="checkbox" data-path="autoRaiseToMarginFloor" data-type="bool" ${st.pricing.autoRaiseToMarginFloor ? "checked" : ""}><span>${LABELS.autoRaiseToMarginFloor} (otherwise they go to you for approval)</span></label>
  <h4 style="font-family:var(--sans);font-size:.9rem">Services offered online</h4>${["spring", "summer", "fall", "winter"].map((s) => `<label class="check"><input type="checkbox" data-path="serviceEnabled.${s}" data-type="bool" ${st.pricing.serviceEnabled[s] ? "checked" : ""}><span>${esc(svcName(s))}</span></label>`).join("")}
  ${sections.map(([t, k]) => `<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:600">${t}</summary><div class="settings-grid" style="margin-top:10px">${fields(st.pricing[k], [k])}</div></details>`).join("")}</div>
  <div class="card flat" style="margin-top:16px"><h3>Costs (private — used for profit checks)</h3><div class="settings-grid" id="cf">${fields(st.costs)}</div></div>
  <div style="display:flex;gap:8px;margin-top:14px;position:sticky;bottom:10px"><button class="btn gold" type="submit">Save pricing</button><button class="btn ghost" type="button" data-reset>Reset to defaults</button></div></form>
  <div class="card" style="position:sticky;top:90px"><h3>Test a quote</h3><p class="fine">Try a job with the numbers on the left (save first) and see price, cost and margin.</p>
   <div class="row2"><div class="field"><label>Service</label><select id="ts"><option>fall</option><option>spring</option><option>summer</option><option>winter</option></select></div><div class="field"><label>Size / driveway</label><select id="tt"><option>small</option><option selected>medium</option><option>large</option></select></div></div>
   <div class="row2"><div class="field"><label>Drive minutes</label><input id="td" type="number" value="20"></div><div class="field"><label>Lawn sq ft</label><input id="tl" type="number" value="6000"></div></div>
   <div class="row2"><div class="field"><label>Volume / debris / depth</label><select id="tv"><option value="normal">normal</option><option value="light">light</option><option value="heavy">heavy</option></select></div><div class="field"><label>Disposal</label><select id="tp"><option value="bag">bag</option><option value="haul">haul</option></select></div></div>
   <button class="btn ghost sm" data-test>Calculate</button><div id="tout" style="margin-top:12px"></div></div></div>`;
  $("#pf").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const pricing = collect($("#pp"), st.pricing);
      const costs = collect($("#cf"), st.costs);
      await call("settings", { save: { pricing, costs } }); toast("Pricing saved");
    } catch (err) { toast("Couldn't save: " + err.message, 5000); }
  };
  $("[data-reset]").onclick = async () => { if (confirm("Reset all prices and costs to the original draft defaults?")) { await call("settings", { save: { pricing: st.defaults.pricing, costs: st.defaults.costs } }); toast("Reset"); Pricing(); } };
  $("[data-test]").onclick = async () => {
    const s = $("#ts").value, v = $("#tv").value;
    const inputs = { service: s, tier: $("#tt").value, leafVolume: v, debris: v, disposal: $("#tp").value, lawnSqft: Number($("#tl").value), depth: v === "heavy" ? "6-12" : "2-6", areas: "both" };
    try {
      const { estimate: e } = await call("preview-estimate", { inputs, driveMinutes: Number($("#td").value) });
      const k = e.internal;
      $("#tout").innerHTML = e.total == null ? `<p class="fine">${esc(e.reasons.join(" "))}</p>` : `<ul class="sum-lines">${e.lines.map((l) => `<li><span>${esc(l.label)}</span><span>${money(l.amount)}</span></li>`).join("")}<li><span>Tax</span><span>${money(e.tax)}</span></li></ul><div class="sum-total"><span>Customer pays</span><b>${money(e.total)}</b></div>
      <dl class="kv fine"><dt>Crew time</dt><dd>${k.crewHours} h × ${k.crewSize}</dd><dt>Est. cost</dt><dd>${money(k.totalCost)}</dd><dt>Est. profit</dt><dd><b>${money(k.profit)}</b> (${k.marginPercent}%)</dd>${k.raisedToFloorBy ? `<dt>Raised</dt><dd>+${money(k.raisedToFloorBy)} to meet minimum margin</dd>` : ""}</dl>`;
    } catch (err) { $("#tout").innerHTML = `<p class="fine">${esc(err.message)}</p>`; }
  };
}

// ---------------- Finances
async function Finances(from) {
  const d = await call("finance", from ? { from } : {});
  pane().innerHTML = `<div style="display:flex;gap:8px;align-items:end;margin-bottom:14px"><div class="field" style="margin:0"><label>From</label><input type="date" id="ff" value="${d.from}"></div><button class="btn ghost sm" data-go>Update</button></div>
  <div class="kpis"><div class="kpi"><span>Gross collected</span><b>${money(d.grossCents, true)}</b></div><div class="kpi"><span>Refunds</span><b>${money(d.refundsCents, true)}</b></div><div class="kpi"><span>Card fees</span><b>${money(d.feesCents, true)}</b></div><div class="kpi"><span>Net collected</span><b>${money(d.netCollectedCents, true)}</b></div><div class="kpi"><span>From memberships</span><b>${money(d.subscriptionCents, true)}</b></div></div>
  <div class="grid g2"><div class="card flat"><h3>Revenue by season (net of refunds)</h3><table class="price-table"><tbody>${Object.entries(d.bySeason).map(([s, v]) => `<tr><td>${esc(svcName(s))}</td><td class="num">${money(v, true)}</td></tr>`).join("")}</tbody></table></div>
  <div class="card flat"><h3>Completed jobs (estimated)</h3><dl class="kv"><dt>Jobs completed</dt><dd>${d.completedJobs}</dd><dt>Revenue before tax</dt><dd>${money(d.completedRevenuePreTaxCents, true)}</dd><dt>Sales tax on those jobs</dt><dd>${money(d.salesTaxOnCompletedCents, true)} <span class="fine">(owed to NY State)</span></dd><dt>Estimated job costs</dt><dd>${money(d.estimatedJobCostsCents, true)}</dd><dt>Estimated job profit</dt><dd><b>${money(d.estimatedJobProfitCents, true)}</b></dd></dl></div></div>
  <p class="fine" style="margin-top:14px">${esc(d.note)}</p>`;
  $("[data-go]").onclick = () => Finances($("#ff").value);
}

// ---------------- Gallery
async function Gallery() {
  const d = await call("gallery");
  pane().innerHTML = `<div class="card flat" style="margin-bottom:18px"><h3>Add a before &amp; after</h3><p class="fine">Only post photos of your own jobs. Avoid house numbers, faces and license plates.</p>
  <div class="row2"><div class="field"><label>Before photo</label><input type="file" id="gb" accept="image/*"></div><div class="field"><label>After photo</label><input type="file" id="ga" accept="image/*"></div></div>
  <div class="row2"><div class="field"><label>Service</label><select id="gs"><option value="fall">Fall</option><option value="winter">Winter</option><option value="spring">Spring</option><option value="summer">Summer</option></select></div><div class="field"><label>General location</label><input id="gl" placeholder="e.g. East Islip"></div></div>
  <div class="row2"><div class="field"><label>Completed on</label><input type="date" id="gd"></div><div class="field"><label>Caption (optional)</label><input id="gc"></div></div><button class="btn" data-add>Publish</button></div>
  <div class="grid g3">${d.items.map((g) => `<div class="card flat" style="padding:10px"><div class="grid g2" style="gap:6px"><img src="${esc(g.before)}" alt="" style="aspect-ratio:1;object-fit:cover;border-radius:8px"><img src="${esc(g.after)}" alt="" style="aspect-ratio:1;object-fit:cover;border-radius:8px"></div><p class="fine" style="margin:8px 0">${esc(svcName(g.service))} · ${esc(g.location || "")}</p><button class="btn ghost sm" data-del="${g.id}">Remove</button></div>`).join("") || `<p class="fine">No photos yet.</p>`}</div>`;
  $("[data-add]").onclick = async () => {
    const b = $("#gb").files[0], a = $("#ga").files[0]; if (!b || !a) return toast("Choose both photos");
    try {
      toast("Uploading…");
      const { uploads } = await call("gallery", { uploadUrls: true });
      await uploadSigned("gallery", uploads[0].path, uploads[0].token, await compressImage(b));
      await uploadSigned("gallery", uploads[1].path, uploads[1].token, await compressImage(a));
      await call("gallery", { add: { before_path: uploads[0].path, after_path: uploads[1].path, service: $("#gs").value, location: $("#gl").value, completed_on: $("#gd").value, caption: $("#gc").value } });
      toast("Published"); Gallery();
    } catch (e) { toast(e.message, 5000); }
  };
  $$("[data-del]").forEach((b) => (b.onclick = async () => { if (confirm("Remove from gallery?")) { await call("gallery", { remove: b.dataset.del }); Gallery(); } }));
}

// ---------------- Reviews
async function Reviews() {
  const d = await call("reviews");
  pane().innerHTML = `<p class="fine">Reviews come only from customers with a completed job (via their private booking link). Approve to publish. Don't edit or invent reviews.</p>
  ${list(d.reviews, (r) => `<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><span class="stars">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</span> <b>${esc(r.name)}</b>${r.town ? ", " + esc(r.town) : ""} · <span class="pill ${r.status === "approved" ? "ok" : r.status === "hidden" ? "" : "warn"}">${esc(r.status)}</span><p style="margin:6px 0 0">${esc(r.body)}</p></div><div style="display:flex;gap:6px">${r.status !== "approved" ? `<button class="btn sm" data-rv="${r.id}" data-s="approved">Approve</button>` : ""}${r.status !== "hidden" ? `<button class="btn ghost sm" data-rv="${r.id}" data-s="hidden">Hide</button>` : ""}</div></div>`, "No reviews yet.")}`;
  $$("[data-rv]").forEach((b) => (b.onclick = async () => { await call("reviews", { id: b.dataset.rv, status: b.dataset.s }); Reviews(); }));
}

// ---------------- Emails
async function Emails() {
  const d = await call("notifications");
  pane().innerHTML = `${d.provider ? "" : `<div class="notice warn" style="margin-bottom:14px"><p>Email sending isn't set up yet, so messages are saved here as "skipped" and not sent.</p></div>`}
  <p class="fine">"Accepted" = our email provider took the message for delivery. We can't confirm it reached the inbox.</p>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th><th></th></tr></thead><tbody>${d.notifications.map((n) => `<tr><td>${fmtDate(n.created_at)}</td><td>${esc(n.to_email)}</td><td>${esc(n.subject)}</td><td>${esc(n.status)}${n.error ? `<br><span class="fine">${esc(n.error)}</span>` : ""}</td><td>${n.status !== "accepted" && d.provider ? `<button class="btn ghost sm" data-retry="${n.id}">Retry</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="fine">No emails yet.</td></tr>`}</tbody></table></div>`;
  $$("[data-retry]").forEach((b) => (b.onclick = async () => { await call("notifications", { retry: b.dataset.retry }); Emails(); }));
}

// ---------------- Settings
async function Settings() {
  const st = await call("settings");
  const B = st.business;
  pane().innerHTML = `<form id="sf"><div class="grid g2" style="align-items:start">
  <div class="card flat"><h3>Business</h3>
   <div class="field"><label>Google review link (from your Google Business Profile)</label><input id="gr" value="${esc(B.googleReviewUrl || "")}" placeholder="https://g.page/r/..."></div>
   <div class="field"><label>Where should owner alerts go?</label><input id="oe" type="email" value="${esc(B.ownerNotifyEmail)}"></div>
   <div class="field"><label>Service area text</label><input id="sa" value="${esc(B.serviceArea)}"></div>
   <label class="check"><input type="checkbox" id="n1" ${B.notifications.ownerNewBooking ? "checked" : ""}><span>Email me about every new booking</span></label>
   <label class="check"><input type="checkbox" id="n2" ${B.notifications.customerReminders ? "checked" : ""}><span>Send customers a reminder the day before</span></label>
   <label class="check"><input type="checkbox" id="n3" ${B.notifications.weatherAlerts ? "checked" : ""}><span>Daily weather alerts for scheduled jobs</span></label></div>
  <div class="card flat"><h3>Booking availability</h3>
   <div class="field"><label>Working days</label><div class="choice-grid" style="grid-template-columns:repeat(7,1fr)">${["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d, i) => `<label class="choice"><input type="checkbox" data-wd="${i}" ${B.workDays.includes(i) ? "checked" : ""}><span style="text-align:center;padding:8px 2px">${d}</span></label>`).join("")}</div></div>
   <div class="row2"><div class="field"><label>Morning crew-hours</label><input id="amh" type="number" step="0.5" value="${B.windows.am.capacityHours}"></div><div class="field"><label>Afternoon crew-hours</label><input id="pmh" type="number" step="0.5" value="${B.windows.pm.capacityHours}"></div></div>
   <div class="row2"><div class="field"><label>Morning label</label><input id="aml" value="${esc(B.windows.am.label)}"></div><div class="field"><label>Afternoon label</label><input id="pml" value="${esc(B.windows.pm.label)}"></div></div>
   <div class="row2"><div class="field"><label>Earliest booking (days ahead)</label><input id="ml" type="number" value="${B.minLeadDays}"></div><div class="field"><label>Book up to (days ahead)</label><input id="ba" type="number" value="${B.bookAheadDays}"></div></div>
   <div class="row2"><div class="field"><label>Travel buffer per job (hours)</label><input id="tb" type="number" step="0.05" value="${B.travelBufferHours}"></div><div class="field"><label>Free cancellation (hours before)</label><input id="fc" type="number" value="${B.cancellation.freeCancelHours}"></div></div></div></div>
  <button class="btn gold" style="margin-top:14px">Save settings</button></form>
  <div class="grid g2" style="margin-top:20px;align-items:start">
   <div class="card flat"><h3>Owner password (optional)</h3><p class="fine">Lets you sign in with a password instead of an email link.</p><div class="field"><label>New password</label><input type="password" id="np" autocomplete="new-password" minlength="10"></div><button class="btn ghost sm" data-pw>Set password</button></div>
   <div class="card flat"><h3>Stripe</h3><p class="fine">Mode: <b>${esc(st.stripe.mode)}</b>${st.stripe.setupAt ? ` · products set up ${fmtDate(st.stripe.setupAt)}` : ""}</p><button class="btn ghost sm" data-stripe-setup ${st.stripe.mode === "off" ? "disabled" : ""}>Set up / check Stripe products</button><p class="fine" style="margin-top:8px">Safe to run again — it reuses existing products instead of making duplicates.</p></div></div>`;
  $("#sf").onsubmit = async (e) => {
    e.preventDefault();
    const nb = structuredClone(B);
    nb.googleReviewUrl = $("#gr").value.trim() || null; nb.ownerNotifyEmail = $("#oe").value.trim(); nb.serviceArea = $("#sa").value;
    nb.notifications = { ownerNewBooking: $("#n1").checked, customerReminders: $("#n2").checked, weatherAlerts: $("#n3").checked };
    nb.workDays = $$("[data-wd]").filter((c) => c.checked).map((c) => Number(c.dataset.wd));
    nb.windows.am.capacityHours = Number($("#amh").value); nb.windows.pm.capacityHours = Number($("#pmh").value);
    nb.windows.am.label = $("#aml").value; nb.windows.pm.label = $("#pml").value;
    nb.minLeadDays = Number($("#ml").value); nb.bookAheadDays = Number($("#ba").value); nb.travelBufferHours = Number($("#tb").value); nb.cancellation.freeCancelHours = Number($("#fc").value);
    try { await call("settings", { save: { business: nb } }); toast("Settings saved"); } catch (err) { toast(err.message); }
  };
  $("[data-pw]").onclick = async () => { const pw = $("#np").value; if (pw.length < 10) return toast("Use at least 10 characters"); const { error } = await supabase.auth.updateUser({ password: pw }); toast(error ? error.message : "Password set"); };
  $("[data-stripe-setup]").onclick = stripeSetup;
}
async function stripeSetup() {
  try { const r = await call("stripe-setup"); toast(`Stripe ready. Created: ${r.created.join(", ") || "nothing new"}. Reused: ${r.reused.join(", ") || "none"}.`, 7000); }
  catch (e) { toast(e.message, 6000); }
}

main();
