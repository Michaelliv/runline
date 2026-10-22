import assert from "node:assert/strict";
import { describe, it } from "node:test";
import shiftWorkers from "../../../runline-plugins/shiftWorkers/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { PluginDef } from "../plugin/types.js";

const SHIFT_WORKERS_ACTIONS = [
  "app.create",
  "app.delete",
  "app.get",
  "app.list",
  "app.repair",
  "app.restore",
  "app.resume",
  "app.suspend",
  "deployment.create",
  "logs.list",
  "secret.delete",
  "secret.list",
  "secret.set",
  "version.list",
  "version.upload",
] as const;

function makeShiftWorkers(): PluginDef {
  const { api, resolve } = createPluginAPI("shiftWorkers");
  shiftWorkers(api);
  return resolve();
}

describe("shiftWorkers plugin", () => {
  it("registers the Workers actions, reads classified as reads", () => {
    const plugin = makeShiftWorkers();
    assert.equal(plugin.name, "shiftWorkers");
    assert.deepEqual(plugin.actions.map((a) => a.name).sort(), [
      ...SHIFT_WORKERS_ACTIONS,
    ]);
    for (const action of plugin.actions) {
      const read =
        action.name.endsWith(".list") || action.name.endsWith(".get");
      assert.equal(action.access, read ? "read" : "write", action.name);
    }
  });
});
