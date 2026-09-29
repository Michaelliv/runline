import type { ActionContext } from "runline";
import * as t from "typebox";
import { errorIdentifier, failureMessage } from "./credentials.js";

export { pathSegment } from "./credentials.js";

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

export function enumSchema(name: string, values: readonly string[]) {
  return t.Union(
    values.map((value) => t.Literal(value)) as [
      ReturnType<typeof t.Literal>,
      ReturnType<typeof t.Literal>,
    ],
    { description: enumDescription(name, values) },
  );
}

export const SHIFT_API_URL = "https://cloud.shift-labs.ai";

export function baseUrl(): string {
  return `${SHIFT_API_URL}/`;
}

/**
 * A failed response, read as a Shift error envelope when it is one: the
 * service's `code` (else its `type`) and the offending `param`.
 */
export async function shiftError(
  plugin: string,
  response: Response,
): Promise<Error> {
  let code: string | undefined;
  let param: string | undefined;
  try {
    const error = ((await response.json()) as { error?: unknown }).error;
    if (typeof error === "string") code = errorIdentifier(error);
    else if (error && typeof error === "object") {
      const shaped = error as Record<string, unknown>;
      code = errorIdentifier(shaped.code) ?? errorIdentifier(shaped.type);
      param = errorIdentifier(shaped.param);
    }
  } catch {
    // Not an error envelope: the status alone.
  }
  return new Error(failureMessage(plugin, response.status, { code, param }));
}
