/**
 * One connection shared by the plugins of an OAuth grant. A delegated
 * token is the grant's — its client and token endpoint — so every plugin
 * of the grant uses the one cached access token instead of refreshing
 * over the others; a rotated refresh token lands in the one shared field.
 * Methods without a grant (app-only, service accounts) keep tokens per
 * plugin, since their scopes decide what the token can do.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import * as t from "typebox";
import { credentialBroker } from "../../../runline-plugins/_shared/credentialAdapter.js";
import { grantSchema } from "../../../runline-plugins/_shared/credentials.js";
import { googleCredential } from "../../../runline-plugins/_shared/googleAuth.js";
import { microsoftCredential } from "../../../runline-plugins/_shared/microsoftAuth.js";
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
import { CredentialRegistry } from "../credentials/registry.js";
import type {
  CredentialDeclaration,
  CredentialType,
} from "../credentials/types.js";
import { createPluginAPI, type PluginFunction } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";
import { stubFetch } from "./helpers/plugin.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const MICROSOFT_TOKEN =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MAIL = ["https://graph.microsoft.com/Mail.Read"];
const CALENDAR = ["https://graph.microsoft.com/Calendars.Read"];

/** One stored config, read and renewed by every plugin's context. */
function sharedConnection(config: Record<string, unknown>) {
  let stored = structuredClone(config);
  const context = (plugin: string): ActionContext => ({
    connection: {
      name: "account",
      plugin,
      get config() {
        return stored;
      },
    },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection(change) {
      const patch =
        typeof change === "function"
          ? await change(structuredClone(stored))
          : change;
      if (patch) stored = { ...stored, ...patch };
    },
  });
  return { context, stored: () => stored };
}

/**
 * Token requests answer `access-<n>` (and `refresh-<n>` when `rotate`);
 * API requests answer 200. Both are recorded.
 */
function provider(tokenUrl: string, rotate = false) {
  const tokens: URLSearchParams[] = [];
  const calls: Array<{ url: string; authorization: string | null }> = [];
  stubFetch(async (url, init) => {
    if (String(url) === tokenUrl) {
      tokens.push(new URLSearchParams(String(init?.body)));
      const n = tokens.length;
      return Response.json({
        access_token: `access-${n}`,
        expires_in: 3600,
        token_type: "Bearer",
        ...(rotate ? { refresh_token: `refresh-${n + 1}` } : {}),
      });
    }
    calls.push({
      url: String(url),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return Response.json({});
  });
  return { tokens, calls };
}

function send(
  context: ActionContext,
  declaration: CredentialDeclaration,
  target: string,
  path: string,
) {
  return credentialBroker(context, declaration).request({ target, path });
}

const google = {
  clientId: "client",
  clientSecret: "secret",
  refreshToken: "refresh-1",
};
const microsoft = {
  authMethod: "delegated",
  clientId: "client",
  clientSecret: "secret",
  refreshToken: "refresh-1",
};

describe("plugins of one grant share a connection's token", () => {
  it("a second Google plugin uses the first's token without a refresh", async () => {
    const account = sharedConnection(google);
    const { tokens, calls } = provider(GOOGLE_TOKEN);
    const mail = googleCredential("gmail", []);
    const calendar = googleCredential("googleCalendar", []);

    await send(account.context("gmail"), mail, "gmail", "profile");
    await send(
      account.context("googleCalendar"),
      calendar,
      "calendar",
      "users/me/calendarList",
    );
    await send(account.context("gmail"), mail, "gmail", "profile");

    assert.equal(tokens.length, 1);
    assert.deepEqual(
      calls.map((call) => call.authorization),
      ["Bearer access-1", "Bearer access-1", "Bearer access-1"],
    );
    assert.equal(account.stored().accessToken, "access-1");
    assert.equal(account.stored().refreshToken, "refresh-1");
  });

  it("Microsoft plugins share the token, and a rotated refresh token lands in the one field", async () => {
    const account = sharedConnection(microsoft);
    const { tokens, calls } = provider(MICROSOFT_TOKEN, true);
    const mail = microsoftCredential("microsoftMail", MAIL);
    const calendar = microsoftCredential("microsoftCalendar", CALENDAR);

    await send(account.context("microsoftMail"), mail, "graph", "me/messages");
    await send(
      account.context("microsoftCalendar"),
      calendar,
      "graph",
      "me/events",
    );
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].get("refresh_token"), "refresh-1");
    assert.equal(account.stored().refreshToken, "refresh-2");

    // Expired: whichever plugin renews spends the rotated refresh token
    // and asks for its own scopes, which Graph answers with the grant's.
    const expired = sharedConnection({
      ...account.stored(),
      accessTokenExpiresAt: Date.now() - 1000,
    });
    await send(
      expired.context("microsoftCalendar"),
      calendar,
      "graph",
      "me/events",
    );
    assert.equal(tokens.length, 2);
    assert.equal(tokens[1].get("refresh_token"), "refresh-2");
    assert.match(String(tokens[1].get("scope")), /Calendars\.Read/);
    await send(expired.context("microsoftMail"), mail, "graph", "me/messages");
    assert.equal(tokens.length, 2);
    assert.equal(calls.at(-1)?.authorization, "Bearer access-2");
    assert.equal(expired.stored().refreshToken, "refresh-3");
  });

  it("a token stored under another binding is refreshed once, then shared", async () => {
    const account = sharedConnection({
      ...google,
      accessToken: "stale",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      authTokenBinding: "a-binding-from-before",
    });
    const { tokens, calls } = provider(GOOGLE_TOKEN);
    const mail = googleCredential("gmail", []);
    const drive = googleCredential("googleDrive", []);

    await send(account.context("gmail"), mail, "gmail", "profile");
    await send(account.context("googleDrive"), drive, "drive", "files");

    assert.equal(tokens.length, 1);
    assert.deepEqual(
      calls.map((call) => call.authorization),
      ["Bearer access-1", "Bearer access-1"],
    );
  });

  it("a token issued for another client or tenant is never reused", async () => {
    const account = sharedConnection(google);
    const { tokens } = provider(GOOGLE_TOKEN);
    const mail = googleCredential("gmail", []);
    await send(account.context("gmail"), mail, "gmail", "profile");
    const otherClient = sharedConnection({
      ...account.stored(),
      clientId: "another-client",
    });
    await send(otherClient.context("gmail"), mail, "gmail", "profile");
    assert.equal(tokens.length, 2);

    const graph = sharedConnection(microsoft);
    const microsoftTokens = provider(MICROSOFT_TOKEN, true).tokens;
    const calendar = microsoftCredential("microsoftCalendar", CALENDAR);
    await send(
      graph.context("microsoftCalendar"),
      calendar,
      "graph",
      "me/events",
    );
    const otherTenant = sharedConnection({
      ...graph.stored(),
      tenantId: "contoso.example",
    });
    const tenantTokens = provider(
      "https://login.microsoftonline.com/contoso.example/oauth2/v2.0/token",
    ).tokens;
    await send(
      otherTenant.context("microsoftCalendar"),
      calendar,
      "graph",
      "me/events",
    );
    assert.equal(microsoftTokens.length, 1);
    assert.equal(tenantTokens.length, 1);
  });

  it("app-only tokens stay per plugin: their scopes are the plugin's", async () => {
    const account = sharedConnection({
      authMethod: "appOnly",
      tenantId: "contoso.example",
      clientId: "client",
      clientSecret: "secret",
      userUpn: "dana@contoso.example",
    });
    const { tokens } = provider(
      "https://login.microsoftonline.com/contoso.example/oauth2/v2.0/token",
    );
    await send(
      account.context("microsoftMail"),
      microsoftCredential("microsoftMail", MAIL),
      "graph",
      "users/dana%40contoso.example/messages",
    );
    await send(
      account.context("microsoftCalendar"),
      microsoftCredential("microsoftCalendar", CALENDAR),
      "graph",
      "users/dana%40contoso.example/events",
    );
    assert.equal(tokens.length, 2);
  });
});

