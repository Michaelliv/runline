import kobotoolbox from "../../../../runline-plugins/kobotoolbox/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: kobotoolbox,
  name: "kobotoolbox",
  config: { url: "https://kf.kobotoolbox.org", token: "secret_kobo" },
  secrets: ["token"],
  action: "form.get",
  input: { formId: "aX1" },
  response: { uid: "aX1" },
  target: "api",
  wire: {
    url: "https://kf.kobotoolbox.org/api/v2/assets/aX1",
    header: ["authorization", "Token secret_kobo"],
  },
} satisfies CredentialFixture;
