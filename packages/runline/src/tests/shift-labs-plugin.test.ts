import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import shiftLabs from "../../../runline-plugins/shiftLabs/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;

const SHIFT_LABS_ACTIONS = [
  "issue.comment",
  "issue.create",
  "issue.get",
  "issue.list",
  "page.archive",
  "page.create",
  "page.get",
  "page.list",
  "page.publish",
  "page.renderUrl",
  "page.revokeShare",
  "page.share",
  "page.shares",
  "page.update",
  "transcription.job.cancel",
  "transcription.job.get",
  "transcription.job.list",
  "transcription.transcribe",
  "transcription.transcript",
] as const;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeShiftLabs(): PluginDef {
  const { api, resolve } = createPluginAPI("shiftLabs");
  shiftLabs(api);
  return resolve();
}

function getAction(plugin: PluginDef, name: string) {
  const action = plugin.actions.find((a) => a.name === name);
  assert.ok(action, `expected shiftLabs.${name} to be registered`);
  return action;
}

function ctx(config: Record<string, unknown> = {}): ActionContext {
  return {
    connection: {
      name: "shiftLabs",
      plugin: "shiftLabs",
      config: {
        apiKey: "shift_test",
        ...config,
      },
    },
    log: {
      info() {},
      warn() {},
      error() {},
    },
    async updateConnection() {},
  };
}

