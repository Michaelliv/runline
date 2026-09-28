import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { deeplCredential } from "./credentials.js";

async function apiRequest(
  ctx: ActionContext,
  method: "GET" | "POST",
  endpoint: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const entries = Object.entries(params ?? {}).filter(
    ([, v]) => v !== undefined && v !== null,
  );
  // DeepL takes form-encoded bodies, not JSON.
  const form = new URLSearchParams(
    entries.map(([k, v]) => [k, String(v)]),
  ).toString();
  return credentialJson(ctx, deeplCredential, "deepl", {
    target: "api",
    path: endpoint,
    method,
    ...(method === "GET"
      ? { query: Object.fromEntries(entries) }
      : form
        ? {
            body: form,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
          }
        : {}),
  });
}

export default function deepl(rl: RunlinePluginAPI) {
  rl.setName("deepl");
  rl.setVersion("0.1.0");
  rl.setCredential(deeplCredential);

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
        ctx,
        "POST",
        "translate",
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
      return apiRequest(ctx, "GET", "languages", { type });
    },
  });
}
