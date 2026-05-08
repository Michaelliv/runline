/**
 * Replicate image generation for runline.
 *
 *   await replicate.image.create({ prompt: "a samurai under cherry blossoms" })
 *   await replicate.image.create({
 *     prompt: "studio portrait, soft lighting",
 *     model: "stability-ai/stable-diffusion-3.5-large",
 *     size: "1024x1024",
 *   })
 *
 * Default model is black-forest-labs/flux-dev. Any text-to-image
 * Replicate model that accepts `prompt` / `width` / `height` /
 * `num_outputs` works the same way.
 *
 * Predictions are created with `Prefer: wait` so simple jobs return
 * synchronously; anything still processing is polled until terminal
 * or until `timeoutMs` elapses (default: 5 minutes). Output URLs are
 * downloaded and base64-encoded so callers don't have to fetch them
 * separately.
 */

import { Buffer } from "node:buffer";
import type { RunlinePluginAPI } from "runline";
import { parseSize } from "../../_shared/parseSize.js";

const POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

interface CreateInput {
  prompt: string;
  model?: string;
  size?: string;
  n?: number;
  timeoutMs?: number;
}

interface Prediction {
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string | string[];
  error?: unknown;
  urls: { get: string };
}

function stringifyError(err: unknown): string {
  if (err == null) return "unknown error";
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export default function replicate(rl: RunlinePluginAPI) {
  rl.setName("replicate");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiToken: {
      type: "string",
      required: true,
      description: "Replicate API token",
      env: "REPLICATE_API_TOKEN",
    },
  });

  rl.registerAction("image.create", {
    description:
      "Generate an image via Replicate. Default model is black-forest-labs/flux-dev. Returns base64 bytes from the model's output URLs.",
    inputSchema: {
      prompt: {
        type: "string",
        required: true,
        description: "Detailed description of the image",
      },
      model: {
        type: "string",
        required: false,
        description:
          "Replicate model id, e.g. black-forest-labs/flux-dev (default), black-forest-labs/flux-schnell, stability-ai/stable-diffusion-3.5-large",
      },
      size: {
        type: "string",
        required: false,
        description: "WxH (default: 1024x1024)",
      },
      n: {
        type: "number",
        required: false,
        description: "Number of images (default: 1, max: 4)",
      },
      timeoutMs: {
        type: "number",
        required: false,
        description:
          "Max ms to wait for the prediction to finish (default: 300000 = 5 minutes)",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as CreateInput;
      if (typeof p.prompt !== "string" || p.prompt.length === 0) {
        throw new Error("replicate: prompt is required");
      }

      const apiToken = ctx.connection.config.apiToken as string;
      const model = p.model ?? "black-forest-labs/flux-dev";
      const { width, height } = parseSize(p.size, "replicate");
      const timeoutMs = p.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const deadline = Date.now() + timeoutMs;

      const createRes = await fetch(
        `https://api.replicate.com/v1/models/${model}/predictions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiToken}`,
            // `Prefer: wait` lets the server hold the connection open for
            // fast jobs so we don't have to poll at all on the happy path.
            Prefer: "wait",
          },
          body: JSON.stringify({
            input: {
              prompt: p.prompt,
              width,
              height,
              num_outputs: Math.min(p.n ?? 1, 4),
            },
          }),
        },
      );
      if (!createRes.ok) {
        throw new Error(
          `Replicate API error ${createRes.status}: ${await createRes.text()}`,
        );
      }

      let prediction = (await createRes.json()) as Prediction;
      while (
        prediction.status !== "succeeded" &&
        prediction.status !== "failed" &&
        prediction.status !== "canceled"
      ) {
        if (Date.now() >= deadline) {
          throw new Error(
            `Replicate generation timed out after ${timeoutMs}ms (still ${prediction.status})`,
          );
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const pollRes = await fetch(prediction.urls.get, {
          headers: { Authorization: `Bearer ${apiToken}` },
        });
        if (!pollRes.ok) {
          throw new Error(
            `Replicate poll error ${pollRes.status}: ${await pollRes.text()}`,
          );
        }
        prediction = (await pollRes.json()) as Prediction;
      }

      if (prediction.status !== "succeeded") {
        throw new Error(
          `Replicate generation ${prediction.status}: ${stringifyError(prediction.error)}`,
        );
      }

      // Output is either a single URL or an array of them. Download
      // each and base64-encode so the caller gets bytes back, not
      // pre-signed URLs that expire. Track per-URL failures and
      // surface them: silent partial success would let an agent
      // think it got 3 images when one 404'd.
      const outputs = Array.isArray(prediction.output)
        ? prediction.output
        : prediction.output
          ? [prediction.output]
          : [];

      const images: Array<{ base64: string; mimeType: string }> = [];
      const failures: Array<{ url: string; reason: string }> = [];
      for (const url of outputs) {
        if (typeof url !== "string") {
          failures.push({ url: String(url), reason: "non-string output" });
          continue;
        }
        const imgRes = await fetch(url);
        if (!imgRes.ok) {
          failures.push({
            url,
            reason: `download failed (${imgRes.status})`,
          });
          continue;
        }
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const contentType = (imgRes.headers.get("content-type") ?? "image/webp")
          .split(";")[0]
          .trim();
        images.push({ base64: buf.toString("base64"), mimeType: contentType });
      }

      if (images.length === 0 && outputs.length > 0) {
        const detail = failures.map((f) => `${f.url}: ${f.reason}`).join("; ");
        throw new Error(
          `Replicate succeeded but all ${outputs.length} output URLs failed to download — ${detail}`,
        );
      }

      const result: {
        provider: "replicate";
        model: string;
        images: Array<{ base64: string; mimeType: string }>;
        failures?: Array<{ url: string; reason: string }>;
      } = { provider: "replicate", model, images };
      if (failures.length > 0) result.failures = failures;
      return result;
    },
  });
}
