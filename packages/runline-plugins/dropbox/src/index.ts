/**
 * Dropbox plugin for runline, on Dropbox's API v2.
 *
 * RPC calls send JSON to api.dropboxapi.com; content calls (upload,
 * download) carry bytes to content.dropboxapi.com with their arguments in
 * the `Dropbox-API-Arg` header. Failures report Dropbox's error as its
 * dotted tag path (`path.not_found`).
 */
import { writeFileSync } from "node:fs";
import {
  type ActionContext,
  type CredentialCall,
  credentialRequest,
  jsonAnswer,
  type RunlinePluginAPI,
  responseFailed,
} from "runline";
import * as t from "typebox";
import { readLocalFile } from "../../_shared/localFile.js";
import { stringEnum } from "../../_shared/schemas.js";
import {
  DROPBOX_AUTH_URL,
  DROPBOX_TOKEN_URL,
  dropboxCredential,
  SCOPES,
} from "./credentials.js";

/**
 * The largest file.upload: the most one signed request carries, under
 * Dropbox's own 150 MB files/upload limit. Larger files need an upload
 * session.
 */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

/**
 * Content endpoints carry their arguments as JSON in the Dropbox-API-Arg
 * header. HTTP headers are ASCII, so every non-ASCII character is sent as
 * a \uXXXX escape, as Dropbox documents (a Hebrew file name otherwise
 * fails with a 400).
 */
