import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { getresponseCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const json =
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
      ? body
      : undefined;
  return credentialJson(ctx, getresponseCredential, "getresponse", {
    target: "api",
    path,
    method,
    query: qs,
    ...(json !== undefined ? { json } : {}),
  });
}

export default function getresponse(rl: RunlinePluginAPI) {
  rl.setName("getresponse");
  rl.setVersion("0.1.0");
  rl.setCredential(getresponseCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "GetResponse API key",
      env: "GETRESPONSE_API_KEY",
    },
  });

  rl.registerAction("contact.create", {
    access: "write",
    description: "Create a contact",
    inputSchema: {
      email: { type: "string", required: true, description: "Email address" },
      campaignId: {
        type: "string",
        required: true,
        description: "Campaign ID to subscribe to",
      },
      name: { type: "string", required: false, description: "Contact name" },
      dayOfCycle: {
        type: "number",
        required: false,
        description: "Day of autoresponder cycle",
      },
      tags: {
        type: "array",
        required: false,
        description: "Array of {tagId} objects",
      },
      customFieldValues: {
        type: "array",
        required: false,
        description: "Custom fields as [{customFieldId, value: [values]}]",
      },
    },
    async execute(input, ctx) {
      const { email, campaignId, name, dayOfCycle, tags, customFieldValues } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = { email, campaign: { campaignId } };
      if (name) body.name = name;
      if (dayOfCycle !== undefined) body.dayOfCycle = dayOfCycle;
      if (tags) body.tags = tags;
      if (customFieldValues) body.customFieldValues = customFieldValues;
      await apiRequest(ctx, "POST", "contacts", body);
      return { success: true };
    },
  });

  rl.registerAction("contact.get", {
    access: "read",
    description: "Get a contact by ID",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
      fields: {
        type: "string",
        required: false,
        description: "Comma-separated fields to return",
      },
    },
    async execute(input, ctx) {
      const { contactId, fields } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (fields) qs.fields = fields;
      return apiRequest(
        ctx,
        "GET",
        `contacts/${pathSegment(contactId)}`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("contact.list", {
    access: "read",
    description: "List contacts",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results (default: 100)",
      },
      email: {
        type: "string",
        required: false,
        description: "Filter by email",
      },
      name: { type: "string", required: false, description: "Filter by name" },
      campaignId: {
        type: "string",
        required: false,
        description: "Filter by campaign ID",
      },
      sortBy: {
        type: "string",
        required: false,
        description: "Sort field: email, name, createdOn",
      },
      sortOrder: {
        type: "string",
        required: false,
        description: "ASC or DESC",
      },
    },
    async execute(input, ctx) {
      const { limit, email, name, campaignId, sortBy, sortOrder } = (input ??
        {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.perPage = limit;
      if (email) qs["query[email]"] = email;
      if (name) qs["query[name]"] = name;
      if (campaignId) qs["query[campaignId]"] = campaignId;
      if (sortBy) qs[`sort[${sortBy}]`] = sortOrder ?? "ASC";
      return apiRequest(ctx, "GET", "contacts", undefined, qs);
    },
  });

  rl.registerAction("contact.update", {
    access: "write",
    description: "Update a contact",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
      name: { type: "string", required: false, description: "New name" },
      campaignId: {
        type: "string",
        required: false,
        description: "Move to campaign",
      },
      tags: {
        type: "array",
        required: false,
        description: "Tags as [{tagId}]",
      },
      customFieldValues: {
        type: "array",
        required: false,
        description: "Custom fields as [{customFieldId, value: [values]}]",
      },
    },
    async execute(input, ctx) {
      const { contactId, name, campaignId, tags, customFieldValues } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (campaignId) body.campaign = { campaignId };
      if (tags) body.tags = tags;
      if (customFieldValues) body.customFieldValues = customFieldValues;
      return apiRequest(
        ctx,
        "POST",
        `contacts/${pathSegment(contactId)}`,
        body,
      );
    },
  });

  rl.registerAction("contact.delete", {
    access: "write",
    description: "Delete a contact",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
      messageId: {
        type: "string",
        required: false,
        description: "ID of removal confirmation message",
      },
      ipAddress: {
        type: "string",
        required: false,
        description: "IP address for GDPR consent",
      },
    },
    async execute(input, ctx) {
      const { contactId, messageId, ipAddress } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (messageId) qs.messageId = messageId;
      if (ipAddress) qs.ipAddress = ipAddress;
      await apiRequest(
        ctx,
        "DELETE",
        `contacts/${pathSegment(contactId)}`,
        undefined,
        qs,
      );
      return { success: true };
    },
  });
}
