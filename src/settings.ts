import * as vscode from "vscode";

/** Zhihu's recommend feed always returns 6 items per request, regardless of `limit`. */
export const RECOMMEND_PAGE_UNIT = 6;
/** The question feeds endpoint honours `limit`, but the UI steps in units of 3. */
export const OTHER_ANSWERS_PAGE_UNIT = 3;

function readPageSize(key: string, unit: number, fallback: number): number {
  const raw = vscode.workspace.getConfiguration("zhihu").get<number>(key);
  const value = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : fallback;
  const clamped = Math.min(Math.max(value, unit), unit * 10);
  // Round down to the nearest multiple so a hand-edited settings.json can't break paging.
  return Math.max(unit, Math.floor(clamped / unit) * unit);
}

/** How many items one "load more" should surface in the recommend feed. */
export function recommendPageSize(): number {
  return readPageSize("recommendPageSize", RECOMMEND_PAGE_UNIT, RECOMMEND_PAGE_UNIT);
}

/** How many items one "load more" should surface in the other-answers list. */
export function otherAnswersPageSize(): number {
  return readPageSize("otherAnswersPageSize", OTHER_ANSWERS_PAGE_UNIT, OTHER_ANSWERS_PAGE_UNIT);
}

/** Number of upstream requests needed to fill one UI page. */
export function requestCount(pageSize: number, unit: number): number {
  return Math.max(1, Math.ceil(pageSize / unit));
}
