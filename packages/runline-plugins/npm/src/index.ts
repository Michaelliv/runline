import type { RunlinePluginAPI } from "runline";

interface Conn {
  config: Record<string, unknown>;
}

function getConn(ctx: { connection: Conn }) {
  const c = ctx.connection.config;
  const registryUrl = (
    (c.registryUrl as string) ?? "https://registry.npmjs.org"
  ).replace(/\/$/, "");
  const token = c.token as string | undefined;
  return { registryUrl, token };
}

async function apiRequest(
  conn: { registryUrl: string; token?: string },
  method: string,
  path: string,
  body?: string,
  contentType?: string,
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (conn.token) headers.Authorization = `Bearer ${conn.token}`;
  if (contentType) headers["Content-Type"] = contentType;
  else headers["Content-Type"] = "application/json";

  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = body;
  const res = await fetch(`${conn.registryUrl}${path}`, init);
  if (!res.ok)
    throw new Error(`npm registry error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export default function npm(rl: RunlinePluginAPI) {
  rl.setName("npm");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    registryUrl: {
      type: "string",
      required: false,
      description: "NPM registry URL (default: https://registry.npmjs.org)",
      env: "NPM_REGISTRY_URL",
    },
    token: {
      type: "string",
      required: false,
      description:
        "NPM auth token (optional, needed for private packages and dist-tag updates)",
      env: "NPM_TOKEN",
    },
  });

  rl.registerAction("package.getMetadata", {
    access: "read",
    description: "Get metadata for a package at a specific version",
    inputSchema: {
      packageName: {
        type: "string",
        required: true,
        description: "Package name (e.g. lodash)",
      },
      version: {
        type: "string",
        required: false,
        description: "Version or tag (default: latest)",
      },
    },
    async execute(input, ctx) {
      const { packageName, version } = input as Record<string, unknown>;
      const v = (version as string) || "latest";
      return apiRequest(
        getConn(ctx),
        "GET",
        `/${encodeURIComponent(packageName as string)}/${v}`,
      );
    },
  });

  rl.registerAction("package.getVersions", {
    access: "read",
    description: "Get all versions for a package with publish dates",
    inputSchema: {
      packageName: {
        type: "string",
        required: true,
        description: "Package name",
      },
    },
    async execute(input, ctx) {
      const { packageName } = input as Record<string, unknown>;
      const data = (await apiRequest(
        getConn(ctx),
        "GET",
        `/${encodeURIComponent(packageName as string)}`,
      )) as Record<string, unknown>;
      const time = (data.time ?? {}) as Record<string, string>;
      const versions = Object.entries(time)
        .filter(([v]) => /^\d+\.\d+\.\d+/.test(v))
        .map(([version, published_at]) => ({ version, published_at }))
        .sort(
          (a, b) =>
            new Date(b.published_at).getTime() -
            new Date(a.published_at).getTime(),
        );
      return versions;
    },
  });

  rl.registerAction("package.search", {
    access: "read",
    description: "Search for packages on the npm registry",
    inputSchema: {
      query: { type: "string", required: true, description: "Search query" },
      limit: {
        type: "number",
        required: false,
        description: "Max results (default 10, max 100)",
      },
      offset: {
        type: "number",
        required: false,
        description: "Offset for pagination (default 0)",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const params = new URLSearchParams();
      params.set("text", p.query as string);
      params.set("size", String(p.limit ?? 10));
      params.set("from", String(p.offset ?? 0));
      params.set("popularity", "0.99");
      const data = (await apiRequest(
        getConn(ctx),
        "GET",
        `/-/v1/search?${params.toString()}`,
      )) as Record<string, unknown>;
      const objects = (data.objects ?? []) as Array<{
        package: Record<string, unknown>;
      }>;
      return objects.map(({ package: pkg }) => ({
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
      }));
    },
  });

  rl.registerAction("distTag.list", {
    access: "read",
    description: "Get all dist-tags for a package",
    inputSchema: {
      packageName: {
        type: "string",
        required: true,
        description: "Package name",
      },
    },
    async execute(input, ctx) {
      const { packageName } = input as Record<string, unknown>;
      return apiRequest(
        getConn(ctx),
        "GET",
        `/-/package/${encodeURIComponent(packageName as string)}/dist-tags`,
      );
    },
  });

  rl.registerAction("distTag.update", {
    access: "write",
    description: "Update a dist-tag for a package (requires auth)",
    inputSchema: {
      packageName: {
        type: "string",
        required: true,
        description: "Package name",
      },
      tagName: {
        type: "string",
        required: true,
        description: "Dist-tag name (e.g. latest)",
      },
      version: {
        type: "string",
        required: true,
        description: "Version to point the tag to",
      },
    },
    async execute(input, ctx) {
      const { packageName, tagName, version } = input as Record<
        string,
        unknown
      >;
      return apiRequest(
        getConn(ctx),
        "PUT",
        `/-/package/${encodeURIComponent(packageName as string)}/dist-tags/${encodeURIComponent(tagName as string)}`,
        version as string,
        "application/x-www-form-urlencoded",
      );
    },
  });
}
