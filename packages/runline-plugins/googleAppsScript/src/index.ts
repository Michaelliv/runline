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
import { pathSegment } from "../../_shared/credentials.js";
import {
  googleCredential,
  googleJsonRequest,
} from "../../_shared/googleAuth.js";
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

/** A project file as the Apps Script API answers it. */
interface ScriptFile {
  name: string;
  type: string;
  source: string;
}

/** `T` is the caller's statement of the answer's shape, unchecked, as for any parsed JSON. */
async function call<T = unknown>(
  ctx: ActionContext,
  method: string,
  url: string,
  payload?: unknown,
): Promise<T> {
  return googleJsonRequest<T>(
    ctx,
    "googleAppsScript",
    SCOPES,
    method,
    url,
    payload,
  );
}

export default function googleAppsScript(rl: RunlinePluginAPI): void {
  rl.setName("googleAppsScript");
  rl.setVersion("1.0.0");
  rl.setCredential(googleCredential("googleAppsScript", SCOPES));

  rl.setConnectionSchema({
    authMethod: {
      type: "string",
      required: false,
      description:
        "delegated or serviceAccount (legacy configs infer the method)",
    },
    clientId: {
      type: "string",
      required: false,
      description: "OAuth client ID",
      env: "GOOGLE_APPS_SCRIPT_CLIENT_ID",
    },
    clientSecret: {
      type: "string",
      required: false,
      description: "OAuth client secret",
      env: "GOOGLE_APPS_SCRIPT_CLIENT_SECRET",
    },
    refreshToken: {
      type: "string",
      required: false,
      description: "OAuth refresh token",
      env: "GOOGLE_APPS_SCRIPT_REFRESH_TOKEN",
    },
    serviceAccountJson: {
      type: "string",
      required: false,
      description: "Service-account key JSON",
      env: "GOOGLE_APPS_SCRIPT_SERVICE_ACCOUNT_JSON",
    },
    serviceAccountEmail: {
      type: "string",
      required: false,
      description: "Service-account email",
      env: "GOOGLE_APPS_SCRIPT_SERVICE_ACCOUNT_EMAIL",
    },
    serviceAccountPrivateKey: {
      type: "string",
      required: false,
      description: "Service-account private key",
      env: "GOOGLE_APPS_SCRIPT_SERVICE_ACCOUNT_PRIVATE_KEY",
    },
    serviceAccountSubject: {
      type: "string",
      required: false,
      description: "User to impersonate (domain-wide delegation)",
      env: "GOOGLE_APPS_SCRIPT_SERVICE_ACCOUNT_SUBJECT",
    },
  });

  rl.registerAction("script.list", {
    access: "read",
    description:
      "List Apps Script projects in Drive (standalone scripts; bound scripts live inside their container and don't appear here).",
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
    async execute(input, ctx: ActionContext) {
      const p = input as { query?: string; pageSize?: number };
      const params = new URLSearchParams({
        q: "mimeType='application/vnd.google-apps.script' and trashed=false",
        fields: "files(id,name,modifiedTime)",
        pageSize: String(p.pageSize ?? 50),
        orderBy: "modifiedTime desc",
      });
      const res = await call<{
        files?: Array<{ id?: string; name?: string; modifiedTime?: string }>;
      }>(ctx, "GET", `${DRIVE_API}/files?${params}`);
      let files = res.files ?? [];
      if (p.query) {
        const q = String(p.query).toLowerCase();
        files = files.filter((f) => (f.name || "").toLowerCase().includes(q));
      }
      return { count: files.length, scripts: files };
    },
  });

  rl.registerAction("project.getContent", {
    access: "read",
    description:
      "Get all files of an Apps Script project (name, type, source).",
    inputSchema: t.Object({ scriptId: Id }, { additionalProperties: false }),
    async execute(input, ctx: ActionContext) {
      const p = input as { scriptId: string };
      const res = await call<{ files?: ScriptFile[] }>(
        ctx,
        "GET",
        `${SCRIPT_API}/projects/${pathSegment(p.scriptId)}/content`,
      );
      return { scriptId: p.scriptId, files: res.files ?? [] };
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
          description:
            "File name without extension (e.g. 'Code', 'appsscript').",
        }),
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx: ActionContext) {
      const p = input as { scriptId: string; name: string };
      const res = await call<{ files?: ScriptFile[] }>(
        ctx,
        "GET",
        `${SCRIPT_API}/projects/${pathSegment(p.scriptId)}/content`,
      );
      const file = (res.files ?? []).find((f) => f.name === p.name);
      if (!file)
        throw new Error(
          `No file "${p.name}". Available: ${(res.files ?? []).map((f) => f.name).join(", ")}`,
        );
      return { name: file.name, type: file.type, source: file.source };
    },
  });

  rl.registerAction("file.edit", {
    access: "write",
    description:
      "Replace (or add) a single file's source, leaving other files untouched. Read-modify-write — the safe way to change code.",
    inputSchema: t.Object(
      {
        scriptId: Id,
        name: NonEmptyString,
        source: t.String(),
        type: t.Optional(stringEnum(["SERVER_JS", "HTML", "JSON"] as const)),
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx: ActionContext) {
      const p = input as {
        scriptId: string;
        name: string;
        source: string;
        type?: string;
      };
      const cur = await call<{ files?: ScriptFile[] }>(
        ctx,
        "GET",
        `${SCRIPT_API}/projects/${pathSegment(p.scriptId)}/content`,
      );
      const files = cur.files ?? [];
      const idx = files.findIndex((f) => f.name === p.name);
      const type =
        p.type ||
        (p.name === "appsscript" ? "JSON" : files[idx]?.type || "SERVER_JS");
      const entry = { name: p.name, type, source: p.source };
      if (idx >= 0) files[idx] = entry;
      else files.push(entry);
      await call(
        ctx,
        "PUT",
        `${SCRIPT_API}/projects/${pathSegment(p.scriptId)}/content`,
        {
          files,
        },
      );
      return { scriptId: p.scriptId, updated: p.name, fileCount: files.length };
    },
  });

  rl.registerAction("project.updateContent", {
    access: "write",
    description:
      "Replace the entire project file set. files = [{name, type, source}], must include the appsscript JSON manifest. Prefer file.edit for single changes.",
    inputSchema: t.Object(
      {
        scriptId: Id,
        files: t.Array(scriptFileSchema, {
          minItems: 1,
          contains: t.Object({
            name: t.Literal("appsscript"),
            type: t.Literal("JSON"),
          }),
          description:
            "Complete project files, including the appsscript JSON manifest",
        }),
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx: ActionContext) {
      const p = input as { scriptId: string; files: ScriptFile[] };
      const res = await call<{ files?: ScriptFile[] }>(
        ctx,
        "PUT",
        `${SCRIPT_API}/projects/${pathSegment(p.scriptId)}/content`,
        { files: p.files },
      );
      return { scriptId: p.scriptId, fileCount: (res.files ?? []).length };
    },
  });

  rl.registerAction("project.create", {
    access: "write",
    description:
      "Create a new Apps Script project. Pass parentId (a Drive file id, e.g. a Sheet) to bind it to that container.",
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
    async execute(input, ctx: ActionContext) {
      const p = input as { title: string; parentId?: string };
      const payload: Record<string, unknown> = { title: p.title };
      if (p.parentId) payload.parentId = p.parentId;
      const res = await call<{
        scriptId?: string;
        title?: string;
        parentId?: string;
      }>(ctx, "POST", `${SCRIPT_API}/projects`, payload);
      return {
        scriptId: res.scriptId,
        title: res.title,
        parentId: res.parentId,
      };
    },
  });

  rl.registerAction("version.create", {
    access: "write",
    description:
      "Create an immutable version of the project (needed before deploying).",
    inputSchema: t.Object(
      {
        scriptId: Id,
        description: t.Optional(t.String()),
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx: ActionContext) {
      const p = input as { scriptId: string; description?: string };
      const res = await call<{ versionNumber?: number; description?: string }>(
        ctx,
        "POST",
        `${SCRIPT_API}/projects/${pathSegment(p.scriptId)}/versions`,
        { description: p.description || "" },
      );
      return {
        scriptId: p.scriptId,
        versionNumber: res.versionNumber,
        description: res.description,
      };
    },
  });

  rl.registerAction("deployment.create", {
    access: "write",
    description:
      "Deploy a version. For function.run, deploy with an API-executable manifest (executionApi access).",
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
    async execute(input, ctx: ActionContext) {
      const p = input as {
        scriptId: string;
        versionNumber: number;
        description?: string;
        manifestFileName?: string;
      };
      const res = await call<{ deploymentId?: string; entryPoints?: unknown }>(
        ctx,
        "POST",
        `${SCRIPT_API}/projects/${pathSegment(p.scriptId)}/deployments`,
        {
          versionNumber: p.versionNumber,
          manifestFileName: p.manifestFileName || "appsscript",
          description: p.description || "",
        },
      );
      return { deploymentId: res.deploymentId, entryPoints: res.entryPoints };
    },
  });

  rl.registerAction("function.run", {
    access: "write",
    description:
      "Run a function via scripts.run. Requires the project linked to a standard GCP project, the Apps Script API enabled, and an API-executable deployment (or devMode for the owner).",
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
    async execute(input, ctx: ActionContext) {
      const p = input as {
        scriptId: string;
        functionName: string;
        parameters?: unknown[];
        devMode?: boolean;
      };
      const res = await call<{
        done?: boolean;
        response?: { result?: unknown };
        error?: {
          message?: string;
          details?: Array<{ errorMessage?: string }>;
        };
      }>(ctx, "POST", `${SCRIPT_API}/scripts/${pathSegment(p.scriptId)}:run`, {
        function: p.functionName,
        parameters: p.parameters ?? [],
        devMode: p.devMode === undefined ? true : p.devMode,
      });
      if (res.error) {
        const d = res.error.details?.[0];
        throw new Error(
          `Function error: ${d?.errorMessage || res.error.message}`,
        );
      }
      return { done: res.done, result: res.response?.result ?? null };
    },
  });

  rl.registerAction("process.list", {
    access: "read",
    description:
      "Recent executions for a project (status, function, times) — a log view.",
    inputSchema: t.Object(
      {
        scriptId: Id,
        pageSize: t.Optional(
          t.Integer({ minimum: 1, maximum: 50, description: "Default 20." }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx: ActionContext) {
      const p = input as { scriptId: string; pageSize?: number };
      const params = new URLSearchParams({
        "userProcessFilter.scriptId": p.scriptId,
        pageSize: String(p.pageSize ?? 20),
      });
      const res = await call<{ processes?: unknown[] }>(
        ctx,
        "GET",
        `${SCRIPT_API}/processes?${params}`,
      );
      return {
        count: (res.processes ?? []).length,
        processes: res.processes ?? [],
      };
    },
  });
}
