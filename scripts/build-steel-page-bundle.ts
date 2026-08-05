#!/usr/bin/env bun
/**
 * Bundle the Steel page bridge into a single self-contained IIFE and
 * commit it as a TypeScript string constant.
 *
 * Why a committed artifact rather than a build step: `runline-plugins`
 * builds with `tsc --noCheck`, which transpiles but does not bundle, and
 * the page bridge must reach the browser as *one* expression for CDP
 * `Runtime.evaluate`. Generating here and committing the result keeps the
 * plugin build unchanged and keeps the plugin self-contained at runtime —
 * no host install, which is the failure mode that made `browser.run`
 * degrade silently in the first place.
 *
 * Run after touching anything under `steel/src/page/`:
 *   bun run build:steel-page-bundle
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pageDir = join(root, "packages/runline-plugins/steel/src/page");
const outFile = join(pageDir, "bundle.generated.ts");

const built = await Bun.build({
  entrypoints: [join(pageDir, "install.ts")],
  target: "browser",
  format: "iife",
  minify: { whitespace: true, syntax: true, identifiers: false },
});

if (!built.success) {
  console.error("Steel page bundle failed to build:");
  for (const log of built.logs) console.error(log);
  process.exit(1);
}

const [artifact] = built.outputs;
if (!artifact) throw new Error("Steel page bundle produced no output");
const code = await artifact.text();

const version = /PAGE_BRIDGE_VERSION = (\d+)/.exec(
  readFileSync(join(pageDir, "entry.ts"), "utf8"),
)?.[1];
if (!version)
  throw new Error("Could not read PAGE_BRIDGE_VERSION from entry.ts");

writeFileSync(
  outFile,
  `// GENERATED FILE — DO NOT EDIT.
// Built from steel/src/page/ by scripts/build-steel-page-bundle.ts.
// Regenerate with: bun run build:steel-page-bundle
//
// A self-contained IIFE evaluated inside the Steel session's page. It
// installs the snapshot bridge on the page's global and returns nothing;
// the driver calls into it afterwards via Runtime.evaluate.

/** Contract version the bundle installs; must match entry.ts. */
export const PAGE_BRIDGE_VERSION = ${version};

export const PAGE_BRIDGE_GLOBAL = "__steelPageBridge";

export const PAGE_BRIDGE_SOURCE = ${JSON.stringify(code)};
`,
  "utf8",
);

console.log(
  `Steel page bundle: ${(code.length / 1024).toFixed(1)} KB → ${outFile.replace(`${root}/`, "")}`,
);
