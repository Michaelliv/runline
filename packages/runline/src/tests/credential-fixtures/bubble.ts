import bubble from "../../../../runline-plugins/bubble/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: bubble,
  name: "bubble",
  config: { apiToken: "bubble_tok", appName: "myapp" },
  secrets: ["apiToken"],
  action: "object.get",
  input: { typeName: "Thing", objectId: "o1" },
  response: { response: { _id: "o1" } },
  target: "api",
  wire: {
    url: "https://myapp.bubbleapps.io/api/1.1/obj/thing/o1",
    header: ["authorization", "Bearer bubble_tok"],
  },
} satisfies CredentialFixture;