describe("a grant is declared", () => {
  const plugins: Array<[string, PluginFunction, string]> = [
    ["gmail", gmail, "google"],
    ["googleAppsScript", googleAppsScript, "google"],
    ["googleCalendar", googleCalendar, "google"],
    ["googleContacts", googleContacts, "google"],
    ["googleDocs", googleDocs, "google"],
    ["googleDrive", googleDrive, "google"],
    ["googleSheets", googleSheets, "google"],
    ["googleSlides", googleSlides, "google"],
    ["googleTasks", googleTasks, "google"],
    ["microsoftCalendar", microsoftCalendar, "microsoft"],
    ["microsoftFiles", microsoftFiles, "microsoft"],
    ["microsoftMail", microsoftMail, "microsoft"],
  ];

  it("by every Google and Microsoft plugin, on its consent and on its delegated credential alike", () => {
    for (const [name, register, grant] of plugins) {
      const { api, resolve } = createPluginAPI(name);
      register(api);
      const plugin = resolve();
      assert.equal(plugin.oauth?.grant, grant, name);
      const selection = plugin.credential?.({
        authMethod: "delegated",
        clientId: "client",
      });
      const auth = selection?.type.methods.delegated.authentication;
      assert.equal(auth?.kind === "oauth2" && auth.grant, grant, name);
    }
  });

  it("with setup steps that enable each API the plugin calls", () => {
    const { api, resolve } = createPluginAPI("googleDrive");
    googleDrive(api);
    const help = resolve().oauth?.setupHelp?.join("\n") ?? "";
    for (const service of ["drive.googleapis.com", "docs.googleapis.com"])
      assert.match(help, new RegExp(`apis/library/${service}`));
    assert.match(help, /GOOGLE_DRIVE_CLIENT_ID/);
  });

  it("only as an identifier, and only on refresh renewal", () => {
    const type = (
      renewal: "refresh" | "clientCredentials",
      grant: string,
    ): CredentialType => ({
      id: "example",
      methods: {
        delegated: {
          schema: t.Object(
            { grant: grantSchema },
            { additionalProperties: false },
          ),
          authentication: {
            kind: "oauth2",
            field: "grant",
            renewal,
            grant,
            definition: {
              id: "example",
              provider: "example",
              refresh: {
                url: "https://auth.example/token",
                clientAuthentication: "client_secret_post",
              },
              clientCredentials: {
                url: "https://auth.example/token",
                clientAuthentication: "client_secret_post",
              },
            },
          },
          targets: {
            api: { baseUrl: "https://api.example/", methods: ["GET"] },
          },
        },
      },
    });
    new CredentialRegistry().register(type("refresh", "example"));
    for (const refused of [
      type("clientCredentials", "example"),
      type("refresh", "not a grant"),
    ])
      assert.throws(() => new CredentialRegistry().register(refused), {
        code: "invalid_definition",
      });
  });
});
