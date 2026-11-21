import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { isPackageError, PackageError } from "../packages/errors.js";
import {
  bundledPluginNames,
  PackageManager,
  type PackageManagerOptions,
} from "../packages/manager.js";
import { readPackageManifest } from "../packages/manifest.js";
import { type CommandRunner, quoteForCmd } from "../packages/runner.js";
import { packageIdentity, parseSource } from "../packages/source.js";
import { FilePackageStore, MemoryPackageStore } from "../packages/store.js";
import { discoverPlugins } from "../plugin/loader.js";
import { Runline } from "../sdk.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "runline-packages-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** A plugin module; `name` is what it declares. */
function pluginSource(name: string, extra = ""): string {
  return `export default function (api) {
  api.setName(${JSON.stringify(name)});
  api.setVersion("1.0.0");
  api.registerAction("list", { access: "read", description: "list", execute: () => [] });
  api.registerAction("create", { access: "write", description: "create", execute: () => ({}) });
  ${extra}
}
`;
}

function writePackage(
  dir: string,
  pkg: Record<string, unknown>,
  files: Record<string, string>,
): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

function manager(options: Partial<PackageManagerOptions> = {}): PackageManager {
  return new PackageManager({
    roots: { user: join(tmp, "user"), project: join(tmp, "project") },
    store: new MemoryPackageStore(),
    reservedNames: ["gmail"],
    runner: refusingRunner,
    ...options,
  });
}

const refusingRunner: CommandRunner = {
  async run(command, args) {
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  },
};

/** Stands in for npm: copies fixtures into `--prefix <root>/node_modules`. */
function fakeNpm(
  fixtures: Record<string, string>,
  calls: string[][],
): CommandRunner {
  return {
    async run(command, args) {
      calls.push([command, ...args]);
      const prefix = args[args.indexOf("--prefix") + 1];
      if (args[0] === "install") {
        const spec = args[1];
        const name = spec.replace(/(.)@.*$/, "$1");
        const fixture = fixtures[name];
        if (!fixture) return { code: 1, stdout: "", stderr: `404 ${name}` };
        cpSync(fixture, join(prefix, "node_modules", name), {
          recursive: true,
        });
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "uninstall") {
        rmSync(join(prefix, "node_modules", args[1]), {
          recursive: true,
          force: true,
        });
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "view")
        return {
          code: 0,
          stdout: JSON.stringify(["1.0.0", "1.4.0"]),
          stderr: "",
        };
      return { code: 1, stdout: "", stderr: "unknown" };
    },
  };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  })
    .toString()
    .trim();
}

describe("parseSource", () => {
  it("parses npm sources and pins exact versions only", () => {
    assert.deepEqual(parseSource("npm:@acme/orders@1.2.0"), {
      type: "npm",
      spec: "@acme/orders@1.2.0",
      name: "@acme/orders",
      version: "1.2.0",
      range: "1.2.0",
      pinned: true,
    });
    assert.equal(
      (parseSource("npm:orders@^1.2.0") as { range?: string }).range,
      ">=1.2.0 <2.0.0-0",
    );
    assert.equal(
      (parseSource("npm:orders@beta") as { range?: string }).range,
      undefined,
    );
    assert.equal(
      (parseSource("npm:orders@^1.2.0") as { pinned: boolean }).pinned,
      false,
    );
    assert.equal(
      (parseSource("npm:orders") as { pinned: boolean }).pinned,
      false,
    );
  });

  it("refuses npm names and versions that could become options", () => {
    for (const bad of [
      "npm:-rf",
      "npm:--registry=evil",
      "npm:ok@--foo",
      "npm:Bad Name",
    ])
      assert.throws(() => parseSource(bad), { code: "invalid_source" });
  });

  it("parses git shorthand, URLs and refs, and refuses unsafe ones", () => {
    const short = parseSource("git:github.com/acme/tools@v1");
    assert.deepEqual(short, {
      type: "git",
      repo: "https://github.com/acme/tools",
      host: "github.com",
      path: "acme/tools",
      ref: "v1",
    });
    const ssh = parseSource("git:git@github.com:acme/tools.git");
    assert.equal(packageIdentity(ssh, tmp), packageIdentity(short, tmp));
    assert.equal(
      packageIdentity("https://github.com/acme/tools@v2", tmp),
      "git:github.com/acme/tools",
    );
    assert.throws(
      () => parseSource("git:github.com/acme/tools@--upload-pack=x"),
      { code: "invalid_source" },
    );
    assert.throws(() => parseSource("git:github.com/acme/../../etc"), {
      code: "invalid_source",
    });
    assert.throws(() => parseSource("git:-oProxyCommand=x/a/b"), {
      code: "invalid_source",
    });
  });

  it("treats anything else as a local path resolved from the config folder", () => {
    assert.deepEqual(parseSource("./tools/orders"), {
      type: "local",
      path: "./tools/orders",
    });
    assert.equal(
      packageIdentity("./tools/orders", "/base"),
      "local:/base/tools/orders",
    );
  });
});

