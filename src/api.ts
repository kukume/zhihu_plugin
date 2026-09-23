import * as vscode from "vscode";
import { cookiesDiffer, hasLogin, parseCookieHeader } from "./zhihu/cookies";
import { decodeZhihuUrl } from "./zhihu/decode";
import type { CookieJar } from "./zhihu/http";
import {
  fetchChildComments,
  fetchComments,
  fetchFullContent,
  fetchRecommendations,
  HttpError,
  reportContentOpen,
  requireLogin,
} from "./zhihu/zhihu";
import type {
  CommentsResponse,
  DecodeResponse,
  LoginStatus,
  RecommendDetail,
  RecommendItem,
} from "./types";

function getConfig() {
  return vscode.workspace.getConfiguration("zhihu");
}

function getCookie(): string {
  return (getConfig().get<string>("cookie") ?? "").trim();
}

function cookieConfigTarget(): vscode.ConfigurationTarget {
  const inspect = getConfig().inspect<string>("cookie");
  if (inspect?.workspaceFolderValue !== undefined) {
    return vscode.ConfigurationTarget.WorkspaceFolder;
  }
  if (inspect?.workspaceValue !== undefined) {
    return vscode.ConfigurationTarget.Workspace;
  }
  return vscode.ConfigurationTarget.Global;
}

async function persistCookie(cookie: string): Promise<void> {
  await getConfig().update("cookie", cookie, cookieConfigTarget());
}

export async function saveLoginCookie(cookie: string): Promise<void> {
  await persistCookie(cookie);
}

export async function clearLoginCookie(): Promise<void> {
  await persistCookie("");
}

function rethrow(err: unknown): never {
  if (err instanceof HttpError) throw new Error(err.message);
  throw err;
}

async function withCookie<T>(fn: (jar: CookieJar) => Promise<T>): Promise<T> {
  const before = getCookie();
  const jar: CookieJar = { cookie: before };
  try {
    const result = await fn(jar);
    if (cookiesDiffer(before, jar.cookie)) await persistCookie(jar.cookie);
    return result;
  } catch (err) {
    if (cookiesDiffer(before, jar.cookie)) await persistCookie(jar.cookie);
    rethrow(err);
  }
}

export async function getLoginStatus(): Promise<LoginStatus> {
  const logged_in = hasLogin(parseCookieHeader(getCookie()));
  return { logged_in, message: logged_in ? "已登录" : "未登录" };
}

export async function getRecommendations(
  nextUrl?: string | null,
): Promise<{ count: number; data: RecommendItem[]; next: string | null }> {
  return withCookie(async (jar) => {
    requireLogin(jar.cookie);
    const page = await fetchRecommendations(jar, nextUrl);
    const data = page.items as unknown as RecommendItem[];
    return { count: data.length, data, next: page.next };
  });
}

export async function getRecommendDetail(
  id: string | number,
  type: string,
  extra?: { title?: string; author?: string; html?: string },
): Promise<RecommendDetail> {
  return withCookie(async (jar) => {
    requireLogin(jar.cookie);
    const detail = await fetchFullContent(jar, { type, id, ...extra });
    if (!detail) throw new HttpError(404, "Content not found");
    return {
      type: detail.type,
      id,
      title: detail.title,
      author: detail.author,
      content_length: detail.plain_text.length,
      segments: detail.segments,
      content: detail.plain_text,
      html: detail.html,
      markdown: detail.markdown,
      question_detail: detail.question_detail || undefined,
    };
  });
}

/** Fire-and-forget website-compatible open report: touch then read. */
export async function reportRecommendOpen(id: string | number, type: string): Promise<void> {
  try {
    await withCookie(async (jar) => {
      if (!hasLogin(parseCookieHeader(jar.cookie))) return;
      await reportContentOpen(jar, id, type);
    });
  } catch {
    // Reporting must never block reading.
  }
}

export async function getComments(
  answerId: string | number,
  limit = 20,
  offset = "",
  orderBy = "score",
): Promise<CommentsResponse> {
  return withCookie(async (jar) => {
    requireLogin(jar.cookie);
    const { comments, paging } = await fetchComments(jar, String(answerId), limit, offset, orderBy);
    return {
      answer_id: String(answerId),
      count: comments.length,
      data: comments,
      paging,
    } as unknown as CommentsResponse;
  });
}

export async function getChildComments(
  commentId: string | number,
  limit = 20,
  offset = "",
): Promise<CommentsResponse> {
  return withCookie(async (jar) => {
    requireLogin(jar.cookie);
    const { comments, paging } = await fetchChildComments(jar, String(commentId), limit, offset);
    return {
      comment_id: String(commentId),
      count: comments.length,
      data: comments,
      paging,
    } as unknown as CommentsResponse;
  });
}

export async function decodeUrl(url: string): Promise<DecodeResponse> {
  return withCookie(async (jar) => {
    const result = await decodeZhihuUrl(url, jar);
    return {
      title: result.title,
      font_count: result.font_count,
      mapping_size: result.mapping_size,
      text_length: result.text_length,
      text: result.text,
      warnings: result.warnings,
      cookie_refreshed: result.cookie_refreshed,
    };
  });
}
