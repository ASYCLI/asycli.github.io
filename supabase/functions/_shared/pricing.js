// ASYCLI pricing engine — pure functions, no I/O.
// Runs server-side only (Supabase Edge Function). The browser never sees costs.
// Every number below is a DRAFT DEFAULT. The owner edits them in the dashboard
// (stored in the `settings` table), and stored values override these.

export const DEFAULT_PRICING = {
  currency: "usd",
  tiers: ["small", "medium", "large", "xl"],
  tierLabels: {
    small: "Small (up to ~1/8 acre)",
    medium: "Medium (~1/8 to 1/4 acre)",
    large: "Large (~1/4 to 1/2 acre)",
    xl: "Extra large / custom (over 1/2 acre)",
  },
  minimumCharge: 75,
  salesTax: { enabled: true, percent: 8.75, label: "NY & Suffolk sales tax" }, // NY taxes lawn care & snow removal
  autoRaiseToMarginFloor: true, // never quote below the profit floor
  travel: {
    freeMinutes: 25,
    bands: [ // [maxMinutes, fee]
      [40, 25],
      [60, 45],
    ],
    reviewOverMinutes: 60, // beyond this → owner reviews, no automatic price
  },
  deposit: {
    percent: 25,
    minimum: 50,
    fullPrepayUnder: 150, // jobs under this total are paid in full at booking
  },
  fall: {
    base: { small: 225, medium: 325, large: 525 },
    leafVolume: { light: 0.85, normal: 1, heavy: 1.3, very_heavy: 1.6 },
    trees: { "0-2": 0, "3-5": 25, "6-10": 60, "11+": 110 },
    areas: { front: 0.6, back: 0.6, both: 1 },
    access: { easy: 1, moderate: 1.08, difficult: 1.18 },
    haulAway: { small: 40, medium: 70, large: 110 }, // × leaf volume factor
    extras: { hardscape_blowoff: 20, beds_and_corners: 35 },
    crewHours: { small: 1.5, medium: 2.5, large: 4 },
    bagsPerHour: 8,
  },
  spring: {
    base: { small: 225, medium: 325, large: 475 },
    debris: { light: 0.8, normal: 1, heavy: 1.35 },
    areas: { front: 0.6, back: 0.6, both: 1 },
    access: { easy: 1, moderate: 1.08, difficult: 1.18 },
    haulAway: { small: 35, medium: 60, large: 95 },
    extras: { hardscape_blowoff: 20, beds_and_corners: 35 },
    crewHours: { small: 1.25, medium: 2, large: 3.25 },
    bagsPerHour: 6,
  },
  summer: {
    // mowable lawn area bands in sq ft → single-visit price (mow + trim)
    areaBands: [
      [4000, 85],
      [8000, 105],
      [14000, 140],
      [22000, 185],
    ],
    reviewOverSqft: 22000,
    condition: { maintained: 1, overgrown: 1.35, very_overgrown: 1.75 },
    obstacles: { few: 1, some: 1.1, many: 1.2 },
    trimming: { light: 0, standard: 10, heavy: 25 },
    crewHoursPerBand: [0.5, 0.65, 0.9, 1.2],
  },
  winter: {
    driveway: { small: 85, medium: 115, large: 165 },
    drivewayLabels: {
      small: "Small (1–2 cars, single width)",
      medium: "Medium (3–4 cars or double width)",
      large: "Large (long or 5+ cars)",
    },
    walkway: { none: 0, short: 10, long: 25 },
    depth: { "2-6": 1, "6-12": 1.35, "12+": 1.75 },
    ice: { none: 0, some: 10, heavy: 25 },
    salting: { small: 25, medium: 30, large: 40 },
    crewHours: { small: 0.5, medium: 0.7, large: 1.0 },
    saltBagsPerVisit: { small: 1, medium: 1.5, large: 2 },
  },
  memberships: {
    // monthly price (before tax), 2 scheduled visits per month (winter: see winterTerms)
    spring: { small: 189, medium: 259, large: 359 },
    summer: { small: 159, medium: 219, large: 299 },
    fall: { small: 229, medium: 329, large: 479 },
    winter: { small: 159, medium: 209, large: 299 },
    visitsPerMonth: 2,
  },
  winterTerms: {
    triggerInches: 2,
    includedVisitsPerMonth: 2,
    maxDepthPerVisitInches: 12,
    extraVisitDiscountPercent: 10, // members pay per-visit price minus this
    saltingIncluded: false,
    maxMembers: 40, // capacity for a 3-person crew with one snowblower
    enrollmentCutoff: "01-15", // no new winter members after this date
    measurement: "Snowfall as reported by the National Weather Service for the Islip area (Long Island MacArthur Airport)",
  },
  seasons: {
    // month-day; editable. Memberships auto-end at season end.
    spring: { start: "03-15", end: "05-31", label: "Mid-March – May" },
    summer: { start: "05-01", end: "09-30", label: "May – September" },
    fall: { start: "10-01", end: "12-15", label: "October – mid-December" },
    winter: { start: "12-01", end: "03-15", label: "December – mid-March" },
  },
  serviceEnabled: { spring: true, summer: true, fall: true, winter: true },
};

