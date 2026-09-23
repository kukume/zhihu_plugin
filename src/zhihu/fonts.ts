export type EmbeddedFont = {
  family: string;
  base64: string;
  format: string;
};

export function extractBase64Fonts(html: string): EmbeddedFont[] {
  const fonts: EmbeddedFont[] = [];
  const faceRe = /@font-face\s*\{([^}]+)\}/gi;
  let match: RegExpExecArray | null;
  while ((match = faceRe.exec(html))) {
    const block = match[1] ?? "";
    const family = block.match(/font-family\s*:\s*['"]?([^'";}]+)['"]?/i)?.[1]?.trim() ?? "unknown";
    const urlMatch = block.match(/url\("?(data:[^")]+)"?\)/i);
    if (!urlMatch) continue;
    const dataUrl = urlMatch[1];
    const dataMatch = dataUrl.match(/data:[^;]*(?:;[^;]*)*;\s*base64\s*,\s*(.+)/i);
    if (!dataMatch) continue;
    const format = block.match(/format\(['"]?([^'")]+)/i)?.[1] ?? "truetype";
    fonts.push({ family, base64: dataMatch[1].trim(), format });
  }
  return fonts;
}

export function parseCmapCodepoints(ttf: Uint8Array): number[] {
  const v = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  if (ttf.byteLength < 12) return [];
  const numTables = v.getUint16(4);
  let cmapOff = -1;
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    if (o + 16 > ttf.byteLength) break;
    const tag = String.fromCharCode(
      v.getUint8(o),
      v.getUint8(o + 1),
      v.getUint8(o + 2),
      v.getUint8(o + 3),
    );
    if (tag === "cmap") {
      cmapOff = v.getUint32(o + 8);
      break;
    }
  }
  if (cmapOff < 0 || cmapOff + 4 > ttf.byteLength) return [];

  const numSub = v.getUint16(cmapOff + 2);
  let best: number[] = [];
  for (let i = 0; i < numSub; i++) {
    const rec = cmapOff + 4 + i * 8;
    if (rec + 8 > ttf.byteLength) break;
    const subOff = cmapOff + v.getUint32(rec + 4);
    if (subOff + 2 > ttf.byteLength) continue;
    const format = v.getUint16(subOff);
    const cps =
      format === 4 ? parseFormat4(v, subOff) : format === 12 ? parseFormat12(v, subOff) : [];
    if (cps.length > best.length) best = cps;
  }
  return best;
}

function parseFormat4(v: DataView, off: number): number[] {
  if (off + 14 > v.byteLength) return [];
  const segCount = v.getUint16(off + 6) / 2;
  const endOff = off + 14;
  const startOff = endOff + 2 * segCount + 2;
  const deltaOff = startOff + 2 * segCount;
  const rangeOff = deltaOff + 2 * segCount;
  if (rangeOff + 2 * segCount > v.byteLength) return [];
  const cps: number[] = [];
  for (let i = 0; i < segCount; i++) {
    const start = v.getUint16(startOff + 2 * i);
    const end = v.getUint16(endOff + 2 * i);
    const delta = v.getInt16(deltaOff + 2 * i);
    const rangeOffset = v.getUint16(rangeOff + 2 * i);
    for (let c = start; c <= end; c++) {
      let glyph = 0;
      if (rangeOffset === 0) {
        glyph = (c + delta) & 0xffff;
      } else {
        const glyphPos = rangeOff + 2 * i + rangeOffset + (c - start) * 2;
        if (glyphPos + 2 <= v.byteLength) {
          const gid = v.getUint16(glyphPos);
          glyph = gid === 0 ? 0 : (gid + delta) & 0xffff;
        }
      }
      if (glyph !== 0 && c !== 0xffff) cps.push(c);
    }
  }
  return [...new Set(cps)];
}

function parseFormat12(v: DataView, off: number): number[] {
  if (off + 16 > v.byteLength) return [];
  const nGroups = v.getUint32(off + 12);
  const cps: number[] = [];
  for (let i = 0; i < nGroups; i++) {
    const g = off + 16 + i * 12;
    if (g + 12 > v.byteLength) break;
    const start = v.getUint32(g);
    const end = v.getUint32(g + 4);
    for (let c = start; c <= end && c <= start + 4096; c++) cps.push(c);
  }
  return [...new Set(cps)];
}

export function pickContentFont(fonts: EmbeddedFont[]): { font: EmbeddedFont; chars: string[] } | null {
  let best: { font: EmbeddedFont; chars: string[] } | null = null;
  for (const font of fonts) {
    let bytes: Uint8Array;
    try {
      const bin = atob(font.base64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      continue;
    }
    const family = font.family.toLowerCase();
    if (/(icon|awesome|number)/i.test(family)) continue;
    const cps = parseCmapCodepoints(bytes);
    const cjk = cps.filter((cp) => cp >= 0x4e00 && cp <= 0x9fff);
    if (cjk.length < 20) continue;
    const chars = [...cps]
      .sort((a, b) => a - b)
      .filter((cp) => cp > 0 && cp !== 0xffff)
      .map((cp) => String.fromCodePoint(cp));
    if (chars.length >= 30 && (!best || chars.length > best.chars.length)) {
      best = { font, chars };
    }
  }
  return best;
}

export function applyMapping(text: string, mapping: Record<string, string>): string {
  const singles: Record<string, string> = {};
  for (const [k, v] of Object.entries(mapping)) {
    if (k.length === 1 && v.length === 1) singles[k] = v;
  }
  let out = [...text].map((ch) => singles[ch] ?? ch).join("");
  for (const [k, v] of Object.entries(mapping)) {
    if (k.length > 1 || v.length > 1) out = out.split(k).join(v);
  }
  return out;
}

export function looksLikeChallenge(html: string, status: number): boolean {
  if (status === 403 || status === 401) return true;
  if (html.length < 2000 && html.includes("zh-zse-ck")) return true;
  if (html.includes("zse-ck/v") && html.length < 4000) return true;
  return false;
}

export function looksLikePaidHtml(html: string): boolean {
  if (html.length < 3000) return false;
  if (looksLikeChallenge(html, 200)) return false;
  return html.includes("@font-face") || html.includes("RichText") || html.includes("js-initialData");
}
