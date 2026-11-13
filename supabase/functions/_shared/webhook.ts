// Stripe webhook receiver. Verifies the signature, records each event once, and only
// marks it "done" after processing succeeds — so Stripe retries are reprocessed safely.
// Every handler re-fetches the object from Stripe and writes idempotently.
import { db, loadSettings, logError, fmtDate, Settings, money, esc } from "./util.ts";
import { stripe, verifyStripeSignature } from "./stripe.ts";
import { notify, notifyOwner, serviceName } from "./email.ts";
import { recalcPaid, syncSubscription, scheduleSeasonEnd } from "./billing.ts";
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export async function handleWebhook(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const payload = await req.text();
  const sb = db();
  let secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) {
    const { data } = await sb.from("settings").select("value").eq("key", "stripe").maybeSingle();
    const k = Deno.env.get("STRIPE_SECRET_KEY") || "";
    secret = data?.value?.webhookSecrets?.[k.includes("_live_") ? "live" : "test"];
  }
  if (!secret || !(await verifyStripeSignature(payload, req.headers.get("stripe-signature"), secret))) {
    return new Response("Invalid signature", { status: 400 });
  }
  const event = JSON.parse(payload);

  const { data: prior } = await sb.from("webhook_events").select("status,attempts").eq("id", event.id).maybeSingle();
  if (prior?.status === "done") return new Response(JSON.stringify({ duplicate: true }), { status: 200 });
  if (prior) await sb.from("webhook_events").update({ status: "processing", attempts: prior.attempts + 1 }).eq("id", event.id);
  else {
    const { error } = await sb.from("webhook_events").insert({ id: event.id, type: event.type });
    if (error) return new Response(JSON.stringify({ concurrent: true }), { status: 200 }); // another delivery is processing it
  }

  try {
    const S = await loadSettings(sb);
    await handle(sb, S, event);
    await sb.from("webhook_events").update({ status: "done", processed_at: new Date().toISOString(), error: null }).eq("id", event.id);
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (e) {
    await sb.from("webhook_events").update({ status: "failed", error: String((e as Error).message).slice(0, 1000) }).eq("id", event.id);
    await logError(sb, `webhook/${event.type}`, e, { id: event.id });
    return new Response("Processing failed", { status: 500 }); // Stripe will retry
  }
}

