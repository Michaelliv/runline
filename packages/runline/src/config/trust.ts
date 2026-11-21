import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { userConfigDir } from "./loader.js";

/**
 * Project trust: whether a project's `.runline` folder may contribute code,
 * meaning its plugin files, its plugins.json and its packages. A person
 * grants it per project; the decisions live in `<userDir>/trust.json`, so
 * the CLI and every host reading the same user folder agree.
 */

function trustFile(userDir: string): string {
  return join(userDir, "trust.json");
}

/** The project `.runline` folders trusted in `userDir`. */
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
  return trustedProjects(userDir).includes(resolve(projectRoot));
}

/** Record or withdraw trust in a project's `.runline` folder. */
export function setProjectTrusted(
  projectRoot: string,
  trusted: boolean,
  userDir: string = userConfigDir(),
): void {
  const root = resolve(projectRoot);
  const others = trustedProjects(userDir).filter((p) => p !== root);
  mkdirSync(userDir, { recursive: true });
  writeFileSync(
    trustFile(userDir),
    `${JSON.stringify({ trusted: (trusted ? [...others, root] : others).sort() }, null, 2)}\n`,
  );
}
