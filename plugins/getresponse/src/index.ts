import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.getresponse.com/v3";

async function apiRequest(
  apiKey: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      "X-Auth-Token": `api-key ${apiKey}`,
      "Content-Type": "application/json",
    },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`GetResponse API error ${res.status}: ${await res.text()}`);
  if (res.status === 204 || res.status === 202) return { success: true };
  return res.json();
}

export default function getresponse(rl: RunlinePluginAPI) {
  rl.setName("getresponse");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "GetResponse API key", env: "GETRESPONSE_API_KEY" },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.apiKey as string;

  rl.registerAction("contact.create", {
    description: "Create a contact",
    inputSchema: {
      email: { type: "string", required: true, description: "Email address" },
      campaignId: { type: "string", required: true, description: "Campaign ID to subscribe to" },
      name: { type: "string", required: false, description: "Contact name" },
      dayOfCycle: { type: "number", required: false, description: "Day of autoresponder cycle" },
      tags: { type: "array", required: false, description: "Array of {tagId} objects" },
      customFieldValues: { type: "array", required: false, description: "Custom fields as [{customFieldId, value: [values]}]" },
    },
    async execute(input, ctx) {
      const { email, campaignId, name, dayOfCycle, tags, customFieldValues } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { email, campaign: { campaignId } };
      if (name) body.name = name;
      if (dayOfCycle !== undefined) body.dayOfCycle = dayOfCycle;
      if (tags) body.tags = tags;
      if (customFieldValues) body.customFieldValues = customFieldValues;
      await apiRequest(key(ctx), "POST", "/contacts", body);
      return { success: true };
    },
  });

  rl.registerAction("contact.get", {
    description: "Get a contact by ID",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
      fields: { type: "string", required: false, description: "Comma-separated fields to return" },
    },
    async execute(input, ctx) {
      const { contactId, fields } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (fields) qs.fields = fields;
      return apiRequest(key(ctx), "GET", `/contacts/${contactId}`, undefined, qs);
    },
  });

  rl.registerAction("contact.list", {
    description: "List contacts",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results (default: 100)" },
      email: { type: "string", required: false, description: "Filter by email" },
      name: { type: "string", required: false, description: "Filter by name" },
      campaignId: { type: "string", required: false, description: "Filter by campaign ID" },
      sortBy: { type: "string", required: false, description: "Sort field: email, name, createdOn" },
      sortOrder: { type: "string", required: false, description: "ASC or DESC" },
    },
    async execute(input, ctx) {
      const { limit, email, name, campaignId, sortBy, sortOrder } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.perPage = limit;
      if (email) qs["query[email]"] = email;
      if (name) qs["query[name]"] = name;
      if (campaignId) qs["query[campaignId]"] = campaignId;
      if (sortBy) qs[`sort[${sortBy}]`] = sortOrder ?? "ASC";
      return apiRequest(key(ctx), "GET", "/contacts", undefined, qs);
    },
  });

  rl.registerAction("contact.update", {
    description: "Update a contact",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
      name: { type: "string", required: false, description: "New name" },
      campaignId: { type: "string", required: false, description: "Move to campaign" },
      tags: { type: "array", required: false, description: "Tags as [{tagId}]" },
      customFieldValues: { type: "array", required: false, description: "Custom fields as [{customFieldId, value: [values]}]" },
    },
    async execute(input, ctx) {
      const { contactId, name, campaignId, tags, customFieldValues } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (campaignId) body.campaign = { campaignId };
      if (tags) body.tags = tags;
      if (customFieldValues) body.customFieldValues = customFieldValues;
      return apiRequest(key(ctx), "POST", `/contacts/${contactId}`, body);
    },
  });

  rl.registerAction("contact.delete", {
    description: "Delete a contact",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
      messageId: { type: "string", required: false, description: "ID of removal confirmation message" },
      ipAddress: { type: "string", required: false, description: "IP address for GDPR consent" },
    },
    async execute(input, ctx) {
      const { contactId, messageId, ipAddress } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (messageId) qs.messageId = messageId;
      if (ipAddress) qs.ipAddress = ipAddress;
      await apiRequest(key(ctx), "DELETE", `/contacts/${contactId}`, undefined, qs);
      return { success: true };
    },
  });
}
