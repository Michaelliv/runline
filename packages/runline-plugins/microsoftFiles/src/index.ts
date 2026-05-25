/**
 * Microsoft OneDrive / SharePoint files plugin for runline (Microsoft Graph).
 *
 * Auth: shared "microsoft" OAuth family (delegated → /me/drive) or app-only
 * (tenantId/clientId/clientSecret + userUpn → /users/{upn}/drive). Optionally
 * target a SharePoint document library with siteId/driveId. See
 * _shared/microsoftAuth.ts. Graph delegated scopes: Files.ReadWrite.All,
 * Sites.ReadWrite.All (use the .Read.* variants if you only need reads).
 */
import type { ActionContext, RunlinePluginAPI } from "runline";
import {
  graphRequest,
  microsoftAccessToken,
  microsoftSetupHelp,
  userBase,
} from "../../_shared/microsoftAuth.js";

const NAME = "microsoftFiles";
const SCOPES = [
  "https://graph.microsoft.com/Files.ReadWrite.All",
  "https://graph.microsoft.com/Sites.ReadWrite.All",
];
type Ctx = ActionContext;

/** Resolve the drive root path: explicit drive/site, else the user's default drive. */
function driveBase(ctx: Ctx): string {
  const cfg = ctx.connection.config as Record<string, string>;
  if (cfg.driveId) return `/drives/${cfg.driveId}`;
  if (cfg.siteId) return `/sites/${cfg.siteId}/drive`;
  return `${userBase(ctx)}/drive`;
}

async function binaryFetch(ctx: Ctx, method: string, path: string, body?: Uint8Array) {
  const token = await microsoftAccessToken(ctx, NAME, SCOPES);
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/octet-stream" } : {}),
    },
    body: body as BodyInit | undefined,
  });
  return res;
}

export default function microsoftFiles(rl: RunlinePluginAPI): void {
  rl.setName(NAME);
  rl.setVersion("1.0.0");

  rl.setConnectionSchema({
    tenantId: { type: "string", required: false, env: "MS_GRAPH_TENANT_ID", description: "Entra tenant id (app-only) or omit for OAuth /common" },
    clientId: { type: "string", required: false, env: "MS_GRAPH_CLIENT_ID", description: "App (client) id" },
    clientSecret: { type: "string", required: false, env: "MS_GRAPH_CLIENT_SECRET", description: "Client secret VALUE" },
    userUpn: { type: "string", required: false, env: "MS_GRAPH_USER_UPN", description: "App-only only: target user UPN (their OneDrive)" },
    siteId: { type: "string", required: false, env: "MS_SHAREPOINT_SITE_ID", description: "Optional SharePoint site id (use its default drive)" },
    driveId: { type: "string", required: false, env: "MS_GRAPH_DRIVE_ID", description: "Optional explicit drive id (overrides site/user)" },
  });

  rl.setOAuth({
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: [...SCOPES, "offline_access"],
    authParams: { prompt: "consent" },
    setupHelp: microsoftSetupHelp("Files.ReadWrite.All, Sites.ReadWrite.All"),
  });

  rl.registerAction("files.search", {
    description:
      "Search the drive for files/folders by text. Returns [{id,name,size,lastModifiedDateTime,webUrl,folder?}].",
    inputSchema: {
      query: { type: "string", required: true },
      top: { type: "number", required: false, default: 25 },
    },
    async execute(input: any, ctx: Ctx) {
      const q = encodeURIComponent(input.query);
      const qs = new URLSearchParams({
        $top: String(input.top ?? 25),
        $select: "id,name,size,lastModifiedDateTime,webUrl,folder,file",
      });
      const r = await graphRequest(ctx, NAME, SCOPES, "GET", `${driveBase(ctx)}/root/search(q='${q}')?${qs}`);
      return r.value;
    },
  });

  rl.registerAction("files.list", {
    description: "List children of a folder (default the drive root, or pass folderId).",
    inputSchema: {
      folderId: { type: "string", required: false, description: "Folder item id; omit for root" },
      top: { type: "number", required: false, default: 100 },
    },
    async execute(input: any, ctx: Ctx) {
      const where = input.folderId ? `/items/${input.folderId}/children` : "/root/children";
      const qs = new URLSearchParams({
        $top: String(input.top ?? 100),
        $select: "id,name,size,lastModifiedDateTime,webUrl,folder,file",
      });
      const r = await graphRequest(ctx, NAME, SCOPES, "GET", `${driveBase(ctx)}${where}?${qs}`);
      return r.value;
    },
  });

  rl.registerAction("files.get", {
    description:
      "Download a file by id. Returns {id,name,size,contentType,base64}. base64 is the file bytes.",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input: any, ctx: Ctx) {
      const meta = await graphRequest(ctx, NAME, SCOPES, "GET", `${driveBase(ctx)}/items/${input.id}`);
      const res = await binaryFetch(ctx, "GET", `${driveBase(ctx)}/items/${input.id}/content`);
      if (!res.ok) throw new Error(`${NAME}: download ${input.id} → ${res.status} ${await res.text()}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        id: meta.id,
        name: meta.name,
        size: meta.size,
        contentType: meta.file?.mimeType,
        base64: buf.toString("base64"),
      };
    },
  });

  rl.registerAction("files.upload", {
    description:
      "Upload a file (base64) to a path in the drive, e.g. a dedicated output folder. Returns the created item. For files up to ~4MB.",
    inputSchema: {
      path: { type: "string", required: true, description: "Drive-relative path incl. filename, e.g. 'Vex Output/report.docx'" },
      base64: { type: "string", required: true, description: "File content, base64-encoded" },
    },
    async execute(input: any, ctx: Ctx) {
      const bytes = Buffer.from(input.base64, "base64");
      const p = input.path.split("/").map(encodeURIComponent).join("/");
      const res = await binaryFetch(ctx, "PUT", `${driveBase(ctx)}/root:/${p}:/content`, bytes);
      if (!res.ok) throw new Error(`${NAME}: upload ${input.path} → ${res.status} ${await res.text()}`);
      return JSON.parse(await res.text());
    },
  });

  rl.registerAction("folder.create", {
    description: "Create a folder (e.g. a dedicated agent output folder) under the drive root or a parent.",
    inputSchema: {
      name: { type: "string", required: true },
      parentId: { type: "string", required: false, description: "Parent folder id; omit for root" },
    },
    async execute(input: any, ctx: Ctx) {
      const where = input.parentId ? `/items/${input.parentId}/children` : "/root/children";
      return graphRequest(ctx, NAME, SCOPES, "POST", `${driveBase(ctx)}${where}`, {
        name: input.name,
        folder: {},
        "@microsoft.graph.conflictBehavior": "rename",
      });
    },
  });
}