async function handle(sb: SupabaseClient, S: Settings, event: any) {
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = await stripe("GET", `/checkout/sessions/${obj.id}`);
      if (session.mode === "subscription") return await onMembershipCheckout(sb, S, session);
      if (session.payment_status !== "paid") return;
      await recordPaymentIntent(sb, S, session.payment_intent, true);
      return;
    }
    case "checkout.session.expired": {
      const id = obj.metadata?.booking_id;
      if (id) await sb.from("bookings").update({ status: "expired", block_hours: 0, hold_until: null }).eq("id", id).eq("status", "pending_payment").eq("checkout_session_id", obj.id).eq("paid_cents", 0);
      if (obj.metadata?.membership_id) await sb.from("memberships").update({ status: "expired" }).eq("id", obj.metadata.membership_id).eq("status", "incomplete");
      return;
    }
    case "payment_intent.succeeded":
      if (obj.metadata?.booking_id) await recordPaymentIntent(sb, S, obj.id, false);
      return;
    case "payment_intent.payment_failed": {
      const pi = await stripe("GET", `/payment_intents/${obj.id}`);
      const bid = pi.metadata?.booking_id;
      if (!bid) return;
      const { data: b } = await sb.from("bookings").select("*, customers(name,email)").eq("id", bid).maybeSingle();
      if (b) await notify(sb, S, b.customers.email, "payment_failed", { booking: b, name: b.customers.name, message: pi.last_payment_error?.message });
      return;
    }
    case "charge.refunded": {
      const ch = await stripe("GET", `/charges/${obj.id}`);
      if (!ch.payment_intent) return;
      const { data: p } = await sb.from("payments").update({ refunded_cents: ch.amount_refunded }).eq("stripe_object_id", ch.payment_intent).select("booking_id").maybeSingle();
      if (p?.booking_id) await recalcPaid(sb, p.booking_id);
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      let { sub, membership } = await syncSubscription(sb, obj.id);
      if (event.type === "customer.subscription.created" && sub.status !== "canceled") {
        sub = await scheduleSeasonEnd(sub);
        ({ membership } = await syncSubscription(sb, obj.id));
      }
      if (event.type === "customer.subscription.deleted" && membership) {
        await notify(sb, S, membership.customers?.email, "sub_cancelled", { name: membership.customers?.name, service: membership.service });
        await notifyOwner(sb, S, `Membership ended: ${membership.customers?.name}`, `<p>${esc(serviceName(membership.service))} membership ended (${esc(sub.cancellation_details?.reason || "season end or cancellation")}).</p>`);
      }
      return;
    }
    case "invoice.paid": {
      const inv = await stripe("GET", `/invoices/${obj.id}`);
      if (!inv.amount_paid) return;
      const subId = inv.parent?.subscription_details?.subscription || inv.subscription || null;
      const membershipId = inv.metadata?.membership_id || inv.parent?.subscription_details?.metadata?.membership_id;
      let m: any = null;
      if (subId) m = (await sb.from("memberships").select("*, customers(*)").eq("stripe_subscription_id", subId).maybeSingle()).data;
      if (!m && membershipId) m = (await sb.from("memberships").select("*, customers(*)").eq("id", membershipId).maybeSingle()).data;
      if (!m) return;
      const kind = inv.metadata?.kind === "storm_visit" ? "storm_visit" : "subscription";
      const { error } = await sb.from("payments").upsert({
        membership_id: m.id, customer_id: m.customer_id, stripe_object_id: inv.id, kind, amount_cents: inv.amount_paid,
        status: "succeeded", receipt_url: inv.hosted_invoice_url,
      }, { onConflict: "stripe_object_id" });
      if (error) throw error;
      if (kind === "subscription" && inv.billing_reason === "subscription_cycle") {
        await notify(sb, S, m.customers.email, "sub_renewed", { name: m.customers.name, service: m.service, amount: inv.amount_paid, receipt: inv.hosted_invoice_url });
      }
      if (subId) await syncSubscription(sb, subId);
      return;
    }
    case "invoice.payment_failed": {
      const inv = await stripe("GET", `/invoices/${obj.id}`);
      const subId = inv.parent?.subscription_details?.subscription || inv.subscription || null;
      const { data: m } = subId ? await sb.from("memberships").select("*, customers(*)").eq("stripe_subscription_id", subId).maybeSingle() : { data: null };
      const custEmail = m?.customers?.email || inv.customer_email;
      await notify(sb, S, custEmail, "payment_failed", { name: m?.customers?.name || inv.customer_name, message: "We couldn't charge your card for your membership. Please update your card so service isn't paused." });
      await notifyOwner(sb, S, `Failed membership payment: ${m?.customers?.name || custEmail}`, `<p>${money(inv.amount_due)} failed for ${esc(serviceName(m?.service || ""))} membership. Stripe will retry automatically. Consider pausing service until it's resolved.</p>`);
      if (subId) await syncSubscription(sb, subId);
      return;
    }
    default:
      return;
  }
}

