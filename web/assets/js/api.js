import { API, SUPABASE_KEY, SUPABASE_URL } from "./config.js";

export async function api(route, body, { token, method } = {}) {
  const headers = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${API}/${route}`, { method: method || (body === undefined ? "GET" : "POST"), headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (_) {
    throw new Error("We couldn't reach our server. Check your connection and try again, or call us.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; e.data = data; throw e; }
  return data;
}

let configPromise;
export function getConfig() {
  configPromise ||= api("config").catch((e) => { configPromise = null; throw e; });
  return configPromise;
}

export const money = (n, cents = false) => {
  if (n == null) return "—";
  const v = cents ? n / 100 : n;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
};

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function fmtDate(iso, opts = { weekday: "short", month: "short", day: "numeric" }) {
  if (!iso) return "—";
  return new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("en-US", opts);
}

export function toast(msg, ms = 3200) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg; t.setAttribute("role", "status");
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// Resize an image file in the browser to a JPEG (max 1600px) before upload
export async function compressImage(file, max = 1600, quality = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const scale = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(im.naturalWidth * scale); c.height = Math.round(im.naturalHeight * scale);
    c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
    return await new Promise((ok) => c.toBlob(ok, "image/jpeg", quality));
  } finally { URL.revokeObjectURL(url); }
}

export async function uploadSigned(bucket, path, token, blob) {
  const fd = new FormData();
  fd.append("cacheControl", "3600");
  fd.append("", blob, "photo.jpg");
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${bucket}/${path}?token=${encodeURIComponent(token)}`, {
    method: "PUT", headers: { apikey: SUPABASE_KEY, "x-upsert": "false" }, body: fd,
  });
  if (!res.ok) throw new Error("Photo upload failed");
  return path;
}

export const SERVICE_NAMES = { spring: "Spring Renewal", summer: "Summer Lawn Maintenance", fall: "Fall Cleanup", winter: "Winter Snow & Ice Removal" };
export const STATUS_LABELS = {
  quote_requested: ["Quote requested", "info"], pending_review: ["Under review", "warn"], approved: ["Approved — awaiting payment", "warn"],
  pending_payment: ["Awaiting payment", "warn"], confirmed: ["Confirmed", "ok"], in_progress: ["In progress", "ok"],
  completed: ["Completed", "ok"], cancelled: ["Cancelled", "err"], expired: ["Expired", "err"],
};
export const statusPill = (s) => { const [l, k] = STATUS_LABELS[s] || [s, ""]; return `<span class="pill ${k}">${esc(l)}</span>`; };
