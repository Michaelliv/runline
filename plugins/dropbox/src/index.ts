import type { RunlinePluginAPI } from "runline";

const API_URL = "https://api.dropboxapi.com/2";

async function apiRequest(
  token: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Dropbox API error ${res.status}: ${await res.text()}`);
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  return { success: true };
}

async function paginateFolder(token: string, path: string, opts: Record<string, unknown>, limit?: number): Promise<unknown[]> {
  const results: unknown[] = [];
  const body: Record<string, unknown> = { path, limit: 1000, ...opts };
  let data = (await apiRequest(token, "/files/list_folder", body)) as Record<string, unknown>;
  results.push(...(data.entries as unknown[]));
  while (data.has_more && (!limit || results.length < limit)) {
    data = (await apiRequest(token, "/files/list_folder/continue", { cursor: data.cursor })) as Record<string, unknown>;
    results.push(...(data.entries as unknown[]));
  }
  return limit ? results.slice(0, limit) : results;
}

async function paginateSearch(token: string, query: string, opts: Record<string, unknown>, limit?: number): Promise<unknown[]> {
  const results: unknown[] = [];
  const body: Record<string, unknown> = { query, options: { filename_only: true, ...opts } };
  if (limit) (body.options as Record<string, unknown>).max_results = Math.min(limit, 1000);
  let data = (await apiRequest(token, "/files/search_v2", body)) as Record<string, unknown>;
  results.push(...(data.matches as unknown[]));
  while (data.has_more && (!limit || results.length < limit)) {
    data = (await apiRequest(token, "/files/search/continue_v2", { cursor: data.cursor })) as Record<string, unknown>;
    results.push(...(data.matches as unknown[]));
  }
  return limit ? results.slice(0, limit) : results;
}

export default function dropbox(rl: RunlinePluginAPI) {
  rl.setName("dropbox");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accessToken: { type: "string", required: true, description: "Dropbox access token", env: "DROPBOX_ACCESS_TOKEN" },
  });

  const tok = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.accessToken as string;

  // ── File ────────────────────────────────────────────

  rl.registerAction("file.copy", {
    description: "Copy a file",
    inputSchema: {
      fromPath: { type: "string", required: true, description: "Source file path" },
      toPath: { type: "string", required: true, description: "Destination file path" },
    },
    async execute(input, ctx) {
      const { fromPath, toPath } = input as { fromPath: string; toPath: string };
      return apiRequest(tok(ctx), "/files/copy_v2", { from_path: fromPath, to_path: toPath });
    },
  });

  rl.registerAction("file.move", {
    description: "Move a file",
    inputSchema: {
      fromPath: { type: "string", required: true, description: "Source file path" },
      toPath: { type: "string", required: true, description: "Destination file path" },
    },
    async execute(input, ctx) {
      const { fromPath, toPath } = input as { fromPath: string; toPath: string };
      return apiRequest(tok(ctx), "/files/move_v2", { from_path: fromPath, to_path: toPath });
    },
  });

  rl.registerAction("file.delete", {
    description: "Delete a file",
    inputSchema: { path: { type: "string", required: true, description: "File path to delete" } },
    async execute(input, ctx) {
      return apiRequest(tok(ctx), "/files/delete_v2", { path: (input as { path: string }).path });
    },
  });

  // ── Folder ──────────────────────────────────────────

  rl.registerAction("folder.create", {
    description: "Create a folder",
    inputSchema: { path: { type: "string", required: true, description: "Folder path to create" } },
    async execute(input, ctx) {
      return apiRequest(tok(ctx), "/files/create_folder_v2", { path: (input as { path: string }).path });
    },
  });

  rl.registerAction("folder.list", {
    description: "List contents of a folder",
    inputSchema: {
      path: { type: "string", required: true, description: "Folder path (empty string for root)" },
      limit: { type: "number", required: false, description: "Max results" },
      recursive: { type: "boolean", required: false, description: "Include subfolders recursively" },
      includeDeleted: { type: "boolean", required: false, description: "Include deleted entries" },
    },
    async execute(input, ctx) {
      const { path, limit, recursive, includeDeleted } = (input ?? {}) as Record<string, unknown>;
      const opts: Record<string, unknown> = {};
      if (recursive) opts.recursive = true;
      if (includeDeleted) opts.include_deleted = true;
      return paginateFolder(tok(ctx), path as string, opts, limit as number | undefined);
    },
  });

  rl.registerAction("folder.copy", {
    description: "Copy a folder",
    inputSchema: {
      fromPath: { type: "string", required: true, description: "Source folder path" },
      toPath: { type: "string", required: true, description: "Destination folder path" },
    },
    async execute(input, ctx) {
      const { fromPath, toPath } = input as { fromPath: string; toPath: string };
      return apiRequest(tok(ctx), "/files/copy_v2", { from_path: fromPath, to_path: toPath });
    },
  });

  rl.registerAction("folder.move", {
    description: "Move a folder",
    inputSchema: {
      fromPath: { type: "string", required: true, description: "Source folder path" },
      toPath: { type: "string", required: true, description: "Destination folder path" },
    },
    async execute(input, ctx) {
      const { fromPath, toPath } = input as { fromPath: string; toPath: string };
      return apiRequest(tok(ctx), "/files/move_v2", { from_path: fromPath, to_path: toPath });
    },
  });

  rl.registerAction("folder.delete", {
    description: "Delete a folder",
    inputSchema: { path: { type: "string", required: true, description: "Folder path to delete" } },
    async execute(input, ctx) {
      return apiRequest(tok(ctx), "/files/delete_v2", { path: (input as { path: string }).path });
    },
  });

  // ── Search ──────────────────────────────────────────

  rl.registerAction("search.query", {
    description: "Search for files and folders",
    inputSchema: {
      query: { type: "string", required: true, description: "Search query" },
      limit: { type: "number", required: false, description: "Max results" },
      path: { type: "string", required: false, description: "Limit search to this folder path" },
      fileCategories: { type: "array", required: false, description: "Filter by categories: image, document, pdf, spreadsheet, presentation, audio, video, folder, paper, other" },
      fileExtensions: { type: "array", required: false, description: "Filter by file extensions (e.g. ['jpg', 'pdf'])" },
      fileStatus: { type: "string", required: false, description: "active (default) or deleted" },
    },
    async execute(input, ctx) {
      const { query, limit, path, fileCategories, fileExtensions, fileStatus } = (input ?? {}) as Record<string, unknown>;
      const opts: Record<string, unknown> = {};
      if (path) opts.path = path;
      if (fileCategories) opts.file_categories = fileCategories;
      if (fileExtensions) opts.file_extensions = fileExtensions;
      if (fileStatus) opts.file_status = { ".tag": fileStatus };
      return paginateSearch(tok(ctx), query as string, opts, limit as number | undefined);
    },
  });
}
