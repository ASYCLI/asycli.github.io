// Multi-step instant estimate + booking wizard
import { api, getConfig, money, esc, fmtDate, compressImage, uploadSigned } from "./api.js";

const app = document.getElementById("est-app");
const form = document.getElementById("est-form");
const stepsEl = [...form.querySelectorAll(".step")];
const progress = app.querySelector(".progress");
const backBtn = form.querySelector("[data-back]");
const nextBtn = form.querySelector("[data-next]");
const sumEl = document.getElementById("sum");
const pageMode = app.dataset.mode; // "estimate" | "book"

const S = {
  service: null, address: "", travel: null, inputs: {}, est: null, mode: pageMode === "book" ? "book" : null,
  date: null, window: null, photos: [], files: [], config: null, busy: false,
};
let flow = [];
let idx = 0;

const FIELDS = {
  fall: [
    radio("tier", "Property size", [["small", "Small", "Up to ~1/8 acre"], ["medium", "Medium", "~1/8–1/4 acre"], ["large", "Large", "~1/4–1/2 acre"], ["xl", "Extra large", "Over 1/2 acre — custom quote"]], "medium"),
    radio("leafVolume", "How many leaves?", [["light", "Light", "Scattered cover"], ["normal", "Normal", "Lawn mostly covered"], ["heavy", "Heavy", "Thick layer / piles"], ["very_heavy", "Very heavy", "Deep, wet or matted"]], "normal"),
    radio("trees", "Trees dropping leaves on the property", [["0-2", "0–2"], ["3-5", "3–5"], ["6-10", "6–10"], ["11+", "11+"]], "3-5"),
    radio("areas", "Which areas?", [["both", "Front and back"], ["front", "Front yard only"], ["back", "Backyard only"]], "both"),
    radio("access", "Access", [["easy", "Easy", "Open, gates wide enough"], ["moderate", "Some obstacles", "Narrow gates, slopes, beds"], ["difficult", "Difficult", "Steep, fenced, lots of obstacles"]], "easy"),
    radio("disposal", "What should happen to the leaves?", [["bag", "Bag and leave on site", "Lower price — bags left where you choose"], ["haul", "Haul-away", "We load them on our truck and remove them"]], "bag"),
    checks("extras", "Add-ons", [["hardscape_blowoff", "Blow off driveway, patio & walkways"], ["beds_and_corners", "Clear beds, fence lines & corners"]]),
  ],
  spring: [
    radio("tier", "Property size", [["small", "Small", "Up to ~1/8 acre"], ["medium", "Medium", "~1/8–1/4 acre"], ["large", "Large", "~1/4–1/2 acre"], ["xl", "Extra large", "Custom quote"]], "medium"),
    radio("debris", "How much debris?", [["light", "Light", "A few sticks and leaves"], ["normal", "Normal", "Typical winter mess"], ["heavy", "Heavy", "Lots of leaves, branches, buildup"]], "normal"),
    radio("areas", "Which areas?", [["both", "Front and back"], ["front", "Front yard only"], ["back", "Backyard only"]], "both"),
    radio("access", "Access", [["easy", "Easy"], ["moderate", "Some obstacles"], ["difficult", "Difficult"]], "easy"),
    radio("disposal", "Debris disposal", [["bag", "Bag and leave on site", "Lower price"], ["haul", "Haul-away", "We remove it on our truck"]], "bag"),
    checks("extras", "Add-ons", [["hardscape_blowoff", "Blow off driveway, patio & walkways"], ["beds_and_corners", "Clear beds, fence lines & corners"]]),
  ],
  summer: [
    { html: () => `<div class="field"><label for="lawnSqft">Approximate mowable lawn area (sq ft) <span class="hint">— grass only, not the whole lot</span></label>
      <input id="lawnSqft" name="lawnSqft" type="number" inputmode="numeric" min="500" max="100000" step="100" value="5000">
      <div class="choice-grid" style="margin-top:8px;grid-template-columns:repeat(auto-fill,minmax(120px,1fr))">${[["2500", "Small front/back"], ["5000", "Typical 1/4-acre lot"], ["9000", "Big lawn"], ["15000", "Very large"]].map(([v, l]) => `<button type="button" class="btn ghost sm" data-sqft="${v}">${l}<br>${Number(v).toLocaleString()}</button>`).join("")}</div>
      <p class="fine" style="margin-top:6px">Not sure? Pick the closest and upload a photo later — we'll confirm on the first visit.</p></div>` },
    radio("condition", "Grass condition", [["maintained", "Regularly cut", "Mowed in the last 2 weeks"], ["overgrown", "Overgrown", "3–5 weeks since last cut"], ["very_overgrown", "Very overgrown", "Long, thick or gone to seed"]], "maintained"),
    radio("obstacles", "Obstacles (trees, beds, play sets, fences)", [["few", "Few"], ["some", "Some"], ["many", "Many"]], "few"),
    radio("trimming", "String trimming needed", [["light", "Light"], ["standard", "Standard edges & fences"], ["heavy", "Heavy / lots of borders"]], "standard"),
  ],
  winter: [
    radio("tier", "Driveway size", [["small", "Small", "1–2 cars, single width"], ["medium", "Medium", "3–4 cars or double width"], ["large", "Large", "Long, or 5+ cars"]], "small"),
    radio("walkway", "Walkways to clear", [["none", "None"], ["short", "Short", "Front walk / steps"], ["long", "Long", "Multiple or long paths"]], "short"),
    radio("depth", "Expected snow depth for this visit", [["2-6", "2–6 in"], ["6-12", "6–12 in"], ["12+", "12+ in"]], "2-6"),
    radio("ice", "Ice conditions", [["none", "None"], ["some", "Some icy spots"], ["heavy", "Heavy ice"]], "none"),
    checks("salting", "Salting", [["1", "Add salting / de-icing"]]),
  ],
};
function radio(name, label, opts, def) {
  return { name, def, html: () => `<fieldset class="field" style="border:0;padding:0;margin:0 0 18px"><legend class="lg">${label}</legend><div class="choice-grid">${opts.map(([v, l, s]) => `<label class="choice"><input type="radio" name="${name}" value="${v}" ${v === def ? "checked" : ""}><span>${l}${s ? `<small>${s}</small>` : ""}</span></label>`).join("")}</div></fieldset>` };
}
function checks(name, label, opts) {
  return { name, html: () => `<fieldset class="field" style="border:0;padding:0;margin:0 0 18px"><legend class="lg">${label}</legend><div class="choice-grid">${opts.map(([v, l]) => `<label class="choice"><input type="checkbox" name="${name}" value="${v}"><span>${l}</span></label>`).join("")}</div></fieldset>` };
}

