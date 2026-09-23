export type ZhihuTarget =
  | { kind: "answer"; id: string; questionId?: string; url: string }
  | { kind: "question"; id: string; url: string }
  | { kind: "article"; id: string; url: string }
  | { kind: "paid"; columnId: string; sectionId: string; url: string }
  | { kind: "unknown"; url: string };

const ID = "([0-9]+)";
const PAGE_HOSTS = new Set(["www.zhihu.com", "zhihu.com", "zhuanlan.zhihu.com"]);

export function isZhihuPageHost(hostname: string): boolean {
  return PAGE_HOSTS.has(hostname.toLowerCase());
}

export function assertSafeZhihuUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS URLs are allowed");
  }
  if (!isZhihuPageHost(parsed.hostname)) {
    throw new Error("Not a zhihu.com URL");
  }
  parsed.hash = "";
  return parsed.toString();
}

export function parseZhihuUrl(raw: string): ZhihuTarget {
  const url = assertSafeZhihuUrl(raw);
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/\/+$/, "") || "/";

  const paid = path.match(new RegExp(`^/market/paid_column/${ID}/section/${ID}$`));
  if (paid) {
    return { kind: "paid", columnId: paid[1], sectionId: paid[2], url };
  }

  const answer = path.match(new RegExp(`^/question/${ID}/answer/${ID}$`));
  if (answer) {
    return { kind: "answer", questionId: answer[1], id: answer[2], url };
  }

  const answerOnly = path.match(new RegExp(`^/answer/${ID}$`));
  if (answerOnly) {
    return { kind: "answer", id: answerOnly[1], url };
  }

  const question = path.match(new RegExp(`^/question/${ID}$`));
  if (question) {
    return { kind: "question", id: question[1], url };
  }

  const article = path.match(/^\/p\/([0-9]+)$/);
  if (article) {
    return { kind: "article", id: article[1], url };
  }

  return { kind: "unknown", url };
}

export function targetTypeLabel(target: ZhihuTarget): string {
  switch (target.kind) {
    case "answer":
      return "回答";
    case "question":
      return "问题";
    case "article":
      return "文章";
    case "paid":
      return "盐选专栏";
    default:
      return "未知";
  }
}

export function targetId(target: ZhihuTarget): string {
  switch (target.kind) {
    case "answer":
    case "question":
    case "article":
      return target.id;
    case "paid":
      return target.sectionId;
    default:
      return "";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function paidUrlFromMaybeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const target = parseZhihuUrl(value);
    return target.kind === "paid" ? target.url : null;
  } catch {
    return null;
  }
}

/** kmqa `/answers/:id/paid_content`: `next_section_info.url` / `new_intro_card.url`. */
export function paidColumnUrlFromPaidContent(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  const next = asRecord(data.next_section_info);
  const intro = asRecord(data.new_intro_card);
  for (const url of [next?.url, intro?.url]) {
    const paid = paidUrlFromMaybeString(url);
    if (paid) return paid;
  }
  return null;
}
