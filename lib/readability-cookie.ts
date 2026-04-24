export const READABILITY_COOKIE_NAME = "readability_v2";
export const LEGACY_READABILITY_COOKIE_NAME = "readability";
export const READABILITY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function expireCookie(name: string) {
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
}

export function getReadabilityCookie() {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${READABILITY_COOKIE_NAME}=([^;]+)`)
  );

  return match ? decodeURIComponent(match[1]) : null;
}

export function setReadabilityCookie(value: string) {
  document.cookie = `${READABILITY_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${READABILITY_COOKIE_MAX_AGE}; SameSite=Lax`;
  expireCookie(LEGACY_READABILITY_COOKIE_NAME);
}

export function clearReadabilityCookie() {
  document.documentElement.removeAttribute("data-readability");
  expireCookie(READABILITY_COOKIE_NAME);
  expireCookie(LEGACY_READABILITY_COOKIE_NAME);
}
