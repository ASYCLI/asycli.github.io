import { api, money, esc, fmtDate, statusPill } from "./api.js";

const el = document.getElementById("booking-app");
const qs = new URLSearchParams(location.search);
const token = qs.get("t");

async function load(poll = 0) {
  if (!token) { el.innerHTML = `<div class="notice err"><p>This link is missing its booking code. Open the link from your email, or <a href="/account/">sign in</a>.</p></div>`; return; }
  let d;
  try { d = await api("booking", { token }); } catch (e) { el.innerHTML = `<div class="notice err"><p>${esc(e.message)}</p></div>`; return; }
  const b = d.booking;
  // after Stripe redirects back, the webhook may take a few seconds
  if (qs.get("paid") && poll < 6 && ["pending_payment", "approved"].includes(b.status)) {
    el.innerHTML = `<div class="card" style="text-align:center"><p><span class="spinner dark"></span></p><p>Confirming your payment with Stripe…</p></div>`;
    return setTimeout(() => load(poll + 1), 2000);
  }
  const q = b.quote || {};
  const net = b.paid_cents - b.refunded_cents;
  el.innerHTML = `
  ${qs.get("paid") ? (b.status === "confirmed" || net > 0 ? `<div class="notice ok" style="margin-bottom:16px"><p><b>Payment received — thank you!</b> A receipt is on its way from Stripe.</p></div>` : `<div class="notice warn" style="margin-bottom:16px"><p>We haven't received confirmation from Stripe yet. If you completed checkout, refresh in a minute — you won't be charged twice.</p></div>`) : ""}
  ${qs.get("cancelled") ? `<div class="notice warn" style="margin-bottom:16px"><p>Checkout was cancelled — nothing was charged. Your time slot is held for a short while if you'd like to try again.</p></div>` : ""}
  <div class="card">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start"><div><div class="eyebrow">Booking ${esc(b.ref)}</div><h1 style="font-size:1.8rem">${esc(b.serviceName)}</h1></div>${statusPill(b.status)}</div>
    <dl class="kv" style="margin:12px 0 18px"><dt>Date</dt><dd>${b.date ? fmtDate(b.date, { weekday: "long", month: "long", day: "numeric" }) : "To be scheduled"}${b.windowLabel ? " · " + esc(b.windowLabel) : ""}</dd>
    <dt>Address</dt><dd>${esc(b.address || "")}</dd>${b.access_notes ? `<dt>Access notes</dt><dd>${esc(b.access_notes)}</dd>` : ""}</dl>
    ${q.lines?.length ? `<ul class="sum-lines">${q.lines.map((l) => `<li><span>${esc(l.label)}</span><span>${l.amount ? money(l.amount) : "Included"}</span></li>`).join("")}${q.tax ? `<li><span>${esc(q.taxLabel || "Sales tax")}</span><span>${money(q.tax)}</span></li>` : ""}</ul>
    <div class="sum-total"><span>Total</span><b>${money(b.total_cents, true)}</b></div>
    <div class="sum-meta"><span>Paid: <b>${money(net, true)}</b>${b.refunded_cents ? ` (after ${money(b.refunded_cents, true)} refunded)` : ""}</span><span>Remaining: <b>${money(Math.max(0, (b.total_cents || 0) - net), true)}</b></span></div>` : `<div class="notice info"><p>${esc((q.reasons || []).join(" ") || "We're preparing your quote.")}</p></div>`}
    ${b.needs_review && !["completed", "cancelled"].includes(b.status) ? `<div class="notice info" style="margin-top:14px"><p>We're reviewing this booking and will contact you shortly.</p></div>` : ""}
    ${b.canPay && b.due_now_cents > 0 ? `<button class="btn gold block" style="margin-top:18px" data-pay>Pay ${money(b.due_now_cents, true)} securely</button>` : ""}
    <p class="fine" style="margin-top:14px">This is an estimate based on the details provided. Unusual conditions, inaccessible areas, inaccurate measurements or exceptional accumulation may require a revised quote — we'll always confirm before doing extra work.</p>
  </div>
  ${!["completed", "cancelled", "expired"].includes(b.status) ? `<div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>Need a different time?</h3>${b.reschedule_request ? `<p class="fine">Request sent: “${esc(b.reschedule_request)}” — we'll be in touch.</p>` : `<form data-resched><div class="field"><label for="rs">Which days/times work for you?</label><textarea id="rs" required maxlength="1000"></textarea></div><button class="btn ghost sm" type="submit">Request reschedule</button></form>`}</div>
    <div class="card"><h3>Cancel</h3>${b.cancel_requested ? `<p class="fine">Cancellation requested — we'll confirm shortly.</p>` : `<p class="fine">See our <a href="/cancellation-refund-policy/">cancellation &amp; refund policy</a>.</p><form data-cancel><div class="field"><label for="cr">Reason (optional)</label><input id="cr" maxlength="300"></div><button class="btn ghost sm" type="submit">${b.paid_cents > 0 ? "Request cancellation" : "Cancel request"}</button></form>`}</div></div>` : ""}
  ${b.status === "completed" ? `<div class="card" id="review" style="margin-top:16px"><h3>How did we do?</h3><form data-review>
    <div class="field"><label>Rating</label><div class="choice-grid" style="grid-template-columns:repeat(5,1fr)">${[5, 4, 3, 2, 1].map((n) => `<label class="choice"><input type="radio" name="rating" value="${n}" ${n === 5 ? "checked" : ""}><span style="text-align:center">${n}★</span></label>`).join("")}</div></div>
    <div class="row2"><div class="field"><label for="rv-n">Name to show</label><input id="rv-n" maxlength="60" placeholder="First name"></div><div class="field"><label for="rv-t">Town (optional)</label><input id="rv-t" maxlength="60"></div></div>
    <div class="field"><label for="rv-b">Your review</label><textarea id="rv-b" required maxlength="1500"></textarea></div><button class="btn" type="submit">Submit review</button></form>
    ${d.business.googleReviewUrl ? `<p class="fine" style="margin-top:12px">Or <a href="${esc(d.business.googleReviewUrl)}" target="_blank" rel="noopener">review us on Google</a> — it really helps.</p>` : ""}</div>` : ""}
  <div data-msg aria-live="polite" style="margin-top:14px"></div>
  <p class="fine" style="margin-top:18px">Questions? Call or text <a href="tel:${esc(d.business.phoneHref)}">${esc(d.business.phone)}</a>. <a href="/account/">Go to my account</a></p>`;

  const msg = el.querySelector("[data-msg]");
  const act = async (body, btn) => {
    btn.disabled = true;
    try { const r = await api("booking-action", { token, ...body }); if (r.checkoutUrl) { location.href = r.checkoutUrl; return; } msg.innerHTML = `<div class="notice ok"><p>${esc(r.message)}</p></div>`; setTimeout(() => load(), 1500); }
    catch (e) { msg.innerHTML = `<div class="notice err"><p>${esc(e.message)}</p></div>`; btn.disabled = false; }
  };
  el.querySelector("[data-pay]")?.addEventListener("click", (e) => act({ action: "pay" }, e.currentTarget));
  el.querySelector("[data-resched]")?.addEventListener("submit", (e) => { e.preventDefault(); act({ action: "reschedule_request", message: el.querySelector("#rs").value }, e.target.querySelector("button")); });
  el.querySelector("[data-cancel]")?.addEventListener("submit", (e) => { e.preventDefault(); if (confirm("Send a cancellation request for this booking?")) act({ action: "cancel_request", message: el.querySelector("#cr").value }, e.target.querySelector("button")); });
  el.querySelector("[data-review]")?.addEventListener("submit", async (e) => {
    e.preventDefault(); const btn = e.target.querySelector("button"); btn.disabled = true;
    try { await api("review", { token, rating: Number(new FormData(e.target).get("rating")), name: el.querySelector("#rv-n").value, town: el.querySelector("#rv-t").value, body: el.querySelector("#rv-b").value }); e.target.outerHTML = `<div class="notice ok"><p>Thank you! Your review will appear once it's approved.</p></div>`; }
    catch (err) { msg.innerHTML = `<div class="notice err"><p>${esc(err.message)}</p></div>`; btn.disabled = false; }
  });
  if (location.hash === "#review") el.querySelector("#review")?.scrollIntoView();
}
load();
