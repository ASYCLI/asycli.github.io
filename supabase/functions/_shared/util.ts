import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { DEFAULT_PRICING, DEFAULT_COSTS, deepMerge } from "./pricing.js";

export const TZ = "America/New_York";

export function db(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const DEFAULT_BUSINESS = {
  name: "All Season Yard Care Long Island",
  short: "ASYCLI",
  phone: "+1 (631) 800-9643",
  phoneHref: "+16318009643",
  email: "asyclongisland@gmail.com",
  ownerNotifyEmail: "asyclongisland@gmail.com",
  siteUrl: "https://asycli.github.io",
  googleReviewUrl: null as string | null,
  serviceArea: "Islip and most of Suffolk County, NY",
  windows: {
    am: { label: "Morning (8am – 12pm)", capacityHours: 4 },
    pm: { label: "Afternoon (12pm – 4pm)", capacityHours: 4 },
  },
  workDays: [1, 2, 3, 4, 5, 6], // Mon–Sat (0 = Sunday)
  minLeadDays: 2,
  bookAheadDays: 45,
  travelBufferHours: 0.35,
  holdMinutes: 35,
  checkoutMinutes: 30,
  cancellation: { freeCancelHours: 48, lateCancelKeepsDepositPercent: 100 },
  membershipsActive: { spring: false, summer: false, fall: false, winter: false },
  membershipSalesLeadDays: 45,
  notifications: { ownerNewBooking: true, customerReminders: true, weatherAlerts: true },
};

export async function loadSettings(sb: SupabaseClient) {
  const { data } = await sb.from("settings").select("key,value");
  const map: Record<string, unknown> = {};
  for (const r of data || []) map[r.key] = r.value;
  return {
    pricing: deepMerge(DEFAULT_PRICING, map.pricing as object),
    costs: deepMerge(DEFAULT_COSTS, map.costs as object),
    business: deepMerge(DEFAULT_BUSINESS, map.business as object),
    stripe: (map.stripe || {}) as Record<string, any>,
  };
}
export type Settings = Awaited<ReturnType<typeof loadSettings>>;

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dow(iso: string): number {
  return new Date(iso + "T12:00:00Z").getUTCDay();
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "to be scheduled";
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

export const money = (cents: number | null | undefined) =>
  cents == null ? "—" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export const cents = (dollars: number) => Math.round(dollars * 100);

export function refCode(): string {
  const a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const b = crypto.getRandomValues(new Uint8Array(6));
  return "AS-" + Array.from(b, (x) => a[x % a.length]).join("");
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}

export async function rateLimit(sb: SupabaseClient, req: Request, bucket: string, windowSec: number, max: number) {
  const { data, error } = await sb.rpc("hit_rate_limit", { p_key: `${bucket}:${clientIp(req)}`, p_window_seconds: windowSec, p_max: max });
  if (!error && data === false) throw new HttpError(429, "Too many requests — please wait a minute and try again.");
}

export async function logError(sb: SupabaseClient, source: string, err: unknown, detail?: unknown) {
  try {
    await sb.from("error_log").insert({ source, message: String((err as Error)?.message || err), detail: detail ?? null });
  } catch (_) { /* never throw from logging */ }
}

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function str(v: unknown, max = 500): string {
  return String(v ?? "").trim().slice(0, max);
}

export function emailOk(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

// Season helpers (month-day strings like "12-01"); returns ISO dates for the
// season instance that is current or next.
export function seasonWindow(season: { start: string; end: string }, todayIso = todayET()) {
  const y = Number(todayIso.slice(0, 4));
  const crosses = season.end < season.start;
  const mk = (sy: number) => {
    const start = `${sy}-${season.start}`;
    const end = `${crosses ? sy + 1 : sy}-${season.end}`;
    return { start, end };
  };
  for (const sy of [y - 1, y, y + 1]) {
    const w = mk(sy);
    if (todayIso <= w.end) return { ...w, active: todayIso >= w.start };
  }
  return { ...mk(y + 1), active: false };
}

// End of a calendar day in New York, as a unix timestamp (handles DST)
export function endOfDayET(iso: string): number {
  for (const off of [4, 5]) {
    const t = Date.parse(`${iso}T23:59:59-0${off}:00`);
    const local = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
    if (local === iso) return Math.floor(t / 1000);
  }
  return Math.floor(Date.parse(`${iso}T23:59:59-05:00`) / 1000);
}
export function startOfDayET(iso: string): number {
  for (const off of [4, 5]) {
    const t = Date.parse(`${iso}T08:00:00-0${off}:00`);
    const local = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
    if (local === iso) return Math.floor(t / 1000);
  }
  return Math.floor(Date.parse(`${iso}T08:00:00-05:00`) / 1000);
}
