#!/usr/bin/env python3
"""Static site generator for All Season Yard Care Long Island.
Run:  python3 build.py   → writes the finished site into ./site
Pages are plain HTML (fast, SEO-friendly). Interactive parts load small JS modules."""
import json, os, shutil, html, datetime

SITE = "https://asycli.github.io"
NAME = "All Season Yard Care Long Island"
SHORT = "ASYCLI"
PHONE = "+1 (631) 800-9643"
PHONE_HREF = "+16318009643"
EMAIL = "asyclongisland@gmail.com"
TAGLINE = "Your Property. Our Priority. Every Season."
OUT = os.path.join(os.path.dirname(__file__), "site")
SRC = os.path.join(os.path.dirname(__file__), "web")
VERSION = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M")

# Free photos (Unsplash License) — stock scenes, not our jobs. Credits in /credits/.
PHOTOS = {
    "fall": ("1635628001185-d4437faea3e1", "Wheelbarrow full of autumn leaves in a yard", "Annie Spratt"),
    "fall2": ("1761401395640-5c45422f2a99", "Brick house with a lawn and autumn trees", "Roger Starnes Sr"),
    "winter": ("1483385573908-0a2108937c4a", "Clearing snow from a residential driveway", "Filip Mroz"),
    "winter2": ("1547248675-df38810066b8", "Snow being cleared beside a house", "Patrick Bald"),
    "summer": ("1458245201577-fc8a130b8829", "Lawn mower on freshly cut green grass", "Daniel Watson"),
    "spring": ("1779462929245-5fa26aa68924", "House with a fresh green spring lawn", "QY Liu"),
}
def img(key, w=1600):
    pid = PHOTOS[key][0]
    return f"https://images.unsplash.com/photo-{pid}?auto=format&fit=crop&w={w}&q=70"
def srcset(key):
    return ", ".join(f"{img(key, w)} {w}w" for w in (640, 1000, 1600, 2200))

SEASON_COLOR = {"spring": "c-spring", "summer": "c-summer", "fall": "c-fall", "winter": "c-winter"}
SERVICES = [
    ("spring", "Spring Renewal", "/spring-renewal/", "Debris, leftover leaves and winter mess cleared, raked, blown and bagged — with optional haul-away."),
    ("summer", "Summer Lawn Maintenance", "/summer-lawn-maintenance/", "Professional mowing and string trimming, priced by your actual lawn size."),
    ("fall", "Fall Cleanup", "/fall-cleanup/", "Full leaf cleanup front and back — bagged at your curb or loaded on our truck and hauled away."),
    ("winter", "Winter Snow & Ice Removal", "/winter-snow-removal/", "Driveways and walkways cleared with snowblower and shovel, plus salting and de-icing."),
]

LOGO = """<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="11" fill="#1d3b2a"/><path d="M11 27c0-9 7-15 18-16-1 10-7 17-16 17" fill="none" stroke="#f7f4ec" stroke-width="2.4" stroke-linecap="round"/><path d="M12 27c4-4 8-7 12-9" fill="none" stroke="#f7f4ec" stroke-width="1.8" stroke-linecap="round"/><circle cx="29.5" cy="29.5" r="2.2" fill="#c39a45"/></svg>"""

def esc(s): return html.escape(s, quote=True)

def header(path):
    def cur(p): return ' aria-current="page"' if path == p else ""
    svc_links = "".join(f'<a href="{u}"{cur(u)}><i class="{SEASON_COLOR[k]}"></i>{n}</a>' for k, n, u, _ in SERVICES)
    return f"""<a class="skip" href="#main">Skip to content</a>
<div class="topbar"><div class="wrap"><span class="season-pill"><span class="dot"></span><span data-season-label>Seasonal property care</span><span class="hide-sm">&nbsp;· Islip &amp; most of Suffolk County</span></span>
<span><a href="tel:{PHONE_HREF}">{PHONE}</a><span class="hide-sm"> &nbsp;·&nbsp; <a href="mailto:{EMAIL}">{EMAIL}</a></span></span></div></div>
<header class="site" id="top"><div class="wrap">
<a class="brand" href="/" aria-label="{NAME} home">{LOGO}<span><b>All Season Yard Care</b><small>Long Island</small></span></a>
<nav class="main" aria-label="Main">
<div class="nav-drop"><button type="button" aria-haspopup="true">Services ▾</button><div class="menu"><a href="/services/"{cur('/services/')}><i style="background:var(--forest)"></i>All services</a>{svc_links}</div></div>
<a href="/plans/"{cur('/plans/')}>Monthly Plans</a>
<a href="/estimate/"{cur('/estimate/')}>Instant Estimate</a>
<a href="/gallery/"{cur('/gallery/')}>Gallery</a>
<a href="/about/"{cur('/about/')}>About</a>
<a href="/faq/"{cur('/faq/')}>FAQ</a>
<a href="/contact/"{cur('/contact/')}>Contact</a>
<a href="/account/"{cur('/account/')}>My Account</a>
</nav>
<div class="header-cta"><a class="btn ghost sm" href="tel:{PHONE_HREF}">Call</a><a class="btn sm" href="/book/">Book a Service</a></div>
<button class="menu-btn" type="button" aria-label="Open menu" aria-expanded="false"><span></span><span></span><span></span></button>
</div></header>"""

def footer():
    svc = "".join(f'<li><a href="{u}">{n}</a></li>' for _, n, u, _ in SERVICES)
    return f"""<footer class="site"><div class="wrap"><div class="cols">
<div><a class="brand" href="/" style="color:#fff">{LOGO}<span><b style="color:#fff">All Season Yard Care</b><small style="color:#9fb09a">Long Island</small></span></a>
<p class="tagline">{TAGLINE}</p>
<p>Seasonal residential property care based in Islip, NY 11751, serving most of Suffolk County.</p>
<p><a href="tel:{PHONE_HREF}">{PHONE}</a><br><a href="mailto:{EMAIL}">{EMAIL}</a></p></div>
<div><h4>Services</h4><ul>{svc}<li><a href="/plans/">Monthly Plans</a></li></ul></div>
<div><h4>Get started</h4><ul><li><a href="/estimate/">Instant Estimate</a></li><li><a href="/book/">Book Online</a></li><li><a href="/contact/">Request a Custom Quote</a></li><li><a href="/account/">My Account</a></li><li><a href="/reviews/">Reviews</a></li><li><a href="/gallery/">Before &amp; After</a></li></ul></div>
<div><h4>Company</h4><ul><li><a href="/about/">About Us</a></li><li><a href="/faq/">FAQ</a></li><li><a href="/privacy/">Privacy Policy</a></li><li><a href="/terms/">Terms of Service</a></li><li><a href="/cancellation-refund-policy/">Cancellation &amp; Refunds</a></li><li><a href="/credits/">Photo credits</a></li></ul></div>
</div>
<div class="base"><span>© <span data-year>2026</span> {NAME}. All rights reserved.</span><span>Payments are processed securely by Stripe. We never store card numbers.</span></div>
</div></footer>
<div class="mobile-bar" aria-label="Quick actions"><a class="btn light" href="tel:{PHONE_HREF}">Call</a><a class="btn ghost" style="background:#fff" href="/estimate/">Free Estimate</a><a class="btn gold" href="/book/">Book</a></div>"""

LOCAL_BUSINESS = {
    "@context": "https://schema.org",
    "@type": "HomeAndConstructionBusiness",
    "@id": SITE + "/#business",
    "name": NAME,
    "alternateName": SHORT,
    "url": SITE + "/",
    "telephone": "+1-631-800-9643",
    "email": EMAIL,
    "slogan": TAGLINE,
    "logo": SITE + "/assets/img/logo-512.png",
    "image": img("fall", 1200),
    "priceRange": "$$",
    "areaServed": [{"@type": "AdministrativeArea", "name": "Suffolk County, New York"}, {"@type": "City", "name": "Islip, NY"}],
    "address": {"@type": "PostalAddress", "addressLocality": "Islip", "addressRegion": "NY", "postalCode": "11751", "addressCountry": "US"},
    "knowsAbout": ["Leaf removal", "Fall cleanup", "Snow removal", "Driveway snow clearing", "Salting and de-icing", "Lawn mowing", "String trimming", "Spring yard cleanup"],
}

