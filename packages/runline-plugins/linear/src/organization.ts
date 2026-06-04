import type { RunlinePluginAPI } from "runline";
import { ORG_FIELDS, gql, key } from "./shared.js";

export function registerOrganizationActions(rl: RunlinePluginAPI) {
  rl.registerAction("org.get", {
    description: "Get the authenticated workspace.",
    inputSchema: {},
    async execute(_input, ctx) {
      const data = await gql(key(ctx), `query { organization { ${ORG_FIELDS} } }`);
      return data.organization;
    },
  });
}
