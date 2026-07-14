/**
 * Google Apps Script plugin for runline.
 *
 * Manage Apps Script projects via the Apps Script REST API + Drive: read/edit/
 * push project code, create projects, cut versions, deploy, run functions, and
 * read execution history. Fills the gap left by googleDrive/googleSheets/etc.,
 * which don't reach the Apps Script project surface.
 *
 * Auth: shared Google OAuth client family (or a service account), via
 * _shared/googleAuth.ts — same model as googleDrive.
 */
import type { ActionContext, RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { googleAccessToken } from "../../_shared/googleAuth.js";
import {
  Id,
  NonEmptyString,
  PositiveInteger,
  stringEnum,
} from "../../_shared/googleSchemas.js";

const SCRIPT_API = "https://script.googleapis.com/v1";
const DRIVE_API = "https://www.googleapis.com/drive/v3";

const SCOPES = [
  "https://www.googleapis.com/auth/script.projects",
  "https://www.googleapis.com/auth/script.deployments",
  "https://www.googleapis.com/auth/script.processes",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
];

const scriptFileTypeSchema = stringEnum(["SERVER_JS", "HTML", "JSON"] as const);
const jsonValueSchema = t.Unsafe({
  $defs: {
    value: {
      anyOf: [
        { type: "null" },
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "array", items: { $ref: "#/$defs/value" } },
        {
          type: "object",
          additionalProperties: { $ref: "#/$defs/value" },
        },
      ],
    },
  },
  $ref: "#/$defs/value",
});
const scriptFileSchema = t.Object(
  {
    name: NonEmptyString,
    type: scriptFileTypeSchema,
    source: t.String(),
  },
  { additionalProperties: false },
);

function accessToken(ctx: ActionContext): Promise<string> {
  return googleAccessToken(ctx, "googleAppsScript", SCOPES);
}

