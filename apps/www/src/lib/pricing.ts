/* ============================================================
   ashicore — pricing model + calculator markup
   Single source of truth for prices, bands, packages, and the
   calculator's render fragments. Used both server-side (SSR the
   default state in pricing.astro) and client-side (the island
   re-renders these fragments on interaction). No DOM access here.
   ============================================================ */
import { SIGN_UP_URL } from "./site";

const PLUGIN_LOOKUP: Record<string, string> = {
  lot: "plugin_lot_tracking",
  batch: "plugin_batch_production",
  crm: "plugin_crm",
  price: "plugin_wholesale_pricing",
  multi: "plugin_multi_location",
};
const PACKAGE_LOOKUP: Record<string, string> = {
  foodbev: "package_food_bev",
  soil: "package_soil_landscape",
  wholesale: "package_wholesale_b2b",
  everything: "everything",
};

export interface Plugin {
  id: string;
  name: string;
  cat: string;
}
export interface Package {
  id: string;
  name: string;
  price: number;
  plugins: string[];
  desc: string;
}
export interface PricingState {
  pos: number; // 0..4 — banded sales-order slider position
  loc: number; // 1..20 — active inventory locations
  active: string[]; // selected plugin ids
  annual: boolean;
  open: boolean; // price-breakdown disclosure
}

export const PLUGINS: Plugin[] = [
  { id: "lot", name: "Lot tracking", cat: "Traceability" },
  { id: "batch", name: "Batch production", cat: "Manufacturing" },
  { id: "crm", name: "CRM", cat: "Customers" },
  { id: "price", name: "Wholesale pricing", cat: "Sales" },
  { id: "multi", name: "Multi-location", cat: "Operations" },
];
export const PLUGIN_PRICE = 99;

export const PACKAGES: Package[] = [
  {
    id: "foodbev",
    name: "Food & Bev",
    price: 199,
    plugins: ["lot", "batch", "price"],
    desc: "Audit-ready lot history from ingredient intake to shipment.",
  },
  {
    id: "soil",
    name: "Soil & Landscape",
    price: 199,
    plugins: ["batch", "multi", "price"],
    desc: "Mix, bag, stock, and sell across yards, stores, and wholesale.",
  },
  {
    id: "wholesale",
    name: "Wholesale B2B",
    price: 199,
    plugins: ["crm", "price", "multi"],
    desc: "Repeat buyers, price breaks, and stock across locations.",
  },
];
export const EVERYTHING: Package = {
  id: "everything",
  name: "Everything",
  price: 399,
  plugins: ["lot", "batch", "crm", "price", "multi"],
  desc: "All five workflows in one subscription.",
};

export interface Band {
  id: string;
  name: string;
  add: number | null; // null = "Let's talk" (custom)
  label: string;
}
export const BANDS: Band[] = [
  { id: "starter", name: "Starter", add: 0, label: "up to 100" },
  { id: "growth", name: "Growth", add: 100, label: "up to 250" },
  { id: "pro", name: "Pro", add: 250, label: "up to 1,000" },
  { id: "scale", name: "Scale", add: null, label: "1,000+" },
];
export const BASE = 299;
export const STOPS = [0, 100, 250, 1000, 2500];

export const DEFAULT_STATE: PricingState = {
  pos: 0.55,
  loc: 1,
  active: ["lot", "batch", "price"],
  annual: false,
  open: true,
};

/* ---- pricing helpers ---- */

// each additional location is priced lower than the last (volume-friendly),
// decreasing by $2 from $40 and floored at $24.
export function locationAdd(loc: number): number {
  let sum = 0;
  for (let k = 1; k <= loc - 1; k++) sum += Math.max(40 - 2 * (k - 1), 24);
  return sum;
}

export const fmt = (n: number): string => n.toLocaleString("en-US");
export const nameOf = (id: string): string =>
  PLUGINS.find((p) => p.id === id)?.name ?? id;
const eqSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x));
export { eqSet };
const subset = (a: string[], b: string[]): boolean => a.every((x) => b.includes(x));

export function ordersFromPos(p: number): number {
  const i = Math.min(Math.floor(p), STOPS.length - 2);
  const frac = p - i;
  return Math.round(STOPS[i] + (STOPS[i + 1] - STOPS[i]) * frac);
}

