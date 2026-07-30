import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  AUDIO_VIDEO_MEDIA_TYPES,
  putThroughGrant,
  requireMediaType,
  SIGNED_UPLOAD_MAX_BYTES,
  type SignedUploadGrant,
  statUploadFile,
} from "../../_shared/shiftUpload.js";
import {
  enumSchema,
  pathSegment,
  request,
  TRANSCRIPT_FORMAT,
  TRANSCRIPTION_LANGUAGE,
} from "./shared.js";

/** Transcript previews returned into the sandbox are capped, not truncated silently. */
const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;
const STRICT_OBJECT = { additionalProperties: false } as const;
const Id = t.String({ minLength: 1, pattern: "\\S" });

export function registerTranscriptionActions(rl: RunlinePluginAPI) {
  rl.registerAction("transcription.transcribe", {
    access: "write",
    description:
      "Upload a local audio or video file and start a transcription job. " +
      "Returns the job; poll transcription.job.get, then read the result " +
      "with transcription.transcript. Diarization labels speakers but is " +
      "much slower.",
    inputSchema: t.Object(
      {
        path: t.String({
          minLength: 1,
          pattern: "\\S",
          description: "Host path of the media file",
        }),
        language: t.Optional(
          enumSchema("Language (auto handles mixed media)", [
            ...TRANSCRIPTION_LANGUAGE,
          ]),
        ),
        diarize: t.Optional(
          t.Boolean({ description: "Label speakers (slower). Default false" }),
        ),
        name: t.Optional(
          t.String({
            minLength: 1,
            maxLength: 200,
            pattern: "\\S",
            description: "Label shown in Shift Cloud",
          }),
        ),
        metadata: t.Optional(
          t.Record(t.String(), t.Unknown(), {
            description:
              "Small caller-defined metadata object stored on the job",
          }),
        ),
        waitSeconds: t.Optional(
          t.Number({
            minimum: 0,
            maximum: 120,
            description:
              "Block up to this many seconds for completion. Longer media should be polled instead.",
          }),
        ),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const fields = input as {
        path: string;
        language?: string;
        diarize?: boolean;
        name?: string;
        metadata?: Record<string, unknown>;
        waitSeconds?: number;
      };
      const contentType = requireMediaType(
        fields.path,
        AUDIO_VIDEO_MEDIA_TYPES,
      );
      const sizeBytes = await statUploadFile(
        fields.path,
        SIGNED_UPLOAD_MAX_BYTES,
        "Media file",
      );

      const created = await request<{
        asset: { id: string };
        upload: SignedUploadGrant;
      }>(ctx, "/v1/services/transcription/assets", {
        method: "POST",
        // The API key is the tenant authority; no organizationId is sent.
        body: JSON.stringify({
          contentType,
          sizeBytes,
        }),
      });

      await putThroughGrant(
        created.upload,
        fields.path,
        contentType,
        sizeBytes,
        "Media upload",
      );

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
            assetId: created.asset.id,
            language: fields.language,
            diarize: fields.diarize,
            name: fields.name,
            metadata: fields.metadata,
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
    inputSchema: t.Object({}, STRICT_OBJECT),
    async execute(_input, ctx) {
      const body = await request<{ jobs: unknown[] }>(
        ctx,
        "/v1/services/transcription/jobs",
      );
      return body.jobs;
    },
  });

  rl.registerAction("transcription.job.get", {
    access: "read",
    description:
      "Get a transcription job: status, progress, duration, speaker count.",
    inputSchema: t.Object({ id: Id }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return request(ctx, `/v1/services/transcription/jobs/${pathSegment(id)}`);
    },
  });

  rl.registerAction("transcription.job.cancel", {
    access: "write",
    description: "Cancel a queued or running transcription job.",
    inputSchema: t.Object({ id: Id }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return request(
        ctx,
        `/v1/services/transcription/jobs/${pathSegment(id)}/cancel`,
        { method: "POST" },
      );
    },
  });

  rl.registerAction("transcription.job.delete", {
    access: "write",
    description:
      "Permanently delete a finished (succeeded, failed, or canceled) " +
      "transcription job, its transcript artifacts, and its uploaded " +
      "source media when no other job shares it. Cancel live jobs first. " +
      "This cannot be undone.",
    inputSchema: t.Object({ id: Id }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return request(
        ctx,
        `/v1/services/transcription/jobs/${pathSegment(id)}`,
        { method: "DELETE" },
      );
    },
  });

  rl.registerAction("transcription.artifact.list", {
    access: "read",
    description: "List the available transcript artifacts for a job.",
    inputSchema: t.Object({ id: Id }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ artifacts: unknown[] }>(
        ctx,
        `/v1/services/transcription/jobs/${pathSegment(id)}/artifacts`,
      );
      return body.artifacts;
    },
  });

  rl.registerAction("transcription.transcript", {
    access: "read",
    description:
      "Fetch a finished job's transcript. txt returns plain text; srt/vtt " +
      "return subtitles; json returns the full timestamped document. Set " +
      "downloadOnly=true to return the short-lived signed download grant.",
    inputSchema: t.Object(
      {
        id: Id,
        format: t.Optional(
          enumSchema("Transcript format", [...TRANSCRIPT_FORMAT]),
        ),
        downloadOnly: t.Optional(
          t.Boolean({ description: "Return a signed download grant only" }),
        ),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const fields = input as {
        id: string;
        format?: string;
        downloadOnly?: boolean;
      };
      const format = fields.format ?? "txt";
      const grant = await request<{
        artifact: { sizeBytes: number } & Record<string, unknown>;
        download: { method: "GET"; url: string; expiresAt: string };
      }>(
        ctx,
        `/v1/services/transcription/jobs/${pathSegment(fields.id)}/artifacts/${pathSegment(format)}/download`,
        { method: "POST" },
      );
      if (
        fields.downloadOnly ||
        grant.artifact.sizeBytes > MAX_TRANSCRIPT_BYTES
      ) {
        return { format, ...grant };
      }

      const response = await fetch(grant.download.url, {
        method: grant.download.method,
      });
      if (!response.ok) {
        throw new Error(`Transcript download failed: HTTP ${response.status}`);
      }
      const content = await response.text();
      if (Buffer.byteLength(content, "utf8") > MAX_TRANSCRIPT_BYTES) {
        return { format, ...grant };
      }
      return format === "json"
        ? { format, document: JSON.parse(content) }
        : { format, content };
    },
  });
}
