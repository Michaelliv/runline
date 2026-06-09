import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { api } from "./shared.js";

function profileForm(input: Record<string, unknown>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    form.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  return form;
}

export function registerProfileActions(rl: RunlinePluginAPI) {
  rl.registerAction("profile.list", {
    description: "List Steel browser profiles.",
    inputSchema: t.Object({}),
    async execute(_input, ctx) {
      return api(ctx, "/v1/profiles");
    },
  });

  rl.registerAction("profile.get", {
    description: "Get a Steel profile by ID.",
    inputSchema: t.Object({ id: t.String() }),
    async execute(input, ctx) {
      return api(ctx, `/v1/profiles/${encodeURIComponent((input as { id: string }).id)}`);
    },
  });

  rl.registerAction("profile.create", {
    description: "Create an empty persisted Steel profile by opening and releasing a short-lived session with persistProfile=true. For userDataDir archive imports, use the Steel API directly.",
    inputSchema: t.Object({
      timeout: t.Optional(t.Number({ description: "Temporary session timeout in milliseconds" })),
      inactivityTimeout: t.Optional(t.Number({ description: "Temporary session inactivity timeout in milliseconds" })),
    }),
    async execute(input, ctx) {
      const session = await api(ctx, "/v1/sessions", {
        method: "POST",
        body: { timeout: 60000, inactivityTimeout: 30000, ...(input as Record<string, unknown>), persistProfile: true },
      }) as Record<string, unknown>;
      try {
        await api(ctx, `/v1/sessions/${encodeURIComponent(String(session.id))}/release`, { method: "POST" });
      } catch {
        // Profile creation is tied to session release. Return the session metadata even if release cleanup fails.
      }
      return { profileId: session.profileId, session };
    },
  });

  rl.registerAction("profile.update", {
    description: "Update profile metadata/settings used by later sessions.",
    inputSchema: t.Object({ id: t.String(), userAgent: t.Optional(t.String()), proxy: t.Optional(t.Any()), metadata: t.Optional(t.Any()) }),
    async execute(input, ctx) {
      const { id, ...body } = input as Record<string, unknown>;
      return api(ctx, `/v1/profiles/${encodeURIComponent(String(id))}`, { method: "PATCH", body: profileForm(body) });
    },
  });

}
