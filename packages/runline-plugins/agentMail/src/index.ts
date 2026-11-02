import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { agentMailCredential } from "./credentials.js";
import { registerDraftActions } from "./drafts.js";
import { registerInboxActions } from "./inboxes.js";
import { registerMessageActions } from "./messages.js";
import { STRICT } from "./schemas.js";
import { request } from "./shared.js";
import { registerThreadActions } from "./threads.js";

export default function agentMail(rl: RunlinePluginAPI): void {
  rl.setName("agentMail");
  rl.setVersion("0.1.0");
  rl.setCredential(agentMailCredential);
  rl.setConnectionSchema(
    t.Object({
      apiKey: t.String({
        minLength: 1,
        env: "AGENTMAIL_API_KEY",
        description:
          "AgentMail API key with permissions for the requested inboxes and operations. https://console.agentmail.to",
      }),
      region: t.Optional(
        t.String({
          env: "AGENTMAIL_REGION",
          default: "us",
          description:
            "us (api.agentmail.to, default) or eu (api.agentmail.eu). Any other value is refused rather than sent to the default host.",
        }),
      ),
    }),
  );
  rl.registerAction("whoami", {
    access: "read",
    description: "Read the authenticated AgentMail identity and API-key scope.",
    inputSchema: t.Object({}, STRICT),
    execute: (_input, ctx) => request(ctx, "auth/me"),
  });
  registerInboxActions(rl);
  registerMessageActions(rl);
  registerThreadActions(rl);
  registerDraftActions(rl);
}