export interface Addon {
  price: number;
  type: "none" | "everything" | "package" | "alacarte";
  name?: string;
  save?: number;
}
export function addonCost(active: string[]): Addon {
  const n = active.length;
  if (n === 0) return { price: 0, type: "none" };
  if (n === 5)
    return {
      price: EVERYTHING.price,
      type: "everything",
      name: "Everything",
      save: n * PLUGIN_PRICE - EVERYTHING.price,
    };
  const pkg = PACKAGES.find((p) => eqSet(p.plugins, active));
  if (pkg)
    return {
      price: pkg.price,
      type: "package",
      name: pkg.name,
      save: n * PLUGIN_PRICE - pkg.price,
    };
  return { price: n * PLUGIN_PRICE, type: "alacarte" };
}

function addonLookupKeys(active: string[]): string[] {
  if (active.length === 0) return [];
  if (active.length === 5) return ["everything"];
  const pkg = PACKAGES.find((p) => eqSet(p.plugins, active));
  if (pkg) return [PACKAGE_LOOKUP[pkg.id]];
  return active.map((id) => PLUGIN_LOOKUP[id]).filter(Boolean);
}

function coreSignupUrl(s: PricingState): string {
  const t = computeTotals(s);
  if (t.isScale) return "/support";
  const interval = s.annual ? "annual" : "monthly";
  const params = new URLSearchParams({
    plan: `core_${t.band.id}_${interval}`,
  });
  if (s.loc > 1) params.set("locations", String(s.loc));
  const addons = addonLookupKeys(s.active);
  if (addons.length) params.set("addons", addons.join(","));
  return `${SIGN_UP_URL}?${params.toString()}`;
}

export interface Hint {
  name: string;
  missing: string[];
  save: number;
  price: number;
}
export function computeHint(active: string[]): Hint | null {
  if (addonCost(active).type !== "alacarte") return null;
  const cands = [...PACKAGES, EVERYTHING].filter(
    (p) => subset(active, p.plugins) && active.length < p.plugins.length,
  );
  if (!cands.length) return null;
  cands.sort(
    (a, b) =>
      a.plugins.length - active.length - (b.plugins.length - active.length),
  );
  const p = cands[0];
  const missing = p.plugins.filter((x) => !active.includes(x)).map(nameOf);
  const save = active.length * PLUGIN_PRICE + missing.length * PLUGIN_PRICE - p.price;
  return { name: p.name, missing, save, price: p.price };
}

export interface Totals {
  bandIdx: number;
  band: Band;
  orders: number;
  isScale: boolean;
  locAdd: number;
  addon: Addon;
  monthly: number | null;
  shown: number | null;
}
export function computeTotals(s: PricingState): Totals {
  const bandIdx = Math.min(Math.floor(s.pos), 3);
  const band = BANDS[bandIdx];
  const isScale = bandIdx === 3;
  const locAdd = locationAdd(s.loc);
  const addon = addonCost(s.active);
  const monthly = isScale ? null : BASE + (band.add || 0) + locAdd + addon.price;
  const annualPer = monthly != null ? Math.round((monthly * 10) / 12) : null;
  const shown = monthly == null ? null : s.annual ? annualPer : monthly;
  return {
    bandIdx,
    band,
    orders: ordersFromPos(s.pos),
    isScale,
    locAdd,
    addon,
    monthly,
    shown,
  };
}

/* ---- markup fragments (returned as HTML strings) ---- */

const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 6"/></svg>`;

export function renderPosVal(s: PricingState): string {
  const t = computeTotals(s);
  const big = t.isScale ? "1,000+" : fmt(t.orders);
  return `${big}<small>${t.band.name}</small>`;
}

export function renderTicks(s: PricingState): string {
  const { bandIdx } = computeTotals(s);
  return BANDS.map(
    (b, i) =>
      `<div class="pp-band-tick${i === bandIdx ? " on" : ""}"><b>${b.name}</b>${
        b.add == null ? "Let’s talk" : b.add === 0 ? "included" : "+$" + b.add
      }</div>`,
  ).join("");
}

