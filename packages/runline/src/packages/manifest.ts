import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { PackageError } from "./errors.js";

/** Modules runline supplies to plugins; a package lists them as peers. */
export const HOST_MODULES = ["runline", "typebox"] as const;

export interface PackageManifest {
  name?: string;
  version?: string;
  /** Plugin module paths, absolute, inside the package root. */
  pluginPaths: string[];
  /** Host modules the package wrongly lists in `dependencies`. */
  bundledHostModules: string[];
}

const PLUGIN_FILE = /\.(ts|js|mjs|cjs)$/;

/** Whether `path`, symlinks followed, is `root` or beneath it. */
export function within(root: string, path: string): boolean {
  const realRoot = realpathSync(root);
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    return false;
  }
  const rel = relative(realRoot, real);
  return (
    rel === "" ||
    !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
  );
}

function segmentRegex(segment: string): RegExp {
  const escaped = segment
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Expand a relative glob (`*`, `?`, `**`) under `root`. Wildcards skip dot entries and node_modules. */
function expand(root: string, pattern: string): string[] {
  const segments = pattern.replace(/^\.\//, "").split("/").filter(Boolean);
  let current = [root];
  for (const segment of segments) {
    const next: string[] = [];
    if (segment === "**") {
      const stack = [...current];
      while (stack.length) {
        const dir = stack.pop() as string;
        next.push(dir);
        for (const entry of listDir(dir)) {
          if (entry.startsWith(".") || entry === "node_modules") continue;
          const full = join(dir, entry);
          if (isDir(full)) stack.push(full);
        }
      }
    } else if (/[*?]/.test(segment)) {
      const re = segmentRegex(segment);
      for (const dir of current)
        for (const entry of listDir(dir))
          if (
            !entry.startsWith(".") &&
            entry !== "node_modules" &&
            re.test(entry)
          )
            next.push(join(dir, entry));
    } else {
      for (const dir of current) {
        const full = join(dir, segment);
        if (existsSync(full)) next.push(full);
      }
    }
    current = [...new Set(next)];
  }
  return current;
}

function entryPoint(dir: string, main?: string): string | undefined {
  const candidates = [
    ...(main ? [join(dir, main)] : []),
    join(dir, "index.ts"),
    join(dir, "index.js"),
    join(dir, "src", "index.ts"),
    join(dir, "src", "index.js"),
  ];
  return candidates.find((c) => existsSync(c) && !isDir(c));
}

/**
 * Read a package's plugins: `package.json` `runline.plugins` (paths and
 * globs relative to the root, `!pattern` excludes), else its `main`, else
 * `index.{ts,js}` or `src/index.{ts,js}`. A single file is itself the plugin.
 * Paths that leave the package root, through `..` or a symlink, are refused.
 */
export function readPackageManifest(
  root: string,
  source?: string,
): PackageManifest {
  if (!existsSync(root))
    throw new PackageError(
      "missing_path",
      `Package path does not exist: ${root}`,
      { source },
    );
  if (!isDir(root)) {
    if (!PLUGIN_FILE.test(root) || root.endsWith(".d.ts"))
      throw new PackageError(
        "invalid_manifest",
        `Not a plugin module: ${root}`,
        { source },
      );
    return { pluginPaths: [resolve(root)], bundledHostModules: [] };
  }

  let pkg: Record<string, unknown> = {};
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch (error) {
      throw new PackageError(
        "invalid_manifest",
        `Unreadable package.json in ${root}`,
        {
          source,
          cause: error,
        },
      );
    }
  }
  const dependencies =
    pkg.dependencies && typeof pkg.dependencies === "object"
      ? Object.keys(pkg.dependencies)
      : [];
  const bundledHostModules = HOST_MODULES.filter((m) =>
    dependencies.includes(m),
  );

  const runlineKey = pkg.runline as { plugins?: unknown } | undefined;
  const declared = runlineKey?.plugins;
  let pluginPaths: string[];
  if (declared !== undefined) {
    if (
      !Array.isArray(declared) ||
      !declared.every((p) => typeof p === "string")
    )
      throw new PackageError(
        "invalid_manifest",
        `runline.plugins must be an array of paths in ${pkgPath}`,
        {
          source,
        },
      );
    const include = declared.filter((p) => !p.startsWith("!"));
    const exclude = declared
      .filter((p) => p.startsWith("!"))
      .map((p) => p.slice(1));
    for (const p of declared) {
      const bare = p.replace(/^!/, "");
      if (bare.startsWith("/") || bare.split(/[\\/]/).includes(".."))
        throw new PackageError(
          "invalid_manifest",
          `runline.plugins path leaves the package: ${p}`,
          { source },
        );
    }
    const excluded = new Set(
      exclude.flatMap((p) => expand(root, p)).map((p) => resolve(p)),
    );
    const found: string[] = [];
    for (const pattern of include) {
      for (const match of expand(root, pattern)) {
        const file = isDir(match) ? entryPoint(match) : match;
        if (
          !file ||
          excluded.has(resolve(match)) ||
          excluded.has(resolve(file))
        )
          continue;
        if (
          !PLUGIN_FILE.test(file) ||
          file.endsWith(".d.ts") ||
          /\.test\.[tj]s$/.test(file)
        )
          continue;
        if (!within(root, file))
          throw new PackageError(
            "invalid_manifest",
            `runline.plugins path leaves the package: ${pattern}`,
            {
              source,
            },
          );
        found.push(resolve(file));
      }
    }
    pluginPaths = [...new Set(found)];
  } else {
    const main = typeof pkg.main === "string" ? pkg.main : undefined;
    const file = entryPoint(root, main);
    if (file && !within(root, file))
      throw new PackageError(
        "invalid_manifest",
        `main leaves the package: ${main}`,
        { source },
      );
    pluginPaths = file ? [resolve(file)] : [];
  }
  if (!pluginPaths.length)
    throw new PackageError("invalid_manifest", `No plugin found in ${root}`, {
      source,
    });

  return {
    name: typeof pkg.name === "string" ? pkg.name : undefined,
    version: typeof pkg.version === "string" ? pkg.version : undefined,
    pluginPaths,
    bundledHostModules,
  };
}
