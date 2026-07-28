import assert from "node:assert/strict";
import { mkdtemp, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { Check } from "typebox/value";
import shiftTranscription from "../../../runline-plugins/shiftTranscription/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;

const SHIFT_TRANSCRIPTION_ACTIONS = [
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

function makeShiftTranscription(): PluginDef {
  const { api, resolve } = createPluginAPI("shiftTranscription");
  shiftTranscription(api);
  return resolve();
}

function getAction(plugin: PluginDef, name: string) {
  const action = plugin.actions.find((a) => a.name === name);
  assert.ok(action, `expected shiftTranscription.${name} to be registered`);
  return action;
}

function ctx(): ActionContext {
  return {
    connection: {
      name: "shiftTranscription",
      plugin: "shiftTranscription",
      config: { apiKey: "shift_test" },
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

describe("shiftTranscription plugin", () => {
  it("registers the transcription surface", () => {
    const plugin = makeShiftTranscription();
    assert.equal(plugin.name, "shiftTranscription");
    assert.deepEqual(plugin.actions.map((a) => a.name).sort(), [
      ...SHIFT_TRANSCRIPTION_ACTIONS,
    ]);
  });

  it("strictly validates every action schema", () => {
    for (const action of makeShiftTranscription().actions) {
      const schema = action.inputSchema as {
        type?: string;
        additionalProperties?: boolean;
      };
      assert.equal(schema.type, "object", action.name);
      assert.equal(schema.additionalProperties, false, action.name);
    }
  });

  it("strictly validates the transcription service contract", () => {
    const plugin = makeShiftTranscription();
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

    assert.equal(
      Check(transcribe.inputSchema as never, {
        path: "/tmp/audio.mp3",
        metadata: { meeting: "standup", attendees: 4 },
      }),
      true,
    );

    const transcript = getAction(plugin, "transcription.transcript");
    assert.ok(transcript.inputSchema);
    assert.equal(
      Check(transcript.inputSchema as never, {
        id: "job_1",
        format: "json",
        downloadOnly: true,
      }),
      true,
    );
    assert.equal(Check(transcript.inputSchema as never, { id: " " }), false);
    // Path parameters are named id everywhere, never jobId.
    for (const name of [
      "transcription.transcript",
      "transcription.artifact.list",
    ]) {
      const properties = Object.keys(
        (
          getAction(plugin, name).inputSchema as {
            properties?: Record<string, unknown>;
          }
        ).properties ?? {},
      );
      assert.equal(properties.includes("jobId"), false, name);
      assert.equal(properties.includes("id"), true, name);
    }
  });

  it("transcribes a local file end to end: asset, upload, complete, job", async () => {
    const action = getAction(
      makeShiftTranscription(),
      "transcription.transcribe",
    );
    const directory = await mkdtemp(join(tmpdir(), "shift-transcription-"));
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
        // The API key is the tenant authority; no organizationId is sent.
        assert.deepEqual(JSON.parse(String(init?.body)), {
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
          assetId: "asset_1",
          language: "he",
          diarize: true,
          name: "Standup",
          metadata: { meeting: "standup" },
        });
        return Response.json({ id: "job_1", status: "queued" });
      }
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;

    assert.deepEqual(
      await action.execute(
        {
          path: media,
          language: "he",
          diarize: true,
          name: "Standup",
          metadata: { meeting: "standup" },
        },
        ctx(),
      ),
      { id: "job_1", status: "queued" },
    );
    assert.equal(calls.length, 4);
  });

  it("rejects unsupported media extensions before any network call", async () => {
    const action = getAction(
      makeShiftTranscription(),
      "transcription.transcribe",
    );
    await assert.rejects(
      () => action.execute({ path: "/tmp/document.pdf" }, ctx()),
      /Unsupported media extension/,
    );
  });

  it("rejects empty and oversized media before any network call", async () => {
    const action = getAction(
      makeShiftTranscription(),
      "transcription.transcribe",
    );
    const directory = await mkdtemp(join(tmpdir(), "shift-transcription-"));
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
      () => action.execute({ path: empty }, ctx()),
      /Media file is empty/,
    );
    await assert.rejects(
      () => action.execute({ path: oversized }, ctx()),
      /service limit/,
    );
    assert.equal(fetchCalls, 0);
  });

  it("lists artifact metadata from the public service route", async () => {
    const action = getAction(
      makeShiftTranscription(),
      "transcription.artifact.list",
    );

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://cloud.shift-labs.ai/v1/services/transcription/jobs/job_1/artifacts",
      );
      assert.equal(init?.method, undefined);
      return { artifacts: [{ id: "artifact_1", format: "txt" }] };
    });

    assert.deepEqual(await action.execute({ id: "job_1" }, ctx()), [
      { id: "artifact_1", format: "txt" },
    ]);
  });

  it("fetches transcripts through a signed download grant", async () => {
    const action = getAction(
      makeShiftTranscription(),
      "transcription.transcript",
    );

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

    assert.deepEqual(await action.execute({ id: "job_1" }, ctx()), {
      format: "txt",
      content: "Speaker 1: hello world\n",
    });
  });

  it("returns download grants without fetching oversized transcripts", async () => {
    const action = getAction(
      makeShiftTranscription(),
      "transcription.transcript",
    );
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
      await action.execute({ id: "job_1", format: "json" }, ctx()),
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
    const action = getAction(
      makeShiftTranscription(),
      "transcription.transcript",
    );
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

    assert.deepEqual(await action.execute({ id: "job_1" }, ctx()), {
      format: "txt",
      ...grant,
    });
  });
});
