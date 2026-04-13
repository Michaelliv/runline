import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.convertkit.com/v3";

async function apiRequest(
  apiSecret: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  // GET requests use api_secret as query param
  if (method === "GET" || method === "DELETE") {
    url.searchParams.set("api_secret", apiSecret);
  }
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (method === "POST" || method === "PUT") {
    const b = { api_secret: apiSecret, ...body };
    opts.body = JSON.stringify(b);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`ConvertKit API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

function getSecret(ctx: { connection: { config: Record<string, unknown> } }): string {
  return ctx.connection.config.apiSecret as string;
}

export default function convertkit(rl: RunlinePluginAPI) {
  rl.setName("convertkit");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiSecret: {
      type: "string",
      required: true,
      description: "ConvertKit API secret",
      env: "CONVERTKIT_API_SECRET",
    },
  });

  // ── Custom Field ────────────────────────────────────

  rl.registerAction("customField.create", {
    description: "Create a custom field",
    inputSchema: {
      label: { type: "string", required: true, description: "Field label" },
    },
    async execute(input, ctx) {
      const { label } = input as { label: string };
      return apiRequest(getSecret(ctx), "POST", "/custom_fields", { label });
    },
  });

  rl.registerAction("customField.get", {
    description: "Get a custom field",
    inputSchema: { id: { type: "string", required: true, description: "Field ID" } },
    async execute(input, ctx) {
      return apiRequest(getSecret(ctx), "GET", `/custom_fields/${(input as { id: string }).id}`);
    },
  });

  rl.registerAction("customField.list", {
    description: "List custom fields",
    inputSchema: { limit: { type: "number", required: false, description: "Max results" } },
    async execute(input, ctx) {
      const data = (await apiRequest(getSecret(ctx), "GET", "/custom_fields")) as Record<string, unknown>;
      const fields = (data.custom_fields as unknown[]) ?? [];
      const { limit } = (input ?? {}) as { limit?: number };
      if (limit) return fields.slice(0, limit);
      return fields;
    },
  });

  rl.registerAction("customField.update", {
    description: "Update a custom field label",
    inputSchema: {
      id: { type: "string", required: true, description: "Field ID" },
      label: { type: "string", required: true, description: "New label" },
    },
    async execute(input, ctx) {
      const { id, label } = input as { id: string; label: string };
      await apiRequest(getSecret(ctx), "PUT", `/custom_fields/${id}`, { label });
      return { success: true };
    },
  });

  rl.registerAction("customField.delete", {
    description: "Delete a custom field",
    inputSchema: { id: { type: "string", required: true, description: "Field ID" } },
    async execute(input, ctx) {
      return apiRequest(getSecret(ctx), "DELETE", `/custom_fields/${(input as { id: string }).id}`);
    },
  });

  // ── Form ────────────────────────────────────────────

  rl.registerAction("form.addSubscriber", {
    description: "Add a subscriber to a form",
    inputSchema: {
      formId: { type: "string", required: true, description: "Form ID" },
      email: { type: "string", required: true, description: "Subscriber email" },
      firstName: { type: "string", required: false, description: "First name" },
      tags: { type: "array", required: false, description: "Tag IDs to add" },
      fields: { type: "object", required: false, description: "Custom field key-value pairs" },
    },
    async execute(input, ctx) {
      const { formId, email, firstName, tags, fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { email };
      if (firstName) body.first_name = firstName;
      if (tags) body.tags = tags;
      if (fields) body.fields = fields;
      const data = (await apiRequest(getSecret(ctx), "POST", `/forms/${formId}/subscribe`, body)) as Record<string, unknown>;
      return data.subscription;
    },
  });

  rl.registerAction("form.list", {
    description: "List forms",
    inputSchema: { limit: { type: "number", required: false, description: "Max results" } },
    async execute(input, ctx) {
      const data = (await apiRequest(getSecret(ctx), "GET", "/forms")) as Record<string, unknown>;
      const forms = (data.forms as unknown[]) ?? [];
      const { limit } = (input ?? {}) as { limit?: number };
      if (limit) return forms.slice(0, limit);
      return forms;
    },
  });

  rl.registerAction("form.getSubscriptions", {
    description: "List subscriptions for a form",
    inputSchema: {
      formId: { type: "string", required: true, description: "Form ID" },
      subscriberState: { type: "string", required: false, description: "Filter: active, cancelled" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { formId, subscriberState, limit } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (subscriberState) qs.subscriber_state = subscriberState;
      const data = (await apiRequest(getSecret(ctx), "GET", `/forms/${formId}/subscriptions`, undefined, qs)) as Record<string, unknown>;
      const subs = (data.subscriptions as unknown[]) ?? [];
      if (limit) return subs.slice(0, limit as number);
      return subs;
    },
  });

  // ── Sequence ────────────────────────────────────────

  rl.registerAction("sequence.addSubscriber", {
    description: "Add a subscriber to a sequence",
    inputSchema: {
      sequenceId: { type: "string", required: true, description: "Sequence ID" },
      email: { type: "string", required: true, description: "Subscriber email" },
      firstName: { type: "string", required: false, description: "First name" },
      tags: { type: "array", required: false, description: "Tag IDs" },
      fields: { type: "object", required: false, description: "Custom fields" },
    },
    async execute(input, ctx) {
      const { sequenceId, email, firstName, tags, fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { email };
      if (firstName) body.first_name = firstName;
      if (tags) body.tags = tags;
      if (fields) body.fields = fields;
      const data = (await apiRequest(getSecret(ctx), "POST", `/sequences/${sequenceId}/subscribe`, body)) as Record<string, unknown>;
      return data.subscription;
    },
  });

  rl.registerAction("sequence.list", {
    description: "List sequences",
    inputSchema: { limit: { type: "number", required: false, description: "Max results" } },
    async execute(input, ctx) {
      const data = (await apiRequest(getSecret(ctx), "GET", "/sequences")) as Record<string, unknown>;
      const courses = (data.courses as unknown[]) ?? [];
      const { limit } = (input ?? {}) as { limit?: number };
      if (limit) return courses.slice(0, limit);
      return courses;
    },
  });

  rl.registerAction("sequence.getSubscriptions", {
    description: "List subscriptions for a sequence",
    inputSchema: {
      sequenceId: { type: "string", required: true, description: "Sequence ID" },
      subscriberState: { type: "string", required: false, description: "Filter: active, cancelled" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { sequenceId, subscriberState, limit } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (subscriberState) qs.subscriber_state = subscriberState;
      const data = (await apiRequest(getSecret(ctx), "GET", `/sequences/${sequenceId}/subscriptions`, undefined, qs)) as Record<string, unknown>;
      const subs = (data.subscriptions as unknown[]) ?? [];
      if (limit) return subs.slice(0, limit as number);
      return subs;
    },
  });

  // ── Tag ─────────────────────────────────────────────

  rl.registerAction("tag.create", {
    description: "Create one or more tags",
    inputSchema: {
      names: { type: "string", required: true, description: "Comma-separated tag names" },
    },
    async execute(input, ctx) {
      const { names } = input as { names: string };
      const tag = names.split(",").map((n) => ({ name: n.trim() }));
      return apiRequest(getSecret(ctx), "POST", "/tags", { tag });
    },
  });

  rl.registerAction("tag.list", {
    description: "List tags",
    inputSchema: { limit: { type: "number", required: false, description: "Max results" } },
    async execute(input, ctx) {
      const data = (await apiRequest(getSecret(ctx), "GET", "/tags")) as Record<string, unknown>;
      const tags = (data.tags as unknown[]) ?? [];
      const { limit } = (input ?? {}) as { limit?: number };
      if (limit) return tags.slice(0, limit);
      return tags;
    },
  });

  // ── Tag Subscriber ──────────────────────────────────

  rl.registerAction("tagSubscriber.add", {
    description: "Tag a subscriber",
    inputSchema: {
      tagId: { type: "string", required: true, description: "Tag ID" },
      email: { type: "string", required: true, description: "Subscriber email" },
      firstName: { type: "string", required: false, description: "First name" },
      fields: { type: "object", required: false, description: "Custom fields" },
    },
    async execute(input, ctx) {
      const { tagId, email, firstName, fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { email };
      if (firstName) body.first_name = firstName;
      if (fields) body.fields = fields;
      const data = (await apiRequest(getSecret(ctx), "POST", `/tags/${tagId}/subscribe`, body)) as Record<string, unknown>;
      return data.subscription;
    },
  });

  rl.registerAction("tagSubscriber.list", {
    description: "List subscribers for a tag",
    inputSchema: {
      tagId: { type: "string", required: true, description: "Tag ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { tagId, limit } = input as { tagId: string; limit?: number };
      const data = (await apiRequest(getSecret(ctx), "GET", `/tags/${tagId}/subscriptions`)) as Record<string, unknown>;
      const subs = (data.subscriptions as unknown[]) ?? [];
      if (limit) return subs.slice(0, limit);
      return subs;
    },
  });

  rl.registerAction("tagSubscriber.remove", {
    description: "Remove a tag from a subscriber",
    inputSchema: {
      tagId: { type: "string", required: true, description: "Tag ID" },
      email: { type: "string", required: true, description: "Subscriber email" },
    },
    async execute(input, ctx) {
      const { tagId, email } = input as { tagId: string; email: string };
      return apiRequest(getSecret(ctx), "POST", `/tags/${tagId}/unsubscribe`, { email });
    },
  });
}
