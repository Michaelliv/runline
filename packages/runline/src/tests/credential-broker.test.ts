/**
 * The credential broker: a host that holds a plugin's credentials
 * outside the process running its actions (a server signing on behalf
 * of a sandboxed worker) supplies `credentialBroker`, and every
 * registry-backed plugin sends its authenticated requests through
 * `ctx.credentials` instead of signing them itself.
 *
 * Pinned here:
 *   - the engine hands each action of a plugin that declares its
 *     credential the broker the embedder built for exactly that call —
 *     plugin, action, and per-run context — and hands nothing when the
 *     embedder supplied none or the plugin declares no credential;
 *   - with a broker, a plugin needs no secret in its connection config
 *     and never touches the network itself: requests and probes alike
 *     go through the broker.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { googleProbe } from "../../../runline-plugins/_shared/googleAuth.js";
import { microsoftProbe } from "../../../runline-plugins/_shared/microsoftAuth.js";
import gmail from "../../../runline-plugins/gmail/src/index.js";
import googleAppsScript from "../../../runline-plugins/googleAppsScript/src/index.js";
import googleCalendar from "../../../runline-plugins/googleCalendar/src/index.js";
import googleContacts from "../../../runline-plugins/googleContacts/src/index.js";
import googleDocs from "../../../runline-plugins/googleDocs/src/index.js";
import googleDrive from "../../../runline-plugins/googleDrive/src/index.js";
import googleSheets from "../../../runline-plugins/googleSheets/src/index.js";
import googleSlides from "../../../runline-plugins/googleSlides/src/index.js";
import googleTasks from "../../../runline-plugins/googleTasks/src/index.js";
import microsoftCalendar from "../../../runline-plugins/microsoftCalendar/src/index.js";
import microsoftFiles from "../../../runline-plugins/microsoftFiles/src/index.js";
import microsoftMail from "../../../runline-plugins/microsoftMail/src/index.js";
import plaud from "../../../runline-plugins/plaud/src/index.js";
import type {
  AuthenticatedRequest,
  CredentialBroker,
  CredentialBrokerCall,
} from "../credentials/transport.js";
import type { CredentialDeclaration } from "../credentials/types.js";
import { createPluginAPI, type PluginFunction } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";
import { Runline } from "../sdk.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** A broker that answers every request with `body` and records it. */
function recordingBroker(body: unknown = {}) {
  const requests: AuthenticatedRequest[] = [];
  let probes = 0;
  const broker: CredentialBroker = {
    async request(input) {
      requests.push(input);
      return Response.json(body);
    },
    async probe() {
      probes++;
      return { outcome: "accepted", status: 200 };
    },
  };
  return { broker, requests, probes: () => probes };
}

/** A context whose connection holds no secret at all. */
function brokeredContext(
  plugin: string,
  credentials: CredentialBroker,
): ActionContext {
  return {
    connection: { name: plugin, plugin, config: {} },
    credentials,
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {
      throw new Error("a brokered plugin persists nothing itself");
    },
  };
}

function action(plugin: PluginFunction, name: string) {
  const { api, resolve } = createPluginAPI("test");
  plugin(api);
  const found = resolve().actions.find((a) => a.name === name);
  assert.ok(found, name);
  return found;
}

function refuseNetwork() {
  globalThis.fetch = (async () => {
    throw new Error("a brokered plugin must not reach the network itself");
  }) as unknown as typeof fetch;
}

