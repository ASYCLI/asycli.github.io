// ASYCLI API — single Edge Function, routes by path. Service role on the server;
// every customer/admin route checks identity and ownership here.
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { estimate, publicEstimate, publicPricing, membership as membershipQuote, DEFAULT_PRICING, DEFAULT_COSTS } from "../_shared/pricing.js";
import {
  db, loadSettings, json, cors, HttpError, rateLimit, logError, todayET, addDays, dow, cents, refCode, str, emailOk,
  seasonWindow, Settings, fmtDate, money, esc,
} from "../_shared/util.ts";
import { travelFor } from "../_shared/travel.ts";
import { stripe, stripeEnabled, stripeMode } from "../_shared/stripe.ts";
import { notify, notifyOwner, serviceName, deliver, render, manageUrl } from "../_shared/email.ts";
import { handleWebhook } from "../_shared/webhook.ts";
import { createBookingCheckout, createMembershipCheckout, ensureStripeCustomer, recalcPaid, amountDueNow, syncSubscription } from "../_shared/billing.ts";

const SERVICES = ["spring", "summer", "fall", "winter"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const route = url.pathname.replace(/^.*\/api\/?/, "").replace(/\/$/, "");
  if (route === "stripe-webhook") return await handleWebhook(req);
  const sb = db();
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const S = await loadSettings(sb);
    const ctx = { req, sb, S, url, body };
    const handler = ROUTES[route];
    if (!handler) throw new HttpError(404, "Not found");
    return json(await handler(ctx));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) await logError(sb, `api/${route}`, e);
    return json({ error: status >= 500 ? "Something went wrong on our side. Please call us if this keeps happening." : (e as Error).message }, status);
  }
});

type Ctx = { req: Request; sb: SupabaseClient; S: Settings; url: URL; body: any };

// ---------- auth ----------
async function getUser(c: Ctx) {
  const token = (c.req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || token.split(".").length !== 3) return null;
  const { data, error } = await c.sb.auth.getUser(token);
  if (error || !data.user?.email) return null;
  return data.user;
}
async function requireUser(c: Ctx) {
  const u = await getUser(c);
  if (!u) throw new HttpError(401, "Please sign in.");
  return u;
}
async function requireAdmin(c: Ctx) {
  const u = await requireUser(c);
  const { data } = await c.sb.from("admins").select("email").eq("email", u.email!.toLowerCase()).maybeSingle();
  if (!data) throw new HttpError(403, "Not authorized.");
  return u;
}

// ---------- helpers ----------
function membershipStatus(S: Settings) {
  const out: Record<string, any> = {};
  const today = todayET();
  for (const s of SERVICES) {
    const w = seasonWindow(S.pricing.seasons[s]);
    const opensFrom = addDays(w.start, -S.business.membershipSalesLeadDays);
    let open = S.business.membershipsActive[s] && !!S.stripe.products?.[s] && S.pricing.serviceEnabled[s] && today >= opensFrom && today <= addDays(w.end, -21);
    let reason = !S.business.membershipsActive[s] ? "Opening soon" : !S.stripe.products?.[s] ? "Opening soon" : today < opensFrom ? `Sign-ups open ${fmtDate(opensFrom)}` : open ? "" : "Closed for this season";
    if (s === "winter" && open) {
      const cutoffYear = w.start.slice(0, 4) === today.slice(0, 4) ? Number(today.slice(0, 4)) + 1 : Number(today.slice(0, 4));
      const cutoff = `${cutoffYear}-${S.pricing.winterTerms.enrollmentCutoff}`;
      if (today > cutoff) { open = false; reason = "Enrollment closed for this winter"; }
    }
    out[s] = { open, reason, season: w };
  }
  return out;
}

async function upsertCustomer(sb: SupabaseClient, contact: any) {
  const email = str(contact?.email, 200).toLowerCase();
  if (!emailOk(email)) throw new HttpError(400, "Please enter a valid email address.");
  const name = str(contact?.name, 120);
  if (!name) throw new HttpError(400, "Please enter your name.");
  const phone = str(contact?.phone, 40);
  if (phone.replace(/\D/g, "").length < 10) throw new HttpError(400, "Please enter a phone number we can reach you at.");
  const { data: existing } = await sb.from("customers").select("*").eq("email", email).maybeSingle();
  if (existing) {
    // don't let an anonymous form overwrite stored contact details; only fill blanks
    const patch: any = {};
    if (!existing.name) patch.name = name;
    if (!existing.phone) patch.phone = phone;
    if (Object.keys(patch).length) await sb.from("customers").update(patch).eq("id", existing.id);
    return { ...existing, ...patch };
  }
  const { data, error } = await sb.from("customers").insert({ email, name, phone }).select("*").single();
  if (error) throw error;
  return data;
}

function cleanInputs(raw: any) {
  const s = str(raw?.service, 10);
  if (!SERVICES.includes(s)) throw new HttpError(400, "Please choose a service.");
  const pickStr = (k: string) => (raw?.[k] == null ? undefined : str(raw[k], 30));
  const inputs: any = { service: s };
  for (const k of ["tier", "leafVolume", "debris", "areas", "access", "disposal", "trees", "condition", "obstacles", "trimming", "walkway", "depth", "ice"]) {
    const v = pickStr(k); if (v !== undefined) inputs[k] = v;
  }
  if (raw?.lawnSqft != null) inputs.lawnSqft = Math.max(0, Math.min(500000, Number(raw.lawnSqft) || 0));
  if (raw?.salting != null) inputs.salting = !!raw.salting;
  if (Array.isArray(raw?.extras)) inputs.extras = raw.extras.slice(0, 5).map((x: unknown) => str(x, 30));
  inputs.notes = str(raw?.notes, 1000) || undefined;
  return inputs;
}

async function priceFor(c: Ctx, raw: any, address: string) {
  const inputs = cleanInputs(raw);
  const travel = address ? await travelFor(c.sb, address) : null;
  inputs.driveMinutes = travel?.driveMinutes ?? null;
  let e: any;
  try { e = estimate(inputs, c.S.pricing, c.S.costs); }
  catch (err) { throw new HttpError(400, (err as Error).message); }
  if (travel && !travel.found) {
    e.review = true;
    e.reasons = [travel.unavailable ? "We couldn't check the drive time right now — we'll confirm travel when we review" : "We couldn't find that address — we'll confirm it with you", ...e.reasons.filter((r: string) => !/Drive time/.test(r))];
  }
  return { inputs, travel, e };
}

function publicTravel(t: any) {
  if (!t) return null;
  return { found: t.found, unavailable: t.unavailable, driveMinutes: t.driveMinutes, matched: t.matched, zip: t.zip };
}

function sanitizePhotos(arr: unknown) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 8).map((p) => str(p, 200)).filter((p) => /^incoming\/[a-f0-9-]{36}\.(jpg|jpeg|png|webp|heic)$/.test(p));
}

async function slotsFor(c: Ctx, service: string, hours: number) {
  const B = c.S.business;
  const today = todayET();
  const from = addDays(today, B.minLeadDays);
  const to = addDays(today, B.bookAheadDays);
  const season = seasonWindow(c.S.pricing.seasons[service]);
  const [{ data: usage }, { data: avail }] = await Promise.all([
    c.sb.rpc("slot_usage", { p_from: from, p_to: to }),
    c.sb.from("availability").select("*").gte("date", from).lte("date", to),
  ]);
  const used = new Map((usage || []).map((u: any) => [`${u.date}:${u.time_window}`, Number(u.used)]));
  const av = new Map((avail || []).map((a: any) => [`${a.date}:${a.time_window}`, a]));
  const days: any[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (d < season.start || d > season.end) continue;
    const windows: any[] = [];
    for (const w of ["am", "pm"] as const) {
      const o = av.get(`${d}:${w}`);
      const workday = B.workDays.includes(dow(d));
      if (o?.blocked || (!workday && !(o && o.capacity_hours > 0))) continue;
      const cap = o?.capacity_hours ?? B.windows[w].capacityHours;
      const free = cap - (used.get(`${d}:${w}`) || 0);
      if (free >= hours) windows.push({ window: w, label: B.windows[w].label });
    }
    if (windows.length) days.push({ date: d, windows });
  }
  return days;
}

function blockHours(c: Ctx, estHours: number) {
  return Math.round((estHours + c.S.business.travelBufferHours) * 100) / 100;
}

async function bookingByToken(c: Ctx, token: string) {
  const t = str(token, 80);
  if (!/^[a-f0-9]{48}$/.test(t)) throw new HttpError(404, "Booking not found.");
  const { data } = await c.sb.from("bookings").select("*, customers(name,email,phone), properties(address)").eq("manage_token", t).maybeSingle();
  if (!data) throw new HttpError(404, "Booking not found.");
  return data;
}

