import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { registerTranscriptionActions } from "./transcription.js";

/**
 * Shift Transcription — audio and video transcription through the
 * Shift cloud: upload media, run jobs (optionally diarized), and read
 * transcripts as text, subtitles, or timestamped JSON. The API key is
 * the tenant authority; the cloud derives the organization from it
 * (SHFT-852), so no org ID is sent.
 */
export default function shiftTranscription(rl: RunlinePluginAPI) {
  rl.setName("shiftTranscription");
  rl.setVersion("0.2.0");
  rl.setConnectionSchema(
    t.Object({
      apiKey: t.String({
        description: "Shift Labs API key",
        env: "SHIFT_LABS_API_KEY",
      }),
    }),
  );

  registerTranscriptionActions(rl);
}
