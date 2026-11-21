import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import {
  findConfigDir,
  loadConfigFrom,
  userConfigDir,
} from "../config/loader.js";
import { isProjectTrusted, setProjectTrusted } from "../config/trust.js";
import { isPackageError } from "../packages/errors.js";
import {
  type MissingAction,
  PackageManager,
  type PackageManagerName,
  type PackageReport,
  type StagedPackage,
} from "../packages/manager.js";
import { parseSource } from "../packages/source.js";
import type { PackageScope } from "../packages/store.js";
import {
  printError,
  printJson,
  printSuccess,
  printWarn,
} from "../utils/output.js";

/** `RUNLINE_PACKAGE_MANAGER`, else `packageManager` in the user's config. */
function configuredPackageManager(): PackageManagerName | undefined {
  let value: unknown = process.env.RUNLINE_PACKAGE_MANAGER;
  if (!value) {
    try {
      value = loadConfigFrom(
        join(userConfigDir(), "config.json"),
      ).packageManager;
    } catch {}
  }
  return value === "npm" || value === "pnpm" || value === "bun"
    ? value
    : undefined;
}

/**
 * The package manager the CLI uses: `~/.runline` for user scope, the nearest
 * project `.runline` for project scope (trusted through `runline trust`),
 * entries in each folder's config.json.
 */
export function cliPackageManager(
  options: {
    quiet?: boolean;
    trustProject?: boolean;
    /** A configured package missing on disk. Default: install it. */
    onMissing?: MissingAction;
  } = {},
): PackageManager {
  return PackageManager.forRunlineFolders({
    roots: { user: userConfigDir(), project: findConfigDir() ?? undefined },
    packageManager: configuredPackageManager(),
    trust: (root) => options.trustProject === true || isProjectTrusted(root),
    onMissing: options.onMissing ?? "install",
    offline: process.env.RUNLINE_OFFLINE === "1",
    onEvent: options.quiet
      ? undefined
      : (event) => {
          if (event.type === "start")
            console.error(chalk.dim(`${event.message}…`));
        },
  });
}

/**
 * `-e` sources as the person typed them, with local paths made absolute
 * against the working directory: the library takes no relative temporary path.
 */
export function temporarySources(sources: string[] | undefined): string[] {
  return (sources ?? []).map((source) =>
    parseSource(source).type === "local" ? resolve(source) : source,
  );
}

function scopeOf(options: { local?: boolean }): PackageScope {
  return options.local ? "project" : "user";
}

function fail(err: unknown, json?: boolean, report?: PackageReport): never {
  const message = err instanceof Error ? err.message : String(err);
  if (json)
    printJson({
      ok: false,
      error: message,
      code: isPackageError(err) ? err.code : undefined,
      ...(report ? { report } : {}),
    });
  else printError(message);
  process.exit(1);
}

