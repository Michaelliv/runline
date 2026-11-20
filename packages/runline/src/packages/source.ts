import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { valid, validRange } from "semver";
import { PackageError } from "./errors.js";

export interface NpmSource {
  type: "npm";
  /** What npm is asked for: `name` or `name@version`. */
  spec: string;
  name: string;
  /** Version, range or dist-tag after the `@`, when given. */
  version?: string;
  /** `version` as a semver range; undefined for a dist-tag or no version. */
  range?: string;
  /** An exact version: `update` leaves it where it is. */
  pinned: boolean;
}

export interface GitSource {
  type: "git";
  /** The URL handed to `git clone`, without the ref. */
  repo: string;
  /** Host for identity and the install path; `""` for `file://` repositories. */
  host: string;
  /** Repository path for identity and the install path. */
  path: string;
  /** Branch, tag or commit after the `@`, when given. */
  ref?: string;
}

export interface LocalSource {
  type: "local";
  /** The path as written; resolved against the config that names it. */
  path: string;
}

export type ParsedSource = NpmSource | GitSource | LocalSource;

/** npm's name rules, minus a leading dash: npm would read one as an option. */
const NPM_NAME = /^(?:@[a-z0-9~][a-z0-9-._~]*\/)?[a-z0-9~][a-z0-9-._~]*$/;
/** Characters git accepts in ref names we pass on; never a leading dash. */
const SAFE_REF = /^[A-Za-z0-9._/][A-Za-z0-9._/+-]*$/;

export function isExactVersion(version: string | undefined): boolean {
  return valid(version ?? "") !== null;
}

function parseNpm(source: string): NpmSource {
  const spec = source.slice("npm:".length).trim();
  const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
  const name = match?.[1];
  const version = match?.[2];
  if (
    !name ||
    !NPM_NAME.test(name) ||
    (version !== undefined && /\s|^-/.test(version))
  ) {
    throw new PackageError("invalid_source", `Not an npm package: ${source}`, {
      source,
    });
  }
  return {
    type: "npm",
    spec: version ? `${name}@${version}` : name,
    name,
    version,
    ...(version && validRange(version)
      ? { range: validRange(version) as string }
      : {}),
    pinned: isExactVersion(version),
  };
}

function unsafePart(value: string, allowSlash: boolean): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return true;
  }
  for (const candidate of [value, decoded]) {
    if (
      candidate.includes("\0") ||
      candidate.includes("\\") ||
      candidate.startsWith("/") ||
      candidate.startsWith("-") ||
      (!allowSlash && candidate.includes("/")) ||
      candidate.split("/").some((part) => part === ".." || part === ".")
    )
      return true;
  }
  return false;
}

/** `repo@ref`: the ref is after the last `@` of the path, never in the host. */
function splitRef(url: string): { repo: string; ref?: string } {
  const scp = url.match(/^git@([^:]+):(.+)$/);
  if (scp) {
    const at = scp[2].lastIndexOf("@");
    if (at <= 0) return { repo: url };
    return {
      repo: `git@${scp[1]}:${scp[2].slice(0, at)}`,
      ref: scp[2].slice(at + 1),
    };
  }
  if (url.includes("://")) {
    const schemeEnd = url.indexOf("://") + 3;
    const pathStart = url.indexOf("/", schemeEnd);
    if (pathStart < 0) return { repo: url };
    const at = url.lastIndexOf("@");
    if (at <= pathStart) return { repo: url };
    return { repo: url.slice(0, at), ref: url.slice(at + 1) };
  }
  const slash = url.indexOf("/");
  const at = url.lastIndexOf("@");
  if (slash < 0 || at <= slash) return { repo: url };
  return { repo: url.slice(0, at), ref: url.slice(at + 1) };
}

function parseGit(source: string): GitSource | null {
  const trimmed = source.trim();
  const prefixed = trimmed.startsWith("git:") && !trimmed.startsWith("git://");
  const url = prefixed ? trimmed.slice(4).trim() : trimmed;
  if (!prefixed && !/^(https?|ssh|git|file):\/\//i.test(url)) return null;

  const { repo: bare, ref } = splitRef(url);
  if (ref !== undefined && !SAFE_REF.test(ref)) return null;

  let repo = bare;
  let host: string;
  let path: string;
  const scp = bare.match(/^git@([^:]+):(.+)$/);
  if (scp) {
    host = scp[1];
    path = scp[2];
  } else if (/^file:\/\//i.test(bare)) {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(bare).pathname);
    } catch {
      return null;
    }
    if (!pathname.startsWith("/") || pathname.split("/").includes(".."))
      return null;
    return {
      type: "git",
      repo: bare,
      host: "",
      path: pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, ""),
      ref,
    };
  } else if (/^(https?|ssh|git):\/\//i.test(bare)) {
    try {
      const parsed = new URL(bare);
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      return null;
    }
  } else {
    const slash = bare.indexOf("/");
    if (slash < 0) return null;
    host = bare.slice(0, slash);
    path = bare.slice(slash + 1);
    if (!host.includes(".") && host !== "localhost") return null;
    repo = `https://${bare}`;
  }

  path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  if (
    !host ||
    path.split("/").length < 2 ||
    unsafePart(host, false) ||
    unsafePart(path, true) ||
    repo.startsWith("-")
  )
    return null;
  return { type: "git", repo, host, path, ref };
}

/**
 * Parse a package source: `npm:<name>[@<version>]`, `git:<host>/<path>[@<ref>]`,
 * an `https://`, `ssh://`, `git://` or `file://` repository URL, or a local path.
 * Throws `PackageError("invalid_source")` for an npm or git source it cannot use.
 */
export function parseSource(source: string): ParsedSource {
  const trimmed = source.trim();
  if (!trimmed)
    throw new PackageError("invalid_source", "Empty package source");
  if (trimmed.startsWith("npm:")) return parseNpm(trimmed);
  const looksGit =
    (trimmed.startsWith("git:") && !trimmed.startsWith("git://")) ||
    /^(https?|ssh|git|file):\/\//i.test(trimmed);
  if (looksGit) {
    const git = parseGit(trimmed);
    if (!git)
      throw new PackageError(
        "invalid_source",
        `Not a usable git source: ${source}`,
        {
          source,
        },
      );
    return git;
  }
  return { type: "local", path: trimmed };
}

/** Resolve a local path as written in a config whose relative paths start at `baseDir`. */
export function resolveLocalPath(path: string, baseDir: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return isAbsolute(path) ? resolve(path) : resolve(baseDir, path);
}

/**
 * What makes two sources the same package: npm by name, git by host and path
 * (the ref is not part of it, and SSH and HTTPS agree), local by absolute path.
 */
export function packageIdentity(
  source: string | ParsedSource,
  baseDir: string,
): string {
  const parsed = typeof source === "string" ? parseSource(source) : source;
  switch (parsed.type) {
    case "npm":
      return `npm:${parsed.name}`;
    case "git":
      return `git:${parsed.host ? `${parsed.host}/` : "file:/"}${parsed.path}`;
    case "local":
      return `local:${resolveLocalPath(parsed.path, baseDir)}`;
  }
}
