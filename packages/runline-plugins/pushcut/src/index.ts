import type { RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { pushcutCredential } from "./credentials.js";

export default function pushcut(rl: RunlinePluginAPI) {
  rl.setName("pushcut");
  rl.setVersion("0.1.0");
  rl.setCredential(pushcutCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Pushcut API key",
      env: "PUSHCUT_API_KEY",
    },
  });

  rl.registerAction("notification.send", {
    access: "write",
    description: "Send a Pushcut notification",
    inputSchema: {
      notificationName: {
        type: "string",
        required: true,
        description: "Notification name or ID",
      },
      text: {
        type: "string",
        required: false,
        description: "Override notification text",
      },
      title: {
        type: "string",
        required: false,
        description: "Override notification title",
      },
      input: {
        type: "string",
        required: false,
        description: "Value passed as input to the action",
      },
      devices: {
        type: "object",
        required: false,
        description: "Array of device IDs (default: all)",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (p.text) body.text = p.text;
      if (p.title) body.title = p.title;
      if (p.input) body.input = p.input;
      if (p.devices) body.devices = p.devices;
      return credentialJson(ctx, pushcutCredential, "pushcut", {
        target: "api",
        path: `notifications/${encodeURIComponent(p.notificationName as string)}`,
        method: "POST",
        json: body,
      });
    },
  });
}
