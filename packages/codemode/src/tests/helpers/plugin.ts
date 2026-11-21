import assert from "node:assert/strict";
import type { TSchema } from "typebox";
import { isTypedInputSchema } from "../../plugin/schema.js";
import type {
  ActionContext,
  ActionDef,
  PluginDef,
} from "../../plugin/types.js";

/**
 * A registered action as the engine runs it: `execute` always answers a
 * promise, so a synchronous throw rejects like an asynchronous one and
 * `assert.rejects` takes the call as it is.
 */
export type RegisteredAction = Omit<ActionDef, "execute"> & {
  execute(input: unknown, ctx: ActionContext): Promise<unknown>;
};

export function getAction(plugin: PluginDef, name: string): RegisteredAction {
  const action = plugin.actions.find((a) => a.name === name);
  assert.ok(action, `expected ${plugin.name}.${name} to be registered`);
  return {
    ...action,
    execute: async (input, ctx) => action.execute(input, ctx),
  };
}

/** A TypeBox input schema with the JSON Schema keywords tests read. */
export type SchemaKeywords = TSchema & {
  type?: unknown;
  properties?: Record<string, { description?: string }>;
  required?: string[];
  additionalProperties?: unknown;
};

export function typedSchema(plugin: PluginDef, name: string): SchemaKeywords {
  const { inputSchema } = getAction(plugin, name);
  assert.ok(
    isTypedInputSchema(inputSchema),
    `expected ${plugin.name}.${name} to use TypeBox`,
  );
  return inputSchema as SchemaKeywords;
}

/**
 * Replace the global fetch for a test. Bun types `fetch` with a
 * `preconnect` member no stub has, so the call signature is what a stub
 * answers to; tests restore the original themselves.
 */
export function stubFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): void {
  globalThis.fetch = handler as typeof fetch;
}

/**
 * A server's answer to a request for `content` with this `Range` header:
 * 206 with its Content-Range, 416 past the end, and the whole content
 * when there is no range.
 */
export function rangeResponse(
  content: Uint8Array,
  range: string | null,
  headers: Record<string, string> = {},
): Response {
  const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
  if (!match) return new Response(Buffer.from(content), { headers });
  const start = Number(match[1]);
  if (start >= content.byteLength)
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${content.byteLength}` },
    });
  const end = Math.min(Number(match[2]), content.byteLength - 1);
  return new Response(Buffer.from(content.subarray(start, end + 1)), {
    status: 206,
    headers: {
      ...headers,
      "content-range": `bytes ${start}-${end}/${content.byteLength}`,
    },
  });
}