function customerBookingView(c: Ctx, b: any) {
  return {
    ref: b.ref, service: b.service, serviceName: serviceName(b.service), status: b.status, kind: b.kind,
    date: b.service_date, window: b.time_window, windowLabel: b.time_window === "storm" ? "Next qualifying snowfall" : c.S.business.windows[b.time_window]?.label ?? null,
    quote: b.quote ? publicEstimate(b.quote) : null,
    total_cents: b.total_cents, tax_cents: b.tax_cents, deposit_cents: b.deposit_cents, paid_cents: b.paid_cents, refunded_cents: b.refunded_cents,
    due_now_cents: ["approved", "pending_payment", "confirmed", "completed", "in_progress"].includes(b.status) ? amountDueNow(b) : 0,
    address: b.properties?.address, access_notes: b.access_notes, needs_review: b.needs_review,
    cancel_requested: !!b.cancel_requested_at, reschedule_request: b.reschedule_request,
    created_at: b.created_at, completed_at: b.completed_at, photos_count: b.photos?.length || 0,
    canPay: stripeEnabled() && (["approved", "pending_payment"].includes(b.status) || (["completed", "confirmed", "in_progress"].includes(b.status) && b.total_cents - (b.paid_cents - b.refunded_cents) > 0 && b.status === "completed")),
    token: b.manage_token,
  };
}

