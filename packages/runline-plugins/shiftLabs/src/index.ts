import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { registerIssueViewActions } from "./issue-views.js";
import { registerIssueActions } from "./issues.js";
import { registerObjectActions } from "./objects.js";
import { registerPageActions } from "./pages.js";
import { registerProjectActions } from "./projects.js";
import { registerTranscriptionActions } from "./transcription.js";

export default function shiftLabs(rl: RunlinePluginAPI) {
  rl.setName("shiftLabs");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema(
    t.Object({
      apiKey: t.String({
        description: "Shift Labs API key",
        env: "SHIFT_LABS_API_KEY",
      }),
      organizationId: t.Optional(
        t.String({
          description:
            "Shift Labs organization ID (required for transcription actions)",
          env: "SHIFT_LABS_ORG_ID",
        }),
      ),
    }),
  );

  registerProjectActions(rl);
  registerIssueActions(rl);
  registerIssueViewActions(rl);
  registerPageActions(rl);
  registerTranscriptionActions(rl);
  registerObjectActions(rl);
}
