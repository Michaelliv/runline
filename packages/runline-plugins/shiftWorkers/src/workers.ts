import { pathSegment, type RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { STRICT_OBJECT } from "../../_shared/shiftCloud.js";
import { request } from "./credentials.js";

const BASE = "/v1/services/workers";

const App = t.String({
  pattern: "^[a-z]([a-z0-9-]{0,18}[a-z0-9])?$",
  description:
    "Application name: 1–20 lowercase letters, digits and hyphens, starting with a letter",
});

const GUIDE =
  "An application is a Cloudflare Workers-API project: a files map with " +
  '"wrangler.json" ({ name, main, compatibility_date, vars?, ' +
  "durable_objects.bindings, migrations: [{ tag, new_sqlite_classes }] }) " +
  "and its ES-module main file (export default { fetch }; Durable Object " +
  'classes extend DurableObject from "cloudflare:workers" and use ' +
  "this.ctx.storage.sql). Only local files are bundled, no npm packages. " +
  "Secrets arrive as env bindings; console.log goes to the app's logs.";

const app = (name: string) => `${BASE}/apps/${pathSegment(name)}`;

export function registerWorkersActions(rl: RunlinePluginAPI) {
  rl.registerAction("app.list", {
    access: "read",
    description: `List the organization's Worker applications with status, url and live version. ${GUIDE}`,
    inputSchema: t.Object(
      {
        includeDeleted: t.Optional(
          t.Boolean({
            description: "Include applications deleted in the last 30 days",
          }),
        ),
      },
      STRICT_OBJECT,
    ),
    execute: (input, ctx) => {
      const { includeDeleted } = input as { includeDeleted?: boolean };
      return request(ctx, `${BASE}/apps`, {
        query: includeDeleted ? { deleted: "true" } : undefined,
      });
    },
  });

  rl.registerAction("app.get", {
    access: "read",
    description:
      "One application: status, url, live version, deployments, pods and secret names.",
    inputSchema: t.Object({ app: App }, STRICT_OBJECT),
    execute: (input, ctx) => request(ctx, app((input as { app: string }).app)),
  });

  rl.registerAction("app.create", {
    access: "write",
    description: `Create an application with its own fleet, storage and url; then upload code with version.upload. ${GUIDE}`,
    inputSchema: t.Object({ app: App }, STRICT_OBJECT),
    execute: (input, ctx) =>
      request(ctx, `${BASE}/apps`, {
        method: "POST",
        body: JSON.stringify({ name: (input as { app: string }).app }),
      }),
  });

  rl.registerAction("app.delete", {
    access: "write",
    description:
      "Delete an application: it stops serving and is kept 30 days; app.restore undoes it.",
    inputSchema: t.Object({ app: App }, STRICT_OBJECT),
    execute: (input, ctx) =>
      request(ctx, app((input as { app: string }).app), { method: "DELETE" }),
  });

  const lifecycle = {
    suspend: "Stop serving an application; its data is kept.",
    resume: "Serve a suspended application again.",
    restore: "Undo a delete, within 30 days.",
    repair:
      "Re-create whatever the application is missing (route, fleet, storage link).",
  } as const;
  for (const [action, description] of Object.entries(lifecycle)) {
    rl.registerAction(`app.${action}`, {
      access: "write",
      description,
      inputSchema: t.Object({ app: App }, STRICT_OBJECT),
      execute: (input, ctx) =>
        request(ctx, `${app((input as { app: string }).app)}/${action}`, {
          method: "POST",
        }),
    });
  }

  rl.registerAction("version.upload", {
    access: "write",
    description: `Upload code as a new immutable version and, by default, deploy it. Returns the version, the deployment and the application with its url. ${GUIDE}`,
    inputSchema: t.Object(
      {
        app: App,
        files: t.Record(t.String(), t.String(), {
          description:
            'Path to file content, e.g. { "wrangler.json": "...", "src/index.js": "..." }',
        }),
        message: t.Optional(
          t.String({ maxLength: 500, description: "What changed" }),
        ),
        deploy: t.Optional(
          t.Boolean({ description: "Deploy right away (default true)" }),
        ),
      },
      STRICT_OBJECT,
    ),
    execute: (input, ctx) => {
      const { app: name, ...body } = input as {
        app: string;
        files: Record<string, string>;
        message?: string;
        deploy?: boolean;
      };
      return request(ctx, `${app(name)}/versions`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
  });

  rl.registerAction("version.list", {
    access: "read",
    description: "An application's versions, newest first.",
    inputSchema: t.Object({ app: App }, STRICT_OBJECT),
    execute: (input, ctx) =>
      request(ctx, `${app((input as { app: string }).app)}/versions`),
  });

  rl.registerAction("deployment.create", {
    access: "write",
    description:
      "Deploy a version (default: the newest). Deploying an earlier version is a rollback.",
    inputSchema: t.Object(
      {
        app: App,
        version: t.Optional(
          t.Integer({ minimum: 1, description: "Version number" }),
        ),
      },
      STRICT_OBJECT,
    ),
    execute: (input, ctx) => {
      const { app: name, version } = input as { app: string; version?: number };
      return request(ctx, `${app(name)}/deployments`, {
        method: "POST",
        body: JSON.stringify({ version }),
      });
    },
  });

  rl.registerAction("secret.list", {
    access: "read",
    description: "An application's secret names; values are never returned.",
    inputSchema: t.Object({ app: App }, STRICT_OBJECT),
    execute: (input, ctx) =>
      request(ctx, `${app((input as { app: string }).app)}/secrets`),
  });

  rl.registerAction("secret.set", {
    access: "write",
    description:
      "Set a write-only secret, read by the application as an env binding; redeploys the live version.",
    inputSchema: t.Object(
      {
        app: App,
        name: t.String({
          pattern: "^[A-Za-z_][A-Za-z0-9_]{0,63}$",
          description: "Secret name, e.g. API_TOKEN",
        }),
        value: t.String({ maxLength: 32768, description: "Secret value" }),
      },
      STRICT_OBJECT,
    ),
    execute: (input, ctx) => {
      const {
        app: name,
        name: secret,
        value,
      } = input as { app: string; name: string; value: string };
      return request(ctx, `${app(name)}/secrets/${pathSegment(secret)}`, {
        method: "PUT",
        body: JSON.stringify({ value }),
      });
    },
  });

  rl.registerAction("secret.delete", {
    access: "write",
    description: "Remove a secret; redeploys the live version.",
    inputSchema: t.Object(
      {
        app: App,
        name: t.String({ minLength: 1, description: "Secret name" }),
      },
      STRICT_OBJECT,
    ),
    execute: (input, ctx) => {
      const { app: name, name: secret } = input as {
        app: string;
        name: string;
      };
      return request(ctx, `${app(name)}/secrets/${pathSegment(secret)}`, {
        method: "DELETE",
      });
    },
  });

  rl.registerAction("preview.create", {
    access: "write",
    description:
      "Run a version (default: the newest) on the application's preview: one pod with its own data at <app>-<org>-preview, the live version untouched. Returns the preview url. Removed after 24 hours.",
    inputSchema: t.Object(
      {
        app: App,
        version: t.Optional(
          t.Integer({ minimum: 1, description: "Version number" }),
        ),
      },
      STRICT_OBJECT,
    ),
    execute: (input, ctx) => {
      const { app: name, version } = input as { app: string; version?: number };
      return request(ctx, `${app(name)}/preview`, {
        method: "POST",
        body: JSON.stringify({ version }),
      });
    },
  });

  rl.registerAction("data.get", {
    access: "read",
    description:
      "What an application holds: its Durable Object instances (up to 200) and the bytes in its storage.",
    inputSchema: t.Object({ app: App }, STRICT_OBJECT),
    execute: (input, ctx) =>
      request(ctx, `${app((input as { app: string }).app)}/data`),
  });

  rl.registerAction("usage.get", {
    access: "read",
    description:
      "This month's Workers usage and spend for the organization, per application, with the spend cap and whether it was reached.",
    inputSchema: t.Object({}, STRICT_OBJECT),
    execute: (_input, ctx) => request(ctx, `${BASE}/usage`),
  });

  rl.registerAction("spendCap.set", {
    access: "write",
    description:
      "Set the organization's monthly Workers spend cap in USD (null removes it). Owners and admins are emailed at 50/80/100%; at the cap applications stop, data kept, until the cap is raised.",
    inputSchema: t.Object(
      { usd: t.Union([t.Number({ exclusiveMinimum: 0 }), t.Null()]) },
      STRICT_OBJECT,
    ),
    execute: (input, ctx) =>
      request(ctx, `${BASE}/spend-cap`, {
        method: "PUT",
        body: JSON.stringify({ usd: (input as { usd: number | null }).usd }),
      }),
  });

  rl.registerAction("app.purge", {
    access: "write",
    description:
      "Remove a deleted application for good now, with its data (skips the 30-day hold; cannot be undone).",
    inputSchema: t.Object({ app: App }, STRICT_OBJECT),
    execute: (input, ctx) =>
      request(ctx, app((input as { app: string }).app), {
        method: "DELETE",
        query: { permanent: "true" },
      }),
  });

  rl.registerAction("logs.list", {
    access: "read",
    description:
      "Recent log lines of an application: console output and errors.",
    inputSchema: t.Object(
      {
        app: App,
        minutes: t.Optional(
          t.Integer({
            minimum: 1,
            maximum: 10080,
            description: "Look back this many minutes (default 60)",
          }),
        ),
        filter: t.Optional(
          t.String({
            minLength: 1,
            description: "Only lines containing this text",
          }),
        ),
      },
      STRICT_OBJECT,
    ),
    execute: (input, ctx) => {
      const {
        app: name,
        minutes,
        filter,
      } = input as { app: string; minutes?: number; filter?: string };
      return request(ctx, `${app(name)}/logs`, { query: { minutes, filter } });
    },
  });
}