export function apiArg(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Dropbox's error union as a dotted tag path: `{".tag": "path", "path":
 * {".tag": "not_found"}}` is `path.not_found`. Its `error_summary` says
 * the same in slashes, which an error identifier may not carry.
 */
export function errorCode(body: unknown): string | undefined {
  const tags: string[] = [];
  let node = (body as { error?: unknown } | null)?.error;
  while (node && typeof node === "object") {
    const tag = (node as Record<string, unknown>)[".tag"];
    if (typeof tag !== "string") break;
    tags.push(tag);
    node = (node as Record<string, unknown>)[tag];
  }
  return tags.length ? tags.join(".") : undefined;
}

/** A signed POST that must succeed; a failure carries Dropbox's error code. */
async function send(
  ctx: ActionContext,
  call: Omit<CredentialCall, "method">,
): Promise<Response> {
  const response = await credentialRequest(ctx, dropboxCredential, {
    ...call,
    method: "POST",
  });
  if (!response.ok)
    throw await responseFailed("dropbox", response, (body) => ({
      code: errorCode(body),
    }));
  return response;
}

/** An RPC endpoint's JSON answer. */
async function rpc(
  ctx: ActionContext,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  return jsonAnswer(
    await send(ctx, {
      target: "api",
      path: endpoint,
      ...(body ? { json: body } : {}),
    }),
  );
}

/**
 * Every page of a listing: `first` answers the first page, `next` the
 * rest by cursor, until Dropbox reports no more or `limit` are in.
 */
async function paginate(
  ctx: ActionContext,
  endpoints: { first: string; next: string; items: string },
  body: Record<string, unknown>,
  limit?: number,
): Promise<unknown[]> {
  type Page = { has_more?: boolean; cursor?: string } & Record<string, unknown>;
  const results: unknown[] = [];
  let page = (await rpc(ctx, endpoints.first, body)) as Page;
  results.push(...((page[endpoints.items] as unknown[]) ?? []));
  while (page.has_more && (limit === undefined || results.length < limit)) {
    page = (await rpc(ctx, endpoints.next, { cursor: page.cursor })) as Page;
    results.push(...((page[endpoints.items] as unknown[]) ?? []));
  }
  return limit === undefined ? results : results.slice(0, limit);
}

const STRICT = { additionalProperties: false } as const;
const Path = (description: string) => t.String({ description });
const Limit = t.Optional(
  t.Integer({ minimum: 1, description: "Stop after this many (default all)" }),
);
const byPath = (description: string) =>
  t.Object({ path: Path(description) }, STRICT);
const fromTo = (what: string) =>
  t.Object(
    {
      fromPath: Path(`Source ${what} path`),
      toPath: Path(`Destination ${what} path`),
    },
    STRICT,
  );
const empty = t.Object({}, STRICT);

const fileGet = byPath("Path (/a/b.txt) or id (id:...)");
const fileUpload = t.Object(
  {
    localPath: t.String({
      minLength: 1,
      description: "File on the runline host to upload",
    }),
    path: Path("Destination Dropbox path, including the file name"),
    mode: t.Optional(
      t.Union([t.Literal("add"), t.Literal("overwrite")], {
        description:
          "add (default) keeps an existing file; overwrite replaces it",
      }),
    ),
    autorename: t.Optional(
      t.Boolean({
        description:
          "On conflict in add mode, save as 'name (1)' instead of failing",
      }),
    ),
  },
  STRICT,
);
const fileDownload = t.Object(
  {
    path: Path("Path (/a/b.pdf), id (id:...), or rev (rev:...)"),
    savePath: t.Optional(
      t.String({
        minLength: 1,
        description: "Local path to write the bytes to",
      }),
    ),
  },
  STRICT,
);
const shareLink = byPath("Path of the file or folder to share");
const fileDelete = byPath("File path to delete");
const folderCreate = byPath("Folder path to create");
const folderDelete = byPath("Folder path to delete");
const fileFromTo = fromTo("file");
const folderFromTo = fromTo("folder");
const folderList = t.Object(
  {
    path: Path("Folder path (empty string for root)"),
    limit: Limit,
    recursive: t.Optional(
      t.Boolean({ description: "Include subfolders recursively" }),
    ),
    includeDeleted: t.Optional(
      t.Boolean({ description: "Include deleted entries" }),
    ),
  },
  STRICT,
);
/** Dropbox's FileCategory values. */
const CATEGORIES = [
  "image",
  "document",
  "pdf",
  "spreadsheet",
  "presentation",
  "audio",
  "video",
  "folder",
  "paper",
  "others",
] as const;
const searchQuery = t.Object(
  {
    query: t.String({ minLength: 1, description: "Search query" }),
    limit: Limit,
    path: t.Optional(Path("Limit search to this folder path")),
    fileCategories: t.Optional(
      t.Array(stringEnum(CATEGORIES), {
        description: `Filter by categories: ${CATEGORIES.join(", ")}`,
      }),
    ),
    fileExtensions: t.Optional(
      t.Array(t.String({ minLength: 1 }), {
        description: "Filter by file extensions (e.g. ['jpg', 'pdf'])",
      }),
    ),
    fileStatus: t.Optional(
      t.Union([t.Literal("active"), t.Literal("deleted")], {
        description: "active (default) or deleted",
      }),
    ),
  },
  STRICT,
);

export default function dropbox(rl: RunlinePluginAPI) {
  rl.setName("dropbox");
  rl.setVersion("0.2.0");
  rl.setCredential(dropboxCredential);

  rl.setOAuth({
    authUrl: DROPBOX_AUTH_URL,
    tokenUrl: DROPBOX_TOKEN_URL,
    scopes: SCOPES,
    // Without token_access_type=offline Dropbox returns no refresh token,
    // and the connection dies with its first 4-hour access token.
    authParams: { token_access_type: "offline" },
    setupHelp: [
      "You need a Dropbox app. One-time, ~3 minutes.",
      "",
      "1. https://www.dropbox.com/developers/apps → Create app",
      "     • Scoped access, Full Dropbox (or App folder to confine it)",
      `2. Permissions tab: tick ${SCOPES.join(", ")}`,
      "   and click Submit. Scopes ticked after login need a new login.",
      "3. Settings tab → OAuth 2 → Redirect URIs → Add:",
      "     {{redirectUri}}",
      "4. Copy the App key (client ID) and App secret below.",
      "",
      "The login stores a refresh token; access tokens (4 hours) renew",
      "themselves from it. A token pasted from the console's 'Generate'",
      "button works as accessToken but expires after 4 hours.",
    ],
  });

  rl.setConnectionSchema({
    authMethod: {
      type: "string",
      required: false,
      description:
        "bearer (a pasted access token) or oauth2 (refresh token). Default: oauth2 when refreshToken is set, else bearer.",
      env: "DROPBOX_AUTH_METHOD",
    },
    accessToken: {
      type: "string",
      required: false,
      description:
        "Access token. Pasted tokens expire after 4 hours; with oauth2 this holds the current renewed token.",
      env: "DROPBOX_ACCESS_TOKEN",
    },
    clientId: {
      type: "string",
      required: false,
      description: "App key from the Dropbox App Console",
      env: "DROPBOX_CLIENT_ID",
    },
    clientSecret: {
      type: "string",
      required: false,
      description: "App secret from the Dropbox App Console",
      env: "DROPBOX_CLIENT_SECRET",
    },
    refreshToken: {
      type: "string",
      required: false,
      description: "Long-lived refresh token (set by runline auth dropbox)",
      env: "DROPBOX_REFRESH_TOKEN",
    },
  });

  // ── Account ─────────────────────────────────────────

  rl.registerAction("account.get", {
    access: "read",
    description:
      "The connected account: name, email, account_id, and root namespace. A cheap check that the connection works.",
    inputSchema: empty,
    async execute(_input, ctx) {
      return rpc(ctx, "users/get_current_account");
    },
  });

  rl.registerAction("account.space", {
    access: "read",
    description: "Space used and allocated, in bytes",
    inputSchema: empty,
    async execute(_input, ctx) {
      return rpc(ctx, "users/get_space_usage");
    },
  });

  // ── File ────────────────────────────────────────────

  rl.registerAction("file.get", {
    access: "read",
    description:
      "Metadata for a file or folder: name, path, size, rev, modified times",
    inputSchema: fileGet,
    async execute(input, ctx) {
      const { path } = input as t.Static<typeof fileGet>;
      return rpc(ctx, "files/get_metadata", { path });
    },
  });

  rl.registerAction("file.upload", {
    access: "write",
    description:
      "Upload a local file (up to 64 MB) to a Dropbox path. mode 'add' (default) keeps an existing file and, with autorename, saves alongside it; 'overwrite' replaces it.",
    inputSchema: fileUpload,
    async execute(input, ctx) {
      const { localPath, path, mode, autorename } = input as t.Static<
        typeof fileUpload
      >;
      const bytes = await readLocalFile(localPath, {
        subject: "dropbox: localPath",
        maxBytes: MAX_UPLOAD_BYTES,
        oversize: "dropbox: file exceeds 64 MB, the largest single upload",
      });
      return jsonAnswer(
        await send(ctx, {
          target: "content",
          path: "files/upload",
          headers: {
            "Content-Type": "application/octet-stream",
            "Dropbox-API-Arg": apiArg({
              path,
              mode: mode ?? "add",
              autorename: autorename === true,
              mute: true,
            }),
          },
          body: bytes,
        }),
      );
    },
  });

  rl.registerAction("file.download", {
    access: "write",
    description:
      "Download a file. Returns base64 by default, or writes to disk when savePath is set (use savePath for anything large).",
    inputSchema: fileDownload,
    async execute(input, ctx) {
      const { path, savePath } = input as t.Static<typeof fileDownload>;
      const response = await send(ctx, {
        target: "content",
        path: "files/download",
        headers: { "Dropbox-API-Arg": apiArg({ path }) },
      });
      const { name } = JSON.parse(
        response.headers.get("dropbox-api-result") ?? "{}",
      ) as { name?: string };
      const bytes = Buffer.from(await response.arrayBuffer());
      if (savePath !== undefined) {
        writeFileSync(savePath, bytes);
        return { path: savePath, name, size: bytes.byteLength };
      }
      return {
        name,
        size: bytes.byteLength,
        contentBase64: bytes.toString("base64"),
      };
    },
  });

  rl.registerAction("file.shareLink", {
    access: "write",
    description:
      "A shared link to a file or folder: the existing link when there is one, else a new public one.",
    inputSchema: shareLink,
    async execute(input, ctx) {
      const { path } = input as t.Static<typeof shareLink>;
      const existing = (await rpc(ctx, "sharing/list_shared_links", {
        path,
        direct_only: true,
      })) as { links?: unknown[] };
      if (existing.links?.length) return existing.links[0];
      return rpc(ctx, "sharing/create_shared_link_with_settings", { path });
    },
  });

  rl.registerAction("file.copy", {
    access: "write",
    description: "Copy a file",
    inputSchema: fileFromTo,
    async execute(input, ctx) {
      const { fromPath, toPath } = input as t.Static<typeof fileFromTo>;
      return rpc(ctx, "files/copy_v2", {
        from_path: fromPath,
        to_path: toPath,
      });
    },
  });

  rl.registerAction("file.move", {
    access: "write",
    description: "Move a file",
    inputSchema: fileFromTo,
    async execute(input, ctx) {
      const { fromPath, toPath } = input as t.Static<typeof fileFromTo>;
      return rpc(ctx, "files/move_v2", {
        from_path: fromPath,
        to_path: toPath,
      });
    },
  });

  rl.registerAction("file.delete", {
    access: "write",
    description: "Delete a file",
    inputSchema: fileDelete,
    async execute(input, ctx) {
      const { path } = input as t.Static<typeof fileDelete>;
      return rpc(ctx, "files/delete_v2", { path });
    },
  });

  // ── Folder ──────────────────────────────────────────

  rl.registerAction("folder.create", {
    access: "write",
    description: "Create a folder",
    inputSchema: folderCreate,
    async execute(input, ctx) {
      const { path } = input as t.Static<typeof folderCreate>;
      return rpc(ctx, "files/create_folder_v2", { path });
    },
  });

  rl.registerAction("folder.list", {
    access: "read",
    description: "List contents of a folder",
    inputSchema: folderList,
    async execute(input, ctx) {
      const { path, limit, recursive, includeDeleted } = input as t.Static<
        typeof folderList
      >;
      return paginate(
        ctx,
        {
          first: "files/list_folder",
          next: "files/list_folder/continue",
          items: "entries",
        },
        {
          path,
          limit: 1000,
          ...(recursive ? { recursive: true } : {}),
          ...(includeDeleted ? { include_deleted: true } : {}),
        },
        limit,
      );
    },
  });

  rl.registerAction("folder.copy", {
    access: "write",
    description: "Copy a folder",
    inputSchema: folderFromTo,
    async execute(input, ctx) {
      const { fromPath, toPath } = input as t.Static<typeof folderFromTo>;
      return rpc(ctx, "files/copy_v2", {
        from_path: fromPath,
        to_path: toPath,
      });
    },
  });

  rl.registerAction("folder.move", {
    access: "write",
    description: "Move a folder",
    inputSchema: folderFromTo,
    async execute(input, ctx) {
      const { fromPath, toPath } = input as t.Static<typeof folderFromTo>;
      return rpc(ctx, "files/move_v2", {
        from_path: fromPath,
        to_path: toPath,
      });
    },
  });

  rl.registerAction("folder.delete", {
    access: "write",
    description: "Delete a folder",
    inputSchema: folderDelete,
    async execute(input, ctx) {
      const { path } = input as t.Static<typeof folderDelete>;
      return rpc(ctx, "files/delete_v2", { path });
    },
  });

  // ── Search ──────────────────────────────────────────

  rl.registerAction("search.query", {
    access: "read",
    description: "Search for files and folders by name",
    inputSchema: searchQuery,
    async execute(input, ctx) {
      const { query, limit, path, fileCategories, fileExtensions, fileStatus } =
        input as t.Static<typeof searchQuery>;
      return paginate(
        ctx,
        {
          first: "files/search_v2",
          next: "files/search/continue_v2",
          items: "matches",
        },
        {
          query,
          options: {
            filename_only: true,
            ...(limit !== undefined
              ? { max_results: Math.min(limit, 1000) }
              : {}),
            ...(path ? { path } : {}),
            ...(fileCategories ? { file_categories: fileCategories } : {}),
            ...(fileExtensions ? { file_extensions: fileExtensions } : {}),
            ...(fileStatus ? { file_status: { ".tag": fileStatus } } : {}),
          },
        },
        limit,
      );
    },
  });
}
