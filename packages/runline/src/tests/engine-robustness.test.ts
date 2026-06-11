// Engine robustness spec (born from GitHub #181). Implementation-agnostic:
// these tests describe what execute() must do with multi-MB payloads,
// memory pressure, timeouts, and process safety — not how the engine
// achieves it.
//
// Every scenario runs in a spawned harness process because the bug that
// motivated this spec was a hard process abort() — in-process it would
// kill the test runner.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { shouldArmRssWatchdog } from "../core/engine.js";

const harness = new URL("./helpers/engine-harness.ts", import.meta.url)
  .pathname;

function runScenario(name: string): {
  exitCode: number | null;
  aborted: boolean;
  stderr: string;
  report: Record<string, unknown> | null;
} {
  const r = spawnSync("bun", ["run", harness, name], {
    encoding: "utf8",
    timeout: 60_000,
  });
  const stderr = r.stderr ?? "";
  let report: Record<string, unknown> | null = null;
  try {
    report = JSON.parse((r.stdout ?? "").trim());
  } catch {
    // no parseable report — harness died before printing
  }
  return {
    exitCode: r.status,
    // "Aborted(" is the generic wasm/emscripten abort banner; the
    // list_empty assertion is the exact QuickJS GC failure from #181.
    // Kept as a regression tripwire against any future wasm-based engine.
    aborted:
      stderr.includes("Aborted(") ||
      stderr.includes("list_empty(&rt->gc_obj_list)"),
    stderr,
    report,
  };
}

describe("engine large payloads", () => {
  it("completes a multi-step chain with an ~11MB payload under the default 64MB limit", () => {
    const { exitCode, aborted, report } = runScenario("chain-default");
    assert.equal(aborted, false, "process abort");
    assert.equal(exitCode, 0);
    assert.ok(report, "harness printed no report");
    assert.equal(report.error, null);
    const result = report.result as {
      up: { id: string; bytes: number };
      sent: { messageId: string; bytes: number };
      row: { updatedRows: number };
    };
    assert.equal(result.up.id, "file_123");
    assert.equal(result.sent.messageId, "msg_456");
    assert.equal(result.row.updatedRows, 1);
    // upload + send must have received the real payload, not a token
    assert.ok(result.up.bytes > 10_000_000, "upload saw real bytes");
    assert.equal(result.sent.bytes, result.up.bytes);
  });

  it("delivers byte-identical data to actions across the execution boundary", () => {
    const { exitCode, aborted, report } = runScenario("integrity");
    assert.equal(aborted, false, "process abort");
    assert.equal(exitCode, 0);
    assert.ok(report);
    assert.equal(report.error, null);
    const received = report.received as {
      uploadSha: string;
      uploadBytes: number;
    };
    assert.equal(received.uploadSha, report.expectedSha);
    assert.equal(received.uploadBytes, report.expectedBytes);
  });

  it("exposes large payloads as plain strings inside the sandbox", () => {
    const { exitCode, aborted, report } = runScenario("string-surface");
    assert.equal(aborted, false, "process abort");
    assert.equal(exitCode, 0);
    assert.ok(report);
    assert.equal(report.error, null);
    const result = report.result as {
      type: string;
      bytes: number;
      head: string;
    };
    assert.equal(result.type, "string");
    assert.equal(result.bytes, report.expectedBytes);
    assert.equal(result.head, report.expectedHead);
  });

  it("returns large values in the final result to the host intact", () => {
    const { exitCode, aborted, report } = runScenario("final-result-large");
    assert.equal(aborted, false, "process abort");
    assert.equal(exitCode, 0);
    assert.ok(report);
    assert.equal(report.error, null);
    assert.equal(report.resultBytes, report.expectedBytes);
    assert.equal(report.resultSha, report.expectedSha);
  });

  it("fails soft on genuine sandbox OOM and stays usable afterwards", () => {
    const { exitCode, aborted, report } = runScenario("sandbox-oom");
    assert.equal(aborted, false, "process abort");
    assert.equal(exitCode, 0);
    assert.ok(report);
    assert.ok(report.error, "OOM must surface as an execute() error");
    assert.match(String(report.error), /memory/i);
    // engine must survive: the next execute on the same engine works
    assert.equal(report.afterError, null);
    assert.equal(report.afterResult, 2);
  });
});

describe("engine robustness", () => {
  it("arms the RSS watchdog only where worker resourceLimits are not enforced", () => {
    // node enforces maxOldGenerationSizeMb natively; a process-wide RSS
    // watchdog there risks false kills from unrelated host allocations
    // (e.g. a concurrent execute). bun ignores resourceLimits, so the
    // watchdog is the only memory backstop.
    assert.equal(shouldArmRssWatchdog({ node: "24.0.0" }), false);
    assert.equal(shouldArmRssWatchdog({ node: "24.0.0", bun: "1.3.11" }), true);
  });

  it("survives an action resolving after timeout killed the worker", () => {
    const { exitCode, aborted, report } = runScenario(
      "timeout-inflight-action",
    );
    assert.equal(aborted, false, "process abort");
    assert.equal(exitCode, 0);
    assert.ok(report);
    assert.match(String(report.error), /timed out/);
    assert.deepEqual(report.unhandled, [], "unhandled rejections leaked");
  });

  it("surfaces a non-serializable action result as a catchable in-sandbox error", () => {
    const { exitCode, aborted, report } = runScenario("circular-result");
    assert.equal(aborted, false, "process abort");
    assert.equal(exitCode, 0);
    assert.ok(report);
    assert.equal(report.error, null);
    const result = report.result as { caught: boolean; message: string };
    assert.equal(result.caught, true);
    assert.match(result.message, /not JSON-serializable/);
    assert.match(result.message, /circular|cyclic/i);
    // host internals must not leak into sandbox-visible errors
    assert.doesNotMatch(result.message, /engine\.ts/);
  });

  it("runs concurrent executes on one engine without interference", () => {
    const { exitCode, aborted, report } = runScenario("concurrent");
    assert.equal(aborted, false, "process abort");
    assert.equal(exitCode, 0);
    assert.ok(report);
    assert.equal(report.aError, null);
    assert.equal(report.bError, null);
    assert.deepEqual(report.aResult, { tag: "a", waited: 50 });
    assert.deepEqual(report.bResult, { tag: "b", waited: 30 });
    assert.deepEqual(report.aLogs, ["[log] run-a"]);
    assert.deepEqual(report.bLogs, ["[log] run-b"]);
  });

  it("turns process.exit in agent code into a clear error and stays usable", () => {
    // Without interception this is runtime-divergent: node kills the worker
    // synchronously (exit event), bun lets the done message race it and
    // reports a silent undefined success.
    const { exitCode, aborted, report } = runScenario("worker-suicide");
    assert.equal(aborted, false, "process abort");
    assert.equal(exitCode, 0);
    assert.ok(report);
    assert.match(String(report.error), /process\.exit\(7\)/);
    assert.equal(report.afterError, null);
    assert.equal(report.afterResult, 2);
  });
});
