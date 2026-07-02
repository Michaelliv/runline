import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.box.com/2.0";

async function apiRequest(
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };
  if (
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
  ) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Box API error ${res.status}: ${text}`);
  }
  if (res.status === 204) return { success: true };
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  return { success: true };
}

async function paginateAll(
  token: string,
  endpoint: string,
  property: string,
  qs?: Record<string, unknown>,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let offset = 0;
  const size = 100;

  while (true) {
    const data = (await apiRequest(token, "GET", endpoint, undefined, {
      ...qs,
      limit: size,
      offset,
    })) as Record<string, unknown>;
    const items = (data[property] as unknown[]) ?? [];
    results.push(...items);
    if (limit && results.length >= limit) return results.slice(0, limit);
    if (items.length === 0) break;
    offset += size;
  }
  return results;
}

function getToken(ctx: {
  connection: { config: Record<string, unknown> };
}): string {
  return ctx.connection.config.accessToken as string;
}

export default function box(rl: RunlinePluginAPI) {
  rl.setName("box");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Box OAuth2 access token (or developer token for testing)",
      env: "BOX_ACCESS_TOKEN",
    },
  });

  // ── File ────────────────────────────────────────────

  rl.registerAction("file.copy", {
    access: "write",
    description: "Copy a file to a folder",
    inputSchema: {
      fileId: { type: "string", required: true, description: "File ID" },
      parentId: {
        type: "string",
        required: true,
        description: "Destination folder ID (0 for root)",
      },
      name: {
        type: "string",
        required: false,
        description: "New name for the copy",
      },
      version: {
        type: "string",
        required: false,
        description: "Specific version to copy",
      },
      fields: {
        type: "string",
        required: false,
        description: "Comma-separated fields to return",
      },
    },
    async execute(input, ctx) {
      const { fileId, parentId, name, version, fields } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { parent: { id: parentId || "0" } };
      if (name) body.name = name;
      if (version) body.version = version;
      const qs: Record<string, unknown> = {};
      if (fields) qs.fields = fields;
      return apiRequest(
        getToken(ctx),
        "POST",
        `/files/${fileId}/copy`,
        body,
        qs,
      );
    },
  });

  rl.registerAction("file.delete", {
    access: "write",
    description: "Delete a file",
    inputSchema: {
      fileId: { type: "string", required: true, description: "File ID" },
    },
    async execute(input, ctx) {
      const { fileId } = input as { fileId: string };
      await apiRequest(getToken(ctx), "DELETE", `/files/${fileId}`);
      return { success: true };
    },
  });

  rl.registerAction("file.get", {
    access: "read",
    description: "Get file metadata",
    inputSchema: {
      fileId: { type: "string", required: true, description: "File ID" },
      fields: {
        type: "string",
        required: false,
        description: "Comma-separated fields to return",
      },
    },
    async execute(input, ctx) {
      const { fileId, fields } = input as { fileId: string; fields?: string };
      const qs: Record<string, unknown> = {};
      if (fields) qs.fields = fields;
      return apiRequest(
        getToken(ctx),
        "GET",
        `/files/${fileId}`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("file.search", {
    access: "read",
    description: "Search for files",
    inputSchema: {
      query: { type: "string", required: true, description: "Search query" },
      limit: { type: "number", required: false, description: "Max results" },
      contentTypes: {
        type: "string",
        required: false,
        description:
          "Comma-separated content types (name, description, file_content, comments, tags)",
      },
      createdAtRange: {
        type: "string",
        required: false,
        description: "Date range: from,to (ISO 8601)",
      },
      updatedAtRange: {
        type: "string",
        required: false,
        description: "Date range: from,to (ISO 8601)",
      },
      ancestorFolderIds: {
        type: "string",
        required: false,
        description: "Comma-separated folder IDs to search within",
      },
    },
    async execute(input, ctx) {
      const {
        query,
        limit,
        contentTypes,
        createdAtRange,
        updatedAtRange,
        ancestorFolderIds,
      } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { type: "file", query };
      if (contentTypes) qs.content_types = contentTypes;
      if (createdAtRange) qs.created_at_range = createdAtRange;
      if (updatedAtRange) qs.updated_at_range = updatedAtRange;
      if (ancestorFolderIds) qs.ancestor_folder_ids = ancestorFolderIds;
      return paginateAll(
        getToken(ctx),
        "/search",
        "entries",
        qs,
        limit as number | undefined,
      );
    },
  });

  rl.registerAction("file.share", {
    access: "write",
    description: "Share a file (create a collaboration)",
    inputSchema: {
      fileId: { type: "string", required: true, description: "File ID" },
      role: {
        type: "string",
        required: true,
        description:
          "Role: editor, viewer, previewer, uploader, previewer_uploader, viewer_uploader, co-owner",
      },
      accessibleByType: {
        type: "string",
        required: true,
        description: "'user' or 'group'",
      },
      accessibleById: {
        type: "string",
        required: false,
        description: "User/group ID (use this or email)",
      },
      email: {
        type: "string",
        required: false,
        description: "User email (alternative to ID, only for user type)",
      },
      canViewPath: {
        type: "boolean",
        required: false,
        description: "Can view path to this item",
      },
      expiresAt: {
        type: "string",
        required: false,
        description: "Expiration date (ISO 8601)",
      },
      notify: {
        type: "boolean",
        required: false,
        description: "Send notification email",
      },
    },
    async execute(input, ctx) {
      const {
        fileId,
        role,
        accessibleByType,
        accessibleById,
        email,
        canViewPath,
        expiresAt,
        notify,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        item: { id: fileId, type: "file" },
        role,
        accessible_by: {} as Record<string, unknown>,
      };
      const accessible = body.accessible_by as Record<string, unknown>;
      accessible.type = accessibleByType;
      if (email) accessible.login = email;
      else if (accessibleById) accessible.id = accessibleById;
      if (canViewPath !== undefined) body.can_view_path = canViewPath;
      if (expiresAt) body.expires_at = expiresAt;
      const qs: Record<string, unknown> = {};
      if (notify !== undefined) qs.notify = notify;
      return apiRequest(getToken(ctx), "POST", "/collaborations", body, qs);
    },
  });

  // ── Folder ──────────────────────────────────────────

  rl.registerAction("folder.create", {
    access: "write",
    description: "Create a folder",
    inputSchema: {
      name: { type: "string", required: true, description: "Folder name" },
      parentId: {
        type: "string",
        required: false,
        description: "Parent folder ID (0 for root)",
      },
      fields: {
        type: "string",
        required: false,
        description: "Comma-separated fields to return",
      },
    },
    async execute(input, ctx) {
      const { name, parentId, fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        name,
        parent: { id: parentId || "0" },
      };
      const qs: Record<string, unknown> = {};
      if (fields) qs.fields = fields;
      return apiRequest(getToken(ctx), "POST", "/folders", body, qs);
    },
  });

  rl.registerAction("folder.delete", {
    access: "write",
    description: "Delete a folder",
    inputSchema: {
      folderId: { type: "string", required: true, description: "Folder ID" },
      recursive: {
        type: "boolean",
        required: false,
        description: "Delete non-empty folder recursively",
      },
    },
    async execute(input, ctx) {
      const { folderId, recursive } = input as {
        folderId: string;
        recursive?: boolean;
      };
      await apiRequest(
        getToken(ctx),
        "DELETE",
        `/folders/${folderId}`,
        undefined,
        {
          recursive: recursive ?? false,
        },
      );
      return { success: true };
    },
  });

  rl.registerAction("folder.get", {
    access: "read",
    description: "Get folder metadata",
    inputSchema: {
      folderId: { type: "string", required: true, description: "Folder ID" },
    },
    async execute(input, ctx) {
      const { folderId } = input as { folderId: string };
      return apiRequest(getToken(ctx), "GET", `/folders/${folderId}`);
    },
  });

  rl.registerAction("folder.search", {
    access: "read",
    description: "Search for folders",
    inputSchema: {
      query: { type: "string", required: true, description: "Search query" },
      limit: { type: "number", required: false, description: "Max results" },
      contentTypes: {
        type: "string",
        required: false,
        description: "Comma-separated content types",
      },
      createdAtRange: {
        type: "string",
        required: false,
        description: "Date range: from,to (ISO 8601)",
      },
      updatedAtRange: {
        type: "string",
        required: false,
        description: "Date range: from,to (ISO 8601)",
      },
    },
    async execute(input, ctx) {
      const { query, limit, contentTypes, createdAtRange, updatedAtRange } =
        (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { type: "folder", query };
      if (contentTypes) qs.content_types = contentTypes;
      if (createdAtRange) qs.created_at_range = createdAtRange;
      if (updatedAtRange) qs.updated_at_range = updatedAtRange;
      return paginateAll(
        getToken(ctx),
        "/search",
        "entries",
        qs,
        limit as number | undefined,
      );
    },
  });

  rl.registerAction("folder.share", {
    access: "write",
    description: "Share a folder (create a collaboration)",
    inputSchema: {
      folderId: { type: "string", required: true, description: "Folder ID" },
      role: {
        type: "string",
        required: true,
        description:
          "Role: editor, viewer, previewer, uploader, previewer_uploader, viewer_uploader, co-owner",
      },
      accessibleByType: {
        type: "string",
        required: true,
        description: "'user' or 'group'",
      },
      accessibleById: {
        type: "string",
        required: false,
        description: "User/group ID",
      },
      email: {
        type: "string",
        required: false,
        description: "User email (alternative to ID)",
      },
      canViewPath: {
        type: "boolean",
        required: false,
        description: "Can view path",
      },
      expiresAt: {
        type: "string",
        required: false,
        description: "Expiration (ISO 8601)",
      },
      notify: {
        type: "boolean",
        required: false,
        description: "Send notification",
      },
    },
    async execute(input, ctx) {
      const {
        folderId,
        role,
        accessibleByType,
        accessibleById,
        email,
        canViewPath,
        expiresAt,
        notify,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        item: { id: folderId, type: "folder" },
        role,
        accessible_by: {} as Record<string, unknown>,
      };
      const accessible = body.accessible_by as Record<string, unknown>;
      accessible.type = accessibleByType;
      if (email) accessible.login = email;
      else if (accessibleById) accessible.id = accessibleById;
      if (canViewPath !== undefined) body.can_view_path = canViewPath;
      if (expiresAt) body.expires_at = expiresAt;
      const qs: Record<string, unknown> = {};
      if (notify !== undefined) qs.notify = notify;
      return apiRequest(getToken(ctx), "POST", "/collaborations", body, qs);
    },
  });

  rl.registerAction("folder.update", {
    access: "write",
    description: "Update a folder (move, rename, tag)",
    inputSchema: {
      folderId: { type: "string", required: true, description: "Folder ID" },
      name: { type: "string", required: false, description: "New name" },
      parentId: {
        type: "string",
        required: false,
        description: "Move to this parent folder ID",
      },
      description: {
        type: "string",
        required: false,
        description: "Description",
      },
      tags: {
        type: "string",
        required: false,
        description: "Comma-separated tags",
      },
      fields: {
        type: "string",
        required: false,
        description: "Fields to return",
      },
    },
    async execute(input, ctx) {
      const { folderId, name, parentId, description, tags, fields } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (parentId) body.parent = { id: parentId };
      if (description) body.description = description;
      if (tags) body.tags = (tags as string).split(",").map((t) => t.trim());
      const qs: Record<string, unknown> = {};
      if (fields) qs.fields = fields;
      return apiRequest(getToken(ctx), "PUT", `/folders/${folderId}`, body, qs);
    },
  });
}
