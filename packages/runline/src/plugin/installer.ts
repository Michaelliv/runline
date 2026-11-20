import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { findConfigDir } from "../config/loader.js";
import { parseSource } from "../packages/source.js";

/**
 * The installer before packages: entries in `plugins.json`, files under
 * `.runline/plugins/{npm,git}`. Kept so existing callers and installs keep
 * working; new code uses `PackageManager`, which records packages in
 * config.json and owns `.runline/packages/`.
 */

/** @deprecated Use `parseSource` and `PackageManager`. */
export interface PluginSource {
  type: "npm" | "git" | "local";
  name: string;
  ref?: string;
  url?: string;
  path?: string;
  subpath?: string;
}

/** @deprecated Use `ConfiguredPackage` from `PackageManager.list()`. */
export interface InstalledPlugin {
  source: string;
  path: string;
  name?: string;
}

const PLUGINS_FILE = "plugins.json";

/** @deprecated Use `parseSource`. */
export function parsePluginSource(source: string): PluginSource {
  if (source.startsWith("npm:")) {
    const rest = source.slice(4);
    let name: string;
    let ref: string | undefined;
    if (rest.startsWith("@")) {
      const lastAt = rest.lastIndexOf("@");
      if (lastAt > 0 && lastAt !== rest.indexOf("@")) {
        name = rest.slice(0, lastAt);
        ref = rest.slice(lastAt + 1);
      } else {
        name = rest;
      }
    } else {
      const atIdx = rest.indexOf("@");
      if (atIdx > 0) {
        name = rest.slice(0, atIdx);
        ref = rest.slice(atIdx + 1);
      } else {
        name = rest;
      }
    }
    return { type: "npm", name, ref };
  }

  if (
    source.startsWith("git:") ||
    source.startsWith("https://") ||
    source.startsWith("http://") ||
    source.startsWith("ssh://")
  ) {
    let raw = source;
    if (raw.startsWith("git:")) raw = raw.slice(4);

    let subpath: string | undefined;
    const hashIdx = raw.indexOf("#");
    if (hashIdx > 0) {
      subpath = raw.slice(hashIdx + 1);
      raw = raw.slice(0, hashIdx);
    }

    let ref: string | undefined;
    const atIdx = raw.lastIndexOf("@");
    if (atIdx > 0 && !raw.slice(atIdx).includes("/")) {
      ref = raw.slice(atIdx + 1);
      raw = raw.slice(0, atIdx);
    }

    let url = raw;
    if (
      !url.startsWith("http://") &&
      !url.startsWith("https://") &&
      !url.startsWith("ssh://")
    ) {
      url = `https://${url}`;
    }
    if (!url.endsWith(".git")) url += ".git";

    const name = subpath ? basename(subpath) : basename(url, ".git");
    return { type: "git", name, url, ref, subpath };
  }

  const absPath = resolve(source);
  const name = basename(absPath).replace(/\.(ts|js)$/, "");
  return { type: "local", name, path: absPath };
}

