// Address → coordinates via the free U.S. Census Bureau geocoder (no key, government-run),
// then an estimated drive time from Islip, NY 11751. The estimate is conservative and the
// owner can override travel on any booking. Results are cached per address.
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const ISLIP = { lat: 40.7298, lng: -73.2104 }; // Islip, NY 11751 (hamlet centre)

export function estimateDriveMinutes(lat: number, lng: number) {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat - ISLIP.lat), dLng = toRad(lng - ISLIP.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(ISLIP.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
  const straight = 2 * R * Math.asin(Math.sqrt(a));
  const road = straight * 1.25;
  // local roads for the first ~6 miles, highway speeds after
  const minutes = 4 + (Math.min(road, 6) / 28) * 60 + (Math.max(road - 6, 0) / 52) * 60;
  return { minutes: Math.round(minutes), miles: Math.round(road * 10) / 10 };
}

export async function geocode(sb: SupabaseClient, address: string) {
  const key = address.toLowerCase().replace(/\s+/g, " ").trim();
  const { data: cached } = await sb.from("geocode_cache").select("*").eq("address_key", key).maybeSingle();
  if (cached) return cached.lat == null ? null : cached;
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(address)}`;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error("geocoder " + res.status);
    const j = await res.json();
    const m = j?.result?.addressMatches?.[0];
    const row = m
      ? { address_key: key, lat: m.coordinates.y, lng: m.coordinates.x, matched: m.matchedAddress, zip: m.addressComponents?.zip ?? null }
      : { address_key: key, lat: null, lng: null, matched: null, zip: null };
    await sb.from("geocode_cache").upsert(row);
    return m ? row : null;
  } catch (_e) {
    return undefined; // service unavailable → caller treats as "needs review", never blocks
  }
}

export async function travelFor(sb: SupabaseClient, address: string) {
  const g = await geocode(sb, address);
  if (g === undefined) return { found: false, unavailable: true, driveMinutes: null, matched: null, zip: null, lat: null, lng: null };
  if (!g) return { found: false, unavailable: false, driveMinutes: null, matched: null, zip: null, lat: null, lng: null };
  const d = estimateDriveMinutes(g.lat, g.lng);
  return { found: true, unavailable: false, driveMinutes: d.minutes, miles: d.miles, matched: g.matched, zip: g.zip, lat: g.lat, lng: g.lng };
}
