import { type ActionContext, errorIdentifier, responseFailed } from "runline";
import * as t from "typebox";
import { stringEnum } from "./schemas.js";

/**
 * Shared helpers for plugins that talk to the Shift cloud API: one base
 * URL, the common TypeBox schema builders, and the Shift error envelope.
 * Every request carrying a Shift API key signs through the declared
 * credential in shiftCredentials.ts.
 */

export type Ctx = ActionContext;

export const STRICT_OBJECT = { additionalProperties: false } as const;
export const STRICT_UPDATE_OBJECT = {
  additionalProperties: false,
  minProperties: 2,
} as const;

export function idSchema(description: string) {
  return t.String({ minLength: 1, pattern: "\\S", description });
}

export function cursorSchema(description = "Next-page cursor") {
  return t.String({ minLength: 1, maxLength: 512, description });
}

export function timestampSchema(description: string) {
  return t.String({
    format: "date-time",
    pattern: "Z$",
    description,
  });
}

export function enumDescription(
  name: string,
  values: readonly string[],
): string {
  return `${name}: ${values.join(" | ")}`;
}

/** One of `values`, described by listing them. */
export function enumSchema<const T extends readonly string[]>(
  name: string,
  values: T,
) {
  return stringEnum(values, { description: enumDescription(name, values) });
}

export const SHIFT_API_URL = "https://cloud.shift-labs.ai";

export function baseUrl(): string {
  return `${SHIFT_API_URL}/`;
}

/**
 * A failed response, read as a Shift error envelope when it is one: the
 * service's `code` (else its `type`) and the offending `param`.
 */
export function shiftError(plugin: string, response: Response) {
  return responseFailed(plugin, response, (body) => {
    const error =
      body && typeof body === "object"
        ? (body as { error?: unknown }).error
        : undefined;
    if (!error || typeof error !== "object") return { code: error };
    const shaped = error as Record<string, unknown>;
    return {
      code: errorIdentifier(shaped.code) ?? shaped.type,
      param: shaped.param,
    };
  });
}
