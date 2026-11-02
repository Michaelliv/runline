#!/usr/bin/env bun
/**
 * Lint the `access` label on every bundled plugin action.
 *
 * Hosts gate actions on `access`: a `read` action may run where writes
 * are refused, so a mislabelled mutation is a permission hole. Two rules:
 *
 * 1. Every action declares `access: "read"` or `access: "write"`.
 * 2. An action whose verb mutates is `write`. The verb is the leading
 *    word of the action name's last segment (`record.createMany` →
 *    `create`), so a noun like `order.get` or `release.list` is not
 *    mistaken for one.
 *
 * Labelling a read-shaped action `write` is always allowed: that is the
 * conservative call for a POST-backed render, a query that may mutate, or
 * a download that writes to disk.
 *
 * It loads the plugins rather than parsing them, so actions registered
 * through helpers and loops are checked as the host sees them.
 *
 *   bun scripts/lint-plugin-access.ts
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadPluginFromPath } from "../packages/runline/src/plugin/loader.ts";

const PLUGINS_DIR = join(import.meta.dir, "../packages/runline-plugins");

const MUTATING_VERBS = new Set([
  "add",
  "append",
  "approve",
  "archive",
  "assign",
  "cancel",
  "close",
  "copy",
  "create",
  "delete",
  "disable",
  "edit",
  "enable",
  "forward",
  "grant",
  "insert",
  "install",
  "invite",
  "leave",
  "mark",
  "merge",
  "move",
  "post",
  "publish",
  "push",
  "reject",
  "remove",
  "rename",
  "reopen",
  "replace",
  "reply",
  "restart",
  "restore",
  "revoke",
  "rotate",
  "send",
  "set",
  "share",
  "start",
  "stop",
  "submit",
  "trash",
  "trigger",
  "unarchive",
  "unassign",
  "uninstall",
  "unpublish",
  "unshare",
  "unsubscribe",
  "untrash",
  "update",
  "upload",
  "upsert",
]);

function verbOf(actionName: string): string {
  const last = actionName.split(".").at(-1) ?? actionName;
  return (last.split(/(?=[A-Z])/)[0] ?? last).toLowerCase();
}

const problems: string[] = [];
let actions = 0;
const dirs = readdirSync(PLUGINS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !/^[_.]/.test(d.name))
  .filter((d) => existsSync(join(PLUGINS_DIR, d.name, "src", "index.ts")))
  .map((d) => d.name)
  .sort();

for (const dir of dirs) {
  let plugin: Awaited<ReturnType<typeof loadPluginFromPath>>;
  try {
    plugin = await loadPluginFromPath(join(PLUGINS_DIR, dir));
  } catch (error) {
    problems.push(`${dir}: does not load (${(error as Error).message})`);
    continue;
  }
  for (const action of plugin.actions) {
    actions++;
    const path = `${plugin.name}.${action.name}`;
    const verb = verbOf(action.name);
    if (action.access !== "read" && action.access !== "write") {
      problems.push(`${path}: declare access "read" or "write"`);
    } else if (action.access === "read" && MUTATING_VERBS.has(verb)) {
      problems.push(`${path}: "${verb}" mutates, so access must be "write"`);
    }
  }
}

if (problems.length > 0) {
  console.error(`plugin access: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`plugin access: ${actions} actions in ${dirs.length} plugins`);
