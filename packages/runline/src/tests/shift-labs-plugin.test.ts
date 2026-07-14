import assert from "node:assert/strict";
import { mkdtemp, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { Check } from "typebox/value";
import shiftLabs from "../../../runline-plugins/shiftLabs/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;

const SHIFT_LABS_ACTIONS = [
  "issue.comment",
  "issue.create",
  "issue.dependency.add",
  "issue.dependency.list",
  "issue.dependency.listPage",
  "issue.dependency.remove",
  "issue.get",
  "issue.list",
  "issue.listPage",
  "issue.update",
  "issueView.create",
  "issueView.delete",
  "issueView.get",
  "issueView.issues",
  "issueView.issuesPage",
  "issueView.list",
  "issueView.listPage",
  "issueView.update",
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
  "project.create",
  "project.get",
  "project.list",
  "project.listPage",
  "project.update",
  "transcription.artifact.list",
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

  it("strictly validates the transcription service contract", () => {
    const plugin = makeShiftLabs();
    const transcriptionActions = plugin.actions.filter((action) =>
      action.name.startsWith("transcription."),
    );
    for (const action of transcriptionActions) {
      const schema = action.inputSchema as {
        type?: string;
        additionalProperties?: boolean;
      };
      assert.equal(schema.type, "object", action.name);
      assert.equal(schema.additionalProperties, false, action.name);
    }

    const transcribe = getAction(plugin, "transcription.transcribe");
    assert.ok(transcribe.inputSchema);
    assert.equal(
      Check(transcribe.inputSchema as never, {
        path: "/tmp/audio.mp3",
        name: "Standup",
        waitSeconds: 120,
      }),
      true,
    );
    assert.equal(
      Check(transcribe.inputSchema as never, {
        path: "/tmp/audio.mp3",
        name: " ",
      }),
      false,
    );
    assert.equal(
      Check(transcribe.inputSchema as never, {
        path: "/tmp/audio.mp3",
        waitSeconds: 121,
      }),
      false,
    );
    assert.equal(
      Check(transcribe.inputSchema as never, {
        path: "/tmp/audio.mp3",
        unknown: true,
      }),
      false,
    );

    const transcript = getAction(plugin, "transcription.transcript");
    assert.ok(transcript.inputSchema);
    assert.equal(
      Check(transcript.inputSchema as never, {
        jobId: "job_1",
        format: "json",
        downloadOnly: true,
      }),
      true,
    );
    assert.equal(Check(transcript.inputSchema as never, { jobId: " " }), false);
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

  it("exposes strict cursor pagination without breaking first-page list actions", async () => {
    const plugin = makeShiftLabs();
    const page = getAction(plugin, "issue.listPage");
    assert.ok(page.inputSchema);
    assert.equal(Check(page.inputSchema as never, { limit: 25 }), true);
    assert.equal(Check(page.inputSchema as never, { limit: 2.5 }), false);
    assert.equal(Check(page.inputSchema as never, { cursor: "" }), false);

    mockShift((input) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/v1/issues");
      assert.equal(url.searchParams.get("cursor"), "next_1");
      assert.equal(url.searchParams.get("limit"), "25");
      return { issues: [{ id: "issue_2" }], nextCursor: "next_2" };
    });

    assert.deepEqual(
      await page.execute({ cursor: "next_1", limit: 25 }, ctx()),
      { issues: [{ id: "issue_2" }], nextCursor: "next_2" },
    );
  });

  it("accepts structured Issue metadata and rejects no-op updates", () => {
    const plugin = makeShiftLabs();
    const create = getAction(plugin, "issue.create");
    const update = getAction(plugin, "issue.update");
    assert.equal(
      Check(create.inputSchema as never, {
        title: "Investigate",
        metadata: { source: "monitor", attempts: 3 },
      }),
      true,
    );
    assert.equal(Check(update.inputSchema as never, { id: "issue_1" }), false);
    assert.equal(
      Check(update.inputSchema as never, {
        id: "issue_1",
        archived: true,
      }),
      true,
    );
    const createView = getAction(plugin, "issueView.create");
    assert.equal(
      Check(createView.inputSchema as never, {
        name: "Shared",
        visibility: "organization",
      }),
      true,
    );
    assert.equal(
      Check(createView.inputSchema as never, {
        name: "Orphaned",
        visibility: "personal",
      }),
      false,
    );
  });

  it("creates Projects, nested Issues, and saved Issue Views", async () => {
    const plugin = makeShiftLabs();
    const project = getAction(plugin, "project.create");
    const issue = getAction(plugin, "issue.create");
    const view = getAction(plugin, "issueView.create");
    const calls: Array<{ url: string; body: unknown }> = [];

    mockShift((input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.endsWith("/v1/projects")) return { project: { id: "project_1" } };
      if (url.endsWith("/v1/issues")) return { issue: { id: "issue_1" } };
      if (url.endsWith("/v1/issue-views")) return { view: { id: "view_1" } };
      throw new Error(`unexpected request: ${url}`);
    });

    assert.deepEqual(await project.execute({ name: "Unified work" }, ctx()), {
      id: "project_1",
    });
    assert.deepEqual(
      await issue.execute(
        {
          title: "Sub-Issue",
          projectId: "project_1",
          parentIssueId: "parent_1",
        },
        ctx(),
      ),
      { id: "issue_1" },
    );
    assert.deepEqual(
      await view.execute(
        {
          name: "Project board",
          layout: "board",
          projectId: "project_1",
          groupBy: "status",
        },
        ctx(),
      ),
      { id: "view_1" },
    );
    assert.deepEqual(
      calls.map((call) => call.body),
      [
        { name: "Unified work" },
        {
          title: "Sub-Issue",
          projectId: "project_1",
          parentIssueId: "parent_1",
        },
        {
          name: "Project board",
          visibility: "organization",
          layout: "board",
          filters: { projectId: "project_1" },
          groupBy: "status",
          sortBy: ["updatedAt"],
        },
      ],
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
          upload: {
            method: "PUT",
            url: "https://uploads.invalid/asset_1",
            headers: {
              "content-type": "audio/mpeg",
              "x-upload-token": "grant-token",
            },
            expiresAt: "2026-07-14T12:15:00.000Z",
          },
        });
      }
      if (url === "https://uploads.invalid/asset_1") {
        assert.equal(init?.method, "PUT");
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("content-type"), "audio/mpeg");
        assert.equal(headers.get("x-upload-token"), "grant-token");
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

  it("rejects empty and oversized media before any network call", async () => {
    const action = getAction(makeShiftLabs(), "transcription.transcribe");
    const directory = await mkdtemp(join(tmpdir(), "shift-labs-plugin-"));
    const empty = join(directory, "empty.mp3");
    const oversized = join(directory, "oversized.mp3");
    await writeFile(empty, "");
    await writeFile(oversized, "x");
    await truncate(oversized, 5 * 1024 * 1024 * 1024 + 1);

    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("fetch should not run");
    }) as typeof fetch;

    await assert.rejects(
      () => action.execute({ path: empty }, ctx({ organizationId: "org_1" })),
      /Media file is empty/,
    );
    await assert.rejects(
      () =>
        action.execute({ path: oversized }, ctx({ organizationId: "org_1" })),
      /service limit/,
    );
    assert.equal(fetchCalls, 0);
  });

  it("lists artifact metadata from the public service route", async () => {
    const action = getAction(makeShiftLabs(), "transcription.artifact.list");

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://d1ood6y5zobtne.cloudfront.net/v1/services/transcription/jobs/job_1/artifacts",
      );
      assert.equal(init?.method, undefined);
      return { artifacts: [{ id: "artifact_1", format: "txt" }] };
    });

    assert.deepEqual(await action.execute({ jobId: "job_1" }, ctx()), [
      { id: "artifact_1", format: "txt" },
    ]);
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
          artifact: { id: "artifact_1", sizeBytes: 23 },
          download: {
            method: "GET",
            url: "https://downloads.invalid/signed",
            expiresAt: "2026-07-14T12:05:00.000Z",
          },
        });
      }
      if (url === "https://downloads.invalid/signed") {
        assert.equal(init?.method, "GET");
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

  it("returns download grants without fetching oversized transcripts", async () => {
    const action = getAction(makeShiftLabs(), "transcription.transcript");
    let downloadFetches = 0;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/jobs/job_1/artifacts/json/download")) {
        return Response.json({
          artifact: {
            id: "artifact_1",
            format: "json",
            sizeBytes: 2 * 1024 * 1024 + 1,
          },
          download: {
            method: "GET",
            url: "https://downloads.invalid/large",
            expiresAt: "2026-07-14T12:05:00.000Z",
          },
        });
      }
      downloadFetches += 1;
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;

    assert.deepEqual(
      await action.execute({ jobId: "job_1", format: "json" }, ctx()),
      {
        format: "json",
        artifact: {
          id: "artifact_1",
          format: "json",
          sizeBytes: 2 * 1024 * 1024 + 1,
        },
        download: {
          method: "GET",
          url: "https://downloads.invalid/large",
          expiresAt: "2026-07-14T12:05:00.000Z",
        },
      },
    );
    assert.equal(downloadFetches, 0);
  });

  it("measures downloaded transcript limits in UTF-8 bytes", async () => {
    const action = getAction(makeShiftLabs(), "transcription.transcript");
    const content = "א".repeat(1024 * 1024 + 1);
    const grant = {
      artifact: { id: "artifact_1", format: "txt", sizeBytes: 1 },
      download: {
        method: "GET" as const,
        url: "https://downloads.invalid/unexpected-large",
        expiresAt: "2026-07-14T12:05:00.000Z",
      },
    };

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/jobs/job_1/artifacts/txt/download")) {
        return Response.json(grant);
      }
      if (url === grant.download.url) return new Response(content);
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;

    assert.deepEqual(await action.execute({ jobId: "job_1" }, ctx()), {
      format: "txt",
      ...grant,
    });
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
