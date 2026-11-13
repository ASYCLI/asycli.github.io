import { api, esc, fmtDate } from "./api.js";
const box = document.getElementById("gallery");
let items = [];
function render(f) {
  const list = f === "all" ? items : items.filter((g) => g.service === f);
  if (!list.length) { box.innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>Photos coming soon</h3><p>We only post photos of our own completed jobs. Check back soon — or <a href="/estimate/">get an estimate</a> and become one of them.</p></div>`; return; }
  box.innerHTML = list.map((g) => `<figure class="card" style="padding:12px;margin:0"><div class="ba"><img src="${esc(g.before)}" alt="Before" loading="lazy"><img class="after" src="${esc(g.after)}" alt="After" loading="lazy"><div class="handle"></div><span class="lbl" style="left:10px">Before</span><span class="lbl" style="right:10px">After</span><input type="range" min="0" max="100" value="50" aria-label="Compare before and after"></div>
    <figcaption style="padding:10px 4px 2px"><b>${esc(g.caption || { fall: "Fall cleanup", winter: "Snow clearing", spring: "Spring cleanup", summer: "Mowing & trimming" }[g.service])}</b><br><span class="fine">${esc(g.location || "")}${g.completed_on ? " · " + fmtDate(g.completed_on, { month: "short", year: "numeric" }) : ""}</span></figcaption></figure>`).join("");
  box.querySelectorAll(".ba").forEach((ba) => { const r = ba.querySelector("input"); const a = ba.querySelector(".after"), h = ba.querySelector(".handle"); r.addEventListener("input", () => { a.style.clipPath = `inset(0 0 0 ${r.value}%)`; h.style.left = r.value + "%"; }); });
}
document.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { document.querySelectorAll("[data-f]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); render(b.dataset.f); }));
api("public-content").then((d) => { items = d.gallery; render("all"); }).catch(() => { items = []; render("all"); });
