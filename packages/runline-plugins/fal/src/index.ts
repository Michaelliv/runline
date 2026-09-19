import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { readImageInput } from "../../_shared/mediaFile.js";
import { parseSize } from "../../_shared/parseSize.js";
import {
  assertModelId,
  type Ctx,
  cancel,
  DEFAULT_TIMEOUT_MS,
  extraInputSchema,
  result,
  runModel,
  STRICT,
  saveDirSchema,
  savedResult,
  status,
  submit,
  timeoutSchema,
} from "./shared.js";

const IMAGE_MODEL = "fal-ai/flux/schnell";
const EDIT_MODEL = "fal-ai/flux-pro/kontext";
const VIDEO_MODEL = "fal-ai/kling-video/v1/standard/text-to-video";
const model = t.String({
  minLength: 1,
  description:
    "fal endpoint id: owner/model[/variant], workflows/owner/model, or comfy/owner/model.",
});
const prompt = t.String({
  minLength: 1,
  pattern: "\\S",
  description: "Describe the image, edit, or video.",
});
const fileOptions = { saveDir: t.Optional(saveDirSchema) };
const generationOptions = {
  ...fileOptions,
  timeoutMs: t.Optional(timeoutSchema),
  extraInput: t.Optional(extraInputSchema),
};
const createSchema = t.Object(
  {
    ...generationOptions,
    prompt,
    model: t.Optional(t.String({ ...model, default: IMAGE_MODEL })),
    size: t.Optional(
      t.String({
        pattern: "^[1-9][0-9]*x[1-9][0-9]*$",
        description:
          "WxH, sent as image_size. Omit for the model's default. For other size fields use extraInput.",
      }),
    ),
    n: t.Optional(
      t.Integer({
        minimum: 1,
        maximum: 4,
        default: 1,
        description: "num_images; supported counts depend on the model.",
      }),
    ),
  },
  STRICT,
);
const editSchema = t.Object(
  {
    ...generationOptions,
    prompt,
    model: t.Optional(t.String({ ...model, default: EDIT_MODEL })),
    imagePath: t.String({
      minLength: 1,
      description:
        "Local source image, sent as a data URI. For hosted input URLs use fal.run instead.",
    }),
    imageInputKey: t.Optional(
      t.String({
        minLength: 1,
        default: "image_url",
        description:
          "Source field; keys ending in _urls receive an array. Use image_urls for fal-ai/nano-banana/edit.",
      }),
    ),
  },
  STRICT,
);
const videoSchema = t.Object(
  {
    ...generationOptions,
    prompt,
    model: t.Optional(t.String({ ...model, default: VIDEO_MODEL })),
  },
  STRICT,
);
const modelInput = {
  model,
  input: t.Record(t.String(), t.Unknown(), {
    description:
      "Model input body, verbatim. See https://fal.ai/models/<model>/api.",
  }),
};
const runSchema = t.Object(
  { ...modelInput, ...fileOptions, timeoutMs: t.Optional(timeoutSchema) },
  STRICT,
);
const submitSchema = t.Object(modelInput, STRICT);
const requestInput = {
  model,
  requestId: t.String({
    minLength: 1,
    description: "Request id returned by queue.submit or a timeout error.",
  }),
};
const statusInput = t.Object(
  { ...requestInput, logs: t.Optional(t.Boolean({ default: false })) },
  STRICT,
);
const resultInput = t.Object({ ...requestInput, ...fileOptions }, STRICT);
const cancelInput = t.Object(requestInput, STRICT);

