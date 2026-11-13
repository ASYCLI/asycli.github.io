// Shared behaviour on every page: seasonal theme, nav, reveal animations, live prices.
import { getConfig } from "./api.js";

const SEASON_BY_MONTH = ["winter", "winter", "winter", "spring", "spring", "summer", "summer", "summer", "fall", "fall", "fall", "fall"];
export function currentSeason() {
  const d = new Date(); const m = d.getMonth(), day = d.getDate();
  if (m === 11 && day >= 16) return "winter"; // mid-December onward
  if (m === 2 && day < 15) return "winter";
  return SEASON_BY_MONTH[m];
}
const root = document.documentElement;
if (!root.dataset.seasonFixed) root.dataset.season = currentSeason();
const LABELS = { fall: "Now booking fall leaf cleanups", winter: "Now enrolling winter snow members", spring: "Now booking spring cleanups", summer: "Now booking summer mowing" };
document.querySelectorAll("[data-season-label]").forEach((el) => (el.textContent = LABELS[currentSeason()]));
document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));

// mobile nav
const header = document.querySelector("header.site");
const mbtn = header?.querySelector(".menu-btn");
mbtn?.addEventListener("click", () => {
  const open = header.classList.toggle("open");
  mbtn.setAttribute("aria-expanded", String(open));
});
document.querySelectorAll(".nav-drop > button").forEach((b) => b.addEventListener("click", () => b.parentElement.classList.toggle("open")));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { header?.classList.remove("open"); document.querySelectorAll(".nav-drop.open").forEach((n) => n.classList.remove("open")); } });

// reveal on scroll (cheap, one observer)
const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" }) : null;
document.querySelectorAll(".reveal").forEach((el) => (io ? io.observe(el) : el.classList.add("in")));

// mobile action bar appears after the first screen
const bar = document.querySelector(".mobile-bar");
if (bar && !location.pathname.startsWith("/admin")) {
  const onScroll = () => bar.classList.toggle("show", window.scrollY > 420);
  addEventListener("scroll", onScroll, { passive: true }); onScroll();
} else bar?.remove();

// Fill live prices from the owner's settings (static defaults stay if the API is unreachable)
const hasPrices = document.querySelector("[data-from],[data-base],[data-plan],[data-haul],[data-snow],[data-salt],[data-band],[data-trigger],[data-included],[data-maxdepth],[data-season-label-winter]");
if (hasPrices) {
  getConfig().then(({ pricing: P }) => {
    const $ = (sel, fn) => document.querySelectorAll(sel).forEach(fn);
    const d = (n) => "$" + Math.round(n).toLocaleString("en-US");
    const from = { fall: Math.min(...Object.values(P.fall.base)), spring: Math.min(...Object.values(P.spring.base)), summer: P.summer.areaBands[0][1], winter: Math.min(...Object.values(P.winter.driveway)) };
    $("[data-from]", (el) => from[el.dataset.from] != null && (el.textContent = d(from[el.dataset.from])));
    $("[data-base]", (el) => { const [s, t] = el.dataset.base.split("."); if (P[s]?.base?.[t]) el.textContent = d(P[s].base[t]); });
    $("[data-haul]", (el) => { const [s, t] = el.dataset.haul.split("."); if (P[s]?.haulAway?.[t]) el.textContent = d(P[s].haulAway[t]); });
    $("[data-snow]", (el) => P.winter.driveway[el.dataset.snow] && (el.textContent = d(P.winter.driveway[el.dataset.snow])));
    $("[data-salt]", (el) => P.winter.salting[el.dataset.salt] && (el.textContent = d(P.winter.salting[el.dataset.salt])));
    $("[data-band]", (el) => P.summer.areaBands[+el.dataset.band] && (el.textContent = d(P.summer.areaBands[+el.dataset.band][1])));
    $("[data-plan]", (el) => P.memberships[el.dataset.plan] && (el.textContent = d(P.memberships[el.dataset.plan].small)));
    $("[data-trigger]", (el) => (el.textContent = P.winterTerms.triggerInches));
    $("[data-included]", (el) => (el.textContent = P.winterTerms.includedVisitsPerMonth));
    $("[data-maxdepth]", (el) => (el.textContent = P.winterTerms.maxDepthPerVisitInches));
    $("[data-season-label-winter]", (el) => (el.textContent = P.seasons.winter.label));
  }).catch(() => {});
}
