import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import {
  answerFailed,
  credentialJson,
  credentialOk,
  pathSegment,
  pathSegments,
} from "../../_shared/credentials.js";
import { nextcloudCredential } from "./credentials.js";

/** A file or folder path beneath the WebDAV base, each segment encoded. */
function davPath(path: unknown): string {
  return pathSegments(String(path ?? "").replace(/^\/+|\/+$/g, ""));
}

/** A WebDAV call on `path`; COPY and MOVE name where it goes. */
async function dav(
  ctx: ActionContext,
  method: HttpMethod,
  path: unknown,
  toPath?: unknown,
): Promise<{ success: true }> {
  await credentialOk(ctx, nextcloudCredential, "nextcloud", {
    target: "dav",
    path: davPath(path),
    method,
    ...(toPath !== undefined ? { destination: davPath(toPath) } : {}),
  });
  return { success: true };
}

/** An OCS call, answered as JSON; a status other than ok is a failure. */
async function ocs(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  options: {
    form?: Record<string, unknown>;
    query?: Record<string, unknown>;
  } = {},
): Promise<unknown> {
  const answer = await credentialJson<{
    ocs?: {
      meta?: { status?: string; statuscode?: number; message?: string };
      data?: unknown;
    };
  }>(ctx, nextcloudCredential, "nextcloud", {
    target: "ocs",
    path,
    method,
    query: { ...options.query, format: "json" },
    form: options.form,
    headers: { "OCS-APIRequest": "true" },
  });
  const meta = answer.ocs?.meta;
  if (meta && meta.status !== "ok")
    throw answerFailed("nextcloud", {
      code: meta.statuscode,
      message: meta.message,
    });
  return answer.ocs?.data;
}

