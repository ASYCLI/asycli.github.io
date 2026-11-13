# All Season Yard Care Long Island — website & booking system

Live site: **https://asycli.github.io** · Owner dashboard: **https://asycli.github.io/admin/**

## How it fits together

| Part | Where it runs | Cost |
|---|---|---|
| Website (static HTML/CSS/JS) | GitHub Pages | Free |
| API, pricing engine, bookings, Stripe webhook | Supabase Edge Function `api` | Free tier |
| Database, file storage (photos), sign-in | Supabase project `asycli` (`tmsahdvlctabrvqqdemn`) | Free tier |
| Payments, subscriptions, receipts, billing portal | Stripe | 2.9% + 30¢ per card payment (Stripe's standard US rate) |
| Email (confirmations, reminders, sign-in links) | Brevo | Free tier (300 emails/day) |
| Address → drive time | U.S. Census geocoder + drive-time estimate | Free |
| Weather | Open-Meteo | Free |

Nothing depends on anyone's personal computer. Pushing to `main` rebuilds the site and redeploys the API through GitHub Actions (`.github/workflows/deploy.yml`). A daily scheduled run pings the API so the free Supabase project never pauses for inactivity.

## Folders

- `build.py` — generates every page into `site/` (run `python3 build.py`). Page text lives here.
- `web/` — CSS, JavaScript, icons copied into the site.
- `supabase/functions/api/` — the API. Shared code is in `supabase/functions/_shared/` (`pricing.js` is the pricing engine).
- `supabase/migrations/` — database schema (all tables are locked; only the API can read or write them).
- `tests/pricing.test.mjs` — checks that thousands of pricing combinations meet the minimum profit margin (`node tests/pricing.test.mjs`).

## Secrets (never committed)

Set in **Supabase → Edge Functions → Secrets**:

- `STRIPE_SECRET_KEY` — `sk_test_…` while testing, `sk_live_…` when going live.
- `BREVO_API_KEY` — enables email.
- `EMAIL_FROM` (optional) — the sending address verified in Brevo (defaults to asyclongisland@gmail.com).

Set in **GitHub → Settings → Secrets → Actions**:

- `SUPABASE_ACCESS_TOKEN` — lets GitHub deploy the API.

The Stripe webhook signing secret is created automatically when you click **Settings → Set up / check Stripe products** in the dashboard, and is stored server-side.

## Going live with real payments

1. Finish all test-mode checks (dashboard shows "Stripe: test mode").
2. In Supabase secrets, replace `STRIPE_SECRET_KEY` with your `sk_live_…` key.
3. Open the dashboard → **Settings → Set up / check Stripe products** (creates live products, tax rate, billing portal settings and webhook).
4. Review prices on the **Pricing** tab, then switch on each membership on the **Memberships** tab.

## Pricing

All prices, costs, seasons, travel bands, deposits, snow terms and tax are editable in the dashboard (Pricing tab) — no code changes. The engine never quotes below the minimum margin you set: it either raises the price to the floor or sends the job to you for approval, depending on your setting. Internal costs are never sent to customers.
