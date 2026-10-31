import googleImage from "../../../../runline-plugins/googleImage/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: googleImage,
  name: "googleImage",
  config: { apiKey: "g_secret" },
  secrets: ["apiKey"],
  action: "image.create",
  input: { prompt: "a watercolor fox" },
  response: { candidates: [] },
  target: "api",
  wire: {
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=g_secret",
  },
} satisfies CredentialFixture;