type Generation = t.Static<typeof videoSchema>;
async function generate(
  ctx: Ctx,
  p: Generation,
  model: string,
  input: Record<string, unknown>,
  kind: "images" | "videos",
) {
  const id = assertModelId(model);
  const { output, requestId } = await runModel(
    ctx,
    id,
    { ...input, ...p.extraInput },
    p.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  return savedResult(output, id, requestId, p.saveDir, kind);
}

/** fal model inference via its queue API. Generation is billed; downloads return local paths. */
export default function fal(rl: RunlinePluginAPI): void {
  rl.setName("fal");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema(
    t.Object({
      apiKey: t.String({
        minLength: 1,
        env: "FAL_KEY",
        description:
          "API key from https://fal.ai/dashboard/keys, sent as Authorization: Key <key>.",
      }),
    }),
  );

  rl.registerAction("image.create", {
    access: "write",
    description: `Generate images through fal (billed). Defaults to ${IMAGE_MODEL}. Saves files and returns images[].path for send_file. Additional model parameters go in extraInput.`,
    inputSchema: createSchema,
    async execute(input, ctx) {
      const p = input as t.Static<typeof createSchema>;
      return generate(
        ctx,
        p,
        p.model ?? IMAGE_MODEL,
        {
          prompt: p.prompt,
          num_images: p.n ?? 1,
          ...(p.size ? { image_size: parseSize(p.size, "fal") } : {}),
        },
        "images",
      );
    },
  });
  rl.registerAction("image.edit", {
    access: "write",
    description: `Edit a local image through fal (billed). Defaults to ${EDIT_MODEL}, using image_url. For fal-ai/nano-banana/edit set imageInputKey to image_urls. Returns images[].path.`,
    inputSchema: editSchema,
    async execute(input, ctx) {
      const p = input as t.Static<typeof editSchema>;
      const image = readImageInput(p.imagePath, "fal");
      const key = p.imageInputKey ?? "image_url";
      return generate(
        ctx,
        p,
        p.model ?? EDIT_MODEL,
        {
          prompt: p.prompt,
          [key]: key.endsWith("_urls") ? [image.dataUri] : image.dataUri,
        },
        "images",
      );
    },
  });
  rl.registerAction("video.create", {
    access: "write",
    description: `Generate a video through fal (billed). Defaults to ${VIDEO_MODEL}; override model and supply its parameters in extraInput. Returns videos[].path. For long jobs prefer queue.submit to avoid host execution deadlines.`,
    inputSchema: videoSchema,
    async execute(input, ctx) {
      const p = input as t.Static<typeof videoSchema>;
      return generate(
        ctx,
        p,
        p.model ?? VIDEO_MODEL,
        { prompt: p.prompt },
        "videos",
      );
    },
  });
  rl.registerAction("run", {
    access: "write",
    description:
      "Run a fal endpoint with its model-specific input (billed), and wait. Returns raw output plus downloaded files from common top-level image/video/audio/file fields. Automatic downloads accept HTTPS fal.media URLs or data URIs only, up to 512 MiB per file; JSON responses are limited to 32 MiB.",
    inputSchema: runSchema,
    async execute(input, ctx) {
      const p = input as t.Static<typeof runSchema>;
      const id = assertModelId(p.model);
      const { output, requestId } = await runModel(
        ctx,
        id,
        p.input,
        p.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      return savedResult(output, id, requestId, p.saveDir);
    },
  });
  rl.registerAction("queue.submit", {
    access: "write",
    description:
      "Submit billed model work and return immediately. Save model and requestId, poll queue.status, then collect with queue.result. No client-side retries: repeating a submission can bill twice.",
    inputSchema: submitSchema,
    async execute(input, ctx) {
      const p = input as t.Static<typeof submitSchema>;
      const id = assertModelId(p.model);
      const receipt = await submit(ctx, id, p.input);
      return {
        model: id,
        requestId: receipt.request_id,
        queuePosition: receipt.queue_position,
      };
    },
  });
  rl.registerAction("queue.status", {
    access: "read",
    description:
      "Read queue state (IN_QUEUE, IN_PROGRESS, COMPLETED), optionally including logs. COMPLETED can indicate failure; inspect error/error_type or retrieve the result.",
    inputSchema: statusInput,
    async execute(input, ctx) {
      const p = input as t.Static<typeof statusInput>;
      return status(ctx, p.model, p.requestId, p.logs);
    },
  });
  rl.registerAction("queue.result", {
    access: "write",
    description:
      "Retrieve completed output without re-running or re-billing. Writes common image/video/audio/file outputs to disk and returns files[].path. Download limits: HTTPS fal.media URLs or data URIs, 512 MiB per file, 60 seconds per file; JSON responses up to 32 MiB.",
    inputSchema: resultInput,
    async execute(input, ctx) {
      const p = input as t.Static<typeof resultInput>;
      const id = assertModelId(p.model);
      return savedResult(
        await result(ctx, id, p.requestId),
        id,
        p.requestId,
        p.saveDir,
      );
    },
  });
  rl.registerAction("queue.cancel", {
    access: "write",
    description:
      "Request cancellation. Queued work is removed; in-progress work may still finish and incur charges. Fails if already completed or missing.",
    inputSchema: cancelInput,
    async execute(input, ctx) {
      const p = input as t.Static<typeof cancelInput>;
      return cancel(ctx, p.model, p.requestId);
    },
  });
}
