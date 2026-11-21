// Test harness for engine robustness scenarios (large payloads, OOM,
// timeouts, crashes). Runs one named scenario in this process and prints a
// JSON report to stdout. Tests spawn this file so that a hard process
// abort or exit kills the harness, not the test runner.
//
// Usage: bun run engine-harness.ts <scenario>
import { createHash } from "node:crypto";
import { DEFAULT_CONFIG } from "../../config/types.js";
import { ExecutionEngine } from "../../core/engine.js";
import { createPluginAPI } from "../../plugin/api.js";
import { PluginRegistry } from "../../plugin/registry.js";

const BLOB_MB = 8;
// ~8MB of raw bytes → ~10.7MB base64
const base64 = Buffer.alloc(BLOB_MB * 1024 * 1024, 0xab).toString("base64");
const base64Sha = createHash("sha256").update(base64).digest("hex");

// Captures what the host-side actions actually received, so tests can
// verify that data crossing the execution boundary arrives byte-identical.
const received: Record<string, unknown> = {};

function makeFilesPlugin() {
  const { api, resolve } = createPluginAPI("test");
  api.setName("files");
  api.setVersion("0.0.0");

  api.registerAction("getAttachment", {
    description: "Returns a large base64 payload",
    async execute() {
      await new Promise((r) => setTimeout(r, 5));
      return { filename: "msa.pdf", data: base64 };
    },
  });

  api.registerAction("upload", {
    description: "Accepts a large base64 payload",
    async execute(input) {
      await new Promise((r) => setTimeout(r, 5));
      const { data } = input as { data: string };
      received.uploadSha =
        typeof data === "string"
          ? createHash("sha256").update(data).digest("hex")
          : `not-a-string:${typeof data}`;
      received.uploadBytes = typeof data === "string" ? data.length : -1;
      return { id: "file_123", bytes: received.uploadBytes };
    },
  });

  api.registerAction("send", {
    description: "Accepts a large attachment",
    async execute(input) {
      await new Promise((r) => setTimeout(r, 5));
      const { attachment } = input as { attachment: string };
      received.sendBytes =
        typeof attachment === "string" ? attachment.length : -1;
      return { messageId: "msg_456", bytes: received.sendBytes };
    },
  });

  api.registerAction("append", {
    description: "Small side effect",
    async execute() {
      await new Promise((r) => setTimeout(r, 5));
      return { updatedRows: 1 };
    },
  });

  api.registerAction("slow", {
    description: "Sleeps for the given ms, then returns",
    async execute(input) {
      const { ms } = input as { ms: number };
      await new Promise((r) => setTimeout(r, ms));
      return { waited: ms };
    },
  });

  api.registerAction("circular", {
    description: "Returns a non-JSON-serializable (circular) value",
    async execute() {
      const obj: Record<string, unknown> = { name: "loop" };
      obj.self = obj;
      return obj;
    },
  });

  return resolve();
}

function makeEngine(memoryMb = 64, timeoutMs = 30_000) {
  const registry = new PluginRegistry();
  registry.register(makeFilesPlugin());
  return new ExecutionEngine(registry, {
    ...DEFAULT_CONFIG,
    timeoutMs,
    memoryLimitBytes: memoryMb * 1024 * 1024,
  });
}

type Scenario = () => Promise<Record<string, unknown>>;

