import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PluginRegistry } from "../plugin/registry.js";
import type { PluginDef } from "../plugin/types.js";

function makePlugin(name: string, actionNames: string[]): PluginDef {
  return {
    name,
    version: "1.0.0",
    actions: actionNames.map((n) => ({
      name: n,
      description: `${n} action`,
      execute: () => ({ action: n }),
    })),
  };
}

describe("PluginRegistry", () => {
  it("registers and retrieves a plugin", () => {
    const reg = new PluginRegistry();
    const plugin = makePlugin("github", ["repo.list", "issue.create"]);
    reg.register(plugin);
    assert.equal(reg.getPlugin("github")?.name, "github");
    assert.equal(reg.getPlugin("missing"), undefined);
  });

  it("retrieves an action by plugin and name", () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin("github", ["repo.list", "issue.create"]));
    assert.equal(reg.getAction("github", "repo.list")?.name, "repo.list");
    assert.equal(reg.getAction("github", "nope"), undefined);
    assert.equal(reg.getAction("nope", "repo.list"), undefined);
  });

  it("lists all actions across plugins", () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin("github", ["repo.list"]));
    reg.register(makePlugin("slack", ["message.send", "channel.list"]));
    const all = reg.getAllActions();
    assert.equal(all.length, 3);
    assert.ok(
      all.some((a) => a.plugin === "github" && a.action.name === "repo.list"),
    );
    assert.ok(
      all.some((a) => a.plugin === "slack" && a.action.name === "message.send"),
    );
  });

  it("resolves a dotted action path", () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin("docker", ["containers.list", "images.pull"]));
    const resolved = reg.resolveAction("docker.containers.list");
    assert.equal(resolved?.plugin.name, "docker");
    assert.equal(resolved?.action.name, "containers.list");
  });

  it("returns undefined for unresolvable paths", () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin("docker", ["containers.list"]));
    assert.equal(reg.resolveAction("nope.containers.list"), undefined);
    assert.equal(reg.resolveAction("docker.nope"), undefined);
    assert.equal(reg.resolveAction("nodot"), undefined);
  });

  it("later registration overwrites earlier", () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin("github", ["repo.list"]));
    reg.register(makePlugin("github", ["repo.list", "pr.merge"]));
    assert.equal(reg.getPlugin("github")?.actions.length, 2);
  });

  it("listPlugins returns all registered", () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin("a", ["x"]));
    reg.register(makePlugin("b", ["y"]));
    reg.register(makePlugin("c", ["z"]));
    assert.equal(reg.listPlugins().length, 3);
  });
});
