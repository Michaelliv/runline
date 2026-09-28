import notion from "../../../../runline-plugins/notion/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: notion,
  name: "notion",
  config: { apiKey: "secret_notion" },
  secrets: ["apiKey"],
  action: "page.get",
  input: { pageId: "p1" },
  response: { id: "p1" },
  target: "api",
  wire: {
    url: "https://api.notion.com/v1/pages/p1",
    header: ["authorization", "Bearer secret_notion"],
  },
} satisfies CredentialFixture;
