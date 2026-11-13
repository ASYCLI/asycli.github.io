// Email notifications. Every message is written to the `notifications` outbox first.
// If BREVO_API_KEY is set, it is handed to Brevo (free tier) and marked "accepted" only
// when Brevo returns success. We never claim a message was *delivered*.
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { esc, money, fmtDate, Settings } from "./util.ts";

const SERVICE_NAMES: Record<string, string> = {
  spring: "Spring Renewal",
  summer: "Summer Lawn Maintenance",
  fall: "Fall Cleanup",
  winter: "Winter Snow & Ice Removal",
};
export const serviceName = (s: string) => SERVICE_NAMES[s] || s;

function layout(S: Settings, title: string, body: string) {
  const b = S.business;
  return `<!doctype html><html><body style="margin:0;background:#f5f2ea;font-family:Arial,Helvetica,sans-serif;color:#1f2421">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="100%" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden" cellpadding="0" cellspacing="0">
<tr><td style="background:#1d3b2a;color:#f5f2ea;padding:18px 24px;font-size:16px;font-weight:bold;letter-spacing:.3px">${esc(b.name)}</td></tr>
<tr><td style="padding:24px"><h1 style="font-size:20px;margin:0 0 14px;color:#1d3b2a">${esc(title)}</h1>${body}</td></tr>
<tr><td style="padding:16px 24px;background:#f5f2ea;font-size:12px;color:#5b6360">
Questions? Call or text <a href="tel:${b.phoneHref}" style="color:#1d3b2a">${esc(b.phone)}</a> or reply to <a href="mailto:${esc(b.email)}" style="color:#1d3b2a">${esc(b.email)}</a>.<br>
Your Property. Our Priority. Every Season.</td></tr></table></td></tr></table></body></html>`;
}

const btn = (href: string, label: string) =>
  `<p style="margin:20px 0"><a href="${esc(href)}" style="background:#1d3b2a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold;display:inline-block">${esc(label)}</a></p>`;

function bookingSummary(bk: any, S: Settings) {
  const win = bk.time_window === "storm" ? "After the next qualifying snowfall" : S.business.windows[bk.time_window]?.label || "";
  const lines = (bk.quote?.lines || []).filter((l: any) => l.amount).map((l: any) =>
    `<tr><td style="padding:4px 0">${esc(l.label)}</td><td align="right">${money(l.amount * 100)}</td></tr>`).join("");
  const tax = bk.tax_cents ? `<tr><td style="padding:4px 0">${esc(bk.quote?.taxLabel || "Sales tax")}</td><td align="right">${money(bk.tax_cents)}</td></tr>` : "";
  return `<table width="100%" style="font-size:14px;border-collapse:collapse;margin:8px 0 4px">
<tr><td style="padding:4px 0;color:#5b6360">Reference</td><td align="right"><b>${esc(bk.ref)}</b></td></tr>
<tr><td style="padding:4px 0;color:#5b6360">Service</td><td align="right">${esc(serviceName(bk.service))}</td></tr>
<tr><td style="padding:4px 0;color:#5b6360">Date</td><td align="right">${esc(fmtDate(bk.service_date))}${win ? " · " + esc(win) : ""}</td></tr>
${lines}${tax}
${bk.total_cents ? `<tr><td style="padding:6px 0;border-top:1px solid #ddd"><b>Estimated total</b></td><td align="right" style="border-top:1px solid #ddd"><b>${money(bk.total_cents)}</b></td></tr>` : ""}
<tr><td style="padding:4px 0;color:#5b6360">Paid so far</td><td align="right">${money(bk.paid_cents - (bk.refunded_cents || 0))}</td></tr>
</table>`;
}

export function manageUrl(S: Settings, bk: any) {
  return `${S.business.siteUrl}/booking/?t=${bk.manage_token}`;
}

type Tpl = { subject: string; html: string };

