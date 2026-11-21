/**
 * A partial update in the shape Google's APIs take it: the fields given
 * as a camelCase JSON body, and the field mask that names them in
 * snake_case, as Google's REST references write mask paths. A dotted
 * path (`web_stream_data.default_uri`) names a nested field. Fields left
 * undefined are in neither.
 */
export function maskedFields(fields: Record<string, unknown>): {
  body: Record<string, unknown>;
  updateMask: string;
} {
  const given = Object.entries(fields).filter(
    ([, value]) => value !== undefined,
  );
  const body: Record<string, unknown> = {};
  for (const [path, value] of given) {
    const names = path.split(".").map(camel);
    let parent = body;
    for (const name of names.slice(0, -1)) {
      parent[name] ??= {};
      parent = parent[name] as Record<string, unknown>;
    }
    parent[names[names.length - 1]] = value;
  }
  return { body, updateMask: given.map(([path]) => path).join(",") };
}

function camel(field: string): string {
  return field.replace(/_([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}
