import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { registerAccessActions } from "./access.js";
import { registerAccountActions } from "./accounts.js";
import { registerActivityActions } from "./activities.js";
import { registerImportActions } from "./imports.js";
import {
  registerOpportunityActions,
  registerPipelineActions,
} from "./opportunities.js";
import { registerPersonActions } from "./people.js";
import { registerRecordActions } from "./records.js";
import { registerTaskActions } from "./tasks.js";

export default function shiftCrm(rl: RunlinePluginAPI) {
  rl.setName("shiftCrm");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema(
    t.Object({
      apiKey: t.String({
        description:
          "Shift cloud bearer credential. CRM data routes require a user-scoped token whose user holds an active CRM access grant; service API keys are rejected.",
        env: "SHIFT_LABS_API_KEY",
      }),
    }),
  );

  registerAccessActions(rl);
  registerAccountActions(rl);
  registerPersonActions(rl);
  registerPipelineActions(rl);
  registerOpportunityActions(rl);
  registerActivityActions(rl);
  registerTaskActions(rl);
  registerRecordActions(rl);
  registerImportActions(rl);
}
