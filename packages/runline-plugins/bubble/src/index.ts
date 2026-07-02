import type { RunlinePluginAPI } from "runline";

function buildBaseUrl(cfg: Record<string, unknown>): string {
  const hosting = cfg.hosting as string | undefined;
  const appName = cfg.appName as string;
  const domain = (cfg.domain as string | undefined)?.replace(/\/$/, "");
  const environment = cfg.environment as string | undefined;

  const rootUrl =
    hosting === "selfHosted" && domain
      ? domain
      : `https://${appName}.bubbleapps.io`;
  const urlSegment =
    environment === "development" ? "/version-test/api/1.1" : "/api/1.1";
  return `${rootUrl}${urlSegment}`;
}

async function apiRequest(
  baseUrl: string,
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${baseUrl}${endpoint}`);
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
    throw new Error(`Bubble API error ${res.status}: ${text}`);
  }
  if (res.status === 204) return { success: true };
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  return { success: true };
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const cfg = ctx.connection.config;
  return {
    baseUrl: buildBaseUrl(cfg),
    token: cfg.apiToken as string,
  };
}

function normalizeTypeName(name: string): string {
  return name.replace(/\s/g, "").toLowerCase();
}

export default function bubble(rl: RunlinePluginAPI) {
  rl.setName("bubble");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiToken: {
      type: "string",
      required: true,
      description: "Bubble API token",
      env: "BUBBLE_API_TOKEN",
    },
    appName: {
      type: "string",
      required: true,
      description: "Bubble app name (used for hosted URL)",
      env: "BUBBLE_APP_NAME",
    },
    hosting: {
      type: "string",
      required: false,
      description: "bubbleHosted (default) or selfHosted",
      env: "BUBBLE_HOSTING",
      default: "bubbleHosted",
    },
    domain: {
      type: "string",
      required: false,
      description: "Self-hosted domain URL (only if hosting=selfHosted)",
      env: "BUBBLE_DOMAIN",
    },
    environment: {
      type: "string",
      required: false,
      description: "live (default) or development",
      env: "BUBBLE_ENVIRONMENT",
      default: "live",
    },
  });

  rl.registerAction("object.create", {
    access: "write",
    description: "Create an object",
    inputSchema: {
      typeName: {
        type: "string",
        required: true,
        description: "Data type name",
      },
      properties: {
        type: "object",
        required: true,
        description: "Key-value pairs of field values",
      },
    },
    async execute(input, ctx) {
      const { typeName, properties } = input as {
        typeName: string;
        properties: Record<string, unknown>;
      };
      const { baseUrl, token } = getConn(ctx);
      return apiRequest(
        baseUrl,
        token,
        "POST",
        `/obj/${normalizeTypeName(typeName)}`,
        properties,
      );
    },
  });

  rl.registerAction("object.get", {
    access: "read",
    description: "Get an object by ID",
    inputSchema: {
      typeName: {
        type: "string",
        required: true,
        description: "Data type name",
      },
      objectId: {
        type: "string",
        required: true,
        description: "Object unique ID",
      },
    },
    async execute(input, ctx) {
      const { typeName, objectId } = input as {
        typeName: string;
        objectId: string;
      };
      const { baseUrl, token } = getConn(ctx);
      const data = (await apiRequest(
        baseUrl,
        token,
        "GET",
        `/obj/${normalizeTypeName(typeName)}/${objectId}`,
      )) as Record<string, unknown>;
      return data.response;
    },
  });

  rl.registerAction("object.list", {
    access: "read",
    description: "List objects of a type with optional constraints and sorting",
    inputSchema: {
      typeName: {
        type: "string",
        required: true,
        description: "Data type name",
      },
      constraints: {
        type: "array",
        required: false,
        description:
          "Array of constraint objects [{key, constraint_type, value}]",
      },
      sortField: {
        type: "string",
        required: false,
        description: "Field to sort by",
      },
      descending: {
        type: "boolean",
        required: false,
        description: "Sort descending",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { typeName, constraints, sortField, descending, limit } = (input ??
        {}) as Record<string, unknown>;
      const { baseUrl, token } = getConn(ctx);
      const qs: Record<string, unknown> = {};
      if (constraints) qs.constraints = JSON.stringify(constraints);
      if (sortField) {
        qs.sort_field = sortField;
        if (descending) qs.descending = "true";
      }

      const endpoint = `/obj/${normalizeTypeName(typeName as string)}`;

      if (limit) {
        qs.limit = limit;
        const data = (await apiRequest(
          baseUrl,
          token,
          "GET",
          endpoint,
          undefined,
          qs,
        )) as Record<string, unknown>;
        return (
          ((data.response as Record<string, unknown>)?.results as unknown[]) ??
          []
        );
      }

      // Paginate all
      const results: unknown[] = [];
      qs.limit = 100;
      qs.cursor = 0;
      while (true) {
        const data = (await apiRequest(
          baseUrl,
          token,
          "GET",
          endpoint,
          undefined,
          qs,
        )) as Record<string, unknown>;
        const resp = data.response as Record<string, unknown>;
        const items = (resp.results as unknown[]) ?? [];
        results.push(...items);
        if ((resp.remaining as number) === 0) break;
        qs.cursor = (qs.cursor as number) + (qs.limit as number);
      }
      return results;
    },
  });

  rl.registerAction("object.update", {
    access: "write",
    description: "Update an object",
    inputSchema: {
      typeName: {
        type: "string",
        required: true,
        description: "Data type name",
      },
      objectId: {
        type: "string",
        required: true,
        description: "Object unique ID",
      },
      properties: {
        type: "object",
        required: true,
        description: "Key-value pairs of fields to update",
      },
    },
    async execute(input, ctx) {
      const { typeName, objectId, properties } = input as {
        typeName: string;
        objectId: string;
        properties: Record<string, unknown>;
      };
      const { baseUrl, token } = getConn(ctx);
      await apiRequest(
        baseUrl,
        token,
        "PATCH",
        `/obj/${normalizeTypeName(typeName)}/${objectId}`,
        properties,
      );
      return { success: true };
    },
  });

  rl.registerAction("object.delete", {
    access: "write",
    description: "Delete an object",
    inputSchema: {
      typeName: {
        type: "string",
        required: true,
        description: "Data type name",
      },
      objectId: {
        type: "string",
        required: true,
        description: "Object unique ID",
      },
    },
    async execute(input, ctx) {
      const { typeName, objectId } = input as {
        typeName: string;
        objectId: string;
      };
      const { baseUrl, token } = getConn(ctx);
      await apiRequest(
        baseUrl,
        token,
        "DELETE",
        `/obj/${normalizeTypeName(typeName)}/${objectId}`,
      );
      return { success: true };
    },
  });
}
