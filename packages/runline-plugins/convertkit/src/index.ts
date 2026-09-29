import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { convertkitCredential } from "./credentials.js";

/** Every write carries a JSON body, the one the API secret travels in. */
function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, convertkitCredential, "convertkit", {
    target: "api",
    path,
    method,
    query,
    ...(method === "POST" || method === "PUT" ? { json: body ?? {} } : {}),
  });
}

export default function convertkit(rl: RunlinePluginAPI) {
  rl.setName("convertkit");
  rl.setVersion("0.1.0");
  rl.setCredential(convertkitCredential);

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
    access: "write",
    description: "Create a custom field",
    inputSchema: {
      label: { type: "string", required: true, description: "Field label" },
    },
    async execute(input, ctx) {
      const { label } = input as { label: string };
      return apiRequest(ctx, "POST", "custom_fields", { label });
    },
  });

  rl.registerAction("customField.get", {
    access: "read",
    description: "Get a custom field",
    inputSchema: {
      id: { type: "string", required: true, description: "Field ID" },
    },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `custom_fields/${pathSegment((input as { id: string }).id)}`,
      );
    },
  });

  rl.registerAction("customField.list", {
    access: "read",
    description: "List custom fields",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const data = (await apiRequest(ctx, "GET", "custom_fields")) as Record<
        string,
        unknown
      >;
      const fields = (data.custom_fields as unknown[]) ?? [];
      const { limit } = (input ?? {}) as { limit?: number };
      if (limit) return fields.slice(0, limit);
      return fields;
    },
  });

  rl.registerAction("customField.update", {
    access: "write",
    description: "Update a custom field label",
    inputSchema: {
      id: { type: "string", required: true, description: "Field ID" },
      label: { type: "string", required: true, description: "New label" },
    },
    async execute(input, ctx) {
      const { id, label } = input as { id: string; label: string };
      await apiRequest(ctx, "PUT", `custom_fields/${pathSegment(id)}`, {
        label,
      });
      return { success: true };
    },
  });

  rl.registerAction("customField.delete", {
    access: "write",
    description: "Delete a custom field",
    inputSchema: {
      id: { type: "string", required: true, description: "Field ID" },
    },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "DELETE",
        `custom_fields/${pathSegment((input as { id: string }).id)}`,
      );
    },
  });

  // ── Form ────────────────────────────────────────────

  rl.registerAction("form.addSubscriber", {
    access: "write",
    description: "Add a subscriber to a form",
    inputSchema: {
      formId: { type: "string", required: true, description: "Form ID" },
      email: {
        type: "string",
        required: true,
        description: "Subscriber email",
      },
      firstName: { type: "string", required: false, description: "First name" },
      tags: { type: "array", required: false, description: "Tag IDs to add" },
      fields: {
        type: "object",
        required: false,
        description: "Custom field key-value pairs",
      },
    },
    async execute(input, ctx) {
      const { formId, email, firstName, tags, fields } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { email };
      if (firstName) body.first_name = firstName;
      if (tags) body.tags = tags;
      if (fields) body.fields = fields;
      const data = (await apiRequest(
        ctx,
        "POST",
        `forms/${pathSegment(formId)}/subscribe`,
        body,
      )) as Record<string, unknown>;
      return data.subscription;
    },
  });

  rl.registerAction("form.list", {
    access: "read",
    description: "List forms",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const data = (await apiRequest(ctx, "GET", "forms")) as Record<
        string,
        unknown
      >;
      const forms = (data.forms as unknown[]) ?? [];
      const { limit } = (input ?? {}) as { limit?: number };
      if (limit) return forms.slice(0, limit);
      return forms;
    },
  });

  rl.registerAction("form.getSubscriptions", {
    access: "read",
    description: "List subscriptions for a form",
    inputSchema: {
      formId: { type: "string", required: true, description: "Form ID" },
      subscriberState: {
        type: "string",
        required: false,
        description: "Filter: active, cancelled",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { formId, subscriberState, limit } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (subscriberState) qs.subscriber_state = subscriberState;
      const data = (await apiRequest(
        ctx,
        "GET",
        `forms/${pathSegment(formId)}/subscriptions`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      const subs = (data.subscriptions as unknown[]) ?? [];
      if (limit) return subs.slice(0, limit as number);
      return subs;
    },
  });

  // ── Sequence ────────────────────────────────────────

  rl.registerAction("sequence.addSubscriber", {
    access: "write",
    description: "Add a subscriber to a sequence",
    inputSchema: {
      sequenceId: {
        type: "string",
        required: true,
        description: "Sequence ID",
      },
      email: {
        type: "string",
        required: true,
        description: "Subscriber email",
      },
      firstName: { type: "string", required: false, description: "First name" },
      tags: { type: "array", required: false, description: "Tag IDs" },
      fields: { type: "object", required: false, description: "Custom fields" },
    },
    async execute(input, ctx) {
      const { sequenceId, email, firstName, tags, fields } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { email };
      if (firstName) body.first_name = firstName;
      if (tags) body.tags = tags;
      if (fields) body.fields = fields;
      const data = (await apiRequest(
        ctx,
        "POST",
        `sequences/${pathSegment(sequenceId)}/subscribe`,
        body,
      )) as Record<string, unknown>;
      return data.subscription;
    },
  });

  rl.registerAction("sequence.list", {
    access: "read",
    description: "List sequences",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const data = (await apiRequest(ctx, "GET", "sequences")) as Record<
        string,
        unknown
      >;
      const courses = (data.courses as unknown[]) ?? [];
      const { limit } = (input ?? {}) as { limit?: number };
      if (limit) return courses.slice(0, limit);
      return courses;
    },
  });

  rl.registerAction("sequence.getSubscriptions", {
    access: "read",
    description: "List subscriptions for a sequence",
    inputSchema: {
      sequenceId: {
        type: "string",
        required: true,
        description: "Sequence ID",
      },
      subscriberState: {
        type: "string",
        required: false,
        description: "Filter: active, cancelled",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { sequenceId, subscriberState, limit } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (subscriberState) qs.subscriber_state = subscriberState;
      const data = (await apiRequest(
        ctx,
        "GET",
        `sequences/${pathSegment(sequenceId)}/subscriptions`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      const subs = (data.subscriptions as unknown[]) ?? [];
      if (limit) return subs.slice(0, limit as number);
      return subs;
    },
  });

  // ── Tag ─────────────────────────────────────────────

  rl.registerAction("tag.create", {
    access: "write",
    description: "Create one or more tags",
    inputSchema: {
      names: {
        type: "string",
        required: true,
        description: "Comma-separated tag names",
      },
    },
    async execute(input, ctx) {
      const { names } = input as { names: string };
      const tag = names.split(",").map((n) => ({ name: n.trim() }));
      return apiRequest(ctx, "POST", "tags", { tag });
    },
  });

  rl.registerAction("tag.list", {
    access: "read",
    description: "List tags",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const data = (await apiRequest(ctx, "GET", "tags")) as Record<
        string,
        unknown
      >;
      const tags = (data.tags as unknown[]) ?? [];
      const { limit } = (input ?? {}) as { limit?: number };
      if (limit) return tags.slice(0, limit);
      return tags;
    },
  });

  // ── Tag Subscriber ──────────────────────────────────

  rl.registerAction("tagSubscriber.add", {
    access: "write",
    description: "Tag a subscriber",
    inputSchema: {
      tagId: { type: "string", required: true, description: "Tag ID" },
      email: {
        type: "string",
        required: true,
        description: "Subscriber email",
      },
      firstName: { type: "string", required: false, description: "First name" },
      fields: { type: "object", required: false, description: "Custom fields" },
    },
    async execute(input, ctx) {
      const { tagId, email, firstName, fields } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { email };
      if (firstName) body.first_name = firstName;
      if (fields) body.fields = fields;
      const data = (await apiRequest(
        ctx,
        "POST",
        `tags/${pathSegment(tagId)}/subscribe`,
        body,
      )) as Record<string, unknown>;
      return data.subscription;
    },
  });

  rl.registerAction("tagSubscriber.list", {
    access: "read",
    description: "List subscribers for a tag",
    inputSchema: {
      tagId: { type: "string", required: true, description: "Tag ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { tagId, limit } = input as { tagId: string; limit?: number };
      const data = (await apiRequest(
        ctx,
        "GET",
        `tags/${pathSegment(tagId)}/subscriptions`,
      )) as Record<string, unknown>;
      const subs = (data.subscriptions as unknown[]) ?? [];
      if (limit) return subs.slice(0, limit);
      return subs;
    },
  });

  rl.registerAction("tagSubscriber.remove", {
    access: "write",
    description: "Remove a tag from a subscriber",
    inputSchema: {
      tagId: { type: "string", required: true, description: "Tag ID" },
      email: {
        type: "string",
        required: true,
        description: "Subscriber email",
      },
    },
    async execute(input, ctx) {
      const { tagId, email } = input as { tagId: string; email: string };
      return apiRequest(ctx, "POST", `tags/${pathSegment(tagId)}/unsubscribe`, {
        email,
      });
    },
  });
}
