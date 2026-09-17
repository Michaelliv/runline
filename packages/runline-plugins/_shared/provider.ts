/**
 * Helpers for plugins that consume an undocumented provider JSON API over a
 * bearer token (gett, wolt): total readers for unshaped payloads, path-segment
 * safety, and a bounded body read.
 *
 * The readers are total by design. These payloads are deep and change without
 * notice, so a missing or wrongly-typed field yields the empty value for its
 * shape rather than throwing halfway through a response and losing the rest.
 */

export function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The first non-empty string among the candidates, else null. Numbers count. */
export function pick(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value !== "") return value;
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return null;
}

export function numOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export const num = (value: unknown, fallback: number): number =>
  numOrNull(value) ?? fallback;

/**
 * One path segment, escaped. Caller-supplied ids reach a URL carrying a bearer
 * token, so a segment that could climb out of its position is refused outright
 * rather than encoded and hoped about.
 */
export function seg(value: unknown, what: string, plugin: string): string {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "." || raw === ".." || /[/\\?#]/.test(raw)) {
    throw new Error(`${plugin}: invalid ${what}`);
  }
  return encodeURIComponent(raw);
}

/**
 * Read a response body with a ceiling, so a hostile or broken endpoint cannot
 * make the process hold an unbounded string.
 */
export async function readBounded(
  res: Response,
  maxBytes: number,
  onOversize: () => Error,
): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw onOversize();
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}
