/** Quote 15+ digit integers so snowflake IDs are not rounded by JSON.parse. */
export function parseZhihuJson(text: string): unknown {
  const quoted = quoteSnowflakeNumbers(text);
  try {
    return JSON.parse(quoted);
  } catch {
    return JSON.parse(text);
  }
}

/** Only rewrite numbers outside JSON strings. Content HTML often contains `[19-digit-id]`. */
export function quoteSnowflakeNumbers(text: string): string {
  let out = "";
  let inStr = false;
  let escape = false;
  for (let i = 0; i < text.length; ) {
    const ch = text[i] ?? "";
    if (inStr) {
      out += ch;
      if (escape) {
        escape = false;
        i++;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        i++;
        continue;
      }
      if (ch === '"') inStr = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const start = i;
      if (ch === "-") i++;
      const digitStart = i;
      while (i < text.length && text[i]! >= "0" && text[i]! <= "9") i++;
      const digits = text.slice(digitStart, i);
      const next = text[i] ?? "";
      if (digits.length >= 15 && next !== "." && next !== "e" && next !== "E") {
        out += `"${text.slice(start, i)}"`;
        continue;
      }
      out += text.slice(start, i);
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
