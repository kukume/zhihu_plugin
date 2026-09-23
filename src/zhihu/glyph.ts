/** Same reference and render size as decode_zhihu.py */
export const RENDER_SIZE = 128;
export const REF_FONT_URL =
  "https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf";
export const REF_FONT_JSDELIVR =
  "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf";

export function ncc(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const len = a.length;
  let mean1 = 0;
  let mean2 = 0;
  for (let i = 0; i < len; i++) {
    mean1 += a[i];
    mean2 += b[i];
  }
  mean1 /= len;
  mean2 /= len;
  let dot = 0;
  let n1 = 0;
  let n2 = 0;
  for (let i = 0; i < len; i++) {
    const d1 = a[i] - mean1;
    const d2 = b[i] - mean2;
    dot += d1 * d2;
    n1 += d1 * d1;
    n2 += d2 * d2;
  }
  if (n1 === 0 || n2 === 0) return 0;
  return dot / Math.sqrt(n1 * n2);
}

/** Same as the in-browser mapper: compare the red channel of RGBA bitmaps. */
export function nccRgba(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let mean1 = 0;
  let mean2 = 0;
  const pixels = n / 4;
  for (let i = 0; i < n; i += 4) {
    mean1 += a[i];
    mean2 += b[i];
  }
  mean1 /= pixels;
  mean2 /= pixels;
  let dot = 0;
  let n1 = 0;
  let n2 = 0;
  for (let i = 0; i < n; i += 4) {
    const d1 = a[i] - mean1;
    const d2 = b[i] - mean2;
    dot += d1 * d2;
    n1 += d1 * d1;
    n2 += d2 * d2;
  }
  if (n1 === 0 || n2 === 0) return 0;
  return dot / Math.sqrt(n1 * n2);
}

/** Maximize assignment via Hungarian on -similarity (same as scipy linear_sum_assignment(-sim)). */
export function hungarianAssign(sim: number[][]): number[] {
  const cost = sim.map((row) => row.map((x) => -x));
  const n = cost.length;
  const u = Array(n + 1).fill(0);
  const v = Array(n + 1).fill(0);
  const p = Array(n + 1).fill(0);
  const way = Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(n + 1).fill(Infinity);
    const used = Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0] as number;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const assignment = Array(n).fill(0);
  for (let j = 1; j <= n; j++) assignment[p[j] - 1] = j - 1;
  return assignment;
}

export function mappingFromAssignment(chars: string[], assign: number[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (let i = 0; i < chars.length; i++) {
    const src = chars[i];
    const tgt = chars[assign[i]];
    if (src !== tgt) mapping[src] = tgt;
  }
  return mapping;
}
