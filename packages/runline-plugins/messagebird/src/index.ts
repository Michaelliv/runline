import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { messagebirdCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, messagebirdCredential, "messagebird", {
    target: "api",
    path,
    method,
    ...(body && Object.keys(body).length > 0 && method !== "GET"
      ? { json: body }
      : {}),
  });
}

export default function messagebird(rl: RunlinePluginAPI) {
  rl.setName("messagebird");
  rl.setVersion("0.1.0");
  rl.setCredential(messagebirdCredential);

  rl.setConnectionSchema({
    accessKey: {
      type: "string",
      required: true,
      description: "MessageBird access key",
      env: "MESSAGEBIRD_ACCESS_KEY",
    },
  });

  rl.registerAction("sms.send", {
    access: "write",
    description: "Send an SMS message",
    inputSchema: {
      originator: {
        type: "string",
        required: true,
        description: "Sender number or alphanumeric (max 11 chars)",
      },
      recipients: {
        type: "string",
        required: true,
        description:
          "Comma-separated recipient phone numbers (international format)",
      },
      body: { type: "string", required: true, description: "Message text" },
      type: {
        type: "string",
        required: false,
        description: "sms (default), binary, or flash",
      },
      datacoding: {
        type: "string",
        required: false,
        description: "auto, plain, or unicode",
      },
      reference: {
        type: "string",
        required: false,
        description: "Client reference",
      },
      reportUrl: {
        type: "string",
        required: false,
        description: "Status report webhook URL (requires reference)",
      },
      validity: {
        type: "number",
        required: false,
        description: "Validity in seconds",
      },
      gateway: {
        type: "number",
        required: false,
        description: "SMS route gateway",
      },
      mclass: {
        type: "number",
        required: false,
        description: "0=normal, 1=flash",
      },
      scheduledDatetime: {
        type: "string",
        required: false,
        description: "Scheduled send time (RFC3339)",
      },
      groupIds: {
        type: "string",
        required: false,
        description: "Comma-separated group IDs (alternative to recipients)",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        originator: p.originator,
        body: p.body,
        recipients: (p.recipients as string)
          .split(",")
          .map((r) => Number.parseInt(r.trim(), 10)),
      };
      for (const k of [
        "type",
        "datacoding",
        "reference",
        "reportUrl",
        "validity",
        "gateway",
        "mclass",
        "scheduledDatetime",
        "groupIds",
      ]) {
        if (p[k] !== undefined && p[k] !== null) body[k] = p[k];
      }
      return apiRequest(ctx, "POST", "messages", body);
    },
  });

  rl.registerAction("balance.get", {
    access: "read",
    description: "Get current account balance",
    async execute(_input, ctx) {
      return apiRequest(ctx, "GET", "balance");
    },
  });
}
