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
  jsonAnswer,
  pathSegment,
  pathSegments,
  requestFailed,
} from "../../_shared/credentials.js";
import {
  graphRequest,
  graphResponse,
  microsoftCredential,
  microsoftDownload,
  microsoftDriveBase,
  microsoftSetupHelp,
} from "../../_shared/microsoftAuth.js";

const NAME = "microsoftFiles";
const SCOPES = [
  "https://graph.microsoft.com/Files.ReadWrite.All",
  "https://graph.microsoft.com/Sites.ReadWrite.All",
];
type Ctx = ActionContext;

/** A Graph collection answer; items pass through to the caller unchanged. */
interface GraphList {
  value: unknown[];
}

/** The drive-item fields files.get reads. */
interface DriveItem {
  id: string;
  name: string;
  size: number;
  file?: { mimeType?: string };
  "@microsoft.graph.downloadUrl"?: unknown;
}

/** Resolve the drive root path: explicit drive/site, else the user's default drive. */
function driveBase(ctx: Ctx): string {
  return microsoftDriveBase(ctx.connection.config);
}

async function binaryFetch(
  ctx: Ctx,
  method: string,
  path: string,
  body?: Uint8Array,
) {
  return graphResponse(
    ctx,
    NAME,
    SCOPES,
    method,
    path,
    body,
    body ? "application/octet-stream" : undefined,
  );
}

export default function microsoftFiles(rl: RunlinePluginAPI): void {
  rl.setName(NAME);
  rl.setVersion("1.0.0");
  rl.setCredential(microsoftCredential(NAME, SCOPES));

  rl.setConnectionSchema({
    authMethod: {
      type: "string",
      required: false,
      description:
        "delegated or appOnly; legacy configs infer the method from existing credentials",
    },
    tenantId: {
      type: "string",
      required: false,
      env: "MS_GRAPH_TENANT_ID",
      description: "Entra tenant id (app-only) or omit for OAuth /common",
    },
    clientId: {
      type: "string",
      required: false,
      env: "MS_GRAPH_CLIENT_ID",
      description: "App (client) id",
    },
    clientSecret: {
      type: "string",
      required: false,
      env: "MS_GRAPH_CLIENT_SECRET",
      description: "Client secret VALUE",
    },
    refreshToken: {
      type: "string",
      required: false,
      env: "MICROSOFTFILES_REFRESH_TOKEN",
      description: "OAuth2 refresh token (set by the login flow)",
    },
    userUpn: {
      type: "string",
      required: false,
      env: "MS_GRAPH_USER_UPN",
      description: "App-only only: target user UPN (their OneDrive)",
    },
    siteId: {
      type: "string",
      required: false,
      env: "MS_SHAREPOINT_SITE_ID",
      description: "Optional SharePoint site id (use its default drive)",
    },
    driveId: {
      type: "string",
      required: false,
      env: "MS_GRAPH_DRIVE_ID",
      description: "Optional explicit drive id (overrides site/user)",
    },
  });

  rl.setOAuth({
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: [...SCOPES, "offline_access"],
    setupHelp: microsoftSetupHelp("Files.ReadWrite.All, Sites.ReadWrite.All"),
  });

  rl.registerAction("files.search", {
    access: "read",
    description:
      "Search the drive for files/folders by text. Returns [{id,name,size,lastModifiedDateTime,webUrl,folder?}].",
    inputSchema: {
      query: { type: "string", required: true },
      top: { type: "number", required: false, default: 25 },
    },
    async execute(input, ctx: Ctx) {
      const p = input as { query: string; top?: number };
      const q = encodeURIComponent(String(p.query).replace(/'/g, "''"));
      const qs = new URLSearchParams({
        $top: String(p.top ?? 25),
        $select: "id,name,size,lastModifiedDateTime,webUrl,folder,file",
      });
      const r = await graphRequest<GraphList>(
        ctx,
        NAME,
        SCOPES,
        "GET",
        `${driveBase(ctx)}/root/search(q='${q}')?${qs}`,
      );
      return r.value;
    },
  });

  rl.registerAction("files.list", {
    access: "read",
    description:
      "List children of a folder (default the drive root, or pass folderId).",
    inputSchema: {
      folderId: {
        type: "string",
        required: false,
        description: "Folder item id; omit for root",
      },
      top: { type: "number", required: false, default: 100 },
    },
    async execute(input, ctx: Ctx) {
      const p = input as { folderId?: string; top?: number };
      const where = p.folderId
        ? `/items/${pathSegment(p.folderId)}/children`
        : "/root/children";
      const qs = new URLSearchParams({
        $top: String(p.top ?? 100),
        $select: "id,name,size,lastModifiedDateTime,webUrl,folder,file",
      });
      const r = await graphRequest<GraphList>(
        ctx,
        NAME,
        SCOPES,
        "GET",
        `${driveBase(ctx)}${where}?${qs}`,
      );
      return r.value;
    },
  });

  rl.registerAction("files.get", {
    access: "read",
    description:
      "Download a file by id. Returns {id,name,size,contentType,base64}. base64 is the file bytes.",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx: Ctx) {
      const p = input as { id: string };
      const meta = await graphRequest<DriveItem>(
        ctx,
        NAME,
        SCOPES,
        "GET",
        `${driveBase(ctx)}/items/${pathSegment(p.id)}`,
      );
      const res = await microsoftDownload(meta["@microsoft.graph.downloadUrl"]);
      if (!res.ok)
        throw new Error(`${NAME}: download failed (HTTP ${res.status})`);
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
    access: "write",
    description:
      "Upload a file (base64) to a path in the drive, e.g. a dedicated output folder. Returns the created item. For files up to ~4MB.",
    inputSchema: {
      path: {
        type: "string",
        required: true,
        description:
          "Drive-relative path incl. filename, e.g. 'Agent Output/report.docx'",
      },
      base64: {
        type: "string",
        required: true,
        description: "File content, base64-encoded",
      },
    },
    async execute(input, ctx: Ctx) {
      const { path, base64 } = input as { path: string; base64: string };
      const bytes = Buffer.from(base64, "base64");
      const res = await binaryFetch(
        ctx,
        "PUT",
        `${driveBase(ctx)}/root:/${pathSegments(path)}:/content`,
        bytes,
      );
      if (!res.ok) throw requestFailed(NAME, res.status);
      return jsonAnswer(res);
    },
  });

  rl.registerAction("folder.create", {
    access: "write",
    description:
      "Create a folder (e.g. a dedicated agent output folder) under the drive root or a parent.",
    inputSchema: {
      name: { type: "string", required: true },
      parentId: {
        type: "string",
        required: false,
        description: "Parent folder id; omit for root",
      },
    },
    async execute(input, ctx: Ctx) {
      const p = input as { name: string; parentId?: string };
      const where = p.parentId
        ? `/items/${pathSegment(p.parentId)}/children`
        : "/root/children";
      return graphRequest(
        ctx,
        NAME,
        SCOPES,
        "POST",
        `${driveBase(ctx)}${where}`,
        {
          name: p.name,
          folder: {},
          "@microsoft.graph.conflictBehavior": "rename",
        },
      );
    },
  });
}