function buildFlow() {
  flow = ["service", "address", "details", "estimate"];
  if (S.mode === "book" && S.service !== "winter" && !S.est?.review) flow.push("schedule");
  if (S.mode === "book" && S.service === "winter") flow.push("schedule");
  if (S.mode) flow.push("contact");
  flow.push("done");
  progress.innerHTML = flow.slice(0, -1).map((_, i) => `<i class="${i <= idx ? "on" : ""}"></i>`).join("");
}

function go(to) {
  idx = Math.max(0, Math.min(to, flow.length - 1));
  buildFlow();
  const name = flow[idx];
  stepsEl.forEach((s) => s.classList.toggle("active", s.dataset.step === name));
  backBtn.style.visibility = idx === 0 || name === "done" ? "hidden" : "visible";
  nextBtn.hidden = name === "done" || name === "estimate";
  nextBtn.textContent = name === "contact" ? (S.mode === "quote" ? "Send my request" : "Continue to secure payment") : "Continue";
  if (name === "contact" && S.mode === "book" && S.est?.deposit && !S.est.review) {
    nextBtn.textContent = S.est.deposit.fullPrepay ? `Pay ${money(S.est.deposit.dueNow)} securely` : `Pay ${money(S.est.deposit.dueNow)} deposit securely`;
  }
  if (name === "details") renderDetails();
  if (name === "estimate") renderEstimate();
  if (name === "schedule") renderSchedule();
  const h = stepsEl.find((s) => s.dataset.step === name)?.querySelector("h2");
  if (h && idx > 0) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); app.scrollIntoView({ behavior: "smooth", block: "start" }); }
}