describe("package stores", () => {
  it("keeps packages beside connections in config.json", async () => {
    const file = join(tmp, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        connections: [{ name: "gh", plugin: "github", config: { token: "x" } }],
      }),
    );
    const store = new FilePackageStore({ user: file });
    await store.update("user", (entries) => ({
      entries: [...entries, "npm:orders@1.0.0"],
      result: undefined,
    }));
    const data = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(data.packages, ["npm:orders@1.0.0"]);
    assert.equal(data.connections[0].config.token, "x");
    await store.update("user", () => ({ entries: [], result: undefined }));
    assert.equal("packages" in JSON.parse(readFileSync(file, "utf8")), false);
  });

  it("rejects malformed entries", () => {
    assert.throws(
      () => new MemoryPackageStore({ user: [{ nope: 1 } as never] }),
      { code: "invalid_config" },
    );
  });
});

describe("readPackageManifest", () => {
  it("reads runline.plugins with globs and exclusions", () => {
    const root = writePackage(
      join(tmp, "pkg"),
      {
        name: "p",
        runline: { plugins: ["./plugins/*.js", "!./plugins/legacy.js"] },
      },
      {
        "plugins/a.js": pluginSource("a"),
        "plugins/b.js": pluginSource("b"),
        "plugins/legacy.js": pluginSource("legacy"),
      },
    );
    assert.deepEqual(
      readPackageManifest(root)
        .pluginPaths.map((p) => p.slice(root.length + 1))
        .sort(),
      ["plugins/a.js", "plugins/b.js"],
    );
  });

  it("refuses paths that leave the package, including through a symlink", () => {
    const outside = writePackage(
      join(tmp, "outside"),
      {},
      { "x.js": pluginSource("x") },
    );
    const root = writePackage(
      join(tmp, "pkg"),
      { runline: { plugins: ["../outside/x.js"] } },
      {},
    );
    assert.throws(() => readPackageManifest(root), {
      code: "invalid_manifest",
    });
    const linked = writePackage(
      join(tmp, "linked"),
      { runline: { plugins: ["./link/x.js"] } },
      {},
    );
    symlinkSync(outside, join(linked, "link"));
    assert.throws(() => readPackageManifest(linked), {
      code: "invalid_manifest",
    });
  });

  it("falls back to main and reports host modules listed as dependencies", () => {
    const root = writePackage(
      join(tmp, "pkg"),
      {
        main: "dist/index.js",
        dependencies: { runline: "^0.44.0", leftpad: "1" },
      },
      {
        "dist/index.js": pluginSource("solo"),
      },
    );
    const manifest = readPackageManifest(root);
    assert.equal(manifest.pluginPaths.length, 1);
    assert.deepEqual(manifest.bundledHostModules, ["runline"]);
  });
});

