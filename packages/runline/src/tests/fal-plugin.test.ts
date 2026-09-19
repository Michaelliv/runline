import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import fal from "../../../runline-plugins/fal/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const MP4 = Buffer.from("ftypisom-not-a-real-video");

const dir = mkdtempSync(join(tmpdir(), "fal-test-"));
const sourcePath = join(dir, "source.png");
writeFileSync(sourcePath, PNG_1X1);
after(() => rmSync(dir, { recursive: true, force: true }));

function build(): PluginDef {
  const { api, resolve } = createPluginAPI("fal");
  fal(api);
  return resolve();
}

const plugin = build();

function action(name: string) {
  const found = plugin.actions.find((a) => a.name === name);
  assert.ok(found, `expected fal.${name} to be registered`);
  return found;
}

function ctx(config: Record<string, unknown> = {}): ActionContext {
  return {
    connection: {
      name: "test",
      plugin: "fal",
      config: { apiKey: "fal-test", ...config },
    },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
}

interface Call {
  url: string;
  method: string;
  auth: string | null;
  redirect: RequestRedirect | undefined;
  body: Record<string, unknown>;
}

/**
 * Stand in for the whole queue protocol: submit answers with a request id,
 * status answers COMPLETED, the response url answers `output`, and anything
 * on the CDN answers bytes.
 */
function mockQueue(
  output: unknown,
  opts: { statusError?: { error: string; error_type?: string } } = {},
): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      auth: new Headers(init?.headers).get("authorization"),
      redirect: init?.redirect,
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });

    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (url.includes("v3.fal.media")) {
      const isVideo = url.endsWith(".mp4");
      return new Response(isVideo ? MP4 : PNG_1X1, {
        status: 200,
        headers: { "content-type": isVideo ? "video/mp4" : "image/png" },
      });
    }
    if (url.endsWith("/status") || url.includes("/status?")) {
      return json({
        status: "COMPLETED",
        request_id: "req-1",
        ...opts.statusError,
      });
    }
    if (url.endsWith("/cancel"))
      return json({ status: "CANCELLATION_REQUESTED" }, 202);
    if (url.includes("/requests/")) return json(output);
    assert.equal(method, "POST", `unexpected queue request ${url}`);
    return json({
      request_id: "req-1",
      status_url: "https://queue.fal.run/x/requests/req-1/status",
      response_url: "https://queue.fal.run/x/requests/req-1",
      cancel_url: "https://queue.fal.run/x/requests/req-1/cancel",
      queue_position: 0,
    });
  }) as typeof fetch;
  return calls;
}

const IMAGE_OUTPUT = {
  images: [
    { url: "https://v3.fal.media/files/a/out.png", content_type: "image/png" },
  ],
  seed: 42,
};

describe("fal plugin surface", () => {
  it("registers the typed actions, the escape hatch, and the queue lifecycle", () => {
    const names = plugin.actions.map((a) => a.name).sort();
    assert.deepEqual(names, [
      "image.create",
      "image.edit",
      "queue.cancel",
      "queue.result",
      "queue.status",
      "queue.submit",
      "run",
      "video.create",
    ]);
  });

  it("marks generation and file writes as write, and status as read", () => {
    const access = Object.fromEntries(
      plugin.actions.map((a) => [a.name, a.access]),
    );
    assert.equal(access["image.create"], "write");
    assert.equal(access["image.edit"], "write");
    assert.equal(access["video.create"], "write");
    assert.equal(access.run, "write");
    assert.equal(access["queue.submit"], "write");
    assert.equal(access["queue.cancel"], "write");
    assert.equal(access["queue.status"], "read");
    assert.equal(access["queue.result"], "write");
  });
});

