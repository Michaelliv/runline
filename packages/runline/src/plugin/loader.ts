import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findConfigDir } from "../config/loader.js";
import { resolvePluginExport } from "./api.js";
import { registry } from "./registry.js";
import type { PluginDef } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadPluginFromPath(path: string): Promise<PluginDef> {
  let absPath = resolve(path);

  if (existsSync(absPath) && statSync(absPath).isDirectory()) {
    const candidates = [
      join(absPath, "src", "index.ts"),
      join(absPath, "src", "index.js"),
      join(absPath, "index.ts"),
      join(absPath, "index.js"),
    ];

    const pkgPath = join(absPath, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.main) candidates.unshift(join(absPath, pkg.main));
      } catch (err) {
        console.error(
          `[runline] Failed to parse ${pkgPath}:`,
          (err as Error).message,
        );
      }
    }

    const found = candidates.find((c) => existsSync(c));
    if (found) {
      absPath = found;
    } else {
      throw new Error(`No entry point found in ${absPath}`);
    }
  }

  const mod = await import(pathToFileURL(absPath).href);
  const pluginId = absPath.replace(/.*\//, "").replace(/\.(ts|js)$/, "");
  return resolvePluginExport(mod.default, pluginId);
}

async function loadFromDirectory(dir: string): Promise<PluginDef[]> {
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
      const candidates = [
        join(fullPath, "index.ts"),
        join(fullPath, "index.js"),
        join(fullPath, "src", "index.ts"),
        join(fullPath, "src", "index.js"),
      ];
      const found = candidates.find((c) => existsSync(c));
      if (found) {
        try {
          plugins.push(await loadPluginFromPath(found));
        } catch (err) {
          console.error(
            `[runline] Failed to load plugin from ${found}:`,
            (err as Error).message,
          );
        }
      }

      const pkgJson = join(fullPath, "package.json");
      if (existsSync(pkgJson)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgJson, "utf-8"));
          const pluginPaths: string[] = pkg.runline?.plugins ?? [];
          for (const p of pluginPaths) {
            try {
              plugins.push(await loadPluginFromPath(join(fullPath, p)));
            } catch (err) {
              console.error(
                `[runline] Failed to load plugin from ${join(fullPath, p)}:`,
                (err as Error).message,
              );
            }
          }
        } catch (err) {
          console.error(
            `[runline] Failed to parse ${pkgJson}:`,
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
    const entries: Array<{ path: string }> = data.plugins ?? data;

    for (const entry of entries) {
      const p = typeof entry === "string" ? entry : entry.path;
      try {
        plugins.push(await loadPluginFromPath(p));
      } catch (err) {
        console.error(
          `[runline] Failed to load plugin from ${p}:`,
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

  function addIfNew(plugin: PluginDef) {
    if (!loaded.has(plugin.name)) {
      result.push(plugin);
      loaded.add(plugin.name);
    }
  }

  if (configDir) {
    const projectPluginsDir = join(configDir, "plugins");
    const projectPlugins = await loadFromDirectory(projectPluginsDir);
    for (const p of projectPlugins) addIfNew(p);

    const configPlugins = await loadPluginsFromConfig(configDir);
    for (const p of configPlugins) addIfNew(p);
  }

  const globalDir = join(homedir(), ".runline", "plugins");
  const globalPlugins = await loadFromDirectory(globalDir);
  for (const p of globalPlugins) addIfNew(p);

  const builtinDir = options.builtinDir ?? defaultBuiltinDir();
  const builtinPlugins = await loadFromDirectory(builtinDir);
  for (const p of builtinPlugins) {
    if (options.builtinAllowlist && !options.builtinAllowlist.has(p.name)) {
      continue;
    }
    addIfNew(p);
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