backBtn.addEventListener("click", () => go(idx - 1));
nextBtn.addEventListener("click", () => next());
form.addEventListener("submit", (e) => { e.preventDefault(); next(); });
form.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "checkbox") { e.preventDefault(); next(); } });

async function next() {
  if (S.busy) return;
  const name = flow[idx];
  if (name === "service") {
    if (!S.service) return flash("Choose a service to continue.");
  }
  if (name === "address") {
    const a = form.address.value.trim();
    if (a.length < 8 || !/\d/.test(a)) return flash("Enter the full street address, including the house number and town.");
    if (a !== S.address || !S.travel) { await checkTravel(a); }
  }
  if (name === "details") { readInputs(); await refresh(); if (!S.est) return; }
  if (name === "schedule") {
    if (S.service !== "winter" && (!S.date || !S.window)) return flash("Pick a date and time window.");
  }
  if (name === "contact") return submit();
  go(idx + 1);
}

function flash(msg) {
  const step = stepsEl.find((s) => s.dataset.step === flow[idx]);
  let n = step.querySelector(".step-msg");
  if (!n) { n = document.createElement("div"); n.className = "notice err step-msg"; n.style.marginTop = "14px"; step.appendChild(n); }
  n.innerHTML = `<p>${esc(msg)}</p>`;
  n.setAttribute("role", "alert");
  setTimeout(() => n?.remove(), 6000);
}

// ---- service step
form.querySelectorAll('input[name="service"]').forEach((r) => r.addEventListener("change", () => {
  S.service = r.value; S.inputs = { service: r.value }; S.est = null; S.date = S.window = null;
  renderSummary();
  setTimeout(() => go(1), 120);
}));

// ---- address
async function checkTravel(address) {
  const out = document.getElementById("travel-out");
  S.busy = true; nextBtn.disabled = true;
  out.innerHTML = `<p class="fine"><span class="spinner dark"></span> Checking drive time from Islip…</p>`;
  try {
    const t = await api("travel", { address });
    S.address = address; S.travel = t;
    const cls = t.review ? "warn" : t.fee ? "info" : "ok";
    out.innerHTML = `<div class="notice ${cls}"><p>${t.matched ? `<b>${esc(t.matched)}</b><br>` : ""}${esc(t.note)}</p></div>`;
  } catch (e) {
    S.address = address; S.travel = { review: true, note: e.message };
    out.innerHTML = `<div class="notice warn"><p>${esc(e.message)}</p></div>`;
  } finally { S.busy = false; nextBtn.disabled = false; renderSummary(); }
}