// ---------- routes ----------
const ROUTES: Record<string, (c: Ctx) => Promise<unknown>> = {
  async health(c) {
    const { error } = await c.sb.from("settings").select("key").limit(1);
    return { ok: !error, stripe: stripeMode(), email: !!Deno.env.get("BREVO_API_KEY"), at: new Date().toISOString() };
  },

  async config(c) {
    const B = c.S.business;
    return {
      business: { name: B.name, phone: B.phone, phoneHref: B.phoneHref, email: B.email, serviceArea: B.serviceArea, googleReviewUrl: B.googleReviewUrl, windows: B.windows, cancellation: B.cancellation },
      pricing: publicPricing(c.S.pricing),
      memberships: membershipStatus(c.S),
      payments: stripeMode(),
      today: todayET(),
    };
  },

  async travel(c) {
    await rateLimit(c.sb, c.req, "travel", 60, 30);
    const address = str(c.body.address, 200);
    if (address.length < 6) throw new HttpError(400, "Please enter your full street address, town and ZIP.");
    const t = await travelFor(c.sb, address);
    const P = c.S.pricing;
    let fee = 0, review = !t.found, note = "";
    if (t.found) {
      if (t.driveMinutes! <= P.travel.freeMinutes) note = "Within our home service area — no travel fee.";
      else if (t.driveMinutes! > P.travel.reviewOverMinutes) { review = true; note = "This is outside our usual area. You can still request a quote and we'll review it."; }
      else { fee = P.travel.bands.find(([m]: number[]) => t.driveMinutes! <= m)?.[1] ?? 0; note = `About ${t.driveMinutes} minutes from Islip — a $${fee} travel fee applies.`; }
    } else note = t.unavailable ? "We couldn't check the drive time right now. You can continue — we'll confirm travel when we review." : "We couldn't match that address. Double-check it, or continue and we'll confirm.";
    return { ...publicTravel(t), fee, review, note };
  },

  async estimate(c) {
    await rateLimit(c.sb, c.req, "estimate", 60, 60);
    const { e, travel } = await priceFor(c, c.body.inputs, str(c.body.address, 200));
    return { estimate: publicEstimate(e), travel: publicTravel(travel) };
  },

  async slots(c) {
    await rateLimit(c.sb, c.req, "slots", 60, 60);
    const service = str(c.body.service || c.url.searchParams.get("service"), 10);
    if (!SERVICES.includes(service) || service === "winter") return { days: [] };
    const hours = Math.max(0.5, Math.min(8, Number(c.body.hours || c.url.searchParams.get("hours")) || 2));
    return { days: await slotsFor(c, service, blockHours(c, hours)) };
  },

  async "upload-urls"(c) {
    await rateLimit(c.sb, c.req, "upload", 3600, 40);
    const n = Math.max(1, Math.min(8, Number(c.body.count) || 1));
    const out = [];
    for (let i = 0; i < n; i++) {
      const path = `incoming/${crypto.randomUUID()}.jpg`;
      const { data, error } = await c.sb.storage.from("job-photos").createSignedUploadUrl(path);
      if (error) throw error;
      out.push({ path, token: data.token, signedUrl: data.signedUrl });
    }
    return { uploads: out };
  },

  async book(c) {
    await rateLimit(c.sb, c.req, "book", 3600, 12);
    if (c.body.website) throw new HttpError(400, "Spam check failed."); // honeypot
    const mode = c.body.mode === "quote" ? "quote" : "book";
    if (!c.body.consent?.terms) throw new HttpError(400, "Please agree to the estimate terms and policies.");
    const address = str(c.body.address, 200);
    if (address.length < 6) throw new HttpError(400, "Please enter the service address.");
    const { inputs, travel, e } = await priceFor(c, c.body.inputs, address);
    const customer = await upsertCustomer(c.sb, c.body.contact);
    const { data: prop } = await c.sb.from("properties").insert({
      customer_id: customer.id, address: travel?.matched || address, zip: travel?.zip, lat: travel?.lat, lng: travel?.lng,
      drive_minutes: travel?.driveMinutes, drive_source: travel?.found ? "census+estimate" : "unknown",
      details: inputs,
    }).select("id").single();

    const isSnow = inputs.service === "winter";
    const wantsSlot = mode === "book" && !isSnow;
    const date = str(c.body.date, 10), win = str(c.body.window, 4);
    if (wantsSlot && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !["am", "pm"].includes(win))) throw new HttpError(400, "Please choose a date and time window.");

    const canAutoPay = mode === "book" && !e.review && e.total != null && stripeEnabled();
    const status = mode === "quote" ? "quote_requested" : canAutoPay ? "pending_payment" : "pending_review";
    const reasons = [...(e.reasons || [])];
    if (mode === "book" && !e.review && !stripeEnabled()) reasons.push("Online payment not switched on yet — confirm and collect payment manually");
    if (isSnow && mode === "book") reasons.push("Snow visit request — confirm timing with the customer");

    const row: any = {
      ref: refCode(), customer_id: customer.id, property_id: prop?.id, service: inputs.service,
      kind: mode === "quote" ? "quote" : isSnow ? "storm_visit" : "one_time", status,
      time_window: isSnow && mode === "book" ? "storm" : null,
      service_date: isSnow && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
      est_hours: e.estHours ?? null, inputs, quote: e.total != null ? publicEstimate(e) : { lines: [], reasons: e.reasons },
      subtotal_cents: e.subtotal != null ? cents(e.subtotal) : null, tax_cents: e.tax != null ? cents(e.tax) : null,
      total_cents: e.total != null ? cents(e.total) : null, deposit_cents: e.deposit ? cents(e.deposit.dueNow) : null,
      needs_review: status !== "pending_payment", review_reasons: reasons,
      access_notes: str(c.body.accessNotes, 1000) || null, customer_notes: str(c.body.notes, 2000) || null,
      photos: sanitizePhotos(c.body.photos),
      hold_until: status === "pending_payment" ? new Date(Date.now() + c.S.business.holdMinutes * 60000).toISOString() : null,
      consent: { terms: true, at: new Date().toISOString(), ip: c.req.headers.get("x-forwarded-for")?.split(",")[0] ?? null, termsVersion: "2026-11" },
    };
    const { data: bk, error } = await c.sb.from("bookings").insert(row).select("*").single();
    if (error) throw error;
    if (e.internal) await c.sb.from("booking_costs").insert({ booking_id: bk.id, internal: e.internal });

    if (wantsSlot) {
      const { data: ok } = await c.sb.rpc("reserve_slot", { p_booking: bk.id, p_date: date, p_window: win, p_hours: blockHours(c, e.estHours || 2), p_default_capacity: c.S.business.windows[win].capacityHours });
      if (!ok) {
        await c.sb.from("bookings").update({ status: "pending_review", needs_review: true, review_reasons: [...reasons, `Requested ${date} ${win} was no longer available`], hold_until: null }).eq("id", bk.id);
        throw new HttpError(409, "Sorry — that time was just taken. Please pick another slot.");
      }
    }
    const { data: fresh } = await c.sb.from("bookings").select("*").eq("id", bk.id).single();

    let checkoutUrl: string | null = null;
    if (status === "pending_payment") {
      try { checkoutUrl = await createBookingCheckout(c.sb, c.S, fresh, customer, fresh.deposit_cents >= fresh.total_cents ? "full" : "deposit"); }
      catch (err) {
        await logError(c.sb, "book/checkout", err, { booking: bk.id });
        await c.sb.from("bookings").update({ status: "pending_review", needs_review: true, review_reasons: [...reasons, "Checkout could not be created"], hold_until: null }).eq("id", bk.id);
      }
    }
    const view = await c.sb.from("bookings").select("*").eq("id", bk.id).single();
    if (!checkoutUrl) await notify(c.sb, c.S, customer.email, "booking_received", { booking: view.data, name: customer.name });
    if (c.S.business.notifications.ownerNewBooking) {
      await notifyOwner(c.sb, c.S, `New ${mode === "quote" ? "quote request" : "booking"} ${bk.ref} — ${serviceName(bk.service)}`,
        `<p><b>${esc(customer.name)}</b> · ${esc(customer.phone)} · ${esc(customer.email)}<br>${esc(travel?.matched || address)}${travel?.driveMinutes != null ? ` (~${travel.driveMinutes} min)` : ""}</p>
         <p>Status: <b>${esc(view.data.status)}</b>${view.data.service_date ? ` · ${esc(fmtDate(view.data.service_date))} ${esc(view.data.time_window)}` : ""}<br>Estimate: ${money(view.data.total_cents)}</p>
         ${reasons.length ? `<p>Needs attention: ${reasons.map(esc).join("; ")}</p>` : ""}`);
    }
    return { ref: bk.ref, token: bk.manage_token, status: view.data.status, checkoutUrl };
  },

  async subscribe(c) {
    await rateLimit(c.sb, c.req, "subscribe", 3600, 10);
    if (c.body.website) throw new HttpError(400, "Spam check failed.");
    const service = str(c.body.service, 10), tier = str(c.body.tier, 10);
    if (!SERVICES.includes(service) || !["small", "medium", "large"].includes(tier)) throw new HttpError(400, "Please choose a plan and property size.");
    const ms = membershipStatus(c.S)[service];
    if (!ms.open) throw new HttpError(400, `This membership isn't available right now (${ms.reason}).`);
    if (!c.body.consent?.recurring || !c.body.consent?.terms) throw new HttpError(400, "Please confirm the recurring billing terms.");
    if (!stripeEnabled()) throw new HttpError(503, "Online sign-up isn't available yet — please call us.");
    if (service === "winter") {
      const { count } = await c.sb.from("memberships").select("id", { count: "exact", head: true }).eq("service", "winter").in("status", ["active", "trialing", "past_due"]);
      if ((count || 0) >= c.S.pricing.winterTerms.maxMembers) throw new HttpError(400, "Winter memberships are full for this season. Call us to join the waitlist.");
    }
    const address = str(c.body.address, 200);
    if (address.length < 6) throw new HttpError(400, "Please enter the service address.");
    const customer = await upsertCustomer(c.sb, c.body.contact);
    const travel = await travelFor(c.sb, address);
    if (travel.found && travel.driveMinutes! > c.S.pricing.travel.reviewOverMinutes) throw new HttpError(400, "This address is outside our membership area. Please request a custom quote instead.");
    const { data: prop } = await c.sb.from("properties").insert({ customer_id: customer.id, address: travel.matched || address, zip: travel.zip, lat: travel.lat, lng: travel.lng, drive_minutes: travel.driveMinutes, drive_source: travel.found ? "census+estimate" : "unknown" }).select("id").single();
    const q = membershipQuote(service, tier, c.S.pricing, c.S.costs);
    const { data: m, error } = await c.sb.from("memberships").insert({
      customer_id: customer.id, property_id: prop?.id, service, tier, status: "incomplete", monthly_cents: cents(q.monthly),
      consent: { recurring: true, terms: true, at: new Date().toISOString(), ip: c.req.headers.get("x-forwarded-for")?.split(",")[0] ?? null, shownMonthly: q.monthly, shownSeason: ms.season, termsVersion: "2026-11" },
    }).select("*").single();
    if (error) throw error;
    const checkoutUrl = await createMembershipCheckout(c.sb, c.S, m, customer);
    return { checkoutUrl };
  },

  async booking(c) {
    await rateLimit(c.sb, c.req, "booking-view", 60, 60);
    const b = await bookingByToken(c, c.body.token || c.url.searchParams.get("t") || "");
    return { booking: customerBookingView(c, b), business: { phone: c.S.business.phone, phoneHref: c.S.business.phoneHref, googleReviewUrl: c.S.business.googleReviewUrl } };
  },

  async "booking-action"(c) {
    await rateLimit(c.sb, c.req, "booking-action", 3600, 20);
    const b = await bookingByToken(c, c.body.token);
    const action = str(c.body.action, 30);
    const msg = str(c.body.message, 1000);
    if (action === "pay") {
      if (!stripeEnabled()) throw new HttpError(503, "Online payment isn't available yet — please call us.");
      let purpose: "deposit" | "full" | "balance";
      if (b.status === "approved" || b.status === "pending_payment") {
        if (b.service_date && b.time_window !== "storm") {
          const { data: ok } = await c.sb.rpc("reserve_slot", { p_booking: b.id, p_date: b.service_date, p_window: b.time_window, p_hours: b.block_hours || blockHours(c, b.est_hours || 2), p_default_capacity: c.S.business.windows[b.time_window]?.capacityHours ?? 4 });
          if (!ok) throw new HttpError(409, "That date is no longer available. Please call us to pick a new time.");
        }
        purpose = b.deposit_cents >= b.total_cents ? "full" : "deposit";
        if (b.paid_cents - b.refunded_cents > 0) purpose = "balance";
        await c.sb.from("bookings").update({ status: "pending_payment", hold_until: new Date(Date.now() + c.S.business.holdMinutes * 60000).toISOString() }).eq("id", b.id).in("status", ["approved", "pending_payment"]);
      } else if (b.status === "completed" && b.total_cents - (b.paid_cents - b.refunded_cents) > 0) {
        purpose = "balance";
      } else throw new HttpError(400, "There's nothing to pay on this booking right now.");
      const { data: cust } = await c.sb.from("customers").select("*").eq("id", b.customer_id).single();
      const { data: fresh } = await c.sb.from("bookings").select("*").eq("id", b.id).single();
      return { checkoutUrl: await createBookingCheckout(c.sb, c.S, fresh, cust, purpose) };
    }
    if (action === "cancel_request") {
      if (["cancelled", "completed", "expired"].includes(b.status)) throw new HttpError(400, "This booking can't be cancelled.");
      if (b.status === "quote_requested" || (b.status === "pending_review" && !(b.paid_cents > 0))) {
        await c.sb.from("bookings").update({ status: "cancelled", cancel_requested_at: new Date().toISOString(), internal_notes: `${b.internal_notes || ""}\nCustomer cancelled online: ${msg}`.trim() }).eq("id", b.id);
        await notifyOwner(c.sb, c.S, `Cancelled by customer: ${b.ref}`, `<p>${esc(b.customers?.name)} cancelled an unpaid request. ${esc(msg)}</p>`);
        return { ok: true, message: "Your request has been cancelled." };
      }
      await c.sb.from("bookings").update({ cancel_requested_at: new Date().toISOString(), internal_notes: `${b.internal_notes || ""}\nCancellation requested: ${msg}`.trim() }).eq("id", b.id);
      await notifyOwner(c.sb, c.S, `Cancellation request: ${b.ref}`, `<p>${esc(b.customers?.name)} (${esc(b.customers?.phone)}) asked to cancel ${esc(serviceName(b.service))} on ${esc(fmtDate(b.service_date))}.</p><p>${esc(msg)}</p><p>Paid so far: ${money(b.paid_cents - b.refunded_cents)}. Apply the cancellation policy and refund from the dashboard if due.</p>`);
      return { ok: true, message: "We've received your cancellation request and will confirm (and process any refund due under our policy) within one business day." };
    }
    if (action === "reschedule_request") {
      if (!msg) throw new HttpError(400, "Tell us which dates work for you.");
      await c.sb.from("bookings").update({ reschedule_request: msg }).eq("id", b.id);
      await notifyOwner(c.sb, c.S, `Reschedule request: ${b.ref}`, `<p>${esc(b.customers?.name)} (${esc(b.customers?.phone)}) asked to reschedule from ${esc(fmtDate(b.service_date))}:</p><p>${esc(msg)}</p>`);
      return { ok: true, message: "Got it — we'll confirm a new time with you shortly." };
    }
    throw new HttpError(400, "Unknown action.");
  },

  async review(c) {
    await rateLimit(c.sb, c.req, "review", 3600, 5);
    const b = await bookingByToken(c, c.body.token);
    if (b.status !== "completed") throw new HttpError(400, "Reviews open once your job is complete.");
    const rating = Math.round(Number(c.body.rating));
    if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, "Please choose a rating.");
    const body = str(c.body.body, 1500);
    if (body.length < 10) throw new HttpError(400, "Please write a sentence or two.");
    const { error } = await c.sb.from("reviews").upsert({ booking_id: b.id, name: str(c.body.name, 60) || (b.customers?.name || "Customer").split(" ")[0], town: str(c.body.town, 60) || null, rating, body, status: "pending" }, { onConflict: "booking_id" });
    if (error) throw error;
    await notifyOwner(c.sb, c.S, `New ${rating}-star review to approve`, `<p>${esc(body)}</p>`);
    return { ok: true };
  },

  async "public-content"(c) {
    const [{ data: reviews }, { data: gallery }] = await Promise.all([
      c.sb.from("reviews").select("name,town,rating,body,created_at").eq("status", "approved").order("created_at", { ascending: false }).limit(30),
      c.sb.from("gallery").select("id,before_path,after_path,service,location,completed_on,caption").eq("published", true).order("completed_on", { ascending: false }).limit(60),
    ]);
    const pub = (p: string) => c.sb.storage.from("gallery").getPublicUrl(p).data.publicUrl;
    return {
      reviews: (reviews || []).map((r) => ({ ...r, name: r.name.split(" ")[0] + (r.name.split(" ")[1] ? ` ${r.name.split(" ")[1][0]}.` : "") })),
      gallery: (gallery || []).map((g) => ({ ...g, before: pub(g.before_path), after: pub(g.after_path) })),
      googleReviewUrl: c.S.business.googleReviewUrl,
    };
  },


  // Passwordless sign-in: we generate the one-time token server-side and email the link ourselves.
  async "auth/link"(c) {
    await rateLimit(c.sb, c.req, "auth-link", 3600, 6);
    const email = str(c.body.email, 200).toLowerCase();
    if (!emailOk(email)) throw new HttpError(400, "Please enter a valid email address.");
    const target = c.body.target === "admin" ? "admin" : "account";
    if (!Deno.env.get("BREVO_API_KEY")) throw new HttpError(503, "Email sign-in isn't switched on yet. Please call us and we'll help.");
    const generic = { ok: true, message: "If that email is on file with us, a sign-in link is on its way. It works once and expires in 1 hour — check your spam folder too." };
    const [{ data: cust }, { data: adm }] = await Promise.all([
      c.sb.from("customers").select("id").eq("email", email).maybeSingle(),
      c.sb.from("admins").select("email").eq("email", email).maybeSingle(),
    ]);
    if (!cust && !adm) return generic;
    const link = await magicLink(c, email, target);
    await notify(c.sb, c.S, email, "magic", { subject: "Your sign-in link", html: `<p>Tap the button to sign in to your ${target === "admin" ? "owner dashboard" : "account"}. This link works once and expires in 1 hour.</p><p style="margin:20px 0"><a href="${esc(link)}" style="background:#1d3b2a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold;display:inline-block">Sign in</a></p><p style="font-size:12px;color:#5b6360">If you didn't ask for this, you can ignore this email.</p>` });
    return generic;
  },

  // Operator-only: one-time owner sign-in link (protected by the server-held cron secret)
  async "ops/admin-link"(c) {
    const { data: cfg } = await c.sb.from("settings").select("value").eq("key", "cron").maybeSingle();
    const secret = Deno.env.get("CRON_SECRET") || cfg?.value?.secret;
    if (!secret || (c.req.headers.get("x-cron-secret") || "") !== secret) throw new HttpError(401, "no");
    const email = str(c.body.email, 200).toLowerCase();
    const { data: adm } = await c.sb.from("admins").select("email").eq("email", email).maybeSingle();
    if (!adm) throw new HttpError(400, "not an admin");
    return { link: await magicLink(c, email, "admin") };
  },

  // ----- signed-in customer -----
  async me(c) {
    const u = await requireUser(c);
    const email = u.email!.toLowerCase();
    let { data: cust } = await c.sb.from("customers").select("*").eq("email", email).maybeSingle();
    if (cust && !cust.user_id) await c.sb.from("customers").update({ user_id: u.id }).eq("id", cust.id);
    if (!cust) return { customer: { email }, bookings: [], memberships: [], payments: [], properties: [] };
    const [b, m, p, pr] = await Promise.all([
      c.sb.from("bookings").select("*, properties(address)").eq("customer_id", cust.id).order("created_at", { ascending: false }).limit(100),
      c.sb.from("memberships").select("id,service,tier,status,monthly_cents,current_period_end,cancel_at,cancel_at_period_end,created_at,properties(address)").eq("customer_id", cust.id).not("status", "eq", "incomplete").order("created_at", { ascending: false }),
      c.sb.from("payments").select("kind,method,amount_cents,refunded_cents,status,receipt_url,created_at,booking_id").eq("customer_id", cust.id).order("created_at", { ascending: false }).limit(100),
      c.sb.from("properties").select("id,address,drive_minutes,details,created_at").eq("customer_id", cust.id).order("created_at", { ascending: false }),
    ]);
    const refs = new Map((b.data || []).map((x: any) => [x.id, x.ref]));
    return {
      customer: { name: cust.name, email: cust.email, phone: cust.phone, hasBilling: !!cust.stripe_customer_id },
      bookings: (b.data || []).map((x: any) => customerBookingView(c, x)),
      memberships: (m.data || []).map((x: any) => ({ ...x, serviceName: serviceName(x.service), address: x.properties?.address })),
      payments: (p.data || []).map((x: any) => ({ ...x, ref: refs.get(x.booking_id) || null, booking_id: undefined })),
      properties: pr.data || [],
    };
  },

  async portal(c) {
    const u = await requireUser(c);
    const { data: cust } = await c.sb.from("customers").select("*").eq("email", u.email!.toLowerCase()).maybeSingle();
    if (!cust?.stripe_customer_id) throw new HttpError(400, "No billing account yet.");
    const s = await stripe("POST", "/billing_portal/sessions", { customer: cust.stripe_customer_id, return_url: `${c.S.business.siteUrl}/account/`, configuration: c.S.stripe.portalConfig || undefined });
    return { url: s.url };
  },

  async "membership-cancel"(c) {
    const u = await requireUser(c);
    const { data: cust } = await c.sb.from("customers").select("id,email,name").eq("email", u.email!.toLowerCase()).maybeSingle();
    const { data: m } = await c.sb.from("memberships").select("*").eq("id", str(c.body.id, 40)).maybeSingle();
    if (!cust || !m || m.customer_id !== cust.id) throw new HttpError(404, "Membership not found.");
    if (!m.stripe_subscription_id) throw new HttpError(400, "This membership isn't active.");
    await stripe("POST", `/subscriptions/${m.stripe_subscription_id}`, { cancel_at_period_end: true, proration_behavior: "none" });
    const { membership } = await syncSubscription(c.sb, m.stripe_subscription_id);
    await notify(c.sb, c.S, cust.email, "sub_cancel_scheduled", { name: cust.name, service: m.service, endsOn: fmtDate(membership?.current_period_end?.slice(0, 10)) });
    await notifyOwner(c.sb, c.S, `Membership cancelled by customer`, `<p>${esc(cust.name)} cancelled their ${esc(serviceName(m.service))} membership (ends at period end).</p>`);
    return { ok: true };
  },

  // ----- admin -----
  async "admin/whoami"(c) { const u = await requireAdmin(c); return { email: u.email, stripe: stripeMode(), email_provider: !!Deno.env.get("BREVO_API_KEY") }; },

  async "admin/overview"(c) {
    await requireAdmin(c);
    const today = todayET();
    const monthStart = today.slice(0, 8) + "01";
    const [todayJobs, upcoming, pending, payments, subs, cancelled, openBal, errs] = await Promise.all([
      c.sb.from("bookings").select("id,ref,service,status,time_window,service_date,weather_flag,customers(name,phone),properties(address)").eq("service_date", today).in("status", ["confirmed", "in_progress", "approved"]),
      c.sb.from("bookings").select("id,ref,service,status,time_window,service_date,weather_flag,customers(name)").gt("service_date", today).lte("service_date", addDays(today, 14)).in("status", ["confirmed", "approved", "pending_review", "pending_payment"]).order("service_date"),
      c.sb.from("bookings").select("id,ref,service,status,created_at,review_reasons,cancel_requested_at,reschedule_request,customers(name)").or("status.in.(quote_requested,pending_review),cancel_requested_at.not.is.null,reschedule_request.not.is.null").not("status", "in", "(cancelled,expired,completed)").order("created_at", { ascending: false }).limit(50),
      c.sb.from("payments").select("amount_cents,fee_cents,refunded_cents,kind,method,status,created_at,customers(name)").order("created_at", { ascending: false }).limit(10),
      c.sb.from("memberships").select("service,status", { count: "exact" }).in("status", ["active", "trialing", "past_due"]),
      c.sb.from("bookings").select("id", { count: "exact", head: true }).eq("status", "cancelled").gte("updated_at", monthStart),
      c.sb.from("bookings").select("total_cents,paid_cents,refunded_cents").in("status", ["completed", "confirmed", "in_progress"]),
      c.sb.from("error_log").select("at,source,message").order("at", { ascending: false }).limit(5),
    ]);
    const { data: monthPay } = await c.sb.from("payments").select("amount_cents,refunded_cents").eq("status", "succeeded").gte("created_at", monthStart);
    const outstanding = (openBal.data || []).reduce((a: number, b: any) => a + Math.max(0, (b.total_cents || 0) - (b.paid_cents - b.refunded_cents)), 0);
    return {
      today, todayJobs: todayJobs.data, upcoming: upcoming.data, pending: pending.data, recentPayments: payments.data,
      activeSubscriptions: subs.count || 0, subsByService: (subs.data || []).reduce((a: any, s: any) => ({ ...a, [s.service]: (a[s.service] || 0) + 1 }), {}),
      monthRevenueCents: (monthPay || []).reduce((a, p) => a + p.amount_cents - (p.refunded_cents || 0), 0),
      outstandingCents: outstanding, cancelledThisMonth: cancelled.count || 0, recentErrors: errs.data,
      setup: { stripe: stripeMode(), email: !!Deno.env.get("BREVO_API_KEY"), products: !!S_products(c), googleReviewUrl: !!c.S.business.googleReviewUrl },
    };
  },

  async "admin/bookings"(c) {
    await requireAdmin(c);
    let q = c.sb.from("bookings").select("id,ref,service,kind,status,service_date,time_window,total_cents,paid_cents,refunded_cents,needs_review,weather_flag,cancel_requested_at,reschedule_request,created_at,customers(name,phone,email),properties(address,drive_minutes)").order("created_at", { ascending: false }).limit(300);
    const st = str(c.body.status, 30);
    if (st && st !== "all") q = st === "active" ? q.not("status", "in", "(cancelled,expired,completed)") : q.eq("status", st);
    const s = str(c.body.search, 80);
    if (s) q = q.or(`ref.ilike.%${s.replace(/[%,()]/g, "")}%`);
    const { data } = await q;
    return { bookings: data };
  },

  async "admin/booking"(c) {
    await requireAdmin(c);
    const id = str(c.body.id, 40);
    const { data: b } = await c.sb.from("bookings").select("*, customers(*), properties(*)").eq("id", id).single();
    const [{ data: costs }, { data: pays }, { data: notes }] = await Promise.all([
      c.sb.from("booking_costs").select("internal").eq("booking_id", id).maybeSingle(),
      c.sb.from("payments").select("*").eq("booking_id", id).order("created_at"),
      c.sb.from("notifications").select("template,subject,status,error,created_at,to_email").eq("booking_id", id).order("created_at"),
    ]);
    const sign = async (paths: string[]) => Promise.all((paths || []).map(async (p) => (await c.sb.storage.from("job-photos").createSignedUrl(p, 3600)).data?.signedUrl));
    return { booking: b, costs: costs?.internal, payments: pays, notifications: notes, photoUrls: await sign(b.photos), afterPhotoUrls: await sign(b.after_photos) };
  },

  async "admin/booking-update"(c) {
    await requireAdmin(c);
    const id = str(c.body.id, 40);
    const { data: b } = await c.sb.from("bookings").select("*, customers(*), properties(*)").eq("id", id).single();
    if (!b) throw new HttpError(404, "Not found");
    const patch: any = {};
    const f = c.body.fields || {};
    for (const k of ["internal_notes", "assigned_to", "access_notes"]) if (k in f) patch[k] = str(f[k], 4000) || null;
    if ("weather_flag" in f) patch.weather_flag = f.weather_flag ? str(f.weather_flag, 300) : null;
    if ("reschedule_request" in f) patch.reschedule_request = f.reschedule_request ? str(f.reschedule_request, 1000) : null;
    if ("cancel_requested_at" in f && !f.cancel_requested_at) patch.cancel_requested_at = null;
    if (Array.isArray(f.after_photos)) patch.after_photos = f.after_photos.slice(0, 12).map((p: unknown) => str(p, 200)).filter((p: string) => /^(incoming|after)\//.test(p));

    // Re-price with owner overrides (travel and/or a manual price). Overrides below margin need explicit confirmation.
    if (f.reprice || f.priceOverride != null || f.travelOverride != null) {
      const inputs = { ...b.inputs, driveMinutes: b.properties?.drive_minutes ?? b.inputs.driveMinutes };
      if (f.travelOverride != null) inputs.travelOverride = Math.max(0, Number(f.travelOverride));
      let e: any = estimate(inputs, c.S.pricing, c.S.costs);
      if (f.priceOverride != null) {
        const pre = Math.max(0, Number(f.priceOverride));
        const { costOf } = await import("../_shared/pricing.js");
        const internal = costOf({ service: b.service, crewHours: e.internal?.crewHours ?? b.est_hours ?? 2, materials: e.internal?.materials ?? 0, disposal: e.internal?.disposal ?? 0, driveMinutes: inputs.driveMinutes, total: pre }, c.S.costs);
        if (internal.marginPercent < c.S.costs.minMarginPercent && !f.confirmBelowMargin) {
          return { needsConfirm: true, message: `At $${pre} this job's estimated margin is ${internal.marginPercent}% (your minimum is ${c.S.costs.minMarginPercent}%). Approve anyway?`, internal };
        }
        const tax = c.S.pricing.salesTax.enabled ? Math.round(pre * c.S.pricing.salesTax.percent) / 100 : 0;
        const { depositFor } = await import("../_shared/pricing.js");
        e = { ...e, lines: [{ label: `${serviceName(b.service)} (custom quote)`, amount: pre }], subtotal: pre, tax, total: Math.round((pre + tax) * 100) / 100, deposit: depositFor(pre + tax, c.S.pricing), internal: { ...internal, ownerApprovedBelowMargin: internal.marginPercent < c.S.costs.minMarginPercent } };
      }
      if (e.total == null) throw new HttpError(400, "This job needs a custom price — enter one.");
      Object.assign(patch, { quote: publicEstimate(e), subtotal_cents: cents(e.subtotal), tax_cents: cents(e.tax), total_cents: cents(e.total), deposit_cents: cents(e.deposit.dueNow), est_hours: e.estHours ?? b.est_hours });
      if (e.internal) await c.sb.from("booking_costs").upsert({ booking_id: id, internal: e.internal, updated_at: new Date().toISOString() });
      if (f.estHours != null) patch.est_hours = Math.max(0.25, Number(f.estHours));
    }

    // Date / window change
    let rescheduled = false;
    if (f.service_date !== undefined || f.time_window !== undefined) {
      const date = f.service_date || b.service_date, win = f.time_window || b.time_window;
      if (date && win && win !== "storm") {
        const { data: ok } = await c.sb.rpc("reserve_slot", { p_booking: id, p_date: date, p_window: win, p_hours: blockHours(c, patch.est_hours ?? b.est_hours ?? 2), p_default_capacity: c.S.business.windows[win]?.capacityHours ?? 4 });
        if (!ok && !f.forceSlot) return { needsConfirm: true, message: "That window is full or blocked. Book it anyway (overbook)?" };
        if (!ok) Object.assign(patch, { service_date: date, time_window: win });
      } else Object.assign(patch, { service_date: date || null, time_window: win || null });
      rescheduled = !!b.service_date && (date !== b.service_date || win !== b.time_window);
    }

    const prevStatus = b.status;
    if (f.status && f.status !== b.status) {
      const allowed = ["quote_requested", "pending_review", "approved", "confirmed", "in_progress", "completed", "cancelled"];
      if (!allowed.includes(f.status)) throw new HttpError(400, "Bad status");
      patch.status = f.status;
      if (f.status === "approved") { patch.needs_review = false; patch.hold_until = null; }
      if (f.status === "confirmed") patch.needs_review = false;
      if (f.status === "completed") patch.completed_at = new Date().toISOString();
      if (f.status === "cancelled") { patch.block_hours = 0; patch.cancel_requested_at = null; }
    }
    const { data: nb, error } = await c.sb.from("bookings").update(patch).eq("id", id).select("*").single();
    if (error) throw error;
    const cust = b.customers;
    if (patch.status === "approved" && prevStatus !== "approved" && f.notify !== false) await notify(c.sb, c.S, cust.email, "booking_approved", { booking: nb, name: cust.name });
    if (rescheduled && f.notify !== false) await notify(c.sb, c.S, cust.email, "rescheduled", { booking: nb, name: cust.name, reason: str(f.reason, 300) });
    if (patch.status === "completed" && f.notify !== false) { await notify(c.sb, c.S, cust.email, "completed", { booking: nb, name: cust.name }); await c.sb.from("bookings").update({ review_requested_at: new Date().toISOString() }).eq("id", id); }
    if (f.weatherMessage && f.notify !== false) await notify(c.sb, c.S, cust.email, "weather_change", { booking: nb, name: cust.name, message: str(f.weatherMessage, 600) });
    return { ok: true, booking: nb };
  },

  async "admin/booking-create"(c) {
    // Manual entry for phone customers. Price from the engine, optional custom price.
    await requireAdmin(c);
    const address = str(c.body.address, 200);
    const { inputs, travel, e } = await priceFor(c, c.body.inputs, address);
    const customer = await upsertCustomer(c.sb, c.body.contact);
    const { data: prop } = await c.sb.from("properties").insert({ customer_id: customer.id, address: travel?.matched || address, zip: travel?.zip, lat: travel?.lat, lng: travel?.lng, drive_minutes: travel?.driveMinutes, drive_source: travel?.found ? "census+estimate" : "unknown", details: inputs }).select("id").single();
    const { data: bk, error } = await c.sb.from("bookings").insert({
      ref: refCode(), customer_id: customer.id, property_id: prop?.id, service: inputs.service, kind: "manual", status: "pending_review",
      est_hours: e.estHours ?? 2, inputs, quote: e.total != null ? publicEstimate(e) : { lines: [] },
      subtotal_cents: e.subtotal != null ? cents(e.subtotal) : null, tax_cents: e.tax != null ? cents(e.tax) : null, total_cents: e.total != null ? cents(e.total) : null,
      deposit_cents: e.deposit ? cents(e.deposit.dueNow) : null, needs_review: true, review_reasons: ["Entered by owner"], customer_notes: str(c.body.notes, 2000) || null,
      consent: { enteredBy: "owner", at: new Date().toISOString() },
    }).select("*").single();
    if (error) throw error;
    if (e.internal) await c.sb.from("booking_costs").insert({ booking_id: bk.id, internal: e.internal });
    return { id: bk.id, ref: bk.ref };
  },

  async "admin/payment-manual"(c) {
    await requireAdmin(c);
    const id = str(c.body.booking_id, 40);
    const amount = cents(Number(c.body.amount));
    const method = ["cash", "check", "other"].includes(c.body.method) ? c.body.method : "cash";
    if (!(amount > 0)) throw new HttpError(400, "Enter an amount.");
    const { data: b } = await c.sb.from("bookings").select("customer_id,status,paid_cents").eq("id", id).single();
    await c.sb.from("payments").insert({ booking_id: id, customer_id: b.customer_id, kind: b.paid_cents > 0 ? "balance" : "full", method, amount_cents: amount, status: "succeeded", note: str(c.body.note, 300) || null });
    const nb = await recalcPaid(c.sb, id);
    if (["approved", "pending_review", "pending_payment"].includes(b.status)) await c.sb.from("bookings").update({ status: "confirmed", needs_review: false, hold_until: null }).eq("id", id);
    return { ok: true, booking: nb };
  },

  async "admin/refund"(c) {
    await requireAdmin(c);
    const { data: p } = await c.sb.from("payments").select("*").eq("id", str(c.body.payment_id, 40)).single();
    if (!p) throw new HttpError(404, "Payment not found");
    const amount = cents(Number(c.body.amount));
    const refundable = p.amount_cents - p.refunded_cents;
    if (!(amount > 0 && amount <= refundable)) throw new HttpError(400, `Refund must be between $0.01 and ${money(refundable)}.`);
    if (p.method === "card") {
      if (!p.stripe_object_id?.startsWith("pi_")) throw new HttpError(400, "Refund subscription invoices from the Stripe dashboard.");
      await stripe("POST", "/refunds", { payment_intent: p.stripe_object_id, amount, reason: "requested_by_customer", metadata: { asycli_payment_id: p.id } }, `refund-${p.id}-${p.refunded_cents}-${amount}`);
    }
    await c.sb.from("payments").update({ refunded_cents: p.refunded_cents + amount }).eq("id", p.id);
    if (p.booking_id) await recalcPaid(c.sb, p.booking_id);
    return { ok: true, message: p.method === "card" ? "Refund sent to the customer's card (usually arrives in 5–10 business days)." : "Refund recorded. Return the cash/check to the customer yourself." };
  },

  async "admin/send-pay-link"(c) {
    await requireAdmin(c);
    const { data: b } = await c.sb.from("bookings").select("*, customers(*)").eq("id", str(c.body.id, 40)).single();
    if (!["approved", "completed", "confirmed", "pending_payment"].includes(b.status)) throw new HttpError(400, "Approve the booking first.");
    await notify(c.sb, c.S, b.customers.email, b.status === "completed" ? "completed" : "booking_approved", { booking: b, name: b.customers.name });
    return { ok: true, link: manageUrl(c.S, b) };
  },

  async "admin/customers"(c) {
    await requireAdmin(c);
    const s = str(c.body.search, 80).replace(/[%,()]/g, "");
    let q = c.sb.from("customers").select("id,name,email,phone,created_at,notes").order("created_at", { ascending: false }).limit(300);
    if (s) q = q.or(`name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`);
    return { customers: (await q).data };
  },

  async "admin/customer"(c) {
    await requireAdmin(c);
    const id = str(c.body.id, 40);
    if (c.body.notes !== undefined) await c.sb.from("customers").update({ notes: str(c.body.notes, 4000) }).eq("id", id);
    const [cu, b, m, p, pr] = await Promise.all([
      c.sb.from("customers").select("*").eq("id", id).single(),
      c.sb.from("bookings").select("id,ref,service,status,service_date,total_cents,paid_cents,refunded_cents,created_at").eq("customer_id", id).order("created_at", { ascending: false }),
      c.sb.from("memberships").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
      c.sb.from("payments").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
      c.sb.from("properties").select("*").eq("customer_id", id),
    ]);
    return { customer: cu.data, bookings: b.data, memberships: m.data, payments: p.data, properties: pr.data };
  },

  async "admin/memberships"(c) {
    await requireAdmin(c);
    const { data } = await c.sb.from("memberships").select("*, customers(name,email,phone), properties(address)").not("status", "eq", "incomplete").order("created_at", { ascending: false });
    const quotes: any = {};
    for (const s of SERVICES) for (const t of ["small", "medium", "large"]) { try { quotes[`${s}:${t}`] = membershipQuote(s, t, c.S.pricing, c.S.costs); } catch (_) { /* */ } }
    return { memberships: data, quotes, status: membershipStatus(c.S), active: c.S.business.membershipsActive };
  },

  async "admin/storm-visit"(c) {
    // Log a snow visit for a member. Included visits are tracked per month; extras are charged to the saved card.
    await requireAdmin(c);
    const { data: m } = await c.sb.from("memberships").select("*, customers(*)").eq("id", str(c.body.id, 40)).single();
    if (!m || !["active", "past_due"].includes(m.status)) throw new HttpError(400, "Membership is not active.");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(c.body.date) ? c.body.date : todayET();
    const month = date.slice(0, 7);
    const used = { ...(m.storm_visits_used || {}) };
    used[month] = (used[month] || 0) + 1;
    const included = c.S.pricing.winterTerms.includedVisitsPerMonth;
    let charged = 0;
    const salting = !!c.body.salting && !c.S.pricing.winterTerms.saltingIncluded;
    const T = c.S.pricing.winter;
    let pre = 0;
    if (used[month] > included) pre += T.driveway[m.tier] * (1 - c.S.pricing.winterTerms.extraVisitDiscountPercent / 100);
    if (salting) pre += T.salting[m.tier];
    pre = Math.round(pre * 100) / 100;
    if (pre > 0) {
      if (!stripeEnabled()) throw new HttpError(503, "Stripe isn't connected — record this charge manually.");
      const sub = await stripe("GET", `/subscriptions/${m.stripe_subscription_id}`);
      const custId = m.customers.stripe_customer_id;
      const inv = await stripe("POST", "/invoices", {
        customer: custId, collection_method: "charge_automatically", auto_advance: true, pending_invoice_items_behavior: "exclude",
        default_payment_method: sub.default_payment_method || undefined,
        description: `Snow visit ${date}`, metadata: { membership_id: m.id, kind: "storm_visit", date },
      }, `storm-inv-${m.id}-${date}-${used[month]}`);
      await stripe("POST", "/invoiceitems", {
        customer: custId, invoice: inv.id, amount: cents(pre), currency: "usd",
        description: `${used[month] > included ? "Extra snow visit (member rate)" : ""}${used[month] > included && salting ? " + " : ""}${salting ? "Salting" : ""} — ${date}`,
        tax_rates: c.S.stripe.taxRateId && c.S.pricing.salesTax.enabled ? [c.S.stripe.taxRateId] : undefined,
      }, `storm-ii-${m.id}-${date}-${used[month]}`);
      await stripe("POST", `/invoices/${inv.id}/finalize`, {}, `storm-fin-${inv.id}`);
      try { await stripe("POST", `/invoices/${inv.id}/pay`, {}, `storm-pay-${inv.id}`); } catch (err) { await logError(c.sb, "storm-pay", err, { inv: inv.id }); }
      charged = cents(pre);
      await notify(c.sb, c.S, m.customers.email, "storm_charge", { name: m.customers.name, date: fmtDate(date), amount: charged });
    }
    await c.sb.from("memberships").update({ storm_visits_used: used }).eq("id", m.id);
    return { ok: true, visitsThisMonth: used[month], included, chargedCents: charged };
  },

  async "admin/settings"(c) {
    await requireAdmin(c);
    if (c.body.save) {
      for (const key of ["pricing", "costs", "business"]) {
        if (c.body.save[key]) {
          const v = c.body.save[key];
          if (typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, `Bad ${key}`);
          await c.sb.from("settings").upsert({ key, value: v, updated_at: new Date().toISOString() });
        }
      }
      return { ok: true };
    }
    return { pricing: c.S.pricing, costs: c.S.costs, business: c.S.business, defaults: { pricing: DEFAULT_PRICING, costs: DEFAULT_COSTS }, stripe: { ...c.S.stripe, webhookSecrets: undefined, mode: stripeMode() } };
  },

  async "admin/preview-estimate"(c) {
    await requireAdmin(c);
    const inputs = cleanInputs(c.body.inputs);
    inputs.driveMinutes = Number(c.body.driveMinutes ?? 20);
    try { return { estimate: estimate(inputs, c.S.pricing, c.S.costs) }; } catch (e) { throw new HttpError(400, (e as Error).message); }
  },

  async "admin/availability"(c) {
    await requireAdmin(c);
    if (Array.isArray(c.body.set)) {
      for (const r of c.body.set.slice(0, 120)) {
        const date = str(r.date, 10), w = str(r.time_window, 2);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !["am", "pm"].includes(w)) continue;
        if (r.clear) await c.sb.from("availability").delete().eq("date", date).eq("time_window", w);
        else await c.sb.from("availability").upsert({ date, time_window: w, blocked: !!r.blocked, capacity_hours: r.capacity_hours == null || r.capacity_hours === "" ? null : Number(r.capacity_hours), note: str(r.note, 200) || null });
      }
    }
    const from = str(c.body.from, 10) || todayET();
    const to = addDays(from, 41);
    const [{ data: av }, { data: usage }, { data: jobs }] = await Promise.all([
      c.sb.from("availability").select("*").gte("date", from).lte("date", to),
      c.sb.rpc("slot_usage", { p_from: from, p_to: to }),
      c.sb.from("bookings").select("id,ref,service,status,service_date,time_window,block_hours,customers(name)").gte("service_date", from).lte("service_date", to).not("status", "in", "(cancelled,expired)"),
    ]);
    return { from, to, overrides: av, usage, jobs, defaults: { windows: c.S.business.windows, workDays: c.S.business.workDays } };
  },

  async "admin/finance"(c) {
    await requireAdmin(c);
    const from = str(c.body.from, 10) || `${todayET().slice(0, 4)}-01-01`;
    const [{ data: pays }, { data: done }] = await Promise.all([
      c.sb.from("payments").select("amount_cents,fee_cents,refunded_cents,kind,method,status,created_at,booking_id,membership_id").eq("status", "succeeded").gte("created_at", from),
      c.sb.from("bookings").select("id,service,total_cents,subtotal_cents,tax_cents,completed_at,booking_costs(internal)").eq("status", "completed").gte("completed_at", from),
    ]);
    const { data: mems } = await c.sb.from("memberships").select("id,service");
    const memSvc = new Map((mems || []).map((m) => [m.id, m.service]));
    const { data: bks } = await c.sb.from("bookings").select("id,service").in("id", (pays || []).map((p) => p.booking_id).filter(Boolean));
    const bkSvc = new Map((bks || []).map((b) => [b.id, b.service]));
    const gross = (pays || []).reduce((a, p) => a + p.amount_cents, 0);
    const refunds = (pays || []).reduce((a, p) => a + (p.refunded_cents || 0), 0);
    const fees = (pays || []).reduce((a, p) => a + (p.fee_cents || 0), 0);
    const subs = (pays || []).filter((p) => p.kind === "subscription" || p.kind === "storm_visit").reduce((a, p) => a + p.amount_cents, 0);
    const bySeason: any = { spring: 0, summer: 0, fall: 0, winter: 0 };
    for (const p of pays || []) { const s = p.booking_id ? bkSvc.get(p.booking_id) : memSvc.get(p.membership_id); if (s) bySeason[s] += p.amount_cents - (p.refunded_cents || 0); }
    const taxCollected = (done || []).reduce((a, b) => a + (b.tax_cents || 0), 0);
    const estCost = (done || []).reduce((a, b: any) => a + Math.round((b.booking_costs?.internal?.totalCost || 0) * 100), 0);
    const doneRevenuePreTax = (done || []).reduce((a, b) => a + (b.subtotal_cents || 0), 0);
    return {
      from, grossCents: gross, refundsCents: refunds, feesCents: fees, netCollectedCents: gross - refunds - fees, subscriptionCents: subs, bySeason,
      completedJobs: (done || []).length, completedRevenuePreTaxCents: doneRevenuePreTax, salesTaxOnCompletedCents: taxCollected,
      estimatedJobCostsCents: estCost, estimatedJobProfitCents: doneRevenuePreTax - estCost,
      note: "Gross is money collected, not profit. Job profit uses your cost settings and is an estimate. Sales tax collected belongs to New York State. Card fees fill in automatically after each payment settles.",
    };
  },

  async "admin/gallery"(c) {
    await requireAdmin(c);
    if (c.body.add) {
      const g = c.body.add;
      const ok = (p: string) => /^g\/[a-f0-9-]{36}\.jpg$/.test(p);
      if (!ok(g.before_path) || !ok(g.after_path) || !SERVICES.includes(g.service)) throw new HttpError(400, "Upload both photos and choose a service.");
      await c.sb.from("gallery").insert({ before_path: g.before_path, after_path: g.after_path, service: g.service, location: str(g.location, 80) || null, completed_on: /^\d{4}-\d{2}-\d{2}$/.test(g.completed_on) ? g.completed_on : null, caption: str(g.caption, 200) || null });
    }
    if (c.body.remove) await c.sb.from("gallery").delete().eq("id", str(c.body.remove, 40));
    if (c.body.uploadUrls) {
      const out = [];
      for (let i = 0; i < 2; i++) { const path = `g/${crypto.randomUUID()}.jpg`; const { data } = await c.sb.storage.from("gallery").createSignedUploadUrl(path); out.push({ path, token: data!.token }); }
      return { uploads: out };
    }
    if (c.body.afterUploadUrls) {
      const out = [];
      for (let i = 0; i < Math.min(8, Number(c.body.afterUploadUrls) || 1); i++) { const path = `after/${crypto.randomUUID()}.jpg`; const { data } = await c.sb.storage.from("job-photos").createSignedUploadUrl(path); out.push({ path, token: data!.token }); }
      return { uploads: out };
    }
    const { data } = await c.sb.from("gallery").select("*").order("created_at", { ascending: false });
    return { items: (data || []).map((g) => ({ ...g, before: c.sb.storage.from("gallery").getPublicUrl(g.before_path).data.publicUrl, after: c.sb.storage.from("gallery").getPublicUrl(g.after_path).data.publicUrl })) };
  },

  async "admin/reviews"(c) {
    await requireAdmin(c);
    if (c.body.id && ["approved", "hidden", "pending"].includes(c.body.status)) await c.sb.from("reviews").update({ status: c.body.status }).eq("id", c.body.id);
    const { data } = await c.sb.from("reviews").select("*").order("created_at", { ascending: false }).limit(200);
    return { reviews: data };
  },

  async "admin/notifications"(c) {
    await requireAdmin(c);
    if (c.body.retry) {
      const { data: n } = await c.sb.from("notifications").select("*").eq("id", str(c.body.retry, 40)).single();
      if (n) await deliver(c.sb, c.S, n.id, n.to_email, { subject: n.subject, html: n.body_html });
    }
    const { data } = await c.sb.from("notifications").select("id,to_email,template,subject,status,error,created_at,sent_at").order("created_at", { ascending: false }).limit(100);
    return { notifications: data, provider: !!Deno.env.get("BREVO_API_KEY") };
  },

  async "admin/weather"(c) {
    await requireAdmin(c);
    return await weatherCheck(c, false);
  },

  async "admin/stripe-setup"(c) {
    // Idempotent: reuses existing ASYCLI products/tax rate (found by metadata) instead of creating duplicates.
    await requireAdmin(c);
    if (!stripeEnabled()) throw new HttpError(400, "Add the Stripe secret key first.");
    return await stripeSetup(c);
  },

  async cron(c) {
    const { data: cfg } = await c.sb.from("settings").select("value").eq("key", "cron").maybeSingle();
    const secret = Deno.env.get("CRON_SECRET") || cfg?.value?.secret;
    if (!secret || (c.req.headers.get("x-cron-secret") || "") !== secret) throw new HttpError(401, "no");
    const today = todayET();
    const hourET = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date()));
    const out: any = { hourET };
    // 1. expire stale holds (queries already ignore them; this tidies status)
    const { data: expired } = await c.sb.from("bookings").update({ status: "expired", block_hours: 0 }).eq("status", "pending_payment").lt("hold_until", new Date(Date.now() - 10 * 60000).toISOString()).eq("paid_cents", 0).select("id");
    out.expired = expired?.length || 0;
    // 2. reminders for tomorrow
    if (c.S.business.notifications.customerReminders && hourET >= 9 && hourET <= 19) {
      const { data: tm } = await c.sb.from("bookings").select("*, customers(name,email)").eq("service_date", addDays(today, 1)).eq("status", "confirmed").is("reminder_sent_at", null);
      for (const b of tm || []) { await notify(c.sb, c.S, b.customers.email, "reminder", { booking: b, name: b.customers.name, when: "tomorrow" }); await c.sb.from("bookings").update({ reminder_sent_at: new Date().toISOString() }).eq("id", b.id); }
      out.reminders = tm?.length || 0;
    }
    // 3. weather flags (never fatal)
    if (c.S.business.notifications.weatherAlerts && (hourET === 6 || c.body.force)) {
      try { out.weather = await weatherCheck(c, true); } catch (e) { await logError(c.sb, "cron/weather", e); }
    }
    // 4. retry failed/queued emails from the last day once
    const { data: q } = await c.sb.from("notifications").select("*").in("status", ["queued", "failed"]).gte("created_at", new Date(Date.now() - 86400000).toISOString()).limit(20);
    for (const n of q || []) await deliver(c.sb, c.S, n.id, n.to_email, { subject: n.subject, html: n.body_html });
    // 5. trim rate limit table
    await c.sb.from("rate_limits").delete().lt("window_start", new Date(Date.now() - 86400000).toISOString());
    return out;
  },
};


