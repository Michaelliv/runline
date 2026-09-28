/**
 * Every caller-supplied ID in a Google plugin reaches its request path as
 * exactly one segment: a separator is refused before anything is signed,
 * and a query or fragment character is encoded into the segment.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import gmail from "../../../runline-plugins/gmail/src/index.js";
import googleAppsScript from "../../../runline-plugins/googleAppsScript/src/index.js";
import googleCalendar from "../../../runline-plugins/googleCalendar/src/index.js";
import googleContacts from "../../../runline-plugins/googleContacts/src/index.js";
import googleDocs from "../../../runline-plugins/googleDocs/src/index.js";
import googleDrive from "../../../runline-plugins/googleDrive/src/index.js";
import googleSheets from "../../../runline-plugins/googleSheets/src/index.js";
import googleSlides from "../../../runline-plugins/googleSlides/src/index.js";
import googleTasks from "../../../runline-plugins/googleTasks/src/index.js";
import type { AuthenticatedRequest } from "../credentials/transport.js";
import { createPluginAPI, type PluginFunction } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

function run(
  name: string,
  plugin: PluginFunction,
  action: string,
  input: Record<string, unknown>,
) {
  const { api, resolve } = createPluginAPI(name);
  plugin(api);
  const found = resolve().actions.find((a) => a.name === action);
  assert.ok(found, `expected ${name}.${action} to be registered`);
  const requests: AuthenticatedRequest[] = [];
  const ctx: ActionContext = {
    connection: { name, plugin: name, config: {} },
    credentials: {
      async request(request) {
        requests.push(request);
        return Response.json({});
      },
      async probe() {
        return { outcome: "unverified" };
      },
    },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
  return { result: Promise.resolve(found.execute(input, ctx)), requests };
}

const cases: Array<[string, PluginFunction, string, Record<string, unknown>]> =
  [
    [
      "googleAppsScript",
      googleAppsScript,
      "project.getContent",
      { scriptId: "a?b" },
    ],
    [
      "googleTasks",
      googleTasks,
      "task.get",
      { taskListId: "l", taskId: "a?b" },
    ],
    ["googleTasks", googleTasks, "taskList.get", { taskListId: "a/b" }],
    ["googleSlides", googleSlides, "presentation.get", { presentation: "a?b" }],
    [
      "googleSlides",
      googleSlides,
      "page.get",
      { presentation: "p", pageObjectId: "a/b" },
    ],
    ["googleContacts", googleContacts, "contact.get", { contactId: "a?b" }],
    [
      "googleContacts",
      googleContacts,
      "group.get",
      { groupId: "contactGroups/a/b" },
    ],
    ["googleDocs", googleDocs, "document.get", { document: "a?b" }],
    ["googleCalendar", googleCalendar, "calendar.get", { calendarId: "a?b" }],
    [
      "googleCalendar",
      googleCalendar,
      "event.get",
      { calendarId: "c", eventId: "a?b" },
    ],
    [
      "googleCalendar",
      googleCalendar,
      "acl.delete",
      { calendarId: "c", ruleId: "a/b" },
    ],
    ["googleCalendar", googleCalendar, "settings.get", { setting: "a/b" }],
    ["gmail", gmail, "message.get", { id: "a?b" }],
    ["gmail", gmail, "thread.get", { id: "a/b" }],
    ["gmail", gmail, "draft.get", { id: "a?b" }],
    ["gmail", gmail, "label.get", { id: "a#b" }],
    [
      "gmail",
      gmail,
      "message.getAttachment",
      { messageId: "m", attachmentId: "a?b" },
    ],
    ["googleSheets", googleSheets, "spreadsheet.get", { spreadsheetId: "a?b" }],
    [
      "googleSheets",
      googleSheets,
      "sheet.read",
      { spreadsheetId: "s", range: "Sheet1!A1?b" },
    ],
    ["googleDrive", googleDrive, "file.get", { fileId: "a?b" }],
    [
      "googleDrive",
      googleDrive,
      "comment.get",
      { fileId: "f", commentId: "a/b" },
    ],
    ["googleDrive", googleDrive, "drive.get", { driveId: "a?b" }],
    [
      "googleDrive",
      googleDrive,
      "permission.update",
      { fileId: "f", permissionId: "a?b", role: "reader" },
    ],
  ];

describe("Google path IDs", () => {
  for (const [name, plugin, action, input] of cases) {
    const id = Object.values(input).find(
      (value): value is string =>
        typeof value === "string" && /[?#/]/.test(value),
    );
    assert.ok(id);
    it(`${name}.${action} keeps ${JSON.stringify(id)} within one segment`, async () => {
      const { result, requests } = run(name, plugin, action, input);
      if (id.includes("/")) {
        await assert.rejects(result, { code: "request_not_allowed" });
        assert.deepEqual(requests, []);
        return;
      }
      await result;
      assert.ok(requests.length > 0);
      for (const request of requests)
        assert.ok(
          request.path.split("?")[0].includes(encodeURIComponent(id)),
          request.path,
        );
    });
  }

  it("still encodes an ordinary ID as one segment", async () => {
    const { result, requests } = run("gmail", gmail, "message.get", {
      id: "abc 123",
    });
    await result;
    assert.equal(requests[0].path, "messages/abc%20123?format=full");
  });
});
