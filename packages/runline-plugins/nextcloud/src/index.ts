import type { RunlinePluginAPI } from "runline";

interface Conn {
  config: Record<string, unknown>;
}

function getConn(ctx: { connection: Conn }) {
  const c = ctx.connection.config;
  return {
    webDavUrl: (c.webDavUrl as string).replace(/\/$/, ""),
    username: c.username as string,
    password: c.password as string,
  };
}

function authHeader(conn: { username: string; password: string }): string {
  // Nextcloud uses Basic auth for access token API
  return "Basic " + btoa(`${conn.username}:${conn.password}`);
}

/** Base URL without /remote.php/webdav — for OCS and share APIs */
function baseUrl(conn: { webDavUrl: string }): string {
  return conn.webDavUrl.replace("/remote.php/webdav", "");
}

/** Make a WebDAV request */
async function webdavRequest(
  conn: { webDavUrl: string; username: string; password: string },
  method: string,
  path: string,
  headers?: Record<string, string>,
): Promise<string> {
  const url = `${conn.webDavUrl}/${encodeURI(path.replace(/^\//, ""))}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: authHeader(conn), ...headers },
  });
  if (!res.ok)
    throw new Error(
      `Nextcloud WebDAV error ${res.status}: ${await res.text()}`,
    );
  return res.text();
}

/** Make an OCS API request (returns XML text) */
async function ocsRequest(
  conn: { webDavUrl: string; username: string; password: string },
  method: string,
  endpoint: string,
  body?: string,
  qs?: Record<string, unknown>,
): Promise<string> {
  const url = new URL(`${baseUrl(conn)}/${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  // Request JSON format via OCS
  url.searchParams.set("format", "json");
  const headers: Record<string, string> = {
    Authorization: authHeader(conn),
    "OCS-APIRequest": "true",
  };
  const init: RequestInit = { method, headers };
  if (body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = body;
  }
  const res = await fetch(url.toString(), init);
  if (!res.ok)
    throw new Error(`Nextcloud OCS error ${res.status}: ${await res.text()}`);
  return res.text();
}

/** Parse OCS JSON response */
function parseOcs(text: string): unknown {
  const json = JSON.parse(text);
  const meta = json?.ocs?.meta;
  if (meta && meta.status !== "ok" && meta.statuscode >= 300) {
    throw new Error(`Nextcloud OCS error: ${meta.message || meta.status}`);
  }
  return json?.ocs?.data;
}

export default function nextcloud(rl: RunlinePluginAPI) {
  rl.setName("nextcloud");
  rl.setVersion("0.1.0");

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
      const conn = getConn(ctx);
      await webdavRequest(conn, "COPY", path as string, {
        Destination: `${conn.webDavUrl}/${encodeURI((toPath as string).replace(/^\//, ""))}`,
      });
      return { success: true };
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
      await webdavRequest(getConn(ctx), "DELETE", path as string);
      return { success: true };
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
      const conn = getConn(ctx);
      await webdavRequest(conn, "MOVE", path as string, {
        Destination: `${conn.webDavUrl}/${encodeURI((toPath as string).replace(/^\//, ""))}`,
      });
      return { success: true };
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
      const params = new URLSearchParams();
      params.set("path", p.path as string);
      params.set("shareType", String(p.shareType));
      if (p.shareWith) params.set("shareWith", p.shareWith as string);
      if (p.permissions) params.set("permissions", String(p.permissions));
      if (p.password) params.set("password", p.password as string);
      const text = await ocsRequest(
        getConn(ctx),
        "POST",
        "ocs/v2.php/apps/files_sharing/api/v1/shares",
        params.toString(),
      );
      return parseOcs(text);
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
      await webdavRequest(getConn(ctx), "MKCOL", path as string);
      return { success: true };
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
      await webdavRequest(getConn(ctx), "DELETE", path as string);
      return { success: true };
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
      const conn = getConn(ctx);
      await webdavRequest(conn, "COPY", path as string, {
        Destination: `${conn.webDavUrl}/${encodeURI((toPath as string).replace(/^\//, ""))}`,
      });
      return { success: true };
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
      const conn = getConn(ctx);
      await webdavRequest(conn, "MOVE", path as string, {
        Destination: `${conn.webDavUrl}/${encodeURI((toPath as string).replace(/^\//, ""))}`,
      });
      return { success: true };
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
      const params = new URLSearchParams();
      params.set("userid", userId as string);
      params.set("email", email as string);
      if (displayName) params.set("displayName", displayName as string);
      const text = await ocsRequest(
        getConn(ctx),
        "POST",
        "ocs/v1.php/cloud/users",
        params.toString(),
      );
      return parseOcs(text);
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
      const text = await ocsRequest(
        getConn(ctx),
        "DELETE",
        `ocs/v1.php/cloud/users/${userId}`,
      );
      return parseOcs(text);
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
      const text = await ocsRequest(
        getConn(ctx),
        "GET",
        `ocs/v1.php/cloud/users/${userId}`,
      );
      return parseOcs(text);
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
      const text = await ocsRequest(
        getConn(ctx),
        "GET",
        "ocs/v1.php/cloud/users",
        undefined,
        qs,
      );
      return parseOcs(text);
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
      const body = `key=${encodeURIComponent(key as string)}&value=${encodeURIComponent(value as string)}`;
      const text = await ocsRequest(
        getConn(ctx),
        "PUT",
        `ocs/v1.php/cloud/users/${userId}`,
        body,
      );
      return parseOcs(text);
    },
  });
}
