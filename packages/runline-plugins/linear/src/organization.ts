import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { gql, key, ORG_FIELDS, requireUnscoped } from "./shared.js";

export function registerOrganizationActions(rl: RunlinePluginAPI) {
  rl.registerAction("org.get", {
    description: "Get the authenticated workspace.",
    inputSchema: t.Object({}),
    async execute(_input, ctx) {
      requireUnscoped(ctx, "org.get");
      const data = await gql(
        key(ctx),
        `query { organization { ${ORG_FIELDS} } }`,
      );
      return data.organization;
    },
  });
}
