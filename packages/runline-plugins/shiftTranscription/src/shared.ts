export {
  type Ctx,
  enumSchema,
  pathSegment,
  request,
  SHIFT_REQUEST_TIMEOUT_MS,
  STRICT_OBJECT,
} from "../../_shared/shiftCloud.js";

export const TRANSCRIPTION_LANGUAGE = ["auto", "en", "he"] as const;
export const TRANSCRIPT_FORMAT = ["txt", "srt", "vtt", "json"] as const;
