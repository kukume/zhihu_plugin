import { cookiesDiffer } from "./cookies";
import {
  applyMapping,
  extractBase64Fonts,
  looksLikePaidHtml,
  pickContentFont,
} from "./fonts";
import type { CookieJar } from "./http";
import { mapGlyphsByOutline, type GlyphMapResult } from "./outline";
import {
  extractArticleHtml,
  extractTitle,
  htmlToMarkdown,
  htmlToPlain,
  htmlToSegments,
  looksLikeCssDump,
  type Segment,
} from "./html";
import { httpFetchHtml, resolvePaidColumnForAnswer } from "./paid-column";
import {
  parseZhihuUrl,
  targetId,
  targetTypeLabel,
  type ZhihuTarget,
} from "./urls";
import { HttpError, requireLogin } from "./zhihu";

export type DecodeResult = {
  url: string;
  paid_url?: string;
  type: string;
  id: string;
  question_id?: string;
  title: string;
  author: string;
  question_detail?: string;
  segments: Segment[];
  html: string;
  markdown: string;
  content: string;
  text: string;
  text_length: number;
  font_count: number;
  mapping_size: number;
  warnings: string[];
  cookie_refreshed: boolean;
  cookie?: string;
};

function stripLegalFooter(text: string): string {
  return text
    .replace(/备案号:[\s\S]*?(?:禁止转载)?\s*$/u, "")
    .replace(/©\s*本内容版权为知乎及版权方所有[\s\S]*?侵权必究\s*/u, "")
    .trim();
}

function applyGlyphsToHtml(html: string, mapped: GlyphMapResult, warnings: string[]): string {
  if (mapped.tofu) {
    warnings.push(mapped.error || "Reference CJK font failed to render; text left undecoded");
    return html;
  }
  if (Object.keys(mapped.mapping).length) {
    if (mapped.meanBest > 0 && mapped.meanBest < 0.7) {
      warnings.push(`Glyph match score ${mapped.meanBest.toFixed(2)} (Python-style mapping still applied)`);
    }
    return applyMapping(html, mapped.mapping);
  }
  if (html) warnings.push("No usable glyph mapping; text is still font-obfuscated");
  return html;
}

function resultFromHtmlBody(
  target: ZhihuTarget,
  htmlBody: string,
  title: string,
  mapped: GlyphMapResult,
  warnings: string[],
  extras: {
    font_count: number;
    cookie_refreshed: boolean;
    cookie?: string;
    author?: string;
    question_detail?: string;
  },
): DecodeResult {
  const decodedHtml = applyGlyphsToHtml(htmlBody, mapped, warnings);
  const text = stripLegalFooter(htmlToPlain(decodedHtml));
  if (looksLikeCssDump(text)) {
    warnings.push("Extracted text still looks like CSS; article body selector may have missed");
  }
  if (!text && !htmlToSegments(decodedHtml).length) {
    warnings.push("Article body not found in HTML");
  }
  return {
    url: target.url,
    type: targetTypeLabel(target),
    id: targetId(target),
    question_id: target.kind === "answer" ? target.questionId : undefined,
    title,
    author: extras.author ?? "",
    question_detail: extras.question_detail,
    segments: htmlToSegments(decodedHtml),
    html: decodedHtml,
    markdown: htmlToMarkdown(decodedHtml),
    content: text,
    text,
    text_length: text.length,
    font_count: extras.font_count,
    mapping_size: Object.keys(mapped.mapping).length,
    warnings,
    cookie_refreshed: extras.cookie_refreshed,
    cookie: extras.cookie,
  };
}

async function mapPaidHtml(
  html: string,
  warnings: string[],
  kind: string,
): Promise<{ mapped: GlyphMapResult; fontCount: number }> {
  const fonts = extractBase64Fonts(html);
  let mapped: GlyphMapResult = { mapping: {}, meanBest: 0, tofu: false };
  const picked = pickContentFont(fonts);
  if (picked) {
    try {
      mapped = await mapGlyphsByOutline(picked.font.base64, picked.chars);
    } catch (err) {
      warnings.push(`Glyph mapping failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (kind === "paid") {
    warnings.push("No content font found in HTML");
  }
  return { mapped, fontCount: fonts.length };
}

async function decodeFromHtml(target: ZhihuTarget, html: string, warnings: string[]): Promise<DecodeResult> {
  const title = extractTitle(html);
  const { mapped, fontCount } = await mapPaidHtml(html, warnings, target.kind);
  const body = extractArticleHtml(html, targetId(target));
  return resultFromHtmlBody(target, body, title, mapped, warnings, {
    font_count: fontCount,
    cookie_refreshed: false,
  });
}

async function decodePaidPage(jar: CookieJar, target: ZhihuTarget): Promise<DecodeResult> {
  if (target.kind !== "paid") {
    throw new HttpError(400, "不是盐选内容");
  }
  const warnings: string[] = [];
  requireLogin(jar.cookie);

  const first = await httpFetchHtml(target.url, jar);
  if (!looksLikePaidHtml(first.html)) {
    warnings.push("Fetched page is not paid HTML. Cookie may lack 盐选 access or login expired.");
  }
  return decodeFromHtml(target, first.html, warnings);
}

async function followPaidColumn(
  jar: CookieJar,
  original: ZhihuTarget,
  paidUrl: string,
  warnings: string[],
): Promise<DecodeResult> {
  const paidTarget = parseZhihuUrl(paidUrl);
  if (paidTarget.kind !== "paid") {
    throw new HttpError(400, "未找到对应盐选专栏");
  }
  warnings.push(`Using linked 盐选专栏 ${paidUrl}`);
  const paid = await decodePaidPage(jar, paidTarget);
  return {
    ...paid,
    url: original.url,
    paid_url: paidUrl,
    question_id: original.kind === "answer" ? original.questionId : paid.question_id,
    warnings: [...warnings, ...paid.warnings],
  };
}

export async function decodeZhihuUrl(url: string, jar: CookieJar): Promise<DecodeResult> {
  const before = jar.cookie;
  let target: ZhihuTarget;
  try {
    target = parseZhihuUrl(url);
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : "Invalid URL");
  }

  let result: DecodeResult;
  if (target.kind === "paid") {
    result = await decodePaidPage(jar, target);
  } else if (target.kind === "answer") {
    const resolved = await resolvePaidColumnForAnswer(jar, url);
    result = await followPaidColumn(jar, target, resolved.paidUrl, []);
  } else {
    throw new HttpError(400, "不是盐选内容");
  }

  const refreshed = cookiesDiffer(before, jar.cookie);
  return {
    ...result,
    cookie_refreshed: refreshed,
    cookie: refreshed ? jar.cookie : undefined,
  };
}