def page(path, title, desc, body, *, scripts=(), schema=None, robots="index,follow", og_image=None, season=None, crumbs=None):
    canonical = SITE + path
    ld = [LOCAL_BUSINESS]
    if schema: ld += schema if isinstance(schema, list) else [schema]
    if crumbs:
        ld.append({"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + u} for i, (n, u) in enumerate(crumbs)]})
    js = "".join(f'<script type="module" src="/assets/js/{s}?v={VERSION}"></script>' for s in ("site.js",) + tuple(scripts))
    full_title = title if NAME in title else f"{title} | {NAME}"
    season_attr = f' data-season="{season}" data-season-fixed="1"' if season else ""
    return f"""<!doctype html>
<html lang="en"{season_attr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{esc(full_title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{canonical}">
<meta name="robots" content="{robots}">
<meta name="theme-color" content="#1d3b2a">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{NAME}">
<meta property="og:title" content="{esc(full_title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{og_image or SITE + '/assets/img/og.png'}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://images.unsplash.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/assets/css/site.css?v={VERSION}">
<script type="application/ld+json">{json.dumps(ld, separators=(',', ':'))}</script>
</head>
<body>
{header(path)}
<main id="main">
{body}
</main>
{footer()}
{js}
</body>
</html>"""

def page_hero(title, sub, photo=None, crumbs=None, eyebrow=None):
    bg = f'<div class="bg"><img src="{img(photo, 1600)}" srcset="{srcset(photo)}" sizes="100vw" alt="" fetchpriority="high"></div>' if photo else ""
    cls = "page-hero" if photo else "page-hero plain"
    cr = ""
    if crumbs:
        cr = '<nav class="crumbs" aria-label="Breadcrumb">' + " / ".join(f'<a href="{u}">{n}</a>' for n, u in crumbs[:-1]) + f" / <span>{crumbs[-1][0]}</span></nav>"
    eb = f'<div class="eyebrow">{eyebrow}</div>' if eyebrow else ""
    return f'<section class="{cls}">{bg}<div class="wrap">{cr}{eb}<h1>{title}</h1><p>{sub}</p></div></section>'

def cta_band(title="Ready for a cleaner property?", text="Get an instant estimate in about two minutes, or call and talk to us directly.", season=None):
    return f"""<section class="block tight"><div class="wrap"><div class="cta-band reveal"><div><h2>{title}</h2><p>{text}</p></div>
<div class="actions"><a class="btn gold" href="/estimate/{('?service=' + season) if season else ''}">Get My Free Estimate</a><a class="btn light" href="tel:{PHONE_HREF}">Call {PHONE}</a></div></div></div></section>"""

def svc_cards():
    photo = {"spring": "spring", "summer": "summer", "fall": "fall", "winter": "winter"}
    unit = {"spring": "cleanup from", "summer": "per mow from", "fall": "cleanup from", "winter": "per visit from"}
    default = {"spring": 225, "summer": 80, "fall": 225, "winter": 75}
    out = []
    for k, n, u, d in SERVICES:
        out.append(f"""<a class="card svc-card reveal" href="{u}"><span class="tag"><i class="{SEASON_COLOR[k]}"></i>{k.title()}</span>
<div class="ph"><img src="{img(photo[k], 800)}" alt="{esc(PHOTOS[photo[k]][1])}" loading="lazy" width="800" height="500"></div>
<div class="body"><h3>{n}</h3><p>{d}</p><div class="from"><span>{unit[k]}</span><b data-from="{k}">${default[k]}</b></div></div></a>""")
    return "".join(out)

# ---------------------------------------------------------------- pages
pages = {}

pages["/"] = page("/", f"{NAME} | Leaf Cleanup, Snow Removal & Mowing in Islip, NY",
  "Seasonal yard care in Islip and most of Suffolk County: fall leaf cleanup with bagging or haul-away, driveway snow removal and salting, lawn mowing and spring cleanups. Instant online estimates.",
  f"""<section class="hero">
<div class="bg">{''.join(f'<img data-season-img="{s}" src="{img(p, 1600)}" srcset="{srcset(p)}" sizes="100vw" alt="" {"fetchpriority=high" if s=="fall" else 'loading="lazy"'}>' for s, p in (("fall","fall"),("winter","winter"),("spring","spring"),("summer","summer")))}</div>
<div class="wrap">
<div class="eyebrow">Islip, NY · Serving most of Suffolk County</div>
<h1 data-hero-title>Your property, cared for every season.</h1>
<p class="lede" data-hero-lede>Fall leaf cleanups, winter snow clearing, spring renewal and summer mowing — done by a dedicated three-person crew, priced transparently before you book.</p>
<div class="hero-actions"><a class="btn gold" href="/estimate/" data-hero-cta>Get My Free Estimate</a><a class="btn light" href="/book/">Book a Service</a></div>
<a class="hero-call" href="tel:{PHONE_HREF}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>Call or text {PHONE}</a>
<div class="season-switch" role="group" aria-label="Seasonal services">
<button type="button" data-season-btn="fall"><i class="c-fall"></i>Fall Cleanup<span class="now"></span></button>
<button type="button" data-season-btn="winter"><i class="c-winter"></i>Snow &amp; Ice<span class="now"></span></button>
<button type="button" data-season-btn="spring"><i class="c-spring"></i>Spring Renewal<span class="now"></span></button>
<button type="button" data-season-btn="summer"><i class="c-summer"></i>Mowing<span class="now"></span></button>
</div></div>
<aside class="hero-card" aria-label="Pricing at a glance"><h3>Transparent starting prices</h3><ul>
<li><span>Fall cleanup</span><b>from <span data-from="fall">$225</span></b></li>
<li><span>Snow clearing / visit</span><b>from <span data-from="winter">$75</span></b></li>
<li><span>Mow + trim</span><b>from <span data-from="summer">$80</span></b></li>
<li><span>Spring cleanup</span><b>from <span data-from="spring">$225</span></b></li></ul>
<p class="fine" style="margin:8px 0 0">Plus NY sales tax. Exact price depends on your property.</p></aside>
</section>

<section class="block"><div class="wrap">
<div class="section-head reveal"><div class="eyebrow">What we do</div><h2>Four seasons. One reliable crew.</h2><p>We focus on a short list of services and do them properly. No upsells for work we don't do — just clear pricing, on-time crews and a clean property when we leave.</p></div>
<div class="grid g4">{svc_cards()}</div>
</div></section>

<section class="block alt"><div class="wrap">
<div class="section-head reveal"><div class="eyebrow">How it works</div><h2>From estimate to clean property in four steps</h2></div>
<div class="steps reveal">
<div><h3>Get your price online</h3><p>Answer a few questions about your property. You'll see an itemized estimate instantly — including any travel fee.</p></div>
<div><h3>Pick a date</h3><p>Choose an open morning or afternoon window. We only show times our crew can actually make.</p></div>
<div><h3>Secure it with a deposit</h3><p>Pay a small deposit by card through Stripe. Smaller jobs are paid in full up front.</p></div>
<div><h3>We do the work</h3><p>Our crew arrives in your window, completes the job, and you pay any balance after it's done.</p></div>
</div></div></section>

<section class="block"><div class="wrap split">
<div class="reveal"><div class="eyebrow">Fall is our busiest season</div><h2>Leaf cleanup, your way</h2>
<p>Every fall cleanup includes raking, blowing, piling and bagging front and back. Then you choose what happens to the leaves:</p>
<div class="grid g2" style="margin:18px 0 22px">
<div class="card flat"><h3>Bagged on site</h3><p class="fine" style="margin:0">Leaves are bagged and left where you tell us — curbside or another spot on your property. Lower price.</p></div>
<div class="card flat" style="border-color:var(--accent)"><h3>Haul-away</h3><p class="fine" style="margin:0">We load everything onto our truck and remove it. Transport and disposal are included in the haul-away fee.</p></div>
</div>
<a class="btn" href="/fall-cleanup/">See fall cleanup details</a></div>
<div class="reveal"><div class="ba" style="aspect-ratio:4/5"><img src="{img('fall2', 900)}" alt="{esc(PHOTOS['fall2'][1])}" loading="lazy"></div></div>
</div></section>

<section class="block alt"><div class="wrap">
<div class="stat-row reveal">
<div><b>3-person crew</b><span>A dedicated team on every job</span></div>
<div><b>~25 min</b><span>No travel fee within about 25 minutes of Islip</span></div>
<div><b>2 visits / month</b><span>Seasonal memberships with scheduled service</span></div>
<div><b>Card or Stripe</b><span>Secure online payments and receipts</span></div>
</div></div></section>

<section class="block"><div class="wrap split">
<div class="reveal"><div class="eyebrow">Monthly memberships</div><h2>Set it and forget it</h2><p>Join a seasonal plan and we'll come out twice a month on a schedule — no rebooking, no chasing anyone down. Winter members get priority after every qualifying snowfall.</p>
<ul class="checks"><li>Automatic monthly billing, with the price shown before you agree</li><li>Ends on its own at the end of the season — no surprise renewals</li><li>Cancel online any time</li></ul>
<a class="btn" href="/plans/">View Seasonal Plans</a></div>
<div class="card reveal"><h3>Plans start at</h3><table class="price-table"><tbody>
<tr><td>Spring Renewal Membership</td><td class="num"><span data-plan="spring">$189</span>/mo</td></tr>
<tr><td>Summer Lawn Maintenance</td><td class="num"><span data-plan="summer">$119</span>/mo</td></tr>
<tr><td>Fall Cleanup Membership</td><td class="num"><span data-plan="fall">$199</span>/mo</td></tr>
<tr><td>Winter Protection Membership</td><td class="num"><span data-plan="winter">$129</span>/mo</td></tr>
</tbody></table><p class="fine">Small-property prices shown, plus sales tax.</p></div>
</div></section>

<section class="block alt"><div class="wrap">
<div class="section-head reveal"><div class="eyebrow">Where we work</div><h2>Islip and most of Suffolk County</h2>
<p>We're based in Islip (11751). Properties within roughly 25 minutes' drive have no travel fee. Farther out, a modest travel fee is shown in your estimate before you pay. If you're beyond our usual area, request a quote anyway — we review every one.</p></div>
<p class="reveal"><a class="btn ghost" href="/estimate/">Check my address</a></p>
</div></section>

{cta_band()}
""", scripts=("home.js",))

# ---------- Services overview
pages["/services/"] = page("/services/", "Yard Care Services in Suffolk County", "Seasonal yard care services from All Season Yard Care Long Island: spring cleanups, lawn mowing and trimming, fall leaf cleanup and haul-away, and residential snow removal.",
  page_hero("Seasonal property care services", "A focused set of services done well, by a three-person crew based in Islip.", "spring", [("Home", "/"), ("Services", "/services/")]) + f"""
<section class="block"><div class="wrap"><div class="grid g2">{svc_cards()}</div></div></section>
<section class="block alt"><div class="wrap narrow">
<h2>What we don't do</h2><p>We'd rather be upfront than overpromise. We do <b>not</b> currently offer fertilization, pesticides, aeration, planting, mulching, irrigation, lawn treatments, landscape construction, tree work, or commercial/truck-mounted plowing. If you need those, we're happy to point you elsewhere.</p>
</div></section>{cta_band()}""", crumbs=[("Home", "/"), ("Services", "/services/")])

# ---------- service detail pages
def service_page(key, path, title, h1, sub, photo, intro, includes, excludes, pricing_html, faq, plan_text, seo_desc, extra=""):
    faq_html = "".join(f"<details><summary>{q}</summary><div><p>{a}</p></div></details>" for q, a in faq)
    schema = [{
        "@context": "https://schema.org", "@type": "Service", "serviceType": h1, "name": h1,
        "provider": {"@id": SITE + "/#business"}, "areaServed": "Suffolk County, NY", "url": SITE + path,
        "description": seo_desc,
    }, {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq]}]
    body = page_hero(h1, sub, photo, [("Home", "/"), ("Services", "/services/"), (h1, path)], eyebrow=title) + f"""
<section class="block"><div class="wrap split">
<div class="reveal">{intro}
<h2 style="margin-top:28px">What's included</h2><ul class="checks">{''.join(f'<li>{i}</li>' for i in includes)}</ul>
<h3 style="margin-top:22px">Not included</h3><ul class="xs">{''.join(f'<li>{x}</li>' for x in excludes)}</ul>
</div>
<aside class="card reveal" style="position:sticky;top:92px"><div class="eyebrow">Pricing</div>{pricing_html}
<div style="display:grid;gap:8px;margin-top:16px"><a class="btn gold block" href="/estimate/?service={key}">Get My Free Estimate</a><a class="btn block" href="/book/?service={key}">Book Now</a><a class="btn ghost block" href="tel:{PHONE_HREF}">Call {PHONE}</a></div>
<p class="fine" style="margin-top:12px">Estimates are based on what you tell us. Unusual conditions, inaccessible areas, inaccurate measurements or exceptional accumulation may require a revised quote — we'll always confirm before doing extra work.</p></aside>
</div></section>
{extra}
<section class="block alt"><div class="wrap split">
<div class="reveal"><div class="eyebrow">Monthly membership</div><h2>{plan_text[0]}</h2><p>{plan_text[1]}</p><a class="btn" href="/plans/#{key}">View Seasonal Plans</a></div>
<div class="faq reveal"><h2>Questions</h2>{faq_html}</div>
</div></section>
{cta_band(season=key)}"""
    return page(path, title, seo_desc, body, schema=schema, season=key, crumbs=[("Home", "/"), ("Services", "/services/"), (h1, path)], og_image=img(photo, 1200))

pages["/fall-cleanup/"] = service_page("fall", "/fall-cleanup/", "Fall Cleanup & Leaf Removal in Islip, NY",
  "Fall Cleanup & Leaf Removal", "Leaf raking, blowing, piling and bagging front and back — left bagged at your curb or hauled away on our truck.", "fall",
  "<p>Fall is our primary service. A three-person crew works through your front and back yard, clears leaves from the lawn, piles and bags everything, and leaves the property clean. You choose how the leaves leave your property:</p><div class='grid g2' style='margin-top:14px'><div class='card flat'><h3>Option A: Bagged on site</h3><p class='fine' style='margin:0'>Leaves are collected and bagged and the bags stay at the spot you choose — usually curbside. This is the lower-priced option. We don't control town collection schedules, so check your town's yard-waste pickup rules.</p></div><div class='card flat' style='border-color:var(--accent)'><h3>Option B: Haul-away</h3><p class='fine' style='margin:0'>Leaves are loaded onto our truck and removed from your property. Transportation and disposal costs are included in the haul-away fee, which scales with volume.</p></div></div>",
  ["Leaf raking and blowing", "Front-yard and backyard cleanup (or just one — your choice)", "Leaf piling, collection and organization", "Bagging (bags supplied by us)", "Optional: blow-off of driveway, patio and walkways", "Optional: clearing leaves from beds, fence lines and corners", "Optional: haul-away of all collected leaves"],
  ["Gutter cleaning, tree or shrub trimming", "Fertilizing, aeration or lawn treatments", "Promises about town collection dates — we can't control municipal pickup"],
  """<table class="price-table"><thead><tr><th>Property</th><th>Typical starting price</th></tr></thead><tbody>
<tr><td>Small</td><td class="num">from <span data-base="fall.small">$225</span></td></tr>
<tr><td>Medium</td><td class="num">from <span data-base="fall.medium">$325</span></td></tr>
<tr><td>Large</td><td class="num">from <span data-base="fall.large">$525</span></td></tr>
<tr><td>Extra large</td><td class="num">Custom quote</td></tr>
<tr><td>Haul-away</td><td class="num">+<span data-haul="fall.small">$40</span>–<span data-haul="fall.large">$110</span>+</td></tr></tbody></table>
<p class="fine">Heavy accumulation, many trees or difficult access add to the price; light jobs or front-only cleanups cost less. Travel fee applies beyond ~25 minutes from Islip. Plus NY sales tax.</p>""",
  [("Do you haul the leaves away?", "Only if you choose haul-away. Otherwise we bag the leaves and leave the bags at the spot on your property you choose. Haul-away costs more because it includes loading, transport and disposal."),
   ("Do you provide the bags?", "Yes — bags are included in the price."),
   ("When will the town pick up the bags?", "That depends on your town's yard-waste schedule, which we don't control. Check your town's website for pickup rules and dates."),
   ("Can I book more than one cleanup?", "Yes. Many properties need two or three passes as the trees drop. Fall members get two scheduled visits per month and can request extra visits.")],
  ("Fall Cleanup Membership", "Two scheduled cleanup visits per month through the fall season, billed monthly. Extra visits can be requested when the trees drop heavily."),
  "Fall leaf cleanup and leaf removal in Islip and Suffolk County. Raking, blowing, bagging front and back, with curbside bagging or haul-away. Instant online estimate.")

pages["/winter-snow-removal/"] = service_page("winter", "/winter-snow-removal/", "Driveway Snow Removal & Salting in Islip, NY",
  "Winter Snow & Ice Removal", "Residential driveway and walkway snow clearing with snowblower and shovel, plus salting and de-icing.", "winter",
  "<p>After a storm, our crew clears your driveway and walkways using a snowblower and shovels, cleans up accumulation, and salts trouble spots if you choose. We serve residential properties only — we don't run commercial plows or truck-mounted plowing equipment.</p><p>Book a single visit, or join the <b>Winter Protection Membership</b> for priority service after every qualifying snowfall.</p>",
  ["Residential driveway snow clearing", "Walkway and front-step clearing", "Snowblower clearing and hand shoveling", "Snow accumulation cleanup", "Optional salting and de-icing"],
  ["Commercial lots or truck-mounted plowing", "Roof snow removal", "Unlimited visits for a flat monthly price", "Guaranteed arrival times during active storms — we work through member properties in route order"],
  """<table class="price-table"><thead><tr><th>Driveway</th><th>Per visit from</th></tr></thead><tbody>
<tr><td>Small (1–2 cars)</td><td class="num"><span data-snow="small">$75</span></td></tr>
<tr><td>Medium (3–4 cars / double)</td><td class="num"><span data-snow="medium">$100</span></td></tr>
<tr><td>Large (long or 5+ cars)</td><td class="num"><span data-snow="large">$135</span></td></tr>
<tr><td>Salting / de-icing</td><td class="num">+<span data-salt="small">$25</span>–<span data-salt="large">$40</span></td></tr></tbody></table>
<p class="fine">Deeper snow (6"+), long walkways and heavy ice cost more. Plus NY sales tax.</p>""",
  [("What's the snowfall trigger?", "Membership visits are triggered by <span data-trigger>2</span> inches or more of snowfall, as reported by the National Weather Service for the Islip area. You can always request a visit for lighter snow at the regular per-visit price."),
   ("Is the membership unlimited?", "No. Each month includes a set number of visits (currently <span data-included>2</span>). Additional storm visits are billed to your card at a member discount. We don't sell unlimited snow removal because storms are unpredictable and we want our pricing to stay fair and sustainable."),
   ("Is salting included?", "Salting is an add-on, priced by driveway size, so you only pay for it when you want it."),
   ("How fast will you come?", "Members get priority. We start after the snow stops (or during long storms when it's safe), and work through properties in route order. We can't guarantee an exact time during an active storm.")],
  ("Winter Protection Membership", "Recurring monthly billing during the winter season with priority scheduling, a set number of included visits after 2\"+ snowfall, discounted extra visits, and optional salting. All terms are shown before you pay."),
  "Residential snow removal in Islip and Suffolk County: driveway and walkway clearing with snowblower and shovel, salting and de-icing, and a winter membership with priority service.",
  extra=f"""<section class="block tight"><div class="wrap"><div class="notice info reveal"><p><b>Winter membership terms at a glance:</b> monthly billing from <span data-season-label-winter>December to mid-March</span> · <span data-included>2</span> included visits per month after <span data-trigger>2</span>"+ snowfall (up to <span data-maxdepth>12</span>" per visit) · extra visits at member pricing · salting optional · billing ends automatically at season end · cancel online any time. Full terms on the <a href="/plans/#winter">plans page</a> and in our <a href="/terms/#snow">Terms of Service</a>.</p></div></div></section>""")

pages["/spring-renewal/"] = service_page("spring", "/spring-renewal/", "Spring Yard Cleanup in Islip, NY",
  "Spring Renewal", "Winter debris, leftover leaves and yard mess cleared out, raked, blown and bagged — with optional haul-away.", "spring",
  "<p>After winter, most yards are left with leftover leaves, sticks, and debris tangled in the lawn and along fences. Our crew clears it all so your property is clean and ready for the season.</p>",
  ["General yard debris collection (sticks, leftover leaves, winter mess)", "Removal of accumulated leaves", "Raking and blowing", "General lawn-area cleanup", "Collection and bagging of debris", "Optional haul-away"],
  ["Planting, mulching or landscape construction", "Fertilization or lawn treatments", "Tree work or large stump/branch removal"],
  """<table class="price-table"><thead><tr><th>Property</th><th>Typical starting price</th></tr></thead><tbody>
<tr><td>Small</td><td class="num">from <span data-base="spring.small">$225</span></td></tr>
<tr><td>Medium</td><td class="num">from <span data-base="spring.medium">$325</span></td></tr>
<tr><td>Large</td><td class="num">from <span data-base="spring.large">$475</span></td></tr>
<tr><td>Haul-away</td><td class="num">+<span data-haul="spring.small">$35</span>–<span data-haul="spring.large">$95</span>+</td></tr></tbody></table>
<p class="fine">Priced by property size, debris volume, labor and disposal. Plus NY sales tax.</p>""",
  [("What's the difference between bagging and haul-away?", "With bagging, debris is bagged and left where you choose on your property. With haul-away, we load it on our truck and remove it — disposal is included in that fee."),
   ("Do you do planting or mulching?", "No. Spring Renewal is a cleanup service only. We don't offer planting, mulching, fertilizing or landscape construction."),
   ("How long does it take?", "Most small and medium properties take our three-person crew a few hours.")],
  ("Spring Renewal Membership", "Two scheduled maintenance visits per month through the spring season to keep debris and leftover leaves under control."),
  "Spring yard cleanup in Islip and Suffolk County: debris and leftover leaf removal, raking, blowing and bagging, with optional haul-away. Get an instant estimate online.")

pages["/summer-lawn-maintenance/"] = service_page("summer", "/summer-lawn-maintenance/", "Lawn Mowing & Weed Whacking in Islip, NY",
  "Summer Lawn Maintenance", "Professional lawn mowing and string trimming — priced by your actual mowable lawn area.", "summer",
  "<p>We keep this simple: we <b>mow</b> and we <b>string-trim</b> (weed whack). That's it. Prices are based on your mowable lawn area — not your total lot size — plus the time trimming takes around obstacles.</p>",
  ["Lawn mowing", "String trimming / weed whacking along edges, fences, beds and obstacles", "Blow-off of clippings from hard surfaces"],
  ["Fertilization", "Pesticides or weed treatments", "Aeration or seeding", "Landscaping, planting or mulching", "Irrigation", "Any other lawn treatment"],
  """<table class="price-table"><thead><tr><th>Mowable lawn</th><th>Mow + trim from</th></tr></thead><tbody>
<tr><td>Up to 4,000 sq ft</td><td class="num"><span data-band="0">$80</span></td></tr>
<tr><td>4,000 – 8,000 sq ft</td><td class="num"><span data-band="1">$95</span></td></tr>
<tr><td>8,000 – 14,000 sq ft</td><td class="num"><span data-band="2">$125</span></td></tr>
<tr><td>14,000 – 22,000 sq ft</td><td class="num"><span data-band="3">$165</span></td></tr>
<tr><td>Larger</td><td class="num">Custom quote</td></tr></tbody></table>
<p class="fine">Price includes standard string trimming. Overgrown first cuts, many obstacles or heavy trimming cost more. Monthly plans (2 visits) cost less per visit than booking separately. Plus NY sales tax.</p>""",
  [("How do I know my lawn size?", "Our estimator walks you through it, and you can upload a photo. A typical quarter-acre lot often has around 5,000–8,000 sq ft of mowable lawn once you subtract the house, driveway and beds. We'll confirm on the first visit."),
   ("Do you fertilize or treat weeds?", "No. We only mow and string-trim."),
   ("How often do members get mowed?", "The Summer Lawn Maintenance Membership includes two scheduled mowing and trimming visits per month.")],
  ("Summer Lawn Maintenance Membership", "Two scheduled mowing and trimming visits per month, billed monthly — less per visit than booking individually."),
  "Lawn mowing and weed whacking (string trimming) in Islip and Suffolk County, priced by mowable lawn area. Single visits or a two-visit monthly plan.")

# ---------- estimate / book (same app)
EST_BODY = """<div id="est-app" class="wizard" data-mode="{mode}">
<div class="panel"><div class="progress" aria-hidden="true"></div>
<form id="est-form" novalidate autocomplete="on">
<div class="step" data-step="service"><h2>What do you need?</h2><p class="sub">Choose the service you want priced.</p>
<div class="choice-grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">
<label class="choice big"><input type="radio" name="service" value="fall"><span><i class="c-fall"></i>Fall Cleanup<small>Leaf raking, blowing, bagging or haul-away</small></span></label>
<label class="choice big"><input type="radio" name="service" value="winter"><span><i class="c-winter"></i>Snow &amp; Ice Removal<small>Driveway, walkways, salting</small></span></label>
<label class="choice big"><input type="radio" name="service" value="spring"><span><i class="c-spring"></i>Spring Renewal<small>Debris and leftover leaf cleanup</small></span></label>
<label class="choice big"><input type="radio" name="service" value="summer"><span><i class="c-summer"></i>Lawn Mowing<small>Mowing + string trimming</small></span></label>
</div><p class="fine" style="margin-top:14px">Looking for a monthly plan? <a href="/plans/">See seasonal memberships</a>.</p></div>

<div class="step" data-step="address"><h2>Where's the property?</h2><p class="sub">We'll check the driving time from Islip so any travel fee is shown up front.</p>
<div class="field"><label for="addr">Street address, town and ZIP</label><input id="addr" name="address" type="text" autocomplete="street-address" placeholder="e.g. 12 Main St, Islip, NY 11751" required></div>
<div id="travel-out" aria-live="polite"></div></div>

<div class="step" data-step="details"><h2>Tell us about the property</h2><p class="sub">Rough answers are fine — we'll confirm anything unusual.</p><div id="detail-fields"></div></div>

<div class="step" data-step="estimate"><h2>Your estimate</h2><p class="sub">Here's what we'd expect to charge based on your answers.</p><div id="est-out" aria-live="polite"></div>
<div class="notice warn" style="margin-top:16px"><p>This is a preliminary estimate, not a guaranteed final price. Unusual conditions, inaccessible areas, inaccurate measurements or exceptional accumulation may require a revised quote. We'll always confirm with you before doing extra work.</p></div></div>

<div class="step" data-step="schedule"><h2 id="sched-title">Pick a date</h2><p class="sub" id="sched-sub">Only times our crew can actually make are shown.</p><div id="slots-out"></div></div>

<div class="step" data-step="contact"><h2>Your details</h2><p class="sub">So we can confirm your booking and reach you if the weather changes plans.</p>
<div class="row2"><div class="field"><label for="c-name">Full name</label><input id="c-name" name="name" type="text" autocomplete="name" required></div>
<div class="field"><label for="c-phone">Mobile phone</label><input id="c-phone" name="phone" type="tel" autocomplete="tel" required></div></div>
<div class="field"><label for="c-email">Email</label><input id="c-email" name="email" type="email" autocomplete="email" required></div>
<div class="field"><label for="c-access">Access instructions <span class="hint">(gate codes, dogs, where to leave bags…)</span></label><textarea id="c-access" name="accessNotes" maxlength="1000"></textarea></div>
<div class="field"><label for="c-notes">Anything else we should know? <span class="hint">(optional)</span></label><textarea id="c-notes" name="notes" maxlength="2000"></textarea></div>
<div class="field"><label>Property photos <span class="hint">(optional, up to 8 — helps us confirm your price)</span></label>
<label class="photo-drop" for="c-photos"><b>Tap to add photos</b><br><span class="fine">Photos are resized on your phone before uploading.</span></label><input id="c-photos" type="file" accept="image/*" multiple class="sr-only"><div class="photo-thumbs" id="thumbs"></div></div>
<div class="hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>
<label class="check" style="margin-top:10px"><input type="checkbox" name="terms" required><span>I understand this is an estimate that may be revised for conditions that differ from my description, and I agree to the <a href="/terms/" target="_blank">Terms of Service</a>, <a href="/cancellation-refund-policy/" target="_blank">Cancellation &amp; Refund Policy</a> and <a href="/privacy/" target="_blank">Privacy Policy</a>.</span></label>
<div id="submit-out" aria-live="polite" style="margin-top:14px"></div></div>

<div class="step" data-step="done"><div id="done-out"></div></div>

<div class="step-nav"><button type="button" class="btn ghost" data-back>Back</button><button type="button" class="btn" data-next>Continue</button></div>
</form></div>
<aside class="summary"><div class="card"><h3>Estimate summary</h3><div id="sum"><p class="fine">Choose a service to start.</p></div></div>
<p class="fine" style="margin-top:12px">Prefer to talk? Call or text <a href="tel:""" + PHONE_HREF + """">""" + PHONE + """</a>.</p></aside>
</div>"""

pages["/estimate/"] = page("/estimate/", "Instant Yard Care Estimate", "Get an instant, itemized estimate for fall leaf cleanup, snow removal, lawn mowing or spring cleanup in Suffolk County — including travel fees — then book and pay a deposit online.",
  page_hero("Instant estimate", "An itemized price in about two minutes. No account needed, and nothing is charged unless you choose to book.", None, [("Home", "/"), ("Instant Estimate", "/estimate/")], eyebrow="Free · No obligation") +
  f'<section class="block tight"><div class="wrap">{EST_BODY.format(mode="estimate")}</div></section>', scripts=("estimate.js",), crumbs=[("Home", "/"), ("Instant Estimate", "/estimate/")])

pages["/book/"] = page("/book/", "Book a Yard Care Service Online", "Book fall cleanup, snow clearing, lawn mowing or spring cleanup online: see your price, choose an available date and secure it with a deposit.",
  page_hero("Book a service", "Get your price, pick an open time window, and secure it with a deposit. It takes about three minutes.", None, [("Home", "/"), ("Book", "/book/")], eyebrow="Online booking") +
  f'<section class="block tight"><div class="wrap">{EST_BODY.format(mode="book")}</div></section>', scripts=("estimate.js",), crumbs=[("Home", "/"), ("Book", "/book/")])

# ---------- plans
def plan_card(key, name, photo, blurb, items):
    return f"""<div class="card plan reveal" id="{key}" data-plan-card="{key}"><span class="tag" style="position:static;display:inline-flex;gap:6px;align-items:center;font-size:.74rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:8px"><i class="{SEASON_COLOR[key]}" style="width:8px;height:8px;border-radius:50%;display:inline-block"></i>{key.title()} · <span data-season-text="{key}"></span></span>
<h3>{name}</h3><p class="fine">{blurb}</p>
<div class="tiers" role="group" aria-label="Property size"><button type="button" data-tier="small" aria-pressed="true">Small</button><button type="button" data-tier="medium" aria-pressed="false">Medium</button><button type="button" data-tier="large" aria-pressed="false">Large</button></div>
<div class="amt"><span data-plan-amt>—</span> <small>/ month + tax</small></div>
<ul class="checks" style="margin-top:14px">{''.join(f'<li>{i}</li>' for i in items)}</ul>
<button type="button" class="btn block" data-join="{key}">Join this plan</button>
<div class="status" data-plan-status></div></div>"""

pages["/plans/"] = page("/plans/", "Seasonal Monthly Maintenance Plans", "Monthly yard care memberships for Spring, Summer mowing, Fall cleanup and Winter snow removal in Suffolk County. Two scheduled visits per month, clear terms, cancel online any time.",
  page_hero("Seasonal monthly plans", "Two scheduled visits a month during the season, billed monthly. Every price and term is shown before you agree — and plans end automatically at season's end.", "summer", [("Home", "/"), ("Monthly Plans", "/plans/")], eyebrow="Memberships") + f"""
<section class="block"><div class="wrap">
<div class="grid g2" id="plans">
{plan_card('fall', 'Fall Cleanup Membership', 'fall', 'Two scheduled leaf cleanup visits per month through the fall season.', ['2 scheduled cleanup visits per month', 'Raking, blowing, bagging front &amp; back', 'Request extra visits when trees drop heavily', 'Haul-away available as an add-on'])}
{plan_card('winter', 'Winter Protection Membership', 'winter', 'Priority snow clearing after qualifying snowfall, billed monthly through winter.', ['Priority service after <span data-trigger>2</span>"+ snowfall', '<span data-included>2</span> included visits per month (up to <span data-maxdepth>12</span>" each)', 'Extra storm visits at a member discount', 'Optional salting, priced by driveway size'])}
{plan_card('spring', 'Spring Renewal Membership', 'spring', 'Two scheduled debris and cleanup visits per month in spring.', ['2 scheduled maintenance visits per month', 'Debris and leftover leaf removal', 'Raking, blowing and bagging', 'Optional haul-away'])}
{plan_card('summer', 'Summer Lawn Maintenance Membership', 'summer', 'Two scheduled mowing and trimming visits per month — less per visit than single bookings.', ['2 scheduled mow + trim visits per month', 'Mowing and string trimming only', 'Priced by mowable lawn area', 'Skip-a-visit for drought with notice'])}
</div>

<div class="card" id="join-panel" hidden style="margin-top:28px;max-width:760px">
<h2 id="join-title">Join</h2>
<form id="join-form" novalidate>
<div class="notice" id="join-terms"></div>
<div class="row2" style="margin-top:16px"><div class="field"><label for="j-name">Full name</label><input id="j-name" name="name" required autocomplete="name"></div><div class="field"><label for="j-phone">Mobile phone</label><input id="j-phone" name="phone" type="tel" required autocomplete="tel"></div></div>
<div class="field"><label for="j-email">Email</label><input id="j-email" name="email" type="email" required autocomplete="email"></div>
<div class="field"><label for="j-addr">Service address, town and ZIP</label><input id="j-addr" name="address" required autocomplete="street-address"></div>
<div class="hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>
<label class="check"><input type="checkbox" name="recurring" required><span id="j-recurring-text">I authorize recurring monthly charges as described above.</span></label>
<label class="check" style="margin-top:10px"><input type="checkbox" name="terms" required><span>I agree to the <a href="/terms/" target="_blank">Terms of Service</a> (including <a href="/terms/#memberships" target="_blank">membership terms</a>) and <a href="/cancellation-refund-policy/" target="_blank">Cancellation Policy</a>.</span></label>
<div id="join-out" aria-live="polite" style="margin-top:14px"></div>
<div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap"><button class="btn gold" type="submit">Continue to secure payment</button><button class="btn ghost" type="button" data-cancel-join>Cancel</button></div>
<p class="fine" style="margin-top:12px">You'll enter your card on Stripe's secure checkout page. You won't be charged until you confirm there.</p>
</form></div>
</div></section>
<section class="block alt"><div class="wrap narrow faq"><h2>Membership basics</h2>
<details><summary>How does billing work?</summary><div><p>You're charged the monthly price plus NY sales tax on the same day each month during the season. If you join before the season starts, your first charge happens on the season start date. Billing stops automatically at the end of the season — you won't be renewed into next year.</p></div></details>
<details><summary>How do I cancel?</summary><div><p>Sign in to <a href="/account/">My Account</a> and click cancel, or use the secure Stripe billing portal linked there. Cancellation takes effect at the end of the month you've already paid for, and you won't be charged again.</p></div></details>
<details><summary>What property size am I?</summary><div><p>Small is roughly up to 1/8 acre, Medium about 1/8–1/4 acre, Large about 1/4–1/2 acre. Bigger properties get a custom quote. For winter, size refers to your driveway. If the size you picked doesn't match what we find on the first visit, we'll talk to you before changing anything.</p></div></details>
<details><summary>Can I upgrade, downgrade or add services?</summary><div><p>Yes — call or email us and we'll change your plan size or book extra visits. Changes take effect from your next billing date.</p></div></details>
<details><summary>What happens if a payment fails?</summary><div><p>Stripe retries automatically and we'll email you to update your card. Service may pause until the payment goes through.</p></div></details>
</div></section>
{cta_band('Not sure a plan is right for you?', 'Get a one-time estimate first — you can always join a plan later.')}""", scripts=("plans.js",), crumbs=[("Home", "/"), ("Monthly Plans", "/plans/")])

# ---------- about
pages["/about/"] = page("/about/", "About Us", "All Season Yard Care Long Island is a three-person seasonal property care crew based in Islip, NY, serving most of Suffolk County.",
  page_hero("About All Season Yard Care", "A local, three-person crew focused on doing a few seasonal services really well.", "fall2", [("Home", "/"), ("About", "/about/")]) + f"""
<section class="block"><div class="wrap split">
<div class="reveal"><h2>Who we are</h2>
<p>All Season Yard Care Long Island is a residential property maintenance company based in Islip, NY. We're a three-person crew with a truck, a snowblower, and the equipment to do our services properly: rakes, blowers, shovels, salt spreaders, a lawn mower and string trimmers.</p>
<p>We keep our service list short on purpose. Fall leaf cleanups, winter snow and ice clearing, spring debris cleanups, and summer mowing and trimming. That's it — and that focus lets us show up on time, price honestly, and leave every property clean.</p>
<h2 style="margin-top:28px">How we work</h2>
<ul class="checks"><li><b>Clear prices up front.</b> Our online estimator shows an itemized price, including any travel fee, before you book.</li><li><b>Real availability.</b> We only offer appointment windows our crew can actually make.</li><li><b>No surprise charges.</b> If your property needs more work than described, we talk to you first.</li><li><b>Honest about what we don't do.</b> No fertilizing, treatments, planting or commercial plowing.</li></ul>
</div>
<div class="card reveal"><h3>The essentials</h3><dl class="kv"><dt>Based in</dt><dd>Islip, NY 11751</dd><dt>Service area</dt><dd>Most of Suffolk County</dd><dt>Crew</dt><dd>Three people</dd><dt>Phone</dt><dd><a href="tel:{PHONE_HREF}">{PHONE}</a></dd><dt>Email</dt><dd><a href="mailto:{EMAIL}">{EMAIL}</a></dd><dt>Payments</dt><dd>Card via Stripe</dd></dl></div>
</div></section>{cta_band()}""", crumbs=[("Home", "/"), ("About", "/about/")])

# ---------- gallery
pages["/gallery/"] = page("/gallery/", "Before & After Gallery", "Before and after photos of real fall cleanups, snow clearing, spring cleanups and lawn mowing by All Season Yard Care Long Island.",
  page_hero("Before &amp; after", "Real jobs, real results. Drag the slider to compare.", None, [("Home", "/"), ("Gallery", "/gallery/")]) + """
<section class="block"><div class="wrap"><div class="filter-bar" role="group" aria-label="Filter by service"><button type="button" data-f="all" aria-pressed="true">All</button><button type="button" data-f="fall" aria-pressed="false">Fall</button><button type="button" data-f="winter" aria-pressed="false">Winter</button><button type="button" data-f="spring" aria-pressed="false">Spring</button><button type="button" data-f="summer" aria-pressed="false">Summer</button></div>
<div id="gallery" class="grid g3"><div class="empty" style="grid-column:1/-1"><span class="spinner dark"></span></div></div></div></section>""" + cta_band(), scripts=("gallery.js",), crumbs=[("Home", "/"), ("Gallery", "/gallery/")])

# ---------- reviews
pages["/reviews/"] = page("/reviews/", "Customer Reviews", "Reviews from All Season Yard Care Long Island customers in Islip and Suffolk County.",
  page_hero("Customer reviews", "Every review here comes from a customer whose job we completed.", None, [("Home", "/"), ("Reviews", "/reviews/")]) + """
<section class="block"><div class="wrap"><div id="reviews" class="grid g3"><div class="empty" style="grid-column:1/-1"><span class="spinner dark"></span></div></div>
<div class="card" style="margin-top:28px;max-width:720px"><h3>Had us out recently?</h3><p>After each completed job we email you a private link to leave a review. You can also find it on your booking page in <a href="/account/">My Account</a>.</p><p id="google-review"></p></div></div></section>""" + cta_band(), scripts=("reviews.js",), crumbs=[("Home", "/"), ("Reviews", "/reviews/")])

# ---------- FAQ
FAQ = [
  ("How does pricing work?", "Prices depend on the service, your property size and conditions (like leaf volume, lawn area or driveway size), any add-ons you choose, and drive time from Islip. Our online estimator shows an itemized price before you book. Prices are plus NY sales tax, which applies to lawn care and snow removal services in New York."),
  ("How far do you travel?", "We're based in Islip (11751) and serve most of Suffolk County. Properties within about 25 minutes' drive have no travel fee. Beyond that, a modest travel fee is shown in your estimate before checkout. If you're farther out, you can still request a quote — we review every one."),
  ("Do you haul the leaves away?", "Only if you choose haul-away. Our standard fall cleanup bags the leaves and leaves the bags at the spot you choose. Haul-away is an add-on: we load everything onto our truck and remove it, and disposal is included in that fee."),
  ("Do you provide the bags?", "Yes. Bags are included in the price of bagging cleanups."),
  ("What's the snowfall trigger for winter members?", "Membership visits are triggered by 2 inches or more of snowfall, as reported by the National Weather Service for the Islip area. Members can request a visit for lighter snow at the regular per-visit price."),
  ("Is salting included?", "Salting and de-icing is an optional add-on priced by driveway size. Choose it per visit or ask us to include it whenever it's needed."),
  ("Why do you take a booking deposit?", "A deposit holds your date and crew time. It's applied to your total, and the remaining balance is due after the job is done. Smaller jobs are paid in full at booking."),
  ("How do I cancel a subscription?", "Sign in to My Account and cancel your membership online, or use the secure Stripe billing portal linked there. Cancellation takes effect at the end of the month you've already paid for. Memberships also end automatically at the end of each season."),
  ("What happens if the weather delays my appointment?", "Rain, wind, frozen ground or snow can make some work unsafe or ineffective. If that happens, we'll contact you to reschedule at no charge. We never cancel your booking automatically — you'll always hear from us."),
  ("Will I ever be charged more than my estimate?", "Not without talking to you first. If conditions are significantly different from what was described — much more debris, inaccessible areas, or inaccurate measurements — we'll give you a revised quote before doing extra work. You can accept it or cancel."),
  ("What services don't you offer?", "We don't offer fertilization, pesticides, aeration, planting, mulching, irrigation, lawn treatments, landscape construction, tree work or commercial/truck-mounted plowing."),
  ("How do I pay?", "By card through Stripe, our secure payment processor. You'll receive a receipt by email. We never see or store your full card number."),
]
pages["/faq/"] = page("/faq/", "Frequently Asked Questions", "Answers about pricing, travel fees, leaf haul-away, bags, snowfall triggers, salting, deposits, subscription cancellation and weather delays.",
  page_hero("Frequently asked questions", "Straight answers about pricing, scheduling and how we work.", None, [("Home", "/"), ("FAQ", "/faq/")]) +
  '<section class="block"><div class="wrap narrow faq">' + "".join(f"<details><summary>{q}</summary><div><p>{a}</p></div></details>" for q, a in FAQ) + "</div></section>" + cta_band(),
  schema={"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQ]},
  crumbs=[("Home", "/"), ("FAQ", "/faq/")])

# ---------- contact
pages["/contact/"] = page("/contact/", "Contact Us & Request a Custom Quote", "Call or text All Season Yard Care Long Island at (631) 800-9643, email asyclongisland@gmail.com, or request a custom quote online.",
  page_hero("Contact us", "Call, text or email — or send a custom quote request and we'll get back to you within one business day.", None, [("Home", "/"), ("Contact", "/contact/")]) + f"""
<section class="block"><div class="wrap split">
<div><div class="card"><h2>Request a custom quote</h2><p class="fine">For large properties, unusual jobs, or anything our estimator doesn't cover.</p>
<form id="quote-form" novalidate>
<div class="field"><label for="q-service">Service</label><select id="q-service" name="service"><option value="fall">Fall Cleanup</option><option value="winter">Snow &amp; Ice Removal</option><option value="spring">Spring Renewal</option><option value="summer">Lawn Mowing</option></select></div>
<div class="row2"><div class="field"><label for="q-name">Full name</label><input id="q-name" name="name" required autocomplete="name"></div><div class="field"><label for="q-phone">Phone</label><input id="q-phone" name="phone" type="tel" required autocomplete="tel"></div></div>
<div class="field"><label for="q-email">Email</label><input id="q-email" name="email" type="email" required autocomplete="email"></div>
<div class="field"><label for="q-addr">Property address</label><input id="q-addr" name="address" required autocomplete="street-address"></div>
<div class="field"><label for="q-notes">Describe the job</label><textarea id="q-notes" name="notes" required></textarea></div>
<div class="hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>
<label class="check"><input type="checkbox" name="terms" required><span>I agree to the <a href="/terms/" target="_blank">Terms</a> and <a href="/privacy/" target="_blank">Privacy Policy</a>.</span></label>
<div id="quote-out" aria-live="polite" style="margin-top:12px"></div>
<button class="btn gold" type="submit" style="margin-top:14px">Request a Custom Quote</button></form></div></div>
<div><div class="card"><h3>Reach us directly</h3><dl class="kv"><dt>Phone / text</dt><dd><a href="tel:{PHONE_HREF}">{PHONE}</a></dd><dt>Email</dt><dd><a href="mailto:{EMAIL}">{EMAIL}</a></dd><dt>Based in</dt><dd>Islip, NY 11751</dd><dt>Service area</dt><dd>Most of Suffolk County</dd></dl>
<p class="fine" style="margin-top:14px">We're a working crew — if we don't pick up, we're probably on a job. Leave a message or text and we'll get right back to you.</p></div>
<div class="card" style="margin-top:16px"><h3>Faster: get an instant price</h3><p class="fine">Most jobs can be priced and booked online in a few minutes.</p><a class="btn" href="/estimate/">Get My Free Estimate</a></div></div>
</div></section>""", scripts=("contact.js",), crumbs=[("Home", "/"), ("Contact", "/contact/")])

# ---------- account, booking manage, admin
pages["/account/"] = page("/account/", "My Account", "Sign in to view your appointments, payments, receipts and memberships.",
  page_hero("My account", "Appointments, payments, receipts and memberships in one place.", None) +
  '<section class="block tight"><div class="wrap" id="account-app"><div class="empty"><span class="spinner dark"></span></div></div></section>', scripts=("account.js",), robots="noindex,nofollow")

pages["/booking/"] = page("/booking/", "Your Booking", "View and manage your booking.",
  '<section class="block tight"><div class="wrap narrow" id="booking-app"><div class="empty"><span class="spinner dark"></span></div></div></section>', scripts=("booking.js",), robots="noindex,nofollow")

pages["/admin/"] = page("/admin/", "Owner Dashboard", "Private owner dashboard.",
  '<section class="block tight"><div class="wrap" id="admin-app" style="width:min(1320px,100% - 32px)"><div class="empty"><span class="spinner dark"></span></div></div></section>', scripts=("admin.js",), robots="noindex,nofollow")

# ---------- legal (drafts — flagged for owner review)
LEGAL_NOTE = '<div class="notice warn"><p><b>Draft for owner review.</b> This policy was prepared as a starting point and should be reviewed by the business owner (and ideally a New York attorney) before relying on it. Items marked [OWNER TO CONFIRM] need business-specific information.</p></div>'
def legal(path, title, desc, sections):
    body = page_hero(title, "Last updated: November 2026", None, [("Home", "/"), (title, path)]) + f'<section class="block"><div class="wrap narrow">{LEGAL_NOTE}' + "".join(f'<h2 id="{sid}" style="margin-top:32px">{h}</h2>{c}' for sid, h, c in sections) + "</div></section>"
    return page(path, title, desc, body, crumbs=[("Home", "/"), (title, path)])

pages["/privacy/"] = legal("/privacy/", "Privacy Policy", "How All Season Yard Care Long Island collects, uses and protects your information.", [
 ("collect", "Information we collect", "<p>When you request an estimate, book, or join a membership we collect your name, email, phone number, service address, details about your property, any photos you upload, and access instructions. When you pay, our payment processor Stripe collects your card details directly — <b>we never receive or store your full card number</b>. We keep records of bookings, payments, receipts and the consent you give to our terms and to recurring billing.</p><p>Like most websites, our hosting providers may log basic technical information (such as IP address and browser type) for security and to prevent abuse. We don't use advertising trackers.</p>"),
 ("use", "How we use it", "<p>To price and schedule your service, travel to your property, process payments, send booking confirmations, reminders, receipts, weather-related schedule changes and membership notices, respond to your questions, and keep business, tax and accounting records. With your consent we may invite you to leave a review.</p>"),
 ("share", "Who we share it with", "<p>We don't sell your information. We share it only with service providers that help us operate: Stripe (payments), Supabase (secure database and file storage), our email delivery provider, the U.S. Census Bureau geocoder (your address, to estimate drive time), and Open-Meteo (approximate property location, for weather forecasts). We may disclose information if required by law.</p>"),
 ("retain", "How long we keep it", "<p>We keep booking and payment records as long as needed for our business and as required for tax and accounting purposes. Property photos are kept while they're useful for your service. You can ask us to delete information we're not required to keep.</p>"),
 ("rights", "Your choices", f"<p>You can view your bookings and payments in My Account, ask us to correct or delete your information, or opt out of non-essential emails by contacting <a href=\"mailto:{EMAIL}\">{EMAIL}</a>. Service-related messages (like booking confirmations and receipts) are part of providing the service.</p>"),
 ("security", "Security", "<p>Data is transmitted over HTTPS and stored with access controls. Card payments are handled entirely by Stripe, which is PCI-DSS certified.</p>"),
 ("contact", "Contact", f"<p>{NAME}, Islip, NY 11751 · <a href=\"tel:{PHONE_HREF}\">{PHONE}</a> · <a href=\"mailto:{EMAIL}\">{EMAIL}</a>. [OWNER TO CONFIRM: mailing address for legal notices, if required.]</p>"),
])

pages["/terms/"] = legal("/terms/", "Terms of Service", "Terms for estimates, bookings, deposits, memberships and snow removal services from All Season Yard Care Long Island.", [
 ("services", "1. Services", "<p>We provide residential seasonal property maintenance: spring debris cleanup, lawn mowing and string trimming, fall leaf cleanup (bagging or haul-away), and residential snow and ice removal. We don't provide fertilization, pesticides, aeration, planting, mulching, irrigation, lawn treatments, landscape construction, tree work, or commercial or truck-mounted plowing.</p>"),
 ("estimates", "2. Estimates", "<p>Online estimates are preliminary and based on the information you provide. They are not a guaranteed final price. If conditions differ materially from your description — for example unusual conditions, inaccessible areas, inaccurate measurements, or exceptional accumulation — we will give you a revised quote before performing additional work. You may accept the revised quote or cancel, and any deposit will be handled under our Cancellation &amp; Refund Policy. Prices are subject to applicable New York State and local sales tax.</p>"),
 ("booking", "3. Bookings, deposits and payment", "<p>A booking is confirmed when we receive the required deposit (or full payment for smaller jobs) or when we confirm it with you directly. The deposit is applied to your total. The remaining balance is due upon completion. Payments are processed by Stripe. Appointment windows are estimates of arrival time; weather, safety and prior jobs can affect timing.</p>"),
 ("access", "4. Access and property", "<p>You agree to give us safe access to the areas to be serviced, to secure pets, and to tell us about hazards (such as hidden objects, irrigation heads, invisible fences, or fragile items). We're not responsible for damage to items that were hidden, unmarked, or not disclosed, and we may decline to service areas that are unsafe. [OWNER TO CONFIRM: insurance coverage and any damage-claim procedure — do not advertise insurance until confirmed.]</p>"),
 ("weather", "5. Weather", "<p>We may reschedule service when weather makes work unsafe or ineffective. We'll contact you to arrange a new time. We don't automatically cancel bookings because of weather.</p>"),
 ("memberships", "6. Memberships and recurring billing", "<p>Memberships are billed monthly, automatically, to the card you provide, at the price and tax shown before you subscribe. Each membership covers a defined season and <b>ends automatically at the end of that season</b>; it does not renew into the following year unless you sign up again. If you join before the season starts, the first charge occurs on the season start date. Your final monthly charge may cover a partial month at the end of the season. You may cancel at any time online through My Account or the Stripe billing portal, or by contacting us; cancellation takes effect at the end of the current paid month and you will not be charged again. We'll send a confirmation of your membership terms by email, and a receipt for each charge. Included visits that aren't used in a month don't carry over. If a payment fails, Stripe will retry and we may pause service until it succeeds. We may change membership prices for future seasons; we won't change the price of a season you've already joined without your consent.</p>"),
 ("snow", "7. Snow and ice service terms", "<p>Winter membership visits are triggered by snowfall at or above the trigger shown at sign-up (currently 2 inches), as reported by the National Weather Service for the Islip area. Each month includes the number of visits shown at sign-up; each visit covers accumulation up to the depth shown (currently 12 inches) — deeper snow may require additional visits billed at the member rate. Additional visits beyond those included are charged to your card on file at the member rate, plus tax. Salting is optional and billed per application unless your plan says otherwise. We service properties in route order and cannot guarantee a specific arrival time during or immediately after a storm. Snow and ice can re-form after service; we're not responsible for conditions that develop after we leave, for ice that forms from melting and refreezing, or for slips and falls on your property. Membership capacity is limited and we may close enrollment when full.</p>"),
 ("liability", "8. Limitation of liability", "<p>To the extent permitted by law, our liability for any claim related to our services is limited to the amount you paid for the specific service giving rise to the claim. Nothing in these terms limits rights you have under New York or federal consumer protection law.</p>"),
 ("reviews", "9. Reviews", "<p>Reviews submitted through our site come from customers with a completed job. We may decline to publish reviews that contain personal information, offensive content, or are unrelated to our services, but we don't edit the substance of reviews.</p>"),
 ("contact", "10. Contact", f"<p><a href=\"tel:{PHONE_HREF}\">{PHONE}</a> · <a href=\"mailto:{EMAIL}\">{EMAIL}</a></p>"),
])

pages["/cancellation-refund-policy/"] = legal("/cancellation-refund-policy/", "Cancellation & Refund Policy", "How cancellations, rescheduling, deposits and refunds work at All Season Yard Care Long Island.", [
 ("customer", "Cancelling a booking", "<p>You can request cancellation from your booking page or by calling us. <b>More than 48 hours before your appointment:</b> full refund of your deposit. <b>Less than 48 hours before:</b> your deposit may be kept to cover the crew time we reserved for you, unless we're able to fill the slot. Unpaid quote requests can be cancelled any time at no cost. [OWNER TO CONFIRM these windows — they can be changed in the dashboard.]</p>"),
 ("reschedule", "Rescheduling", "<p>You can request a new date from your booking page at no charge, subject to availability. If we need to reschedule because of weather or safety, there's never a charge.</p>"),
 ("revised", "Revised quotes", "<p>If conditions on site differ significantly from your description and you don't accept our revised quote, you may cancel and we'll refund your deposit, minus any work you've asked us to complete.</p>"),
 ("our", "If we cancel", "<p>If we cancel and can't offer a time that works for you, you'll receive a full refund of anything you've paid for that booking.</p>"),
 ("memberships", "Memberships", "<p>Cancel any time online. Cancellation takes effect at the end of your current paid month and you won't be charged again. We don't prorate refunds for partial months unless required by law, but you'll continue to receive service through the end of the paid month. Memberships end automatically at season end.</p>"),
 ("refunds", "How refunds are paid", "<p>Card refunds are issued to the original card through Stripe and usually appear in 5–10 business days. Cash or check payments are refunded by the same method.</p>"),
])

pages["/credits/"] = page("/credits/", "Photo Credits", "Photo credits.",
  page_hero("Photo credits", "Stock photography used on this website is from Unsplash, used under the Unsplash License. These are illustrative photos, not photos of our completed jobs — see the Before &amp; After gallery for our own work.", None) +
  '<section class="block"><div class="wrap narrow"><ul>' + "".join(f"<li>{esc(d)} — photo by {esc(a)} on Unsplash</li>" for _, d, a in PHOTOS.values()) + "</ul></div></section>", robots="noindex,follow")

pages["/404.html"] = page("/404.html", "Page not found", "Page not found.",
  '<section class="block"><div class="wrap narrow" style="text-align:center"><h1>We couldn\'t find that page</h1><p>It may have moved. Try one of these:</p><p><a class="btn" href="/">Home</a> <a class="btn ghost" href="/estimate/">Instant Estimate</a> <a class="btn ghost" href="tel:' + PHONE_HREF + '">Call us</a></p></div></section>', robots="noindex")

# ---------------------------------------------------------------- write
def write():
    if os.path.exists(OUT): shutil.rmtree(OUT)
    shutil.copytree(SRC, OUT)
    for path, content in pages.items():
        if path.endswith(".html"):
            fp = os.path.join(OUT, path.lstrip("/"))
        else:
            fp = os.path.join(OUT, path.strip("/"), "index.html") if path != "/" else os.path.join(OUT, "index.html")
        os.makedirs(os.path.dirname(fp), exist_ok=True)
        with open(fp, "w") as f: f.write(content)
    public = [p for p in pages if p not in ("/404.html", "/account/", "/booking/", "/admin/", "/credits/")]
    today = datetime.date.today().isoformat()
    prio = lambda p: "1.0" if p == "/" else "0.9" if p in ("/fall-cleanup/", "/winter-snow-removal/", "/estimate/") else "0.7"
    sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join(
        f"  <url><loc>{SITE}{p}</loc><lastmod>{today}</lastmod><priority>{prio(p)}</priority></url>\n" for p in public) + "</urlset>\n"
    open(os.path.join(OUT, "sitemap.xml"), "w").write(sm)
    open(os.path.join(OUT, "robots.txt"), "w").write(f"User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /account/\nDisallow: /booking/\n\nSitemap: {SITE}/sitemap.xml\n")
    open(os.path.join(OUT, ".nojekyll"), "w").write("")
    print(f"Built {len(pages)} pages → {OUT}")

if __name__ == "__main__":
    write()