const scenarios: Record<string, Scenario> = {
  // The agent's original failure: multi-step chain with a large payload,
  // default 64MB memory limit. Must complete cleanly.
  async "chain-default"() {
    const engine = makeEngine(64);
    const out = await engine.execute(`
      const att = await files.getAttachment({ messageId: "m1" });
      const up = await files.upload({ name: att.filename, data: att.data });
      const sent = await files.send({ to: "x@y.z", attachment: att.data });
      const row = await files.append({ values: [["Triple-A MSA", "May"]] });
      return { up, sent, row };
    `);
    return { error: out.error ?? null, result: out.result, received };
  },

  // Integrity: the bytes the upload action receives must be byte-identical
  // to what getAttachment produced.
  async integrity() {
    const engine = makeEngine(64);
    const out = await engine.execute(`
      const att = await files.getAttachment({ messageId: "m1" });
      await files.upload({ name: att.filename, data: att.data });
      return "done";
    `);
    return {
      error: out.error ?? null,
      expectedSha: base64Sha,
      expectedBytes: base64.length,
      received,
    };
  },

  // Ergonomics: inside the sandbox a large payload is a plain string the
  // agent can measure, slice, and pass around — no tokens, no proxies.
  async "string-surface"() {
    const engine = makeEngine(64);
    const out = await engine.execute(`
      const att = await files.getAttachment({ messageId: "m1" });
      const d = att.data;
      return { type: typeof d, bytes: d.length, head: d.slice(0, 8) };
    `);
    return {
      error: out.error ?? null,
      result: out.result,
      expectedBytes: base64.length,
      expectedHead: base64.slice(0, 8),
    };
  },

  // A large value in the final return reaches the host caller intact.
  async "final-result-large"() {
    const engine = makeEngine(64);
    const out = await engine.execute(`
      const att = await files.getAttachment({ messageId: "m1" });
      return { data: att.data };
    `);
    const data = (out.result as { data?: unknown } | null)?.data;
    return {
      error: out.error ?? null,
      resultBytes: typeof data === "string" ? data.length : -1,
      resultSha:
        typeof data === "string"
          ? createHash("sha256").update(data).digest("hex")
          : null,
      expectedSha: base64Sha,
      expectedBytes: base64.length,
    };
  },

  // An action still in flight when the run times out must not crash the
  // host when its result arrives after the worker is gone — no unhandled
  // rejections, no uncaught exceptions, clean timeout error.
  async "timeout-inflight-action"() {
    const unhandled: string[] = [];
    process.on("unhandledRejection", (e) => unhandled.push(String(e)));
    process.on("uncaughtException", (e) => unhandled.push(String(e)));
    const engine = makeEngine(64, 150);
    const out = await engine.execute(`
      await files.slow({ ms: 1000 });
      return "unreachable";
    `);
    // let the in-flight action resolve against the dead worker
    await new Promise((r) => setTimeout(r, 1200));
    return { error: out.error ?? null, unhandled };
  },

  // An action returning a non-JSON-serializable value must surface as a
  // clean per-call error inside the sandbox — catchable by agent code —
  // not a hang or a crash.
  async "circular-result"() {
    const engine = makeEngine(64);
    const out = await engine.execute(`
      try {
        await files.circular({});
        return { caught: false };
      } catch (e) {
        return { caught: true, message: e.message };
      }
    `);
    return { error: out.error ?? null, result: out.result };
  },

  // Two executes on the same engine running concurrently must not
  // interfere — separate workers, separate logs, correct results.
  async concurrent() {
    const engine = makeEngine(64);
    const [a, b] = await Promise.all([
      engine.execute(
        `console.log("run-a"); const r = await files.slow({ ms: 50 }); return { tag: "a", waited: r.waited };`,
      ),
      engine.execute(
        `console.log("run-b"); const r = await files.slow({ ms: 30 }); return { tag: "b", waited: r.waited };`,
      ),
    ]);
    return {
      aError: a.error ?? null,
      bError: b.error ?? null,
      aResult: a.result,
      bResult: b.result,
      aLogs: a.logs,
      bLogs: b.logs,
    };
  },

  // Agent code killing its own worker (it has the full runtime, so it can)
  // must fail soft with a descriptive error and leave the engine usable.
  async "worker-suicide"() {
    const engine = makeEngine(64);
    const out = await engine.execute(`process.exit(7);`);
    const after = await engine.execute("return 1 + 1");
    return {
      error: out.error ?? null,
      afterError: after.error ?? null,
      afterResult: after.result,
    };
  },

  // Sandbox code that genuinely exhausts the memory limit must fail soft:
  // a clean error returned from execute(), no process abort, and the engine
  // must remain usable for a subsequent run.
  async "sandbox-oom"() {
    const engine = makeEngine(32);
    const out = await engine.execute(`
      const hog = [];
      while (true) hog.push(new Array(1e6).fill(1));
    `);
    const after = await engine.execute("return 1 + 1");
    return {
      error: out.error ?? null,
      afterError: after.error ?? null,
      afterResult: after.result,
    };
  },
};

const name = process.argv[2];
const scenario = scenarios[name];
if (!scenario) {
  console.error(`Unknown scenario: ${name}`);
  process.exit(2);
}

const report = await scenario();
console.log(JSON.stringify(report));
process.exit(0);