// ---- details
function renderDetails() {
  const box = document.getElementById("detail-fields");
  if (box.dataset.for === S.service) return;
  box.dataset.for = S.service;
  box.innerHTML = FIELDS[S.service].map((f) => f.html()).join("");
  box.querySelectorAll("[data-sqft]").forEach((b) => b.addEventListener("click", () => { box.querySelector("#lawnSqft").value = b.dataset.sqft; readInputs(); refreshSoon(); }));
  box.addEventListener("change", () => { readInputs(); refreshSoon(); });
  box.addEventListener("input", (e) => { if (e.target.name === "lawnSqft") { readInputs(); refreshSoon(); } });
  readInputs(); refreshSoon();
}
function readInputs() {
  const fd = new FormData(form);
  const i = { service: S.service };
  for (const f of FIELDS[S.service] || []) {
    if (!f.name) continue;
    if (f.name === "extras") i.extras = fd.getAll("extras");
    else if (f.name === "salting") i.salting = fd.getAll("salting").length > 0;
    else i[f.name] = fd.get(f.name) ?? f.def;
  }
  if (S.service === "summer") i.lawnSqft = Number(form.querySelector("#lawnSqft")?.value) || 0;
  S.inputs = i;
}
let t;
function refreshSoon() { clearTimeout(t); t = setTimeout(refresh, 260); }
let reqId = 0;
async function refresh() {
  const my = ++reqId;
  sumEl.classList.add("loading");
  try {
    const r = await api("estimate", { inputs: S.inputs, address: S.address });
    if (my !== reqId) return;
    S.est = r.estimate;
  } catch (e) {
    if (my !== reqId) return;
    S.est = null; sumEl.innerHTML = `<div class="notice err"><p>${esc(e.message)}</p></div>`; return;
  } finally { sumEl.classList.remove("loading"); }
  renderSummary();
}

// ---- summary sidebar
function renderSummary() {
  const svc = { fall: "Fall Cleanup", winter: "Snow & Ice Removal", spring: "Spring Renewal", summer: "Lawn Mowing + Trimming" }[S.service];
  if (!S.service) { sumEl.innerHTML = `<p class="fine">Choose a service to start.</p>`; return; }
  const e = S.est;
  let html = `<p style="margin-bottom:8px"><b>${svc}</b></p>`;
  if (S.travel) html += `<p class="fine" style="margin:-4px 0 10px">${esc(S.travel.matched || S.address)}${S.travel.driveMinutes != null ? ` · ~${S.travel.driveMinutes} min from Islip` : ""}</p>`;
  if (!e) { sumEl.innerHTML = html + `<p class="fine">Answer a few questions to see your price.</p>`; return; }
  if (e.total == null) { sumEl.innerHTML = html + `<div class="notice warn"><p>${esc(e.reasons.join(" "))}</p></div><p class="fine">Request a free review and we'll quote within one business day.</p>`; return; }
  html += `<ul class="sum-lines">${e.lines.map((l) => `<li><span>${esc(l.label)}</span><span>${l.amount ? money(l.amount) : "Included"}</span></li>`).join("")}`;
  if (e.tax) html += `<li><span>${esc(e.taxLabel)}</span><span>${money(e.tax)}</span></li>`;
  html += `</ul><div class="sum-total"><span>Estimated total</span><b>${money(e.total)}</b></div>`;
  html += `<div class="sum-meta"><span>Labor complexity: <b>${esc(e.complexity)}</b></span>`;
  if (e.deposit) html += `<span>${e.deposit.fullPrepay ? `Paid in full at booking: <b>${money(e.deposit.dueNow)}</b>` : `Deposit to book: <b>${money(e.deposit.dueNow)}</b> · balance after the job: ${money(e.deposit.balance)}`}</span>`;
  if (S.service === "winter") html += `<span>Price is per visit.</span>`;
  html += `</div>`;
  if (e.review) html += `<div class="notice warn" style="margin-top:12px"><p>${esc(e.reasons.join(" "))}</p></div>`;
  sumEl.innerHTML = html;
}

