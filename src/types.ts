export interface RecommendItem {
  type: string;
  id: string | number;
  question_id?: string | number;
  title?: string;
  author?: string;
  voteup?: number;
  comments?: number;
  excerpt?: string;
  content?: string;
  url?: string;
  answers?: number;
  followers?: number;
  created_time?: number;
  updated_time?: number;
  raw_type?: string;
}

export type Segment =
  | { type: "text"; content: string }
  | { type: "image"; src: string };

export interface RecommendDetail {
  type: string;
  id: string | number;
  title: string;
  author: string;
  content_length: number;
  segments: Segment[];
  content: string;
  html: string;
  markdown: string;
  question_detail?: string;
}

export interface OtherAnswerItem {
  id: string | number;
  author: string;
  excerpt: string;
  voteup: number;
  comments: number;
  created_time?: number;
  title?: string;
  question_id?: string | number;
  url?: string;
  type?: string;
}

export interface OtherAnswersResponse {
  question_id: string;
  count: number;
  data: OtherAnswerItem[];
  next: string | null;
}

export interface CommentItem {
  id: string | number;
  author: string;
  content: string;
  images?: string[];
  like_count: number;
  url_token?: string;
  reply_to_author?: string;
  reply_comment_id?: string;
  created_time?: number;
  dislike_count?: number;
  ip_location?: string;
  child_comment_count?: number;
  child_comments?: CommentItem[];
  child_next_offset?: string;
}

export interface CommentsPaging {
  totals: number;
  is_end: boolean;
  offset?: string;
  next_offset?: string | null;
  has_next?: boolean;
}

export interface CommentsResponse {
  answer_id?: string;
  comment_id?: string;
  count: number;
  data: CommentItem[];
  paging: CommentsPaging;
}

export interface DecodeResponse {
  title: string;
  font_count: number;
  mapping_size: number;
  text_length: number;
  text: string;
  warnings: string[];
  cookie_refreshed?: boolean;
  cookie?: string;
}

export interface LoginStatus {
  logged_in: boolean;
  message?: string;
}

export function isAnswerType(type: string): boolean {
  return type === "回答" || type === "盐选小说" || type === "answer";
}

export function previewOf(item: RecommendItem): string {
  if (item.excerpt) {
    return item.excerpt;
  }
  if (item.content) {
    return item.content;
  }
  if (item.type === "问题" || item.type === "question") {
    const answers = item.answers ?? 0;
    const followers = item.followers ?? 0;
    return `${answers} 个回答 · ${followers} 人关注`;
  }
  if (item.author) {
    return item.author;
  }
  return "";
}

export function titleOf(item: RecommendItem): string {
  return (item.title || "").trim() || (item.type === "想法" ? `想法 · ${item.author || "匿名"}` : "(无标题)");
}
