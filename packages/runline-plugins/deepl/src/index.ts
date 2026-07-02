import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  apiKey: string,
  isPro: boolean,
  method: string,
  endpoint: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const baseUrl = isPro
    ? "https://api.deepl.com/v2"
    : "https://api-free.deepl.com/v2";
  const url = new URL(`${baseUrl}${endpoint}`);

  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };

  if (params && Object.keys(params).length > 0) {
    if (method === "GET") {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    } else {
      opts.body = new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)]),
      ).toString();
    }
  }

  const res = await fetch(url.toString(), opts);
  if (!res.ok)
    throw new Error(`DeepL API error ${res.status}: ${await res.text()}`);
  return res.json();
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const cfg = ctx.connection.config;
  return {
    apiKey: cfg.apiKey as string,
    isPro: cfg.plan === "pro",
  };
}

export default function deepl(rl: RunlinePluginAPI) {
  rl.setName("deepl");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "DeepL API authentication key",
      env: "DEEPL_API_KEY",
    },
    plan: {
      type: "string",
      required: false,
      description: "'free' (default) or 'pro'",
      env: "DEEPL_PLAN",
      default: "free",
    },
  });

  rl.registerAction("language.translate", {
    access: "write",
    description: "Translate text to a target language",
    inputSchema: {
      text: {
        type: "string",
        required: true,
        description: "Text to translate",
      },
      targetLang: {
        type: "string",
        required: true,
        description:
          "Target language code (e.g. DE, FR, ES, EN-US, EN-GB, JA, ZH)",
      },
      sourceLang: {
        type: "string",
        required: false,
        description: "Source language code (auto-detected if omitted)",
      },
    },
    async execute(input, ctx) {
      const { text, targetLang, sourceLang } = input as Record<string, unknown>;
      const { apiKey, isPro } = getConn(ctx);
      const params: Record<string, unknown> = {
        text,
        target_lang: targetLang,
      };
      if (sourceLang) {
        params.source_lang = ["EN-GB", "EN-US"].includes(sourceLang as string)
          ? "EN"
          : sourceLang;
      }
      const data = (await apiRequest(
        apiKey,
        isPro,
        "POST",
        "/translate",
        params,
      )) as Record<string, unknown>;
      const translations = data.translations as Array<Record<string, unknown>>;
      return translations?.[0] ?? data;
    },
  });

  rl.registerAction("language.list", {
    access: "read",
    description: "List available target languages",
    inputSchema: {
      type: {
        type: "string",
        required: false,
        description: "'source' or 'target' (default: target)",
      },
    },
    async execute(input, ctx) {
      const { type = "target" } = (input ?? {}) as { type?: string };
      const { apiKey, isPro } = getConn(ctx);
      return apiRequest(apiKey, isPro, "GET", "/languages", { type });
    },
  });
}
