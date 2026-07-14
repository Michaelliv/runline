import * as t from "typebox";

/** Common TypeBox primitives for Google plugin action inputs. */
export const NonEmptyString = t.String({ minLength: 1, pattern: "\\S" });
export const Id = t.String({ minLength: 1 });
export const PositiveInteger = t.Integer({ minimum: 1 });
export const NonNegativeInteger = t.Integer({ minimum: 0 });
export const StringArray = t.Array(t.String());
export const NonEmptyStringArray = t.Array(NonEmptyString, { minItems: 1 });
export const StringOrNumber = t.Union([t.String(), t.Number()]);
export const StringOrStringArray = t.Union([t.String(), t.Array(t.String())]);

/** JSON-compatible data whose provider-specific shape is intentionally open. */
export const RawGoogleObject = t.Object({}, { additionalProperties: true });
export const JsonValue = t.Unknown({
  description: "Any JSON-compatible value",
});
export const JsonArray = t.Array(JsonValue);
export const StringMap = t.Record(t.String(), t.String());

export const GoogleTimestamp = t.Union([NonEmptyString, t.Number()], {
  description: "ISO datetime, epoch milliseconds, or epoch seconds",
});

export function stringEnum<const T extends readonly string[]>(values: T) {
  return t.Union(values.map((value) => t.Literal(value)));
}
