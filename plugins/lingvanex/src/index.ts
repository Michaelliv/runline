import type { RunlinePluginAPI } from "runline";

export default function lingvanex(rl: RunlinePluginAPI) {
  rl.setName("lingvanex");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({ apiKey: { type: "string", required: true, description: "Lingvanex API key", env: "LINGVANEX_API_KEY" } });

  rl.registerAction("translate", {
    description: "Translate text",
    inputSchema: {
      text: { type: "string", required: true, description: "Text to translate" },
      to: { type: "string", required: true, description: "Target language code (e.g. en_GB, fr_FR)" },
      from: { type: "string", required: false, description: "Source language code (auto-detect if omitted)" },
      platform: { type: "string", required: false, description: "api (default)" },
      translateMode: { type: "string", required: false, description: "'html' to translate preserving HTML structure, or omit for plain text" },
    },
    async execute(input, ctx) {
      const { text, to, from: src, platform = "api", translateMode } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { data: text, to, platform };
      if (src) body.from = src;
      if (translateMode) body.translateMode = translateMode;
      const res = await fetch("https://api-b2b.backenster.com/b1/api/v3/translate", {
        method: "POST",
        headers: { Authorization: `Bearer ${ctx.connection.config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Lingvanex error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  });
}
