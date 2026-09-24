import { cookieFromRequest, hasLogin, parseCookieHeader } from "./cookies";
import { extractArticleHtml, extractTitle, htmlToMarkdown, htmlToPlain, htmlToSegments } from "./html";
import type { CookieJar } from "./http";
import { zhihuMultipartPost, zhihuRequest } from "./http";
import { parseZhihuJson } from "./json";

export function requireLogin(cookie: string): void {
  if (!hasLogin(parseCookieHeader(cookie))) {
    throw new HttpError(401, "未登录");
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown>;

async function zhihuGet(url: string, jar: CookieJar): Promise<{ status: number; text: string }> {
  const res = await zhihuRequest(url, jar);
  return { status: res.status, text: res.text };
}

function zhihuJson(text: string): Json | null {
  try {
    const data = parseZhihuJson(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return data as Json;
  } catch {
    return null;
  }
}

function contentTypeLabel(target: Json): string {
  const t = String(target.type ?? "");
  if (t === "answer") {
    const answerType = String(target.answer_type ?? "");
    const label = String(((target.label_info as Json) ?? {}).type ?? "");
    if (answerType === "paid" || label === "paid") return "盐选小说";
    return "回答";
  }
  if (t === "question") return "问题";
  if (t === "article") return "文章";
  if (t === "pin") return "想法";
  if (t === "zvideo") return "视频";
  return t || "未知";
}

function stripTags(text: string): string {
  return htmlToPlain(text);
}

function recommendFirstPage(): string {
  return "https://www.zhihu.com/api/v3/feed/topstory/recommend?limit=10&desktop=true";
}

type LastReadKind = "answer" | "post" | "question" | "pin";
type LastReadAction = "touch" | "read";

/** Map plugin content labels to /lastread/touch content kinds. */
export function lastReadKindForType(type: string): LastReadKind | null {
  if (isAnswerType(type)) return "answer";
  if (isArticleType(type)) return "post";
  if (isQuestionType(type)) return "question";
  if (type === "想法" || type === "pin") return "pin";
  return null;
}

async function postLastRead(
  jar: CookieJar,
  items: Array<[LastReadKind, string, LastReadAction]>,
): Promise<void> {
  if (!items.length) return;
  const res = await zhihuMultipartPost("https://www.zhihu.com/lastread/touch", jar, {
    items: JSON.stringify(items),
  });
  // Website treats 201 as success; ignore soft failures so opening content never breaks.
  if (res.status !== 200 && res.status !== 201) {
    throw new HttpError(res.status, `阅读上报失败: ${res.status}`);
  }
}

/** Report open like the website: touch first, then read. */
export async function reportContentOpen(
  jar: CookieJar,
  id: string | number,
  type: string,
): Promise<void> {
  const kind = lastReadKindForType(type);
  if (!kind) return;
  const contentId = String(id);
  if (!contentId) return;
  await postLastRead(jar, [[kind, contentId, "touch"]]);
  await postLastRead(jar, [[kind, contentId, "read"]]);
}

/** Hard ads (`feed_advert`) and native promoted cards (`promotion_extra` / plutus). */
function isRecommendAd(item: Json): boolean {
  const type = String(item.type ?? "");
  if (type === "feed_advert" || type.includes("advert")) return true;
  if (item.ad != null || item.adjson != null || item.ad_list != null) return true;
  const promo = item.promotion_extra;
  if (promo == null || promo === "") return false;
  if (typeof promo === "string") return true;
  if (typeof promo === "object") return true;
  return false;
}

export async function fetchRecommendations(jar: CookieJar, startUrl?: string | null) {
  const pageUrl = startUrl || recommendFirstPage();
  const resp = await zhihuGet(pageUrl, jar);
  if (resp.status === 401) throw new HttpError(401, "登录已失效");
  if (resp.status !== 200) {
    throw new HttpError(resp.status, `推荐接口失败: ${resp.status}`);
  }
  const data = zhihuJson(resp.text);
  if (!data) {
    throw new HttpError(resp.status, `推荐接口失败: ${resp.status}`);
  }
  const all: Json[] = [];
  const items = (data.data as Json[]) ?? [];
  for (const item of items) {
      if (isRecommendAd(item)) continue;
      const t = (item.target as Json) ?? {};
      const kind = String(t.type ?? "");
      // Ads and odd cards often have no target.type; don't render empty placeholders.
      if (!kind) continue;
      const entry: Json = { type: contentTypeLabel(t) };
      if (kind === "answer") {
        const q = (t.question as Json) ?? {};
        const author = (t.author as Json) ?? {};
        entry.id = t.id;
        entry.question_id = q.id;
        entry.title = q.title ?? "";
        entry.author = author.name ?? "匿名";
        entry.voteup = t.voteup_count ?? 0;
        entry.comments = t.comment_count ?? 0;
        entry.excerpt = stripTags(String(t.excerpt ?? ""));
        entry.url = `https://www.zhihu.com/question/${q.id}/answer/${t.id}`;
        entry.created_time = t.created_time;
        entry.updated_time = t.updated_time;
      } else if (kind === "question") {
        entry.id = t.id;
        entry.title = t.title ?? "";
        entry.answers = t.answer_count ?? 0;
        entry.followers = t.follower_count ?? 0;
        entry.url = `https://www.zhihu.com/question/${t.id}`;
      } else if (kind === "article") {
        const author = (t.author as Json) ?? {};
        entry.id = t.id;
        entry.title = t.title ?? "";
        entry.author = author.name ?? "匿名";
        entry.excerpt = stripTags(String(t.excerpt ?? ""));
        entry.content = String(t.content ?? "");
        entry.url = `https://zhuanlan.zhihu.com/p/${t.id}`;
        entry.created_time = t.created;
        entry.updated_time = t.updated;
      } else if (kind === "pin") {
        const author = (t.author as Json) ?? {};
        entry.id = t.id;
        entry.author = author.name ?? "匿名";
        entry.content = stripTags(String(t.content ?? "")).slice(0, 200);
      } else {
        // Skip unsupported card types (zvideo, etc.) instead of showing empty rows.
        continue;
      }
      all.push(entry);
  }
  const paging = (data.paging as Json) ?? {};
  const following = String(paging.next ?? "");
  // Use the raw page size for end detection so an all-ad page doesn't stop pagination.
  const isEnd = Boolean(paging.is_end) || !following || items.length === 0;
  return { items: all, next: isEnd ? null : following };
}

function isAnswerType(type: string): boolean {
  return type === "回答" || type === "盐选小说" || type === "answer";
}

function isQuestionType(type: string): boolean {
  return type === "问题" || type === "question";
}

function isArticleType(type: string): boolean {
  return type === "文章" || type === "article";
}

const ANSWER_INCLUDE =
  "content,question,question.title,question.detail,author.name,answer_type,label_info";

function asJson(value: unknown): Json | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Json;
}

export async function fetchAnswerJson(jar: CookieJar, id: string): Promise<Json | null> {
  const urls = [
    `https://www.zhihu.com/api/v4/answers/${id}?include=${ANSWER_INCLUDE}`,
    `https://api.zhihu.com/answers/${id}?include=${ANSWER_INCLUDE}`,
  ];
  for (const url of urls) {
    const resp = await zhihuGet(url, jar);
    if (resp.status === 401 || resp.status === 403) throw new HttpError(401, "未登录");
    if (resp.status !== 200) continue;
    try {
      const data = asJson(parseZhihuJson(resp.text));
      if (data) return data;
    } catch {
      return null;
    }
  }
  return null;
}

const KMQA_PAID_CONTENT_INCLUDE = "goods_card,btn_info,za_info,ab_param,benefits_pics";

export async function fetchAnswerPaidContent(
  jar: CookieJar,
  answerId: string,
): Promise<Json | null> {
  if (!/^\d+$/.test(answerId)) return null;
  const include = encodeURIComponent(KMQA_PAID_CONTENT_INCLUDE);
  const urls = [
    `https://api.zhihu.com/kmqa/answers/${answerId}/paid_content?include=${include}`,
    `https://www.zhihu.com/api/v4/kmqa/answers/${answerId}/paid_content?include=${include}`,
  ];
  for (const url of urls) {
    const resp = await zhihuGet(url, jar);
    if (resp.status === 401) throw new HttpError(401, "未登录");
    if (resp.status !== 200) continue;
    const data = zhihuJson(resp.text);
    if (data) return data;
  }
  return null;
}

export async function fetchFullContent(jar: CookieJar, item: Json) {
  const t = String(item.type ?? "");
  let html: string | null = null;
  let title = "";
  let author = "";
  let qDetail = "";

  if (isAnswerType(t)) {
    const data = await fetchAnswerJson(jar, String(item.id));
    if (!data) return null;
    html = String(data.content ?? "");
    title = String(((data.question as Json) ?? {}).title ?? "");
    author = String(((data.author as Json) ?? {}).name ?? "");
    qDetail = String(((data.question as Json) ?? {}).detail ?? "");
  } else if (isQuestionType(t)) {
    const resp = await zhihuGet(
      `https://www.zhihu.com/api/v4/questions/${item.id}?include=title,detail,author.name`,
      jar,
    );
    if (resp.status !== 200) return null;
    const data = zhihuJson(resp.text);
    if (!data) return null;
    html = String(data.detail ?? "");
    title = String(data.title ?? "");
    author = String(((data.author as Json) ?? {}).name ?? "");
  } else if (isArticleType(t)) {
    const cached = String(item.html ?? "");
    title = String(item.title ?? "");
    author = String(item.author ?? "");
    if (cached.includes("<")) {
      html = cached;
    } else {
      const page = await zhihuRequest(`https://zhuanlan.zhihu.com/p/${item.id}`, jar, {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        redirect: "follow",
        navigate: true,
      });
      if (page.status !== 200) return null;
      html = extractArticleHtml(page.text, String(item.id));
      title = extractTitle(page.text) || title;
    }
  }

  if (html == null) return null;
  const segments = htmlToSegments(html);
  const plain = segments.filter((s) => s.type === "text").map((s) => s.content).join("");
  return {
    type: t,
    title,
    author,
    question_detail: qDetail,
    segments,
    plain_text: plain,
    html,
    markdown: htmlToMarkdown(html),
    content: plain,
  };
}

function parseComment(c: Json) {
  const rawHtml = String(c.content ?? "");
  let authorObj = (c.author as Json) ?? {};
  if ("member" in authorObj) authorObj = (authorObj.member as Json) ?? {};
  let ipLocation = "";
  for (const tag of (c.comment_tag as Json[]) ?? []) {
    if (tag.type === "ip_info") ipLocation = String(tag.text ?? "");
  }
  const images: string[] = [];
  for (const m of rawHtml.matchAll(/<a\b[^>]*>/gi)) {
    if (m[0].includes("comment_img")) {
      const href = m[0].match(/href="([^"]+)"/);
      if (href) images.push(href[1]);
    }
  }
  const replyTo = (c.reply_to_author as Json) ?? null;
  const replyToName = replyTo?.name ? String(replyTo.name) : "";
  const replyCommentId = c.reply_comment_id != null ? String(c.reply_comment_id) : "";
  return {
    id: c.id,
    author: String(authorObj.name ?? "匿名用户"),
    content: htmlToPlain(rawHtml),
    images,
    like_count: c.vote_count ?? c.like_count ?? 0,
    url_token: String(authorObj.url_token ?? ""),
    reply_to_author: replyToName || undefined,
    reply_comment_id: replyCommentId && replyCommentId !== "0" ? replyCommentId : undefined,
    created_time: c.created_time,
    dislike_count: c.dislike_count ?? 0,
    ip_location: ipLocation,
  };
}

function parseCommentV5(c: Json) {
  const cmt = parseComment(c) as Json;
  cmt.child_comment_count = c.child_comment_count ?? 0;
  const childList = (c.child_comments as Json[]) ?? [];
  cmt.child_comments = childList.map(parseCommentV5);
  cmt.child_next_offset = c.child_comment_next_offset;
  return cmt;
}

const QUESTION_FEEDS_INCLUDE =
  "data[*].excerpt,voteup_count,comment_count,created_time,author.name,question";

function mapQuestionFeedAnswer(card: Json, questionId: string): Json | null {
  const targetType = String(card.target_type ?? "");
  const t = (card.target as Json) ?? {};
  const kind = String(t.type ?? targetType ?? "");
  if (kind !== "answer") return null;
  const q = (t.question as Json) ?? {};
  const author = (t.author as Json) ?? {};
  const qid = String(q.id ?? questionId);
  const id = t.id;
  if (id == null) return null;
  return {
    type: contentTypeLabel(t),
    id,
    question_id: qid,
    title: String(q.title ?? ""),
    author: String(author.name ?? "匿名"),
    voteup: Number(t.voteup_count ?? 0),
    comments: Number(t.comment_count ?? 0),
    excerpt: stripTags(String(t.excerpt ?? "")),
    url: `https://www.zhihu.com/question/${qid}/answer/${id}`,
    created_time: t.created_time,
  };
}

export async function fetchQuestionFeeds(
  jar: CookieJar,
  questionId: string,
  opts: { excludeAnswerId?: string; nextUrl?: string | null; limit?: number } = {},
): Promise<{ items: Json[]; next: string | null }> {
  const limit = opts.limit ?? 3;
  const exclude = opts.excludeAnswerId != null ? String(opts.excludeAnswerId) : "";
  let url = opts.nextUrl || "";
  if (!url) {
    const first = new URL(`https://www.zhihu.com/api/v4/questions/${questionId}/feeds`);
    first.searchParams.set("include", QUESTION_FEEDS_INCLUDE);
    first.searchParams.set("limit", String(limit));
    first.searchParams.set("offset", "");
    first.searchParams.set("order", "default");
    first.searchParams.set("platform", "desktop");
    first.searchParams.set("ws_qiangzhisafe", "0");
    url = first.toString();
  }

  let items: Json[] = [];
  let next: string | null = null;
  // If the current answer fills the page, follow next once so UI can still show siblings.
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await zhihuGet(url, jar);
    if (resp.status === 401) throw new HttpError(401, "登录已失效");
    if (resp.status !== 200) {
      throw new HttpError(resp.status, `问题回答列表失败: ${resp.status}`);
    }
    const data = zhihuJson(resp.text) ?? {};
    const paging = (data.paging as Json) ?? {};
    next = paging.is_end || !paging.next ? null : String(paging.next);
    const pageItems: Json[] = [];
    for (const card of (data.data as Json[]) ?? []) {
      const mapped = mapQuestionFeedAnswer(card, questionId);
      if (!mapped) continue;
      if (exclude && String(mapped.id) === exclude) continue;
      pageItems.push(mapped);
    }
    items = items.concat(pageItems);
    if (items.length > 0 || !next) break;
    url = next;
  }
  return { items, next };
}

