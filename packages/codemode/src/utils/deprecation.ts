/**
 * Codemode was called runline through 0.45. Until `LEGACY_NAMES_REMOVED_IN`
 * the runline names keep working: the `.runline` folders, the `RUNLINE_*`
 * environment variables, the `runline` key in a package.json and the
 * `runline` module name in a plugin's imports. Each is reported once per
 * process when it is used, with the name that replaces it.
 */
export const LEGACY_NAMES_REMOVED_IN = "0.48.0";

const reported = new Set<string>();

/** Report one use of a runline name, once per process. */
export function legacyName(old: string, replacement: string): void {
  if (reported.has(old)) return;
  reported.add(old);
  console.error(
    `[codemode] ${old} is a runline name and stops working in ${LEGACY_NAMES_REMOVED_IN}: use ${replacement}`,
  );
}

/** `CODEMODE_<name>`, else `RUNLINE_<name>` with a report. */
export function environment(name: string): string | undefined {
  const value = process.env[`CODEMODE_${name}`];
  if (value !== undefined) return value;
  const legacy = process.env[`RUNLINE_${name}`];
  if (legacy !== undefined) legacyName(`RUNLINE_${name}`, `CODEMODE_${name}`);
  return legacy;
}
