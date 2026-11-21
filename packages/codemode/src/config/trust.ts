import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CONFIG_DIR_NAMES, userConfigDir } from "./loader.js";

/**
 * Project trust: whether a project's `.codemode` folder may contribute code,
 * meaning its plugin files, its plugins.json and its packages. A person
 * grants it per project; the decisions live in `<userDir>/trust.json`, so
 * the CLI and every host reading the same user folder agree.
 */

function trustFile(userDir: string): string {
  return join(userDir, "trust.json");
}

/**
 * A folder's one name: symlinks resolved, so a project reached through a
 * linked path is the project that was trusted. A folder that does not exist
 * keeps its absolute path.
 */
function canonical(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/** The project `.codemode` folders trusted in `userDir`. */
export function trustedProjects(userDir: string = userConfigDir()): string[] {
  try {
    const data = JSON.parse(readFileSync(trustFile(userDir), "utf8"));
    return Array.isArray(data?.trusted)
      ? data.trusted.filter((p: unknown) => typeof p === "string")
      : [];
  } catch {
    return [];
  }
}

export function isProjectTrusted(
  projectRoot: string,
  userDir: string = userConfigDir(),
): boolean {
  const trusted = trustedProjects(userDir);
  return names(canonical(projectRoot)).some((name) => trusted.includes(name));
}

/**
 * The paths a project folder is recorded under: its own, and for a
 * `.codemode` folder the `.runline` beside it, which is the same project
 * under its runline name.
 */
function names(root: string): string[] {
  return basename(root) === CONFIG_DIR_NAMES[0]
    ? [root, join(dirname(root), CONFIG_DIR_NAMES[1])]
    : [root];
}

/** Record or withdraw trust in a project's `.codemode` folder. */
export function setProjectTrusted(
  projectRoot: string,
  trusted: boolean,
  userDir: string = userConfigDir(),
): void {
  const root = canonical(projectRoot);
  const own = names(root);
  const others = trustedProjects(userDir).filter((p) => !own.includes(p));
  mkdirSync(userDir, { recursive: true });
  writeFileSync(
    trustFile(userDir),
    `${JSON.stringify({ trusted: (trusted ? [...others, root] : others).sort() }, null, 2)}\n`,
  );
}
