import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { registerBrowserActions } from "./browser.js";
import { registerCaptchaActions } from "./captchas.js";
import { registerCredentialActions } from "./credentials.js";
import { registerExtensionActions } from "./extensions.js";
import { registerFileActions } from "./files.js";
import { registerProfileActions } from "./profiles.js";
import { registerSessionActions } from "./sessions.js";

export default function steel(rl: RunlinePluginAPI) {
  rl.setName("steel");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema(t.Object({
    apiKey: t.String({
      description: "Steel API key (https://app.steel.dev/settings/api-keys)",
      env: "STEEL_API_KEY",
    }),
  }));

  registerSessionActions(rl);
  registerBrowserActions(rl);
  registerFileActions(rl);
  registerCredentialActions(rl);
  registerProfileActions(rl);
  registerExtensionActions(rl);
  registerCaptchaActions(rl);
}
