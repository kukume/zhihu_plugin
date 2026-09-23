import { parseZhihuJson } from "./json";

export type Segment = { type: "text"; content: string } | { type: "image"; src: string };

export function stripDocumentNoise(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<link\b[^>]*>/gi, "");
}

export function htmlToPlain(html: string): string {
  let text = stripDocumentNoise(html);
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(?:p|div|h\d|li|blockquote|figcaption)\s*>/gi, "\n\n");
  text = text.replace(/<(?:p|div|h\d|li|blockquote)\b[^>]*>/gi, "\n");
  text = text.replace(/<hr\b[^>]*\/?>/gi, "\n---\n");
  text = text.replace(/<[^>]+>/g, "");
  text = decodeEntities(text).trim();
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  return text.replace(/^\n+|\n+$/g, "");
}

export function htmlToMarkdown(html: string): string {
  let text = stripDocumentNoise(html);
  for (let i = 6; i >= 1; i--) {
    const re = new RegExp(`<h${i}\\b[^>]*>([\\s\\S]*?)</h${i}>`, "gi");
    text = text.replace(re, `${"#".repeat(i)} $1\n`);
  }
  text = text.replace(/<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, "**$1**");
  text = text.replace(/<(?:i|em)\b[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, "*$1*");
  text = text.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, inner: string) => {
    const href = attrs.match(/href=["']([^"']+)["']/i);
    const linkText = inner.replace(/<[^>]+>/g, "").trim();
    if (!linkText) return "";
    if (href?.[1]?.startsWith("http")) return `[${linkText}](${href[1]})`;
    return linkText;
  });
  text = text.replace(/<img\b[^>]*\/?>/gi, (tag) => {
    const src = extractImgSrc(tag);
    const alt = tag.match(/alt=["']([^"']*)["']/i)?.[1] ?? "image";
    return src ? `![${alt}](${src})\n` : "";
  });
  text = text.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => {
    const body = htmlToPlain(inner)
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => `> ${l}`)
      .join("\n");
    return `\n${body}\n`;
  });
  text = text.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_m, inner: string) => {
    const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((x) => htmlToPlain(x[1]));
    return `\n${items.filter(Boolean).map((item) => `- ${item}`).join("\n")}\n`;
  });
  text = text.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner: string) => {
    const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((x) => htmlToPlain(x[1]));
    return `\n${items
      .filter(Boolean)
      .map((item, i) => `${i + 1}. ${item}`)
      .join("\n")}\n`;
  });
  text = text.replace(/<hr\b[^>]*\/?>/gi, "\n---\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p\s*>/gi, "\n\n");
  text = text.replace(/<\/div\s*>/gi, "\n");
  text = text.replace(/<(?:p|div)\b[^>]*>/gi, "");
  text = text.replace(/<[^>]+>/g, "");
  text = decodeEntities(text);
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  return text.replace(/^\n+|\n+$/g, "");
}

export function htmlToSegments(html: string): Segment[] {
  const parts = stripDocumentNoise(html).split(/(<img\b[^>]*\/?>|<figure\b[^>]*>[\s\S]*?<\/figure>)/gi);
  const segments: Segment[] = [];
  for (const part of parts) {
    if (!part.trim()) continue;
    const img = part.match(/<img\b[^>]*\/?>/i);
    if (img) {
      const src = extractImgSrc(img[0]);
      if (src) segments.push({ type: "image", src });
      continue;
    }
    const content = htmlToPlain(part);
    if (content) segments.push({ type: "text", content });
  }
  return segments;
}

export function extractImgSrc(tag: string): string | null {
  for (const attr of ["data-actualsrc", "data-original", "src"]) {
    const m = tag.match(new RegExp(`${attr}=["']([^"']+)["']`, "i"));
    if (m) return m[1];
  }
  return null;
}

function sliceBalancedTag(html: string, start: number, tagName: string): string {
  const openEnd = html.indexOf(">", start);
  if (openEnd < 0) return "";
  const tagRe = new RegExp(`</?${tagName}\\b[^>]*>`, "gi");
  tagRe.lastIndex = openEnd + 1;
  let depth = 1;
  let tag: RegExpExecArray | null;
  while ((tag = tagRe.exec(html))) {
    const token = tag[0];
    if (new RegExp(`^</${tagName}`, "i").test(token)) depth--;
    else if (!/\/\s*>$/.test(token)) depth++;
    if (depth === 0) return html.slice(openEnd + 1, tag.index);
  }
  return html.slice(openEnd + 1);
}

