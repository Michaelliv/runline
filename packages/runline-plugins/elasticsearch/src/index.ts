import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import {
  credentialOk,
  jsonOrAcknowledged,
  pathSegment,
} from "../../_shared/credentials.js";
import { elasticsearchCredential } from "./credentials.js";

async function req(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  const res = await credentialOk(
    ctx,
    elasticsearchCredential,
    "elasticsearch",
    {
      target: "api",
      path,
      method,
      query,
      ...(body &&
      Object.keys(body).length > 0 &&
      method !== "GET" &&
      method !== "DELETE"
        ? { json: body }
        : {}),
    },
  );
  return jsonOrAcknowledged(res);
}

export default function elasticsearch(rl: RunlinePluginAPI) {
  rl.setName("elasticsearch");
  rl.setVersion("0.1.0");
  rl.setCredential(elasticsearchCredential);

  rl.setConnectionSchema({
    baseUrl: {
      type: "string",
      required: true,
      description: "Elasticsearch base URL (e.g. https://localhost:9200)",
      env: "ELASTICSEARCH_URL",
    },
    username: {
      type: "string",
      required: false,
      description: "Username for basic auth",
      env: "ELASTICSEARCH_USERNAME",
    },
    password: {
      type: "string",
      required: false,
      description: "Password for basic auth",
      env: "ELASTICSEARCH_PASSWORD",
    },
  });

  // ── Document ────────────────────────────────────────

  rl.registerAction("document.create", {
    access: "write",
    description: "Index (create) a document",
    inputSchema: {
      index: { type: "string", required: true, description: "Index name" },
      id: {
        type: "string",
        required: false,
        description: "Document ID (auto-generated if omitted)",
      },
      body: { type: "object", required: true, description: "Document body" },
    },
    async execute(input, ctx) {
      const { index, id, body } = input as Record<string, unknown>;
      const endpoint = id
        ? `${pathSegment(index)}/_doc/${pathSegment(id)}`
        : `${pathSegment(index)}/_doc`;
      return req(
        ctx,
        id ? "PUT" : "POST",
        endpoint,
        body as Record<string, unknown>,
      );
    },
  });

  rl.registerAction("document.get", {
    access: "read",
    description: "Get a document by ID",
    inputSchema: {
      index: { type: "string", required: true, description: "Index name" },
      id: { type: "string", required: true, description: "Document ID" },
    },
    async execute(input, ctx) {
      const { index, id } = input as { index: string; id: string };
      return req(ctx, "GET", `${pathSegment(index)}/_doc/${pathSegment(id)}`);
    },
  });

  rl.registerAction("document.update", {
    access: "write",
    description: "Update a document",
    inputSchema: {
      index: { type: "string", required: true, description: "Index name" },
      id: { type: "string", required: true, description: "Document ID" },
      body: {
        type: "object",
        required: true,
        description: "Partial document to merge",
      },
    },
    async execute(input, ctx) {
      const { index, id, body } = input as Record<string, unknown>;
      return req(
        ctx,
        "POST",
        `${pathSegment(index)}/_update/${pathSegment(id)}`,
        { doc: body },
      );
    },
  });

  rl.registerAction("document.delete", {
    access: "write",
    description: "Delete a document",
    inputSchema: {
      index: { type: "string", required: true, description: "Index name" },
      id: { type: "string", required: true, description: "Document ID" },
    },
    async execute(input, ctx) {
      const { index, id } = input as { index: string; id: string };
      return req(
        ctx,
        "DELETE",
        `${pathSegment(index)}/_doc/${pathSegment(id)}`,
      );
    },
  });

  rl.registerAction("document.search", {
    access: "read",
    description: "Search documents in an index",
    inputSchema: {
      index: { type: "string", required: true, description: "Index name" },
      query: {
        type: "object",
        required: false,
        description: "Elasticsearch query DSL",
      },
      size: {
        type: "number",
        required: false,
        description: "Max results (default: 10)",
      },
      from: { type: "number", required: false, description: "Offset" },
      sort: { type: "array", required: false, description: "Sort criteria" },
    },
    async execute(input, ctx) {
      const {
        index,
        query,
        size,
        from: offset,
        sort,
      } = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (query) body.query = query;
      if (size !== undefined) body.size = size;
      if (offset !== undefined) body.from = offset;
      if (sort) body.sort = sort;
      const data = (await req(
        ctx,
        "POST",
        `${pathSegment(index)}/_search`,
        body,
      )) as Record<string, unknown>;
      return (data.hits as Record<string, unknown>)?.hits;
    },
  });

  // ── Index ───────────────────────────────────────────

  rl.registerAction("index.create", {
    access: "write",
    description: "Create an index",
    inputSchema: {
      index: { type: "string", required: true, description: "Index name" },
      settings: {
        type: "object",
        required: false,
        description: "Index settings",
      },
      mappings: {
        type: "object",
        required: false,
        description: "Index mappings",
      },
    },
    async execute(input, ctx) {
      const { index, settings, mappings } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {};
      if (settings) body.settings = settings;
      if (mappings) body.mappings = mappings;
      return req(ctx, "PUT", pathSegment(index), body);
    },
  });

  rl.registerAction("index.get", {
    access: "read",
    description: "Get index details",
    inputSchema: {
      index: { type: "string", required: true, description: "Index name" },
    },
    async execute(input, ctx) {
      return req(ctx, "GET", pathSegment((input as { index: string }).index));
    },
  });

  rl.registerAction("index.list", {
    access: "read",
    description: "List all indices",
    async execute(_input, ctx) {
      return req(ctx, "GET", "_cat/indices", undefined, { format: "json" });
    },
  });

  rl.registerAction("index.delete", {
    access: "write",
    description: "Delete an index",
    inputSchema: {
      index: { type: "string", required: true, description: "Index name" },
    },
    async execute(input, ctx) {
      return req(
        ctx,
        "DELETE",
        pathSegment((input as { index: string }).index),
      );
    },
  });
}
