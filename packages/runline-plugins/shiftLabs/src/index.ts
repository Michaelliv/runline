import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { registerIssueActions } from "./issues.js";
import { registerPageActions } from "./pages.js";

export default function shiftLabs(rl: RunlinePluginAPI) {
  rl.setName("shiftLabs");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema(
    t.Object({
      apiKey: t.String({
        description: "Shift Labs API key",
        env: "SHIFT_LABS_API_KEY",
      }),
    }),
  );

  registerIssueActions(rl);
  registerPageActions(rl);
}
