import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import jenkins from "../../../runline-plugins/jenkins/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";
import { stubFetch } from "./helpers/plugin.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const ctx: ActionContext = {
  connection: {
    name: "jenkins",
    plugin: "jenkins",
    config: {
      baseUrl: "https://jenkins.example.com",
      username: "u",
      apiToken: "t",
    },
  },
  log: { info() {}, warn() {}, error() {} },
  async updateConnection() {},
};

function trigger(jobName: string) {
  const { api, resolve } = createPluginAPI("jenkins");
  jenkins(api);
  const action = resolve().actions.find((a) => a.name === "job.trigger");
  assert.ok(action);
  return Promise.resolve(action.execute({ jobName }, ctx));
}

describe("jenkins job names", () => {
  it("addresses a nested job by its folder/job/name path, each segment encoded", async () => {
    const urls: string[] = [];
    stubFetch(async (url) => {
      urls.push(String(url));
      return new Response(null, { status: 201 });
    });
    await trigger("folder/job/my job");
    await trigger("a?b");
    assert.deepEqual(urls, [
      "https://jenkins.example.com/job/folder/job/my%20job/build",
      "https://jenkins.example.com/job/a%3Fb/build",
    ]);
  });

  it("refuses an empty segment before any request", async () => {
    stubFetch(async () => {
      throw new Error("no request expected");
    });
    await assert.rejects(trigger("folder//x"), { code: "request_not_allowed" });
  });
});
