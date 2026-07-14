import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import googleAppsScript from "../../../runline-plugins/googleAppsScript/src/index.js";
import googleImage from "../../../runline-plugins/googleImage/src/index.js";
import googleTasks from "../../../runline-plugins/googleTasks/src/index.js";
import { createPluginAPI, type PluginFunction } from "../plugin/api.js";
import type { ActionDef, PluginDef } from "../plugin/types.js";

function makePlugin(name: string, plugin: PluginFunction): PluginDef {
  const { api, resolve } = createPluginAPI(name);
  plugin(api);
  return resolve();
}

function action(plugin: PluginDef, name: string): ActionDef {
  const found = plugin.actions.find((candidate) => candidate.name === name);
  assert.ok(found, `expected ${plugin.name}.${name} to be registered`);
  return found;
}

function schema(plugin: PluginDef, name: string): TSchema {
  const inputSchema = action(plugin, name).inputSchema as TSchema | undefined;
  assert.ok(inputSchema, `expected ${plugin.name}.${name} to have a schema`);
  return inputSchema;
}

const appsScriptFixtures: Record<string, Record<string, unknown>> = {
  "script.list": {},
  "project.getContent": { scriptId: "script-1" },
  "project.readFile": { scriptId: "script-1", name: "Code" },
  "file.edit": {
    scriptId: "script-1",
    name: "Code",
    source: "function main() {}",
  },
  "project.updateContent": {
    scriptId: "script-1",
    files: [{ name: "appsscript", type: "JSON", source: "{}" }],
  },
  "project.create": { title: "Automation" },
  "version.create": { scriptId: "script-1" },
  "deployment.create": { scriptId: "script-1", versionNumber: 1 },
  "function.run": { scriptId: "script-1", functionName: "main" },
  "process.list": { scriptId: "script-1" },
};

const imageFixtures: Record<string, Record<string, unknown>> = {
  "image.create": { prompt: "A watercolor fox" },
};

const tasksFixtures: Record<string, Record<string, unknown>> = {
  "taskList.list": {},
  "taskList.get": { taskListId: "list-1" },
  "taskList.create": { title: "Inbox" },
  "taskList.update": { taskListId: "list-1", title: "Work" },
  "taskList.delete": { taskListId: "list-1" },
  "task.create": { taskListId: "list-1", title: "Call supplier" },
  "task.get": { taskListId: "list-1", taskId: "task-1" },
  "task.list": { taskListId: "list-1" },
  "task.update": { taskListId: "list-1", taskId: "task-1", notes: "" },
  "task.delete": { taskListId: "list-1", taskId: "task-1" },
  "task.move": { taskListId: "list-1", taskId: "task-1" },
  "task.clear": { taskListId: "list-1" },
};

function assertStrictSchemaSurface(
  plugin: PluginDef,
  fixtures: Record<string, Record<string, unknown>>,
): void {
  assert.deepEqual(
    plugin.actions.map((candidate) => candidate.name),
    Object.keys(fixtures),
  );

  for (const candidate of plugin.actions) {
    const inputSchema = schema(plugin, candidate.name) as TSchema & {
      additionalProperties?: boolean;
      required?: string[];
    };
    const fixture = fixtures[candidate.name];

    assert.equal(
      inputSchema.type,
      "object",
      `${candidate.name} must use t.Object`,
    );
    assert.equal(
      inputSchema.additionalProperties,
      false,
      `${candidate.name} must reject unknown fields`,
    );
    assert.equal(
      Check(inputSchema, fixture),
      true,
      `${candidate.name} fixture must satisfy its schema`,
    );
    assert.equal(
      Check(inputSchema, { ...fixture, unexpected: true }),
      false,
      `${candidate.name} must reject unknown fields`,
    );

    for (const required of inputSchema.required ?? []) {
      const missing = { ...fixture };
      delete missing[required];
      assert.equal(
        Check(inputSchema, missing),
        false,
        `${candidate.name} must require ${required}`,
      );
    }
  }
}

