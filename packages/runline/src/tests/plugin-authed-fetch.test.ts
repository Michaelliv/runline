import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PLUGINS = join(here, "..", "..", "..", "runline-plugins");

/**
 * Every `fetch(` in a plugin is accounted for. A request carrying a
 * credential signs through the plugin's declared credential, whose transport
 * pins the destination and refuses redirects; a bare fetch never carries one.
 * So a file may call fetch only if it is on one of two written-out lists:
 *
 *   - CREDENTIAL_FREE_FETCH: requests that carry no credential by design
 *     (signed URLs, public CDNs, public APIs), each with its reason;
 *   - UNBROKERED_FETCH: plugins still on the credential backlog
 *     (credential-ratchet.test.ts) that sign their own requests. Each leaves
 *     this list when it declares its credential.
 *
 * The lists are written out rather than computed, because a computed list
 * would compare itself against itself. UNBROKERED_FETCH may shrink and must
 * never grow; neither list may hold a file that no longer calls fetch.
 */

/** Files whose fetch calls carry no credential, and why. */
const CREDENTIAL_FREE_FETCH = new Map<string, string>([
  ["_shared/authedFetch.ts", "the redirect-refusing helper itself"],
  [
    "_shared/shiftUpload.ts",
    "PUTs file bytes to a signed grant URL; the grant is the authority",
  ],
  ["airtop/src/index.ts", "file.upload downloads a caller-supplied public URL"],
  [
    "fal/src/shared.ts",
    "downloads generated media from fal's public CDN, re-validating each redirect hop",
  ],
  ["hackernews/src/index.ts", "public API; no connection secret"],
  [
    "node/src/index.ts",
    "its fetch action sends caller-supplied requests; no connection secret",
  ],
  ["openThesaurus/src/index.ts", "public API; no connection secret"],
  ["postbin/src/index.ts", "public API; no connection secret"],
  [
    "replicate/src/index.ts",
    "downloads prediction outputs from signed CDN URLs",
  ],
  [
    "shiftObjects/src/objects.ts",
    "downloads object bytes from a signed grant URL",
  ],
  [
    "shiftTranscription/src/transcription.ts",
    "downloads the transcript from a signed URL",
  ],
]);

/** Credential-backlog files that sign their own requests with bare fetch. */
const UNBROKERED_FETCH = new Set([
  "coingecko/src/index.ts",
  "convertkit/src/index.ts",
  "customerIo/src/index.ts",
  "elasticsearch/src/index.ts",
  "facebookGraph/src/index.ts",
  "ghost/src/index.ts",
  "gitlab/src/index.ts",
  "gotify/src/index.ts",
  "graphql/src/index.ts",
  "mailjet/src/index.ts",
  "mandrill/src/index.ts",
  "mocean/src/index.ts",
  "nextcloud/src/index.ts",
  "npm/src/index.ts",
  "odoo/src/index.ts",
  "paddle/src/index.ts",
  "plivo/src/index.ts",
  "posthog/src/index.ts",
  "pushover/src/index.ts",
  "reddit/src/index.ts",
  "salesforce/src/shared.ts",
  "sendy/src/index.ts",
  "signl4/src/index.ts",
  "steel/src/shared.ts",
  "storyblok/src/index.ts",
  "strapi/src/index.ts",
  "supabase/src/index.ts",
  "telegram/src/index.ts",
  "travisci/src/index.ts",
  "twilio/src/index.ts",
  "unleashedSoftware/src/index.ts",
  "uptimerobot/src/index.ts",
  "vero/src/index.ts",
  "vonage/src/index.ts",
]);

function pluginSources(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(PLUGINS)) {
    if (entry === "dist" || entry === "node_modules" || entry === "icons")
      continue;
    const dir = join(PLUGINS, entry);
    if (!statSync(dir).isDirectory()) continue;
    const roots = entry === "_shared" ? [dir] : [join(dir, "src")];
    for (const root of roots) {
      let names: string[];
      try {
        names = readdirSync(root);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith(".ts")) continue;
        const full = join(root, name);
        if (!statSync(full).isFile()) continue;
        out.push(
          entry === "_shared" ? `_shared/${name}` : `${entry}/src/${name}`,
        );
      }
    }
  }
  return out.sort();
}

