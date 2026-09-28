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
 * So a file may call fetch only if it is on CREDENTIAL_FREE_FETCH: requests
 * that carry no credential by design (signed URLs, public CDNs, public
 * APIs), each with its reason. The list is written out rather than
 * computed, because a computed list would compare itself against itself,
 * and it may not hold a file that no longer calls fetch.
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

  it("accounts for every fetch call", () => {
    const unlisted = filesCallingFetch().filter(
      (rel) => !CREDENTIAL_FREE_FETCH.has(rel),
    );
    assert.deepEqual(
      unlisted,
      [],
      "a credential signs through the plugin's declared credential (credentialRequest); " +
        "a fetch that carries none belongs on CREDENTIAL_FREE_FETCH with its reason",
    );
  });

  it("lists only files that still call fetch", () => {
    // Without this the list rots: a file stops fetching, keeps its line,
    // and the gate still passes.
    const calling = new Set(filesCallingFetch());
    const stale = [...CREDENTIAL_FREE_FETCH.keys()].filter(
      (rel) => !calling.has(rel),
    );
    assert.deepEqual(stale, [], "delete these files' lines");
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
});
