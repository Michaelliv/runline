import type { RunlinePluginAPI } from "runline";

export default function uproc(rl: RunlinePluginAPI) {
  rl.setName("uproc");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    email: { type: "string", required: true, description: "uProc account email", env: "UPROC_EMAIL" },
    apiKey: { type: "string", required: true, description: "uProc API key", env: "UPROC_API_KEY" },
  });

  rl.registerAction("process.run", {
    description: "Run a uProc data processor tool",
    inputSchema: {
      processor: { type: "string", required: true, description: "Processor key (e.g. get-email-from-name-and-domain)" },
      params: { type: "object", required: true, description: "Processor parameters as key-value pairs" },
      dataWebhook: { type: "string", required: false, description: "URL for async callback" },
    },
    async execute(input, ctx) {
      const c = ctx.connection.config;
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { processor: p.processor, params: p.params };
      if (p.dataWebhook) body.callback = { data: p.dataWebhook };
      const res = await fetch("https://api.uproc.io/api/v2/process", {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${c.email}:${c.apiKey}`)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`uProc error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  });
}
