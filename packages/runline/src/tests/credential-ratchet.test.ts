/**
 * Every bundled plugin that carries a credential signs through its declared
 * credential. Each plugin directory is in exactly one of two places:
 *   - it declares its credential (`rl.setCredential`) and has a fixture in
 *     credential-fixtures/, exercised by credential-plugins.test.ts, or a
 *     dedicated suite;
 *   - NO_CREDENTIAL, with the reason it holds no secret at all.
 *
 * A new plugin that carries a credential declares it; there is no list to
 * wait on. NO_CREDENTIAL is written out rather than computed, because a
 * computed list would compare itself against itself.
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
  it("places every plugin in exactly one of: declaring, no credential", () => {
    const unplaced: string[] = [];
    const doubled: string[] = [];
    for (const plugin of plugins()) {
      const declaring = declares(plugin);
      const listed = NO_CREDENTIAL.has(plugin);
      if (!declaring && !listed) unplaced.push(plugin);
      if (declaring && listed) doubled.push(plugin);
    }
    assert.deepEqual(
      unplaced,
      [],
      "declare these plugins' credentials (rl.setCredential), or list them in NO_CREDENTIAL with the reason they hold no secret",
    );
    assert.deepEqual(
      doubled,
      [],
      "these plugins declare a credential; delete their lines from NO_CREDENTIAL",
    );
  });

  it("lists only plugins that exist", () => {
    const all = new Set(plugins());
    const gone = [...NO_CREDENTIAL.keys(), ...DEDICATED_SUITES].filter(
      (plugin) => !all.has(plugin),
    );
    assert.deepEqual(gone, []);
  });

  it("gives every listed plugin a reason", () => {
    for (const [plugin, reason] of NO_CREDENTIAL)
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
});
