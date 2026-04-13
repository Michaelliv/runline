import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  baseUrl: string,
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${baseUrl}/api${endpoint}`);
  url.searchParams.set("token", token);

  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET") {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cockpit API error ${res.status}: ${text}`);
  }
  return res.json();
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    baseUrl: (ctx.connection.config.url as string).replace(/\/$/, ""),
    token: ctx.connection.config.accessToken as string,
  };
}

export default function cockpit(rl: RunlinePluginAPI) {
  rl.setName("cockpit");
  rl.setVersion("0.1.0");

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
    description: "Create an entry in a collection",
    inputSchema: {
      collection: { type: "string", required: true, description: "Collection name" },
      data: { type: "object", required: true, description: "Entry data as key-value pairs" },
    },
    async execute(input, ctx) {
      const { collection, data } = input as { collection: string; data: Record<string, unknown> };
      const { baseUrl, token } = getConn(ctx);
      return apiRequest(baseUrl, token, "POST", `/collections/save/${collection}`, { data });
    },
  });

  rl.registerAction("collection.list", {
    description: "List entries in a collection",
    inputSchema: {
      collection: { type: "string", required: true, description: "Collection name" },
      filter: { type: "object", required: false, description: "Filter object" },
      fields: { type: "array", required: false, description: "Array of field names to return" },
      sort: { type: "object", required: false, description: "Sort object (e.g. {fieldName: 1})" },
      limit: { type: "number", required: false, description: "Max results" },
      skip: { type: "number", required: false, description: "Number to skip" },
      populate: { type: "boolean", required: false, description: "Populate linked entries" },
      language: { type: "string", required: false, description: "Language code" },
    },
    async execute(input, ctx) {
      const { collection, filter, fields, sort, limit, skip, populate, language } =
        (input ?? {}) as Record<string, unknown>;
      const { baseUrl, token } = getConn(ctx);
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
      return apiRequest(baseUrl, token, "POST", `/collections/get/${collection}`, body);
    },
  });

  rl.registerAction("collection.update", {
    description: "Update an entry in a collection",
    inputSchema: {
      collection: { type: "string", required: true, description: "Collection name" },
      id: { type: "string", required: true, description: "Entry _id" },
      data: { type: "object", required: true, description: "Fields to update" },
    },
    async execute(input, ctx) {
      const { collection, id, data } = input as {
        collection: string;
        id: string;
        data: Record<string, unknown>;
      };
      const { baseUrl, token } = getConn(ctx);
      return apiRequest(baseUrl, token, "POST", `/collections/save/${collection}`, {
        data: { _id: id, ...data },
      });
    },
  });

  // ── Form ────────────────────────────────────────────

  rl.registerAction("form.submit", {
    description: "Submit a form",
    inputSchema: {
      form: { type: "string", required: true, description: "Form name" },
      data: { type: "object", required: true, description: "Form data as key-value pairs" },
    },
    async execute(input, ctx) {
      const { form, data } = input as { form: string; data: Record<string, unknown> };
      const { baseUrl, token } = getConn(ctx);
      return apiRequest(baseUrl, token, "POST", `/forms/submit/${form}`, { form: data });
    },
  });

  // ── Singleton ───────────────────────────────────────

  rl.registerAction("singleton.get", {
    description: "Get a singleton's data",
    inputSchema: {
      singleton: { type: "string", required: true, description: "Singleton name" },
    },
    async execute(input, ctx) {
      const { singleton } = input as { singleton: string };
      const { baseUrl, token } = getConn(ctx);
      return apiRequest(baseUrl, token, "GET", `/singletons/get/${singleton}`);
    },
  });
}
