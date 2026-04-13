import type { RunlinePluginAPI } from "runline";

export default function signl4(rl: RunlinePluginAPI) {
  rl.setName("signl4");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    teamSecret: { type: "string", required: true, description: "SIGNL4 team secret (webhook path)", env: "SIGNL4_TEAM_SECRET" },
  });

  const url = (ctx: { connection: { config: Record<string, unknown> } }) =>
    `https://connect.signl4.com/webhook/${ctx.connection.config.teamSecret}`;

  rl.registerAction("alert.send", {
    description: "Send a SIGNL4 alert",
    inputSchema: {
      message: { type: "string", required: true },
      title: { type: "string", required: false },
      service: { type: "string", required: false },
      externalId: { type: "string", required: false, description: "External ID for correlation" },
      alertingScenario: { type: "string", required: false, description: "single_ack or multi_ack" },
      latitude: { type: "string", required: false },
      longitude: { type: "string", required: false },
      filtering: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const form = new URLSearchParams();
      form.set("message", p.message as string);
      form.set("X-S4-Status", "new");
      form.set("X-S4-SourceSystem", "runline");
      if (p.title) form.set("title", p.title as string);
      if (p.service) form.set("service", p.service as string);
      if (p.externalId) form.set("X-S4-ExternalID", p.externalId as string);
      if (p.alertingScenario) form.set("X-S4-AlertingScenario", p.alertingScenario as string);
      if (p.latitude && p.longitude) form.set("X-S4-Location", `${p.latitude},${p.longitude}`);
      if (p.filtering !== undefined) form.set("X-S4-Filtering", String(p.filtering));
      const res = await fetch(url(ctx), { method: "POST", body: form });
      if (!res.ok) throw new Error(`SIGNL4 error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  });

  rl.registerAction("alert.resolve", {
    description: "Resolve a SIGNL4 alert by external ID",
    inputSchema: {
      externalId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { externalId } = input as Record<string, unknown>;
      const form = new URLSearchParams();
      form.set("X-S4-ExternalID", externalId as string);
      form.set("X-S4-Status", "resolved");
      form.set("X-S4-SourceSystem", "runline");
      const res = await fetch(url(ctx), { method: "POST", body: form });
      if (!res.ok) throw new Error(`SIGNL4 error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  });
}