// ---- estimate step
function renderEstimate() {
  const out = document.getElementById("est-out");
  const e = S.est;
  if (!e) { out.innerHTML = `<p><span class="spinner dark"></span></p>`; return; }
  const canBook = e.total != null && !e.review;
  const payOn = S.config?.payments !== "off";
  out.innerHTML = `${e.total != null ? `<div class="card flat" style="background:var(--paper)"><div class="sum-total" style="padding:0"><span>Estimated total${S.service === "winter" ? " per visit" : ""}</span><b>${money(e.total)}</b></div><p class="fine" style="margin:6px 0 0">Includes ${esc(e.taxLabel || "tax")}. ${e.deposit ? (e.deposit.fullPrepay ? `Paid in full when you book.` : `${money(e.deposit.dueNow)} deposit to book, ${money(e.deposit.balance)} after the job.`) : ""}</p></div>` : ""}
    ${e.review ? `<div class="notice warn" style="margin-top:14px"><p><b>We'd like to take a quick look first.</b> ${esc(e.reasons.join(" "))}</p></div>` : ""}
    <div style="display:grid;gap:10px;margin-top:18px">
      ${canBook ? `<button type="button" class="btn gold block" data-choose="book">${S.service === "winter" ? "Request snow clearing" : payOn ? "Book a date & pay deposit" : "Request this booking"}</button>` : ""}
      <button type="button" class="btn ${canBook ? "ghost" : "gold"} block" data-choose="quote">Request a professional review${canBook ? " instead" : ""}</button>
      <a class="btn ghost block" href="tel:+16318009643">Call us to talk it through</a>
    </div>
    ${S.service !== "winter" ? `<p class="fine" style="margin-top:12px">Want a monthly plan instead? <a href="/plans/#${S.service}">See the ${S.service} membership</a>.</p>` : `<p class="fine" style="margin-top:12px">Want priority after every storm? <a href="/plans/#winter">See the Winter Protection Membership</a>.</p>`}`;
  out.querySelectorAll("[data-choose]").forEach((b) => b.addEventListener("click", () => { S.mode = b.dataset.choose; buildFlow(); go(idx + 1); }));
}

// ---- schedule
async function renderSchedule() {
  const out = document.getElementById("slots-out");
  if (S.service === "winter") {
    document.getElementById("sched-title").textContent = "When do you need us?";
    document.getElementById("sched-sub").textContent = "Snow work depends on the storm, so we confirm timing with you directly. Members always get priority.";
    out.innerHTML = `<div class="field"><label for="snowdate">Preferred date <span class="hint">(optional — leave blank for "after the next storm")</span></label><input type="date" id="snowdate" name="snowdate"></div>
      <div class="notice info"><p>We'll review your request and confirm before charging anything. Payment for one-time snow visits is collected after we confirm.</p></div>`;
    out.querySelector("#snowdate").addEventListener("change", (e) => (S.date = e.target.value || null));
    return;
  }
  out.innerHTML = `<p class="fine"><span class="spinner dark"></span> Loading open times…</p>`;
  try {
    const { days } = await api("slots", { service: S.service, hours: S.est?.estHours || 2 });
    if (!days.length) {
      out.innerHTML = `<div class="notice warn"><p>There are no open online slots for this service in the next few weeks (or it's outside the season). Request a review instead and we'll find a time with you.</p></div><button type="button" class="btn" style="margin-top:12px" data-q>Request a review</button>`;
      out.querySelector("[data-q]").addEventListener("click", () => { S.mode = "quote"; buildFlow(); go(flow.indexOf("contact")); });
      return;
    }
    out.innerHTML = `<div class="slots">${days.map((d) => `<div class="slot-day"><b>${fmtDate(d.date, { weekday: "long", month: "short", day: "numeric" })}</b>${d.windows.map((w) => `<label class="choice"><input type="radio" name="slot" value="${d.date}|${w.window}" ${S.date === d.date && S.window === w.window ? "checked" : ""}><span>${esc(w.label)}</span></label>`).join("")}</div>`).join("")}</div>`;
    out.addEventListener("change", (e) => { if (e.target.name === "slot") { [S.date, S.window] = e.target.value.split("|"); } });
  } catch (e) { out.innerHTML = `<div class="notice err"><p>${esc(e.message)}</p></div>`; }
}