export default function nextcloud(rl: RunlinePluginAPI) {
  rl.setName("nextcloud");
  rl.setVersion("0.1.0");
  rl.setCredential(nextcloudCredential);

  rl.setConnectionSchema({
    webDavUrl: {
      type: "string",
      required: true,
      description:
        "Nextcloud WebDAV URL (e.g. https://cloud.example.com/remote.php/webdav)",
      env: "NEXTCLOUD_WEBDAV_URL",
    },
    username: {
      type: "string",
      required: true,
      description: "Nextcloud username",
      env: "NEXTCLOUD_USERNAME",
    },
    password: {
      type: "string",
      required: true,
      description: "Nextcloud password or app token",
      env: "NEXTCLOUD_PASSWORD",
    },
  });

  // ── File/Folder operations (non-binary) ─────────────

  rl.registerAction("file.copy", {
    access: "write",
    description: "Copy a file on Nextcloud",
    inputSchema: {
      path: {
        type: "string",
        required: true,
        description: "Source file path (e.g. /invoices/original.txt)",
      },
      toPath: {
        type: "string",
        required: true,
        description: "Destination file path",
      },
    },
    async execute(input, ctx) {
      const { path, toPath } = input as Record<string, unknown>;
      return dav(ctx, "COPY", path, toPath);
    },
  });

  rl.registerAction("file.delete", {
    access: "write",
    description: "Delete a file on Nextcloud",
    inputSchema: {
      path: {
        type: "string",
        required: true,
        description: "File path to delete",
      },
    },
    async execute(input, ctx) {
      const { path } = input as Record<string, unknown>;
      return dav(ctx, "DELETE", path);
    },
  });

  rl.registerAction("file.move", {
    access: "write",
    description: "Move/rename a file on Nextcloud",
    inputSchema: {
      path: { type: "string", required: true, description: "Source file path" },
      toPath: {
        type: "string",
        required: true,
        description: "Destination file path",
      },
    },
    async execute(input, ctx) {
      const { path, toPath } = input as Record<string, unknown>;
      return dav(ctx, "MOVE", path, toPath);
    },
  });

  rl.registerAction("file.share", {
    access: "write",
    description: "Share a file or folder via Nextcloud sharing API",
    inputSchema: {
      path: {
        type: "string",
        required: true,
        description: "File/folder path to share",
      },
      shareType: {
        type: "number",
        required: true,
        description: "0=user, 1=group, 3=public link, 4=email, 7=circle",
      },
      shareWith: {
        type: "string",
        required: false,
        description:
          "User, group, email, or circle ID to share with (not needed for public link)",
      },
      permissions: {
        type: "number",
        required: false,
        description: "1=read, 2=update, 4=create, 8=delete, 31=all (default 1)",
      },
      password: {
        type: "string",
        required: false,
        description: "Password for public link shares",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return ocs(ctx, "POST", "v2.php/apps/files_sharing/api/v1/shares", {
        form: {
          path: p.path,
          shareType: p.shareType,
          shareWith: p.shareWith || undefined,
          permissions: p.permissions || undefined,
          password: p.password || undefined,
        },
      });
    },
  });

  rl.registerAction("folder.create", {
    access: "write",
    description: "Create a folder on Nextcloud",
    inputSchema: {
      path: {
        type: "string",
        required: true,
        description: "Folder path to create (e.g. /invoices/2019)",
      },
    },
    async execute(input, ctx) {
      const { path } = input as Record<string, unknown>;
      return dav(ctx, "MKCOL", path);
    },
  });

  rl.registerAction("folder.delete", {
    access: "write",
    description: "Delete a folder on Nextcloud",
    inputSchema: {
      path: {
        type: "string",
        required: true,
        description: "Folder path to delete",
      },
    },
    async execute(input, ctx) {
      const { path } = input as Record<string, unknown>;
      return dav(ctx, "DELETE", path);
    },
  });

  rl.registerAction("folder.copy", {
    access: "write",
    description: "Copy a folder on Nextcloud",
    inputSchema: {
      path: {
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
      const { path, toPath } = input as Record<string, unknown>;
      return dav(ctx, "COPY", path, toPath);
    },
  });

  rl.registerAction("folder.move", {
    access: "write",
    description: "Move/rename a folder on Nextcloud",
    inputSchema: {
      path: {
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
      const { path, toPath } = input as Record<string, unknown>;
      return dav(ctx, "MOVE", path, toPath);
    },
  });

  // ── User operations ─────────────────────────────────

  rl.registerAction("user.create", {
    access: "write",
    description: "Create a user on Nextcloud",
    inputSchema: {
      userId: { type: "string", required: true, description: "Username" },
      email: { type: "string", required: true, description: "Email address" },
      displayName: {
        type: "string",
        required: false,
        description: "Display name",
      },
    },
    async execute(input, ctx) {
      const { userId, email, displayName } = input as Record<string, unknown>;
      return ocs(ctx, "POST", "v1.php/cloud/users", {
        form: { userid: userId, email, displayName: displayName || undefined },
      });
    },
  });

  rl.registerAction("user.delete", {
    access: "write",
    description: "Delete a user on Nextcloud",
    inputSchema: {
      userId: { type: "string", required: true, description: "Username" },
    },
    async execute(input, ctx) {
      const { userId } = input as Record<string, unknown>;
      return ocs(ctx, "DELETE", `v1.php/cloud/users/${pathSegment(userId)}`);
    },
  });

  rl.registerAction("user.get", {
    access: "read",
    description: "Get a user's information",
    inputSchema: {
      userId: { type: "string", required: true, description: "Username" },
    },
    async execute(input, ctx) {
      const { userId } = input as Record<string, unknown>;
      return ocs(ctx, "GET", `v1.php/cloud/users/${pathSegment(userId)}`);
    },
  });

  rl.registerAction("user.list", {
    access: "read",
    description: "List all users",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
      offset: { type: "number", required: false, description: "Offset" },
      search: { type: "string", required: false, description: "Search string" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      if (p.offset) qs.offset = p.offset;
      if (p.search) qs.search = p.search;
      return ocs(ctx, "GET", "v1.php/cloud/users", { query: qs });
    },
  });

  rl.registerAction("user.update", {
    access: "write",
    description:
      "Update a user attribute (email, displayname, password, address, twitter, website)",
    inputSchema: {
      userId: { type: "string", required: true, description: "Username" },
      key: {
        type: "string",
        required: true,
        description:
          "Attribute key: email, displayname, password, address, twitter, website",
      },
      value: { type: "string", required: true, description: "New value" },
    },
    async execute(input, ctx) {
      const { userId, key, value } = input as Record<string, unknown>;
      return ocs(ctx, "PUT", `v1.php/cloud/users/${pathSegment(userId)}`, {
        form: { key, value },
      });
    },
  });
}
