import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import {
  findConfigDir,
  loadConfigFrom,
  userConfigDir,
} from "../config/loader.js";
import { isProjectTrusted } from "../config/trust.js";
import type { PackageManager } from "../packages/manager.js";
import {
  HOST_MODULE_SPECIFIERS,
  LEGACY_HOST_MODULE_SPECIFIERS,
  OWN_MODULE,
  pluginEntryPoint,
  readPackageManifest,
} from "../packages/manifest.js";
import { legacyName } from "../utils/deprecation.js";
import type { PluginFunction } from "./api.js";
import { resolvePluginExport } from "./api.js";
import { registry } from "./registry.js";
import type { PluginDef, PluginSourceInfo } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Where a host module resolves: codemode's own entry points beside this
 * file, everything else from codemode's dependencies.
 */
function hostModulePath(specifier: string): string | undefined {
  const own = (entry: string) =>
    fileURLToPath(new URL(`../${entry}.js`, import.meta.url));
  if (specifier === OWN_MODULE) return own("index");
  if (specifier.startsWith(`${OWN_MODULE}/`))
    return own(specifier.slice(OWN_MODULE.length + 1));
  if (specifier in LEGACY_HOST_MODULE_SPECIFIERS)
    return own(
      LEGACY_HOST_MODULE_SPECIFIERS[
        specifier as keyof typeof LEGACY_HOST_MODULE_SPECIFIERS
      ],
    );
  try {
    return fileURLToPath(import.meta.resolve(specifier));
  } catch {
    return undefined;
  }
}

/**
 * Plugins import codemode (and the TypeBox it validates with) from the
 * codemode that loads them, never from a copy of their own: one credential
 * transport, one set of error classes, one schema library per process.
 */
