/**
 * The command line on a project still named `.runline`: what a person who
 * upgraded from runline and has renamed nothing yet runs into. Each case
 * runs the real command in its own process, with its own home folder.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const MAIN = fileURLToPath(new URL("../main.ts", import.meta.url));

describe("the command line on a .runline project", () => {
  let tmp: string;
  let project: string;

  beforeEach(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "codemode-legacy-")));
    project = join(tmp, "project");
    mkdirSync(join(project, ".runline", "plugins"), { recursive: true });
    mkdirSync(join(tmp, "home"));
    writeFileSync(
      join(project, ".runline", "config.json"),
      JSON.stringify({ connections: [] }),
    );
    writeFileSync(
      join(project, ".runline", "plugins", "old.js"),
      `export default function (api) {
        api.setName("old");
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  async function codemode(args: string[], cwd = project) {
    const run = promisify(execFile)(process.execPath, [MAIN, ...args], {
      cwd,
      env: { ...process.env, HOME: join(tmp, "home"), NO_COLOR: "1" },
      timeout: 30_000,
    });
    return run.catch((error) => error as { stdout: string; stderr: string });
  }

  const trusted = () =>
    JSON.parse(
      readFileSync(join(tmp, "home", ".codemode", "trust.json"), "utf8"),
    ).trusted as string[];

  it("init leaves the project as it is instead of creating a folder beside it", async () => {
    const { stderr } = await codemode(["init"]);
    assert.match(stderr, /\.runline\/ already exists/);
    assert.match(stderr, /is a runline name and stops working in/);
    assert.equal(existsSync(join(project, ".codemode")), false);
  });

  it("trust finds the folder from its directory, and holds after the rename until revoked", async () => {
    const ping = ["exec", "return await old.ping()"];
    assert.match((await codemode(ping)).stderr, /project is not trusted/);

    await codemode(["trust", project], tmp);
    assert.deepEqual(trusted(), [join(project, ".runline")]);
    assert.equal((await codemode(ping)).stdout.trim(), "pong");

    renameSync(join(project, ".runline"), join(project, ".codemode"));
    assert.equal((await codemode(ping)).stdout.trim(), "pong");

    await codemode(["trust", "--revoke"]);
    assert.deepEqual(trusted(), []);
    assert.match((await codemode(ping)).stderr, /project is not trusted/);
  });
});
