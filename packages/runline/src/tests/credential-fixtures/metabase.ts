import metabase from "../../../../runline-plugins/metabase/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: metabase,
  name: "metabase",
  config: { url: "https://metabase.example.com", sessionToken: "mb_session" },
  secrets: ["sessionToken"],
  action: "question.get",
  input: { questionId: 7 },
  response: { id: 7 },
  target: "api",
  wire: {
    url: "https://metabase.example.com/api/card/7",
    header: ["x-metabase-session", "mb_session"],
  },
} satisfies CredentialFixture;
