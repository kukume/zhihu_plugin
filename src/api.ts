import * as vscode from "vscode";
import type {
  CommentsResponse,
  DecodeResponse,
  LoginStatus,
  RecommendDetail,
  RecommendItem,
} from "./types";

function getBaseUrl(): string {
  const config = vscode.workspace.getConfiguration("zhihu");
  const url = (config.get<string>("baseUrl") ?? "").trim().replace(/\/+$/, "");
  if (!url) {
    throw new Error("请先在设置中配置 zhihu.baseUrl");
  }
  return url;
}

export function getRecommendLimit(): number {
  const config = vscode.workspace.getConfiguration("zhihu");
  const n = config.get<number>("recommendLimit", 8);
  return Math.min(20, Math.max(1, n || 8));
}

async function request<T>(
  path: string,
  options?: { method?: string; body?: unknown },
  timeout = 35000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const headers: Record<string, string> = {};
    let body: string | undefined;
    if (options?.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    const res = await fetch(`${getBaseUrl()}${path}`, {
      method: options?.method ?? "GET",
      headers,
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text };
      }
    }
    if (!res.ok) {
      const err =
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `HTTP ${res.status}`;
      throw new Error(err);
    }
    return data as T;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("请求超时");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function getLoginStatus(): Promise<LoginStatus> {
  return request<LoginStatus>("/");
}

export async function getRecommendations(
  limit: number,
): Promise<{ count: number; data: RecommendItem[] }> {
  return request(`/recommend?limit=${limit}`);
}

export async function getRecommendDetail(
  id: string | number,
  type: string,
): Promise<RecommendDetail> {
  const params = new URLSearchParams({ type });
  return request(`/recommend/${encodeURIComponent(String(id))}?${params.toString()}`);
}

export async function getComments(
  answerId: string | number,
  limit = 20,
  offset = "",
  orderBy = "score",
): Promise<CommentsResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset,
    order_by: orderBy,
  });
  return request(`/comments/${encodeURIComponent(String(answerId))}?${params.toString()}`);
}

export async function getChildComments(
  commentId: string | number,
  limit = 20,
  offset = "",
): Promise<CommentsResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset,
  });
  return request(`/child_comments/${encodeURIComponent(String(commentId))}?${params.toString()}`);
}

export async function decodeUrl(url: string): Promise<DecodeResponse> {
  return request<DecodeResponse>("/decode", { method: "POST", body: { url } }, 120000);
}
