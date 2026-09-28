import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { contentfulCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function apiRequest(
  ctx: ActionContext,
  path: string,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, contentfulCredential, "contentful", {
    target: "api",
    path,
    query: qs,
  });
}

async function paginateAll(
  ctx: ActionContext,
  path: string,
  qs?: Record<string, unknown>,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let skip = 0;
  const size = 100;
  while (true) {
    const data = (await apiRequest(ctx, path, {
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

function spaceOf(ctx: ActionContext): string {
  return seg(ctx.connection.config.spaceId);
}

export default function contentful(rl: RunlinePluginAPI) {
  rl.setName("contentful");
  rl.setVersion("0.1.0");
  rl.setCredential(contentfulCredential);

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
      return apiRequest(ctx, `spaces/${spaceOf(ctx)}`);
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
      return apiRequest(
        ctx,
        `spaces/${spaceOf(ctx)}/environments/${seg(environmentId)}/content_types/${seg(contentTypeId)}`,
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
      return apiRequest(
        ctx,
        `spaces/${spaceOf(ctx)}/environments/${seg(environmentId)}/entries/${seg(entryId)}`,
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
      const qs: Record<string, unknown> = {};
      if (contentType) qs.content_type = contentType;
      if (query) qs.query = query;
      if (select) qs.select = select;
      if (order) qs.order = order;
      return paginateAll(
        ctx,
        `spaces/${spaceOf(ctx)}/environments/${seg(environmentId)}/entries`,
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
      return apiRequest(
        ctx,
        `spaces/${spaceOf(ctx)}/environments/${seg(environmentId)}/assets/${seg(assetId)}`,
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
      return paginateAll(
        ctx,
        `spaces/${spaceOf(ctx)}/environments/${seg(environmentId)}/assets`,
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
      return paginateAll(
        ctx,
        `spaces/${spaceOf(ctx)}/environments/${seg(environmentId)}/locales`,
        undefined,
        limit as number | undefined,
      );
    },
  });
}