/** `fetch(` as a call, not `options.fetch`, `authedFetch(` or a `fetch:` property. */
const CALLS_FETCH = /(?<![.\w$])fetch\s*\(/;
const IMPORTS_AUTHED_FETCH = /from\s+["'][^"']*authedFetch\.js["']/;

function source(rel: string): string {
  return readFileSync(join(PLUGINS, rel), "utf-8");
}

function filesCallingFetch(): string[] {
  return pluginSources().filter((rel) => CALLS_FETCH.test(source(rel)));
}

/** Plugins whose sources call `rl.setCredential`. */
function declaringPlugins(): Set<string> {
  return new Set(
    pluginSources()
      .filter((rel) => !rel.startsWith("_shared/"))
      .filter((rel) => /\bsetCredential\s*\(/.test(source(rel)))
      .map((rel) => rel.split("/")[0]),
  );
}

describe("every plugin fetch is accounted for", () => {
  it("has a helper that pins the redirect and rejects a redirected response", async () => {
    const { authedFetch } = await import(
      "../../../runline-plugins/_shared/authedFetch.js"
    );
    const original = globalThis.fetch;
    try {
      let seen: RequestInit | undefined;
      globalThis.fetch = (async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        seen = init;
        return new Response("{}", { status: 200 });
      }) as typeof fetch;
      await authedFetch("https://example.test/x", {
        headers: { Authorization: "secret" },
      });
      assert.equal(seen?.redirect, "error");

      // Belt to that brace: a fetch that ignores the option must not slip past.
      globalThis.fetch = (async () => {
        const redirected = new Response("{}", { status: 200 });
        Object.defineProperty(redirected, "redirected", { value: true });
        return redirected;
      }) as typeof fetch;
      await assert.rejects(
        authedFetch("https://example.test/x"),
        /followed a redirect/,
      );

      // A 3xx handed back rather than followed is refused on its own terms.
      globalThis.fetch = (async () =>
        new Response(null, { status: 302 })) as typeof fetch;
      await assert.rejects(
        authedFetch("https://example.test/x"),
        /Refusing a redirect .*HTTP 302/,
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  it("accounts for every fetch call on exactly one list", () => {
    const unlisted = filesCallingFetch().filter(
      (rel) => !CREDENTIAL_FREE_FETCH.has(rel) && !UNBROKERED_FETCH.has(rel),
    );
    assert.deepEqual(
      unlisted,
      [],
      "a credential signs through the plugin's declared credential (credentialRequest); " +
        "a fetch that carries none belongs on CREDENTIAL_FREE_FETCH with its reason",
    );
    const both = [...UNBROKERED_FETCH].filter((rel) =>
      CREDENTIAL_FREE_FETCH.has(rel),
    );
    assert.deepEqual(both, []);
  });

  it("lists only files that still call fetch", () => {
    // Without this the lists rot: a brokered file keeps its line, the gate
    // still passes, and the backlog stops describing the work that is left.
    const calling = new Set(filesCallingFetch());
    const stale = [...CREDENTIAL_FREE_FETCH.keys(), ...UNBROKERED_FETCH].filter(
      (rel) => !calling.has(rel),
    );
    assert.deepEqual(stale, [], "delete these files' lines");
  });

  it("keeps unbrokered fetches to plugins that declare no credential", () => {
    const declaring = declaringPlugins();
    assert.deepEqual(
      [...UNBROKERED_FETCH].filter((rel) => declaring.has(rel.split("/")[0])),
      [],
      "a plugin that declares its credential signs through it, not through fetch",
    );
  });

  it("never gives a brokered plugin a second signing path", () => {
    const declaring = declaringPlugins();
    const importing = pluginSources().filter(
      (rel) =>
        declaring.has(rel.split("/")[0]) &&
        IMPORTS_AUTHED_FETCH.test(source(rel)),
    );
    assert.deepEqual(importing, []);
  });

  it("still has a backlog, so a broken detector cannot look like finished work", () => {
    assert.ok(
      UNBROKERED_FETCH.size > 0,
      "an empty backlog means every plugin is brokered: delete this guard with the last entry",
    );
  });
});