describe("fal auth and transport", () => {
  it("sends the key as `Key <k>` and never lets a redirect carry it away", async () => {
    const calls = mockQueue(IMAGE_OUTPUT);
    await action("image.create").execute(
      { prompt: "a cat", saveDir: dir },
      ctx(),
    );

    const api = calls.filter((c) => c.url.startsWith("https://queue.fal.run"));
    assert.equal(
      api.length,
      3,
      "submit, status and result, without a redundant status read",
    );
    for (const call of api) {
      assert.equal(call.auth, "Key fal-test");
      assert.equal(call.redirect, "error");
    }
  });

  it("downloads the artifact without the key, because fal's CDN is public and redirects", async () => {
    const calls = mockQueue(IMAGE_OUTPUT);
    await action("image.create").execute(
      { prompt: "a cat", saveDir: dir },
      ctx(),
    );

    const download = calls.find((c) => c.url.includes("v3.fal.media"));
    assert.ok(download, "expected the CDN download");
    assert.equal(download.auth, null);
    assert.equal(download.redirect, "manual");
  });

  it("names the missing key rather than sending `Key undefined`", async () => {
    mockQueue(IMAGE_OUTPUT);
    await assert.rejects(
      () =>
        action("image.create").execute({ prompt: "x" }, {
          connection: { name: "t", plugin: "fal", config: {} },
          log: { info() {}, warn() {}, error() {} },
          async updateConnection() {},
        } as ActionContext),
      /FAL_KEY/,
    );
  });

  it("refuses a model id that would retarget the request", async () => {
    mockQueue(IMAGE_OUTPUT);
    for (const model of [
      "flux",
      "/fal-ai/flux",
      "fal-ai/flux?x=1",
      "fal-ai/flux/",
      "fal-ai/../other",
      "fal-ai/flux/.",
    ]) {
      await assert.rejects(
        () => action("run").execute({ model, input: {} }, ctx()),
        /invalid model id/,
        `expected ${model} to be refused`,
      );
    }
  });
});

describe("fal image.create", () => {
  it("submits prompt and num_images to the flux default and writes the file", async () => {
    const calls = mockQueue(IMAGE_OUTPUT);
    const out = (await action("image.create").execute(
      { prompt: "a samurai", saveDir: dir },
      ctx(),
    )) as { model: string; requestId: string; images: Array<{ path: string }> };

    const submit = calls[0];
    assert.equal(submit.url, "https://queue.fal.run/fal-ai/flux/schnell");
    assert.equal(submit.method, "POST");
    assert.deepEqual(submit.body, { prompt: "a samurai", num_images: 1 });
    assert.equal(out.model, "fal-ai/flux/schnell");
    assert.equal(out.requestId, "req-1");
    assert.equal(out.images.length, 1);
    assert.deepEqual(readFileSync(out.images[0].path), PNG_1X1);
  });

  it("sends WxH as image_size, and omits it entirely when size is not given", async () => {
    let calls = mockQueue(IMAGE_OUTPUT);
    await action("image.create").execute(
      { prompt: "x", size: "1280x720", saveDir: dir },
      ctx(),
    );
    assert.deepEqual(calls[0].body.image_size, { width: 1280, height: 720 });

    calls = mockQueue(IMAGE_OUTPUT);
    await action("image.create").execute({ prompt: "x", saveDir: dir }, ctx());
    assert.ok(
      !("image_size" in calls[0].body),
      "no size means the model picks its own default",
    );
  });

  it("lets extraInput override anything the action set", async () => {
    const calls = mockQueue(IMAGE_OUTPUT);
    await action("image.create").execute(
      {
        prompt: "x",
        n: 1,
        saveDir: dir,
        extraInput: { num_images: 4, seed: 7, output_format: "png" },
      },
      ctx(),
    );
    assert.equal(calls[0].body.num_images, 4);
    assert.equal(calls[0].body.seed, 7);
    assert.equal(calls[0].body.output_format, "png");
  });
});

