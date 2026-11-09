// Zhihu fingerprints the browser, so the UA and the client hints must agree.
// Bump CHROME_VERSION in one place and every header follows.
const CHROME_VERSION = "153";

export const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`;

export const SEC_CH_UA = `"Google Chrome";v="${CHROME_VERSION}", "Not_A Brand";v="8", "Chromium";v="${CHROME_VERSION}"`;
export const SEC_CH_UA_MOBILE = "?0";
export const SEC_CH_UA_PLATFORM = '"Windows"';

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

export function cookiesDiffer(before: string, after: string): boolean {
  const normalize = (raw: string) =>
    parseCookieHeader(raw)
      .map((pair) => `${pair.name}=${pair.value}`)
      .sort()
      .join("; ");
  return normalize(after) !== normalize(before);
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