async function call(ctx: ActionContext, method: string, url: string, payload?: unknown): Promise<any> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken(ctx)}` };
  if (payload !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.error?.message || json?.error_description || text.slice(0, 300) || res.status;
    throw new Error(`googleAppsScript: ${method} ${res.status}: ${msg}`);
  }
  return json;
}

export default function googleAppsScript(rl: RunlinePluginAPI): void {
  rl.setName("googleAppsScript");
  rl.setVersion("1.0.0");

  rl.setConnectionSchema({
    clientId: { type: "string", required: false, description: "OAuth client ID", env: "GOOGLE_APPS_SCRIPT_CLIENT_ID" },
    clientSecret: { type: "string", required: false, description: "OAuth client secret", env: "GOOGLE_APPS_SCRIPT_CLIENT_SECRET" },
    refreshToken: { type: "string", required: false, description: "OAuth refresh token", env: "GOOGLE_APPS_SCRIPT_REFRESH_TOKEN" },
    serviceAccountJson: { type: "string", required: false, description: "Service-account key JSON", env: "GOOGLE_APPS_SCRIPT_SERVICE_ACCOUNT_JSON" },
    serviceAccountEmail: { type: "string", required: false, description: "Service-account email", env: "GOOGLE_APPS_SCRIPT_SERVICE_ACCOUNT_EMAIL" },
    serviceAccountPrivateKey: { type: "string", required: false, description: "Service-account private key", env: "GOOGLE_APPS_SCRIPT_SERVICE_ACCOUNT_PRIVATE_KEY" },
    serviceAccountSubject: { type: "string", required: false, description: "User to impersonate (domain-wide delegation)", env: "GOOGLE_APPS_SCRIPT_SERVICE_ACCOUNT_SUBJECT" },
  });

  rl.registerAction("script.list", {
    access: "read",
    description: "List Apps Script projects in Drive (standalone scripts; bound scripts live inside their container and don't appear here).",
    inputSchema: t.Object(
      {
        query: t.Optional(
          t.String({ description: "Case-insensitive name substring filter." }),
        ),
        pageSize: t.Optional(
          t.Integer({
            minimum: 1,
            maximum: 1000,
            description: "Max results (default 50).",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(input: any, ctx: ActionContext) {
      const params = new URLSearchParams({
        q: "mimeType='application/vnd.google-apps.script' and trashed=false",
        fields: "files(id,name,modifiedTime)",
        pageSize: String(input.pageSize ?? 50),
        orderBy: "modifiedTime desc",
      });
      const res = await call(ctx, "GET", `${DRIVE_API}/files?${params}`);
      let files = res.files ?? [];
      if (input.query) {
        const q = String(input.query).toLowerCase();
        files = files.filter((f: any) => (f.name || "").toLowerCase().includes(q));
      }
      return { count: files.length, scripts: files };
    },
  });

  rl.registerAction("project.getContent", {
    access: "read",
    description: "Get all files of an Apps Script project (name, type, source).",
    inputSchema: t.Object(
      { scriptId: Id },
      { additionalProperties: false },
    ),
    async execute(input: any, ctx: ActionContext) {
      const res = await call(ctx, "GET", `${SCRIPT_API}/projects/${input.scriptId}/content`);
      return { scriptId: input.scriptId, files: res.files ?? [] };
    },
  });

  rl.registerAction("project.readFile", {
    access: "read",
    description: "Read one file's source from a project.",
    inputSchema: t.Object(
      {
        scriptId: Id,
        name: t.String({
          minLength: 1,
          description: "File name without extension (e.g. 'Code', 'appsscript').",
        }),
      },
      { additionalProperties: false },
    ),
    async execute(input: any, ctx: ActionContext) {
      const res = await call(ctx, "GET", `${SCRIPT_API}/projects/${input.scriptId}/content`);
      const file = (res.files ?? []).find((f: any) => f.name === input.name);
      if (!file) throw new Error(`No file "${input.name}". Available: ${(res.files ?? []).map((f: any) => f.name).join(", ")}`);
      return { name: file.name, type: file.type, source: file.source };
    },
  });

  rl.registerAction("file.edit", {
    access: "write",
    description: "Replace (or add) a single file's source, leaving other files untouched. Read-modify-write — the safe way to change code.",
    inputSchema: t.Object(
      {
        scriptId: Id,
        name: NonEmptyString,
        source: t.String(),
        type: t.Optional(
          stringEnum(["SERVER_JS", "HTML", "JSON"] as const),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(input: any, ctx: ActionContext) {
      const cur = await call(ctx, "GET", `${SCRIPT_API}/projects/${input.scriptId}/content`);
      const files = cur.files ?? [];
      const idx = files.findIndex((f: any) => f.name === input.name);
      const type = input.type || (input.name === "appsscript" ? "JSON" : files[idx]?.type || "SERVER_JS");
      const entry = { name: input.name, type, source: input.source };
      if (idx >= 0) files[idx] = entry;
      else files.push(entry);
      await call(ctx, "PUT", `${SCRIPT_API}/projects/${input.scriptId}/content`, { files });
      return { scriptId: input.scriptId, updated: input.name, fileCount: files.length };
    },
  });

  rl.registerAction("project.updateContent", {
    access: "write",
    description: "Replace the entire project file set. files = [{name, type, source}], must include the appsscript JSON manifest. Prefer file.edit for single changes.",
    inputSchema: t.Object(
      {
        scriptId: Id,
        files: t.Array(scriptFileSchema, {
          minItems: 1,
          contains: t.Object({
            name: t.Literal("appsscript"),
            type: t.Literal("JSON"),
          }),
          description: "Complete project files, including the appsscript JSON manifest",
        }),
      },
      { additionalProperties: false },
    ),
    async execute(input: any, ctx: ActionContext) {
      const res = await call(ctx, "PUT", `${SCRIPT_API}/projects/${input.scriptId}/content`, { files: input.files });
      return { scriptId: input.scriptId, fileCount: (res.files ?? []).length };
    },
  });

  rl.registerAction("project.create", {
    access: "write",
    description: "Create a new Apps Script project. Pass parentId (a Drive file id, e.g. a Sheet) to bind it to that container.",
    inputSchema: t.Object(
      {
        title: NonEmptyString,
        parentId: t.Optional(
          t.String({
            minLength: 1,
            description: "Container Drive file id for a bound script.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(input: any, ctx: ActionContext) {
      const payload: any = { title: input.title };
      if (input.parentId) payload.parentId = input.parentId;
      const res = await call(ctx, "POST", `${SCRIPT_API}/projects`, payload);
      return { scriptId: res.scriptId, title: res.title, parentId: res.parentId };
    },
  });

  rl.registerAction("version.create", {
    access: "write",
    description: "Create an immutable version of the project (needed before deploying).",
    inputSchema: t.Object(
      {
        scriptId: Id,
        description: t.Optional(t.String()),
      },
      { additionalProperties: false },
    ),
    async execute(input: any, ctx: ActionContext) {
      const res = await call(ctx, "POST", `${SCRIPT_API}/projects/${input.scriptId}/versions`, { description: input.description || "" });
      return { scriptId: input.scriptId, versionNumber: res.versionNumber, description: res.description };
    },
  });

  rl.registerAction("deployment.create", {
    access: "write",
    description: "Deploy a version. For function.run, deploy with an API-executable manifest (executionApi access).",
    inputSchema: t.Object(
      {
        scriptId: Id,
        versionNumber: PositiveInteger,
        description: t.Optional(t.String()),
        manifestFileName: t.Optional(
          t.String({ minLength: 1, description: "Defaults to 'appsscript'." }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(input: any, ctx: ActionContext) {
      const res = await call(ctx, "POST", `${SCRIPT_API}/projects/${input.scriptId}/deployments`, {
        versionNumber: input.versionNumber,
        manifestFileName: input.manifestFileName || "appsscript",
        description: input.description || "",
      });
      return { deploymentId: res.deploymentId, entryPoints: res.entryPoints };
    },
  });

  rl.registerAction("function.run", {
    access: "write",
    description: "Run a function via scripts.run. Requires the project linked to a standard GCP project, the Apps Script API enabled, and an API-executable deployment (or devMode for the owner).",
    inputSchema: t.Object(
      {
        scriptId: Id,
        functionName: NonEmptyString,
        parameters: t.Optional(t.Array(jsonValueSchema)),
        devMode: t.Optional(
          t.Boolean({
            description: "Run latest saved code (owner only). Default true.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(input: any, ctx: ActionContext) {
      const res = await call(ctx, "POST", `${SCRIPT_API}/scripts/${input.scriptId}:run`, {
        function: input.functionName,
        parameters: input.parameters ?? [],
        devMode: input.devMode === undefined ? true : input.devMode,
      });
      if (res.error) {
        const d = res.error.details?.[0];
        throw new Error(`Function error: ${d?.errorMessage || res.error.message}`);
      }
      return { done: res.done, result: res.response?.result ?? null };
    },
  });

  rl.registerAction("process.list", {
    access: "read",
    description: "Recent executions for a project (status, function, times) — a log view.",
    inputSchema: t.Object(
      {
        scriptId: Id,
        pageSize: t.Optional(
          t.Integer({ minimum: 1, maximum: 50, description: "Default 20." }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(input: any, ctx: ActionContext) {
      const params = new URLSearchParams({
        "userProcessFilter.scriptId": input.scriptId,
        pageSize: String(input.pageSize ?? 20),
      });
      const res = await call(ctx, "GET", `${SCRIPT_API}/processes?${params}`);
      return { count: (res.processes ?? []).length, processes: res.processes ?? [] };
    },
  });
}
