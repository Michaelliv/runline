import * as t from "typebox";

/** An object that takes its declared fields and no others. */
export const STRICT = { additionalProperties: false } as const;

/** A `STRICT` object of `properties`, under whatever rules `options` add. */
export const strictObject = <T extends t.TProperties>(
  properties: T,
  options: t.TObjectOptions = {},
) => t.Object(properties, { ...options, ...STRICT });

/**
 * At least one of `fields` must be given: "provide a change", "name a
 * recipient". Keyed off the field record itself, so the rule cannot drift
 * from the fields it governs.
 */
export function atLeastOne(fields: Record<string, t.TSchema>) {
  return { anyOf: Object.keys(fields).map((key) => ({ required: [key] })) };
}

/**
 * Exactly one of `fields` must be given: "a file or a URL, never both".
 * Keyed off the field record itself, as `atLeastOne` is.
 */
export function exactlyOne(fields: Record<string, t.TSchema>) {
  return { oneOf: Object.keys(fields).map((key) => ({ required: [key] })) };
}

/**
 * One of `values`, typed as their union: `t.Union` over a mapped array
 * widens each branch, which would make the input's static type `never`.
 */
export function stringEnum<const T extends readonly string[]>(
  values: T,
  options?: t.TSchemaOptions,
) {
  return t.Unsafe<T[number]>(
    t.Union(
      values.map((value) => t.Literal(value)),
      options,
    ),
  );
}
