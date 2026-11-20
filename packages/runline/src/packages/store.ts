import { readConnectionFile, updateConnectionFile } from "../config/store.js";
import { PackageError } from "./errors.js";

export type PackageScope = "user" | "project";

/**
 * One configured package: its source, or its source and the plugins to load
 * from it. `plugins` names plugins; `!name` excludes one. It can only narrow
 * what the package declares.
 */
export type PackageEntry = string | { source: string; plugins?: string[] };

export function entrySource(entry: PackageEntry): string {
  return typeof entry === "string" ? entry : entry.source;
}

/**
 * Where configured packages are recorded. The package manager reads and
 * changes entries only through this; hosts keep them wherever they keep
 * their own state (a database row, a settings file).
 */
export interface PackageStore {
  read(scope: PackageScope): Promise<PackageEntry[]>;
  /**
   * Read a scope's entries and replace them with `change`'s `entries`, as one
   * step no other writer interleaves with. Omitting `entries` writes nothing.
   */
  update<T>(
    scope: PackageScope,
    change: (entries: PackageEntry[]) => {
      entries?: PackageEntry[];
      result: T;
    },
  ): Promise<T>;
}

function validEntries(value: unknown, where: string): PackageEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new PackageError(
      "invalid_config",
      `${where}: "packages" must be an array`,
    );
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim()) continue;
    if (
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof entry.source === "string" &&
      entry.source.trim() &&
      (entry.plugins === undefined ||
        (Array.isArray(entry.plugins) &&
          entry.plugins.every((p: unknown) => typeof p === "string")))
    )
      continue;
    throw new PackageError(
      "invalid_config",
      `${where}: each package is a source string or { source, plugins? }`,
    );
  }
  return structuredClone(value as PackageEntry[]);
}

/**
 * Entries kept under `"packages"` in runline's `config.json`, one file per
 * scope. Writes share the connection file's lock and atomic replace, so
 * they never race a connection update.
 */
export class FilePackageStore implements PackageStore {
  constructor(private readonly files: Partial<Record<PackageScope, string>>) {}

  private file(scope: PackageScope): string | undefined {
    return this.files[scope];
  }

  async read(scope: PackageScope): Promise<PackageEntry[]> {
    const path = this.file(scope);
    if (!path) return [];
    return validEntries(readConnectionFile(path).packages, path);
  }

  async update<T>(
    scope: PackageScope,
    change: (entries: PackageEntry[]) => {
      entries?: PackageEntry[];
      result: T;
    },
  ): Promise<T> {
    const path = this.file(scope);
    if (!path)
      throw new PackageError(
        "not_found",
        `No ${scope} config file to record packages in`,
      );
    return updateConnectionFile(path, (data) => {
      const { entries, result } = change(validEntries(data.packages, path));
      if (entries === undefined) return { result, write: false };
      if (entries.length) data.packages = validEntries(entries, path);
      else delete data.packages;
      return { result, write: true };
    });
  }
}

/** Entries held in memory: for tests and hosts that persist elsewhere. */
export class MemoryPackageStore implements PackageStore {
  private readonly scopes: Record<PackageScope, PackageEntry[]>;

  constructor(initial: Partial<Record<PackageScope, PackageEntry[]>> = {}) {
    this.scopes = {
      user: validEntries(initial.user, "user"),
      project: validEntries(initial.project, "project"),
    };
  }

  async read(scope: PackageScope): Promise<PackageEntry[]> {
    return structuredClone(this.scopes[scope]);
  }

  async update<T>(
    scope: PackageScope,
    change: (entries: PackageEntry[]) => {
      entries?: PackageEntry[];
      result: T;
    },
  ): Promise<T> {
    const { entries, result } = change(structuredClone(this.scopes[scope]));
    if (entries !== undefined)
      this.scopes[scope] = validEntries(entries, scope);
    return result;
  }
}