export function renderLocVal(s: PricingState): string {
  const { locAdd } = computeTotals(s);
  const big = s.loc >= 20 ? "20+" : String(s.loc);
  return `${big}<small>${s.loc === 1 ? "included" : "+$" + locAdd}</small>`;
}

export function renderGrid(s: PricingState): string {
  const rows = [...PACKAGES, EVERYTHING];
  const matchedIdx = rows.findIndex((pk) => eqSet(s.active, pk.plugins));
  const focusIdx = matchedIdx >= 0 ? matchedIdx : 0;

  const head = `<thead><tr>
    <th class="corner"><div class="pp-corner"><b>Build add-ons</b><span>Tap a package, or a plugin →</span></div></th>
    ${PLUGINS.map((pl) => {
      const on = s.active.includes(pl.id);
      return `<th class="pcol"><button type="button" class="pp-plug-toggle${
        on ? " on" : ""
      }" data-plugin="${pl.id}" aria-pressed="${on}"><span class="pp-plug-check">${
        on ? CHECK : ""
      }</span><span class="pp-plug-name">${pl.name}</span><span class="pp-plug-price">$${PLUGIN_PRICE}/mo</span></button></th>`;
    }).join("")}
  </tr></thead>`;

  const body = `<tbody role="radiogroup" aria-label="Packages">
    ${rows
      .map((pk, ri) => {
        const matched = eqSet(s.active, pk.plugins);
        const cells = PLUGINS.map((pl) => {
          const inPkg = pk.plugins.includes(pl.id);
          const colOn = s.active.includes(pl.id);
          return `<td class="pp-cell${colOn ? " col-on" : ""}" data-col="${pl.id}">${
            inPkg
              ? `<span class="pp-cell-ck">${CHECK}</span>`
              : `<span class="pp-cell-empty"></span>`
          }</td>`;
        }).join("");
        return `<tr class="${matched ? "matched" : ""}" data-row="${pk.id}" data-plugins="${pk.plugins.join(
          ",",
        )}" role="radio" aria-checked="${matched}" tabindex="${ri === focusIdx ? 0 : -1}">
        <td><div class="pp-row-label"><span class="pp-row-radio" aria-hidden="true"></span><span><span class="pp-row-name">${pk.name}</span><span class="pp-row-desc">${pk.desc}</span></span></div></td>
        ${cells}
        <td class="pp-row-price"><span class="amt">$${pk.price}</span><span class="per">/mo</span><span class="save">save $${pk.plugins.length * PLUGIN_PRICE - pk.price}</span></td>
      </tr>`;
      })
      .join("")}
  </tbody>`;

  return `<table class="pp-grid">${head}${body}</table>`;
}

export function renderNote(s: PricingState): string {
  const addon = addonCost(s.active);
  const hint = computeHint(s.active);
  let html: string;
  if (hint) {
    html = `<span><b>Tip ·</b> Add ${hint.missing.join(
      " + ",
    )} to bundle as ${hint.name} for $${hint.price} — $${hint.save} less.</span>`;
  } else if (addon.type === "package" || addon.type === "everything") {
    html = `<span><b>${addon.name} bundle</b> applied — you save $${addon.save}/mo vs à la carte.</span>`;
  } else if (addon.type === "alacarte") {
    html = `<span>${s.active.length} plugin${
      s.active.length > 1 ? "s" : ""
    } à la carte · $${addon.price}/mo</span>`;
  } else {
    html = `<span>No add-ons selected — Core covers the full base ERP.</span>`;
  }
  if (s.active.length > 0) {
    html += `<button type="button" class="pp-clear" data-clear>clear</button>`;
  }
  return html;
}

export function renderTotal(s: PricingState): string {
  const { shown } = computeTotals(s);
  if (shown == null) {
    return `<div class="num custom">Let’s talk</div><div class="per">Custom pricing for 1,000+ orders / mo</div>`;
  }
  return `<div class="num">$${fmt(shown)}</div><div class="per">${
    s.annual ? "per month, billed annually" : "per month, billed monthly"
  }</div>`;
}

