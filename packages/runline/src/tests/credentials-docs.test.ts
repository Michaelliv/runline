/**
 * The credentials guide (docs/credentials.md) shows its recipes as code a
 * plugin author copies. Each recipe's declaration block carries a
 * `<!-- check: {config} -->` marker; this runs every marked block as
 * written, against runline's own source, and holds each declaration it
 * makes to what the guide says of it: runline's validation accepts it,
 * and the local signer sends a signed request beneath its target.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CredentialRegistry } from "../credentials/registry.js";
import type { CredentialDeclaration } from "../credentials/types.js";
import * as runline from "../index.js";
import type { ActionContext } from "../plugin/types.js";

const GUIDE = readFileSync(
  resolve(import.meta.dirname, "../../../../docs/credentials.md"),
  "utf8",
);
const INDEX = resolve(import.meta.dirname, "../index.ts");
const TYPEBOX = fileURLToPath(import.meta.resolve("typebox"));

/** Every marked block: the config it is checked with, its code, its line. */
const blocks = [
  ...GUIDE.matchAll(
    /<!-- check: (\{.*\}) -->\n```typescript\n([\s\S]*?)\n```/g,
  ),
].map((match) => ({
  config: JSON.parse(match[1]) as Record<string, unknown>,
  code: match[2],
  line: GUIDE.slice(0, match.index).split("\n").length + 1,
}));

/** The declaration factories, wrapped to record what a block declares. */
const FACTORIES = ["staticCredential", "awsCredential"];

/**
 * A block as a module: its own imports from runline replaced by every
 * runline export (a block may use a helper it does not import, as the
 * guide's fragments do), typebox resolved from here, and what it declares
 * exported: each factory call's declaration, and a `credential` it names.
 */
function moduleOf(code: string): string {
  const exports = Object.keys(runline).filter(
    (name) => !FACTORIES.includes(name),
  );
  return [
    `import * as __runline from ${JSON.stringify(INDEX)};`,
    `const { ${exports.join(", ")} } = __runline;`,
    "const __declared = [];",
    ...FACTORIES.map(
      (name) =>
        `const ${name} = (spec) => { const d = __runline.${name}(spec); __declared.push(d); return d; };`,
    ),
    code
      .replace(/^import (?:type )?\{[^}]*\} from "runline";\n/gm, "")
      .replace(/from "typebox"/g, `from ${JSON.stringify(TYPEBOX)}`),
    'export const declared = typeof credential === "function" && !__declared.includes(credential) ? [...__declared, credential] : __declared;',
  ].join("\n");
}

interface Sent {
  url: string;
  headers: Record<string, string>;
}

/** A provider that issues any token, logs anyone in, and answers 200. */
function provider(sent: Sent[]): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    sent.push({
      url: href,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    if (href.endsWith("/oauth/token"))
      return Response.json({
        access_token: "issued",
        expires_in: 3600,
        token_type: "Bearer",
      });
    if (href.includes("/login"))
      return new Response("ok", {
        headers: { "set-cookie": "sessionid=s1; Path=/" },
      });
    return Response.json({ ok: true });
  }) as typeof fetch;
}

function contextFor(config: Record<string, unknown>): ActionContext {
  const connection = { name: "docs", plugin: "docs", config: { ...config } };
  return {
    connection,
    log: { info() {}, warn() {}, error() {} },
    async updateConnection(change) {
      const patch =
        typeof change === "function" ? await change(connection.config) : change;
      Object.assign(connection.config, patch ?? {});
    },
  };
}

/** Whether a request carries a credential: a signing header, or a config value in its URL. */
function signed(call: Sent, config: Record<string, unknown>): boolean {
  return (
    ["authorization", "cookie", "x-amz-date"].some(
      (name) => call.headers[name],
    ) ||
    Object.values(config).some(
      (value) => typeof value === "string" && call.url.includes(value),
    )
  );
}

/** One declaration, held to what the guide says of it. */
async function signsBeneathItsTarget(
  declaration: CredentialDeclaration,
  config: Record<string, unknown>,
): Promise<void> {
  const selection = declaration(config);
  new CredentialRegistry().register(selection.type);
  const [name, target] = Object.entries(
    selection.type.methods[selection.method].targets,
  )[0];
  const verb = target.methods.includes("GET") ? "GET" : target.methods[0];
  const sent: Sent[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = provider(sent);
  try {
    const response = await runline.credentialRequest(
      contextFor(config),
      declaration,
      {
        target: name,
        path: "check",
        method: verb,
        ...(verb === "GET" ? {} : { json: {} }),
      },
    );
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = real;
  }
  const call = sent.at(-1);
  assert.ok(call, "nothing was sent");
  assert.ok(call.url.startsWith(target.baseUrl), call.url);
  if (selection.method !== "none")
    assert.ok(signed(call, config), `unsigned request to ${call.url}`);
}

describe("the credentials guide's recipes", () => {
  it("every recipe has a checked block", () => {
    const recipes = GUIDE.slice(
      GUIDE.indexOf("\n## Recipes\n"),
      GUIDE.indexOf("\n## Making requests\n"),
    )
      .split("\n### ")
      .slice(1);
    assert.ok(recipes.length > 0);
    for (const recipe of recipes)
      assert.ok(
        recipe.includes("<!-- check:"),
        `"${recipe.split("\n")[0]}" has no checked block`,
      );
  });

  for (const [index, block] of blocks.entries())
    it(`the block at line ${block.line} declares credentials that sign`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "runline-docs-"));
      try {
        const file = join(dir, `block-${index}.ts`);
        writeFileSync(file, moduleOf(block.code));
        const { declared } = (await import(pathToFileURL(file).href)) as {
          declared: CredentialDeclaration[];
        };
        assert.ok(declared.length > 0, "the block declares nothing");
        for (const declaration of declared)
          await signsBeneathItsTarget(declaration, block.config);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
});