describe("fal image.edit", () => {
  it("sends the source as a data URI under image_url by default", async () => {
    const calls = mockQueue(IMAGE_OUTPUT);
    await action("image.edit").execute(
      { prompt: "make it winter", imagePath: sourcePath, saveDir: dir },
      ctx(),
    );
    assert.equal(calls[0].url, "https://queue.fal.run/fal-ai/flux-pro/kontext");
    assert.ok(
      String(calls[0].body.image_url).startsWith("data:image/png;base64,"),
    );
  });

  it("sends an array when the key ends in _urls, as nano-banana expects", async () => {
    const calls = mockQueue(IMAGE_OUTPUT);
    await action("image.edit").execute(
      {
        prompt: "combine",
        imagePath: sourcePath,
        model: "fal-ai/nano-banana/edit",
        imageInputKey: "image_urls",
        saveDir: dir,
      },
      ctx(),
    );
    const urls = calls[0].body.image_urls;
    assert.ok(Array.isArray(urls), "image_urls should be an array");
    assert.ok(String(urls[0]).startsWith("data:image/png;base64,"));
  });
});

describe("fal video.create", () => {
  it("writes an .mp4 from the video field, not the images field", async () => {
    mockQueue({
      video: {
        url: "https://v3.fal.media/files/a/out.mp4",
        content_type: "video/mp4",
      },
    });
    const out = (await action("video.create").execute(
      { prompt: "a fjord", saveDir: dir },
      ctx(),
    )) as { videos: Array<{ path: string; mimeType: string }> };

    assert.equal(out.videos.length, 1);
    assert.ok(out.videos[0].path.endsWith(".mp4"), out.videos[0].path);
    assert.equal(out.videos[0].mimeType, "video/mp4");
    assert.deepEqual(readFileSync(out.videos[0].path), MP4);
  });
});

describe("fal run", () => {
  it("passes input through untouched and returns the raw output", async () => {
    const calls = mockQueue({ text: "hello world" });
    const out = (await action("run").execute(
      { model: "fal-ai/whisper", input: { audio_url: "https://x.test/a.mp3" } },
      ctx(),
    )) as { output: Record<string, unknown>; files?: unknown };

    assert.equal(calls[0].url, "https://queue.fal.run/fal-ai/whisper");
    assert.deepEqual(calls[0].body, { audio_url: "https://x.test/a.mp3" });
    assert.deepEqual(out.output, { text: "hello world" });
    assert.equal(out.files, undefined, "no media means no files key");
  });

  it("still saves media when the model happens to return some", async () => {
    mockQueue(IMAGE_OUTPUT);
    const out = (await action("run").execute(
      { model: "fal-ai/flux/schnell", input: { prompt: "x" }, saveDir: dir },
      ctx(),
    )) as { files: Array<{ path: string }> };
    assert.equal(out.files.length, 1);
  });
});

describe("fal queue lifecycle", () => {
  it("submit returns the id without waiting", async () => {
    const calls = mockQueue(IMAGE_OUTPUT);
    const out = (await action("queue.submit").execute(
      { model: "fal-ai/veo3", input: { prompt: "x" } },
      ctx(),
    )) as { requestId: string };

    assert.equal(out.requestId, "req-1");
    assert.equal(calls.length, 1, "submit must not poll");
  });

  it("status builds the per-model url and asks for logs only when told", async () => {
    let calls = mockQueue(IMAGE_OUTPUT);
    await action("queue.status").execute(
      { model: "fal-ai/flux/schnell", requestId: "req-1" },
      ctx(),
    );
    assert.equal(
      calls[0].url,
      "https://queue.fal.run/fal-ai/flux/requests/req-1/status",
    );

    calls = mockQueue(IMAGE_OUTPUT);
    await action("queue.status").execute(
      { model: "fal-ai/flux/schnell", requestId: "req-1", logs: true },
      ctx(),
    );
    assert.ok(calls[0].url.endsWith("/status?logs=1"), calls[0].url);
  });

  it("cancel PUTs to the cancel path", async () => {
    const calls = mockQueue(IMAGE_OUTPUT);
    await action("queue.cancel").execute(
      { model: "fal-ai/veo3", requestId: "req-1" },
      ctx(),
    );
    assert.equal(calls[0].method, "PUT");
    assert.ok(calls[0].url.endsWith("/requests/req-1/cancel"), calls[0].url);
  });

  it("preserves the live API's already-completed cancellation status", async () => {
    globalThis.fetch = (async () =>
      Response.json(
        { status: "ALREADY_COMPLETED" },
        { status: 400 },
      )) as typeof fetch;
    await assert.rejects(
      () =>
        action("queue.cancel").execute(
          { model: "fal-ai/flux/schnell", requestId: "req-1" },
          ctx(),
        ),
      /fal 400: ALREADY_COMPLETED/,
    );
  });

  it("result collects the output and downloads its media", async () => {
    mockQueue(IMAGE_OUTPUT);
    const out = (await action("queue.result").execute(
      { model: "fal-ai/flux/schnell", requestId: "req-1", saveDir: dir },
      ctx(),
    )) as { output: Record<string, unknown>; files: Array<{ path: string }> };
    assert.equal(out.output.seed, 42);
    assert.equal(out.files.length, 1);
  });
});