export function renderCta(s: PricingState): string {
  const { shown } = computeTotals(s);
  const walkthrough = `<a href="/support" class="btn btn-ghost">Book a walkthrough</a>`;
  if (shown == null) {
    return `<a href="/support" class="btn btn-dark btn-lg" data-analytics-event="cta_contact_sales_clicked" data-analytics-placement="pricing-calculator">Talk to sales <span class="arr" aria-hidden="true">→</span></a>${walkthrough}`;
  }
  return `<a href="${coreSignupUrl(s)}" class="btn btn-dark btn-lg" data-analytics-event="pricing_plan_clicked" data-analytics-placement="pricing-calculator" data-analytics-plan="core" data-analytics-signup-start="true">Get started <span class="arr" aria-hidden="true">→</span></a>${walkthrough}`;
}

export function renderBreak(s: PricingState): string {
  const t = computeTotals(s);
  const { band, isScale, locAdd, addon, shown } = t;
  const bandAmt = isScale
    ? "custom"
    : band.add === 0
      ? "included"
      : "+$" + band.add + "/mo";
  const addonName =
    addon.type === "none"
      ? "Add-ons"
      : addon.type === "alacarte"
        ? "Plugins (à la carte)"
        : addon.name + " package";
  const addonSub =
    addon.type === "none" ? "none selected" : s.active.map(nameOf).join(" · ");
  return `
    <li><span class="bk-name">Core plan<small>unlimited users · SKUs · integrations</small></span><span class="bk-amt">$${BASE}/mo</span></li>
    <li><span class="bk-name">${band.name} band<small>${
      isScale ? "1,000+ orders / mo" : band.label + " orders / mo"
    }</small></span><span class="bk-amt${band.add === 0 ? " free" : ""}">${bandAmt}</span></li>
    <li><span class="bk-name">Locations<small>${s.loc} site${s.loc > 1 ? "s" : ""}${
      s.loc === 1 ? " · one included" : ""
    }</small></span><span class="bk-amt${locAdd === 0 ? " free" : ""}">${
      locAdd === 0 ? "included" : "+$" + locAdd + "/mo"
    }</span></li>
    <li><span class="bk-name">${addonName}<small>${addonSub}</small></span><span class="bk-amt${
      addon.price === 0 ? " free" : ""
    }">${addon.price === 0 ? "—" : "+$" + addon.price + "/mo"}</span></li>
    <li class="total"><span class="bk-name">Total${
      s.annual ? " (annual)" : ""
    }</span><span class="bk-amt">${shown == null ? "custom" : "$" + fmt(shown) + "/mo"}</span></li>`;
}

/* ============================================================
   packages & add-ons explorer — click-to-explore detail panel.
   Same PLUGINS / PACKAGES / EVERYTHING data drives the calculator
   grid; the copy below adds the per-item detail content.
   ============================================================ */

