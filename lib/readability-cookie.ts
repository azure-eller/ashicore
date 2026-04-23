const READABILITY_COOKIE_NAME = "readability";
const READABILITY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function getReadabilityCookie() {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${READABILITY_COOKIE_NAME}=([^;]+)`)
  );

  return match ? decodeURIComponent(match[1]) : null;
}

export function setReadabilityCookie(value: string) {
  document.cookie = `${READABILITY_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${READABILITY_COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function clearReadabilityCookie() {
  document.documentElement.removeAttribute("data-readability");
  document.cookie = `${READABILITY_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax`;
}
