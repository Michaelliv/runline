import type * as t from "typebox";

/**
 * At least one of `fields` must be given: "provide a change", "name a
 * recipient". Keyed off the field record itself, so the rule cannot drift
 * from the fields it governs.
 */
export function atLeastOne(fields: Record<string, t.TSchema>) {
  return { anyOf: Object.keys(fields).map((key) => ({ required: [key] })) };
}
