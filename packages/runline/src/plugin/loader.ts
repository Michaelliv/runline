import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { findConfigDir } from "../config/loader.js";
import type { LoadResult, PackageManager } from "../packages/manager.js";
import {
  HOST_MODULE_SPECIFIERS,
  pluginEntryPoint,
  readPackageManifest,
} from "../packages/manifest.js";
import type { PluginFunction } from "./api.js";
import { resolvePluginExport } from "./api.js";
import { registry } from "./registry.js";
import type { PluginDef } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Where a host module resolves: runline's own entry points beside this
 * file, everything else from runline's dependencies.
 */
function hostModulePath(specifier: string): string | undefined {
  if (specifier === "runline")
    return new URL("../index.js", import.meta.url).pathname;
  if (specifier.startsWith("runline/"))
    return new URL(
      `../${specifier.slice("runline/".length)}.js`,
      import.meta.url,
    ).pathname;
  try {
    return fileURLToPath(import.meta.resolve(specifier));
  } catch {
    return undefined;
  }
}

/**
 * Plugins import runline (and the TypeBox it validates with) from the
 * runline that loads them, never from a copy of their own: one credential
 * transport, one set of error classes, one schema library per process.
 */
const HOST_ALIASES: Record<string, string> = Object.fromEntries(
  HOST_MODULE_SPECIFIERS.flatMap((specifier) => {
    const path = hostModulePath(specifier);
    return path ? [[specifier, path]] : [];
  }),
);

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  interopDefault: true,
  tryNative: false,
  alias: HOST_ALIASES,
});

