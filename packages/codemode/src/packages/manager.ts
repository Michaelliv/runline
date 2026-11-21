import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import lockfile from "proper-lockfile";
import { gt, maxSatisfying, rcompare, satisfies } from "semver";
import {
  defaultBuiltinDir,
  loadPluginFromPath,
  pluginEntryNames,
} from "../plugin/loader.js";
import type { PluginDef } from "../plugin/types.js";
import {
  isPackageError,
  PackageError,
  type PackageErrorCode,
} from "./errors.js";
import { type PackageManifest, readPackageManifest } from "./manifest.js";
import {
  type CommandResult,
  type CommandRunner,
  nodeCommandRunner,
} from "./runner.js";
import {
  type GitSource,
  type NpmSource,
  type ParsedSource,
  packageIdentity,
  parseSource,
  resolveLocalPath,
} from "./source.js";
import {
  entrySource,
  FilePackageStore,
  type PackageEntry,
  type PackageScope,
  type PackageStore,
} from "./store.js";

export type InstallScope = PackageScope | "temporary";
export type PackageManagerName = "npm" | "pnpm" | "bun";
export type MissingAction = "install" | "skip" | "error";

/**
 * The folders the package manager owns. Each is a codemode config folder
 * (`~/.codemode`, a project's `.codemode`): packages install under
 * `<root>/packages/{npm,git}` and relative local sources resolve from it.
 */
export interface PackageRoots {
  user?: string;
  project?: string;
  /** Where `temporary` installs go. Default: `<os tmpdir>/codemode-packages`. */
  temporary?: string;
}

export type PackageEvent =
  | { type: "start"; action: PackageAction; source: string; message: string }
  | { type: "complete"; action: PackageAction; source: string }
  | { type: "error"; action: PackageAction; source: string; message: string };

export type PackageAction = "install" | "remove" | "update" | "check";

export interface PackageProblem {
  level: "error" | "warning";
  code:
    | PackageErrorCode
    | "bundled_host_module"
    | "peer_unsatisfied"
    | "missing";
  message: string;
  source?: string;
  plugin?: string;
}

export interface PackageManagerOptions {
  roots: PackageRoots;
  store: PackageStore;
  /** Runs npm/pnpm/bun and git. Default: argv spawns through `node:child_process`. */
  runner?: CommandRunner;
  packageManager?: PackageManagerName;
  /** Whether a project's packages may be installed and loaded. Default: never. */
  trust?: (projectRoot: string) => boolean | Promise<boolean>;
  /** A configured package missing on disk during `load()`. Default: `"skip"`. */
  onMissing?:
    | MissingAction
    | ((
        source: string,
        scope: InstallScope,
      ) => MissingAction | Promise<MissingAction>);
  onEvent?: (event: PackageEvent) => void;
  /** Used by `search()`. Default: the global `fetch`. */
  fetch?: typeof fetch;
  /** Registry for `search()`. Default: `https://registry.npmjs.org`. */
  registry?: string;
  /** Plugin names packages may not declare. Default: the bundled plugins' names. */
  reservedNames?: Iterable<string>;
  /** Refuse every network step: no installs, updates, checks or searches. */
  offline?: boolean;
  /** Loads one plugin module. Default: codemode's `loadPluginFromPath`. */
  loadPlugin?: (path: string) => Promise<PluginDef>;
}

export interface CallOptions {
  signal?: AbortSignal;
}

export interface ScopeOptions extends CallOptions {
  scope?: PackageScope;
}

/** A package on disk in a managed root that may not be recorded yet. */
export interface StagedPackage {
  source: string;
  scope: InstallScope;
  identity: string;
  path: string;
  version?: string;
}

export interface PluginReport {
  name: string;
  version: string;
  actions: number;
  read: number;
  write: number;
  /** Actions that declare no access. */
  unspecified: number;
  credential?: {
    type: string;
    method: string;
    /** Base URLs the selected method signs for. */
    targets: string[];
  };
  /** Set when the credential's type depends on connection config. */
  credentialNote?: string;
}

/** What a package carries and asks for, read without recording it. */
export interface PackageReport {
  source: string;
  identity: string;
  path: string;
  name?: string;
  version?: string;
  plugins: PluginReport[];
  problems: PackageProblem[];
}

export interface ConfiguredPackage {
  source: string;
  scope: PackageScope;
  identity: string;
  /** Plugin filter from the entry, when it is the object form. */
  plugins?: string[];
  installedPath?: string;
  version?: string;
}

export interface PackageUpdate {
  source: string;
  scope: PackageScope;
  from?: string;
  to?: string;
  changed: boolean;
}

export interface AvailableUpdate {
  source: string;
  scope: PackageScope;
  installed?: string;
  latest: string;
}

export interface LoadResult {
  /** Each with `sourceInfo`: its package's source, scope and identity (as `owner`). */
  plugins: PluginDef[];
  problems: PackageProblem[];
}

export interface SearchResult {
  name: string;
  version: string;
  description?: string;
  source: string;
}

const NETWORK_TIMEOUT_MS = 10_000;

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new PackageError("aborted", "Package operation aborted");
}

/** The runtime dependencies a checkout's package.json declares. */
function dependencyNames(path: string): string[] {
  try {
    const { dependencies } = JSON.parse(
      readFileSync(join(path, "package.json"), "utf8"),
    );
    return dependencies && typeof dependencies === "object"
      ? Object.keys(dependencies)
      : [];
  } catch {
    return [];
  }
}