function getPluginsDir(global: boolean): string {
  if (global) {
    const dir = join(homedir(), ".runline", "plugins");
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  const configDir = findConfigDir();
  const dir = configDir
    ? join(configDir, "..", ".runline", "plugins")
    : join(process.cwd(), ".runline", "plugins");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function getPluginsJsonPath(global = false): string {
  if (global) return join(homedir(), ".runline", PLUGINS_FILE);
  const configDir = findConfigDir();
  return configDir
    ? join(configDir, PLUGINS_FILE)
    : join(process.cwd(), ".runline", PLUGINS_FILE);
}

function readPluginsJson(global = false): { plugins: InstalledPlugin[] } {
  const path = getPluginsJsonPath(global);
  if (!existsSync(path)) return { plugins: [] };
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writePluginsJson(
  data: { plugins: InstalledPlugin[] },
  global = false,
): void {
  const path = getPluginsJsonPath(global);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

/** @deprecated Use `PackageManager.install`. */
export async function installPlugin(
  source: string,
  options?: { global?: boolean },
): Promise<{ path: string; name: string }> {
  // Validates npm names and git refs, so nothing reaching npm or git starts with "-".
  parseSource(source);
  const parsed = parsePluginSource(source);
  const global = options?.global ?? false;
  const pluginsDir = getPluginsDir(global);

  let installPath: string;

  switch (parsed.type) {
    case "npm": {
      const npmDir = join(pluginsDir, "npm");
      mkdirSync(npmDir, { recursive: true });
      // Without a package.json here npm walks up and installs into whatever
      // project encloses the folder.
      if (!existsSync(join(npmDir, "package.json")))
        writeFileSync(join(npmDir, "package.json"), '{ "private": true }\n');
      const spec = parsed.ref ? `${parsed.name}@${parsed.ref}` : parsed.name;
      execFileSync(
        "npm",
        [
          "install",
          spec,
          "--legacy-peer-deps",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
        ],
        { cwd: npmDir, stdio: "pipe" },
      );
      installPath = join(npmDir, "node_modules", parsed.name);
      break;
    }
    case "git": {
      const gitUrl = parsed.url as string;
      const urlObj = new URL(gitUrl);
      const gitDir = join(
        pluginsDir,
        "git",
        urlObj.hostname,
        urlObj.pathname.replace(/\.git$/, ""),
      );
      if (existsSync(gitDir)) {
        if (parsed.ref) {
          execFileSync("git", ["fetch", "origin", "--", parsed.ref], {
            cwd: gitDir,
            stdio: "pipe",
          });
          execFileSync(
            "git",
            ["-c", "advice.detachedHead=false", "checkout", "FETCH_HEAD"],
            {
              cwd: gitDir,
              stdio: "pipe",
            },
          );
        } else {
          execFileSync("git", ["pull", "--ff-only"], {
            cwd: gitDir,
            stdio: "pipe",
          });
        }
      } else {
        mkdirSync(join(gitDir, ".."), { recursive: true });
        execFileSync("git", ["clone", "--", gitUrl, gitDir], { stdio: "pipe" });
        if (parsed.ref)
          execFileSync(
            "git",
            ["-c", "advice.detachedHead=false", "checkout", parsed.ref, "--"],
            {
              cwd: gitDir,
              stdio: "pipe",
            },
          );
      }
      if (existsSync(join(gitDir, "package.json"))) {
        execFileSync(
          "npm",
          [
            "install",
            "--omit=dev",
            "--legacy-peer-deps",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
          ],
          { cwd: gitDir, stdio: "pipe" },
        );
      }
      installPath = parsed.subpath ? join(gitDir, parsed.subpath) : gitDir;
      break;
    }
    case "local": {
      const localPath = parsed.path as string;
      if (!existsSync(localPath)) {
        throw new Error(`Path does not exist: ${localPath}`);
      }
      installPath = localPath;
      break;
    }
  }

  const data = readPluginsJson(global);
  const existing = data.plugins.findIndex((p) => p.source === source);
  const entry: InstalledPlugin = {
    source,
    path: installPath,
    name: parsed.name,
  };
  if (existing >= 0) {
    data.plugins[existing] = entry;
  } else {
    data.plugins.push(entry);
  }
  writePluginsJson(data, global);

  return { path: installPath, name: parsed.name };
}

/**
 * Remove an entry whose name or source is exactly `name`, from the project's
 * plugins.json and then the global one.
 * @deprecated Use `PackageManager.remove`.
 */
export function removePlugin(name: string): boolean {
  for (const global of [false, true]) {
    const data = readPluginsJson(global);
    const idx = data.plugins.findIndex(
      (p) => p.name === name || p.source === name,
    );
    if (idx < 0) continue;

    const plugin = data.plugins[idx];
    const parsed = parsePluginSource(plugin.source);

    if (parsed.type === "npm") {
      const npmDir = join(getPluginsDir(global), "npm");
      if (existsSync(join(npmDir, "node_modules", parsed.name)))
        execFileSync(
          "npm",
          [
            "uninstall",
            parsed.name,
            "--legacy-peer-deps",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
          ],
          { cwd: npmDir, stdio: "pipe" },
        );
    } else if (parsed.type === "git" && existsSync(plugin.path)) {
      rmSync(plugin.path, { recursive: true, force: true });
    }

    data.plugins.splice(idx, 1);
    writePluginsJson(data, global);
    return true;
  }
  return false;
}

/** @deprecated Use `PackageManager.list`. */
export function listInstalled(): Array<{
  name: string;
  type: string;
  source: string;
  path: string;
}> {
  const entries = [
    ...readPluginsJson(false).plugins,
    ...readPluginsJson(true).plugins,
  ];
  return entries.map((p) => {
    const parsed = parsePluginSource(p.source);
    return {
      name: p.name || parsed.name,
      type: parsed.type,
      source: p.source,
      path: p.path,
    };
  });
}
