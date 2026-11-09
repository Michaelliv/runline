import { writeFileSync } from "node:fs";
import {
  type ActionContext,
  credentialJson,
  credentialOk,
  type RunlinePluginAPI,
} from "runline";
import { readLocalFile } from "../../_shared/localFile.js";
import {
  DROPBOX_AUTH_URL,
  DROPBOX_TOKEN_URL,
  dropboxCredential,
  SCOPES,
} from "./credentials.js";

/** Single-request upload ceiling; Dropbox refuses files/upload above 150 MB. */
const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

/**
 * Content endpoints carry their arguments as JSON in the Dropbox-API-Arg
 * header. HTTP headers are ASCII, so every non-ASCII character is sent as
 * a \uXXXX escape, which Dropbox documents for exactly this reason
 * (a Hebrew file name otherwise fails with a 400).
 */
export function apiArg(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

async function apiRequest(
  ctx: ActionContext,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, dropboxCredential, "dropbox", {
    target: "api",
    path: endpoint,
    method: "POST",
    ...(body ? { json: body } : {}),
  });
}

async function paginateFolder(
  ctx: ActionContext,
  path: string,
  opts: Record<string, unknown>,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  const body: Record<string, unknown> = { path, limit: 1000, ...opts };
  let data = (await apiRequest(ctx, "files/list_folder", body)) as Record<
    string,
    unknown
  >;
  results.push(...(data.entries as unknown[]));
  while (data.has_more && (!limit || results.length < limit)) {
    data = (await apiRequest(ctx, "files/list_folder/continue", {
      cursor: data.cursor,
    })) as Record<string, unknown>;
    results.push(...(data.entries as unknown[]));
  }
  return limit ? results.slice(0, limit) : results;
}

