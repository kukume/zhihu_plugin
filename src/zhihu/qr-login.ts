import QRCode from "qrcode";
import { UA } from "./cookies";
import { nativeFetch } from "./native-fetch";
import type { CookieJar } from "./http";
import { upsertCookie } from "./http";
import { generateZseCk, isZseCkChallenge } from "./zse-ck";

const SIGNIN = "https://www.zhihu.com/signin?next=%2F";

export type QrPoll =
  | { phase: "pending" | "scanned"; message: string }
  | { phase: "success"; message: string; cookie: string }
  | { phase: "done"; message: string };

type CreatedQr = {
  token: string;
  link: string;
  expiresAt: number;
};

function cookieValue(jar: CookieJar, name: string): string {
  const match = jar.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ?? "";
}

function absorbSetCookie(jar: CookieJar, setCookie: string[]): void {
  for (const raw of setCookie) {
    const matched = raw.match(/^([^=]+)=([^;]*)/);
    if (!matched?.[1] || !matched[2]) continue;
    jar.cookie = upsertCookie(jar.cookie, matched[1], matched[2]);
  }
}

async function request(
  jar: CookieJar,
  url: string,
  init: { method?: string; xsrf?: boolean; api?: boolean; hops?: number; challenged?: boolean },
): Promise<{ status: number; text: string }> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Referer: SIGNIN,
    "sec-ch-ua": '"Google Chrome";v="153", "Not_A Brand";v="8", "Chromium";v="153"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
  };
  if (!init.api && (init.method ?? "GET") === "GET") {
    headers.Accept = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8";
  }
  if (init.api || (init.method && init.method !== "GET")) {
    headers["x-requested-with"] = "fetch";
    headers["x-zse-93"] = "101_3_3.0";
  }
  if (init.method && init.method !== "GET") headers.Origin = "https://www.zhihu.com";
  if (init.xsrf) {
    const xsrf = cookieValue(jar, "_xsrf");
    if (xsrf) headers["x-xsrftoken"] = xsrf;
  }
  if (jar.cookie) headers.Cookie = jar.cookie;

  const res = await nativeFetch(url, {
    method: init.method ?? "GET",
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  absorbSetCookie(jar, setCookie);
  if (isZseCkChallenge(res.status, text)) {
    if (init.challenged) throw new Error("知乎安全验证未通过");
    const ck = await generateZseCk(text, url);
    jar.cookie = upsertCookie(jar.cookie, "__zse_ck", ck);
    return request(jar, url, { ...init, challenged: true });
  }
  if (res.status >= 300 && res.status < 400) {
    const hops = init.hops ?? 0;
    if (hops >= 5) throw new Error("登录页重定向过多");
    const location = res.headers.get("location");
    if (!location) return { status: res.status, text };
    return request(jar, new URL(location, url).toString(), { method: "GET", hops: hops + 1 });
  }
  return { status: res.status, text };
}

export class QrLogin {
  private jar: CookieJar = { cookie: "" };
  private created?: CreatedQr;

  async start(): Promise<{ image: string; message: string }> {
    const page = await request(this.jar, SIGNIN, {});
    if (page.status !== 200) throw new Error(`打开登录页失败: ${page.status}`);
    if (!cookieValue(this.jar, "_xsrf")) throw new Error("登录页没有返回 _xsrf");

    await request(this.jar, "https://www.zhihu.com/udid", { method: "POST", xsrf: true, api: true });

    const created = await request(this.jar, "https://www.zhihu.com/api/v3/account/api/login/qrcode", {
      method: "POST",
      xsrf: true,
      api: true,
    });
    if (created.status !== 200) throw new Error(`创建二维码失败: ${created.status}`);
    const data = JSON.parse(created.text) as { token?: string; link?: string; expires_at?: number };
    if (!data.token || !data.link) throw new Error("创建二维码失败");
    this.created = {
      token: data.token,
      link: data.link,
      expiresAt: data.expires_at ?? 0,
    };
    const image = await QRCode.toDataURL(data.link, { margin: 1, width: 220 });
    return { image, message: "请使用知乎 App 扫码" };
  }

  async poll(): Promise<QrPoll> {
    if (!this.created) return { phase: "done", message: "二维码尚未创建" };
    if (this.created.expiresAt && Date.now() / 1000 > this.created.expiresAt) {
      return { phase: "done", message: "二维码已过期" };
    }
    const url = `https://www.zhihu.com/api/v3/account/api/login/qrcode/${encodeURIComponent(this.created.token)}/scan_info`;
    const res = await request(this.jar, url, { api: true });
    if (res.status !== 200) return { phase: "done", message: `查询扫码状态失败: ${res.status}` };
    const data = JSON.parse(res.text) as { status?: number; user_id?: unknown; uid?: unknown };
    if (cookieValue(this.jar, "z_c0") || data.user_id || data.uid) {
      return { phase: "success", message: "登录成功", cookie: this.jar.cookie };
    }
    if (data.status === 1) return { phase: "scanned", message: "已扫码，请在手机上确认" };
    return { phase: "pending", message: "请使用知乎 App 扫码" };
  }
}
