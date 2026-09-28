import { shiftClient } from "../../_shared/shiftCredentials.js";

export {
  type Ctx,
  enumSchema,
  pathSegment,
  STRICT_OBJECT,
} from "../../_shared/shiftCloud.js";

/** The longest server-held wait /await accepts: waitSeconds is capped at 120. */
export const MAX_AWAIT_WAIT_MS = 120_000;

/**
 * The target's deadline: the /await endpoint holds the request open for up
 * to MAX_AWAIT_WAIT_MS, so the transport allows that wait plus 60 s for the
 * exchange itself. Every other transcription route answers well within it.
 */
export const AWAIT_DEADLINE_MS = MAX_AWAIT_WAIT_MS + 60_000;

export const { credential: shiftTranscriptionCredential, request } =
  shiftClient("shiftTranscription", { timeoutMs: AWAIT_DEADLINE_MS });

export const TRANSCRIPTION_LANGUAGE = ["auto", "en", "he"] as const;
export const TRANSCRIPT_FORMAT = ["txt", "srt", "vtt", "json"] as const;
