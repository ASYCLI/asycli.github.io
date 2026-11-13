import { api, getConfig, money, esc } from "./api.js";

const NAMES = { spring: "Spring Renewal Membership", summer: "Summer Lawn Maintenance Membership", fall: "Fall Cleanup Membership", winter: "Winter Protection Membership" };
const panel = document.getElementById("join-panel");
const form = document.getElementById("join-form");
let C, choice = null;

function fmtSeason(iso) { return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); }

getConfig().then((c) => {
  C = c;
  document.querySelectorAll("[data-plan-card]").forEach((card) => {
    const s = card.dataset.planCard;
    const P = c.pricing;
    const st = c.memberships[s];
    card.querySelector(`[data-season-text="${s}"]`).textContent = P.seasons[s].label;
    let tier = "small";
    const amt = card.querySelector("[data-plan-amt]");
    const set = () => { amt.textContent = money(P.memberships[s][tier]); card.querySelectorAll("[data-tier]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tier === tier))); };
    card.querySelectorAll("[data-tier]").forEach((b) => b.addEventListener("click", () => { tier = b.dataset.tier; set(); }));
    if (s === "winter") card.querySelectorAll("[data-tier]").forEach((b) => (b.textContent = { small: "Small drive", medium: "Medium drive", large: "Large drive" }[b.dataset.tier]));
    set();
    const btn = card.querySelector("[data-join]");
    const status = card.querySelector("[data-plan-status]");
    if (!st.open) {
      btn.disabled = true; btn.textContent = st.reason || "Not available";
      status.innerHTML = `Want to be first in line? <a href="/contact/">Contact us</a> or call.`;
    } else status.textContent = `Billing runs through ${fmtSeason(st.season.end)} and then stops automatically.`;
    btn.addEventListener("click", () => open(s, () => tier));
  });
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
}).catch(() => {
  document.querySelectorAll("[data-join]").forEach((b) => { b.disabled = true; b.textContent = "Call to join"; });
});

function open(service, getTier) {
  const tier = getTier();
  const P = C.pricing, st = C.memberships[service];
  const monthly = P.memberships[service][tier];
  const tax = P.salesTax.enabled ? Math.round(monthly * P.salesTax.percent) / 100 : 0;
  const startsLater = st.season.start > C.today;
  const W = P.winterTerms;
  choice = { service, tier, monthly };
  document.getElementById("join-title").textContent = `Join: ${NAMES[service]} (${tier})`;
  document.getElementById("join-terms").innerHTML = `<p><b>Here's exactly what you're agreeing to:</b></p><ul style="margin:6px 0 0;padding-left:20px">
    <li><b>${money(monthly)}/month</b> + ${P.salesTax.percent}% sales tax (${money(monthly + tax)} total), charged automatically to your card each month.</li>
    <li>${startsLater ? `Your first charge is on <b>${fmtSeason(st.season.start)}</b> when the season starts.` : `Your first charge is <b>today</b>.`}</li>
    <li>Billing <b>ends automatically on ${fmtSeason(st.season.end)}</b> (end of season). It does not renew into next year. Your last charge may cover a partial month.</li>
    <li>${service === "winter" ? `Includes ${W.includedVisitsPerMonth} snow visits per month after ${W.triggerInches}"+ snowfall (${esc(W.measurement)}), each up to ${W.maxDepthPerVisitInches}" deep. Extra visits are charged to your card at ${W.extraVisitDiscountPercent}% off our per-visit price. Salting is ${W.saltingIncluded ? "included" : "an optional add-on"}. Unused visits don't roll over. This is not unlimited snow removal.` : `Includes ${P.memberships.visitsPerMonth} scheduled visits per month. Unused visits don't roll over.`}</li>
    <li>Cancel any time online in My Account; it takes effect at the end of the month you've paid for.</li></ul>`;
  document.getElementById("j-recurring-text").innerHTML = `I authorize All Season Yard Care Long Island to charge my card <b>${money(monthly)}/month plus tax</b> ${startsLater ? `starting ${fmtSeason(st.season.start)}` : "starting today"} until ${fmtSeason(st.season.end)}, unless I cancel sooner.`;
  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  form.name.focus({ preventScroll: true });
}
form.querySelector("[data-cancel-join]").addEventListener("click", () => { panel.hidden = true; choice = null; });
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const out = document.getElementById("join-out");
  const fd = new FormData(form);
  if (!fd.get("recurring") || !fd.get("terms")) { out.innerHTML = `<div class="notice err"><p>Please tick both boxes to confirm the recurring billing and terms.</p></div>`; return; }
  const b = form.querySelector('button[type="submit"]'); b.disabled = true; b.innerHTML = `<span class="spinner"></span> Preparing checkout…`;
  try {
    const r = await api("subscribe", { service: choice.service, tier: choice.tier, address: fd.get("address"), contact: { name: fd.get("name"), email: fd.get("email"), phone: fd.get("phone") }, consent: { recurring: true, terms: true }, website: fd.get("website") });
    location.href = r.checkoutUrl;
  } catch (err) { out.innerHTML = `<div class="notice err"><p>${esc(err.message)}</p></div>`; b.disabled = false; b.textContent = "Continue to secure payment"; }
});