export async function loadPluginFromPath(
  path: string,
  options: {
    /** The name a plugin gets when it declares none. Default: its file name. */
    defaultName?: string;
  } = {},
): Promise<PluginDef> {
  let absPath = resolve(path);

  if (existsSync(absPath) && statSync(absPath).isDirectory()) {
    const found = pluginEntryPoint(absPath, readMain(absPath));
    if (!found) throw new Error(`No entry point found in ${absPath}`);
    absPath = found;
  }

  // Plugins may live outside the project/package tree. Load them
  // through Runline's module context so documented imports like
  // `from "runline"` work without requiring a node_modules folder next
  // to the plugin file.
  const mod = (await jiti.import(absPath)) as { default?: unknown } | unknown;
  const pluginId = absPath.replace(/.*\//, "").replace(/\.(ts|js)$/, "");
  const pluginExport =
    typeof mod === "object" && mod !== null && "default" in mod
      ? mod.default
      : mod;
  return resolvePluginExport(
    pluginExport as PluginDef | PluginFunction,
    options.defaultName ?? pluginId,
  );
}

/** A folder's `package.json`, or undefined (reported) when it is unreadable. */
function readPackageJson(dir: string): Record<string, unknown> | undefined {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  try {
    return JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch (err) {
    console.error(
      `[runline] Failed to parse ${pkgPath}:`,
      (err as Error).message,
    );
    return undefined;
  }
}

function readMain(dir: string): string | undefined {
  const main = readPackageJson(dir)?.main;
  return typeof main === "string" ? main : undefined;
}

function isPrivatePluginDirectory(entry: string): boolean {
  return entry.startsWith("_") || entry.startsWith(".");
}

/**
 * `npm/` and `git/` under a plugins folder hold what `runline plugin
 * install` wrote up to runline 0.44. plugins.json points into them; they
 * are not plugins themselves.
 */
function isLegacyInstallDirectory(fullPath: string, entry: string): boolean {
  if (entry === "npm") return existsSync(join(fullPath, "node_modules"));
  if (entry === "git")
    return !["index.ts", "index.js", "package.json", "src"].some((f) =>
      existsSync(join(fullPath, f)),
    );
  return false;
}

async function loadFromDirectory(
  dir: string,
  options: { skipLegacyInstallDirs?: boolean } = {},
): Promise<PluginDef[]> {
  const plugins: PluginDef[] = [];
  if (!existsSync(dir)) return plugins;

  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (
      stat.isFile() &&
      (entry.endsWith(".ts") || entry.endsWith(".js")) &&
      !entry.endsWith(".d.ts") &&
      !entry.endsWith(".test.ts")
    ) {
      try {
        plugins.push(await loadPluginFromPath(fullPath));
      } catch (err) {
        console.error(
          `[runline] Failed to load plugin from ${fullPath}:`,
          (err as Error).message,
        );
      }
    } else if (stat.isDirectory()) {
      if (isPrivatePluginDirectory(entry)) continue;
      if (
        options.skipLegacyInstallDirs &&
        isLegacyInstallDirectory(fullPath, entry)
      )
        continue;

      const pkg = readPackageJson(fullPath);
      let paths: string[];
      if (pkg?.runline !== undefined) {
        // A folder declaring runline.plugins is a package: the same manifest
        // rules as an installed one, so no path leaves the folder.
        try {
          paths = readPackageManifest(fullPath).pluginPaths;
        } catch (err) {
          console.error(
            `[runline] Failed to load plugins from ${fullPath}:`,
            (err as Error).message,
          );
          continue;
        }
      } else {
        const found = pluginEntryPoint(
          fullPath,
          typeof pkg?.main === "string" ? pkg.main : undefined,
        );
        if (!found) {
          console.error(
            `[runline] Failed to load plugin from ${fullPath}: No entry point found`,
          );
          continue;
        }
        paths = [found];
      }

      for (const path of paths) {
        try {
          plugins.push(await loadPluginFromPath(path));
        } catch (err) {
          console.error(
            `[runline] Failed to load plugin from ${path}:`,
            (err as Error).message,
          );
        }
      }
    }
  }

  return plugins;
}

export async function loadPluginsFromConfig(
  configDir: string,
): Promise<PluginDef[]> {
  const plugins: PluginDef[] = [];
  const pluginsFile = join(configDir, "plugins.json");
  if (!existsSync(pluginsFile)) return plugins;

  try {
    const data = JSON.parse(readFileSync(pluginsFile, "utf-8"));
    const entries = data.plugins ?? data;
    if (!Array.isArray(entries)) {
      throw new Error("Expected an array or { plugins: [...] }");
    }

    for (const entry of entries) {
      const p = typeof entry === "string" ? entry : entry?.path;
      if (typeof p !== "string" || p.length === 0) {
        console.error(
          `[runline] Invalid plugin entry in ${pluginsFile}: expected string path or { path }`,
        );
        continue;
      }
      const pluginPath = isAbsolute(p) ? p : join(configDir, p);
      try {
        plugins.push(await loadPluginFromPath(pluginPath));
      } catch (err) {
        console.error(
          `[runline] Failed to load plugin from ${pluginPath}:`,
          (err as Error).message,
        );
      }
    }
  } catch (err) {
    console.error(
      `[runline] Failed to parse ${pluginsFile}:`,
      (err as Error).message,
    );
  }
  return plugins;
}

export interface DiscoverOptions {
  /**
   * When supplied, only built-in plugins whose name is in this set
   * are loaded. Plugins discovered in the project dir, `plugins.json`,
   * or `~/.runline/plugins` are always loaded — users put them there
   * deliberately — but the 188 bundled builtins are gated so agents
   * don't see every possible action regardless of configuration.
   *
   * Omit to load every builtin (CLI default: `runline actions` etc.
   * surfaces the full catalog).
   */
  builtinAllowlist?: Set<string> | null;

  /**
   * Override the directory where bundled plugins live. Default is
   * `<loader>/../plugins`, which resolves to `dist/plugins/` at
   * runtime. Tests set this so they can exercise allowlist logic
   * without depending on the real bundled catalog.
   */
  builtinDir?: string;

  /**
   * Configured packages to load after the project and global plugin
   * folders and before the built-ins: a manager to load them, or the
   * result of its `load()` when the caller already has one. Their problems
   * are reported on stderr, like every other discovery failure here.
   */
  packages?: PackageManager | LoadResult;

  /** Package sources loaded for this discovery only, never recorded. */
  temporaryPackages?: string[];

  /** The user's runline folder. Default: `~/.runline`. */
  userDir?: string;
}

/** Default path to the bundled plugin directory. */
export function defaultBuiltinDir(): string {
  return join(__dirname, "..", "plugins");
}

/**
 * Discover and return all plugins from a config directory and global dir.
 * Does NOT mutate any global state.
 */
export async function discoverPlugins(
  configDir?: string | null,
  options: DiscoverOptions = {},
): Promise<PluginDef[]> {
  const loaded = new Set<string>();
  const result: PluginDef[] = [];

  function addIfNew(plugin: PluginDef, source: string) {
    if (loaded.has(plugin.name)) {
      console.error(
        `[runline] Skipping duplicate plugin "${plugin.name}" from ${source}: a plugin with that name is already loaded`,
      );
      return;
    }
    result.push(plugin);
    loaded.add(plugin.name);
  }

  if (configDir) {
    const projectPluginsDir = join(configDir, "plugins");
    const projectPlugins = await loadFromDirectory(projectPluginsDir, {
      skipLegacyInstallDirs: true,
    });
    for (const p of projectPlugins) addIfNew(p, projectPluginsDir);

    const configPlugins = await loadPluginsFromConfig(configDir);
    for (const p of configPlugins) addIfNew(p, join(configDir, "plugins.json"));
  }

  const globalDir = join(
    options.userDir ?? join(homedir(), ".runline"),
    "plugins",
  );
  const globalPlugins = await loadFromDirectory(globalDir, {
    skipLegacyInstallDirs: true,
  });
  for (const p of globalPlugins) addIfNew(p, globalDir);

  if (options.packages) {
    const { loaded: fromPackages, problems } =
      "load" in options.packages
        ? await options.packages.load({ temporary: options.temporaryPackages })
        : options.packages;
    for (const problem of problems)
      console.error(
        `[runline] ${problem.level === "warning" ? "Warning: " : ""}${problem.message}`,
      );
    for (const p of fromPackages) addIfNew(p.plugin, p.source);
  }

  const builtinDir = options.builtinDir ?? defaultBuiltinDir();
  const builtinPlugins = await loadFromDirectory(builtinDir);
  for (const p of builtinPlugins) {
    if (options.builtinAllowlist && !options.builtinAllowlist.has(p.name)) {
      continue;
    }
    addIfNew(p, builtinDir);
  }

  return result;
}

/**
 * Load all plugins and register them into the global registry.
 * Used by the CLI.
 */
export async function loadAllPlugins(
  options: DiscoverOptions = {},
): Promise<void> {
  const configDir = findConfigDir();
  const plugins = await discoverPlugins(configDir, options);
  for (const p of plugins) {
    registry.register(p);
  }
}