describe("fal validation and edge cases", () => {
  it("validates typed inputs before execution", () => {
    const schema = action("image.create").inputSchema as TSchema;
    assert.ok(Check(schema, { prompt: "cat", size: "1024x768" }));
    for (const value of [
      { prompt: " " },
      { prompt: "cat", n: 1.5 },
      { prompt: "cat", size: "1.5x2" },
      { prompt: "cat", timeoutMs: -1 },
      { prompt: "cat", typo: true },
    ]) {
      assert.equal(Check(schema, value), false);
    }
  });

  it("uses the application path for every operation, including namespaces", async () => {
    for (const [model, base] of [
      ["fal-ai/flux/schnell", "fal-ai/flux"],
      ["workflows/owner/app/variant", "workflows/owner/app"],
      ["comfy/owner/app/variant", "comfy/owner/app"],
    ]) {
      for (const [name, suffix] of [
        ["queue.status", "/status"],
        ["queue.result", ""],
        ["queue.cancel", "/cancel"],
      ]) {
        const calls = mockQueue({ text: "done" });
        await action(name).execute({ model, requestId: "req-1" }, ctx());
        assert.equal(
          calls[0].url,
          `https://queue.fal.run/${base}/requests/req-1${suffix}`,
        );
      }
    }
  });

  it("refuses unsafe request ids on every queue operation before sending", async () => {
    const calls = mockQueue({});
    for (const name of ["queue.status", "queue.result", "queue.cancel"]) {
      for (const requestId of [".", "..", "", "a/b", "x?y"]) {
        await assert.rejects(
          () =>
            action(name).execute(
              { model: "fal-ai/flux/schnell", requestId },
              ctx(),
            ),
          /invalid request id/,
        );
      }
    }
    assert.equal(calls.length, 0);
  });

  it("rejects malformed status responses", async () => {
    for (const body of [null, {}, { status: "UNKNOWN" }]) {
      globalThis.fetch = (async () => Response.json(body)) as typeof fetch;
      await assert.rejects(
        () =>
          action("queue.status").execute(
            { model: "fal-ai/flux", requestId: "req-1" },
            ctx(),
          ),
        /invalid queue status/,
      );
    }
  });

  it("does not label video output as images", async () => {
    mockQueue({ video: { url: "https://v3.fal.media/out.mp4" } });
    await assert.rejects(
      () => action("image.create").execute({ prompt: "x" }, ctx()),
      /no media.*req-1/,
    );
  });

  it("rejects off-CDN URLs and unchecked redirect targets without fetching them", async () => {
    for (const url of [
      "https://127.0.0.1/private",
      "https://fal.media.evil.test/x",
      "https://v3.fal.media:444/x",
      "file:///etc/passwd",
    ]) {
      const calls = mockQueue({ images: [{ url }] });
      await assert.rejects(
        () => action("image.create").execute({ prompt: "x" }, ctx()),
        /fal.media URL/,
      );
      assert.equal(calls.length, 3);
    }
    const calls = mockQueue(IMAGE_OUTPUT);
    const queueFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("v3.fal.media"))
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/private" },
        });
      return queueFetch(url, init);
    }) as typeof fetch;
    await assert.rejects(
      () => action("image.create").execute({ prompt: "x" }, ctx()),
      /fal.media URL/,
    );
    assert.equal(calls.length, 3);
  });

  it("follows validated CDN redirects without credentials", async () => {
    mockQueue(IMAGE_OUTPUT);
    const queueFetch = globalThis.fetch;
    let downloads = 0;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("v3.fal.media")) {
        downloads++;
        assert.equal(new Headers(init?.headers).get("authorization"), null);
        return downloads === 1
          ? new Response(null, {
              status: 302,
              headers: { location: "/final.png" },
            })
          : new Response(PNG_1X1, { headers: { "content-type": "image/png" } });
      }
      return queueFetch(url, init);
    }) as typeof fetch;
    await action("image.create").execute({ prompt: "x", saveDir: dir }, ctx());
    assert.equal(downloads, 2);
  });

  it("reports partial downloads and deduplicates repeated references", async () => {
    mockQueue({
      images: [
        IMAGE_OUTPUT.images[0],
        IMAGE_OUTPUT.images[0],
        { url: "https://v3.fal.media/bad.png" },
      ],
    });
    const queueFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) =>
      String(url).endsWith("bad.png")
        ? new Response(null, { status: 404 })
        : queueFetch(url, init)) as typeof fetch;
    const out = (await action("image.create").execute(
      { prompt: "x", saveDir: dir },
      ctx(),
    )) as { images: unknown[]; failures: unknown[] };
    assert.equal(out.images.length, 1);
    assert.equal(out.failures.length, 1);
  });

  it("rejects oversized downloads before reading their body", async () => {
    mockQueue(IMAGE_OUTPUT);
    const queueFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) =>
      String(url).includes("v3.fal.media")
        ? new Response(PNG_1X1, {
            headers: { "content-length": String(513 * 1024 * 1024) },
          })
        : queueFetch(url, init)) as typeof fetch;
    await assert.rejects(
      () => action("image.create").execute({ prompt: "x" }, ctx()),
      /512 MiB.*req-1/,
    );
  });
});

