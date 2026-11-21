import type { CodemodePluginAPI } from "@shiftlabs/codemode";
import * as t from "typebox";
import { TEAM_INPUT_SCHEMA, api } from "./shared.js";

export function registerAccountActions(rl: CodemodePluginAPI) {
  rl.registerAction("whoami", {
    access: "read",
    description: "Validate the Vercel token and return the authenticated user/account context.",
    inputSchema: t.Object(TEAM_INPUT_SCHEMA),
    async execute(input, ctx) {
      return api(ctx, "/v2/user", { query: (input ?? {}) as Record<string, unknown> });
    },
  });
}
