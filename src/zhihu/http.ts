import { parseCookieHeader, toCookieHeader, UA } from "./cookies";
import { generateZseCk, isZseCkChallenge } from "./zse-ck";

export type CookieJar = { cookie: string };

export type ZhihuHttpResult = {
  status: number;
  text: string;
  location: string | null;
};

export function upsertCookie(header: string, name: string, value: string): string {
  const pairs = parseCookieHeader(header).filter((pair) => pair.name !== name);
  pairs.push({ name, value });
  return toCookieHeader(pairs);
}

function applySetCookie(jar: CookieJar, setCookie: string[]): void {
  for (const raw of setCookie) {
    const matched = raw.match(/^(__zse_ck)=([^;]*)/);
    if (!matched?.[2]) continue;
    jar.cookie = upsertCookie(jar.cookie, matched[1], matched[2]);
  }
}

function asTimeout(err: unknown): never {
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    throw new Error("请求超时");
  }
  throw err;
}

async function rawFetch(
  url: string,
  jar: CookieJar,
  init: { accept: string; redirect: RequestRedirect; navigate: boolean },
): Promise<ZhihuHttpResult & { setCookie: string[] }> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: init.accept,
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "identity",
  };
  if (init.navigate) {
    headers["sec-ch-ua"] = '"Google Chrome";v="153", "Not_A Brand";v="8", "Chromium";v="153"';
    headers["sec-ch-ua-mobile"] = "?0";
    headers["sec-ch-ua-platform"] = '"Windows"';
    headers["Upgrade-Insecure-Requests"] = "1";
    headers["sec-fetch-site"] = "same-origin";
    headers["sec-fetch-mode"] = "navigate";
    headers["sec-fetch-user"] = "?1";
    headers["sec-fetch-dest"] = "document";
    headers.Referer = url;
  } else {
    headers.Referer = "https://www.zhihu.com/";
  }
  if (jar.cookie) headers.Cookie = jar.cookie;

  let res: Response;
  try {
    res = await fetch(url, {
      headers,
      redirect: init.redirect,
      signal: AbortSignal.timeout(120000),
    });
  } catch (err) {
    asTimeout(err);
  }
  const text = await res.text();
  const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return {
    status: res.status,
    text,
    location: res.headers.get("location"),
    setCookie,
  };
}

export async function zhihuRequest(
  url: string,
  jar: CookieJar,
  options?: { accept?: string; redirect?: RequestRedirect; navigate?: boolean },
): Promise<ZhihuHttpResult> {
  const accept = options?.accept ?? "application/json, text/plain, */*";
  const redirect = options?.redirect ?? "follow";
  const navigate = options?.navigate ?? accept.startsWith("text/html");
  const init = { accept, redirect, navigate };

  let res = await rawFetch(url, jar, init);
  applySetCookie(jar, res.setCookie);
  if (!isZseCkChallenge(res.status, res.text)) {
    return { status: res.status, text: res.text, location: res.location };
  }

  const ck = await generateZseCk(res.text, url);
  jar.cookie = upsertCookie(jar.cookie, "__zse_ck", ck);
  res = await rawFetch(url, jar, init);
  applySetCookie(jar, res.setCookie);
  if (isZseCkChallenge(res.status, res.text)) {
    throw new Error("知乎返回安全验证，本地生成 __zse_ck 后仍然失败");
  }
  return { status: res.status, text: res.text, location: res.location };
}