describe("PackageManager", () => {
  it("installs, lists, loads and removes a local package", async () => {
    const pkg = writePackage(
      join(tmp, "orders"),
      { name: "orders", version: "1.0.0" },
      { "index.js": pluginSource("orders") },
    );
    const pm = manager();
    await pm.install(pkg);
    const [listed] = await pm.list();
    assert.equal(listed.scope, "user");
    assert.equal(listed.version, "1.0.0");
    const { plugins, problems } = await pm.load();
    assert.deepEqual(
      plugins.map((p) => p.name),
      ["orders"],
    );
    assert.deepEqual(problems, []);
    assert.equal(await pm.remove(pkg), true);
    assert.equal(
      existsSync(pkg),
      true,
      "a local package's files are never removed",
    );
    assert.deepEqual((await pm.load()).plugins, []);
  });

  it("reports what a package carries before it is recorded", async () => {
    const pkg = writePackage(
      join(tmp, "hunterish"),
      { name: "hunterish", version: "2.0.0" },
      {
        "index.ts": `import { staticCredential } from "runline";
${pluginSource(
  "hunterish",
  `api.setCredential(staticCredential({
    id: "hunterish",
    auth: { kind: "queryKey", param: "api_key" },
    local: { secret: "apiKey" },
    targets: { api: { baseUrl: "https://api.hunter.io/v2/", methods: ["GET"] } },
  }));`,
)}`,
      },
    );
    const pm = manager();
    const staged = await pm.fetch(pkg);
    const report = await pm.inspect(staged);
    assert.equal(report.version, "2.0.0");
    assert.deepEqual(report.plugins[0], {
      name: "hunterish",
      version: "1.0.0",
      actions: 2,
      read: 1,
      write: 1,
      unspecified: 0,
      credential: {
        type: "hunterish",
        method: "queryKey",
        targets: ["https://api.hunter.io/v2/"],
      },
    });
    assert.deepEqual(await pm.list(), [], "inspect records nothing");
  });

  it("never loads a package plugin with a bundled plugin's name", async () => {
    const pkg = writePackage(
      join(tmp, "evil"),
      { name: "evil" },
      { "index.js": pluginSource("gmail") },
    );
    const pm = manager();
    const report = await pm.inspect(await pm.fetch(pkg));
    assert.equal(report.problems[0].code, "name_reserved");
    await pm.install(pkg);
    const { plugins, problems } = await pm.load();
    assert.deepEqual(plugins, []);
    assert.equal(problems[0].code, "name_reserved");
  });

  it("refuses modules that declare no name or register no actions", async () => {
    const unnamed = writePackage(
      join(tmp, "unnamed"),
      {},
      {
        "index.js": `export default function (api) { api.registerAction("x", { access: "read", description: "x", execute: () => 1 }); }`,
      },
    );
    const notPlugin = writePackage(
      join(tmp, "isnumber"),
      { main: "index.js" },
      {
        "index.js":
          "module.exports = function isNumber(n) { return typeof n === 'number'; };",
      },
    );
    const pm = manager();
    for (const pkg of [unnamed, notPlugin]) {
      const report = await pm.inspect(await pm.fetch(pkg));
      assert.deepEqual(report.plugins, []);
      assert.equal(report.problems[0].code, "load_failed");
    }
    const empty = writePackage(
      join(tmp, "empty"),
      {},
      {
        "index.js": `export default function (api) { api.setName("empty"); }`,
      },
    );
    const { plugins, problems } = await manager({
      store: new MemoryPackageStore({ user: [unnamed, notPlugin, empty] }),
    }).load();
    assert.deepEqual(plugins, []);
    assert.match(problems[0].message, /declares no plugin name/);
    assert.match(problems[1].message, /declares no plugin name/);
    assert.match(problems[2].message, /registers no actions/);
  });

  it("refuses the second of two packages declaring one name, naming both", async () => {
    const a = writePackage(
      join(tmp, "a"),
      {},
      { "index.js": pluginSource("orders") },
    );
    const b = writePackage(
      join(tmp, "b"),
      {},
      { "index.js": pluginSource("orders") },
    );
    const pm = manager({ store: new MemoryPackageStore({ user: [a, b] }) });
    const { plugins, problems } = await pm.load();
    assert.equal(plugins.length, 1);
    assert.deepEqual(plugins[0].sourceInfo, {
      path: join(a, "index.js"),
      source: a,
      origin: "package",
      scope: "user",
      owner: `local:${a}`,
    });
    assert.equal(problems[0].code, "name_conflict");
    assert.match(problems[0].message, new RegExp(a.replace(/[/\\]/g, ".")));
  });

  it("narrows a package's plugins with the entry's filter", async () => {
    const pkg = writePackage(
      join(tmp, "multi"),
      { runline: { plugins: ["./a.js", "./b.js"] } },
      {
        "a.js": pluginSource("alpha"),
        "b.js": pluginSource("beta"),
      },
    );
    const pm = manager({
      store: new MemoryPackageStore({
        user: [{ source: pkg, plugins: ["!beta"] }],
      }),
    });
    assert.deepEqual(
      (await pm.load()).plugins.map((p) => p.name),
      ["alpha"],
    );
  });

  it("loads project packages only when trusted, and the project entry wins", async () => {
    const v1 = writePackage(
      join(tmp, "v1"),
      { version: "1.0.0" },
      { "index.js": pluginSource("orders") },
    );
    mkdirSync(join(tmp, "project"), { recursive: true });
    const store = new MemoryPackageStore({ user: [v1], project: [v1] });

    const untrusted = await manager({ store }).load();
    assert.equal(untrusted.plugins[0].sourceInfo?.scope, "user");
    assert.equal(untrusted.problems[0].code, "untrusted");
    await assert.rejects(manager({ store }).install(v1, { scope: "project" }), {
      code: "untrusted",
    });

    const trusted = await manager({ store, trust: () => true }).load();
    assert.equal(trusted.plugins.length, 1);
    assert.equal(trusted.plugins[0].sourceInfo?.scope, "project");
  });

  it("installs npm packages through argv with scripts off and peers skipped", async () => {
    const fixture = writePackage(
      join(tmp, "fixture"),
      {
        name: "@acme/orders",
        version: "1.0.0",
        peerDependencies: { runline: "*" },
      },
      {
        "index.js": pluginSource("orders"),
      },
    );
    const calls: string[][] = [];
    const store = new MemoryPackageStore();
    const pm = manager({
      store,
      runner: fakeNpm({ "@acme/orders": fixture }, calls),
    });
    await pm.install("npm:@acme/orders@1.0.0");
    const npmRoot = join(tmp, "user", "packages", "npm");
    assert.deepEqual(calls[0], [
      "npm",
      "install",
      "@acme/orders@1.0.0",
      "--prefix",
      npmRoot,
      "--save-exact",
      "--legacy-peer-deps",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ]);
    assert.deepEqual(
      JSON.parse(readFileSync(join(npmRoot, "package.json"), "utf8")),
      { name: "runline-packages", private: true },
    );
    assert.deepEqual(await store.read("user"), ["npm:@acme/orders@1.0.0"]);
    assert.deepEqual(
      (await pm.load()).plugins.map((p) => p.name),
      ["orders"],
    );

    // Pinned: update leaves it alone. Same identity, new version: one entry.
    calls.length = 0;
    await pm.update();
    assert.deepEqual(calls, []);
    await pm.install("npm:@acme/orders@^1.0.0");
    assert.deepEqual(await store.read("user"), ["npm:@acme/orders@^1.0.0"]);
    assert.deepEqual(await pm.checkUpdates(), [
      {
        source: "npm:@acme/orders@^1.0.0",
        scope: "user",
        installed: "1.0.0",
        latest: "1.4.0",
      },
    ]);

    calls.length = 0;
    assert.equal(await pm.remove("npm:@acme/orders"), true);
    assert.equal(calls[0][1], "uninstall");
    assert.deepEqual(await store.read("user"), []);
  });

  it("installs a missing package on load only when asked", async () => {
    const fixture = writePackage(
      join(tmp, "fixture"),
      { name: "orders", version: "1.0.0" },
      { "index.js": pluginSource("orders") },
    );
    const calls: string[][] = [];
    const store = new MemoryPackageStore({ user: ["npm:orders@1.0.0"] });
    const skip = await manager({
      store,
      runner: fakeNpm({ orders: fixture }, calls),
    }).load();
    assert.equal(skip.problems[0].code, "missing");
    assert.equal(calls.length, 0);
    const offline = manager({
      store,
      onMissing: "install",
      offline: true,
      runner: fakeNpm({ orders: fixture }, calls),
    });
    assert.equal((await offline.load()).problems[0].code, "missing");
    assert.equal(calls.length, 0, "offline never runs npm");
    const install = await manager({
      store,
      onMissing: "install",
      runner: fakeNpm({ orders: fixture }, calls),
    }).load();
    assert.deepEqual(
      install.plugins.map((p) => p.name),
      ["orders"],
    );
  });

  it("loads a temporary package for one call without recording it", async () => {
    const pkg = writePackage(
      join(tmp, "temp"),
      {},
      { "index.js": pluginSource("scratch") },
    );
    const store = new MemoryPackageStore();
    const pm = manager({ store });
    assert.deepEqual(
      (await pm.load({ temporary: [pkg] })).plugins.map((p) => p.name),
      ["scratch"],
    );
    assert.deepEqual(await store.read("user"), []);
  });

  it("clones git refs, keeps tags pinned and moves branches on update", async () => {
    const origin = writePackage(
      join(tmp, "origin"),
      { name: "tools", version: "1.0.0" },
      { "index.js": pluginSource("tools") },
    );
    git(origin, "init", "-q", "-b", "main");
    git(origin, "add", ".");
    git(origin, "commit", "-qm", "v1");
    git(origin, "tag", "v1");
    const v1 = git(origin, "rev-parse", "HEAD");
    writeFileSync(
      join(origin, "package.json"),
      JSON.stringify({ name: "tools", version: "2.0.0" }),
    );
    git(origin, "commit", "-qam", "v2");
    const v2 = git(origin, "rev-parse", "HEAD");
    const url = `file://${origin}`;

    const pm = manager({ runner: undefined });
    const tagged = await pm.install(`${url}@v1`);
    assert.equal(git(tagged.installedPath as string, "rev-parse", "HEAD"), v1);
    assert.deepEqual(
      (await pm.load()).plugins.map((p) => p.name),
      ["tools"],
    );
    const [tagUpdate] = await pm.update();
    assert.equal(tagUpdate.changed, false);

    await pm.install(url); // same identity: replaces the tagged entry
    const [branchUpdate] = await pm.update();
    assert.equal(branchUpdate.to, v2);
    assert.equal(git(tagged.installedPath as string, "rev-parse", "HEAD"), v2);

    // An interrupted update leaves a marker; the next sync completes it.
    writeFileSync(join(tagged.installedPath as string, "stray.txt"), "x");
    const marker = join(
      tagged.installedPath as string,
      "..",
      `.${"origin"}.runline-update-incomplete`,
    );
    writeFileSync(marker, "");
    await pm.update();
    assert.equal(existsSync(marker), false);
    assert.equal(
      existsSync(join(tagged.installedPath as string, "stray.txt")),
      false,
    );

    assert.equal(await pm.remove(url), true);
    assert.equal(existsSync(tagged.installedPath as string), false);
  });

  it("reports a package with no loadable manifest as a problem, not a throw", async () => {
    const empty = join(tmp, "nothing");
    mkdirSync(empty);
    writeFileSync(join(empty, "package.json"), "{}");
    const pm = manager();
    const report = await pm.inspect(await pm.fetch(empty));
    assert.deepEqual(report.plugins, []);
    assert.equal(report.problems[0].code, "invalid_manifest");
  });

  it("puts the recorded version back when a fetch is discarded", async () => {
    const v1 = writePackage(
      join(tmp, "v1"),
      { name: "orders", version: "1.0.0" },
      { "index.js": pluginSource("orders") },
    );
    const v2 = writePackage(
      join(tmp, "v2"),
      { name: "orders", version: "2.0.0" },
      { "index.js": pluginSource("orders") },
    );
    // Serves whichever version the spec names.
    const runner: CommandRunner = {
      async run(command, args, options) {
        const fixture = args[1].endsWith("2.0.0") ? v2 : v1;
        return fakeNpm({ orders: fixture }, []).run(command, args, options);
      },
    };
    const pm = manager({ runner });
    await pm.install("npm:orders@1.0.0");
    const staged = await pm.fetch("npm:orders@2.0.0");
    assert.equal(staged.version, "2.0.0");
    await pm.discard(staged);
    const [listed] = await pm.list();
    assert.equal(listed.source, "npm:orders@1.0.0");
    assert.equal(listed.version, "1.0.0");
  });

  it("treats an npm package outside its configured version or range as missing", async () => {
    const fixture = writePackage(
      join(tmp, "fixture"),
      { name: "orders", version: "1.0.0" },
      { "index.js": pluginSource("orders") },
    );
    const store = new MemoryPackageStore();
    const pm = manager({ store, runner: fakeNpm({ orders: fixture }, []) });
    await pm.install("npm:orders@^1.0.0");
    assert.deepEqual((await pm.load()).problems, []);
    for (const outside of ["npm:orders@^2.0.0", "npm:orders@1.5.0"]) {
      await store.update("user", () => ({
        entries: [outside],
        result: undefined,
      }));
      const { plugins, problems } = await pm.load();
      assert.deepEqual(plugins, []);
      assert.equal(problems[0].code, "missing");
    }
    // A dist-tag is not a range: whatever is installed stands.
    await store.update("user", () => ({
      entries: ["npm:orders@beta"],
      result: undefined,
    }));
    assert.deepEqual((await pm.load()).problems, []);
  });

  it("updates an npm range only when a newer version inside it exists", async () => {
    const fixture = writePackage(
      join(tmp, "fixture"),
      { name: "orders", version: "1.4.0" },
      { "index.js": pluginSource("orders") },
    );
    const calls: string[][] = [];
    // The registry lists 1.0.0 and 1.4.0 (see fakeNpm's `view`).
    const pm = manager({ runner: fakeNpm({ orders: fixture }, calls) });
    await pm.install("npm:orders@^1.0.0");
    calls.length = 0;
    const [update] = await pm.update();
    assert.equal(update.changed, false);
    assert.deepEqual(
      calls.map((c) => c[1]),
      ["view"],
      "nothing newer in range: no install",
    );
    assert.deepEqual(await pm.checkUpdates(), []);

    // Installed 1.4.0 but configured ^2: outside the range, so reinstalled
    // even though the registry lists nothing newer.
    const store = new MemoryPackageStore({ user: ["npm:orders@^2.0.0"] });
    calls.length = 0;
    await manager({
      store,
      runner: fakeNpm({ orders: fixture }, calls),
    }).update();
    assert.deepEqual(
      calls.map((c) => c[1]),
      ["install"],
    );
  });

  it("warns when a package's peer range excludes this runline", async () => {
    const fits = writePackage(
      join(tmp, "fits"),
      { peerDependencies: { runline: "*" } },
      { "index.js": pluginSource("fits") },
    );
    const future = writePackage(
      join(tmp, "future"),
      { peerDependencies: { runline: ">=999.0.0" } },
      { "index.js": pluginSource("future") },
    );
    const { plugins, problems } = await manager({
      store: new MemoryPackageStore({ user: [fits, future] }),
    }).load();
    assert.deepEqual(
      plugins.map((p) => p.name),
      ["fits", "future"],
    );
    assert.equal(problems.length, 1);
    assert.equal(problems[0].code, "peer_unsatisfied");
    assert.match(
      problems[0].message,
      /needs runline >=999\.0\.0; this is runline \d/,
    );
  });

  it("refuses a relative temporary local source", async () => {
    const { problems } = await manager().load({ temporary: ["./scratch"] });
    assert.equal(problems[0].code, "invalid_source");
  });

  it("raises PackageError with a code, and honours abort", async () => {
    const pm = manager();
    await assert.rejects(
      pm.install("./does-not-exist"),
      (e: unknown) => e instanceof PackageError && e.code === "missing_path",
    );
    // Recognised from another copy of runline's module too.
    const foreign = Object.assign(new Error("x"), {
      name: "PackageError",
      code: "offline",
    });
    assert.equal(isPackageError(foreign), true);
    assert.equal(isPackageError(new Error("x")), false);
    await assert.rejects(manager({ roots: {} }).install("./x"), {
      code: "not_found",
    });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(pm.load({ signal: controller.signal }), {
      code: "aborted",
    });
  });

  it("searches npm by the runline-plugin keyword", async () => {
    let requested = "";
    const pm = manager({
      fetch: (async (url: string) => {
        requested = url;
        return new Response(
          JSON.stringify({
            objects: [
              {
                package: {
                  name: "@acme/orders",
                  version: "1.0.0",
                  description: "Orders",
                },
              },
            ],
          }),
        );
      }) as typeof fetch,
    });
    assert.deepEqual(await pm.search("orders"), [
      {
        name: "@acme/orders",
        version: "1.0.0",
        description: "Orders",
        source: "npm:@acme/orders",
      },
    ]);
    assert.match(
      decodeURIComponent(requested),
      /text=keywords:runline-plugin orders/,
    );

    const down = manager({
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    await assert.rejects(down.search("orders"), { code: "registry_failed" });
    const refused = manager({
      fetch: (async () =>
        new Response("", { status: 503 })) as unknown as typeof fetch,
    });
    await assert.rejects(refused.search("orders"), {
      code: "registry_failed",
      message: /HTTP 503/,
    });
  });

  it("names bundled plugins by their folders and files, skipping private ones", () => {
    const dir = join(tmp, "builtins");
    mkdirSync(join(dir, "gmail"), { recursive: true });
    mkdirSync(join(dir, "_shared"));
    writeFileSync(join(dir, "alpha.js"), "");
    writeFileSync(join(dir, "alpha.d.ts"), "");
    writeFileSync(join(dir, "notes.md"), "");
    assert.deepEqual([...bundledPluginNames(dir)].sort(), ["alpha", "gmail"]);
  });

  it("quotes arguments for cmd.exe and refuses the ones quoting cannot make safe", () => {
    assert.equal(quoteForCmd("--prefix"), "--prefix");
    assert.equal(quoteForCmd("pkg@>=1.2.0"), '"pkg@>=1.2.0"');
    assert.equal(quoteForCmd("C:\\Program Files\\x"), '"C:\\Program Files\\x"');
    for (const bad of ["%PATH%", 'a"b', "a\nb"])
      assert.throws(() => quoteForCmd(bad), /cmd\.exe/);
  });
});

describe("discovery with packages", () => {
  it("skips the npm folder `runline plugin install` wrote up to 0.44", async () => {
    mkdirSync(join(tmp, "home", ".runline", "plugins", "npm", "node_modules"), {
      recursive: true,
    });
    const builtinDir = join(tmp, "builtins");
    mkdirSync(builtinDir);
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      await discoverPlugins(null, {
        builtinDir,
        userDir: join(tmp, "home", ".runline"),
      });
    } finally {
      console.error = original;
    }
    assert.deepEqual(errors, []);
  });

  it("holds a plugins-folder package to the manifest rules", async () => {
    const runlineDir = join(tmp, "work", ".runline");
    writePackage(join(tmp, "outside"), {}, { "x.js": pluginSource("outside") });
    writePackage(
      join(runlineDir, "plugins", "escape"),
      { runline: { plugins: ["../../../outside/x.js"] } },
      {},
    );
    const builtinDir = join(tmp, "builtins");
    mkdirSync(builtinDir);
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    try {
      const plugins = await discoverPlugins(runlineDir, {
        builtinDir,
        userDir: join(tmp, "home", ".runline"),
      });
      assert.deepEqual(plugins, []);
    } finally {
      console.error = original;
    }
    assert.match(errors.join("\n"), /leaves the package/);
  });

  it("supplies typebox to a package that has no node_modules of its own", async () => {
    const pkg = writePackage(
      join(tmp, "tb"),
      { name: "tb", peerDependencies: { runline: "*", typebox: "*" } },
      {
        "index.ts": `import { Type } from "typebox";
export default function (api) {
  const schema = Type.Object({ id: Type.String() });
  api.setName("tb");
  api.registerAction("get", { access: "read", description: "get", inputSchema: schema, execute: (input) => input });
}
`,
      },
    );
    const { plugins, problems } = await manager({
      store: new MemoryPackageStore({ user: [pkg] }),
    }).load();
    assert.deepEqual(problems, []);
    assert.deepEqual(
      plugins.map((p) => p.name),
      ["tb"],
    );
  });

  it("binds a connection to the plugin source it was made for", async () => {
    const pkg = writePackage(
      join(tmp, "orderspkg"),
      {},
      { "index.js": pluginSource("orders") },
    );
    const userDir = join(tmp, "home", ".runline");
    mkdirSync(userDir, { recursive: true });
    writeFileSync(
      join(userDir, "config.json"),
      JSON.stringify({ connections: [], packages: [pkg] }),
    );
    const project = join(tmp, "work");
    const runlineDir = join(project, ".runline");
    mkdirSync(join(runlineDir, "plugins"), { recursive: true });
    writeFileSync(
      join(runlineDir, "plugins", "notes.js"),
      pluginSource("notes"),
    );
    const builtinDir = join(tmp, "builtins");
    mkdirSync(builtinDir);
    const run = async (connections: unknown[], code: string) => {
      writeFileSync(
        join(runlineDir, "config.json"),
        JSON.stringify({ connections }),
      );
      const rl = await Runline.fromProject(project, { builtinDir, userDir });
      try {
        return await rl?.execute(code);
      } finally {
        rl?.dispose();
      }
    };
    const orders = "return await orders.list({})";
    const connection = (owner?: string) => ({
      name: "orders",
      plugin: "orders",
      config: { token: "t" },
      ...(owner ? { owner } : {}),
    });

    // Made for this package: used. No stored connection at all: fine too.
    assert.equal(
      (await run([connection(`local:${pkg}`)], orders))?.error,
      undefined,
    );
    assert.equal((await run([], orders))?.error, undefined);
    // Made for another package, or for no package: refused, naming both.
    assert.match(
      (await run([connection("npm:other")], orders))?.error ?? "",
      /Connection "orders" was made for package npm:other, not for plugin "orders" from package local:/,
    );
    assert.match(
      (await run([connection()], orders))?.error ?? "",
      /was made for a bundled or local plugin/,
    );
    // The plugin's own connection is preferred over another owner's.
    assert.equal(
      (
        await run(
          [
            { ...connection("npm:other"), name: "old" },
            connection(`local:${pkg}`),
          ],
          orders,
        )
      )?.error,
      undefined,
    );
    // A local plugin keeps using a connection that names no owner.
    assert.equal(
      (
        await run(
          [{ name: "notes", plugin: "notes", config: {} }],
          "return await notes.list({})",
        )
      )?.error,
      undefined,
    );
  });

  it("Runline.fromProject loads user packages and skips an untrusted project's", async () => {
    const userPkg = writePackage(
      join(tmp, "userpkg"),
      {},
      { "index.js": pluginSource("fromuser") },
    );
    const projectPkg = writePackage(
      join(tmp, "projectpkg"),
      {},
      { "index.js": pluginSource("fromproject") },
    );
    mkdirSync(join(tmp, "home", ".runline"), { recursive: true });
    writeFileSync(
      join(tmp, "home", ".runline", "config.json"),
      JSON.stringify({ connections: [], packages: [userPkg] }),
    );
    const project = join(tmp, "work");
    mkdirSync(join(project, ".runline"), { recursive: true });
    writeFileSync(
      join(project, ".runline", "config.json"),
      JSON.stringify({ connections: [], packages: [projectPkg] }),
    );
    const builtinDir = join(tmp, "builtins");
    mkdirSync(builtinDir);

    const original = console.error;
    console.error = () => {};
    try {
      const untrusted = await Runline.fromProject(project, {
        builtinDir,
        userDir: join(tmp, "home", ".runline"),
      });
      assert.deepEqual(
        untrusted?.plugins().map((p) => p.name),
        ["fromuser"],
      );
      const trusted = await Runline.fromProject(project, {
        builtinDir,
        userDir: join(tmp, "home", ".runline"),
        trust: () => true,
      });
      assert.deepEqual(
        trusted
          ?.plugins()
          .map((p) => p.name)
          .sort(),
        ["fromproject", "fromuser"],
      );
      untrusted?.dispose();
      trusted?.dispose();
    } finally {
      console.error = original;
    }
  });
});
