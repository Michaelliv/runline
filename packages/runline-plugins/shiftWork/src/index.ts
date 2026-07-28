import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { registerIssueViewActions } from "./issue-views.js";
import { registerIssueActions } from "./issues.js";
import { registerProjectActions } from "./projects.js";

/**
 * Shift Work — the work-tracking domain of the Shift cloud: Projects,
 * Issues (with dependencies and comments), and saved Issue Views.
 * The API key is the tenant authority for every action; the cloud
 * derives the organization from it (SHFT-852), so no org ID is sent.
 */
export default function shiftWork(rl: RunlinePluginAPI) {
  rl.setName("shiftWork");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema(
    t.Object({
      apiKey: t.String({
        description: "Shift Labs API key",
        env: "SHIFT_LABS_API_KEY",
      }),
    }),
  );

  registerProjectActions(rl);
  registerIssueActions(rl);
  registerIssueViewActions(rl);
}