function readVersion(path: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

let bundledNames: string[] | undefined;

/** The bundled plugins' names, read from codemode's plugin folder without loading them. */
export function bundledPluginNames(
  builtinDir = defaultBuiltinDir(),
): Set<string> {
  if (builtinDir !== defaultBuiltinDir())
    return new Set(pluginEntryNames(builtinDir));
  bundledNames ??= pluginEntryNames(builtinDir);
  return new Set(bundledNames);
}

/**
 * Installs, records, updates and loads codemode plugin packages. The CLI is
 * one consumer; hosts embed it with their own store, roots, runner and
 * trust. It never prompts, prints or exits, and reads no folder it was not
 * given.
 */
export class PackageManager {
  private readonly roots: PackageRoots;
  private readonly store: PackageStore;
  private readonly runner: CommandRunner;
  private readonly pm: PackageManagerName;
  private readonly options: PackageManagerOptions;
  private reserved?: Set<string>;

  constructor(options: PackageManagerOptions) {
    this.options = options;
    this.roots = {
      ...options.roots,
      user: options.roots.user ? resolve(options.roots.user) : undefined,
      project: options.roots.project
        ? resolve(options.roots.project)
        : undefined,
    };
    // One folder serving as both scopes (a project under ~ with no .codemode
    // of its own) is the user scope only.
    if (this.roots.project && this.roots.project === this.roots.user)
      this.roots.project = undefined;
    this.store = options.store;
    this.runner = options.runner ?? nodeCommandRunner;
    this.pm = options.packageManager ?? "npm";
  }

  /**
   * A manager over codemode folders laid out as the CLI keeps them: entries
   * under `"packages"` in each root's `config.json`.
   */
  static forCodemodeFolders(
    options: Omit<PackageManagerOptions, "store">,
  ): PackageManager {
    const { user, project } = options.roots;
    return new PackageManager({
      ...options,
      store: new FilePackageStore({
        user: user ? join(user, "config.json") : undefined,
        project: project ? join(project, "config.json") : undefined,
      }),
    });
  }

  // ── public API ────────────────────────────────────────

  /** Fetch a source into its scope's managed root without recording it. */
  async fetch(
    source: string,
    options: { scope?: InstallScope } & CallOptions = {},
  ): Promise<StagedPackage> {
    const scope = options.scope ?? "user";
    const parsed = parseSource(source);
    const root = await this.rootFor(scope);
    const staged = {
      source,
      scope,
      identity: packageIdentity(parsed, root),
    };
    assertUsableTemporary(parsed, scope, source);
    if (parsed.type === "local") {
      const path = resolveLocalPath(parsed.path, root);
      if (!existsSync(path))
        throw new PackageError("missing_path", `Path does not exist: ${path}`, {
          source,
        });
      return { ...staged, path, version: readVersion(path) };
    }
    this.assertOnline(source);
    await this.withEvents("install", source, `Installing ${source}`, () =>
      this.withLock(root, options.signal, () =>
        parsed.type === "npm"
          ? this.installNpm(parsed, root, options.signal)
          : this.installGit(parsed, root, scope, options.signal),
      ),
    );
    const path = this.installPath(parsed, root, scope);
    return { ...staged, path, version: readVersion(path) };
  }

  /** Read what a package carries and asks for. Fetches a source string first. */
  async inspect(
    target: StagedPackage | string,
    options: { scope?: InstallScope } & CallOptions = {},
  ): Promise<PackageReport> {
    const staged =
      typeof target === "string" ? await this.fetch(target, options) : target;
    const problems: PackageProblem[] = [];
    const read = await this.readPlugins(
      staged.path,
      staged.source,
      problems,
      options.signal,
    );
    const plugins: PluginReport[] = [];
    for (const { plugin } of read?.plugins ?? []) {
      if (this.reservedNames().has(plugin.name))
        problems.push(reservedProblem(plugin.name, staged.source));
      plugins.push(reportPlugin(plugin));
    }
    return {
      source: staged.source,
      identity: staged.identity,
      path: staged.path,
      name: read?.name,
      version: read?.version ?? staged.version,
      plugins,
      problems,
    };
  }

  /** Record a fetched package in its scope, replacing an entry with the same identity. */
  async commit(staged: StagedPackage): Promise<ConfiguredPackage> {
    if (staged.scope === "temporary")
      throw new PackageError(
        "invalid_source",
        "A temporary package is never recorded",
        { source: staged.source },
      );
    const scope = staged.scope;
    const root = await this.rootFor(scope);
    await this.store.update(scope, (entries) => {
      const index = entries.findIndex(
        (e) => this.identityOf(entrySource(e), root) === staged.identity,
      );
      if (index < 0)
        return { entries: [...entries, staged.source], result: undefined };
      const existing = entries[index];
      if (entrySource(existing) === staged.source) return { result: undefined };
      const next = [...entries];
      next[index] =
        typeof existing === "string"
          ? staged.source
          : { ...existing, source: staged.source };
      return { entries: next, result: undefined };
    });
    return {
      source: staged.source,
      scope,
      identity: staged.identity,
      installedPath: staged.path,
      version: staged.version,
    };
  }

  /**
   * Undo a fetch that will not be committed: remove its files, or, when its
   * scope records the same package at another version or ref, put that one
   * back.
   */
  async discard(
    staged: StagedPackage,
    options: CallOptions = {},
  ): Promise<void> {
    const parsed = parseSource(staged.source);
    if (parsed.type === "local") return;
    if (staged.scope !== "temporary") {
      const root = await this.rootFor(staged.scope);
      const recorded = (await this.store.read(staged.scope))
        .map(entrySource)
        .find((s) => this.identityOf(s, root) === staged.identity);
      if (recorded !== undefined) {
        if (recorded !== staged.source)
          await this.fetch(recorded, {
            scope: staged.scope,
            signal: options.signal,
          });
        return;
      }
    }
    await this.removeFromDisk(parsed, staged.scope, options.signal);
  }

  /** `fetch` then `commit`, with no inspection in between. */
  async install(
    source: string,
    options: ScopeOptions = {},
  ): Promise<ConfiguredPackage> {
    return this.commit(await this.fetch(source, options));
  }

  /** Remove a configured package by identity: its entry, and its managed files. */
  async remove(source: string, options: ScopeOptions = {}): Promise<boolean> {
    const scope = options.scope ?? "user";
    const root = await this.rootFor(scope);
    const identity = this.identityOf(source, root);
    const removed = await this.store.update(scope, (entries) => {
      const next = entries.filter(
        (e) => this.identityOf(entrySource(e), root) !== identity,
      );
      return next.length === entries.length
        ? { result: undefined }
        : {
            entries: next,
            result: entries.find(
              (e) => this.identityOf(entrySource(e), root) === identity,
            ),
          };
    });
    if (!removed) return false;
    const parsed = parseSource(entrySource(removed));
    if (parsed.type !== "local")
      await this.withEvents("remove", source, `Removing ${source}`, () =>
        this.removeFromDisk(parsed, scope, options.signal),
      );
    return true;
  }

  /** Configured packages in both scopes, as recorded, with what is on disk. */
  async list(): Promise<ConfiguredPackage[]> {
    const result: ConfiguredPackage[] = [];
    for (const scope of this.scopes()) {
      // Listing reads entries only, so an untrusted project's are shown too.
      const root = this.rootPath(scope);
      for (const entry of await this.store.read(scope)) {
        const source = entrySource(entry);
        let identity = source;
        let installedPath: string | undefined;
        try {
          const parsed = parseSource(source);
          identity = packageIdentity(parsed, root);
          const path = this.installPath(parsed, root, scope);
          installedPath = existsSync(path) ? path : undefined;
        } catch {}
        result.push({
          source,
          scope,
          identity,
          plugins: typeof entry === "string" ? undefined : entry.plugins,
          installedPath,
          version: installedPath ? readVersion(installedPath) : undefined,
        });
      }
    }
    return result;
  }

  /**
   * Bring configured packages up to date: unpinned npm packages to the newest
   * version their range allows, git packages to their ref's or branch's head.
   * Local packages are never touched. Missing packages are installed.
   */
  async update(
    source?: string,
    options: CallOptions = {},
  ): Promise<PackageUpdate[]> {
    this.assertOnline(source ?? "packages");
    const targets = await this.configured(source);
    const results: PackageUpdate[] = [];
    for (const { source: s, scope, parsed, root } of targets) {
      assertNotAborted(options.signal);
      if (parsed.type === "local") continue;
      const path = this.installPath(parsed, root, scope);
      const from = existsSync(path)
        ? parsed.type === "git"
          ? await this.gitHead(path)
          : readVersion(path)
        : undefined;
      // An npm package inside its configured version or range moves only
      // to a newer version inside it; one outside it is reinstalled.
      if (
        parsed.type === "npm" &&
        from !== undefined &&
        this.installed(parsed, path) &&
        (parsed.pinned ||
          !(await this.npmHasNewer(parsed, from, options.signal)))
      ) {
        results.push({ source: s, scope, from, to: from, changed: false });
        continue;
      }
      await this.withEvents("update", s, `Updating ${s}`, () =>
        this.withLock(root, options.signal, () =>
          parsed.type === "npm"
            ? this.installNpm(
                parsed.version
                  ? parsed
                  : { ...parsed, spec: `${parsed.name}@latest` },
                root,
                options.signal,
              )
            : this.installGit(parsed, root, scope, options.signal),
        ),
      );
      const to =
        parsed.type === "git" ? await this.gitHead(path) : readVersion(path);
      results.push({ source: s, scope, from, to, changed: from !== to });
    }
    return results;
  }

  /** Newer versions available for unpinned npm packages and moving git refs. */
  async checkUpdates(options: CallOptions = {}): Promise<AvailableUpdate[]> {
    if (this.options.offline) return [];
    const targets = await this.configured();
    const results: AvailableUpdate[] = [];
    for (const { source, scope, parsed, root } of targets) {
      assertNotAborted(options.signal);
      if (parsed.type === "local" || (parsed.type === "npm" && parsed.pinned))
        continue;
      const path = this.installPath(parsed, root, scope);
      if (!existsSync(path)) continue;
      try {
        if (parsed.type === "npm") {
          const latest = await this.npmLatest(parsed, options.signal);
          const installed = readVersion(path);
          if (latest && (!installed || gt(latest, installed)))
            results.push({ source, scope, installed, latest });
        } else {
          const remote = await this.gitRemoteHead(path, parsed, options.signal);
          const local = await this.gitHead(path);
          if (remote && remote !== local)
            results.push({ source, scope, installed: local, latest: remote });
        }
      } catch (error) {
        this.options.onEvent?.({
          type: "error",
          action: "check",
          source,
          message: (error as Error).message,
        });
      }
    }
    return results;
  }

  /**
   * Load every configured package's plugins, project entries first. Missing
   * packages go to `onMissing`. Problems never throw; they are returned.
   * `temporary` sources load for this call only and are never recorded.
   */
  async load(
    options: { temporary?: string[] } & CallOptions = {},
  ): Promise<LoadResult> {
    assertNotAborted(options.signal);
    const problems: PackageProblem[] = [];
    const plugins: PluginDef[] = [];
    const sourceByName = new Map<string, string>();
    const reserved = this.reservedNames();

    // Trust is asked once per load; an untrusted project contributes nothing.
    const projectTrusted = await this.trusted();
    const packages: Array<{ entry: PackageEntry; scope: InstallScope }> = [];
    for (const source of options.temporary ?? [])
      packages.push({ entry: source, scope: "temporary" });
    for (const scope of this.scopes()) {
      const entries = await this.safeRead(scope, problems);
      if (scope === "project" && !projectTrusted) {
        if (entries.length)
          problems.push({
            level: "warning",
            code: "untrusted",
            message: `${entries.length} project package(s) skipped: ${this.roots.project} is not trusted`,
          });
        continue;
      }
      for (const entry of entries) packages.push({ entry, scope });
    }

    const seen = new Set<string>();
    for (const { entry, scope } of packages) {
      assertNotAborted(options.signal);
      const source = entrySource(entry);
      let parsed: ParsedSource;
      let identity: string;
      const root = this.rootPath(scope);
      try {
        parsed = parseSource(source);
        assertUsableTemporary(parsed, scope, source);
        identity = packageIdentity(parsed, root);
      } catch (error) {
        problems.push(problemFrom(error, source));
        continue;
      }
      if (seen.has(identity)) continue;
      seen.add(identity);

      let path = this.installPath(parsed, root, scope);
      if (!this.installed(parsed, path)) {
        const action =
          parsed.type === "local"
            ? "error"
            : scope === "temporary"
              ? "install"
              : await this.missingAction(source, scope);
        if (action === "skip") {
          problems.push({
            level: "warning",
            code: "missing",
            message: `${source} is configured but not installed`,
            source,
          });
          continue;
        }
        if (action === "error") {
          problems.push({
            level: "error",
            code: parsed.type === "local" ? "missing_path" : "missing",
            message: `${source} is not installed at ${path}`,
            source,
          });
          continue;
        }
        try {
          path = (await this.fetch(source, { scope, signal: options.signal }))
            .path;
        } catch (error) {
          problems.push(problemFrom(error, source));
          continue;
        }
      }

      const read = await this.readPlugins(
        path,
        source,
        problems,
        options.signal,
      );
      const filter = typeof entry === "string" ? undefined : entry.plugins;
      for (const { plugin, path: pluginPath } of read?.plugins ?? []) {
        if (filter && !selected(plugin.name, filter)) continue;
        if (reserved.has(plugin.name)) {
          problems.push(reservedProblem(plugin.name, source));
          continue;
        }
        const clash = sourceByName.get(plugin.name);
        if (clash !== undefined) {
          problems.push({
            level: "error",
            code: "name_conflict",
            message: `Plugin "${plugin.name}" from ${source} was not loaded: ${clash} already provides it`,
            source,
            plugin: plugin.name,
          });
          continue;
        }
        plugin.sourceInfo = {
          path: pluginPath,
          source,
          origin: "package",
          scope,
          owner: identity,
        };
        sourceByName.set(plugin.name, source);
        plugins.push(plugin);
      }
    }
    return { plugins, problems };
  }

  /** npm packages carrying the `codemode-plugin` keyword. */
  async search(
    terms: string,
    options: CallOptions & { size?: number } = {},
  ): Promise<SearchResult[]> {
    this.assertOnline("search");
    const doFetch = this.options.fetch ?? globalThis.fetch;
    const registry = (
      this.options.registry ?? "https://registry.npmjs.org"
    ).replace(/\/+$/, "");
    const text = `keywords:codemode-plugin ${terms}`.trim();
    const url = `${registry}/-/v1/search?text=${encodeURIComponent(text)}&size=${options.size ?? 20}`;
    const signal = options.signal
      ? AbortSignal.any([
          options.signal,
          AbortSignal.timeout(NETWORK_TIMEOUT_MS),
        ])
      : AbortSignal.timeout(NETWORK_TIMEOUT_MS);
    let body: {
      objects?: Array<{
        package?: { name?: string; version?: string; description?: string };
      }>;
    };
    try {
      const response = await doFetch(url, {
        signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      body = (await response.json()) as typeof body;
    } catch (error) {
      if (options.signal?.aborted)
        throw new PackageError("aborted", "Package operation aborted");
      throw new PackageError(
        "registry_failed",
        `npm search failed: ${(error as Error).message}`,
        { cause: error },
      );
    }
    return (body.objects ?? [])
      .map((o) => o.package)
      .filter(
        (p): p is { name: string; version: string; description?: string } =>
          typeof p?.name === "string" && typeof p.version === "string",
      )
      .map((p) => ({
        name: p.name,
        version: p.version,
        description: p.description,
        source: `npm:${p.name}`,
      }));
  }

  // ── scopes, roots, trust ───────────────────────────────

  /** Configured scopes, project first so its entries win. */
  private scopes(): PackageScope[] {
    return (["project", "user"] as const).filter((scope) => this.roots[scope]);
  }

  private async trusted(): Promise<boolean> {
    if (!this.roots.project) return false;
    return (await this.options.trust?.(this.roots.project)) === true;
  }

  /** A scope's folder, without asking whether it is trusted. */
  private rootPath(scope: InstallScope): string {
    if (scope === "temporary")
      return resolve(
        this.roots.temporary ?? join(tmpdir(), "codemode-packages"),
      );
    const root = this.roots[scope];
    if (!root)
      throw new PackageError(
        "not_found",
        `No ${scope} folder is configured for packages`,
      );
    return root;
  }

  /** A scope's folder for work that installs, records or removes: project scope must be trusted. */
  private async rootFor(scope: InstallScope): Promise<string> {
    const root = this.rootPath(scope);
    if (scope === "project" && !(await this.trusted()))
      throw new PackageError(
        "untrusted",
        `Project ${root} is not trusted; refusing its packages`,
      );
    return root;
  }

  private identityOf(source: string, root: string): string {
    try {
      return packageIdentity(source, root);
    } catch {
      return `invalid:${source}`;
    }
  }

  private async safeRead(
    scope: PackageScope,
    problems: PackageProblem[],
  ): Promise<PackageEntry[]> {
    try {
      return await this.store.read(scope);
    } catch (error) {
      problems.push(problemFrom(error));
      return [];
    }
  }

  private async configured(source?: string) {
    const out: Array<{
      source: string;
      scope: PackageScope;
      parsed: ParsedSource;
      root: string;
    }> = [];
    let matched = false;
    for (const scope of this.scopes()) {
      let root: string;
      try {
        root = await this.rootFor(scope);
      } catch (error) {
        if (isPackageError(error) && error.code === "untrusted") continue;
        throw error;
      }
      const wanted = source ? this.identityOf(source, root) : undefined;
      for (const entry of await this.store.read(scope)) {
        const s = entrySource(entry);
        if (wanted && this.identityOf(s, root) !== wanted) continue;
        matched = true;
        out.push({ source: s, scope, parsed: parseSource(s), root });
      }
    }
    if (source && !matched)
      throw new PackageError(
        "not_found",
        `No configured package matches ${source}`,
        { source },
      );
    return out;
  }

  private reservedNames(): Set<string> {
    this.reserved ??= new Set(
      this.options.reservedNames ?? bundledPluginNames(),
    );
    return this.reserved;
  }

  private async missingAction(
    source: string,
    scope: InstallScope,
  ): Promise<MissingAction> {
    const onMissing = this.options.onMissing ?? "skip";
    if (this.options.offline) return onMissing === "error" ? "error" : "skip";
    return typeof onMissing === "function"
      ? onMissing(source, scope)
      : onMissing;
  }

  /**
   * A packaged plugin declares its own name: its file's would make two
   * packages' index.js the same plugin.
   */
  private loadPlugin(path: string): Promise<PluginDef> {
    return this.options.loadPlugin
      ? this.options.loadPlugin(path)
      : loadPluginFromPath(path, { defaultName: null });
  }

  /** Whether a package's files are on disk at the version or ref it is configured at. */
  private installed(parsed: ParsedSource, path: string): boolean {
    if (!existsSync(path)) return false;
    if (parsed.type === "npm" && parsed.range) {
      const version = readVersion(path);
      return version !== undefined && satisfies(version, parsed.range);
    }
    if (parsed.type === "git") return !existsSync(this.gitMarker(path));
    return true;
  }

  /**
   * A package's usable plugins: its manifest's modules, loaded, each with a
   * name and at least one action. Everything else becomes a problem. Both
   * `inspect` and `load` read packages through this, so they never disagree.
   */
  private async readPlugins(
    root: string,
    source: string,
    problems: PackageProblem[],
    signal?: AbortSignal,
  ): Promise<
    | {
        name?: string;
        version?: string;
        plugins: Array<{ plugin: PluginDef; path: string }>;
      }
    | undefined
  > {
    let manifest: PackageManifest;
    try {
      manifest = readPackageManifest(root, source);
    } catch (error) {
      problems.push(problemFrom(error, source));
      return undefined;
    }
    for (const module of manifest.bundledHostModules)
      problems.push(this.hostModuleProblem(source, module));
    for (const peer of manifest.unsatisfiedPeers)
      problems.push({
        level: "warning",
        code: "peer_unsatisfied",
        message: `${source} needs ${peer.module} ${peer.range}; this is ${peer.module} ${peer.version}`,
        source,
      });
    const plugins: Array<{ plugin: PluginDef; path: string }> = [];
    for (const path of manifest.pluginPaths) {
      assertNotAborted(signal);
      const shown = relative(root, path) || path;
      let plugin: PluginDef;
      try {
        plugin = await this.loadPlugin(path);
      } catch (error) {
        problems.push({
          level: "error",
          code: "load_failed",
          message: `Failed to load ${shown}: ${(error as Error).message}`,
          source,
        });
        continue;
      }
      if (plugin.actions.length === 0) {
        problems.push({
          level: "error",
          code: "load_failed",
          message: `${shown} registers no actions; it is not a codemode plugin`,
          source,
        });
        continue;
      }
      plugins.push({ plugin, path });
    }
    return { name: manifest.name, version: manifest.version, plugins };
  }

  private hostModuleProblem(source: string, module: string): PackageProblem {
    return {
      level: "warning",
      code: "bundled_host_module",
      message: `${source} lists "${module}" in dependencies; codemode supplies it, so list it in peerDependencies with "*"`,
      source,
    };
  }

  private assertOnline(source: string): void {
    if (this.options.offline)
      throw new PackageError(
        "offline",
        "Package manager is offline; no network step runs",
        { source },
      );
  }

  private async withEvents(
    action: PackageAction,
    source: string,
    message: string,
    work: () => Promise<void>,
  ): Promise<void> {
    this.options.onEvent?.({ type: "start", action, source, message });
    try {
      await work();
      this.options.onEvent?.({ type: "complete", action, source });
    } catch (error) {
      this.options.onEvent?.({
        type: "error",
        action,
        source,
        message: (error as Error).message,
      });
      throw error;
    }
  }

  /** One writer per root, across processes. */
  private async withLock<T>(
    root: string,
    signal: AbortSignal | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    assertNotAborted(signal);
    const dir = join(root, "packages");
    mkdirSync(dir, { recursive: true });
    let compromised: Error | undefined;
    const release = await lockfile.lock(dir, {
      realpath: false,
      stale: 60_000,
      update: 10_000,
      retries: { retries: 60, factor: 1.2, minTimeout: 200, maxTimeout: 5_000 },
      // proper-lockfile throws from a timer otherwise, outside any caller.
      onCompromised: (error) => {
        compromised = error;
      },
    });
    try {
      const result = await work();
      if (compromised) throw compromised;
      return result;
    } finally {
      await release().catch(() => {});
    }
  }

  // ── paths ──────────────────────────────────────────────

  private managed(root: string, ...parts: string[]): string {
    const base = resolve(root, "packages");
    const path = resolve(base, ...parts);
    if (path !== base && !path.startsWith(`${base}${sep}`))
      throw new PackageError(
        "unsafe_path",
        `Refusing a path outside ${base}: ${path}`,
      );
    return path;
  }

  private npmRoot(root: string): string {
    return this.managed(root, "npm");
  }

  private installPath(
    parsed: ParsedSource,
    root: string,
    scope: InstallScope,
  ): string {
    if (parsed.type === "local") return resolveLocalPath(parsed.path, root);
    if (parsed.type === "npm") {
      return this.managed(
        root,
        "npm",
        "node_modules",
        ...parsed.name.split("/"),
      );
    }
    // A temporary checkout is per ref, so two refs of one repo never share a folder.
    const perRef =
      scope === "temporary"
        ? [
            createHash("sha256")
              .update(`${parsed.repo}@${parsed.ref ?? ""}`)
              .digest("hex")
              .slice(0, 12),
          ]
        : [];
    return this.managed(
      root,
      "git",
      ...perRef,
      parsed.host || "file",
      ...parsed.path.split("/"),
    );
  }

  private gitMarker(path: string): string {
    return join(dirname(path), `.${basename(path)}.codemode-update-incomplete`);
  }

  // ── npm ────────────────────────────────────────────────

  private ensureNpmRoot(npmRoot: string): void {
    mkdirSync(npmRoot, { recursive: true });
    const pkg = join(npmRoot, "package.json");
    if (!existsSync(pkg))
      writeFileSync(
        pkg,
        `${JSON.stringify({ name: "codemode-packages", private: true }, null, 2)}\n`,
      );
    const ignore = join(npmRoot, ".gitignore");
    if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  }

  /**
   * Saved exact: every package shares one npm root, so a range recorded there
   * would let installing one package move another. Moving is `update`'s job.
   */
  private npmInstallArgs(spec: string, npmRoot: string): string[] {
    switch (this.pm) {
      case "bun":
        return [
          "add",
          spec,
          "--cwd",
          npmRoot,
          "--exact",
          "--omit=peer",
          "--ignore-scripts",
        ];
      case "pnpm":
        return [
          "add",
          spec,
          "--dir",
          npmRoot,
          "--save-exact",
          "--ignore-scripts",
          "--config.auto-install-peers=false",
          "--config.strict-peer-dependencies=false",
        ];
      default:
        return [
          "install",
          spec,
          "--prefix",
          npmRoot,
          "--save-exact",
          "--legacy-peer-deps",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
        ];
    }
  }

  private dependencyInstallArgs(): string[] {
    switch (this.pm) {
      case "bun":
        return ["install", "--production", "--omit=peer", "--ignore-scripts"];
      case "pnpm":
        return [
          "install",
          "--prod",
          "--ignore-scripts",
          "--config.auto-install-peers=false",
          "--config.strict-peer-dependencies=false",
        ];
      default:
        return [
          "install",
          "--omit=dev",
          "--legacy-peer-deps",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
        ];
    }
  }

  private async installNpm(
    source: NpmSource,
    root: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const npmRoot = this.npmRoot(root);
    this.ensureNpmRoot(npmRoot);
    await this.run(this.pm, this.npmInstallArgs(source.spec, npmRoot), {
      signal,
      source: source.spec,
    });
    if (!existsSync(join(npmRoot, "node_modules", source.name)))
      throw new PackageError(
        "install_failed",
        `${this.pm} finished but ${source.name} is not installed`,
        { source: source.spec },
      );
  }

  /**
   * Whether the registry has a version newer than `installed` inside the
   * source's range. A failed lookup counts as yes, so an unreachable
   * registry surfaces from the install that follows.
   */
  private async npmHasNewer(
    source: NpmSource,
    installed: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    try {
      const latest = await this.npmLatest(source, signal);
      return latest === undefined || gt(latest, installed);
    } catch (error) {
      if (isPackageError(error) && error.code === "aborted") throw error;
      return true;
    }
  }

  /** The newest published version the source's range (or dist-tag) allows. */
  private async npmLatest(
    source: NpmSource,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const spec = source.version
      ? `${source.name}@${source.version}`
      : `${source.name}@latest`;
    // bun has no `view`; npm reads the same registry.
    const pm = this.pm === "pnpm" ? "pnpm" : "npm";
    const result = await this.run(pm, ["view", spec, "version", "--json"], {
      signal,
      source: spec,
      timeoutMs: NETWORK_TIMEOUT_MS,
    });
    const parsed = JSON.parse(result.stdout || "null") as
      | string
      | string[]
      | null;
    if (!Array.isArray(parsed)) return parsed ?? undefined;
    const versions = parsed.filter((v) => typeof v === "string");
    return (
      (source.range
        ? maxSatisfying(versions, source.range)
        : [...versions].sort(rcompare)[0]) ?? undefined
    );
  }

  // ── git ────────────────────────────────────────────────

  /** git with the `ext::` transport and repository hooks off. */
  private git(
    args: string[],
    cwd: string | undefined,
    signal: AbortSignal | undefined,
    source: string,
    timeoutMs?: number,
  ): Promise<CommandResult> {
    return this.run(
      "git",
      [
        "-c",
        "protocol.ext.allow=never",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ],
      { cwd, signal, source, timeoutMs },
    );
  }

  private async installGit(
    source: GitSource,
    root: string,
    scope: InstallScope,
    signal?: AbortSignal,
  ): Promise<void> {
    const target = this.installPath(source, root, scope);
    if (existsSync(join(target, ".git"))) {
      await this.syncGit(target, source, signal);
      return;
    }
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    const gitRoot = this.managed(root, "git");
    if (!existsSync(join(gitRoot, ".gitignore")))
      writeFileSync(join(gitRoot, ".gitignore"), "*\n");
    try {
      await this.git(
        ["clone", "--", source.repo, target],
        undefined,
        signal,
        source.repo,
      );
      if (source.ref)
        await this.git(
          ["-c", "advice.detachedHead=false", "checkout", source.ref, "--"],
          target,
          signal,
          source.repo,
        );
      await this.installGitDependencies(target, signal, source.repo);
    } catch (error) {
      rmSync(target, { recursive: true, force: true });
      this.pruneEmpty(dirname(target), gitRoot);
      throw error;
    }
  }

  private async syncGit(
    target: string,
    source: GitSource,
    signal?: AbortSignal,
  ): Promise<void> {
    // With no ref, follow the branch the checkout tracks, or the remote's
    // default branch (a checkout that was on a tag tracks nothing).
    const ref =
      source.ref ?? (await this.trackedBranch(target, signal, source.repo));
    await this.git(["fetch", "origin", "--", ref], target, signal, source.repo);
    const head = await this.gitHead(target);
    const wanted = (
      await this.git(
        ["rev-parse", "FETCH_HEAD^{commit}"],
        target,
        signal,
        source.repo,
      )
    ).stdout.trim();
    const marker = this.gitMarker(target);
    if (head === wanted && !existsSync(marker)) {
      if (this.missingDependencies(target))
        await this.installGitDependencies(target, signal, source.repo);
      return;
    }
    writeFileSync(marker, "");
    await this.git(["reset", "--hard", wanted], target, signal, source.repo);
    await this.git(["clean", "-fdx"], target, signal, source.repo);
    await this.installGitDependencies(target, signal, source.repo);
    rmSync(marker, { force: true });
  }

  private async trackedBranch(
    target: string,
    signal: AbortSignal | undefined,
    repo: string,
  ): Promise<string> {
    const upstream = (
      await this.git(
        ["rev-parse", "--abbrev-ref", "@{upstream}"],
        target,
        signal,
        repo,
      ).catch(() => undefined)
    )?.stdout.trim();
    if (upstream?.startsWith("origin/"))
      return upstream.slice("origin/".length);
    const symref = (
      await this.git(
        ["ls-remote", "--symref", "origin", "HEAD"],
        target,
        signal,
        repo,
      )
    ).stdout;
    const match = symref.match(/^ref: refs\/heads\/(\S+)\s+HEAD/m);
    if (!match)
      throw new PackageError(
        "install_failed",
        `Cannot tell which branch ${repo} follows`,
        { source: repo },
      );
    return match[1];
  }

  private async gitHead(path: string): Promise<string | undefined> {
    try {
      return (
        (
          await this.git(["rev-parse", "HEAD"], path, undefined, path)
        ).stdout.trim() || undefined
      );
    } catch {
      return undefined;
    }
  }

  private async gitRemoteHead(
    path: string,
    source: GitSource,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const ref = source.ref ?? "HEAD";
    const out = (
      await this.git(
        ["ls-remote", "--", "origin", ref],
        path,
        signal,
        source.repo,
        NETWORK_TIMEOUT_MS,
      )
    ).stdout;
    const lines = out.trim().split("\n").filter(Boolean);
    // A commit is not advertised by the remote, and never moves.
    if (!lines.length) return undefined;
    const peeled = lines.find((l) => l.endsWith("^{}"));
    return (peeled ?? lines[0]).split(/\s+/)[0];
  }

  private missingDependencies(target: string): boolean {
    return dependencyNames(target).some(
      (name) => !existsSync(join(target, "node_modules", name)),
    );
  }

  private async installGitDependencies(
    target: string,
    signal: AbortSignal | undefined,
    source: string,
  ): Promise<void> {
    if (!dependencyNames(target).length) return;
    await this.run(this.pm, this.dependencyInstallArgs(), {
      cwd: target,
      signal,
      source,
    });
  }

  // ── removal ───────────────────────────────────────────

  private async removeFromDisk(
    parsed: ParsedSource,
    scope: InstallScope,
    signal?: AbortSignal,
  ): Promise<void> {
    if (parsed.type === "local") return;
    const root = await this.rootFor(scope);
    await this.withLock(root, signal, async () => {
      if (parsed.type === "npm") {
        const npmRoot = this.npmRoot(root);
        if (!existsSync(join(npmRoot, "node_modules", parsed.name))) return;
        const args =
          this.pm === "bun"
            ? ["remove", parsed.name, "--cwd", npmRoot]
            : this.pm === "pnpm"
              ? ["remove", parsed.name, "--dir", npmRoot]
              : [
                  "uninstall",
                  parsed.name,
                  "--prefix",
                  npmRoot,
                  "--legacy-peer-deps",
                  "--ignore-scripts",
                  "--no-audit",
                  "--no-fund",
                ];
        await this.run(this.pm, args, { signal, source: parsed.spec });
        return;
      }
      const target = this.installPath(parsed, root, scope);
      rmSync(target, { recursive: true, force: true });
      rmSync(this.gitMarker(target), { force: true });
      this.pruneEmpty(dirname(target), this.managed(root, "git"));
    });
  }

  private pruneEmpty(from: string, stop: string): void {
    let current = from;
    while (current.startsWith(`${stop}${sep}`)) {
      try {
        if (readdirSync(current).length) return;
        rmSync(current, { recursive: true, force: true });
      } catch {
        return;
      }
      current = dirname(current);
    }
  }

  // ── commands ──────────────────────────────────────────

  private async run(
    command: string,
    args: string[],
    options: {
      cwd?: string;
      signal?: AbortSignal;
      source: string;
      timeoutMs?: number;
    },
  ): Promise<CommandResult> {
    assertNotAborted(options.signal);
    let result: CommandResult;
    try {
      result = await this.runner.run(command, args, {
        cwd: options.cwd,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
      });
    } catch (error) {
      if (options.signal?.aborted)
        throw new PackageError("aborted", "Package operation aborted", {
          source: options.source,
        });
      throw new PackageError(
        "install_failed",
        `Could not run ${command}: ${(error as Error).message}`,
        {
          source: options.source,
          cause: error,
        },
      );
    }
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout)
        .trim()
        .split("\n")
        .slice(-5)
        .join("\n");
      const verb = args.find(
        (a, i) => !a.startsWith("-") && args[i - 1] !== "-c",
      );
      throw new PackageError(
        "install_failed",
        `${[command, verb].filter(Boolean).join(" ")} failed (exit ${result.code})${detail ? `: ${detail}` : ""}`,
        {
          source: options.source,
        },
      );
    }
    return result;
  }
}

/**
 * A temporary local source has no config file to be relative to, so it must
 * be absolute (or start at `~`); the caller resolves what its user typed.
 */
function assertUsableTemporary(
  parsed: ParsedSource,
  scope: InstallScope,
  source: string,
): void {
  if (
    scope === "temporary" &&
    parsed.type === "local" &&
    !isAbsolute(parsed.path) &&
    parsed.path !== "~" &&
    !parsed.path.startsWith("~/")
  )
    throw new PackageError(
      "invalid_source",
      `A temporary local source must be an absolute path: ${source}`,
      { source },
    );
}

function selected(name: string, filter: string[]): boolean {
  const excludes = filter
    .filter((f) => f.startsWith("!"))
    .map((f) => f.slice(1));
  const includes = filter.filter((f) => !f.startsWith("!"));
  if (excludes.includes(name)) return false;
  return includes.length === 0 || includes.includes(name);
}

function problemFrom(error: unknown, source?: string): PackageProblem {
  if (isPackageError(error))
    return {
      level: "error",
      code: error.code,
      message: error.message,
      source: source ?? error.source,
    };
  return {
    level: "error",
    code: "load_failed",
    message: (error as Error)?.message ?? String(error),
    source,
  };
}

function reservedProblem(plugin: string, source: string): PackageProblem {
  return {
    level: "error",
    code: "name_reserved",
    message: `Plugin "${plugin}" from ${source} has the name of a bundled plugin and is not loaded`,
    source,
    plugin,
  };
}

function reportPlugin(plugin: PluginDef): PluginReport {
  const access = plugin.actions.map((a) => a.access);
  const report: PluginReport = {
    name: plugin.name,
    version: plugin.version,
    actions: plugin.actions.length,
    read: access.filter((a) => a === "read").length,
    write: access.filter((a) => a === "write").length,
    unspecified: access.filter((a) => a === undefined).length,
  };
  if (plugin.credential) {
    try {
      // Declarations that need connection config to choose targets throw on {}.
      const selection = plugin.credential({});
      const targets = selection.type.methods[selection.method]?.targets ?? {};
      report.credential = {
        type: selection.type.id,
        method: selection.method,
        targets: Object.values(targets).map((t) => t.baseUrl),
      };
    } catch {
      report.credentialNote =
        "Declares a credential whose targets depend on the connection's config";
    }
  }
  return report;
}