const HOST_ALIASES: Record<string, string> = Object.fromEntries(
  [
    ...HOST_MODULE_SPECIFIERS,
    ...Object.keys(LEGACY_HOST_MODULE_SPECIFIERS),
  ].flatMap((specifier) => {
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

/** A plugin module importing this package under its runline name. */
const IMPORTS_RUNLINE =
  /(?:\bfrom\s+|\brequire\(\s*|\bimport\(\s*)["']runline(?:\/[^"']*)?["']/;

/**
 * Load one plugin module. A `sourceInfo` the module declares is dropped:
 * provenance is for discovery to state.
 */
export async function loadPluginFromPath(
  path: string,
  options: {
    /**
     * The name a plugin gets when it declares none. Default: its file
     * name. `null`: none, so the plugin must declare one.
     */
    defaultName?: string | null;
  } = {},
): Promise<PluginDef> {
  let absPath = resolve(path);

  if (existsSync(absPath) && statSync(absPath).isDirectory()) {
    const found = pluginEntryPoint(absPath, readMain(absPath));
    if (!found) throw new Error(`No entry point found in ${absPath}`);
    absPath = found;
  }

  // Plugins may live outside the project/package tree. Load them through
  // codemode's module context so documented imports like
  // `from "@shiftlabs/codemode"` work without a node_modules folder next to
  // the plugin file.
  if (IMPORTS_RUNLINE.test(readFileSync(absPath, "utf8")))
    legacyName(`import from "runline" (${absPath})`, `"${OWN_MODULE}"`);
  const mod = (await jiti.import(absPath)) as { default?: unknown } | unknown;
  const pluginId = absPath.replace(/.*\//, "").replace(/\.(ts|js)$/, "");
  const pluginExport =
    typeof mod === "object" && mod !== null && "default" in mod
      ? mod.default
      : mod;
  const { sourceInfo: _declared, ...plugin } = resolvePluginExport(
    pluginExport as PluginDef | PluginFunction,
    options.defaultName === undefined ? pluginId : options.defaultName,
  );
  loadedFrom.set(plugin, absPath);
  return plugin;
}

/** The module each loaded plugin came from, for discovery's `sourceInfo.path`. */
const loadedFrom = new WeakMap<PluginDef, string>();

/** A folder's `package.json`, or undefined (reported) when it is unreadable. */
function readPackageJson(dir: string): Record<string, unknown> | undefined {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  try {
    return JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch (err) {
    console.error(
      `[codemode] Failed to parse ${pkgPath}:`,
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

function isPluginFile(entry: string): boolean {
  return (
    (entry.endsWith(".ts") || entry.endsWith(".js")) &&
    !entry.endsWith(".d.ts") &&
    !entry.endsWith(".test.ts")
  );
}

/** The name a plugins-folder entry goes by: a folder's name, a file's without its extension. */
function entryName(entry: string, isDirectory: boolean): string {
  return isDirectory ? entry : entry.replace(/\.(ts|js)$/, "");
}

/**
 * The plugins a folder holds, by the names of its entries and without
 * loading any: each plugin folder and each plugin file. A bundled plugin
 * declares the name of its folder (`lint:access` enforces it), so for the
 * bundled folder these are the plugins' names.
 */
export function pluginEntryNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory())
      return isPrivatePluginDirectory(entry.name) ? [] : [entry.name];
    return isPluginFile(entry.name) ? [entryName(entry.name, false)] : [];
  });
}

/**
 * `npm/` and `git/` under a plugins folder are the install folders of
 * runline 0.44 and earlier. plugins.json points into them; they are not
 * plugins themselves.
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
  options: {
    skipLegacyInstallDirs?: boolean;
    /** Load only the entries with these names; the rest are never imported. */
    only?: Set<string>;
  } = {},
): Promise<PluginDef[]> {
  const plugins: PluginDef[] = [];
  if (!existsSync(dir)) return plugins;

  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (options.only && !options.only.has(entryName(entry, stat.isDirectory())))
      continue;

    if (stat.isFile() && isPluginFile(entry)) {
      try {
        plugins.push(await loadPluginFromPath(fullPath));
      } catch (err) {
        console.error(
          `[codemode] Failed to load plugin from ${fullPath}:`,
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
      if (pkg?.codemode !== undefined || pkg?.runline !== undefined) {
        // A folder declaring codemode.plugins is a package: the same manifest
        // rules as an installed one, so no path leaves the folder.
        try {
          paths = readPackageManifest(fullPath).pluginPaths;
        } catch (err) {
          console.error(
            `[codemode] Failed to load plugins from ${fullPath}:`,
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
            `[codemode] Failed to load plugin from ${fullPath}: No entry point found`,
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
            `[codemode] Failed to load plugin from ${path}:`,
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
          `[codemode] Invalid plugin entry in ${pluginsFile}: expected string path or { path }`,
        );
        continue;
      }
      const pluginPath = isAbsolute(p) ? p : join(configDir, p);
      try {
        plugins.push(await loadPluginFromPath(pluginPath));
      } catch (err) {
        console.error(
          `[codemode] Failed to load plugin from ${pluginPath}:`,
          (err as Error).message,
        );
      }
    }
  } catch (err) {
    console.error(
      `[codemode] Failed to parse ${pluginsFile}:`,
      (err as Error).message,
    );
  }
  return plugins;
}

export interface DiscoverOptions {
  /**
   * When supplied, only built-in plugins whose name is in this set
   * are loaded; the others are never imported. Plugins discovered in the
   * project dir, `plugins.json`, or `~/.codemode/plugins` are not gated
   * this way — users put them there deliberately — but the bundled
   * builtins are, so agents don't see every possible action regardless
   * of configuration.
   *
   * Omit to load every builtin (CLI default: `codemode actions` etc.
   * surfaces the full catalog).
   */
  builtinAllowlist?: Set<string> | null;

  /**
   * Whether the project's `.codemode` folder may contribute plugins: the
   * files under `plugins/` and the entries of `plugins.json`, which run as
   * code when loaded. Default: whether `<userDir>/trust.json` lists the
   * folder (`codemode trust`). Pass the same decision to the package
   * manager, which asks it for the project's packages.
   */
  trust?: (projectRoot: string) => boolean | Promise<boolean>;

  /**
   * Override the directory where bundled plugins live. Default is
   * `<loader>/../plugins`, which resolves to `dist/plugins/` at
   * runtime. Tests set this so they can exercise allowlist logic
   * without depending on the real bundled catalog.
   */
  builtinDir?: string;

  /**
   * Bundled plugins a local plugin of the same name replaces. A local
   * plugin named like any other bundled plugin is not loaded: the name
   * selects the connection, and so the credentials. Default: none.
   */
  replaceableBuiltins?: Iterable<string>;

  /**
   * Configured packages to load after the project and global plugin
   * folders and before the built-ins. Their problems are reported on
   * stderr, like every other discovery failure here.
   */
  packages?: PackageManager;

  /** Package sources loaded for this discovery only, never recorded. */
  temporaryPackages?: string[];

  /** The user's codemode folder. Default: `~/.codemode`. */
  userDir?: string;
}

/** Default path to the bundled plugin directory. */
export function defaultBuiltinDir(): string {
  return join(__dirname, "..", "plugins");
}

/**
 * Discover and return all plugins from a config directory and global dir,
 * each with its `sourceInfo`. A trusted project's plugins come first, then
 * the user's, then packages, then the bundled plugins; the first plugin
 * with a name keeps it, except that a local plugin never takes a bundled
 * plugin's name unless that plugin is listed as replaceable.
 * Does NOT mutate any global state.
 */
export async function discoverPlugins(
  configDir?: string | null,
  options: DiscoverOptions = {},
): Promise<PluginDef[]> {
  const loaded = new Set<string>();
  const result: PluginDef[] = [];

  const builtinDir = options.builtinDir ?? defaultBuiltinDir();
  const builtinNames = new Set(pluginEntryNames(builtinDir));
  const replaceable = new Set(options.replaceableBuiltins);
  const replaced = new Set<string>();

  function addIfNew(plugin: PluginDef, source: string) {
    if (loaded.has(plugin.name)) {
      // A replaced bundled plugin is left out by request, not by accident.
      if (plugin.sourceInfo?.origin === "builtin" && replaced.has(plugin.name))
        return;
      console.error(
        `[codemode] Skipping duplicate plugin "${plugin.name}" from ${source}: a plugin with that name is already loaded`,
      );
      return;
    }
    result.push(plugin);
    loaded.add(plugin.name);
  }

  function addLocal(
    plugins: PluginDef[],
    source: string,
    scope: "project" | "user",
  ) {
    for (const plugin of plugins) {
      if (builtinNames.has(plugin.name)) {
        if (!replaceable.has(plugin.name)) {
          console.error(
            `[codemode] Plugin "${plugin.name}" from ${source} has the name of a bundled plugin and was not loaded. To replace the bundled plugin, list "${plugin.name}" under "replaceableBuiltins" in config.json.`,
          );
          continue;
        }
        replaced.add(plugin.name);
      }
      plugin.sourceInfo = sourceInfo(plugin, {
        source,
        origin: "local",
        scope,
        owner: "local",
      });
      addIfNew(plugin, source);
    }
  }

  const userDir = resolve(options.userDir ?? userConfigDir());
  // A project is a `.codemode` other than the user's own; its code waits
  // for trust, and nothing of it is imported without it.
  const projectDir =
    configDir && resolve(configDir) !== userDir ? resolve(configDir) : null;
  if (projectDir) {
    const projectPluginsDir = join(projectDir, "plugins");
    const pluginsJson = join(projectDir, "plugins.json");
    const trust =
      options.trust ?? ((root: string) => isProjectTrusted(root, userDir));
    if (await trust(projectDir)) {
      addLocal(
        await loadFromDirectory(projectPluginsDir, {
          skipLegacyInstallDirs: true,
        }),
        projectPluginsDir,
        "project",
      );
      addLocal(await loadPluginsFromConfig(projectDir), pluginsJson, "project");
    } else if (
      pluginEntryNames(projectPluginsDir).length ||
      existsSync(pluginsJson)
    ) {
      console.error(
        `[codemode] The plugins in ${projectDir} were not loaded: the project is not trusted. Run \`codemode trust\` there to load them.`,
      );
    }
  }

  const globalDir = join(userDir, "plugins");
  addLocal(
    await loadFromDirectory(globalDir, { skipLegacyInstallDirs: true }),
    globalDir,
    "user",
  );

  if (options.packages) {
    const { plugins: fromPackages, problems } = await options.packages.load({
      temporary: options.temporaryPackages,
    });
    for (const problem of problems)
      console.error(
        `[codemode] ${problem.level === "warning" ? "Warning: " : ""}${problem.message}`,
      );
    for (const p of fromPackages)
      addIfNew(p, p.sourceInfo?.source ?? "a package");
  }

  for (const p of await loadFromDirectory(builtinDir, {
    only: options.builtinAllowlist ?? undefined,
  })) {
    p.sourceInfo = sourceInfo(p, {
      source: "builtin",
      origin: "builtin",
      owner: "builtin",
    });
    addIfNew(p, builtinDir);
  }

  return result;
}

function sourceInfo(
  plugin: PluginDef,
  info: Omit<PluginSourceInfo, "path">,
): PluginSourceInfo {
  return { path: loadedFrom.get(plugin) ?? info.source, ...info };
}

/**
 * Load all plugins and register them into the global registry.
 * Used by the CLI.
 */
export async function loadAllPlugins(
  options: DiscoverOptions = {},
): Promise<void> {
  const configDir = findConfigDir();
  const plugins = await discoverPlugins(configDir, {
    replaceableBuiltins: configDir
      ? loadConfigFrom(join(configDir, "config.json")).replaceableBuiltins
      : undefined,
    ...options,
  });
  for (const p of plugins) {
    registry.register(p);
  }
}
