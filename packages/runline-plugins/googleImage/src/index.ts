/**
 * Google Gemini image generation (Nano Banana / Imagen) for runline.
 *
 * Distinct from the rest of the googleX family — those wrap Workspace
 * APIs over OAuth2, this one wraps Generative Language over a single
 * API key. Kept under the `googleImage` namespace so it doesn't
 * collide with `googleDrive`, `googleDocs`, etc.
 *
 *   const { images } = await googleImage.image.create({ prompt: "a watercolor fox" })
 *   // images[0].path -> "/tmp/googleImage-….png"
 *
 * Generated images are written to disk and the action returns their file
 * `path`s — never raw base64, which bloats the agent context and is
 * stripped before delivery. Hand each `path` to the host's file-sending
 * tool (e.g. send_file) to deliver the image.
 *
 * Nano Banana supports conversational editing — chain prompts in
 * follow-up calls and it'll keep iterating on the last image.
 */

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunlinePluginAPI } from "runline";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface CreateInput {
  prompt: string;
  model?: string;
  saveDir?: string;
}

interface GeminiPart {
  inlineData?: { data: string; mimeType?: string };
  text?: string;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
}

export default function googleImage(rl: RunlinePluginAPI) {
  rl.setName("googleImage");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Google AI API key (Gemini)",
      env: "GOOGLE_API_KEY",
    },
  });

  rl.registerAction("image.create", {
    description:
      "Generate an image with Google's Gemini image models (Nano Banana / Imagen). Writes the image(s) to disk and returns their file `path`s — not base64. Deliver each image to the user with send_file using its `path`.",
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
          "gemini-2.5-flash-image (Nano Banana, default) | gemini-3-pro-image-preview | gemini-3.1-flash-image-preview",
      },
      saveDir: {
        type: "string",
        required: false,
        description: "Directory to write the image file(s) into. Defaults to the OS temp dir.",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as CreateInput;
      if (typeof p.prompt !== "string" || p.prompt.length === 0) {
        throw new Error("googleImage: prompt is required");
      }

      const apiKey = ctx.connection.config.apiKey as string;
      const model = p.model ?? "gemini-2.5-flash-image";

      const url = `${BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const body = {
        contents: [{ parts: [{ text: p.prompt }] }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`Google API error ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as GeminiResponse;
      const dir = (typeof p.saveDir === "string" && p.saveDir.trim()) || tmpdir();
      const stamp = Date.now();
      const images: Array<{ path: string; mimeType: string; byteLength: number }> = [];
      for (const candidate of data.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (part.inlineData?.data) {
            const mimeType = part.inlineData.mimeType ?? "image/png";
            const ext = mimeType.includes("jpeg") ? "jpg" : mimeType.split("/")[1] || "png";
            const bytes = Buffer.from(part.inlineData.data, "base64");
            const path = join(dir, `googleImage-${stamp}-${images.length}.${ext}`);
            writeFileSync(path, bytes);
            images.push({ path, mimeType, byteLength: bytes.length });
          }
        }
      }
      return {
        provider: "googleImage",
        model,
        images,
        note: "Image(s) written to disk. Deliver each to the user with send_file using its `path`.",
      };
    },
  });
}
