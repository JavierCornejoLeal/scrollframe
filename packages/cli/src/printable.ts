/**
 * Text that comes from the project (an import, a script or file name, a parse error) made safe to
 * print: without control, bidi or line-separator characters, which could repaint the plan the
 * person is confirming, and no longer than `max` characters.
 */
export function printable(text: string, max = 80): string {
  const clean = Array.from(text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ""));
  return clean.length > max ? `${clean.slice(0, max).join("")}…` : clean.join("");
}
