import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { bubbleCredential } from "./credentials.js";

function api(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, bubbleCredential, "bubble", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
      ? { json: body }
      : {}),
  });
}

/** A data type name as Bubble expects it — no whitespace, lowercase — encoded as one path segment. */
function typeSegment(name: string): string {
  return pathSegment(name.replace(/\s/g, "").toLowerCase());
}

export default function bubble(rl: RunlinePluginAPI) {
  rl.setName("bubble");
  rl.setVersion("0.1.0");
  rl.setCredential(bubbleCredential);

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
      return api(ctx, "POST", `obj/${typeSegment(typeName)}`, properties);
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
      const data = (await api(
        ctx,
        "GET",
        `obj/${typeSegment(typeName)}/${pathSegment(objectId)}`,
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
      const qs: Record<string, unknown> = {};
      if (constraints) qs.constraints = JSON.stringify(constraints);
      if (sortField) {
        qs.sort_field = sortField;
        if (descending) qs.descending = "true";
      }

      const endpoint = `obj/${typeSegment(typeName as string)}`;

      if (limit) {
        qs.limit = limit;
        const data = (await api(ctx, "GET", endpoint, undefined, qs)) as Record<
          string,
          unknown
        >;
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
        const data = (await api(ctx, "GET", endpoint, undefined, qs)) as Record<
          string,
          unknown
        >;
        const resp = (data.response ?? {}) as Record<string, unknown>;
        const items = (resp.results as unknown[]) ?? [];
        results.push(...items);
        // Only a positive remaining count asks for another page.
        const remaining = resp.remaining;
        if (!items.length || typeof remaining !== "number" || remaining <= 0)
          break;
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
      await api(
        ctx,
        "PATCH",
        `obj/${typeSegment(typeName)}/${pathSegment(objectId)}`,
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
      await api(
        ctx,
        "DELETE",
        `obj/${typeSegment(typeName)}/${pathSegment(objectId)}`,
      );
      return { success: true };
    },
  });
}
