import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import googleImage from "../../../runline-plugins/googleImage/src/index.js";
import openai from "../../../runline-plugins/openai/src/index.js";
import recraft from "../../../runline-plugins/recraft/src/index.js";
import replicate from "../../../runline-plugins/replicate/src/index.js";
import together from "../../../runline-plugins/together/src/index.js";
import xai from "../../../runline-plugins/xai/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type {
  ActionContext,
  PluginDef,
  RunlinePluginAPI,
} from "../plugin/types.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// A real 1x1 transparent PNG so readImageInput has bytes to load.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const dir = mkdtempSync(join(tmpdir(), "image-edit-test-"));
const sourcePath = join(dir, "source.png");
writeFileSync(sourcePath, PNG_1X1);

function makePlugin(
  name: string,
  fn: (api: RunlinePluginAPI) => void,
): PluginDef {
  const { api, resolve } = createPluginAPI(name);
  fn(api);
  return resolve();
}

function getAction(plugin: PluginDef, name: string) {
  const action = plugin.actions.find((a) => a.name === name);
  assert.ok(action, `expected ${plugin.name}.${name} to be registered`);
  return action;
}

function ctx(config: Record<string, unknown>): ActionContext {
  return {
    connection: { name: "test", plugin: "test", config },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
}

const B64_RESULT = PNG_1X1.toString("base64");

describe("image.edit is registered on every image plugin", () => {
  const plugins: Array<[string, (api: RunlinePluginAPI) => void]> = [
    ["openai", openai],
    ["googleImage", googleImage],
    ["xai", xai],
    ["recraft", recraft],
    ["together", together],
    ["replicate", replicate],
  ];
  for (const [name, fn] of plugins) {
    it(`${name} registers image.edit alongside image.create`, () => {
      const plugin = makePlugin(name, fn);
      assert.ok(plugin.actions.some((a) => a.name === "image.create"));
      assert.ok(plugin.actions.some((a) => a.name === "image.edit"));
    });
  }
});

describe("openai image.edit", () => {
  it("POSTs multipart form to /v1/images/edits with image file and prompt", async () => {
    const action = getAction(makePlugin("openai", openai), "image.edit");
    let seen: { url: string; form?: FormData } = { url: "" };
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      seen = { url: String(input), form: init?.body as FormData };
      return new Response(
        JSON.stringify({ data: [{ b64_json: B64_RESULT }] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    const result = (await action.execute(
      { prompt: "make the sky red", imagePath: sourcePath, saveDir: dir },
      ctx({ apiKey: "sk-test" }),
    )) as { images: Array<{ path: string }> };

    assert.equal(seen.url, "https://api.openai.com/v1/images/edits");
    assert.ok(seen.form instanceof FormData);
    assert.equal(seen.form?.get("prompt"), "make the sky red");
    assert.equal(seen.form?.get("model"), "gpt-image-2.5-flare");
    const file = seen.form?.get("image[]");
    assert.ok(file instanceof Blob, "image[] should be a file part");
    assert.equal(result.images.length, 1);
  });

  it("prefers the per-call model, then the connection default", async () => {
    const action = getAction(makePlugin("openai", openai), "image.edit");
    const seen: string[] = [];
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      seen.push(String((init?.body as FormData).get("model")));
      return new Response(
        JSON.stringify({ data: [{ b64_json: B64_RESULT }] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    const base = { prompt: "x", imagePath: sourcePath, saveDir: dir };
    await action.execute(
      { ...base, model: "gpt-image-2.5-sunburst" },
      ctx({ apiKey: "sk-test", defaultModel: "gpt-image-2" }),
    );
    await action.execute(
      base,
      ctx({ apiKey: "sk-test", defaultModel: "gpt-image-2" }),
    );

    assert.deepEqual(seen, ["gpt-image-2.5-sunburst", "gpt-image-2"]);
  });

  it("forwards the 2.5-only quality and size values untouched", async () => {
    const action = getAction(makePlugin("openai", openai), "image.edit");
    let form: FormData | undefined;
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      form = init?.body as FormData;
      return new Response(
        JSON.stringify({ data: [{ b64_json: B64_RESULT }] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    await action.execute(
      {
        prompt: "sharpen the label",
        imagePath: sourcePath,
        model: "gpt-image-2.5-sunburst",
        quality: "max",
        size: "1536x864",
        saveDir: dir,
      },
      ctx({ apiKey: "sk-test" }),
    );

    assert.equal(form?.get("model"), "gpt-image-2.5-sunburst");
    assert.equal(form?.get("quality"), "max");
    assert.equal(form?.get("size"), "1536x864");
  });

  it("rejects when neither imagePath nor imagePaths is given", async () => {
    const action = getAction(makePlugin("openai", openai), "image.edit");
    await assert.rejects(
      () => action.execute({ prompt: "x" }, ctx({ apiKey: "sk-test" })),
      /imagePath/,
    );
  });
});

describe("openai image.create", () => {
  // Captures the JSON body of each generations call and answers with one image.
  function captureBodies(): Record<string, unknown>[] {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ data: [{ b64_json: B64_RESULT }] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;
    return bodies;
  }

  it("defaults to gpt-image-2.5-flare", async () => {
    const action = getAction(makePlugin("openai", openai), "image.create");
    const bodies = captureBodies();

    const result = (await action.execute(
      { prompt: "a red bicycle", saveDir: dir },
      ctx({ apiKey: "sk-test" }),
    )) as { model: string };

    assert.equal(bodies[0]?.model, "gpt-image-2.5-flare");
    assert.equal(result.model, "gpt-image-2.5-flare");
  });

  it("prefers the per-call model, then the connection default", async () => {
    const action = getAction(makePlugin("openai", openai), "image.create");
    const bodies = captureBodies();

    await action.execute(
      { prompt: "x", model: "gpt-image-2.5-sunburst", saveDir: dir },
      ctx({ apiKey: "sk-test", defaultModel: "gpt-image-2" }),
    );
    await action.execute(
      { prompt: "x", saveDir: dir },
      ctx({ apiKey: "sk-test", defaultModel: "gpt-image-2" }),
    );

    assert.deepEqual(
      bodies.map((b) => b.model),
      ["gpt-image-2.5-sunburst", "gpt-image-2"],
    );
  });

  it("treats both gpt-image-2.5 models as the gpt-image line (output_format, not response_format)", async () => {
    const action = getAction(makePlugin("openai", openai), "image.create");
    const bodies = captureBodies();

    for (const model of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
      await action.execute(
        { prompt: "x", model, saveDir: dir },
        ctx({ apiKey: "sk-test" }),
      );
    }

    for (const body of bodies) {
      assert.equal(body.output_format, "png");
      assert.equal(body.response_format, undefined);
    }
  });

  it("forwards the 2.5-only quality and size values untouched", async () => {
    const action = getAction(makePlugin("openai", openai), "image.create");
    const bodies = captureBodies();

    await action.execute(
      {
        prompt: "a wide banner",
        model: "gpt-image-2.5-flare",
        quality: "xhigh",
        size: "1536x864",
        saveDir: dir,
      },
      ctx({ apiKey: "sk-test" }),
    );
    await action.execute(
      { prompt: "pick for me", quality: "auto", size: "auto", saveDir: dir },
      ctx({ apiKey: "sk-test" }),
    );

    assert.equal(bodies[0]?.quality, "xhigh");
    assert.equal(bodies[0]?.size, "1536x864");
    assert.equal(bodies[1]?.quality, "auto");
    assert.equal(bodies[1]?.size, "auto");
  });

  it("still speaks response_format to the dall-e line", async () => {
    const action = getAction(makePlugin("openai", openai), "image.create");
    const bodies = captureBodies();

    await action.execute(
      { prompt: "x", model: "dall-e-3", saveDir: dir },
      ctx({ apiKey: "sk-test" }),
    );

    assert.equal(bodies[0]?.response_format, "b64_json");
    assert.equal(bodies[0]?.output_format, undefined);
  });

  it("documents both gpt-image-2.5 models on the model inputs", () => {
    const plugin = makePlugin("openai", openai);
    for (const name of ["image.create", "image.edit"]) {
      const schema = getAction(plugin, name).inputSchema as Record<
        string,
        { description?: string }
      >;
      for (const model of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
        assert.ok(
          schema.model?.description?.includes(model),
          `${name}.model should mention ${model}`,
        );
      }
      assert.ok(schema.quality?.description?.includes("xhigh"));
      assert.ok(schema.quality?.description?.includes("max"));
    }
  });
});

describe("googleImage image.edit", () => {
  it("sends the image inline next to the instruction", async () => {
    const action = getAction(
      makePlugin("googleImage", googleImage),
      "image.edit",
    );
    let body: {
      contents?: Array<{ parts?: Array<Record<string, unknown>> }>;
    } = {};
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { data: B64_RESULT, mimeType: "image/png" } },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const result = (await action.execute(
      { prompt: "replace the label", imagePath: sourcePath, saveDir: dir },
      ctx({ apiKey: "g-test" }),
    )) as { images: Array<{ path: string }> };

    const parts = body.contents?.[0]?.parts ?? [];
    assert.equal(parts[0]?.text, "replace the label");
    const inline = parts[1]?.inlineData as { data?: string; mimeType?: string };
    assert.equal(inline?.data, PNG_1X1.toString("base64"));
    assert.equal(inline?.mimeType, "image/png");
    assert.equal(result.images.length, 1);
  });

  it("throws when the model returns no image", async () => {
    const action = getAction(
      makePlugin("googleImage", googleImage),
      "image.edit",
    );
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ candidates: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    await assert.rejects(
      () =>
        action.execute(
          { prompt: "x", imagePath: sourcePath },
          ctx({ apiKey: "g-test" }),
        ),
      /no edited image/,
    );
  });
});

describe("xai image.edit", () => {
  it("POSTs JSON (not multipart) to /v1/images/edits with a data-URI image", async () => {
    const action = getAction(makePlugin("xai", xai), "image.edit");
    let seen: {
      url: string;
      contentType?: string;
      body?: Record<string, unknown>;
    } = {
      url: "",
    };
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      seen = {
        url: String(input),
        contentType: (init?.headers as Record<string, string>)?.[
          "Content-Type"
        ],
        body: JSON.parse(String(init?.body)),
      };
      return new Response(
        JSON.stringify({ data: [{ b64_json: B64_RESULT }] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    await action.execute(
      { prompt: "make it night", imagePath: sourcePath, saveDir: dir },
      ctx({ apiKey: "x-test" }),
    );

    assert.equal(seen.url, "https://api.x.ai/v1/images/edits");
    assert.equal(seen.contentType, "application/json");
    assert.equal(seen.body?.model, "grok-imagine-image-2.0");
    const image = seen.body?.image as { url?: string };
    assert.ok(image?.url?.startsWith("data:image/png;base64,"));
  });
});

describe("recraft image.edit", () => {
  it("POSTs multipart form to /v1/images/imageToImage with strength", async () => {
    const action = getAction(makePlugin("recraft", recraft), "image.edit");
    let seen: { url: string; form?: FormData } = { url: "" };
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      seen = { url: String(input), form: init?.body as FormData };
      return new Response(
        JSON.stringify({ data: [{ b64_json: B64_RESULT }] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    await action.execute(
      { prompt: "winter", imagePath: sourcePath, strength: 0.4, saveDir: dir },
      ctx({ apiKey: "r-test" }),
    );

    assert.equal(
      seen.url,
      "https://external.api.recraft.ai/v1/images/imageToImage",
    );
    assert.ok(seen.form instanceof FormData);
    assert.equal(seen.form?.get("prompt"), "winter");
    assert.equal(seen.form?.get("strength"), "0.4");
    assert.ok(seen.form?.get("image") instanceof Blob);
  });
});

describe("together image.edit", () => {
  it("sends image_url data URI to the generations endpoint with a Kontext default", async () => {
    const action = getAction(makePlugin("together", together), "image.edit");
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ data: [{ b64_json: B64_RESULT }] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    await action.execute(
      { prompt: "anime style", imagePath: sourcePath, saveDir: dir },
      ctx({ apiKey: "t-test" }),
    );

    assert.equal(body.model, "black-forest-labs/FLUX.1-kontext-pro");
    assert.ok(String(body.image_url).startsWith("data:image/png;base64,"));
    assert.equal(body.steps, 28);
  });
});

describe("replicate image.edit", () => {
  it("creates a prediction with input_image data URI and downloads the output", async () => {
    const action = getAction(makePlugin("replicate", replicate), "image.edit");
    let predictionBody: { input?: Record<string, unknown> } = {};
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.includes("api.replicate.com")) {
        predictionBody = JSON.parse(String(init?.body));
        assert.ok(
          url.endsWith(
            "/models/black-forest-labs/flux-kontext-pro/predictions",
          ),
          `unexpected prediction URL: ${url}`,
        );
        return new Response(
          JSON.stringify({
            status: "succeeded",
            output: "https://cdn.replicate.test/out.png",
            urls: { get: "https://api.replicate.com/v1/predictions/p1" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // Output download.
      return new Response(PNG_1X1, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch;

    const result = (await action.execute(
      { prompt: "remove the cat", imagePath: sourcePath, saveDir: dir },
      ctx({ apiToken: "rep-test" }),
    )) as { images: Array<{ path: string }> };

    assert.equal(predictionBody.input?.prompt, "remove the cat");
    assert.ok(
      String(predictionBody.input?.input_image).startsWith(
        "data:image/png;base64,",
      ),
    );
    assert.equal(result.images.length, 1);
  });

  it("sends array-valued image input when the key ends in _input", async () => {
    const action = getAction(makePlugin("replicate", replicate), "image.edit");
    let predictionBody: { input?: Record<string, unknown> } = {};
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.includes("api.replicate.com")) {
        predictionBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            status: "succeeded",
            output: "https://cdn.replicate.test/out.png",
            urls: { get: "https://api.replicate.com/v1/predictions/p1" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(PNG_1X1, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch;

    await action.execute(
      {
        prompt: "combine",
        imagePath: sourcePath,
        model: "google/nano-banana",
        imageInputKey: "image_input",
        saveDir: dir,
      },
      ctx({ apiToken: "rep-test" }),
    );

    const arr = predictionBody.input?.image_input;
    assert.ok(Array.isArray(arr), "image_input should be an array");
    assert.ok(String(arr[0]).startsWith("data:image/png;base64,"));
  });
});
