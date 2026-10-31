import coda from "../../../../runline-plugins/coda/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: coda,
  name: "coda",
  config: { accessToken: "secret_coda" },
  secrets: ["accessToken"],
  action: "formula.get",
  input: { docId: "d1", formulaId: "f1" },
  response: { id: "f1" },
  target: "api",
  wire: {
    url: "https://coda.io/apis/v1/docs/d1/formulas/f1",
    header: ["authorization", "Bearer secret_coda"],
  },
} satisfies CredentialFixture;
