/**
 * Generate Zhihu __zse_ck from a 403 challenge page, without a real browser.
 * Same flow as gen_zse_ck.js: meta#zh-zse-ck + zse-ck/v4 script inside jsdom.
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { UA } from "./cookies";

const TIMEOUT_MS = 20000;

export function isZseCkChallenge(status: number, html: string): boolean {
  if (status !== 403) return false;
  return /id=["']zh-zse-ck["']/i.test(html) && /zse-ck\/v4\//i.test(html);
}

function extractChallenge(html: string): { token: string | null; scriptUrl: string | null } {
  const meta =
    html.match(/<meta[^>]*id=["']zh-zse-ck["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*id=["']zh-zse-ck["'][^>]*>/i);
  const script = html.match(/src=["'](https:\/\/static\.zhihu\.com\/zse-ck\/v4\/[^"']+)["']/i);
  return {
    token: meta ? meta[1] : null,
    scriptUrl: script ? script[1] : null,
  };
}

function patchEnv(window: {
  navigator: { webdriver?: boolean; languages?: readonly string[] };
  chrome?: unknown;
  PerformanceObserver?: unknown;
  requestAnimationFrame?: (cb: (time: number) => void) => number;
  WebAssembly?: typeof WebAssembly;
  TextEncoder?: typeof TextEncoder;
  TextDecoder?: typeof TextDecoder;
  crypto?: Crypto;
  outerWidth?: number;
  outerHeight?: number;
  innerWidth?: number;
  innerHeight?: number;
  location: { reload: () => void };
}): void {
  try {
    Object.defineProperty(window.navigator, "webdriver", {
      configurable: true,
      get: () => false,
    });
  } catch {
    // already defined
  }

  if (!window.chrome) {
    window.chrome = { runtime: {}, app: {}, csi: () => ({}), loadTimes: () => ({}) };
  }

  if (typeof window.PerformanceObserver === "undefined") {
    window.PerformanceObserver = class {
      observe(): void {}
      disconnect(): void {}
      takeRecords(): unknown[] {
        return [];
      }
    };
  }

  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
  }

  try {
    Object.defineProperty(window.navigator, "languages", {
      get: () => ["zh-CN", "zh", "en"],
    });
  } catch {
    // already defined
  }

  if (!window.WebAssembly) window.WebAssembly = WebAssembly;
  if (!window.TextEncoder) window.TextEncoder = TextEncoder;
  if (!window.TextDecoder) window.TextDecoder = TextDecoder;
  if (!window.crypto) window.crypto = globalThis.crypto;

  try {
    Object.defineProperty(window, "outerWidth", { get: () => 1920 });
    Object.defineProperty(window, "outerHeight", { get: () => 1080 });
    Object.defineProperty(window, "innerWidth", { get: () => 1920 });
    Object.defineProperty(window, "innerHeight", { get: () => 969 });
  } catch {
    // already defined
  }
}

function runChallenge(html: string, scriptSource: string, url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let cookieJar = "";
    let dom: JSDOM | undefined;

    const finish = (err: Error | null, cookie?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const closing = dom;
      queueMicrotask(() => {
        try {
          closing?.window.close();
        } catch {
          // Challenge script may still be unwinding.
        }
      });
      if (err) reject(err);
      else resolve(cookie ?? "");
    };

    const timer = setTimeout(() => {
      const matched = cookieJar.match(/__zse_ck=([^;]+)/);
      if (matched?.[1]) finish(null, matched[1]);
      else finish(new Error(`等待 __zse_ck 超时（${TIMEOUT_MS}ms）`));
    }, TIMEOUT_MS);

    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", () => {
      // TinyGo may throw after writing the cookie.
    });

    const bareHtml = html.replace(
      /<script([^>]*?)src=["']https:\/\/static\.zhihu\.com\/zse-ck\/v4\/[^"']+["']([^>]*)>\s*<\/script>/i,
      "<!-- zse-ck script injected after parse -->",
    );

    try {
      dom = new JSDOM(bareHtml, {
        url,
        referrer: "https://www.zhihu.com/",
        contentType: "text/html",
        runScripts: "dangerously",
        resources: "usable",
        pretendToBeVisual: true,
        virtualConsole,
        beforeParse(window) {
          patchEnv(window);
          Object.defineProperty(window.document, "cookie", {
            configurable: true,
            enumerable: true,
            get() {
              return cookieJar;
            },
            set(value: string) {
              const text = String(value);
              const name = text.split("=")[0] ?? "";
              const parts = cookieJar
                ? cookieJar.split("; ").filter((part) => part && !part.startsWith(`${name}=`))
                : [];
              const kv = text.split(";")[0]?.trim() ?? "";
              const cookieValue = kv.includes("=") ? kv.split("=").slice(1).join("=") : "";
              if (kv.includes("=") && cookieValue !== "") parts.push(kv);
              cookieJar = parts.join("; ");
              const matched = kv.match(/^__zse_ck=(.+)$/);
              if (matched?.[1]) finish(null, matched[1]);
            },
          });
          try {
            window.location.reload = () => {
              // Challenge script reloads after setting the cookie.
            };
          } catch {
            // location.reload may be non-configurable
          }
        },
      });
    } catch (err) {
      finish(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    try {
      const el = dom.window.document.createElement("script");
      el.setAttribute(
        "data-assets-tracker-config",
        JSON.stringify({ appName: "zse_ck", trackJSRuntimeError: true }),
      );
      el.textContent = scriptSource;
      dom.window.document.body.appendChild(el);
    } catch (err) {
      finish(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

async function fetchScript(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "*/*",
      "Accept-Encoding": "identity",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`下载 zse-ck 脚本失败: ${res.status}`);
  return res.text();
}

function swallowRuntimeCrash(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn("[zse-ck]", message);
}

export async function generateZseCk(html: string, pageUrl: string): Promise<string> {
  const { token, scriptUrl } = extractChallenge(html);
  if (!token || !scriptUrl) {
    throw new Error("403 页面里没有 zh-zse-ck 挑战参数");
  }
  const scriptSource = await fetchScript(scriptUrl);

  process.on("uncaughtException", swallowRuntimeCrash);
  process.on("unhandledRejection", swallowRuntimeCrash);
  try {
    const cookie = await runChallenge(html, scriptSource, pageUrl);
    if (!cookie) throw new Error("未生成 __zse_ck");
    if (cookie.startsWith("001_")) {
      throw new Error("本地环境生成的 __zse_ck 是 fallback（001_），知乎不会接受");
    }
    return cookie;
  } finally {
    process.off("uncaughtException", swallowRuntimeCrash);
    process.off("unhandledRejection", swallowRuntimeCrash);
  }
}
