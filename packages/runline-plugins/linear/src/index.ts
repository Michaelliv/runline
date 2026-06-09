import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { registerAttachmentActions } from "./attachments.js";
import { registerCommentActions } from "./comments.js";
import { registerCycleActions } from "./cycles.js";
import { registerInitiativeActions } from "./initiatives.js";
import { registerIssueActions } from "./issues.js";
import { registerLabelActions } from "./labels.js";
import { registerOrganizationActions } from "./organization.js";
import { registerProjectActions } from "./projects.js";
import { registerStateActions } from "./states.js";
import { registerTeamActions } from "./teams.js";
import { registerUserActions } from "./users.js";
import { registerViewActions } from "./views.js";
import { registerWebhookActions } from "./webhooks.js";

export default function linear(rl: RunlinePluginAPI) {
  rl.setName("linear");
  rl.setVersion("0.4.0");
  rl.setConnectionSchema(t.Object({
    apiKey: t.String({
      description: "Linear API key (https://linear.app/settings/account/security)",
      env: "LINEAR_API_KEY",
    }),
    scopeLabelIds: t.Optional(t.String({
      description: "Comma-separated Linear issue label IDs. When set, issue/comment/attachment access is restricted to issues with one of these labels.",
      env: "LINEAR_SCOPE_LABEL_IDS",
    })),
  }));

  registerIssueActions(rl);
  registerCommentActions(rl);
  registerStateActions(rl);
  registerLabelActions(rl);
  registerProjectActions(rl);
  registerViewActions(rl);
  registerCycleActions(rl);
  registerInitiativeActions(rl);
  registerTeamActions(rl);
  registerUserActions(rl);
  registerAttachmentActions(rl);
  registerOrganizationActions(rl);
  registerWebhookActions(rl);
}
