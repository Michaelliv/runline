import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findConfigDir } from "../config/loader.js";
import { resolvePluginExport } from "./api.js";
import { registry } from "./registry.js";
import type { PluginDef } from "./types.js";

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
      } catch {}
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
        console.error(`[runline] Failed to load plugin from ${fullPath}:`, (err as Error).message);
      }
    } else if (stat.isDirectory()) {
      const indexTs = join(fullPath, "index.ts");
      const indexJs = join(fullPath, "index.js");
      if (existsSync(indexTs)) {
        try {
          plugins.push(await loadPluginFromPath(indexTs));
        } catch (err) {
          console.error(`[runline] Failed to load plugin from ${indexTs}:`, (err as Error).message);
        }
      } else if (existsSync(indexJs)) {
        try {
          plugins.push(await loadPluginFromPath(indexJs));
        } catch (err) {
          console.error(`[runline] Failed to load plugin from ${indexJs}:`, (err as Error).message);
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
              console.error(`[runline] Failed to load plugin from ${join(fullPath, p)}:`, (err as Error).message);
            }
          }
        } catch {}
      }
    }
  }

  return plugins;
}

export async function loadPluginsFromConfig(configDir: string): Promise<void> {
  const pluginsFile = join(configDir, "plugins.json");
  if (!existsSync(pluginsFile)) return;

  try {
    const data = JSON.parse(readFileSync(pluginsFile, "utf-8"));
    const entries: Array<{ path: string }> = data.plugins ?? data;

    for (const entry of entries) {
      const p = typeof entry === "string" ? entry : entry.path;
      try {
        const plugin = await loadPluginFromPath(p);
        registry.register(plugin);
      } catch (err) {
        console.error(`[runline] Failed to load plugin from ${p}:`, (err as Error).message);
      }
    }
  } catch {}
}

export async function loadAllPlugins(): Promise<void> {
  const loaded = new Set<string>();

  function registerIfNew(plugin: PluginDef) {
    if (!loaded.has(plugin.name)) {
      registry.register(plugin);
      loaded.add(plugin.name);
    }
  }

  const configDir = findConfigDir();
  if (configDir) {
    const projectPluginsDir = join(configDir, "plugins");
    const projectPlugins = await loadFromDirectory(projectPluginsDir);
    for (const p of projectPlugins) registerIfNew(p);

    await loadPluginsFromConfig(configDir);
    for (const p of registry.listPlugins()) loaded.add(p.name);
  }

  const globalDir = join(homedir(), ".runline", "plugins");
  const globalPlugins = await loadFromDirectory(globalDir);
  for (const p of globalPlugins) registerIfNew(p);
}