describe("the engine hands actions the embedder's broker", () => {
  const declared: CredentialDeclaration = () => {
    throw new Error("only a signer reads the declaration");
  };
  const plugin =
    (name: string, declaration?: CredentialDeclaration): PluginFunction =>
    (rl) => {
      rl.setName(name);
      if (declaration) rl.setCredential(declaration);
      rl.registerAction("ask", {
        async execute(_input, ctx) {
          if (!ctx.credentials) return { brokered: false };
          const res = await ctx.credentials.request({
            target: "api",
            path: "items",
          });
          return { brokered: true, body: await res.json() };
        },
      });
    };
  const probe = plugin("probe", declared);

  it("built for exactly this call: plugin, action, and per-run context", async () => {
    const calls: CredentialBrokerCall[] = [];
    const { broker, requests } = recordingBroker({ ok: true });
    const runline = Runline.create({
      plugins: [probe],
      credentialBroker: (call) => {
        calls.push(call);
        return broker;
      },
    });
    try {
      const out = await runline.execute("return await probe.ask({})", {
        context: { caller: "dana" },
      });
      assert.equal(out.error, undefined);
      assert.deepEqual(out.result, { brokered: true, body: { ok: true } });
      assert.deepEqual(calls, [
        { plugin: "probe", action: "ask", context: { caller: "dana" } },
      ]);
      assert.deepEqual(requests, [{ target: "api", path: "items" }]);
    } finally {
      runline.dispose();
    }
  });

  it("absent when the embedder supplies none", async () => {
    const runline = Runline.create({ plugins: [probe] });
    try {
      const out = await runline.execute("return await probe.ask({})");
      assert.deepEqual(out.result, { brokered: false });
    } finally {
      runline.dispose();
    }
  });

  it("absent for a plugin that declares no credential, whatever the embedder supplies", async () => {
    const calls: CredentialBrokerCall[] = [];
    const runline = Runline.create({
      plugins: [plugin("custom")],
      credentialBroker: (call) => {
        calls.push(call);
        return recordingBroker().broker;
      },
    });
    try {
      const out = await runline.execute("return await custom.ask({})");
      assert.deepEqual(out.result, { brokered: false });
      assert.deepEqual(calls, []);
    } finally {
      runline.dispose();
    }
  });
});

describe("registry-backed plugins send through the broker", () => {
  const specs: Array<
    [PluginFunction, string, string, object, unknown, string]
  > = [
    [gmail, "gmail", "profile.get", {}, {}, "gmail"],
    [
      googleAppsScript,
      "googleAppsScript",
      "project.getContent",
      { scriptId: "id" },
      { files: [] },
      "script",
    ],
    [googleCalendar, "googleCalendar", "calendar.list", {}, {}, "calendar"],
    [
      googleContacts,
      "googleContacts",
      "contact.get",
      { contactId: "id" },
      {},
      "people",
    ],
    [googleDocs, "googleDocs", "document.get", { document: "id" }, {}, "docs"],
    [googleDrive, "googleDrive", "file.get", { fileId: "id" }, {}, "drive"],
    [
      googleSheets,
      "googleSheets",
      "spreadsheet.get",
      { spreadsheetId: "id" },
      {},
      "sheets",
    ],
    [
      googleSlides,
      "googleSlides",
      "presentation.get",
      { presentation: "id" },
      {},
      "slides",
    ],
    [
      googleTasks,
      "googleTasks",
      "taskList.get",
      { taskListId: "id" },
      {},
      "tasks",
    ],
    [microsoftMail, "microsoftMail", "mail.list", {}, { value: [] }, "graph"],
    [
      microsoftCalendar,
      "microsoftCalendar",
      "calendar.list",
      { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" },
      { value: [] },
      "graph",
    ],
    [
      microsoftFiles,
      "microsoftFiles",
      "files.list",
      {},
      { value: [] },
      "graph",
    ],
    [plaud, "plaud", "user.get", {}, { id: "u" }, "api"],
  ];

  for (const [plugin, name, actionName, input, body, target] of specs) {
    it(`${name}.${actionName} signs nothing and reaches nothing itself`, async () => {
      refuseNetwork();
      const { broker, requests } = recordingBroker(body);
      await action(plugin, actionName).execute(
        input,
        brokeredContext(name, broker),
      );
      assert.ok(requests.length > 0, `${name} made no brokered request`);
      for (const request of requests) {
        assert.equal(request.target, target);
        assert.equal(
          new Headers(request.headers).has("authorization"),
          false,
          `${name} must not attach its own credential`,
        );
      }
    });
  }

  it("probes go through the broker too", async () => {
    refuseNetwork();
    const google = recordingBroker();
    assert.equal(
      (await googleProbe(brokeredContext("gmail", google.broker), "gmail", []))
        .outcome,
      "accepted",
    );
    assert.equal(google.probes(), 1);
    const microsoft = recordingBroker();
    assert.equal(
      (
        await microsoftProbe(
          brokeredContext("microsoftMail", microsoft.broker),
          "microsoftMail",
          [],
        )
      ).outcome,
      "accepted",
    );
    assert.equal(microsoft.probes(), 1);
  });
});
