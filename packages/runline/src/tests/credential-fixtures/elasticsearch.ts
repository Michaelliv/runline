import elasticsearch from "../../../../runline-plugins/elasticsearch/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: elasticsearch,
  name: "elasticsearch",
  config: {
    baseUrl: "https://es.example.com:9200",
    username: "elastic",
    password: "es_pass",
  },
  secrets: ["username", "password"],
  action: "document.get",
  input: { index: "logs", id: "d1" },
  response: { _id: "d1" },
  target: "api",
  wire: {
    url: "https://es.example.com:9200/logs/_doc/d1",
    header: [
      "authorization",
      `Basic ${Buffer.from("elastic:es_pass").toString("base64")}`,
    ],
  },
} satisfies CredentialFixture;