export function render(template: string, S: Settings, ctx: any): Tpl {
  const bk = ctx.booking;
  const name = esc(ctx.name || "there");
  const disclaimer = `<p style="font-size:12px;color:#5b6360">Estimates are based on the details you gave us. Unusual conditions, inaccessible areas, inaccurate measurements or exceptional accumulation may require a revised quote, which we'll always confirm with you before doing extra work.</p>`;
  switch (template) {
    case "booking_received":
      return { subject: `We received your request (${bk.ref})`, html: layout(S, "Request received", `<p>Hi ${name},</p><p>Thanks for choosing us. ${bk.status === "quote_requested" || bk.status === "pending_review" ? "We'll review your details and get back to you within one business day with a confirmed price and date." : "Your booking is being held while you complete payment."}</p>${bookingSummary(bk, S)}${btn(manageUrl(S, bk), "View your booking")}${disclaimer}`) };
    case "booking_approved":
      return { subject: `Your ${serviceName(bk.service)} quote is approved (${bk.ref})`, html: layout(S, "Your quote is approved", `<p>Hi ${name},</p><p>We've reviewed your request. ${bk.deposit_cents ? `To lock in your date, please pay the ${money(bk.deposit_cents - bk.paid_cents > 0 ? bk.deposit_cents - bk.paid_cents : bk.deposit_cents)} ${bk.deposit_cents >= bk.total_cents ? "payment" : "deposit"}.` : ""}</p>${bookingSummary(bk, S)}${btn(manageUrl(S, bk), "Review and pay")}${disclaimer}`) };
    case "payment_success":
      return { subject: `Payment received — you're booked (${bk.ref})`, html: layout(S, "You're booked", `<p>Hi ${name},</p><p>We received your payment of <b>${money(ctx.amount)}</b>. Stripe also sends a separate card receipt.</p>${bookingSummary(bk, S)}${bk.total_cents - bk.paid_cents > 0 ? `<p>The remaining balance of <b>${money(bk.total_cents - bk.paid_cents)}</b> is due after the job is completed.</p>` : ""}${btn(manageUrl(S, bk), "Manage your booking")}`) };
    case "payment_failed":
      return { subject: `Payment didn't go through${bk ? ` (${bk.ref})` : ""}`, html: layout(S, "Your payment didn't go through", `<p>Hi ${name},</p><p>${esc(ctx.message || "Your card was declined.")} Nothing was charged. You can try again with another card${bk ? " from your booking page" : " from your account page"}.</p>${bk ? btn(manageUrl(S, bk), "Try again") : btn(`${S.business.siteUrl}/account/`, "Update payment method")}`) };
    case "reminder":
      return { subject: `Reminder: we're coming ${ctx.when} (${bk.ref})`, html: layout(S, "Appointment reminder", `<p>Hi ${name},</p><p>This is a reminder that our crew is scheduled for <b>${esc(fmtDate(bk.service_date))}</b>, ${esc(S.business.windows[bk.time_window]?.label || "")}. Please make sure gates are unlocked and pets are inside. If the weather forces a change, we'll contact you.</p>${bookingSummary(bk, S)}${btn(manageUrl(S, bk), "Need to reschedule?")}`) };
    case "rescheduled":
      return { subject: `Your appointment was moved (${bk.ref})`, html: layout(S, "New appointment time", `<p>Hi ${name},</p><p>${ctx.reason ? esc(ctx.reason) + " " : ""}Your service is now scheduled for <b>${esc(fmtDate(bk.service_date))}</b>, ${esc(S.business.windows[bk.time_window]?.label || "")}.</p>${bookingSummary(bk, S)}${btn(manageUrl(S, bk), "View booking")}`) };
    case "weather_change":
      return { subject: `Weather update for your appointment (${bk.ref})`, html: layout(S, "Weather update", `<p>Hi ${name},</p><p>${esc(ctx.message)}</p>${btn(manageUrl(S, bk), "View booking")}`) };
    case "completed":
      return { subject: `Job complete — thank you! (${bk.ref})`, html: layout(S, "Your job is complete", `<p>Hi ${name},</p><p>Our crew finished your ${esc(serviceName(bk.service))} today. ${bk.total_cents - bk.paid_cents > 0 ? `Your remaining balance is <b>${money(bk.total_cents - bk.paid_cents)}</b>.` : ""}</p>${btn(manageUrl(S, bk), bk.total_cents - bk.paid_cents > 0 ? "Pay balance" : "View booking")}<p>If you were happy with the work, a short review helps a small local business more than you'd think:</p>${btn(`${manageUrl(S, bk)}#review`, "Leave a review")}${S.business.googleReviewUrl ? `<p><a href="${esc(S.business.googleReviewUrl)}">Or review us on Google</a></p>` : ""}`) };
    case "sub_started":
      return { subject: `Welcome to your ${serviceName(ctx.service)} membership`, html: layout(S, "Membership confirmed", `<p>Hi ${name},</p><p>Your <b>${esc(serviceName(ctx.service))} Membership</b> is active.</p><ul style="font-size:14px;line-height:1.6"><li>Price: <b>${money(ctx.monthly)}/month</b> plus sales tax, billed automatically to your card.</li><li>${esc(ctx.visitsText)}</li><li>${ctx.trialEnd ? `First charge on ${esc(ctx.trialEnd)}.` : "Your first payment was charged today."}</li><li>Billing ends automatically on <b>${esc(ctx.endsOn)}</b> (end of season). It does not renew into next year unless you sign up again.</li><li>Cancel anytime from your account page; cancellation takes effect at the end of the month you've paid for.</li></ul>${btn(`${S.business.siteUrl}/account/`, "Manage membership")}`) };
    case "sub_renewed":
      return { subject: `Membership payment received`, html: layout(S, "Monthly payment received", `<p>Hi ${name},</p><p>We received your monthly ${esc(serviceName(ctx.service))} membership payment of <b>${money(ctx.amount)}</b>.${ctx.receipt ? ` <a href="${esc(ctx.receipt)}">View receipt</a>.` : ""}</p>${btn(`${S.business.siteUrl}/account/`, "Manage membership")}`) };
    case "sub_cancelled":
      return { subject: `Your membership has ended`, html: layout(S, "Membership ended", `<p>Hi ${name},</p><p>Your ${esc(serviceName(ctx.service))} membership has ended and you will not be charged again. Thanks for being a member — we'd love to see you next season.</p>`) };
    case "sub_cancel_scheduled":
      return { subject: `Membership cancellation confirmed`, html: layout(S, "Cancellation confirmed", `<p>Hi ${name},</p><p>Your ${esc(serviceName(ctx.service))} membership will end on <b>${esc(ctx.endsOn)}</b>. You won't be charged after that.</p>`) };
    case "storm_charge":
      return { subject: `Extra snow visit charge`, html: layout(S, "Extra snow visit", `<p>Hi ${name},</p><p>We cleared your property on ${esc(ctx.date)}. Because this was beyond your included visits this month, it was billed at the member rate of <b>${money(ctx.amount)}</b> plus tax to the card on file.</p>`) };
    case "magic":
      return { subject: ctx.subject, html: layout(S, ctx.subject, ctx.html) };
    case "owner_alert":
      return { subject: `[ASYCLI] ${ctx.subject}`, html: layout(S, ctx.subject, `${ctx.html}${btn(`${S.business.siteUrl}/admin/`, "Open dashboard")}`) };
    default:
      throw new Error("Unknown template " + template);
  }
}

export async function notify(sb: SupabaseClient, S: Settings, to: string | null | undefined, template: string, ctx: any) {
  if (!to) return;
  try {
    const t = render(template, S, ctx);
    const { data: row } = await sb.from("notifications").insert({
      to_email: to, template, subject: t.subject, body_html: t.html, booking_id: ctx.booking?.id ?? null,
    }).select("id").single();
    await deliver(sb, S, row!.id, to, t);
  } catch (e) {
    await sb.from("error_log").insert({ source: "notify", message: String((e as Error).message), detail: { template, to } });
  }
}

export async function notifyOwner(sb: SupabaseClient, S: Settings, subject: string, html: string) {
  await notify(sb, S, S.business.ownerNotifyEmail, "owner_alert", { subject, html });
}

export async function deliver(sb: SupabaseClient, S: Settings, id: string, to: string, t: Tpl) {
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key) {
    await sb.from("notifications").update({ status: "skipped", error: "Email provider not configured yet" }).eq("id", id);
    return;
  }
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { name: S.business.name, email: Deno.env.get("EMAIL_FROM") || S.business.email },
        replyTo: { email: S.business.email },
        to: [{ email: to }],
        subject: t.subject,
        htmlContent: t.html,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) await sb.from("notifications").update({ status: "accepted", provider_id: body.messageId ?? null, sent_at: new Date().toISOString(), error: null }).eq("id", id);
    else await sb.from("notifications").update({ status: "failed", error: body.message || `HTTP ${res.status}` }).eq("id", id);
  } catch (e) {
    await sb.from("notifications").update({ status: "failed", error: String((e as Error).message) }).eq("id", id);
  }
}
