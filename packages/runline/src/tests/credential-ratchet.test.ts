/**
 * Every bundled plugin that carries a credential signs through its declared
 * credential, or is on a written-out list saying why not yet.
 *
 * Each plugin directory is in exactly one of three places:
 *   - it declares its credential (`rl.setCredential`) and has a fixture in
 *     credential-fixtures/, exercised by credential-plugins.test.ts;
 *   - UNDECLARED_BACKLOG, with the specific reason it cannot be declared
 *     with today's authentication kinds;
 *   - NO_CREDENTIAL, with the reason it holds no secret at all.
 *
 * Like plugin-authed-fetch.test.ts, this is a ratchet: the backlog may
 * shrink and must never grow, a migrated plugin must leave it, and a new
 * plugin cannot join it. The lists are written out rather than computed,
 * because a computed list would compare itself against itself.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PLUGINS = join(here, "..", "..", "..", "runline-plugins");
const FIXTURES = join(here, "credential-fixtures");

/** Plugins that hold no secret, and why. */
const NO_CREDENTIAL = new Map<string, string>([
  ["docker", "local docker CLI via syncExec; no network, no secret"],
  ["hackernews", "public Algolia and Firebase APIs; empty connection schema"],
  [
    "node",
    "local fs/process utilities; its fetch action sends caller-supplied headers, no connection secret",
  ],
  ["openThesaurus", "public API; empty connection schema"],
  ["postbin", "public API; empty connection schema"],
  ["quickchart", "builds a public chart URL; makes no request"],
]);

/** Plugins that carry a credential but do not declare it yet, and why. */
const UNDECLARED_BACKLOG = new Map<string, string>([
  [
    "facebookGraph",
    "agent-selected host: hostUrl is a per-call action input, not config",
  ],
  ["gett", "login: phone OTP login and a rotating, device-bound refresh grant"],
  ["ghost", "signature: a JWT is minted per request from the admin key"],
  [
    "graphql",
    "generic client: arbitrary endpoint and caller-composed auth header",
  ],
  [
    "nextcloud",
    "WebDAV methods (PROPFIND, MKCOL, COPY, MOVE) the transport does not carry",
  ],
  ["odoo", "login: the password rides in every JSON-RPC argument list"],
  [
    "salesforce",
    "dynamic host: the API origin comes from the token response's instance_url",
  ],
  [
    "steel",
    "WebSocket: the key rides in a wss:// CDP URL the transport cannot carry",
  ],
  [
    "strapi",
    "login: password mode mints a JWT; one plugin cannot sign two ways",
  ],
  ["unleashedSoftware", "signature: HMAC-SHA256 of each query string"],
  ["wolt", "login: hCaptcha login and a rotating, device-bound refresh grant"],
]);

/**
 * Declaring plugins covered by their own dedicated suites
 * (credential-broker, credential-declaration, plaud-plugin) rather than a
 * fixture. May shrink, never grow.
 */
const DEDICATED_SUITES = new Set([
  "gmail",
  "googleAppsScript",
  "googleCalendar",
  "googleContacts",
  "googleDocs",
  "googleDrive",
  "googleSheets",
  "googleSlides",
  "googleTasks",
  "microsoftCalendar",
  "microsoftFiles",
  "microsoftMail",
  "plaud",
]);

function plugins(): string[] {
  return readdirSync(PLUGINS)
    .filter(
      (entry) =>
        !["_shared", "dist", "node_modules", "icons"].includes(entry) &&
        statSync(join(PLUGINS, entry)).isDirectory(),
    )
    .sort();
}

/** `rl.setCredential(` anywhere in the plugin's own sources. */
function declares(plugin: string): boolean {
  const src = join(PLUGINS, plugin, "src");
  return readdirSync(src)
    .filter((name) => name.endsWith(".ts"))
    .some((name) =>
      /\bsetCredential\s*\(/.test(readFileSync(join(src, name), "utf-8")),
    );
}

function fixtures(): string[] {
  return readdirSync(FIXTURES)
    .filter((name) => name.endsWith(".ts") && name !== "fixture.ts")
    .map((name) => name.slice(0, -3))
    .sort();
}

describe("every credential-bearing plugin declares its credential or says why not", () => {
  it("places every plugin in exactly one of: declaring, backlog, no credential", () => {
    const unplaced: string[] = [];
    const doubled: string[] = [];
    for (const plugin of plugins()) {
      const places = [
        declares(plugin),
        UNDECLARED_BACKLOG.has(plugin),
        NO_CREDENTIAL.has(plugin),
      ].filter(Boolean).length;
      if (places === 0) unplaced.push(plugin);
      if (places > 1) doubled.push(plugin);
    }
    assert.deepEqual(
      unplaced,
      [],
      "declare these plugins' credentials (rl.setCredential); a new plugin cannot join the backlog",
    );
    assert.deepEqual(
      doubled,
      [],
      "these plugins declare their credential; delete their lines from UNDECLARED_BACKLOG",
    );
  });

  it("lists only plugins that exist", () => {
    const all = new Set(plugins());
    const gone = [
      ...UNDECLARED_BACKLOG.keys(),
      ...NO_CREDENTIAL.keys(),
      ...DEDICATED_SUITES,
    ].filter((plugin) => !all.has(plugin));
    assert.deepEqual(gone, []);
  });

  it("gives every listed plugin a reason", () => {
    for (const [plugin, reason] of [...UNDECLARED_BACKLOG, ...NO_CREDENTIAL])
      assert.ok(reason.trim().length > 10, `${plugin} needs a specific reason`);
  });

  it("has a fixture for every declaring plugin, and no fixture for anything else", () => {
    const declaring = plugins().filter(declares);
    const covered = new Set([...fixtures(), ...DEDICATED_SUITES]);
    assert.deepEqual(
      declaring.filter((plugin) => !covered.has(plugin)),
      [],
      "add credential-fixtures/<plugin>.ts for these declaring plugins",
    );
    const declared = new Set(declaring);
    assert.deepEqual(
      [...covered].filter((plugin) => !declared.has(plugin)),
      [],
      "these fixtures or suites name plugins that declare no credential",
    );
  });

  it("still has a backlog, so a broken detector cannot look like finished work", () => {
    assert.ok(
      UNDECLARED_BACKLOG.size > 0,
      "an empty backlog means every plugin is migrated: delete this guard with the last entry",
    );
  });
});