function mockShift(assertRequest: (input: URL, init?: RequestInit) => unknown) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const data = assertRequest(input as URL, init);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("shiftLabs plugin", () => {
  it("registers one Shift Labs plugin with issue and page actions", () => {
    const plugin = makeShiftLabs();
    assert.equal(plugin.name, "shiftLabs");
    assert.deepEqual(plugin.actions.map((a) => a.name).sort(), [
      ...SHIFT_LABS_ACTIONS,
    ]);
  });

  it("does not expose issue.report or issue lifecycle transitions in v1", () => {
    const names = new Set(makeShiftLabs().actions.map((a) => a.name));
    for (const name of [
      "issue.report",
      "issue.resolve",
      "issue.close",
      "issue.reopen",
    ]) {
      assert.equal(names.has(name), false);
    }
  });

  it("creates issues with bearer auth and default organization", async () => {
    const action = getAction(makeShiftLabs(), "issue.create");

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://d1ood6y5zobtne.cloudfront.net/v1/issues",
      );
      assert.equal(init?.method, "POST");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer shift_test");
      assert.equal(headers.get("x-shift-org-id"), null);
      assert.deepEqual(JSON.parse(String(init?.body)), {
        title: "Broken sync",
        description: "It failed",
      });
      return { issue: { id: "issue_1", title: "Broken sync" } };
    });

    assert.deepEqual(
      await action.execute(
        { title: "Broken sync", description: "It failed" },
        ctx(),
      ),
      { id: "issue_1", title: "Broken sync" },
    );
  });

  it("adds issue comments", async () => {
    const action = getAction(makeShiftLabs(), "issue.comment");

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://d1ood6y5zobtne.cloudfront.net/v1/issues/issue_1/comments",
      );
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { body: "Looking" });
      return { event: { id: "event_1", body: "Looking" } };
    });

    assert.deepEqual(
      await action.execute({ id: "issue_1", body: "Looking" }, ctx()),
      { id: "event_1", body: "Looking" },
    );
  });

  it("creates hosted HTML pages by default", async () => {
    const action = getAction(makeShiftLabs(), "page.create");

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://d1ood6y5zobtne.cloudfront.net/v1/pages",
      );
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        type: "hosted_html",
        visibility: "org",
        slug: "investor-update",
        title: "Investor Update",
        html: "<h1>Q2</h1>",
      });
      return { page: { id: "page_1", slug: "investor-update" } };
    });

    assert.deepEqual(
      await action.execute(
        {
          slug: "investor-update",
          title: "Investor Update",
          html: "<h1>Q2</h1>",
        },
        ctx(),
      ),
      { id: "page_1", slug: "investor-update" },
    );
  });

  it("publishes pages", async () => {
    const action = getAction(makeShiftLabs(), "page.publish");

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://d1ood6y5zobtne.cloudfront.net/v1/pages/page_1/publish",
      );
      assert.equal(init?.method, "POST");
      return { page: { id: "page_1", status: "published" } };
    });

    assert.deepEqual(await action.execute({ id: "page_1" }, ctx()), {
      id: "page_1",
      status: "published",
    });
  });

  it("transcribes a local file end to end: asset, upload, complete, job", async () => {
    const action = getAction(makeShiftLabs(), "transcription.transcribe");
    const directory = await mkdtemp(join(tmpdir(), "shift-labs-plugin-"));
    const media = join(directory, "standup.mp3");
    await writeFile(media, "media-bytes");

    const calls: string[] = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/v1/services/transcription/assets")) {
        assert.deepEqual(JSON.parse(String(init?.body)), {
          organizationId: "org_1",
          contentType: "audio/mpeg",
          sizeBytes: 11,
        });
        return Response.json({
          asset: { id: "asset_1" },
          upload: { url: "https://uploads.invalid/asset_1", headers: {} },
        });
      }
      if (url === "https://uploads.invalid/asset_1") {
        assert.equal(init?.method, "PUT");
        return new Response(null, { status: 200 });
      }
      if (url.endsWith("/assets/asset_1/complete")) {
        return Response.json({ id: "asset_1", status: "ready" });
      }
      if (url.endsWith("/v1/services/transcription/jobs")) {
        assert.deepEqual(JSON.parse(String(init?.body)), {
          organizationId: "org_1",
          assetId: "asset_1",
          language: "he",
          diarize: true,
          name: "Standup",
        });
        return Response.json({ id: "job_1", status: "queued" });
      }
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;

    assert.deepEqual(
      await action.execute(
        { path: media, language: "he", diarize: true, name: "Standup" },
        ctx({ organizationId: "org_1" }),
      ),
      { id: "job_1", status: "queued" },
    );
    assert.equal(calls.length, 4);
  });

  it("requires the organization ID for transcription actions", async () => {
    const action = getAction(makeShiftLabs(), "transcription.transcribe");
    await assert.rejects(
      () => action.execute({ path: "/tmp/a.mp3" }, ctx()),
      /SHIFT_LABS_ORG_ID/,
    );
  });

  it("rejects unsupported media extensions before any network call", async () => {
    const action = getAction(makeShiftLabs(), "transcription.transcribe");
    await assert.rejects(
      () =>
        action.execute(
          { path: "/tmp/document.pdf" },
          ctx({ organizationId: "org_1" }),
        ),
      /Unsupported media extension/,
    );
  });

  it("fetches transcripts through a signed download grant", async () => {
    const action = getAction(makeShiftLabs(), "transcription.transcript");

    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.endsWith("/jobs/job_1/artifacts/txt/download")) {
        assert.equal(init?.method, "POST");
        return Response.json({
          download: { url: "https://downloads.invalid/signed" },
        });
      }
      if (url === "https://downloads.invalid/signed") {
        return new Response("Speaker 1: hello world\n");
      }
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;

    assert.deepEqual(
      await action.execute(
        { jobId: "job_1" },
        ctx({ organizationId: "org_1" }),
      ),
      { format: "txt", content: "Speaker 1: hello world\n" },
    );
  });

  it("builds render URLs from the fetched page's organization", async () => {
    const action = getAction(makeShiftLabs(), "page.renderUrl");

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://d1ood6y5zobtne.cloudfront.net/v1/pages/page_1",
      );
      assert.equal(init?.method, undefined);
      return {
        page: { organizationId: "org_from_api", slug: "investor-update" },
      };
    });

    assert.deepEqual(await action.execute({ pageId: "page_1" }, ctx()), {
      url: "https://d1ood6y5zobtne.cloudfront.net/pages/org_from_api/investor-update",
    });
  });
});
