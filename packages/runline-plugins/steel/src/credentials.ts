import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { api, compactRecord } from "./shared.js";

const CREDENTIAL_KEY_SCHEMA = {
  origin: t.String({ description: "Credential origin" }),
  namespace: t.Optional(t.String({ description: "Credential namespace (defaults to Steel default)" })),
} as const;

export function registerCredentialActions(rl: RunlinePluginAPI) {
  rl.registerAction("credential.list", {
    description: "List Steel credentials. Filter by origin and/or namespace.",
    inputSchema: t.Object({ namespace: t.Optional(t.String()), origin: t.Optional(t.String()) }),
    async execute(input, ctx) {
      return api(ctx, "/v1/credentials", { query: input as Record<string, unknown> });
    },
  });

  rl.registerAction("credential.create", {
    description: "Create a Steel credential for an origin/namespace. Value may include username, password, and totpSecret.",
    inputSchema: t.Object({ ...CREDENTIAL_KEY_SCHEMA, value: t.Any({ description: "Credential payload" }) }),
    async execute(input, ctx) {
      return api(ctx, "/v1/credentials", { method: "POST", body: compactRecord(input as Record<string, unknown>) });
    },
  });

  rl.registerAction("credential.get", {
    description: "Retrieve credential metadata by origin and optional namespace.",
    inputSchema: t.Object(CREDENTIAL_KEY_SCHEMA),
    async execute(input, ctx) {
      const result = await api(ctx, "/v1/credentials", { query: compactRecord(input as Record<string, unknown>) }) as Record<string, unknown>;
      const credentials = result.credentials;
      return Array.isArray(credentials) ? (credentials[0] ?? null) : null;
    },
  });

  rl.registerAction("credential.delete", {
    description: "Delete a Steel credential by origin and optional namespace.",
    inputSchema: t.Object(CREDENTIAL_KEY_SCHEMA),
    async execute(input, ctx) {
      return api(ctx, "/v1/credentials", { method: "DELETE", body: compactRecord(input as Record<string, unknown>) });
    },
  });
}
