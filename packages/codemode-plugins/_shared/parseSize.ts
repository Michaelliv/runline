/**
 * Parse a `WxH` string into a { width, height } pair.
 *
 * Used by image-gen plugins (replicate, together, …) that take a
 * single `size` input but talk to APIs which want explicit
 * dimensions. Throws with the caller's plugin name in the message
 * so error output points back at the right tool.
 *
 *   parseSize("1024x1024", "replicate")  // { width: 1024, height: 1024 }
 *   parseSize(undefined, "replicate")    // defaults to 1024x1024
 *   parseSize("1024", "replicate")       // throws
 */
export function parseSize(
  size: string | undefined,
  pluginName: string,
  defaults: { width: number; height: number } = { width: 1024, height: 1024 },
): { width: number; height: number } {
  if (!size) return { ...defaults };
  const parts = size.split("x").map((s) => Number(s.trim()));
  if (
    parts.length !== 2 ||
    !Number.isFinite(parts[0]) ||
    !Number.isFinite(parts[1])
  ) {
    throw new Error(`${pluginName}: invalid size "${size}", expected WxH`);
  }
  if (parts[0] <= 0 || parts[1] <= 0) {
    throw new Error(`${pluginName}: size dimensions must be positive`);
  }
  return { width: parts[0], height: parts[1] };
}
