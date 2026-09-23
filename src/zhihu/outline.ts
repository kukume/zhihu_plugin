import opentype from "opentype.js";
import { hungarianAssign, mappingFromAssignment, nccRgba, REF_FONT_JSDELIVR, REF_FONT_URL, RENDER_SIZE } from "./glyph";

export type GlyphMapResult = {
  mapping: Record<string, string>;
  meanBest: number;
  tofu: boolean;
  error?: string;
};

type Point = { x: number; y: number };

type OtCmd = {
  type: string;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
};

type OtPath = {
  commands: OtCmd[];
  getBoundingBox(): { x1: number; y1: number; x2: number; y2: number };
};

type OtGlyph = {
  index: number;
  getPath(x: number, y: number, fontSize: number): OtPath;
};

type OtFont = {
  charToGlyph(ch: string): OtGlyph;
};

let notoPromise: Promise<OtFont> | undefined;

function parseFont(bytes: ArrayBuffer): OtFont {
  return opentype.parse(bytes) as unknown as OtFont;
}

async function loadNoto(): Promise<OtFont> {
  if (!notoPromise) {
    notoPromise = (async () => {
      let last = "Noto fetch failed";
      for (const url of [REF_FONT_JSDELIVR, REF_FONT_URL]) {
        const res = await fetch(url);
        if (!res.ok) {
          last = `Noto fetch failed: ${res.status} ${url}`;
          continue;
        }
        return parseFont(await res.arrayBuffer());
      }
      throw new Error(last);
    })();
  }
  try {
    return await notoPromise;
  } catch (err) {
    notoPromise = undefined;
    throw err;
  }
}

function decodeBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function addPoint(points: Point[], p: Point): void {
  const last = points[points.length - 1];
  if (last && last.x === p.x && last.y === p.y) return;
  points.push(p);
}

function flattenQuad(p0: Point, p1: Point, p2: Point, out: Point[], depth = 0): void {
  const dx = p0.x + p2.x - 2 * p1.x;
  const dy = p0.y + p2.y - 2 * p1.y;
  if (depth >= 8 || dx * dx + dy * dy < 0.35) {
    addPoint(out, p2);
    return;
  }
  const p01 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const p12 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const mid = { x: (p01.x + p12.x) / 2, y: (p01.y + p12.y) / 2 };
  flattenQuad(p0, p01, mid, out, depth + 1);
  flattenQuad(mid, p12, p2, out, depth + 1);
}

function flattenCubic(p0: Point, p1: Point, p2: Point, p3: Point, out: Point[], depth = 0): void {
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const d1 = Math.abs((p1.x - p0.x) * dy - (p1.y - p0.y) * dx);
  const d2 = Math.abs((p2.x - p0.x) * dy - (p2.y - p0.y) * dx);
  if (depth >= 8 || d1 + d2 < 0.35 * (Math.abs(dx) + Math.abs(dy) + 1)) {
    addPoint(out, p3);
    return;
  }
  const p01 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const p12 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const p23 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
  const p012 = { x: (p01.x + p12.x) / 2, y: (p01.y + p12.y) / 2 };
  const p123 = { x: (p12.x + p23.x) / 2, y: (p12.y + p23.y) / 2 };
  const mid = { x: (p012.x + p123.x) / 2, y: (p012.y + p123.y) / 2 };
  flattenCubic(p0, p01, p012, mid, out, depth + 1);
  flattenCubic(mid, p123, p23, p3, out, depth + 1);
}

function contoursFromPath(path: OtPath, scale: number, dx: number, dy: number): Point[][] {
  const contours: Point[][] = [];
  let cur: Point[] = [];
  let start: Point = { x: 0, y: 0 };
  let last: Point = { x: 0, y: 0 };
  const map = (x: number, y: number): Point => ({ x: x * scale + dx, y: y * scale + dy });

  for (const cmd of path.commands) {
    switch (cmd.type) {
      case "M": {
        if (cur.length > 1) contours.push(cur);
        last = start = map(cmd.x ?? 0, cmd.y ?? 0);
        cur = [last];
        break;
      }
      case "L": {
        last = map(cmd.x ?? 0, cmd.y ?? 0);
        addPoint(cur, last);
        break;
      }
      case "Q": {
        const ctrl = map(cmd.x1 ?? 0, cmd.y1 ?? 0);
        const end = map(cmd.x ?? 0, cmd.y ?? 0);
        flattenQuad(last, ctrl, end, cur);
        last = end;
        break;
      }
      case "C": {
        const c1 = map(cmd.x1 ?? 0, cmd.y1 ?? 0);
        const c2 = map(cmd.x2 ?? 0, cmd.y2 ?? 0);
        const end = map(cmd.x ?? 0, cmd.y ?? 0);
        flattenCubic(last, c1, c2, end, cur);
        last = end;
        break;
      }
      case "Z": {
        addPoint(cur, start);
        if (cur.length > 1) contours.push(cur);
        cur = [];
        last = start;
        break;
      }
      default:
        break;
    }
  }
  if (cur.length > 1) contours.push(cur);
  return contours;
}

