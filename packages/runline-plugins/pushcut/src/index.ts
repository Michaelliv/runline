import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.pushcut.io/v1";

export default function pushcut(rl: RunlinePluginAPI) {
  rl.setName("pushcut");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Pushcut API key",
      env: "PUSHCUT_API_KEY",
    },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) =>
    ctx.connection.config.apiKey as string;

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
      const res = await fetch(
        `${BASE}/notifications/${encodeURIComponent(p.notificationName as string)}`,
        {
          method: "POST",
          headers: { "API-Key": key(ctx), "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok)
        throw new Error(`Pushcut error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  });
}