function printReport(report: PackageReport): void {
  const where = report.version
    ? `${report.name ?? report.source} ${report.version}`
    : (report.name ?? report.source);
  console.log(
    `${chalk.bold(where)}  ${chalk.dim(`(${report.source}, install scripts not run)`)}`,
  );
  for (const plugin of report.plugins) {
    const access = [
      plugin.read ? `${plugin.read} read` : "",
      plugin.write ? `${plugin.write} write` : "",
      plugin.unspecified ? `${plugin.unspecified} unmarked` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    console.log(
      `  ${chalk.bold(plugin.name.padEnd(16))} ${plugin.actions} action(s)  ${chalk.dim(access)}`,
    );
    if (plugin.credential)
      console.log(
        `  ${"".padEnd(16)} credential ${plugin.credential.type}/${plugin.credential.method} → ${plugin.credential.targets.join(", ") || "no targets"}`,
      );
    else if (plugin.credentialNote)
      console.log(`  ${"".padEnd(16)} ${chalk.dim(plugin.credentialNote)}`);
  }
  for (const problem of report.problems)
    (problem.level === "error" ? printError : printWarn)(problem.message);
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

export async function packageInstall(
  source: string,
  options: { local?: boolean; yes?: boolean; json?: boolean; quiet?: boolean },
): Promise<void> {
  const scope = scopeOf(options);
  const project = findConfigDir();
  if (scope === "project" && !project)
    fail(
      new Error(
        "No .runline folder here: run `runline init`, or install without --local",
      ),
      options.json,
    );
  // Installing into a project is the person's explicit decision to trust it.
  const pm = cliPackageManager({
    quiet: options.quiet || options.json,
    trustProject: scope === "project",
  });
  let staged: StagedPackage | undefined;
  let report: PackageReport | undefined;
  try {
    staged = await pm.fetch(source, { scope });
    report = await pm.inspect(staged);
    if (!options.json) printReport(report);
    const firstError = report.problems.find((p) => p.level === "error");
    if (firstError) {
      await pm.discard(staged);
      fail(
        new Error(`${source} was not installed: ${firstError.message}`),
        options.json,
        report,
      );
    }
    if (!options.yes) {
      if (!process.stdin.isTTY || options.json) {
        await pm.discard(staged);
        fail(
          new Error("Pass --yes to install without a prompt"),
          options.json,
          report,
        );
      }
      if (!(await confirm("Install? [y/N] "))) {
        await pm.discard(staged);
        console.log("Not installed.");
        return;
      }
    }
    await pm.commit(staged);
    if (scope === "project" && project) setProjectTrusted(project, true);
    if (options.json) printJson({ ok: true, scope, ...report });
    else
      printSuccess(`Installed ${chalk.bold(report.name ?? source)} (${scope})`);
  } catch (err) {
    if (staged) await pm.discard(staged).catch(() => {});
    fail(err, options.json, report);
  }
}

export async function packageRemove(
  source: string,
  options: { local?: boolean; json?: boolean; quiet?: boolean },
): Promise<void> {
  const scope = scopeOf(options);
  const pm = cliPackageManager({
    quiet: options.quiet || options.json,
    trustProject: scope === "project",
  });
  try {
    const removed = await pm.remove(source, { scope });
    if (!removed)
      fail(new Error(`No ${scope} package matches ${source}`), options.json);
    if (options.json) printJson({ ok: true, removed: source, scope });
    else printSuccess(`Removed ${chalk.bold(source)} (${scope})`);
  } catch (err) {
    fail(err, options.json);
  }
}

export async function packageUpdate(
  source: string | undefined,
  options: { json?: boolean; quiet?: boolean },
): Promise<void> {
  const pm = cliPackageManager({ quiet: options.quiet || options.json });
  try {
    const results = await pm.update(source);
    if (options.json) return printJson(results);
    if (!results.length) return console.log("No packages to update.");
    for (const r of results)
      console.log(
        `  ${chalk.bold(r.source)} ${r.changed ? `${r.from ?? "—"} → ${r.to ?? "—"}` : chalk.dim(`up to date (${r.to ?? "—"})`)}`,
      );
  } catch (err) {
    fail(err, options.json);
  }
}

export async function packageList(options: {
  json?: boolean;
  outdated?: boolean;
}): Promise<void> {
  const pm = cliPackageManager({ quiet: true });
  try {
    if (options.outdated) {
      const updates = await pm.checkUpdates();
      if (options.json) return printJson(updates);
      if (!updates.length) return console.log("All packages are up to date.");
      for (const u of updates)
        console.log(
          `  ${chalk.bold(u.source)} ${u.installed ?? "—"} → ${u.latest} ${chalk.dim(`(${u.scope})`)}`,
        );
      return;
    }
    const packages = await pm.list();
    if (options.json) return printJson(packages);
    if (!packages.length) return console.log("No packages configured.");
    for (const p of packages) {
      const state = p.installedPath
        ? (p.version ?? "installed")
        : chalk.yellow("not installed");
      console.log(
        `  ${chalk.bold(p.source)} ${state} ${chalk.dim(`(${p.scope})`)}`,
      );
    }
  } catch (err) {
    fail(err, options.json);
  }
}

export async function packageSearch(
  terms: string,
  options: { json?: boolean },
): Promise<void> {
  const pm = cliPackageManager({ quiet: true });
  try {
    const results = await pm.search(terms);
    if (options.json) return printJson(results);
    if (!results.length)
      return console.log("No runline-plugin packages found.");
    for (const r of results)
      console.log(
        `  ${chalk.bold(r.source)} ${r.version}  ${chalk.dim(r.description ?? "")}`,
      );
  } catch (err) {
    fail(err, options.json);
  }
}

export async function packageTrust(
  dir: string | undefined,
  options: { revoke?: boolean; json?: boolean },
): Promise<void> {
  // Trust is recorded for a project's .runline folder.
  const target = dir
    ? basename(resolve(dir)) === ".runline"
      ? resolve(dir)
      : join(resolve(dir), ".runline")
    : findConfigDir();
  if (!target || !existsSync(target))
    fail(new Error("No .runline folder to trust here"), options.json);
  const path = resolve(target);
  if (path === resolve(userConfigDir()))
    fail(
      new Error(`${path} is your own folder: its plugins always load`),
      options.json,
    );
  setProjectTrusted(path, !options.revoke);
  if (options.json) printJson({ ok: true, path, trusted: !options.revoke });
  else
    printSuccess(
      `${options.revoke ? "No longer trusting" : "Trusting"} ${path}`,
    );
}