// ---- photos
const photoInput = document.getElementById("c-photos");
photoInput?.addEventListener("change", async () => {
  const files = [...photoInput.files].slice(0, 8 - S.files.length);
  const thumbs = document.getElementById("thumbs");
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    try {
      const blob = await compressImage(f);
      S.files.push(blob);
      const im = document.createElement("img"); im.src = URL.createObjectURL(blob); im.alt = "Property photo"; thumbs.appendChild(im);
    } catch (_) { /* unsupported format (e.g. some HEIC) — skip */ }
  }
  photoInput.value = "";
});

// ---- submit
async function submit() {
  const out = document.getElementById("submit-out");
  const fd = new FormData(form);
  const contact = { name: fd.get("name")?.trim(), email: fd.get("email")?.trim(), phone: fd.get("phone")?.trim() };
  if (!contact.name || !contact.email || !contact.phone) return flash("Please fill in your name, email and phone.");
  if (!fd.get("terms")) return flash("Please agree to the terms to continue.");
  S.busy = true; nextBtn.disabled = true; const label = nextBtn.textContent; nextBtn.innerHTML = `<span class="spinner"></span> Working…`;
  out.innerHTML = "";
  try {
    const photos = [];
    if (S.files.length) {
      out.innerHTML = `<p class="fine">Uploading photos…</p>`;
      const { uploads } = await api("upload-urls", { count: S.files.length });
      for (let i = 0; i < S.files.length; i++) { try { photos.push(await uploadSigned("job-photos", uploads[i].path, uploads[i].token, S.files[i])); } catch (_) { /* keep going */ } }
    }
    const r = await api("book", {
      mode: S.mode === "quote" ? "quote" : "book", inputs: { ...S.inputs, notes: undefined }, address: S.address, contact,
      date: S.date, window: S.window, accessNotes: fd.get("accessNotes"), notes: fd.get("notes"), photos,
      consent: { terms: true }, website: fd.get("website"),
    });
    if (r.checkoutUrl) { out.innerHTML = `<p class="fine">Taking you to secure checkout…</p>`; location.href = r.checkoutUrl; return; }
    showDone(r);
  } catch (e) {
    out.innerHTML = `<div class="notice err"><p>${esc(e.message)}</p></div>`;
    if (e.status === 409 && flow.includes("schedule")) { S.date = S.window = null; setTimeout(() => go(flow.indexOf("schedule")), 1500); }
  } finally { S.busy = false; nextBtn.disabled = false; if (!location.href.includes("checkout")) nextBtn.textContent = label; }
}

function showDone(r) {
  const quote = r.status === "quote_requested";
  document.getElementById("done-out").innerHTML = `<div style="text-align:center;padding:10px 0">
    <div style="width:64px;height:64px;border-radius:50%;background:var(--sage-soft);display:grid;place-items:center;margin:0 auto 14px"><svg width="30" height="30" viewBox="0 0 20 20"><path d="M5 10.5l3 3 7-7" fill="none" stroke="#1d3b2a" stroke-width="2.4" stroke-linecap="round"/></svg></div>
    <h2>${quote ? "Request received" : "Booking request received"}</h2>
    <p>Your reference is <b>${esc(r.ref)}</b>. ${quote || r.status === "pending_review" ? "We'll review the details and get back to you within one business day with a confirmed price and time." : ""}</p>
    <p class="fine">We've saved your request. If you gave us your email, a confirmation is on its way (check spam just in case).</p>
    <p><a class="btn" href="/booking/?t=${encodeURIComponent(r.token)}">View your booking</a></p></div>`;
  go(flow.indexOf("done"));
}

// ---- init
getConfig().then((c) => { S.config = c; if (c.payments === "off" && S.mode === "book") renderSummary(); }).catch(() => {});
const qs = new URLSearchParams(location.search);
buildFlow();
const pre = qs.get("service");
if (pre && FIELDS[pre]) {
  const r = form.querySelector(`input[name="service"][value="${pre}"]`);
  r.checked = true; S.service = pre; S.inputs = { service: pre }; renderSummary(); go(1);
} else go(0);
