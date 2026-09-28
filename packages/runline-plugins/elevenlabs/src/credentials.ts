import { staticCredential } from "../../_shared/credentials.js";

/** The largest request deadline the input schemas allow (schemas.ts `timeout`). */
export const MAX_TIMEOUT_MS = 3_600_000;

/**
 * An ElevenLabs API key, sent as `xi-api-key` to the one API origin. The
 * `audio` target carries generation, transcription, and downloads: it
 * declares the longest deadline the input schemas allow and the 100 MiB
 * audio ceiling, both capped by the host. The `api` target is the catalog
 * and management surface on the transport defaults.
 */
export const elevenlabsCredential = staticCredential({
  id: "elevenlabs",
  auth: { kind: "apiKey", header: "xi-api-key" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.elevenlabs.io/",
      methods: ["GET", "POST", "DELETE"],
    },
    audio: {
      baseUrl: "https://api.elevenlabs.io/",
      methods: ["GET", "POST"],
      timeoutMs: MAX_TIMEOUT_MS,
      maxResponseBytes: 100 * 1024 * 1024,
    },
  },
});