const EX_S = `fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"`;
const EXICON: Record<string, string> = {
  lot: `<svg viewBox="0 0 24 24" ${EX_S}><path d="M3 11.5 11.5 3H20a1 1 0 0 1 1 1v8.5L12.5 21a1.4 1.4 0 0 1-2 0L3 13.5a1.4 1.4 0 0 1 0-2Z"/><circle cx="16.3" cy="7.7" r="1.3"/></svg>`,
  batch: `<svg viewBox="0 0 24 24" ${EX_S}><path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/></svg>`,
  crm: `<svg viewBox="0 0 24 24" ${EX_S}><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>`,
  price: `<svg viewBox="0 0 24 24" ${EX_S}><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/><path d="M19 5 5 19"/></svg>`,
  multi: `<svg viewBox="0 0 24 24" ${EX_S}><path d="M12 21s7-5.5 7-11a7 7 0 0 0-14 0c0 5.5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
  foodbev: `<svg viewBox="0 0 24 24" ${EX_S}><path d="M9 3h6"/><path d="M10 3v5L5.5 18a2 2 0 0 0 1.8 3h9.4a2 2 0 0 0 1.8-3L14 8V3"/><path d="M7.5 14h9"/></svg>`,
  soil: `<svg viewBox="0 0 24 24" ${EX_S}><path d="M12 22V11"/><path d="M12 11c0-3 2.5-5 6-5 0 3.5-2.5 5-6 5Z"/><path d="M12 13c0-2.5-2-4.5-5-4.5 0 3 2 4.5 5 4.5Z"/></svg>`,
  wholesale: `<svg viewBox="0 0 24 24" ${EX_S}><path d="M3 9 12 4l9 5-9 5-9-5Z"/><path d="M3 9v6l9 5 9-5V9"/><path d="M12 14v6"/></svg>`,
  everything: `<svg viewBox="0 0 24 24" ${EX_S}><rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/></svg>`,
};

interface PluginInfo {
  tagline: string;
  visTag: string;
  desc: string;
  features: string[];
}
export const PLUGIN_INFO: Record<string, PluginInfo> = {
  lot: {
    tagline: "Trace every unit back to its source.",
    visTag: "batch · lot genealogy",
    desc: "Assign lot and sub-lot numbers at intake and on every production run, then follow them through transfers, builds, and shipments — so recalls take minutes, not days.",
    features: [
      "Lot & sub-lot numbers on bought and made items",
      "Full genealogy — which inputs built which outputs",
      "Expiry / best-by dates with FEFO picking",
      "One-click recall: every customer who got a lot",
    ],
  },
  batch: {
    tagline: "Plan and cost every production run.",
    visTag: "production · yield & cost",
    desc: "Build recipes and BOMs, schedule runs, and capture real yields and costs per batch — so you always know the true margin on what you make.",
    features: [
      "Recipes / BOMs with scalable quantities",
      "Production scheduling with live run status",
      "Actual vs. expected yield and cost per batch",
      "Automatic consumption of input stock",
    ],
  },
  crm: {
    tagline: "Every buyer relationship in one place.",
    visTag: "customers · pipeline",
    desc: "Track companies, contacts, and order history, and manage quotes and follow-ups — without bolting a separate CRM onto your ERP.",
    features: [
      "Company & contact records with full history",
      "Quotes and a simple sales pipeline",
      "Notes, tasks, and follow-up reminders",
      "Per-customer terms and contacts",
    ],
  },
  price: {
    tagline: "The right price for every account.",
    visTag: "sales · price lists",
    desc: "Set tiered, contract, and customer-specific pricing with volume breaks that apply automatically at quote and order entry.",
    features: [
      "Customer-specific price lists",
      "Volume / quantity-break pricing",
      "Contract pricing with date ranges",
      "Auto-applied at quote and order",
    ],
  },
  multi: {
    tagline: "See and move stock across every site.",
    visTag: "operations · transfers",
    desc: "Track inventory by location, transfer between yards and warehouses, and set reorder points per site — with stock visible everywhere at once.",
    features: [
      "Per-location stock levels",
      "Inter-location transfers with in-transit",
      "Per-location reorder points & counts",
      "Location-aware fulfilment",
    ],
  },
};
export const PLUGIN_ONELINE: Record<string, string> = {
  lot: "Batch & serial genealogy for audit-ready recalls.",
  batch: "Recipes, scheduling, and true cost per run.",
  crm: "Buyers, quotes, and follow-ups in one place.",
  price: "Tiered, contract & volume-break pricing.",
  multi: "Stock and transfers across every site.",
};
interface PackageInfo {
  tagline: string;
  visTag: string;
  desc: string;
}
export const PACKAGE_INFO: Record<string, PackageInfo> = {
  foodbev: {
    tagline: "For food, beverage & ingredient makers.",
    visTag: "traceability · batch · pricing",
    desc: "Audit-ready lot history from ingredient intake to shipment, with batch costing and account-specific pricing — everything a maker needs to pass an audit and price wholesale correctly.",
  },
  soil: {
    tagline: "For soil, mulch & compost producers.",
    visTag: "batch · multi-site · pricing",
    desc: "Mix and bag by batch, keep stock visible across every yard and store, and price wholesale accounts right — built for producers selling across multiple sites.",
  },
  wholesale: {
    tagline: "For distributors & B2B sellers.",
    visTag: "CRM · pricing · multi-site",
    desc: "Manage repeat buyers, contract price breaks, and inventory across locations from one place — the toolkit for relationship-driven B2B sales.",
  },
  everything: {
    tagline: "For operations that want it all.",
    visTag: "the full toolkit",
    desc: "Every workflow in one subscription — traceability, batch manufacturing, CRM, wholesale pricing, and multi-location — bundled at the best price.",
  },
};

export const DEFAULT_EXPLORER_SEL = "foodbev";

const ARROW = `<span class="arr" aria-hidden="true">→</span>`;

export function renderExplorer(sel: string): string {
  const allPackages = [...PACKAGES, EVERYTHING];
  const pkg = allPackages.find((p) => p.id === sel);
  const isPkg = !!pkg;
  const plugin = isPkg ? null : PLUGINS.find((p) => p.id === sel);
  const info = isPkg ? PACKAGE_INFO[sel] : PLUGIN_INFO[sel];

  const railItem = (
    id: string,
    name: string,
    meta: string,
    price: number,
  ) =>
    `<button type="button" class="pp-ex-item${
      sel === id ? " on" : ""
    }" data-sel="${id}" aria-pressed="${sel === id}"><span class="ic">${
      EXICON[id]
    }</span><span class="tx"><span class="nm">${name}</span><span class="mt">${meta}</span></span><span class="pr">$${price}/mo</span></button>`;

  const list = `<div class="pp-ex-list">
    <div>
      <span class="pp-ex-group-label">Packages — curated bundles</span>
      <div class="pp-ex-items">${allPackages
        .map((p) => railItem(p.id, p.name, `${p.plugins.length} plugins`, p.price))
        .join("")}</div>
    </div>
    <div>
      <span class="pp-ex-group-label">Plugins — à la carte</span>
      <div class="pp-ex-items">${PLUGINS.map((p) =>
        railItem(p.id, p.name, p.cat, PLUGIN_PRICE),
      ).join("")}</div>
    </div>
  </div>`;

  const detailBody = isPkg
    ? `<div class="pp-ex-sub">Includes ${pkg!.plugins.length} plugins — tap to explore</div>
      <div class="pp-ex-incl">${pkg!.plugins
        .map(
          (pid) =>
            `<button type="button" class="pp-ex-incl-row" data-sel="${pid}"><span class="ic">${
              EXICON[pid]
            }</span><span class="tx"><span class="nm">${nameOf(
              pid,
            )}</span><span class="ds">${
              PLUGIN_ONELINE[pid]
            }</span></span><span class="go">View →</span></button>`,
        )
        .join("")}</div>
      <div class="pp-ex-cta"><a href="#calculator" class="btn btn-primary">Add to plan ${ARROW}</a><span class="save">Bundle saves $${
        pkg!.plugins.length * PLUGIN_PRICE - pkg!.price
      }/mo vs à la carte</span></div>`
    : `<div class="pp-ex-sub">What you get</div>
      <ul class="pp-ex-features">${PLUGIN_INFO[sel].features
        .map((f) => `<li><span class="ck">${CHECK}</span>${f}</li>`)
        .join("")}</ul>
      <div class="pp-ex-sub">Included in these packages</div>
      <div class="pp-ex-chips">${allPackages
        .filter((p) => p.plugins.includes(sel))
        .map(
          (p) =>
            `<button type="button" class="pp-ex-chip" data-sel="${p.id}"><i></i>${p.name} · $${p.price}/mo</button>`,
        )
        .join("")}</div>
      <div class="pp-ex-cta"><a href="#calculator" class="btn btn-primary">Add to plan ${ARROW}</a><span class="save">Or bundle from $199/mo</span></div>`;

  const detail = `<div class="pp-ex-detail">
    <div class="pp-ex-vis">
      <span class="pp-ex-kind${isPkg ? " pkg" : ""}">${isPkg ? "Package" : "Add-on"}</span>
      <span class="vis-icon">${EXICON[sel]}</span>
      <span class="vis-tag">${info.visTag}</span>
    </div>
    <div class="pp-ex-body">
      <div class="pp-ex-top">
        <span class="pp-ex-name">${isPkg ? pkg!.name : plugin!.name}</span>
        <span class="pp-ex-price">$${isPkg ? pkg!.price : PLUGIN_PRICE}<span> /mo</span></span>
      </div>
      <p class="pp-ex-tagline">${info.tagline}</p>
      <p class="pp-ex-desc">${info.desc}</p>
      ${detailBody}
    </div>
  </div>`;

  return list + detail;
}
