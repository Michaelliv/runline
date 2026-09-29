import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import {
  credentialJson,
  pathSegment,
  slashEncodedSegment,
} from "../../_shared/credentials.js";
import { npmCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  options: { query?: Record<string, unknown>; json?: unknown } = {},
): Promise<unknown> {
  return credentialJson(ctx, npmCredential, "npm", {
    target: "registry",
    path,
    method,
    ...options,
  });
}

export default function npm(rl: RunlinePluginAPI) {
  rl.setName("npm");
  rl.setVersion("0.1.0");
  rl.setCredential(npmCredential);

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
        ctx,
        "GET",
        `${slashEncodedSegment(packageName)}/${pathSegment(v)}`,
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
        ctx,
        "GET",
        slashEncodedSegment(packageName),
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
      const data = (await apiRequest(ctx, "GET", "-/v1/search", {
        query: {
          text: p.query,
          size: p.limit ?? 10,
          from: p.offset ?? 0,
          popularity: 0.99,
        },
      })) as Record<string, unknown>;
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
        ctx,
        "GET",
        `-/package/${slashEncodedSegment(packageName)}/dist-tags`,
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
        ctx,
        "PUT",
        `-/package/${slashEncodedSegment(packageName)}/dist-tags/${pathSegment(tagName)}`,
        { json: version },
      );
    },
  });
}
