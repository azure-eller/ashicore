export const SITE_NAME = "Ashicore";
export const PUBLIC_SITE_URL = "https://ashicore.app";
export const SUPPORT_EMAIL = "support@ashicore.app";
export const APP_ORIGIN = import.meta.env.DEV
  ? "http://localhost:3000"
  : "https://erp-orcin-pi.vercel.app";
export const APP_ENTRY_PATH = "/sales/orders";
export const SIGN_IN_URL = import.meta.env.DEV
  ? `${APP_ORIGIN}/sign-in?next=${encodeURIComponent(APP_ENTRY_PATH)}`
  : `/sign-in?next=${encodeURIComponent(APP_ENTRY_PATH)}`;
export const SIGN_UP_URL = import.meta.env.DEV
  ? `${APP_ORIGIN}/sign-up`
  : "/sign-up";
export const FOOD_BEV_SIGN_UP_URL = `${SIGN_UP_URL}?plan=package_food_bev`;
export const SOIL_LANDSCAPE_SIGN_UP_URL = `${SIGN_UP_URL}?plan=package_soil_landscape`;
export const WHOLESALE_B2B_SIGN_UP_URL = `${SIGN_UP_URL}?plan=package_wholesale_b2b`;
export const EVERYTHING_SIGN_UP_URL = `${SIGN_UP_URL}?plan=everything`;
export const PRO_SIGN_UP_URL = SOIL_LANDSCAPE_SIGN_UP_URL;

export const navItems = [
  { label: "Pricing", href: "/pricing" },
  { label: "Security", href: "/security" },
  { label: "Resources", href: "/resources" },
  { label: "Support", href: "/support" },
];

export const publicPages = [
  { path: "/", priority: "1.0" },
  { path: "/docs", priority: "0.9" },
  { path: "/privacy", priority: "0.7" },
  { path: "/terms", priority: "0.7" },
  { path: "/support", priority: "0.8" },
  { path: "/pricing", priority: "0.9" },
  { path: "/security", priority: "0.8" },
  { path: "/resources", priority: "0.7" },
  { path: "/subprocessors", priority: "0.6" },
];

export function absoluteUrl(path: string) {
  return new URL(path, PUBLIC_SITE_URL).toString();
}