describe("fal polling and response safety", () => {
  it("polls pending states and retrieves the result only after completion", async () => {
    const calls = mockQueue(IMAGE_OUTPUT);
    const queueFetch = globalThis.fetch;
    const states = ["IN_QUEUE", "IN_PROGRESS", "COMPLETED"];
    let polls = 0;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/status"))
        return Response.json({ status: states[polls++] });
      if (String(url).endsWith("/requests/req-1")) assert.equal(polls, 3);
      return queueFetch(url, init);
    }) as typeof fetch;
    await action("image.create").execute({ prompt: "x", saveDir: dir }, ctx());
    assert.equal(polls, 3);
    assert.equal(calls.filter((c) => c.method === "POST").length, 1);
  });

  it("stops a chunked download at the byte limit and cancels its reader", async () => {
    mockQueue(IMAGE_OUTPUT);
    const queueFetch = globalThis.fetch;
    const chunk = new Uint8Array(1024 * 1024);
    let cancelled = false;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) =>
      String(url).includes("v3.fal.media")
        ? new Response(
            new ReadableStream({
              pull(controller) {
                controller.enqueue(chunk);
              },
              cancel() {
                cancelled = true;
              },
            }),
          )
        : queueFetch(url, init)) as typeof fetch;
    await assert.rejects(
      () => action("image.create").execute({ prompt: "x" }, ctx()),
      /512 MiB/,
    );
    assert.ok(cancelled);
  });

  it("refuses redirected API responses even when the fetch hook ignores redirect:error", async () => {
    globalThis.fetch = (async () =>
      new Response(null, { status: 302 })) as typeof fetch;
    await assert.rejects(
      () =>
        action("queue.submit").execute(
          { model: "fal-ai/flux", input: {} },
          ctx(),
        ),
      /Refusing a redirect/,
    );
  });

  it("retains the request id on result failures without resubmitting", async () => {
    const calls = mockQueue(IMAGE_OUTPUT);
    const queueFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) =>
      String(url).endsWith("/requests/req-1")
        ? new Response("gateway down", { status: 503 })
        : queueFetch(url, init)) as typeof fetch;
    await assert.rejects(
      () =>
        action("run").execute(
          { model: "fal-ai/flux/schnell", input: {} },
          ctx(),
        ),
      /503.*requestId req-1/,
    );
    assert.equal(calls.filter((c) => c.method === "POST").length, 1);
  });
});

