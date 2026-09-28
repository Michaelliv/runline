import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { cockpitCredential } from "./credentials.js";

/** A collection, form, or singleton name as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, cockpitCredential, "cockpit", {
    target: "api",
    path,
    method,
    ...(body && Object.keys(body).length > 0 && method !== "GET"
      ? { json: body }
      : {}),
  });
}

export default function cockpit(rl: RunlinePluginAPI) {
  rl.setName("cockpit");
  rl.setVersion("0.1.0");
  rl.setCredential(cockpitCredential);

  rl.setConnectionSchema({
    url: {
      type: "string",
      required: true,
      description: "Cockpit CMS URL (e.g. https://cockpit.example.com)",
      env: "COCKPIT_URL",
    },
    accessToken: {
      type: "string",
      required: true,
      description: "Cockpit API token",
      env: "COCKPIT_ACCESS_TOKEN",
    },
  });

  // ── Collection ──────────────────────────────────────

  rl.registerAction("collection.create", {
    access: "write",
    description: "Create an entry in a collection",
    inputSchema: {
      collection: {
        type: "string",
        required: true,
        description: "Collection name",
      },
      data: {
        type: "object",
        required: true,
        description: "Entry data as key-value pairs",
      },
    },
    async execute(input, ctx) {
      const { collection, data } = input as {
        collection: string;
        data: Record<string, unknown>;
      };
      return apiRequest(ctx, "POST", `collections/save/${seg(collection)}`, {
        data,
      });
    },
  });

  rl.registerAction("collection.list", {
    access: "read",
    description: "List entries in a collection",
    inputSchema: {
      collection: {
        type: "string",
        required: true,
        description: "Collection name",
      },
      filter: { type: "object", required: false, description: "Filter object" },
      fields: {
        type: "array",
        required: false,
        description: "Array of field names to return",
      },
      sort: {
        type: "object",
        required: false,
        description: "Sort object (e.g. {fieldName: 1})",
      },
      limit: { type: "number", required: false, description: "Max results" },
      skip: { type: "number", required: false, description: "Number to skip" },
      populate: {
        type: "boolean",
        required: false,
        description: "Populate linked entries",
      },
      language: {
        type: "string",
        required: false,
        description: "Language code",
      },
    },
    async execute(input, ctx) {
      const {
        collection,
        filter,
        fields,
        sort,
        limit,
        skip,
        populate,
        language,
      } = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = { simple: true };
      if (filter) body.filter = filter;
      if (fields) {
        const f: Record<string, boolean> = { _id: false };
        for (const name of fields as string[]) f[name] = true;
        body.fields = f;
      }
      if (sort) body.sort = sort;
      if (limit) body.limit = limit;
      if (skip) body.skip = skip;
      if (populate) body.populate = populate;
      if (language) body.lang = language;
      return apiRequest(
        ctx,
        "POST",
        `collections/get/${seg(collection)}`,
        body,
      );
    },
  });

  rl.registerAction("collection.update", {
    access: "write",
    description: "Update an entry in a collection",
    inputSchema: {
      collection: {
        type: "string",
        required: true,
        description: "Collection name",
      },
      id: { type: "string", required: true, description: "Entry _id" },
      data: { type: "object", required: true, description: "Fields to update" },
    },
    async execute(input, ctx) {
      const { collection, id, data } = input as {
        collection: string;
        id: string;
        data: Record<string, unknown>;
      };
      return apiRequest(ctx, "POST", `collections/save/${seg(collection)}`, {
        data: { _id: id, ...data },
      });
    },
  });

  // ── Form ────────────────────────────────────────────

  rl.registerAction("form.submit", {
    access: "write",
    description: "Submit a form",
    inputSchema: {
      form: { type: "string", required: true, description: "Form name" },
      data: {
        type: "object",
        required: true,
        description: "Form data as key-value pairs",
      },
    },
    async execute(input, ctx) {
      const { form, data } = input as {
        form: string;
        data: Record<string, unknown>;
      };
      return apiRequest(ctx, "POST", `forms/submit/${seg(form)}`, {
        form: data,
      });
    },
  });

  // ── Singleton ───────────────────────────────────────

  rl.registerAction("singleton.get", {
    access: "read",
    description: "Get a singleton's data",
    inputSchema: {
      singleton: {
        type: "string",
        required: true,
        description: "Singleton name",
      },
    },
    async execute(input, ctx) {
      const { singleton } = input as { singleton: string };
      return apiRequest(ctx, "GET", `singletons/get/${seg(singleton)}`);
    },
  });
}
