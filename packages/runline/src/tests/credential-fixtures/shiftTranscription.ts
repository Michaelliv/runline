import shiftTranscription from "../../../../runline-plugins/shiftTranscription/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: shiftTranscription,
  name: "shiftTranscription",
  config: { apiKey: "shift_key" },
  secrets: ["apiKey"],
  action: "transcription.job.list",
  input: {},
  response: { jobs: [] },
  target: "api",
  wire: {
    url: "https://cloud.shift-labs.ai/v1/services/transcription/jobs",
    header: ["authorization", "Bearer shift_key"],
  },
} satisfies CredentialFixture;
