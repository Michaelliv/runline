import assert from "node:assert/strict";
import { describe, it } from "node:test";
import shiftWorkers from "../../../runline-plugins/shiftWorkers/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { PluginDef } from "../plugin/types.js";

const SHIFT_WORKERS_ACTIONS = [
  "access.set",
  "app.create",
  "app.delete",
  "app.get",
  "app.list",
  "app.purge",
  "app.repair",
  "app.request",
  "app.restore",
  "app.resume",
  "app.suspend",
  "data.get",
  "database.batch",
  "database.create",
  "database.grant",
  "database.list",
  "database.query",
  "database.revoke",
  "database.setLimit",
  "database.tables",
  "deployment.create",
  "egress.set",
  "logs.list",
  "managers.set",
  "preview.create",
  "secret.delete",
  "secret.list",
  "secret.set",
  "shareToken.create",
  "shareToken.list",
  "shareToken.revoke",
  "sleep.set",
  "spendCap.set",
  "usage.get",
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
        action.name.endsWith(".list") ||
        action.name.endsWith(".get") ||
        action.name === "database.tables";
      assert.equal(action.access, read ? "read" : "write", action.name);
    }
  });
});
