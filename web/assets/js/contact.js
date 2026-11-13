import { api, esc } from "./api.js";
const form = document.getElementById("quote-form");
const out = document.getElementById("quote-out");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  if (!fd.get("terms")) { out.innerHTML = `<div class="notice err"><p>Please agree to the terms.</p></div>`; return; }
  const service = fd.get("service");
  const defaults = { fall: { tier: "xl", leafVolume: "normal" }, spring: { tier: "xl", debris: "normal" }, summer: { lawnSqft: 30000 }, winter: { tier: "large" } };
  const b = form.querySelector('button[type="submit"]'); b.disabled = true;
  try {
    const r = await api("book", { mode: "quote", inputs: { service, ...defaults[service] }, address: fd.get("address"), contact: { name: fd.get("name"), email: fd.get("email"), phone: fd.get("phone") }, notes: fd.get("notes"), consent: { terms: true }, website: fd.get("website") });
    form.innerHTML = `<div class="notice ok"><p><b>Thanks — request ${esc(r.ref)} received.</b> We'll get back to you within one business day. <a href="/booking/?t=${encodeURIComponent(r.token)}">View your request</a></p></div>`;
  } catch (err) { out.innerHTML = `<div class="notice err"><p>${esc(err.message)}</p></div>`; b.disabled = false; }
});
