import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  host: string,
  token: string,
  endpoint: string,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`https://${host}${endpoint}`);
  url.searchParams.set("access_token", token);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok)
    throw new Error(`Contentful API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function paginateAll(
  host: string,
  token: string,
  endpoint: string,
  qs?: Record<string, unknown>,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let skip = 0;
  const size = 100;
  while (true) {
    const data = (await apiRequest(host, token, endpoint, {
      ...qs,
      skip,
      limit: size,
    })) as Record<string, unknown>;
    const items = (data.items as unknown[]) ?? [];
    results.push(...items);
    if (limit && results.length >= limit) return results.slice(0, limit);
    if (items.length < size) break;
    skip += size;
  }
  return results;
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const cfg = ctx.connection.config;
  const isPreview = cfg.source === "preview";
  return {
    host: isPreview ? "preview.contentful.com" : "cdn.contentful.com",
    token: (isPreview
      ? cfg.previewAccessToken
      : cfg.deliveryAccessToken) as string,
    spaceId: cfg.spaceId as string,
  };
}

export default function contentful(rl: RunlinePluginAPI) {
  rl.setName("contentful");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    spaceId: {
      type: "string",
      required: true,
      description: "Contentful Space ID",
      env: "CONTENTFUL_SPACE_ID",
    },
    deliveryAccessToken: {
      type: "string",
      required: true,
      description: "Content Delivery API access token",
      env: "CONTENTFUL_DELIVERY_TOKEN",
    },
    previewAccessToken: {
      type: "string",
      required: false,
      description: "Content Preview API access token",
      env: "CONTENTFUL_PREVIEW_TOKEN",
    },
    source: {
      type: "string",
      required: false,
      description: "'delivery' (default) or 'preview'",
      default: "delivery",
    },
  });

  // ── Space ───────────────────────────────────────────

  rl.registerAction("space.get", {
    access: "read",
    description: "Get space details",
    async execute(_input, ctx) {
      const { host, token, spaceId } = getConn(ctx);
      return apiRequest(host, token, `/spaces/${spaceId}`);
    },
  });

  // ── Content Type ────────────────────────────────────

  rl.registerAction("contentType.get", {
    access: "read",
    description: "Get a content type",
    inputSchema: {
      environmentId: {
        type: "string",
        required: true,
        description: "Environment ID (e.g. master)",
      },
      contentTypeId: {
        type: "string",
        required: true,
        description: "Content type ID",
      },
    },
    async execute(input, ctx) {
      const { environmentId, contentTypeId } = input as Record<string, string>;
      const { host, token, spaceId } = getConn(ctx);
      return apiRequest(
        host,
        token,
        `/spaces/${spaceId}/environments/${environmentId}/content_types/${contentTypeId}`,
      );
    },
  });

  // ── Entry ───────────────────────────────────────────

  rl.registerAction("entry.get", {
    access: "read",
    description: "Get an entry by ID",
    inputSchema: {
      environmentId: {
        type: "string",
        required: true,
        description: "Environment ID",
      },
      entryId: { type: "string", required: true, description: "Entry ID" },
    },
    async execute(input, ctx) {
      const { environmentId, entryId } = input as Record<string, string>;
      const { host, token, spaceId } = getConn(ctx);
      return apiRequest(
        host,
        token,
        `/spaces/${spaceId}/environments/${environmentId}/entries/${entryId}`,
      );
    },
  });

  rl.registerAction("entry.list", {
    access: "read",
    description: "List entries",
    inputSchema: {
      environmentId: {
        type: "string",
        required: true,
        description: "Environment ID",
      },
      contentType: {
        type: "string",
        required: false,
        description: "Filter by content type ID",
      },
      query: {
        type: "string",
        required: false,
        description: "Full-text search query",
      },
      select: {
        type: "string",
        required: false,
        description: "Comma-separated fields to select",
      },
      order: { type: "string", required: false, description: "Order by field" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { environmentId, contentType, query, select, order, limit } =
        (input ?? {}) as Record<string, unknown>;
      const { host, token, spaceId } = getConn(ctx);
      const qs: Record<string, unknown> = {};
      if (contentType) qs.content_type = contentType;
      if (query) qs.query = query;
      if (select) qs.select = select;
      if (order) qs.order = order;
      return paginateAll(
        host,
        token,
        `/spaces/${spaceId}/environments/${environmentId}/entries`,
        qs,
        limit as number | undefined,
      );
    },
  });

  // ── Asset ───────────────────────────────────────────

  rl.registerAction("asset.get", {
    access: "read",
    description: "Get an asset by ID",
    inputSchema: {
      environmentId: {
        type: "string",
        required: true,
        description: "Environment ID",
      },
      assetId: { type: "string", required: true, description: "Asset ID" },
    },
    async execute(input, ctx) {
      const { environmentId, assetId } = input as Record<string, string>;
      const { host, token, spaceId } = getConn(ctx);
      return apiRequest(
        host,
        token,
        `/spaces/${spaceId}/environments/${environmentId}/assets/${assetId}`,
      );
    },
  });

  rl.registerAction("asset.list", {
    access: "read",
    description: "List assets",
    inputSchema: {
      environmentId: {
        type: "string",
        required: true,
        description: "Environment ID",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { environmentId, limit } = (input ?? {}) as Record<string, unknown>;
      const { host, token, spaceId } = getConn(ctx);
      return paginateAll(
        host,
        token,
        `/spaces/${spaceId}/environments/${environmentId}/assets`,
        undefined,
        limit as number | undefined,
      );
    },
  });

  // ── Locale ──────────────────────────────────────────

  rl.registerAction("locale.list", {
    access: "read",
    description: "List locales",
    inputSchema: {
      environmentId: {
        type: "string",
        required: true,
        description: "Environment ID",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { environmentId, limit } = (input ?? {}) as Record<string, unknown>;
      const { host, token, spaceId } = getConn(ctx);
      return paginateAll(
        host,
        token,
        `/spaces/${spaceId}/environments/${environmentId}/locales`,
        undefined,
        limit as number | undefined,
      );
    },
  });
}
