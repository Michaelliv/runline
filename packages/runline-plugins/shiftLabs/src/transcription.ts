import { openAsBlob } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  type Ctx,
  enumSchema,
  pathSegment,
  request,
  TRANSCRIPT_FORMAT,
  TRANSCRIPTION_LANGUAGE,
} from "./shared.js";

const MEDIA_TYPES: Record<string, string> = {
  aac: "audio/aac",
  flac: "audio/flac",
  m4a: "audio/m4a",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  webm: "video/webm",
  mov: "video/quicktime",
};

/** Transcript previews returned into the sandbox are capped, not truncated silently. */
const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;

function organizationId(ctx: Ctx): string {
  const value = ctx.connection.config.organizationId;
  if (typeof value !== "string" || !value) {
    throw new Error(
      "SHIFT_LABS_ORG_ID is not set. Transcription actions need the organization ID that owns the API key.",
    );
  }
  return value;
}

function mediaTypeFor(path: string): string {
  const mediaType = MEDIA_TYPES[extname(path).slice(1).toLowerCase()];
  if (!mediaType) {
    throw new Error(
      `Unsupported media extension for ${path}. Supported: ${Object.keys(MEDIA_TYPES).join(", ")}`,
    );
  }
  return mediaType;
}

async function fileBody(path: string, sizeBytes: number): Promise<BodyInit> {
  try {
    return await openAsBlob(path);
  } catch {
    // Runtimes without fs.openAsBlob fall back to buffering; refuse to
    // buffer files that would strain the host process.
    if (sizeBytes > 512 * 1024 * 1024) {
      throw new Error(
        "This runtime cannot stream uploads and the file is too large to buffer.",
      );
    }
    return await readFile(path);
  }
}

export function registerTranscriptionActions(rl: RunlinePluginAPI) {
  rl.registerAction("transcription.transcribe", {
    access: "write",
    description:
      "Upload a local audio or video file and start a transcription job. " +
      "Returns the job; poll transcription.job.get, then read the result " +
      "with transcription.transcript. Diarization labels speakers but is " +
      "much slower.",
    inputSchema: t.Object({
      path: t.String({ description: "Host path of the media file" }),
      language: t.Optional(
        enumSchema("Language (auto handles mixed media)", [
          ...TRANSCRIPTION_LANGUAGE,
        ]),
      ),
      diarize: t.Optional(
        t.Boolean({ description: "Label speakers (slower). Default false" }),
      ),
      name: t.Optional(t.String({ description: "Label shown in Shift Cloud" })),
      waitSeconds: t.Optional(
        t.Number({
          description:
            "Block up to this many seconds for completion (max 120). Longer media should be polled instead.",
        }),
      ),
    }),
    async execute(input, ctx) {
      const fields = input as {
        path: string;
        language?: string;
        diarize?: boolean;
        name?: string;
        waitSeconds?: number;
      };
      const org = organizationId(ctx);
      const contentType = mediaTypeFor(fields.path);
      const file = await stat(fields.path);
      if (!file.isFile()) throw new Error(`${fields.path} is not a file`);

      const created = await request<{
        asset: { id: string };
        upload: { url: string; headers: Record<string, string> };
      }>(ctx, "/v1/services/transcription/assets", {
        method: "POST",
        body: JSON.stringify({
          organizationId: org,
          contentType,
          sizeBytes: file.size,
        }),
      });

      const upload = await fetch(created.upload.url, {
        method: "PUT",
        headers: { "content-type": contentType },
        body: await fileBody(fields.path, file.size),
      });
      if (!upload.ok) {
        throw new Error(`Media upload failed: HTTP ${upload.status}`);
      }

      await request(
        ctx,
        `/v1/services/transcription/assets/${pathSegment(created.asset.id)}/complete`,
        { method: "POST" },
      );

      const job = await request<{ id: string }>(
        ctx,
        "/v1/services/transcription/jobs",
        {
          method: "POST",
          body: JSON.stringify({
            organizationId: org,
            assetId: created.asset.id,
            language: fields.language,
            diarize: fields.diarize,
            name: fields.name,
          }),
        },
      );

      if (!fields.waitSeconds) return job;
      const timeoutMs = Math.min(Math.max(fields.waitSeconds, 1), 120) * 1000;
      return request(
        ctx,
        `/v1/services/transcription/jobs/${pathSegment(job.id)}/await?timeoutMs=${timeoutMs}`,
        { method: "POST" },
      );
    },
  });

  rl.registerAction("transcription.job.list", {
    access: "read",
    description:
      "List transcription jobs for the API key's organization, newest first.",
    inputSchema: t.Object({}),
    async execute(_input, ctx) {
      const body = await request<{ jobs: unknown[] }>(
        ctx,
        `/v1/services/transcription/jobs?organizationId=${pathSegment(organizationId(ctx))}`,
      );
      return body.jobs;
    },
  });

  rl.registerAction("transcription.job.get", {
    access: "read",
    description:
      "Get a transcription job: status, progress, duration, speaker count.",
    inputSchema: t.Object({ id: t.String({ description: "Job ID" }) }),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return request(
        ctx,
        `/v1/services/transcription/jobs/${pathSegment(id)}`,
      );
    },
  });

  rl.registerAction("transcription.job.cancel", {
    access: "write",
    description: "Cancel a queued or running transcription job.",
    inputSchema: t.Object({ id: t.String({ description: "Job ID" }) }),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return request(
        ctx,
        `/v1/services/transcription/jobs/${pathSegment(id)}/cancel`,
        { method: "POST" },
      );
    },
  });

  rl.registerAction("transcription.transcript", {
    access: "read",
    description:
      "Fetch a finished job's transcript. txt returns plain text; srt/vtt " +
      "return subtitles; json returns the full timestamped document.",
    inputSchema: t.Object({
      jobId: t.String({ description: "Job ID" }),
      format: t.Optional(
        enumSchema("Transcript format", [...TRANSCRIPT_FORMAT]),
      ),
    }),
    async execute(input, ctx) {
      const fields = input as { jobId: string; format?: string };
      const format = fields.format ?? "txt";
      const grant = await request<{ download: { url: string } }>(
        ctx,
        `/v1/services/transcription/jobs/${pathSegment(fields.jobId)}/artifacts/${pathSegment(format)}/download`,
        { method: "POST" },
      );
      const response = await fetch(grant.download.url);
      if (!response.ok) {
        throw new Error(`Transcript download failed: HTTP ${response.status}`);
      }
      const content = await response.text();
      if (content.length > MAX_TRANSCRIPT_BYTES) {
        throw new Error(
          `Transcript is larger than ${MAX_TRANSCRIPT_BYTES} bytes; download it directly via the signed URL from the artifacts endpoint instead.`,
        );
      }
      return format === "json"
        ? { format, document: JSON.parse(content) }
        : { format, content };
    },
  });
}