function classAttr(attrs: string): string {
  return attrs.match(/class\s*=\s*["']([^"']+)["']/i)?.[1] ?? attrs;
}

function isArticleClass(cls: string): boolean {
  return (
    (cls.includes("RichText") && cls.includes("richText")) ||
    cls.includes("CopyrightRichText") ||
    cls.includes("RichContent-inner") ||
    cls.includes("Post-RichText")
  );
}

function extractHtmlFromArticleTags(html: string): string {
  let best = "";
  let bestLen = 0;
  const openRe = /<(div|span)\b([^>]*)>/gi;
  let open: RegExpExecArray | null;
  while ((open = openRe.exec(html))) {
    const tagName = open[1] ?? "div";
    if (!isArticleClass(classAttr(open[2] ?? ""))) continue;
    const inner = sliceBalancedTag(html, open.index, tagName);
    const text = htmlToPlain(inner);
    if (text.length > bestLen) {
      best = inner;
      bestLen = text.length;
    }
  }
  return best;
}

function isContentHtml(value: string): boolean {
  if ((value.match(/\.css-[A-Za-z0-9_-]+\s*\{/g)?.length ?? 0) >= 3) return false;
  return /<(?:p|figure|img|h[1-6]|blockquote|ul|ol|pre|code|b|strong|em|br)\b/i.test(value);
}

function readInitialData(html: string): unknown | null {
  const m = html.match(/id="js-initialData"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m?.[1]) return null;
  const raw = m[1].trim();
  try {
    return parseZhihuJson(raw);
  } catch {
    try {
      return parseZhihuJson(decodeEntities(raw));
    } catch {
      return null;
    }
  }
}

export function extractHtmlFromInitialData(html: string, hintId?: string): string {
  const data = readInitialData(html);
  if (!data) return "";

  let hinted = "";
  let best = "";
  const seen = new Set<unknown>();

  const consider = (value: unknown, obj: Record<string, unknown>) => {
    if (typeof value !== "string" || !isContentHtml(value)) return;
    if (value.length > best.length) best = value;
    if (!hintId) return;
    const id = obj.id;
    if (id === hintId || id === Number(hintId) || String(id) === hintId) {
      if (value.length > hinted.length) hinted = value;
    }
  };

  const walk = (node: unknown) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    consider(obj.content, obj);
    consider(obj.detail, obj);
    for (const value of Object.values(obj)) walk(value);
  };

  walk(data);
  return hinted || best;
}

export function extractArticleHtml(html: string, hintId?: string): string {
  const fromTags = extractHtmlFromArticleTags(html);
  const tagText = htmlToPlain(fromTags);
  if (tagText.length > 80 && !looksLikeCssDump(tagText)) return fromTags;

  const fromJson = extractHtmlFromInitialData(html, hintId);
  const jsonText = htmlToPlain(fromJson);
  if (jsonText.length > 0 && !looksLikeCssDump(jsonText)) {
    if (jsonText.length >= tagText.length || looksLikeCssDump(tagText) || tagText.length <= 80) {
      return fromJson;
    }
  }
  return fromTags || fromJson;
}

export function extractArticleText(html: string, hintId?: string): string {
  return htmlToPlain(extractArticleHtml(html, hintId));
}

export function extractTitle(html: string): string {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!m) return "";
  return m[1]
    .trim()
    .replace(/\s*[-–—|]\s*知乎.*$/u, "")
    .replace(/\s*[-–—|]\s*Zhihu.*$/i, "");
}

export function looksLikeCssDump(text: string): boolean {
  const emotion = text.match(/\.css-[A-Za-z0-9_-]+\s*\{/g);
  if ((emotion?.length ?? 0) >= 3) return true;
  const rules = text.match(/[.#][A-Za-z][\w-]*\s*\{/g);
  return (rules?.length ?? 0) >= 8;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCharCode(parseInt(n, 16)));
}
