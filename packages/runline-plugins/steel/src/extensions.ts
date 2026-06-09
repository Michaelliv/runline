import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { api } from "./shared.js";

function extensionForm(input: Record<string, unknown>): FormData {
  const form = new FormData();
  if (input.url !== undefined && input.url !== null) form.set("url", String(input.url));
  return form;
}

export function registerExtensionActions(rl: RunlinePluginAPI) {
  rl.registerAction("extension.list", {
    description: "List Steel Chrome extensions installed for the organization.",
    inputSchema: t.Object({}),
    async execute(_input, ctx) {
      return api(ctx, "/v1/extensions");
    },
  });

  rl.registerAction("extension.upload", {
    description: "Upload an extension from a Chrome Web Store URL. Raw zip/crx uploads should use the API directly.",
    inputSchema: t.Object({ url: t.String() }),
    async execute(input, ctx) {
      return api(ctx, "/v1/extensions", { method: "POST", body: extensionForm(input as Record<string, unknown>) });
    },
  });

  rl.registerAction("extension.update", {
    description: "Update an extension from a Chrome Web Store URL.",
    inputSchema: t.Object({ id: t.String(), url: t.String() }),
    async execute(input, ctx) {
      const { id, ...body } = input as Record<string, unknown>;
      return api(ctx, `/v1/extensions/${encodeURIComponent(String(id))}`, { method: "PUT", body: extensionForm(body) });
    },
  });

  rl.registerAction("extension.delete", {
    description: "Delete an extension by ID.",
    inputSchema: t.Object({ id: t.String() }),
    async execute(input, ctx) {
      return api(ctx, `/v1/extensions/${encodeURIComponent((input as { id: string }).id)}`, { method: "DELETE" });
    },
  });

  rl.registerAction("extension.deleteAll", {
    description: "Delete all organization extensions.",
    inputSchema: t.Object({}),
    async execute(_input, ctx) {
      return api(ctx, "/v1/extensions", { method: "DELETE" });
    },
  });
}
