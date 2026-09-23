export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

export type CookiePair = { name: string; value: string };

export function parseCookieHeader(raw: string): CookiePair[] {
  let text = raw.trim();
  if (text.toLowerCase().startsWith("cookie:")) {
    text = text.slice(text.indexOf(":") + 1).trim();
  }
  const pairs: CookiePair[] = [];
  for (const part of text.split(";")) {
    const item = part.trim();
    if (!item || !item.includes("=")) continue;
    const eq = item.indexOf("=");
    const name = item.slice(0, eq).trim();
    const value = item.slice(eq + 1).trim();
    if (name) pairs.push({ name, value });
  }
  return pairs;
}

export function toCookieHeader(pairs: CookiePair[]): string {
  return pairs.map((p) => `${p.name}=${p.value}`).join("; ");
}

export function hasLogin(pairs: CookiePair[]): boolean {
  return pairs.some((p) => p.name === "z_c0" && p.value.length > 20);
}

export function cookieFromRequest(request: Request): string {
  const fromCookie = request.headers.get("Cookie")?.trim() ?? "";
  if (fromCookie) return fromCookie;
  return request.headers.get("X-Zhihu-Cookie")?.trim() ?? "";
}

export function cookiesDiffer(before: string, after: string): boolean {
  return toCookieHeader(parseCookieHeader(after)) !== toCookieHeader(parseCookieHeader(before));
}

export function zhihuHeaders(cookie: string, accept = "application/json"): HeadersInit {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Referer: "https://www.zhihu.com/",
    Accept: accept,
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  };
  if (cookie) headers.Cookie = cookie;
  return headers;
}
