/**
 * A failed action call tells the connection it acted through
 * (`ConnectionHandle.failed`), so the host that resolved that connection
 * can judge whether the failure is the credential's own (SHFT-2619). The
 * handle already holds whose connection it is, so the host needs no other
 * record of the call.
 *
 * Contract under test:
 *   - fires once for a call whose execute() rejects, with the thrown value
 *     (an Error in place of a nullish throw), the same value onAction sees
 *   - is told only on the handle the failing call resolved
 *   - after any update the call made
 *   - never for a success, an unknown action or failed input validation
 *   - a handle without `failed`, or one that throws or rejects, changes
 *     nothing about the call's outcome
 */

import { describe, expect, test } from "bun:test";
import * as t from "typebox";
import { MemoryConnectionProvider } from "../connections/memory.js";
import type {
  ConnectionHandle,
  ConnectionProvider,
} from "../connections/types.js";
import type { ActionInvocation } from "../index.js";
import { Runline } from "../index.js";
import type { PluginDef } from "../plugin/types.js";

const demo: PluginDef = {
  name: "demo",
  version: "0.0.0",
  actions: [
    { name: "ok", execute: async () => "ok" },
    {
      name: "boom",
      execute: async () => {
        throw new Error("HTTP 401");
      },
    },
    {
      name: "boomUndefined",
      execute: async () => {
        throw undefined;
      },
    },
    {
      name: "renewThenBoom",
      execute: async (_input, ctx) => {
        await ctx.updateConnection({ token: "renewed" });
        throw new Error("still refused");
      },
    },
    {
      name: "typed",
      inputSchema: t.Object({ n: t.Number() }),
      execute: async () => "typed-ok",
    },
  ],
} as unknown as PluginDef;

/** A provider whose every handle records what it is told, in order. */
function recording(failed?: (error: unknown) => void | Promise<void>) {
  const events: string[] = [];
  const errors: unknown[] = [];
  let resolved = 0;
  const memory = new MemoryConnectionProvider([
    { name: "demo", plugin: "demo", config: {} },
  ]);
  const provider: ConnectionProvider = {
    async resolve(request) {
      const call = ++resolved;
      const inner = await memory.resolve(request);
      const handle: ConnectionHandle = {
        read: () => inner.read(),
        async update(change) {
          events.push(`update ${call}`);
          return inner.update(change);
        },
        async failed(error) {
          events.push(`failed ${call}`);
          errors.push(error);
          await failed?.(error);
        },
      };
      return handle;
    },
  };
  return { provider, events, errors };
}

function runline(
  provider: ConnectionProvider,
  onAction?: (info: ActionInvocation) => void,
) {
  return Runline.create({
    plugins: [demo],
    connectionProvider: provider,
    timeoutMs: 4000,
    ...(onAction ? { onAction } : {}),
  });
}

/** `failed` is not awaited by the call; let it land before asserting. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ConnectionHandle.failed", () => {
  test("tells the failing call's own handle, once, with the error onAction sees", async () => {
    const r = recording();
    const seen: ActionInvocation[] = [];
    const rl = runline(r.provider, (info) => seen.push(info));
    try {
      const out = await rl.execute(
        "await demo.ok({}); try { await demo.boom({}); } catch {} return await demo.ok({});",
      );
      expect(out.error).toBeUndefined();
      await settled();
    } finally {
      rl.dispose();
    }
    expect(r.events).toEqual(["failed 2"]);
    expect(r.errors[0]).toBeInstanceOf(Error);
    expect(String(r.errors[0])).toContain("HTTP 401");
    expect(seen[1]?.error).toBe(r.errors[0]);
  });

  test("gives an Error for a nullish throw", async () => {
    const r = recording();
    const rl = runline(r.provider);
    try {
      await rl.execute("return await demo.boomUndefined({});");
      await settled();
    } finally {
      rl.dispose();
    }
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toBeInstanceOf(Error);
  });

  test("comes after the updates the failing call made", async () => {
    const r = recording();
    const rl = runline(r.provider);
    try {
      await rl.execute("return await demo.renewThenBoom({});");
      await settled();
    } finally {
      rl.dispose();
    }
    expect(r.events).toEqual(["update 1", "failed 1"]);
  });

  test("is never told of a success, an unknown action or invalid input", async () => {
    const r = recording();
    const rl = runline(r.provider);
    try {
      await rl.execute("return await demo.ok({});");
      await rl.execute("return await demo.nope({});");
      await rl.execute('return await demo.typed({ n: "not-a-number" });');
      await settled();
    } finally {
      rl.dispose();
    }
    expect(r.events).toEqual([]);
  });

  test("a handle that throws, rejects or has no failed leaves the call's error as it was", async () => {
    for (const failed of [
      () => {
        throw new Error("host bug");
      },
      () => Promise.reject(new Error("host bug")),
    ]) {
      const r = recording(failed);
      const rl = runline(r.provider);
      try {
        const out = await rl.execute("return await demo.boom({});");
        expect(out.error).toContain("HTTP 401");
        expect(out.error).not.toContain("host bug");
      } finally {
        rl.dispose();
      }
    }
    const plain = Runline.create({
      plugins: [demo],
      connections: [{ name: "demo", plugin: "demo", config: {} }],
      timeoutMs: 4000,
    });
    try {
      expect(
        (await plain.execute("return await demo.boom({});")).error,
      ).toContain("HTTP 401");
    } finally {
      plain.dispose();
    }
  });
});