async function paginateSearch(
  ctx: ActionContext,
  query: string,
  opts: Record<string, unknown>,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  const body: Record<string, unknown> = {
    query,
    options: { filename_only: true, ...opts },
  };
  if (limit)
    (body.options as Record<string, unknown>).max_results = Math.min(
      limit,
      1000,
    );
  let data = (await apiRequest(ctx, "files/search_v2", body)) as Record<
    string,
    unknown
  >;
  results.push(...(data.matches as unknown[]));
  while (data.has_more && (!limit || results.length < limit)) {
    data = (await apiRequest(ctx, "files/search/continue_v2", {
      cursor: data.cursor,
    })) as Record<string, unknown>;
    results.push(...(data.matches as unknown[]));
  }
  return limit ? results.slice(0, limit) : results;
}

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
      "2. Permissions tab: tick " + SCOPES.join(", "),
      "   and click Submit. Scopes ticked after login need a new login.",
      "3. Settings tab → OAuth 2 → Redirect URIs → Add:",
      "     {{redirectUri}}",
      "4. Copy the App key (client ID) and App secret below.",
      "",
      "The login stores a refresh token; access tokens (4 hours) renew",
      "themselves from it. A token pasted from the console's 'Generate'",
      "button still works as accessToken but expires after 4 hours.",
    ],
  });

  rl.setConnectionSchema({
    authMethod: {
      type: "string",
      required: false,
      description:
        'bearer (a pasted access token) or oauth2 (refresh token). Default: oauth2 when refreshToken is set, else bearer.',
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
      description: "App secret (omit for a PKCE public client)",
      env: "DROPBOX_CLIENT_SECRET",
    },
    refreshToken: {
      type: "string",
      required: false,
      description: "Long-lived refresh token (set by the login flow)",
      env: "DROPBOX_REFRESH_TOKEN",
    },
  });

  // ── Account ─────────────────────────────────────────

  rl.registerAction("account.get", {
    access: "read",
    description:
      "The connected account: name, email, account_id, and root namespace. A cheap check that the connection works.",
    inputSchema: {},
    async execute(_input, ctx) {
      return apiRequest(ctx, "users/get_current_account");
    },
  });

  rl.registerAction("account.space", {
    access: "read",
    description: "Space used and allocated, in bytes",
    inputSchema: {},
    async execute(_input, ctx) {
      return apiRequest(ctx, "users/get_space_usage");
    },
  });

  // ── File ────────────────────────────────────────────

  rl.registerAction("file.get", {
    access: "read",
    description: "Metadata for a file or folder: name, path, size, rev, modified times",
    inputSchema: {
      path: {
        type: "string",
        required: true,
        description: "Path (/a/b.txt) or id (id:...)",
      },
    },
    async execute(input, ctx) {
      return apiRequest(ctx, "files/get_metadata", {
        path: (input as { path: string }).path,
      });
    },
  });

  rl.registerAction("file.upload", {
    access: "write",
    description:
      "Upload a local file (up to 150 MB) to a Dropbox path. mode 'add' (default) keeps an existing file and, with autorename, saves alongside it; 'overwrite' replaces it.",
    inputSchema: {
      localPath: {
        type: "string",
        required: true,
        description: "File on the runline host to upload",
      },
      path: {
        type: "string",
        required: true,
        description: "Destination Dropbox path, including the file name",
      },
      mode: {
        type: "string",
        required: false,
        description: "add (default) or overwrite",
      },
      autorename: {
        type: "boolean",
        required: false,
        description: "On conflict in add mode, save as 'name (1)' instead of failing",
      },
    },
    async execute(input, ctx) {
      const { localPath, path, mode, autorename } = input as Record<
        string,
        unknown
      >;
      if (mode !== undefined && mode !== "add" && mode !== "overwrite")
        throw new Error("dropbox: mode must be add or overwrite");
      const bytes = await readLocalFile(localPath as string, {
        subject: "dropbox: localPath",
        maxBytes: MAX_UPLOAD_BYTES,
        oversize:
          "dropbox: file exceeds 150 MB, the single-request upload limit",
      });
      const response = await credentialOk(ctx, dropboxCredential, "dropbox", {
        target: "content",
        path: "files/upload",
        method: "POST",
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
      });
      return response.json();
    },
  });

  rl.registerAction("file.download", {
    access: "write",
    description:
      "Download a file. Returns base64 by default, or writes to disk when savePath is set (use savePath for anything large).",
    inputSchema: {
      path: {
        type: "string",
        required: true,
        description: "Path (/a/b.pdf), id (id:...), or rev (rev:...)",
      },
      savePath: {
        type: "string",
        required: false,
        description: "Local path to write the bytes to",
      },
    },
    async execute(input, ctx) {
      const { path, savePath } = input as { path: string; savePath?: string };
      const response = await credentialOk(ctx, dropboxCredential, "dropbox", {
        target: "content",
        path: "files/download",
        method: "POST",
        headers: { "Dropbox-API-Arg": apiArg({ path }) },
      });
      const meta = JSON.parse(
        response.headers.get("dropbox-api-result") ?? "{}",
      ) as { name?: string; size?: number; path_display?: string };
      const bytes = Buffer.from(await response.arrayBuffer());
      if (typeof savePath === "string") {
        writeFileSync(savePath, bytes);
        return { path: savePath, name: meta.name, size: bytes.byteLength, dropboxPath: meta.path_display };
      }
      return {
        name: meta.name,
        size: bytes.byteLength,
        contentBase64: bytes.toString("base64"),
      };
    },
  });

  rl.registerAction("file.shareLink", {
    access: "write",
    description:
      "A shared link to a file or folder: reuses the existing link when there is one, else creates a public one.",
    inputSchema: {
      path: {
        type: "string",
        required: true,
        description: "Path of the file or folder to share",
      },
    },
    async execute(input, ctx) {
      const { path } = input as { path: string };
      const existing = (await apiRequest(ctx, "sharing/list_shared_links", {
        path,
        direct_only: true,
      })) as { links?: unknown[] };
      if (existing.links?.length) return existing.links[0];
      return apiRequest(ctx, "sharing/create_shared_link_with_settings", {
        path,
      });
    },
  });

  rl.registerAction("file.copy", {
    access: "write",
    description: "Copy a file",
    inputSchema: {
      fromPath: {
        type: "string",
        required: true,
        description: "Source file path",
      },
      toPath: {
        type: "string",
        required: true,
        description: "Destination file path",
      },
    },
    async execute(input, ctx) {
      const { fromPath, toPath } = input as {
        fromPath: string;
        toPath: string;
      };
      return apiRequest(ctx, "files/copy_v2", {
        from_path: fromPath,
        to_path: toPath,
      });
    },
  });

  rl.registerAction("file.move", {
    access: "write",
    description: "Move a file",
    inputSchema: {
      fromPath: {
        type: "string",
        required: true,
        description: "Source file path",
      },
      toPath: {
        type: "string",
        required: true,
        description: "Destination file path",
      },
    },
    async execute(input, ctx) {
      const { fromPath, toPath } = input as {
        fromPath: string;
        toPath: string;
      };
      return apiRequest(ctx, "files/move_v2", {
        from_path: fromPath,
        to_path: toPath,
      });
    },
  });

  rl.registerAction("file.delete", {
    access: "write",
    description: "Delete a file",
    inputSchema: {
      path: {
        type: "string",
        required: true,
        description: "File path to delete",
      },
    },
    async execute(input, ctx) {
      return apiRequest(ctx, "files/delete_v2", {
        path: (input as { path: string }).path,
      });
    },
  });

  // ── Folder ──────────────────────────────────────────

  rl.registerAction("folder.create", {
    access: "write",
    description: "Create a folder",
    inputSchema: {
      path: {
        type: "string",
        required: true,
        description: "Folder path to create",
      },
    },
    async execute(input, ctx) {
      return apiRequest(ctx, "files/create_folder_v2", {
        path: (input as { path: string }).path,
      });
    },
  });

  rl.registerAction("folder.list", {
    access: "read",
    description: "List contents of a folder",
    inputSchema: {
      path: {
        type: "string",
        required: true,
        description: "Folder path (empty string for root)",
      },
      limit: { type: "number", required: false, description: "Max results" },
      recursive: {
        type: "boolean",
        required: false,
        description: "Include subfolders recursively",
      },
      includeDeleted: {
        type: "boolean",
        required: false,
        description: "Include deleted entries",
      },
    },
    async execute(input, ctx) {
      const { path, limit, recursive, includeDeleted } = (input ??
        {}) as Record<string, unknown>;
      const opts: Record<string, unknown> = {};
      if (recursive) opts.recursive = true;
      if (includeDeleted) opts.include_deleted = true;
      return paginateFolder(
        ctx,
        path as string,
        opts,
        limit as number | undefined,
      );
    },
  });

  rl.registerAction("folder.copy", {
    access: "write",
    description: "Copy a folder",
    inputSchema: {
      fromPath: {
        type: "string",
        required: true,
        description: "Source folder path",
      },
      toPath: {
        type: "string",
        required: true,
        description: "Destination folder path",
      },
    },
    async execute(input, ctx) {
      const { fromPath, toPath } = input as {
        fromPath: string;
        toPath: string;
      };
      return apiRequest(ctx, "files/copy_v2", {
        from_path: fromPath,
        to_path: toPath,
      });
    },
  });

  rl.registerAction("folder.move", {
    access: "write",
    description: "Move a folder",
    inputSchema: {
      fromPath: {
        type: "string",
        required: true,
        description: "Source folder path",
      },
      toPath: {
        type: "string",
        required: true,
        description: "Destination folder path",
      },
    },
    async execute(input, ctx) {
      const { fromPath, toPath } = input as {
        fromPath: string;
        toPath: string;
      };
      return apiRequest(ctx, "files/move_v2", {
        from_path: fromPath,
        to_path: toPath,
      });
    },
  });

  rl.registerAction("folder.delete", {
    access: "write",
    description: "Delete a folder",
    inputSchema: {
      path: {
        type: "string",
        required: true,
        description: "Folder path to delete",
      },
    },
    async execute(input, ctx) {
      return apiRequest(ctx, "files/delete_v2", {
        path: (input as { path: string }).path,
      });
    },
  });

  // ── Search ──────────────────────────────────────────

  rl.registerAction("search.query", {
    access: "read",
    description: "Search for files and folders",
    inputSchema: {
      query: { type: "string", required: true, description: "Search query" },
      limit: { type: "number", required: false, description: "Max results" },
      path: {
        type: "string",
        required: false,
        description: "Limit search to this folder path",
      },
      fileCategories: {
        type: "array",
        required: false,
        description:
          "Filter by categories: image, document, pdf, spreadsheet, presentation, audio, video, folder, paper, other",
      },
      fileExtensions: {
        type: "array",
        required: false,
        description: "Filter by file extensions (e.g. ['jpg', 'pdf'])",
      },
      fileStatus: {
        type: "string",
        required: false,
        description: "active (default) or deleted",
      },
    },
    async execute(input, ctx) {
      const { query, limit, path, fileCategories, fileExtensions, fileStatus } =
        (input ?? {}) as Record<string, unknown>;
      const opts: Record<string, unknown> = {};
      if (path) opts.path = path;
      if (fileCategories) opts.file_categories = fileCategories;
      if (fileExtensions) opts.file_extensions = fileExtensions;
      if (fileStatus) opts.file_status = { ".tag": fileStatus };
      return paginateSearch(
        ctx,
        query as string,
        opts,
        limit as number | undefined,
      );
    },
  });
}
