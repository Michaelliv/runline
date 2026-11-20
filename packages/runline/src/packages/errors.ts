export type PackageErrorCode =
  /** The source string names no npm, git or local package runline can use. */
  | "invalid_source"
  /** No configured package matches the source. */
  | "not_found"
  /** A local source's path does not exist. */
  | "missing_path"
  /** npm or git exited non-zero, or could not be started. */
  | "install_failed"
  /** The package's manifest is unreadable or names paths outside the package. */
  | "invalid_manifest"
  /** A plugin in the package failed to load. */
  | "load_failed"
  /** A packaged plugin declares the name of a bundled plugin. */
  | "name_reserved"
  /** Two packages declare a plugin with the same name. */
  | "name_conflict"
  /** Project-scope work was refused by the trust policy. */
  | "untrusted"
  /** The host runs offline, or refused to run a command. */
  | "offline"
  /** The operation was aborted through its signal. */
  | "aborted"
  /** A managed path resolved outside its root. */
  | "unsafe_path";

/**
 * Every failure the package manager raises. Hosts branch on `code`;
 * `message` is for people and may name the source, never a secret.
 */
export class PackageError extends Error {
  readonly code: PackageErrorCode;
  readonly source?: string;

  constructor(
    code: PackageErrorCode,
    message: string,
    options: { source?: string; cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "PackageError";
    this.code = code;
    this.source = options.source;
  }
}

export function isPackageError(error: unknown): error is PackageError {
  return error instanceof PackageError;
}
