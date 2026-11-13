import { api, money, esc, fmtDate, statusPill, SERVICE_NAMES, toast } from "./api.js";
import { session, signOut, loginForm } from "./auth.js";

const el = document.getElementById("account-app");

async function main() {
  const s = await session();
  if (!s.session) {
    loginForm(el, { title: "Sign in to your account", sub: "Enter the email you used when booking. We'll send you a secure one-time sign-in link — no password needed.", target: "account" });
    if (s.error) el.insertAdjacentHTML("afterbegin", `<div class="notice err" style="max-width:480px;margin:0 auto 14px"><p>${esc(s.error)}</p></div>`);
    return;
  }
  const token = s.session.access_token;
  let d;
  try { d = await api("me", undefined, { token }); }
  catch (e) { el.innerHTML = `<div class="notice err"><p>${esc(e.message)}</p></div>`; return; }
  const qs = new URLSearchParams(location.search);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = d.bookings.filter((b) => !["completed", "cancelled", "expired"].includes(b.status));
  const past = d.bookings.filter((b) => ["completed", "cancelled", "expired"].includes(b.status));
  const row = (b) => `<tr class="click" data-t="${esc(b.token)}"><td><b>${esc(b.ref)}</b><br><span class="fine">${esc(b.serviceName)}</span></td><td>${b.date ? fmtDate(b.date) : "—"}<br><span class="fine">${esc(b.windowLabel || "")}</span></td><td>${statusPill(b.status)}</td><td>${money(b.total_cents, true)}<br><span class="fine">paid ${money(b.paid_cents - b.refunded_cents, true)}</span></td></tr>`;
  el.innerHTML = `${qs.get("joined") ? `<div class="notice ok" style="margin-bottom:18px"><p><b>Welcome!</b> Your membership is being activated — it can take a minute to appear below. A confirmation email with your terms is on its way.</p></div>` : ""}
  <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:18px">
    <div><h2 style="margin:0">Hi${d.customer.name ? ", " + esc(d.customer.name.split(" ")[0]) : ""}</h2><p class="fine" style="margin:0">${esc(d.customer.email)}${d.customer.phone ? " · " + esc(d.customer.phone) : ""}</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${d.customer.hasBilling ? `<button class="btn ghost sm" data-portal>Billing &amp; cards</button>` : ""}<a class="btn sm" href="/book/">Book a service</a><button class="btn ghost sm" data-out>Sign out</button></div></div>
  <div class="tabs" role="tablist">${["Appointments", "Memberships", "Payments", "Properties"].map((t, i) => `<button role="tab" aria-selected="${i === 0}" data-tab="${i}">${t}</button>`).join("")}</div>
  <div data-pane="0"><h3>Upcoming &amp; open</h3>${upcoming.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Booking</th><th>Date</th><th>Status</th><th>Amount</th></tr></thead><tbody>${upcoming.map(row).join("")}</tbody></table></div>` : `<div class="empty">No upcoming appointments. <a href="/book/">Book a service</a></div>`}
    <h3 style="margin-top:28px">Past</h3>${past.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Booking</th><th>Date</th><th>Status</th><th>Amount</th></tr></thead><tbody>${past.map(row).join("")}</tbody></table></div>` : `<p class="fine">Nothing yet.</p>`}
    <p class="fine" style="margin-top:10px">Tap a booking to see details, pay a balance, upload info, request a reschedule or cancel.</p></div>
  <div data-pane="1" hidden>${d.memberships.length ? d.memberships.map((m) => `<div class="card" style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><h3 style="margin:0">${esc(m.serviceName)} Membership</h3><p class="fine" style="margin:4px 0">${esc(m.tier)} · ${money(m.monthly_cents, true)}/month + tax · ${esc(m.address || "")}</p></div><div>${memberPill(m)}</div></div>
      <dl class="kv" style="margin-top:10px"><dt>Next charge</dt><dd>${m.cancel_at_period_end || m.status === "canceled" ? "None — ending" : m.current_period_end ? fmtDate(m.current_period_end, { month: "long", day: "numeric", year: "numeric" }) : "—"}</dd><dt>Ends</dt><dd>${m.cancel_at ? fmtDate(m.cancel_at, { month: "long", day: "numeric", year: "numeric" }) + " (season end)" : m.cancel_at_period_end && m.current_period_end ? fmtDate(m.current_period_end, { month: "long", day: "numeric", year: "numeric" }) : "End of season"}</dd></dl>
      ${["active", "trialing", "past_due"].includes(m.status) && !m.cancel_at_period_end ? `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost sm" data-cancel="${m.id}">Cancel membership</button>${d.customer.hasBilling ? `<button class="btn ghost sm" data-portal>Update card</button>` : ""}</div>` : ""}</div>`).join("") : `<div class="empty">No memberships. <a href="/plans/">See seasonal plans</a></div>`}</div>
  <div data-pane="2" hidden>${d.payments.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>For</th><th>Amount</th><th>Receipt</th></tr></thead><tbody>${d.payments.map((p) => `<tr><td>${fmtDate(p.created_at, { month: "short", day: "numeric", year: "numeric" })}</td><td>${esc(p.ref || (p.kind === "subscription" ? "Membership" : p.kind))}<br><span class="fine">${esc(p.kind)}${p.method !== "card" ? " · " + esc(p.method) : ""}</span></td><td>${money(p.amount_cents, true)}${p.refunded_cents ? `<br><span class="fine">refunded ${money(p.refunded_cents, true)}</span>` : ""}</td><td>${p.receipt_url ? `<a href="${esc(p.receipt_url)}" target="_blank" rel="noopener">View</a>` : "—"}</td></tr>`).join("")}</tbody></table></div>` : `<p class="fine">No payments yet.</p>`}</div>
  <div data-pane="3" hidden>${d.properties.length ? d.properties.map((p) => `<div class="card flat" style="margin-bottom:10px"><b>${esc(p.address)}</b><p class="fine" style="margin:4px 0 0">${p.drive_minutes != null ? `~${Math.round(p.drive_minutes)} min from Islip · ` : ""}saved ${fmtDate(p.created_at, { month: "short", year: "numeric" })}</p></div>`).join("") : `<p class="fine">No saved properties.</p>`}<p class="fine">To change contact details or a saved address, call or email us.</p></div>`;

  el.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    el.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    el.querySelectorAll("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
  }));
  el.querySelectorAll("tr[data-t]").forEach((tr) => tr.addEventListener("click", () => (location.href = `/booking/?t=${tr.dataset.t}`)));
  el.querySelector("[data-out]").addEventListener("click", signOut);
  el.querySelectorAll("[data-portal]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    try { const r = await api("portal", {}, { token }); location.href = r.url; } catch (e) { toast(e.message); b.disabled = false; }
  }));
  el.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Cancel this membership? It stays active until the end of the month you've paid for, and you won't be charged again.")) return;
    b.disabled = true;
    try { await api("membership-cancel", { id: b.dataset.cancel }, { token }); toast("Cancelled — confirmation emailed."); setTimeout(() => location.reload(), 1200); }
    catch (e) { toast(e.message); b.disabled = false; }
  }));
  if (qs.get("joined")) { const t = el.querySelector('[data-tab="1"]'); t?.click(); }
}
function memberPill(m) {
  const map = { active: ["Active", "ok"], trialing: ["Starts at season start", "info"], past_due: ["Payment failed", "err"], canceled: ["Ended", ""], incomplete: ["Incomplete", "warn"], unpaid: ["Unpaid", "err"] };
  const [l, k] = map[m.status] || [m.status, ""];
  return `<span class="pill ${k}">${l}${m.cancel_at_period_end ? " · cancelling" : ""}</span>`;
}
main();
