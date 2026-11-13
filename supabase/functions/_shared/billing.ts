import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { stripe, stripeEnabled } from "./stripe.ts";
import { Settings, seasonWindow, endOfDayET, startOfDayET, todayET, addDays, money } from "./util.ts";
import { serviceName, manageUrl } from "./email.ts";

export async function ensureStripeCustomer(sb: SupabaseClient, customer: any) {
  if (customer.stripe_customer_id) return customer.stripe_customer_id;
  const c = await stripe("POST", "/customers", {
    email: customer.email, name: customer.name || undefined, phone: customer.phone || undefined,
    metadata: { asycli_customer_id: customer.id },
  }, `cust-${customer.id}`);
  await sb.from("customers").update({ stripe_customer_id: c.id }).eq("id", customer.id);
  return c.id;
}

// Amount the customer should pay right now for a booking
export function amountDueNow(bk: any) {
  const net = bk.paid_cents - (bk.refunded_cents || 0);
  if (net <= 0) return bk.deposit_cents ?? bk.total_cents;
  return Math.max(0, bk.total_cents - net);
}

export async function createBookingCheckout(sb: SupabaseClient, S: Settings, bk: any, customer: any, purpose: "deposit" | "balance" | "full") {
  const custId = await ensureStripeCustomer(sb, customer);
  const amount = purpose === "balance" ? bk.total_cents - (bk.paid_cents - (bk.refunded_cents || 0)) : (purpose === "full" ? bk.total_cents : bk.deposit_cents);
  if (!amount || amount <= 0) throw new Error("Nothing to pay");
  const label = purpose === "balance" ? "Remaining balance" : purpose === "full" ? "Payment in full" : "Booking deposit";
  const kind = purpose === "full" || (purpose === "deposit" && bk.deposit_cents >= bk.total_cents) ? "full" : purpose;
  const expires = Math.floor(Date.now() / 1000) + S.business.checkoutMinutes * 60;
  const session = await stripe("POST", "/checkout/sessions", {
    mode: "payment",
    customer: custId,
    payment_method_types: ["card"],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: amount,
        product_data: {
          name: `${label} — ${serviceName(bk.service)} (${bk.ref})`,
          description: kind === "full" || purpose === "balance" ? "Includes NY sales tax" : `Applied toward your estimated total of ${money(bk.total_cents)} (incl. tax)`,
        },
      },
    }],
    payment_intent_data: {
      description: `${bk.ref} ${label}`,
      metadata: { booking_id: bk.id, kind, ref: bk.ref },
    },
    metadata: { booking_id: bk.id, kind, ref: bk.ref },
    client_reference_id: bk.id,
    expires_at: purpose === "balance" ? undefined : expires,
    success_url: `${manageUrl(S, bk)}&paid=1`,
    cancel_url: `${manageUrl(S, bk)}&cancelled=1`,
  }, `co-${bk.id}-${purpose}-${amount}-${bk.updated_at}`);
  await sb.from("bookings").update({ checkout_session_id: session.id }).eq("id", bk.id);
  return session.url as string;
}

export async function recalcPaid(sb: SupabaseClient, bookingId: string) {
  const { data } = await sb.from("payments").select("amount_cents,refunded_cents,status").eq("booking_id", bookingId);
  const ok = (data || []).filter((p) => p.status === "succeeded");
  const paid = ok.reduce((a, p) => a + p.amount_cents, 0);
  const refunded = ok.reduce((a, p) => a + (p.refunded_cents || 0), 0);
  const { data: bk } = await sb.from("bookings").update({ paid_cents: paid, refunded_cents: refunded }).eq("id", bookingId).select("*").single();
  return bk;
}

// Membership checkout with explicit consent captured on our side first
export async function createMembershipCheckout(sb: SupabaseClient, S: Settings, m: any, customer: any) {
  const custId = await ensureStripeCustomer(sb, customer);
  const productId = S.stripe.products?.[m.service];
  if (!productId) throw new Error("Memberships are not set up in Stripe yet");
  const season = seasonWindow(S.pricing.seasons[m.service]);
  const today = todayET();
  const trialEnd = season.start > today ? startOfDayET(season.start) : undefined;
  const sub: Record<string, unknown> = {
    description: `${serviceName(m.service)} Membership (${m.tier}) — ends ${season.end}`,
    metadata: { membership_id: m.id, service: m.service, tier: m.tier, season_end: season.end },
  };
  if (trialEnd) sub.trial_end = trialEnd;
  const visits = m.service === "winter"
    ? `${S.pricing.winterTerms.includedVisitsPerMonth} included snow visits/month (${S.pricing.winterTerms.triggerInches}"+ snowfall)`
    : `${S.pricing.memberships.visitsPerMonth} scheduled visits/month`;
  const session = await stripe("POST", "/checkout/sessions", {
    mode: "subscription",
    customer: custId,
    payment_method_types: ["card"],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        product: productId,
        unit_amount: m.monthly_cents,
        recurring: { interval: "month" },
      },
      tax_rates: S.stripe.taxRateId && S.pricing.salesTax.enabled ? [S.stripe.taxRateId] : undefined,
    }],
    subscription_data: sub,
    metadata: { membership_id: m.id, kind: "membership" },
    client_reference_id: m.id,
    custom_text: {
      submit: {
        message: `You're agreeing to ${money(m.monthly_cents)}/month plus tax, billed automatically ${trialEnd ? `starting ${season.start}` : "starting today"} until ${season.end}, when it ends on its own. ${visits}. Cancel anytime online.`.slice(0, 1200),
      },
    },
    success_url: `${S.business.siteUrl}/account/?joined=${m.service}`,
    cancel_url: `${S.business.siteUrl}/plans/?cancelled=1`,
  }, `sub-${m.id}`);
  await sb.from("memberships").update({ checkout_session_id: session.id }).eq("id", m.id);
  return session.url as string;
}

export function subPeriodEnd(sub: any): number | null {
  return sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
}

export async function syncSubscription(sb: SupabaseClient, subId: string) {
  const sub = await stripe("GET", `/subscriptions/${subId}`);
  const membershipId = sub.metadata?.membership_id;
  const fields: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    status: sub.status,
    current_period_end: subPeriodEnd(sub) ? new Date(subPeriodEnd(sub)! * 1000).toISOString() : null,
    cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
  };
  let q = sb.from("memberships").update(fields);
  q = membershipId ? q.eq("id", membershipId) : q.eq("stripe_subscription_id", sub.id);
  const { data } = await q.select("*, customers(*)").maybeSingle();
  return { sub, membership: data };
}

// Make the subscription end on its own at the end of the season (no surprise renewals).
export async function scheduleSeasonEnd(sub: any) {
  const end = sub.metadata?.season_end;
  if (!end || sub.cancel_at) return sub;
  return await stripe("POST", `/subscriptions/${sub.id}`, {
    cancel_at: endOfDayET(end),
    proration_behavior: "none",
  }, `cancelat-${sub.id}`);
}

export { stripeEnabled, addDays };