describe("fal failure reporting", () => {
  it("rejects an image result without media", async () => {
    mockQueue({ images: [] });
    await assert.rejects(
      () => action("image.create").execute({ prompt: "x" }, ctx()),
      /no media/,
    );
  });

  it("rejects a malformed submit receipt without polling", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return Response.json({});
    }) as typeof fetch;
    await assert.rejects(
      () =>
        action("queue.submit").execute(
          { model: "fal-ai/flux/schnell", input: {} },
          ctx(),
        ),
      /no request id/,
    );
    assert.equal(calls, 1);
  });

  it("saves inline data URI output", async () => {
    mockQueue({
      images: [{ url: `data:image/png;base64,${PNG_1X1.toString("base64")}` }],
    });
    const queueFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) =>
      String(url).startsWith("data:")
        ? originalFetch(url, init)
        : queueFetch(url, init)) as typeof fetch;
    const output = (await action("image.create").execute(
      { prompt: "x", saveDir: dir },
      ctx(),
    )) as { images: { path: string }[] };
    assert.deepEqual(readFileSync(output.images[0].path), PNG_1X1);
  });

  it("aborts a stalled status request and retains its request id", async () => {
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST")
        return Response.json({ request_id: "stalled" });
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      });
    }) as typeof fetch;
    await assert.rejects(
      () =>
        action("run").execute(
          { model: "fal-ai/flux/schnell", input: {}, timeoutMs: 1000 },
          ctx(),
        ),
      /timed out.*requestId stalled/,
    );
  });
  it("surfaces a COMPLETED-but-failed request instead of returning its body as output", async () => {
    mockQueue(IMAGE_OUTPUT, {
      statusError: { error: "out of credits", error_type: "internal_error" },
    });
    await assert.rejects(
      () => action("image.create").execute({ prompt: "x" }, ctx()),
      /out of credits.*internal_error/,
    );
  });

  it("reads fal's array-shaped validation errors down to field and type", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          detail: [
            {
              loc: ["body", "prompt"],
              msg: "Field required",
              type: "missing",
            },
          ],
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    await assert.rejects(
      () =>
        action("run").execute(
          { model: "fal-ai/flux/schnell", input: {} },
          ctx(),
        ),
      /fal 422: body\.prompt: Field required \[missing\]/,
    );
  });

  it("reads fal's string-shaped infrastructure errors too", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          detail: "Request timed out",
          error_type: "request_timeout",
        }),
        { status: 504, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    await assert.rejects(
      () =>
        action("run").execute(
          { model: "fal-ai/flux/schnell", input: {} },
          ctx(),
        ),
      /fal 504: Request timed out \[request_timeout\]/,
    );
  });

  it("reports a failed download rather than claiming success with fewer files", async () => {
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.includes("v3.fal.media"))
        return new Response("nope", { status: 404 });
      const json = (p: unknown) =>
        new Response(JSON.stringify(p), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url.endsWith("/status")) return json({ status: "COMPLETED" });
      if (url.includes("/requests/")) return json(IMAGE_OUTPUT);
      void init;
      return json({
        request_id: "req-1",
        status_url: "s",
        response_url: "r",
        cancel_url: "c",
      });
    }) as typeof fetch;

    await assert.rejects(
      () => action("image.create").execute({ prompt: "x" }, ctx()),
      /none could be downloaded.*404/s,
    );
  });

  it("points at queue.result when it gives up waiting, because the work continues", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (p: unknown) =>
        new Response(JSON.stringify(p), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url.endsWith("/status"))
        return json({ status: "IN_QUEUE", queue_position: 3 });
      return json({
        request_id: "req-1",
        status_url: "s",
        response_url: "r",
        cancel_url: "c",
      });
    }) as typeof fetch;

    await assert.rejects(
      () =>
        action("image.create").execute({ prompt: "x", timeoutMs: 1000 }, ctx()),
      /fal\.queue\.result.*req-1/s,
    );
  });
});