export async function fetchComments(
  jar: CookieJar,
  answerId: string,
  limit: number,
  offset: string,
  orderBy: string,
) {
  const url = new URL(`https://www.zhihu.com/api/v4/comment_v5/answers/${answerId}/root_comment`);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", offset);
  url.searchParams.set("order_by", orderBy);
  const resp = await zhihuGet(url.toString(), jar);
  if (resp.status !== 200) return { comments: [] as Json[], paging: {} as Json };
  const data = zhihuJson(resp.text) ?? {};
  const paging = (data.paging as Json) ?? {};
  const nextUrl = String(paging.next ?? "");
  const nextOffset = nextUrl.match(/offset=([^&]+)/)?.[1] ?? null;
  const comments = ((data.data as Json[]) ?? [])
    .filter((c) => String(c.reply_comment_id ?? "0") === "0")
    .map(parseCommentV5);
  return {
    comments,
    paging: {
      totals: paging.totals ?? 0,
      is_end: paging.is_end ?? false,
      offset,
      next_offset: nextOffset,
      has_next: !paging.is_end,
    },
  };
}

export async function fetchChildComments(
  jar: CookieJar,
  commentId: string,
  limit: number,
  offset: string,
) {
  const url = new URL(`https://www.zhihu.com/api/v4/comment_v5/comment/${commentId}/child_comment`);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", offset);
  url.searchParams.set("order_by", "ts");
  const resp = await zhihuGet(url.toString(), jar);
  if (resp.status !== 200) return { comments: [] as Json[], paging: {} as Json };
  const data = zhihuJson(resp.text) ?? {};
  const paging = (data.paging as Json) ?? {};
  const nextUrl = String(paging.next ?? "");
  const nextOffset = nextUrl.match(/offset=([^&]+)/)?.[1] ?? null;
  return {
    comments: ((data.data as Json[]) ?? []).map(parseCommentV5),
    paging: {
      totals: paging.totals ?? 0,
      is_end: paging.is_end ?? false,
      offset,
      next_offset: nextOffset,
      has_next: !paging.is_end,
    },
  };
}

export function getCookieOrThrow(request: Request): string {
  const cookie = cookieFromRequest(request);
  requireLogin(cookie);
  return cookie;
}
