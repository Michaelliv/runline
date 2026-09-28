import type { RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { pushoverCredential } from "./credentials.js";

export default function pushover(rl: RunlinePluginAPI) {
  rl.setName("pushover");
  rl.setVersion("0.1.0");
  rl.setCredential(pushoverCredential);

  rl.setConnectionSchema({
    apiToken: {
      type: "string",
      required: true,
      description: "Pushover application API token",
      env: "PUSHOVER_API_TOKEN",
    },
  });

  rl.registerAction("message.push", {
    access: "write",
    description: "Send a push notification via Pushover",
    inputSchema: {
      userKey: {
        type: "string",
        required: true,
        description: "User or group key",
      },
      message: { type: "string", required: true },
      priority: {
        type: "number",
        required: false,
        description: "-2 (lowest) to 2 (emergency), default 0",
      },
      title: { type: "string", required: false },
      url: {
        type: "string",
        required: false,
        description: "Supplementary URL",
      },
      urlTitle: { type: "string", required: false },
      sound: {
        type: "string",
        required: false,
        description: "Sound name (e.g. pushover, bike, bugle)",
      },
      device: {
        type: "string",
        required: false,
        description: "Target device name(s), comma-separated",
      },
      html: {
        type: "boolean",
        required: false,
        description: "Enable HTML formatting",
      },
      retry: {
        type: "number",
        required: false,
        description: "Retry interval in seconds (for priority 2, min 30)",
      },
      expire: {
        type: "number",
        required: false,
        description: "Expiry in seconds (for priority 2, max 10800)",
      },
      ttl: {
        type: "number",
        required: false,
        description: "Time to live in seconds",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        user: p.userKey,
        message: p.message,
      };
      if (p.priority !== undefined) body.priority = p.priority;
      if (p.title) body.title = p.title;
      if (p.url) body.url = p.url;
      if (p.urlTitle) body.url_title = p.urlTitle;
      if (p.sound) body.sound = p.sound;
      if (p.device) body.device = p.device;
      if (p.html) body.html = 1;
      if (p.retry) body.retry = p.retry;
      if (p.expire) body.expire = p.expire;
      if (p.ttl) body.ttl = p.ttl;

      return credentialJson(ctx, pushoverCredential, "pushover", {
        target: "api",
        path: "messages.json",
        method: "POST",
        form: body,
      });
    },
  });
}
