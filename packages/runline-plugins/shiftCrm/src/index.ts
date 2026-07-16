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
          "User-subject Shift CRM API key minted by an operator via `bun run crm:access key`. It authenticates as its bound user, whose active CRM access grant authorizes data access. Regular Shift cloud service API keys (SHIFT_LABS_API_KEY) cannot reach CRM data.",
        env: "SHIFT_CRM_API_KEY",
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