async function magicLink(c: Ctx, email: string, target: "admin" | "account") {
  // make sure an auth user exists (customers who booked as guests get one on first sign-in)
  const { error: ce } = await c.sb.auth.admin.createUser({ email, email_confirm: true });
  if (ce && !/already|exists|registered/i.test(ce.message)) throw ce;
  const { data, error } = await c.sb.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  return `${c.S.business.siteUrl}/${target}/?th=${encodeURIComponent(data.properties.hashed_token)}`;
}

function S_products(c: Ctx) { return c.S.stripe.mode === stripeMode() && c.S.stripe.products && Object.keys(c.S.stripe.products).length === 4; }

async function weatherCheck(c: Ctx, alert: boolean) {
  const today = todayET();
  const { data: jobs } = await c.sb.from("bookings").select("id,ref,service,service_date,time_window,weather_flag,customers(name),properties(lat,lng,address)").gte("service_date", today).lte("service_date", addDays(today, 6)).in("status", ["confirmed", "approved"]);
  const ISLIP = { lat: 40.7298, lng: -73.2104 };
  const fetchWx = async (lat: number, lng: number) => {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=precipitation_sum,precipitation_probability_max,snowfall_sum,wind_gusts_10m_max,temperature_2m_min&timezone=America%2FNew_York&forecast_days=7&precipitation_unit=inch&wind_speed_unit=mph`;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    try { const r = await fetch(u, { signal: ctl.signal }); if (!r.ok) return null; return await r.json(); } catch (_) { return null; } finally { clearTimeout(t); }
  };
  const area = await fetchWx(ISLIP.lat, ISLIP.lng);
  if (!area) return { ok: false, message: "Weather service unavailable right now — nothing was changed.", flagged: [] };
  const d = area.daily;
  const days = d.time.map((t: string, i: number) => ({ date: t, rainIn: d.precipitation_sum[i], rainChance: d.precipitation_probability_max[i], snowIn: Math.round((d.snowfall_sum[i] / 2.54) * 10) / 10, gustMph: d.wind_gusts_10m_max[i], lowF: d.temperature_2m_min[i] }));
  // Open-Meteo snowfall_sum is in cm regardless of precipitation unit → converted above
  const byDate = new Map(days.map((x: any) => [x.date, x]));
  const flagged: any[] = [];
  for (const j of jobs || []) {
    const w: any = byDate.get(j.service_date);
    if (!w) continue;
    let flag = "";
    if (j.service !== "winter") {
      if (w.rainChance >= 70 && w.rainIn >= 0.4) flag = `Heavy rain likely (${w.rainChance}% · ${w.rainIn}")`;
      else if (w.gustMph >= 40) flag = `High winds (gusts ${w.gustMph} mph)`;
      else if (w.snowIn >= 1) flag = `Snow expected (${w.snowIn}")`;
    }
    if (flag !== (j.weather_flag || "")) await c.sb.from("bookings").update({ weather_flag: flag || null }).eq("id", j.id);
    if (flag) flagged.push({ ref: j.ref, id: j.id, date: j.service_date, customer: (j as any).customers?.name, flag });
  }
  const trigger = c.S.pricing.winterTerms.triggerInches;
  const storms = days.filter((x: any) => x.snowIn >= trigger);
  if (alert && (flagged.length || storms.length)) {
    const { count } = await c.sb.from("memberships").select("id", { count: "exact", head: true }).eq("service", "winter").in("status", ["active", "past_due"]);
    await notifyOwner(c.sb, c.S, `Weather watch: ${flagged.length} job(s) flagged${storms.length ? `, snow ≥ ${trigger}" forecast` : ""}`,
      `${flagged.map((f) => `<p>${esc(f.date)} · ${esc(f.ref)} · ${esc(f.customer)} — ${esc(f.flag)}</p>`).join("")}${storms.map((s: any) => `<p><b>${esc(s.date)}: about ${s.snowIn}" of snow forecast</b> — ${count || 0} winter members.</p>`).join("")}<p>Nothing was cancelled automatically. Reschedule from the dashboard if needed.</p>`);
  }
  return { ok: true, days, flagged, storms };
}

async function stripeSetup(c: Ctx) {
  const existing = await stripe("GET", "/products", { limit: 100, active: true });
  const products: Record<string, string> = {};
  const created: string[] = [], reused: string[] = [];
  for (const s of SERVICES) {
    const found = existing.data.find((p: any) => p.metadata?.asycli_membership === s);
    if (found) { products[s] = found.id; reused.push(found.name); continue; }
    const p = await stripe("POST", "/products", {
      name: `${serviceName(s)} Membership`,
      description: s === "winter" ? "Monthly winter snow & ice membership: priority service with included visits after qualifying snowfall. Ends at season end." : "Two scheduled visits per month during the season. Ends automatically at season end.",
      metadata: { asycli_membership: s }, tax_code: "txcd_20030000",
    }, `asycli-product-${s}`);
    products[s] = p.id; created.push(p.name);
  }
  let taxRateId = c.S.stripe.taxRateId;
  const pct = c.S.pricing.salesTax.percent;
  const rates = await stripe("GET", "/tax_rates", { limit: 100, active: true });
  const match = rates.data.find((r: any) => r.metadata?.asycli === "sales_tax" && Number(r.percentage) === Number(pct) && !r.inclusive);
  if (match) { taxRateId = match.id; reused.push(match.display_name + " " + pct + "%"); }
  else {
    const r = await stripe("POST", "/tax_rates", { display_name: "Sales tax", description: "NY State + Suffolk County", jurisdiction: "NY - Suffolk", percentage: pct, inclusive: false, country: "US", state: "NY", metadata: { asycli: "sales_tax" } }, `asycli-tax-${pct}`);
    taxRateId = r.id; created.push(`Sales tax ${pct}%`);
  }
  // Billing portal: allow card updates, invoice history and cancel-at-period-end
  const cfgs = await stripe("GET", "/billing_portal/configurations", { limit: 10, active: true });
  let portal = cfgs.data.find((x: any) => x.metadata?.asycli === "1");
  if (!portal) {
    portal = await stripe("POST", "/billing_portal/configurations", {
      business_profile: { headline: "All Season Yard Care Long Island — manage your membership" },
      features: {
        customer_update: { enabled: true, allowed_updates: ["email", "phone", "address"] },
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
      },
      default_return_url: `${c.S.business.siteUrl}/account/`,
      metadata: { asycli: "1" },
    }, "asycli-portal-v1");
    created.push("Billing portal settings");
  }
  // Webhook endpoint for this mode (test and live each get their own signing secret)
  const hookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/api/stripe-webhook`;
  const events = ["checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_succeeded", "payment_intent.succeeded", "payment_intent.payment_failed", "charge.refunded", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed"];
  const mode = stripeMode();
  const secrets = { ...(c.S.stripe.webhookSecrets || {}) };
  const hooks = await stripe("GET", "/webhook_endpoints", { limit: 100 });
  let hook = hooks.data.find((h: any) => h.url === hookUrl);
  if (hook && !secrets[mode]) { await stripe("DELETE", `/webhook_endpoints/${hook.id}`); hook = null; }
  if (!hook) {
    hook = await stripe("POST", "/webhook_endpoints", { url: hookUrl, enabled_events: events, description: "ASYCLI website", api_version: "2025-03-31.basil" });
    secrets[mode] = hook.secret; created.push(`Webhook endpoint (${mode})`);
  } else {
    await stripe("POST", `/webhook_endpoints/${hook.id}`, { enabled_events: events });
    reused.push(`Webhook endpoint (${mode})`);
  }
  const stripeSettings = { ...c.S.stripe, products, taxRateId, portalConfig: portal.id, mode, webhookSecrets: secrets, webhookId: hook.id, setupAt: new Date().toISOString() };
  await c.sb.from("settings").upsert({ key: "stripe", value: stripeSettings, updated_at: new Date().toISOString() });
  return { ok: true, created, reused, products, taxRateId };
}