export const DEFAULT_COSTS = {
  laborPerWorkerHour: 22, // DRAFT — owner must confirm
  crewSize: { fall: 3, spring: 3, summer: 3, winter: 3 },
  fuelPerJob: 8,
  fuelPerDriveMinute: 0.25, // round trip handled by ×2
  paidTravelMinutesPerJob: 15, // crew is paid while driving between jobs
  equipmentPerCrewHour: 8,
  bagCost: 0.6,
  saltBagCost: 12,
  disposalPerHaul: { small: 20, medium: 35, large: 55 }, // DRAFT — confirm with disposal site
  processingPercent: 2.9,
  processingFixed: 0.3,
  minMarginPercent: 25,
};

const round2 = (n) => Math.round(n * 100) / 100;
const roundPrice = (n) => Math.round(n); // whole dollars for customers

export function deepMerge(base, over) {
  if (!over || typeof over !== "object" || Array.isArray(over)) return over ?? base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base && typeof base[k] === "object" && !Array.isArray(base[k])
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

export function travelFee(minutes, P) {
  if (minutes == null || !isFinite(minutes)) return { fee: 0, review: true, reason: "Drive time could not be calculated" };
  if (minutes <= P.travel.freeMinutes) return { fee: 0, review: false };
  if (minutes > P.travel.reviewOverMinutes) return { fee: 0, review: true, reason: "Outside our usual service area — we'll review and quote" };
  for (const [max, fee] of P.travel.bands) if (minutes <= max) return { fee, review: false };
  return { fee: 0, review: true, reason: "Outside our usual service area" };
}

function pick(table, key, name) {
  if (!(key in table)) throw new Error(`Invalid ${name}: ${key}`);
  return table[key];
}

// inputs: { service, tier, driveMinutes, ...service-specific }
export function estimate(inputs, P = DEFAULT_PRICING, C = DEFAULT_COSTS) {
  const s = inputs.service;
  if (!["fall", "spring", "summer", "winter"].includes(s)) throw new Error("Unknown service");
  if (!P.serviceEnabled[s]) return { review: true, reasons: ["This service is not currently being booked online"], lines: [] };

  const lines = []; // customer-facing lines
  const reasons = [];
  let crewHours = 0;
  let materials = 0;
  let disposal = 0;
  let complexity = "Standard";
  let subtotal = 0;

  if (s === "fall" || s === "spring") {
    const T = P[s];
    const tier = inputs.tier;
    if (tier === "xl") return manual("Extra-large properties get a custom quote after a quick review", inputs, P);
    const base = pick(T.base, tier, "property size");
    const volKey = s === "fall" ? inputs.leafVolume : inputs.debris;
    const vol = pick(s === "fall" ? T.leafVolume : T.debris, volKey, "volume");
    const area = pick(T.areas, inputs.areas || "both", "area");
    const access = pick(T.access, inputs.access || "easy", "access");
    let treeAdd = 0;
    if (s === "fall") treeAdd = pick(T.trees, inputs.trees || "0-2", "trees");

    const labor = base * vol * area * access + treeAdd;
    lines.push({ label: `${s === "fall" ? "Fall leaf cleanup" : "Spring renewal cleanup"} — ${labelTier(tier)}`, amount: roundPrice(labor) });
    subtotal += roundPrice(labor);

    crewHours = T.crewHours[tier] * vol * area * access + (s === "fall" ? treeAdd / 140 : 0);
    materials += Math.ceil(crewHours * T.bagsPerHour * (s === "fall" ? 1 : 1)) * C.bagCost;

    if (inputs.disposal === "haul") {
      const haul = roundPrice(T.haulAway[tier] * vol * area);
      lines.push({ label: "Haul-away (we load and remove everything)", amount: haul });
      subtotal += haul;
      disposal += C.disposalPerHaul[tier] * vol * area;
      crewHours += 0.25;
    } else {
      lines.push({ label: "Bagged and left at your chosen spot on the property", amount: 0 });
    }
    for (const ex of inputs.extras || []) {
      const amt = pick(T.extras, ex, "extra");
      lines.push({ label: EXTRA_LABELS[ex] || ex, amount: amt });
      subtotal += amt;
      crewHours += amt / 140;
    }
    complexity = vol >= 1.3 || access > 1.1 ? "High" : vol < 1 ? "Light" : "Standard";
  }

  if (s === "summer") {
    const T = P.summer;
    const sqft = Number(inputs.lawnSqft);
    if (!sqft || sqft <= 0) throw new Error("Lawn area required");
    if (sqft > T.reviewOverSqft) return manual("Lawns this size get a custom quote", inputs, P);
    const idx = T.areaBands.findIndex(([max]) => sqft <= max);
    const basePrice = T.areaBands[idx][1];
    const cond = pick(T.condition, inputs.condition || "maintained", "condition");
    const obs = pick(T.obstacles, inputs.obstacles || "few", "obstacles");
    const trim = pick(T.trimming, inputs.trimming || "standard", "trimming");
    const amt = roundPrice(basePrice * cond * obs + trim);
    lines.push({ label: `Mowing + string trimming (~${sqft.toLocaleString("en-US")} sq ft of lawn)`, amount: amt });
    subtotal += amt;
    crewHours = T.crewHoursPerBand[idx] * cond * obs + trim / 60;
    complexity = cond > 1.3 ? "High (first cut on overgrown grass)" : obs > 1.1 ? "Moderate" : "Standard";
  }

  if (s === "winter") {
    const T = P.winter;
    const dw = inputs.tier;
    const base = pick(T.driveway, dw, "driveway size");
    const walk = pick(T.walkway, inputs.walkway || "none", "walkway");
    const depth = pick(T.depth, inputs.depth || "2-6", "snow depth");
    const ice = pick(T.ice, inputs.ice || "none", "ice");
    const amt = roundPrice((base + walk) * depth + ice);
    lines.push({ label: `Snow clearing per visit — ${T.drivewayLabels[dw]}`, amount: amt });
    subtotal += amt;
    crewHours = T.crewHours[dw] * depth + (walk ? 0.15 : 0) + ice / 60;
    if (inputs.salting) {
      const salt = T.salting[dw];
      lines.push({ label: "Salting / de-icing", amount: salt });
      subtotal += salt;
      materials += T.saltBagsPerVisit[dw] * C.saltBagCost;
      crewHours += 0.1;
    }
    complexity = depth > 1.3 ? "High (deep snow)" : depth > 1 ? "Moderate" : "Standard";
  }

  const tf = travelFee(inputs.driveMinutes, P);
  if (tf.review) reasons.push(tf.reason);
  if (tf.fee) {
    lines.push({ label: `Travel (about ${Math.round(inputs.driveMinutes)} min from Islip)`, amount: tf.fee });
    subtotal += tf.fee;
  }
  if (inputs.travelOverride != null) {
    // owner override replaces the travel line, never adds a second one
    const idx = lines.findIndex((l) => l.label.startsWith("Travel"));
    if (idx >= 0) { subtotal -= lines[idx].amount; lines.splice(idx, 1); }
    if (inputs.travelOverride > 0) { lines.push({ label: "Travel", amount: inputs.travelOverride }); subtotal += inputs.travelOverride; }
  }

  if (subtotal < P.minimumCharge) {
    lines.push({ label: "Minimum visit charge adjustment", amount: P.minimumCharge - subtotal });
    subtotal = P.minimumCharge;
  }

  let total = roundPrice(subtotal);
  const costIn = { service: s, crewHours, materials, disposal, driveMinutes: inputs.driveMinutes };
  let internal = costOf({ ...costIn, total }, C);
  if (internal.marginPercent < C.minMarginPercent) {
    if (P.autoRaiseToMarginFloor) {
      // raise the main service line so the job clears the floor (rounded up to $5)
      const floor = Math.ceil(floorPrice(costIn, C) / 5) * 5;
      const bump = floor - total;
      lines[0].amount += bump;
      total = floor;
      internal = costOf({ ...costIn, total }, C);
      internal.raisedToFloorBy = bump;
    } else {
      reasons.push("Needs owner approval (below minimum margin)");
    }
  }

  const tax = P.salesTax?.enabled ? round2((total * P.salesTax.percent) / 100) : 0;
  const grandTotal = round2(total + tax);
  const dep = depositFor(grandTotal, P);
  return {
    service: s,
    lines,
    subtotal: total,
    tax,
    taxLabel: P.salesTax?.enabled ? `${P.salesTax.label} (${P.salesTax.percent}%)` : null,
    total: grandTotal,
    complexity,
    estHours: round2(crewHours),
    deposit: dep,
    review: reasons.length > 0,
    reasons,
    internal, // strip before sending to customers
  };
}

// Lowest price that still meets the minimum margin (pre-tax)
export function floorPrice(costIn, C = DEFAULT_COSTS) {
  const zero = costOf({ ...costIn, total: 0 }, C); // processing fixed fee included
  const m = C.minMarginPercent / 100, pct = C.processingPercent / 100;
  return zero.totalCost / (1 - m - pct);
}

export function costOf({ service, crewHours, materials, disposal, driveMinutes, total }, C = DEFAULT_COSTS) {
  const crew = C.crewSize[service] ?? 3;
  const labor = (crewHours + (C.paidTravelMinutesPerJob || 0) / 60) * crew * C.laborPerWorkerHour;
  const fuel = C.fuelPerJob + (isFinite(driveMinutes) ? driveMinutes * 2 * C.fuelPerDriveMinute : 0);
  const equipment = crewHours * C.equipmentPerCrewHour;
  const processing = total * (C.processingPercent / 100) + C.processingFixed;
  const cost = labor + fuel + equipment + materials + disposal + processing;
  const profit = total - cost;
  return {
    labor: round2(labor), fuel: round2(fuel), equipment: round2(equipment),
    materials: round2(materials), disposal: round2(disposal), processing: round2(processing),
    totalCost: round2(cost), profit: round2(profit),
    marginPercent: total > 0 ? round2((profit / total) * 100) : 0,
    crewHours: round2(crewHours), crewSize: crew,
  };
}

export function depositFor(total, P = DEFAULT_PRICING) {
  if (total < P.deposit.fullPrepayUnder) return { dueNow: total, balance: 0, fullPrepay: true };
  const d = Math.max(P.deposit.minimum, Math.round((total * P.deposit.percent) / 100));
  const dueNow = Math.min(d, total);
  return { dueNow, balance: round2(total - dueNow), fullPrepay: false };
}

// Membership quote: monthly price + internal monthly cost check
export function membership(service, tier, P = DEFAULT_PRICING, C = DEFAULT_COSTS) {
  const price = P.memberships[service]?.[tier];
  if (!price) throw new Error("Membership not available for this size");
  const visits = service === "winter" ? P.winterTerms.includedVisitsPerMonth : P.memberships.visitsPerMonth;
  // typical maintenance visit for members is lighter than a first/one-time job
  const perVisit = typicalVisit(service, tier, P);
  const cost = costOf({ ...perVisit, service, total: price / visits }, C);
  const monthlyCost = cost.totalCost * visits;
  return {
    service, tier, monthly: price, visitsPerMonth: visits,
    season: P.seasons[service],
    internal: { monthlyCost: round2(monthlyCost), marginPercent: round2(((price - monthlyCost) / price) * 100) },
  };
}

function typicalVisit(service, tier, P) {
  if (service === "summer") {
    const idx = { small: 0, medium: 1, large: 2 }[tier];
    return { crewHours: P.summer.crewHoursPerBand[idx], materials: 0, disposal: 0, driveMinutes: 20 };
  }
  if (service === "winter") return { crewHours: P.winter.crewHours[tier], materials: 0, disposal: 0, driveMinutes: 20 };
  // maintenance visits in a membership are lighter: ~45% of a full cleanup
  return { crewHours: P[service].crewHours[tier] * 0.45, materials: 3, disposal: 0, driveMinutes: 20 };
}

function manual(reason, inputs, P) {
  return { service: inputs.service, lines: [], total: null, review: true, reasons: [reason], deposit: null, internal: null };
}

const EXTRA_LABELS = {
  hardscape_blowoff: "Blow off driveway, patio and walkways",
  beds_and_corners: "Clear leaves from beds, fence lines and corners",
};

export function labelTier(t) {
  return { small: "small property", medium: "medium property", large: "large property", xl: "extra-large property" }[t] || t;
}

export function publicEstimate(e) {
  const { internal, ...rest } = e;
  return rest;
}

// Public view of pricing (no costs). Used for "starting at" prices on pages.
export function publicPricing(P) {
  return {
    tierLabels: P.tierLabels,
    minimumCharge: P.minimumCharge,
    salesTax: P.salesTax,
    travel: P.travel,
    deposit: P.deposit,
    fall: { base: P.fall.base, haulAway: P.fall.haulAway },
    spring: { base: P.spring.base, haulAway: P.spring.haulAway },
    summer: { areaBands: P.summer.areaBands, reviewOverSqft: P.summer.reviewOverSqft },
    winter: { driveway: P.winter.driveway, drivewayLabels: P.winter.drivewayLabels, salting: P.winter.salting },
    memberships: P.memberships,
    winterTerms: P.winterTerms,
    seasons: P.seasons,
    serviceEnabled: P.serviceEnabled,
  };
}
