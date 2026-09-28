import grafana from "../../../../runline-plugins/grafana/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: grafana,
  name: "grafana",
  config: {
    baseUrl: "https://grafana.example.com",
    apiKey: "secret_grafana",
  },
  secrets: ["apiKey"],
  action: "dashboard.get",
  input: { uid: "d1" },
  response: { dashboard: { uid: "d1" } },
  target: "api",
  wire: {
    url: "https://grafana.example.com/api/dashboards/uid/d1",
    header: ["authorization", "Bearer secret_grafana"],
  },
} satisfies CredentialFixture;
