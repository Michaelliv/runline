import type { RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { uprocCredential } from "./credentials.js";

export default function uproc(rl: RunlinePluginAPI) {
  rl.setName("uproc");
  rl.setVersion("0.1.0");
  rl.setCredential(uprocCredential);
  rl.setConnectionSchema({
    email: {
      type: "string",
      required: true,
      description: "uProc account email",
      env: "UPROC_EMAIL",
    },
    apiKey: {
      type: "string",
      required: true,
      description: "uProc API key",
      env: "UPROC_API_KEY",
    },
  });

  rl.registerAction("process.run", {
    access: "write",
    description: "Run a uProc data processor tool",
    inputSchema: {
      processor: {
        type: "string",
        required: true,
        description: "Processor key (e.g. get-email-from-name-and-domain)",
      },
      params: {
        type: "object",
        required: true,
        description: "Processor parameters as key-value pairs",
      },
      dataWebhook: {
        type: "string",
        required: false,
        description: "URL for async callback",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        processor: p.processor,
        params: p.params,
      };
      if (p.dataWebhook) body.callback = { data: p.dataWebhook };
      return credentialJson(ctx, uprocCredential, "uproc", {
        target: "api",
        path: "process",
        method: "POST",
        json: body,
      });
    },
  });
}
