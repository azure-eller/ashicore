export function clearReadabilityCookie() {
  document.documentElement.removeAttribute("data-readability");
  document.cookie = "readability=; Max-Age=0; Path=/; SameSite=Lax";
}
