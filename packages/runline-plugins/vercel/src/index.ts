import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { registerAccountActions } from "./account.js";
import { registerDeploymentActions } from "./deployments.js";
import { registerEnvActions } from "./env.js";
import { registerProjectActions } from "./projects.js";

export default function vercel(rl: RunlinePluginAPI) {
  rl.setName("vercel");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema(t.Object({
    token: t.String({
      description: "Vercel access token (https://vercel.com/account/settings/tokens)",
      env: "VERCEL_TOKEN",
    }),
    teamId: t.Optional(t.String({
      description: "Optional Vercel Team ID. Added as teamId to every API request.",
      env: "VERCEL_TEAM_ID",
    })),
    slug: t.Optional(t.String({
      description: "Optional Vercel Team slug. Added as slug to every API request when teamId is not used.",
      env: "VERCEL_TEAM_SLUG",
    })),
  }));

  registerAccountActions(rl);
  registerProjectActions(rl);
  registerDeploymentActions(rl);
  registerEnvActions(rl);
}
