import { api, esc, fmtDate } from "./api.js";
const box = document.getElementById("reviews");
api("public-content").then((d) => {
  if (d.googleReviewUrl) document.getElementById("google-review").innerHTML = `<a class="btn ghost" href="${esc(d.googleReviewUrl)}" target="_blank" rel="noopener">Review us on Google</a>`;
  if (!d.reviews.length) { box.innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>Reviews coming soon</h3><p>We only show reviews from real customers after a completed job — never made-up testimonials.</p></div>`; return; }
  box.innerHTML = d.reviews.map((r) => `<div class="card review"><div class="stars" aria-label="${r.rating} out of 5 stars">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</div><p>${esc(r.body)}</p><p class="fine" style="margin:auto 0 0"><b>${esc(r.name)}</b>${r.town ? ", " + esc(r.town) : ""} · ${fmtDate(r.created_at, { month: "short", year: "numeric" })}</p></div>`).join("");
}).catch(() => { box.innerHTML = `<div class="empty" style="grid-column:1/-1"><p>Reviews couldn't load right now.</p></div>`; });
