import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { signl4Credential } from "./credentials.js";

/** One alert event, posted as a form to the team's webhook. */
function send(ctx: ActionContext, form: Record<string, unknown>) {
  return credentialJson(ctx, signl4Credential, "signl4", {
    target: "webhook",
    path: "",
    method: "POST",
    form: { ...form, "X-S4-SourceSystem": "runline" },
  });
}

export default function signl4(rl: RunlinePluginAPI) {
  rl.setName("signl4");
  rl.setVersion("0.1.0");
  rl.setCredential(signl4Credential);

  rl.setConnectionSchema({
    teamSecret: {
      type: "string",
      required: true,
      description: "SIGNL4 team secret (webhook path)",
      env: "SIGNL4_TEAM_SECRET",
    },
  });

  rl.registerAction("alert.send", {
    access: "write",
    description: "Send a SIGNL4 alert",
    inputSchema: {
      message: { type: "string", required: true },
      title: { type: "string", required: false },
      service: { type: "string", required: false },
      externalId: {
        type: "string",
        required: false,
        description: "External ID for correlation",
      },
      alertingScenario: {
        type: "string",
        required: false,
        description: "single_ack or multi_ack",
      },
      latitude: { type: "string", required: false },
      longitude: { type: "string", required: false },
      filtering: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return send(ctx, {
        message: p.message,
        "X-S4-Status": "new",
        title: p.title || undefined,
        service: p.service || undefined,
        "X-S4-ExternalID": p.externalId || undefined,
        "X-S4-AlertingScenario": p.alertingScenario || undefined,
        "X-S4-Location":
          p.latitude && p.longitude
            ? `${p.latitude},${p.longitude}`
            : undefined,
        "X-S4-Filtering": p.filtering,
      });
    },
  });

  rl.registerAction("alert.resolve", {
    access: "write",
    description: "Resolve a SIGNL4 alert by external ID",
    inputSchema: {
      externalId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { externalId } = input as Record<string, unknown>;
      return send(ctx, {
        "X-S4-ExternalID": externalId,
        "X-S4-Status": "resolved",
      });
    },
  });
}
