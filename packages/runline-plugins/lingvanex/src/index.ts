import type { RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { lingvanexCredential } from "./credentials.js";

export default function lingvanex(rl: RunlinePluginAPI) {
  rl.setName("lingvanex");
  rl.setVersion("0.1.0");
  rl.setCredential(lingvanexCredential);
  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Lingvanex API key",
      env: "LINGVANEX_API_KEY",
    },
  });

  rl.registerAction("translate", {
    access: "write",
    description: "Translate text",
    inputSchema: {
      text: {
        type: "string",
        required: true,
        description: "Text to translate",
      },
      to: {
        type: "string",
        required: true,
        description: "Target language code (e.g. en_GB, fr_FR)",
      },
      from: {
        type: "string",
        required: false,
        description: "Source language code (auto-detect if omitted)",
      },
      platform: {
        type: "string",
        required: false,
        description: "api (default)",
      },
      translateMode: {
        type: "string",
        required: false,
        description:
          "'html' to translate preserving HTML structure, or omit for plain text",
      },
    },
    async execute(input, ctx) {
      const {
        text,
        to,
        from: src,
        platform = "api",
        translateMode,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { data: text, to, platform };
      if (src) body.from = src;
      if (translateMode) body.translateMode = translateMode;
      return credentialJson(ctx, lingvanexCredential, "lingvanex", {
        target: "api",
        path: "translate",
        method: "POST",
        json: body,
      });
    },
  });
}
