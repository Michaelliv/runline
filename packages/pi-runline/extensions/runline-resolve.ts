import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Find the .runline/ config directory.
 *
 * Resolution order:
 * 1. Walk up from cwd looking for a project-local `.runline/`
 * 2. Fall back to the global project configured in ~/.pi/agent/runline.json
 */
export function findRunlineDir(cwd: string): string | null {
  let dir = cwd;
  while (dir !== path.dirname(dir)) {
    const runlineDir = path.join(dir, ".runline");
    if (fs.existsSync(runlineDir)) return runlineDir;
    dir = path.dirname(dir);
  }
  return getGlobalRunlineDir();
}

function getGlobalRunlineDir(): string | null {
  const homeDir = os.homedir();
  const configPath = path.join(homeDir, ".pi", "agent", "runline.json");
  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (!raw.project) return null;

    const projectPath: string = raw.project.startsWith("~")
      ? path.join(homeDir, raw.project.slice(1))
      : path.resolve(raw.project);

    const runlineDir = path.join(projectPath, ".runline");
    if (fs.existsSync(runlineDir)) return runlineDir;
  } catch {
    // invalid config
  }
  return null;
}

export interface RunlineExtConfig {
  showStatus: boolean;
  /** Allowlist of plugin names exposed to the agent. undefined = none. */
  piPlugins?: string[];
}

export function loadExtConfig(runlineDir: string): RunlineExtConfig {
  const configPath = path.join(runlineDir, "config.json");
  if (!fs.existsSync(configPath)) return { showStatus: true };
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return {
      showStatus: raw.showStatus !== false,
      piPlugins: Array.isArray(raw.piPlugins) ? raw.piPlugins : undefined,
    };
  } catch {
    return { showStatus: true };
  }
}

export function savePiPlugins(
  runlineDir: string,
  piPlugins: string[],
): void {
  const configPath = path.join(runlineDir, "config.json");
  let raw: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      raw = {};
    }
  }
  raw.piPlugins = [...piPlugins].sort();
  fs.writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`);
}