function whiteBitmap(size: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  data.fill(255);
  return data;
}

function fillContours(size: number, contours: Point[][]): Uint8ClampedArray {
  const data = whiteBitmap(size);
  for (let y = 0; y < size; y++) {
    const ys = y + 0.5;
    const hits: { x: number; w: number }[] = [];
    for (const contour of contours) {
      const n = contour.length;
      if (n < 2) continue;
      for (let i = 0; i < n; i++) {
        const a = contour[i];
        const b = contour[(i + 1) % n];
        if (a.y === b.y) continue;
        if ((a.y <= ys && b.y > ys) || (b.y <= ys && a.y > ys)) {
          const t = (ys - a.y) / (b.y - a.y);
          hits.push({ x: a.x + t * (b.x - a.x), w: a.y < b.y ? 1 : -1 });
        }
      }
    }
    if (!hits.length) continue;
    hits.sort((p, q) => p.x - q.x);
    let wind = 0;
    let prev = 0;
    for (const hit of hits) {
      if (wind !== 0) {
        const from = Math.max(0, Math.ceil(prev));
        const to = Math.min(size, Math.floor(hit.x));
        for (let x = from; x < to; x++) {
          const o = (y * size + x) * 4;
          data[o] = 0;
          data[o + 1] = 0;
          data[o + 2] = 0;
        }
      }
      wind += hit.w;
      prev = hit.x;
    }
  }
  return data;
}

function rasterizeGlyph(font: OtFont, ch: string): Uint8ClampedArray {
  const size = RENDER_SIZE;
  const glyph = font.charToGlyph(ch);
  if (!glyph?.index) return whiteBitmap(size);
  const path = glyph.getPath(0, 0, size);
  const box = path.getBoundingBox();
  const w = box.x2 - box.x1;
  const h = box.y2 - box.y1;
  if (!(w > 0 && h > 0) || !Number.isFinite(w + h)) return whiteBitmap(size);
  const scale = (size * 0.86) / Math.max(w, h);
  const dx = (size - w * scale) / 2 - box.x1 * scale;
  const dy = (size - h * scale) / 2 - box.y1 * scale;
  return fillContours(size, contoursFromPath(path, scale, dx, dy));
}

function ink(data: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] < 200) n++;
  return n;
}

export async function mapGlyphsByOutline(fontBase64: string, chars: string[]): Promise<GlyphMapResult> {
  if (!chars.length) return { mapping: {}, meanBest: 0, tofu: false };
  const obf = parseFont(decodeBase64(fontBase64));
  const ref = await loadNoto();
  const obfImgs = chars.map((ch) => rasterizeGlyph(obf, ch));
  const refImgs = chars.map((ch) => rasterizeGlyph(ref, ch));
  const inks = refImgs.map(ink);
  const inkMean = inks.reduce((a, b) => a + b, 0) / (inks.length || 1);
  const inkVar = inks.reduce((a, b) => a + (b - inkMean) * (b - inkMean), 0) / (inks.length || 1);
  if (inkMean < 30 || inkVar < 20) {
    return {
      mapping: {},
      meanBest: 0,
      tofu: true,
      error: "Reference CJK font did not render (tofu)",
    };
  }

  const n = chars.length;
  const sim = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) sim[i][j] = nccRgba(obfImgs[i], refImgs[j]);
  }
  const assign = hungarianAssign(sim);
  let bestSum = 0;
  for (let i = 0; i < n; i++) bestSum += sim[i][assign[i]];
  return {
    mapping: mappingFromAssignment(chars, assign),
    meanBest: bestSum / n,
    tofu: false,
  };
}