async function onMembershipCheckout(sb: SupabaseClient, S: Settings, session: any) {
  const id = session.metadata?.membership_id;
  if (!id || !session.subscription) return;
  await sb.from("memberships").update({ stripe_subscription_id: session.subscription }).eq("id", id);
  let sub = await stripe("GET", `/subscriptions/${session.subscription}`);
  sub = await scheduleSeasonEnd(sub);
  const { membership: m } = await syncSubscription(sb, sub.id);
  if (!m || m.consent?.welcomeSent) return;
  const visitsText = m.service === "winter"
    ? `Includes ${S.pricing.winterTerms.includedVisitsPerMonth} snow visits per month after ${S.pricing.winterTerms.triggerInches}"+ of snow (up to ${S.pricing.winterTerms.maxDepthPerVisitInches}" per visit). Extra visits are billed at the member rate.`
    : `Includes ${S.pricing.memberships.visitsPerMonth} scheduled visits per month.`;
  await notify(sb, S, m.customers.email, "sub_started", {
    name: m.customers.name, service: m.service, monthly: m.monthly_cents, visitsText,
    trialEnd: sub.trial_end ? fmtDate(new Date(sub.trial_end * 1000).toISOString().slice(0, 10)) : null,
    endsOn: sub.cancel_at ? fmtDate(new Date(sub.cancel_at * 1000).toISOString().slice(0, 10)) : "the end of the season",
  });
  await notifyOwner(sb, S, `New ${serviceName(m.service)} member: ${m.customers.name}`, `<p>${esc(m.tier)} · ${money(m.monthly_cents)}/mo · ${esc(m.customers.phone || "")}</p>`);
  await sb.from("memberships").update({ consent: { ...m.consent, welcomeSent: true } }).eq("id", m.id);
}

async function recordPaymentIntent(sb: SupabaseClient, S: Settings, piId: string, fromCheckout: boolean) {
  const pi = await stripe("GET", `/payment_intents/${piId}`, { expand: ["latest_charge.balance_transaction"] });
  if (pi.status !== "succeeded") return;
  const bookingId = pi.metadata?.booking_id;
  if (!bookingId) return;
  const { data: before } = await sb.from("bookings").select("*, customers(*)").eq("id", bookingId).maybeSingle();
  if (!before) throw new Error("Booking not found for payment " + piId);
  const charge = pi.latest_charge;
  const row = {
    booking_id: bookingId, customer_id: before.customer_id, stripe_object_id: pi.id,
    kind: ["deposit", "balance", "full"].includes(pi.metadata?.kind) ? pi.metadata.kind : "full",
    amount_cents: pi.amount_received, fee_cents: charge?.balance_transaction?.fee ?? null,
    refunded_cents: charge?.amount_refunded ?? 0, status: "succeeded", receipt_url: charge?.receipt_url ?? null,
  };
  // Insert-or-detect-duplicate: only the first event for this payment sends emails.
  const { error } = await sb.from("payments").insert(row);
  if (error && error.code !== "23505") throw error;
  if (error) {
    await sb.from("payments").update({ fee_cents: row.fee_cents, refunded_cents: row.refunded_cents, receipt_url: row.receipt_url }).eq("stripe_object_id", pi.id);
    await recalcPaid(sb, bookingId);
    return;
  }
  const b = await recalcPaid(sb, bookingId);

  const patch: any = { hold_until: null };
  if (["pending_payment", "approved", "pending_review", "expired"].includes(b.status)) {
    patch.status = "confirmed";
    patch.needs_review = false;
    // Make sure the slot is still ours (the hold may have lapsed before payment finished)
    if (b.service_date && b.time_window && b.time_window !== "storm") {
      const { data: ok } = await sb.rpc("reserve_slot", { p_booking: b.id, p_date: b.service_date, p_window: b.time_window, p_hours: b.block_hours || 2, p_default_capacity: S.business.windows[b.time_window]?.capacityHours ?? 4 });
      if (!ok) {
        patch.needs_review = true;
        patch.review_reasons = [...(b.review_reasons || []), "PAID but the slot filled up after the hold expired — call the customer to confirm a time"];
      }
    }
  }
  const { data: nb } = await sb.from("bookings").update(patch).eq("id", bookingId).select("*").single();
  await notify(sb, S, before.customers.email, "payment_success", { booking: nb, name: before.customers.name, amount: pi.amount_received });
  await notifyOwner(sb, S, `Payment received ${money(pi.amount_received)} — ${nb.ref}`, `<p>${esc(before.customers.name)} · ${esc(serviceName(nb.service))} · ${esc(fmtDate(nb.service_date))} ${esc(nb.time_window || "")}</p>${patch.needs_review ? "<p><b>Slot conflict — needs your attention.</b></p>" : ""}`);
}
