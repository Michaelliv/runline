import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_CONFIG } from "../config/types.js";
import { ExecutionEngine } from "../core/engine.js";
import { resolvePluginExport } from "../plugin/api.js";
import { PluginRegistry } from "../plugin/registry.js";
import type { PluginDef } from "../plugin/types.js";

function captureWarn() {
  const original = console.warn;
  const lines: string[] = [];
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return {
    lines,
    restore() {
      console.warn = original;
    },
  };
}

describe("self-prefixed action names: load-time warning", () => {
  it("warns when a function export repeats the plugin name in an action", () => {
    const warn = captureWarn();
    try {
      resolvePluginExport((api) => {
        api.setName("salesforce");
        api.registerAction("salesforce.status", { execute: () => "ok" });
      }, "salesforce");
    } finally {
      warn.restore();
    }
    const output = warn.lines.join("\n");
    assert.match(
      output,
      /Plugin "salesforce" registered action "salesforce\.status"/,
    );
    assert.match(output, /callable as "salesforce\.salesforce\.status"/);
    assert.match(output, /Rename the action to "status"/);
  });

  it("warns for setName called after registerAction", () => {
    const warn = captureWarn();
    try {
      resolvePluginExport((api) => {
        api.registerAction("salesforce.status", { execute: () => "ok" });
        api.setName("salesforce");
      }, "fallback");
    } finally {
      warn.restore();
    }
    assert.match(warn.lines.join("\n"), /salesforce\.salesforce\.status/);
  });

  it("warns for plain PluginDef object exports", () => {
    const warn = captureWarn();
    try {
      resolvePluginExport(
        {
          name: "hubspot",
          version: "1.0.0",
          actions: [{ name: "hubspot.contact.get", execute: () => null }],
        },
        "hubspot",
      );
    } finally {
      warn.restore();
    }
    assert.match(
      warn.lines.join("\n"),
      /Plugin "hubspot" registered action "hubspot\.contact\.get"/,
    );
  });

  it("warns when the action name equals the plugin name exactly", () => {
    const warn = captureWarn();
    try {
      resolvePluginExport((api) => {
        api.setName("ping");
        api.registerAction("ping", { execute: () => "pong" });
      }, "ping");
    } finally {
      warn.restore();
    }
    assert.match(warn.lines.join("\n"), /registered action "ping"/);
  });

  it("does not warn for ordinary relative action names", () => {
    const warn = captureWarn();
    try {
      resolvePluginExport((api) => {
        api.setName("salesforce");
        api.registerAction("status", { execute: () => "ok" });
        api.registerAction("issue.create", { execute: () => "ok" });
        // Prefix of the plugin name, but not the plugin name itself.
        api.registerAction("sales.report", { execute: () => "ok" });
      }, "salesforce");
    } finally {
      warn.restore();
    }
    assert.deepEqual(warn.lines, []);
  });
});

describe("self-prefixed action names: call-time hint", () => {
  function makeEngine(actionName: string): ExecutionEngine {
    const registry = new PluginRegistry();
    const plugin: PluginDef = {
      name: "salesforce",
      version: "1.0.0",
      actions: [{ name: actionName, execute: () => "ok" }],
    };
    registry.register(plugin);
    return new ExecutionEngine(registry, {
      ...DEFAULT_CONFIG,
      timeoutMs: 5000,
    });
  }

  it("suggests the double-prefixed path when the plugin self-prefixed its action", async () => {
    const engine = makeEngine("salesforce.status");
    const result = await engine.execute("return await salesforce.status({})");
    assert.match(result.error ?? "", /Unknown action: salesforce\.status/);
    assert.match(
      result.error ?? "",
      /Did you mean "salesforce\.salesforce\.status"\?/,
    );
    assert.match(
      result.error ?? "",
      /registered its action name with the plugin prefix/,
    );
  });

  it("keeps the plain error when no double-prefixed registration exists", async () => {
    const engine = makeEngine("status");
    const result = await engine.execute("return await salesforce.nope({})");
    assert.match(result.error ?? "", /Unknown action: salesforce\.nope/);
    assert.doesNotMatch(result.error ?? "", /Did you mean/);
  });

  it("the double-prefixed path itself still resolves and executes", async () => {
    const engine = makeEngine("salesforce.status");
    const result = await engine.execute(
      "return await salesforce.salesforce.status({})",
    );
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.result, "ok");
  });
});
