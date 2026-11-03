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
  "Secrets arrive as env bindings; console.log goes to the app's logs. " +
  'An idle app sleeps (status "asleep", no pods, no CPU charge) until its ' +
  "next request: allow 45 s for that first request (about 3 s normally, up " +
  'to about 80 s if a node must start); on 503 "the application is ' +
  'starting", retry after the Retry-After seconds, for up to 2 minutes. ' +
  "Data one app keeps (D1, KV, R2, Durable Objects) is its own; for data " +
  "several apps share, create a database (database.create) and grant each " +
  "app read or write (database.grant).";

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

  rl.registerAction("app.request", {
    access: "write",
    description:
      "Call one of the organization's own applications and get its answer: how an agent uses an app it built (an API, a calculator, a report) with no browser and no access code. Shift Cloud makes the call: it checks you're on the app's access list, then calls the app with its own credential, so your key never reaches the app. path is the app's own path and query, from its root (\"/\", \"/api/entries?limit=5\"). Answers {status, contentType, body} — the app's own status, and its body parsed when it is JSON. A sleeping app is woken (the first call can take a few seconds). Up to 5 MB.",
    inputSchema: t.Object(
      {
        app: App,
        method: t.Optional(
          t.Union(
            ["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => t.Literal(m)),
            { description: "Default GET" },
          ),
        ),
        path: t.String({ pattern: "^/", maxLength: 2048 }),
        headers: t.Optional(
          t.Record(t.String(), t.String({ maxLength: 4096 }), {
            description:
              "Passed on, except credentials (authorization, cookie) and Shift's own headers",
          }),
        ),
        body: t.Optional(
          t.String({
            maxLength: 900000,
            description:
              "The request body as text (JSON: stringify it and set content-type)",
          }),
        ),
      },
      STRICT_OBJECT,
    ),
    execute: (input, ctx) => {
      const { app: name, ...call } = input as { app: string };
      return request(ctx, `${app(name)}/request`, {
        method: "POST",
        body: JSON.stringify(call),
      });
    },
  });

  rl.registerAction("access.set", {
    access: "write",
    description:
      'Who may reach an application. allow: the callers a private app admits — {kind:"org",id}, {kind:"key",id} (one agent\'s key), {kind:"user",id|email} (default: this organization). To share an app with a person, add their email: they open its address and sign in with that email (Google, Microsoft, GitHub or email, through Shift Cloud), even with no Shift Cloud account, and reach only what is shared with them; removing it ends their access at once. Signing in needs the app\'s address to be https://. private: only callers sending a Shift Cloud key/token of this organization as a bearer. internal: no public address — only the internal gateway inside Shift\'s network. allowedIps: only these client CIDRs (null lifts). Fields left out keep their value.',
    inputSchema: t.Object(
      {
        app: App,
        private: t.Optional(t.Boolean()),
        allowPublicWithDatabases: t.Optional(
          t.Boolean({
            description:
              "Publish (private: false) even though the app holds database grants (refused otherwise). Only with the user's explicit yes.",
          }),
        ),
        internal: t.Optional(t.Boolean()),
        allow: t.Optional(
          t.Union([
            t.Array(
              t.Union([
                t.Object(
                  { kind: t.Literal("org"), id: t.String({ minLength: 1 }) },
                  STRICT_OBJECT,
                ),
                t.Object(
                  { kind: t.Literal("key"), id: t.String({ minLength: 1 }) },
                  STRICT_OBJECT,
                ),
                t.Object(
                  {
                    kind: t.Literal("user"),
                    id: t.Optional(t.String()),
                    email: t.Optional(t.String()),
                  },
                  STRICT_OBJECT,
                ),
              ]),
              { minItems: 1, maxItems: 100 },
            ),
            t.Null(),
          ]),
        ),
        allowedIps: t.Optional(
          t.Union([
            t.Array(
              t.String({ pattern: "^\\d{1,3}(\\.\\d{1,3}){3}/\\d{1,2}$" }),
              { minItems: 1, maxItems: 50 },
            ),
            t.Null(),
          ]),
        ),
      },
      STRICT_OBJECT,
    ),
    execute: (input, ctx) => {
      const { app: name, ...access } = input as {
        app: string;
        private?: boolean;
        internal?: boolean;
        allowedIps?: string[] | null;
      };
      return request(ctx, `${app(name)}/access`, {
        method: "PUT",
        body: JSON.stringify(access),
      });
    },
  });

  rl.registerAction("managers.set", {
    access: "write",
    description:
      'Who may manage an application (deploy, change, delete): {kind:"key",id} (an agent), {kind:"user",id|email}, {kind:"org",id}; null lets anyone with Workers write. Organization owners and admins always may. You must include yourself.',
    inputSchema: t.Object(
      {
        app: App,
        managers: t.Union([
          t.Array(
            t.Union([
              t.Object(
                { kind: t.Literal("org"), id: t.String({ minLength: 1 }) },
                STRICT_OBJECT,
              ),
              t.Object(
                { kind: t.Literal("key"), id: t.String({ minLength: 1 }) },
                STRICT_OBJECT,
              ),
              t.Object(
                {
                  kind: t.Literal("user"),
                  id: t.Optional(t.String()),
                  email: t.Optional(t.String()),
                },
                STRICT_OBJECT,
              ),
            ]),
            { minItems: 1, maxItems: 100 },
          ),
          t.Null(),
        ]),
      },
      STRICT_OBJECT,
    ),
    execute: (input, ctx) => {
      const { app: name, managers } = input as {
        app: string;
        managers: unknown[] | null;
      };
      return request(ctx, `${app(name)}/managers`, {
        method: "PUT",
        body: JSON.stringify({ managers }),
      });
    },
  });

  rl.registerAction("shareToken.create", {
    access: "write",
    description:
      'Databases only: create an access code for a program that queries a shared database (sends `token` as a bearer), with a role. Shown once: give it to the user to pass on; never send it anywhere yourself. Optional expiry; revocable. Apps have no access codes (refused): share an app with a person by email with access.set (allow {kind:"user", email}); they sign in with that email.',
    inputSchema: t.Object(
      {
        app: App,
        name: t.String({ minLength: 1, maxLength: 100 }),
        expiresInDays: t.Optional(t.Integer({ minimum: 1, maximum: 365 })),
        role: t.Optional(
          t.Union([t.Literal("read"), t.Literal("write")], {
            description:
              "On a database: read only, or read and write (default).",
          }),
        ),
      },
      STRICT_OBJECT,
    ),
    execute: (input, ctx) => {
      const { app: name, ...body } = input as {
        app: string;
        name: string;
        expiresInDays?: number;
        role?: "read" | "write";
      };
      return request(ctx, `${app(name)}/share-tokens`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
  });

  // ---- Shift databases: a shared SQL database, itself a celld app ----
  const db = (name: string) => `${BASE}/databases/${pathSegment(name)}`;
  const Database = t.String({
    pattern: "^[a-z][a-z0-9-]{0,19}$",
    description: "The database's name.",
  });
  const Param = t.Union([t.String(), t.Number(), t.Boolean(), t.Null()]);
  const Statement = t.Object(
    {
      sql: t.String({ minLength: 1, maxLength: 100000 }),
      params: t.Optional(t.Array(Param, { maxItems: 100 })),
    },
    STRICT_OBJECT,
  );

  rl.registerAction("database.list", {
    access: "read",
    description:
      "The organization's databases (shared SQLite databases, each its own always-private celld app): status, grants and access codes.",
    inputSchema: t.Object({}, STRICT_OBJECT),
    execute: (_input, ctx) => request(ctx, `${BASE}/databases`),
  });

  rl.registerAction("database.create", {
    access: "write",
    description:
      "Create a shared database (1-20 lowercase letters, digits, hyphens). It counts as an app toward the organization's limit, sleeps when idle like an app, and is always private. Ask the user before creating one.",
    inputSchema: t.Object({ name: Database }, STRICT_OBJECT),
    execute: (input, ctx) =>
      request(ctx, `${BASE}/databases`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });

  rl.registerAction("database.tables", {
    access: "read",
    description: "A database's tables, their columns and row counts.",
    inputSchema: t.Object({ database: Database }, STRICT_OBJECT),
    execute: (input, ctx) =>
      request(ctx, `${db((input as { database: string }).database)}/tables`),
  });

  rl.registerAction("database.query", {
    access: "write",
    description:
      "Run one SQL statement (SQLite) with ? parameters. Up to 1,000 rows / 2 MB come back (truncated: true says more exist). readOnly: true refuses any write. The first call after an idle spell can take a few seconds (the database wakes).",
    inputSchema: t.Object(
      {
        database: Database,
        sql: t.String({ minLength: 1, maxLength: 100000 }),
        params: t.Optional(t.Array(Param, { maxItems: 100 })),
        readOnly: t.Optional(t.Boolean()),
      },
      STRICT_OBJECT,
    ),
    execute: (input, ctx) => {
      const { database, ...body } = input as { database: string };
      return request(ctx, `${db(database)}/query`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
  });

  rl.registerAction("database.batch", {
    access: "write",
    description:
      "Run up to 100 statements as one transaction: all succeed or none apply.",
    inputSchema: t.Object(
      {
        database: Database,
        statements: t.Array(Statement, { minItems: 1, maxItems: 100 }),
        readOnly: t.Optional(t.Boolean()),
      },
      STRICT_OBJECT,
    ),
    execute: (input, ctx) => {
      const { database, ...body } = input as { database: string };
      return request(ctx, `${db(database)}/batch`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
  });

  rl.registerAction("database.grant", {
    access: "write",
    description:
      "Let an app use a database, read or read-write. The app gets secrets DB_<NAME>_URL and DB_<NAME>_TOKEN (its code calls POST <url>/query with {sql, params} and Authorization: Bearer <token>), and its live version is redeployed so it has them. Replaces the app's earlier grant.",
    inputSchema: t.Object(
      {
        database: Database,
        app: App,
        role: t.Union([t.Literal("read"), t.Literal("write")]),
        allowPublic: t.Optional(
          t.Boolean({
            description:
              "Grant to a public app anyway (refused otherwise): its code could expose the data to anyone. Only with the user's explicit yes.",
          }),
        ),
      },
      STRICT_OBJECT,
    ),
    execute: (input, ctx) => {
      const {
        database,
        app: target,
        ...body
      } = input as {
        database: string;
        app: string;
        role: string;
        allowPublic?: boolean;
      };
      return request(ctx, `${db(database)}/grants/${pathSegment(target)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },
  });

  rl.registerAction("database.setLimit", {
    access: "write",
    description:
      "Set a database's size limit in GB (null: back to the default, 5 GB). Writes that would grow it past the limit are refused (reads and deletes keep working). Only the organization's owners and admins may; a key gets 403. A write's answer carries `warning` above 1 GB: tell the user.",
    inputSchema: t.Object(
      {
        database: Database,
        maxGb: t.Union([t.Number({ exclusiveMinimum: 0 }), t.Null()]),
      },
      STRICT_OBJECT,
    ),
    execute: (input, ctx) => {
      const { database, maxGb } = input as {
        database: string;
        maxGb: number | null;
      };
      return request(ctx, `${db(database)}/limit`, {
        method: "PUT",
        body: JSON.stringify({ maxGb }),
      });
    },
  });

  rl.registerAction("database.revoke", {
    access: "write",
    description:
      "Take an app's access to a database away: its code stops working at once and its secrets are removed (the app is redeployed).",
    inputSchema: t.Object({ database: Database, app: App }, STRICT_OBJECT),
    execute: (input, ctx) => {
      const { database, app: target } = input as {
        database: string;
        app: string;
      };
      return request(ctx, `${db(database)}/grants/${pathSegment(target)}`, {
        method: "DELETE",
      });
    },
  });

  rl.registerAction("shareToken.list", {
    access: "read",
    description:
      "A database's access codes (for which program, expiry, revoked; never the code itself). Apps have none.",
    inputSchema: t.Object({ app: App }, STRICT_OBJECT),
    execute: (input, ctx) =>
      request(ctx, `${app((input as { app: string }).app)}/share-tokens`),
  });

  rl.registerAction("shareToken.revoke", {
    access: "write",
    description:
      "Revoke a database's access code; it stops working within seconds.",
    inputSchema: t.Object(
      { app: App, id: t.String({ minLength: 1 }) },
      STRICT_OBJECT,
    ),
    execute: (input, ctx) => {
      const { app: name, id } = input as { app: string; id: string };
      return request(ctx, `${app(name)}/share-tokens/${pathSegment(id)}`, {
        method: "DELETE",
      });
    },
  });

  rl.registerAction("egress.set", {
    access: "write",
    description:
      "Restrict the internet hostnames an application may call (e.g. api.stripe.com, *.example.com). An empty list blocks every outbound call (databases granted to the app stay reachable); null lifts the restriction. A call to a host not listed fails at once: its name doesn't resolve (a raw IP address waits until it times out). A change holds at once, and the app's pods restart within about a minute, dropping addresses and connections kept from before. app.get shows allowedHosts only while one is set.",
    inputSchema: t.Object(
      {
        app: App,
        hosts: t.Union([
          t.Array(t.String({ minLength: 3, maxLength: 253 }), { maxItems: 50 }),
          t.Null(),
        ]),
      },
      STRICT_OBJECT,
    ),
    execute: (input, ctx) => {
      const { app: name, hosts } = input as {
        app: string;
        hosts: string[] | null;
      };
      return request(ctx, `${app(name)}/egress`, {
        method: "PUT",
        body: JSON.stringify({ hosts }),
      });
    },
  });

  rl.registerAction("sleep.set", {
    access: "write",
    description:
      "When an idle application sleeps: after this many idle minutes (5 to 10080; default 15) it has no pods and costs no CPU, and its next request wakes it (about 3 s, up to about 80 s if a node must start). Idleness is checked every 5 minutes, so it falls asleep 0-5 minutes after the time is up. null keeps it always on (no cold starts, its two pods are charged all the time). An app with cron triggers, queue consumers or Workflows is always on regardless (app.get: runsOnItsOwn).",
    inputSchema: t.Object(
      {
        app: App,
        minutes: t.Union([t.Integer({ minimum: 5, maximum: 10080 }), t.Null()]),
      },
      STRICT_OBJECT,
    ),
    execute: (input, ctx) => {
      const { app: name, minutes } = input as {
        app: string;
        minutes: number | null;
      };
      return request(ctx, `${app(name)}/sleep`, {
        method: "PUT",
        body: JSON.stringify({ minutes }),
      });
    },
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
