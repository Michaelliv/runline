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
      // The API key is the tenant authority for every action; the cloud
      // derives the organization from it (SHFT-852), so no org ID is needed.
      apiKey: t.String({
        description: "Shift Labs API key",
        env: "SHIFT_LABS_API_KEY",
      }),
    }),
  );

  registerProjectActions(rl);
  registerIssueActions(rl);
  registerIssueViewActions(rl);
  registerPageActions(rl);
  registerTranscriptionActions(rl);
  registerObjectActions(rl);
}