describe("small Google plugin TypeBox schemas", () => {
  const appsScript = makePlugin("googleAppsScript", googleAppsScript);
  const image = makePlugin("googleImage", googleImage);
  const tasks = makePlugin("googleTasks", googleTasks);

  it("registers every action with a strict, satisfiable object schema", () => {
    assertStrictSchemaSurface(appsScript, appsScriptFixtures);
    assertStrictSchemaSurface(image, imageFixtures);
    assertStrictSchemaSurface(tasks, tasksFixtures);
    assert.equal(
      appsScript.actions.length + image.actions.length + tasks.actions.length,
      23,
    );
  });

  it("types Apps Script files, enums, JSON parameters, and numeric limits", () => {
    const files = schema(appsScript, "project.updateContent");
    assert.equal(
      Check(files, {
        scriptId: "script-1",
        files: [
          { name: "Code", type: "SERVER_JS", source: "" },
          { name: "Page", type: "HTML", source: "<p>Hello</p>" },
          { name: "appsscript", type: "JSON", source: "{}" },
        ],
      }),
      true,
    );
    assert.equal(
      Check(files, {
        scriptId: "script-1",
        files: [{ name: "Code", type: "PYTHON", source: "pass" }],
      }),
      false,
    );
    assert.equal(
      Check(files, {
        scriptId: "script-1",
        files: [{ name: "Code", type: "SERVER_JS", source: "", extra: true }],
      }),
      false,
    );
    assert.equal(Check(files, { scriptId: "script-1", files: [] }), false);
    assert.equal(
      Check(files, {
        scriptId: "script-1",
        files: [{ name: "Code", type: "SERVER_JS", source: "" }],
      }),
      false,
    );

    const run = schema(appsScript, "function.run");
    assert.equal(
      Check(run, {
        scriptId: "script-1",
        functionName: "main",
        parameters: [null, true, 3, "x", [1, 2], { nested: { ok: true } }],
        devMode: false,
      }),
      true,
    );
    assert.equal(
      Check(run, {
        scriptId: "script-1",
        functionName: "main",
        parameters: "not-an-array",
      }),
      false,
    );
    assert.equal(
      Check(run, {
        scriptId: "script-1",
        functionName: "main",
        parameters: [undefined],
      }),
      false,
    );

    const edit = schema(appsScript, "file.edit");
    assert.equal(
      Check(edit, {
        scriptId: "script-1",
        name: "Code",
        source: "",
        type: "HTML",
      }),
      true,
    );
    assert.equal(
      Check(edit, {
        scriptId: "script-1",
        name: "Code",
        source: "",
        type: "CSS",
      }),
      false,
    );

    const scripts = schema(appsScript, "script.list");
    assert.equal(Check(scripts, { pageSize: 1 }), true);
    assert.equal(Check(scripts, { pageSize: 1000 }), true);
    assert.equal(Check(scripts, { pageSize: 0 }), false);
    assert.equal(Check(scripts, { pageSize: 1.5 }), false);

    const processes = schema(appsScript, "process.list");
    assert.equal(Check(processes, { scriptId: "s", pageSize: 50 }), true);
    assert.equal(Check(processes, { scriptId: "s", pageSize: 51 }), false);

    const deploy = schema(appsScript, "deployment.create");
    assert.equal(Check(deploy, { scriptId: "s", versionNumber: 1.5 }), false);
    assert.equal(Check(deploy, { scriptId: "s", versionNumber: 0 }), false);
  });

  it("keeps Google Image models extensible while rejecting empty prompts", () => {
    const create = schema(image, "image.create");
    assert.equal(Check(create, { prompt: "" }), false);
    assert.equal(
      Check(create, {
        prompt: "A studio portrait",
        model: "future-gemini-image-model",
        saveDir: "",
      }),
      true,
    );
    assert.equal(Check(create, { prompt: 42 }), false);
  });

  it("types Tasks timestamps, statuses, pagination, and patch requirements", () => {
    const create = schema(tasks, "task.create");
    assert.equal(
      Check(create, {
        taskListId: "list-1",
        title: "Task",
        due: "2026-07-14T12:00:00Z",
        completed: 1_752_499_200_000,
        status: "completed",
      }),
      true,
    );
    assert.equal(
      Check(create, {
        taskListId: "list-1",
        title: "Task",
        status: "done",
      }),
      false,
    );
    assert.equal(
      Check(create, {
        taskListId: "list-1",
        title: "Task",
        due: { year: 2026 },
      }),
      false,
    );
    assert.equal(
      Check(create, {
        taskListId: "list-1",
        title: "Task",
        due: "",
      }),
      false,
    );

    const list = schema(tasks, "task.list");
    assert.equal(
      Check(list, { taskListId: "list-1", dueMin: 0, maxResults: 100 }),
      true,
    );
    assert.equal(Check(list, { taskListId: "list-1", maxResults: 101 }), false);
    assert.equal(
      Check(list, { taskListId: "list-1", maxResults: 1.25 }),
      false,
    );

    const update = schema(tasks, "task.update");
    assert.equal(
      Check(update, { taskListId: "list-1", taskId: "task-1" }),
      false,
    );
    assert.equal(
      Check(update, {
        taskListId: "list-1",
        taskId: "task-1",
        previous: "task-0",
      }),
      false,
    );
    assert.equal(
      Check(update, {
        taskListId: "list-1",
        taskId: "task-1",
        deleted: false,
      }),
      true,
    );
    assert.equal(
      Check(update, {
        taskListId: "list-1",
        taskId: "task-1",
        status: "needsAction",
        previous: "task-0",
      }),
      false,
    );

    const get = schema(tasks, "task.get");
    assert.equal(Check(get, { taskListId: "", taskId: "task-1" }), false);
  });
});
