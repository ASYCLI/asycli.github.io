import { currentSeason } from "./site.js";

const COPY = {
  fall: { t: "Leaves cleared. Lawn back. Every fall.", l: "Full front and backyard leaf cleanups — raked, blown and bagged at your curb, or loaded on our truck and hauled away. Priced up front, done by a dedicated three-person crew.", cta: "/estimate/?service=fall" },
  winter: { t: "Driveways cleared after every storm.", l: "Residential snow and ice removal with snowblower, shovels and salting. Book a single visit or join the winter membership for priority service after 2\"+ snowfall.", cta: "/estimate/?service=winter" },
  spring: { t: "A clean start for your yard every spring.", l: "Winter debris and leftover leaves cleared, raked, blown and bagged — with optional haul-away — so your property is ready for the season.", cta: "/estimate/?service=spring" },
  summer: { t: "Crisp mowing and clean edges, all summer.", l: "Lawn mowing and string trimming priced by your actual lawn area. Book one cut or two scheduled visits a month.", cta: "/estimate/?service=summer" },
};
const now = currentSeason();
const imgs = document.querySelectorAll("[data-season-img]");
const btns = document.querySelectorAll("[data-season-btn]");
const title = document.querySelector("[data-hero-title]");
const lede = document.querySelector("[data-hero-lede]");
const cta = document.querySelector("[data-hero-cta]");

function show(season, user) {
  document.documentElement.dataset.season = season;
  imgs.forEach((im) => {
    const on = im.dataset.seasonImg === season;
    if (on && im.loading === "lazy") im.loading = "eager";
    im.classList.toggle("on", on);
  });
  btns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.seasonBtn === season)));
  if (user || season !== "fall") {
    title.textContent = COPY[season].t;
    lede.textContent = COPY[season].l;
  }
  cta.href = COPY[season].cta;
}
btns.forEach((b) => {
  if (b.dataset.seasonBtn === now) b.querySelector(".now").textContent = "· now";
  b.addEventListener("click", () => show(b.dataset.seasonBtn, true));
});
show(now, now !== "fall");
