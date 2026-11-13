// Passwordless sign-in. We email a one-time link (sent by our own server) that lands back
// on this site with a token hash; Supabase Auth verifies it and keeps the session.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { api, esc } from "./api.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });

export async function session() {
  const qs = new URLSearchParams(location.search);
  const th = qs.get("th");
  if (th) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: th, type: "magiclink" });
    qs.delete("th");
    history.replaceState(null, "", location.pathname + (qs.toString() ? "?" + qs : ""));
    if (error) return { error: "That sign-in link has expired or was already used. Request a new one below." };
  }
  const { data } = await supabase.auth.getSession();
  return { session: data.session };
}

export async function signOut() { await supabase.auth.signOut(); location.reload(); }

export function loginForm(el, { title, sub, target, allowPassword }) {
  el.innerHTML = `<div class="card" style="max-width:480px;margin:0 auto">
    <h2>${title}</h2><p class="fine">${sub}</p>
    <form data-link novalidate><div class="field"><label for="l-email">Email</label><input id="l-email" type="email" required autocomplete="email"></div>
    <button class="btn block" type="submit">Email me a sign-in link</button></form>
    ${allowPassword ? `<details style="margin-top:16px"><summary class="fine" style="cursor:pointer">Sign in with a password instead</summary>
      <form data-pw novalidate style="margin-top:12px"><div class="field"><label for="p-email">Email</label><input id="p-email" type="email" required autocomplete="username"></div>
      <div class="field"><label for="p-pw">Password</label><input id="p-pw" type="password" required autocomplete="current-password"></div>
      <button class="btn ghost block" type="submit">Sign in</button></form></details>` : ""}
    <div data-out aria-live="polite" style="margin-top:14px"></div></div>`;
  const out = el.querySelector("[data-out]");
  el.querySelector("[data-link]").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = el.querySelector("#l-email").value.trim();
    const b = e.target.querySelector("button"); b.disabled = true;
    try {
      const r = await api("auth/link", { email, target });
      out.innerHTML = `<div class="notice ok"><p>${esc(r.message)}</p></div>`;
    } catch (err) { out.innerHTML = `<div class="notice err"><p>${esc(err.message)}</p></div>`; }
    finally { b.disabled = false; }
  });
  el.querySelector("[data-pw]")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email: el.querySelector("#p-email").value.trim(), password: el.querySelector("#p-pw").value });
    if (error) out.innerHTML = `<div class="notice err"><p>${esc(error.message)}</p></div>`;
    else location.reload();
  });
}
