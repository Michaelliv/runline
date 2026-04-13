import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  apiKey: string, method: string, endpoint: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  const dc = apiKey.split("-").pop();
  const url = new URL(`https://${dc}.api.mailchimp.com/3.0${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const opts: RequestInit = {
    method,
    headers: { Authorization: `Basic ${btoa(`anystring:${apiKey}`)}`, Accept: "application/json" },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") {
    (opts.headers as Record<string, string>)["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`Mailchimp API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

export default function mailchimp(rl: RunlinePluginAPI) {
  rl.setName("mailchimp");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "Mailchimp API key (includes datacenter suffix, e.g. xxx-us21)", env: "MAILCHIMP_API_KEY" },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.apiKey as string;

  // ── Member ──────────────────────────────────────────

  rl.registerAction("member.create", {
    description: "Add a member to a list/audience",
    inputSchema: {
      listId: { type: "string", required: true, description: "List/audience ID" },
      email: { type: "string", required: true },
      status: { type: "string", required: true, description: "subscribed, unsubscribed, cleaned, pending, transactional" },
      mergeFields: { type: "object", required: false, description: "Merge fields as {TAG: value}" },
      tags: { type: "array", required: false, description: "Array of tag name strings" },
      emailType: { type: "string", required: false, description: "html or text" },
      language: { type: "string", required: false },
      vip: { type: "boolean", required: false },
      location: { type: "object", required: false, description: "{latitude: number, longitude: number}" },
      interests: { type: "object", required: false, description: "Interest group IDs as {id: boolean}" },
      ipSignup: { type: "string", required: false },
      ipOpt: { type: "string", required: false },
      timestampSignup: { type: "string", required: false, description: "ISO datetime" },
      timestampOpt: { type: "string", required: false, description: "ISO datetime" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        email_address: p.email,
        status: p.status,
      };
      if (p.mergeFields) body.merge_fields = p.mergeFields;
      if (p.tags) body.tags = p.tags;
      if (p.emailType) body.email_type = p.emailType;
      if (p.language) body.language = p.language;
      if (p.vip !== undefined) body.vip = p.vip;
      if (p.location) body.location = p.location;
      if (p.interests) body.interests = p.interests;
      if (p.ipSignup) body.ip_signup = p.ipSignup;
      if (p.ipOpt) body.ip_opt = p.ipOpt;
      if (p.timestampSignup) body.timestamp_signup = p.timestampSignup;
      if (p.timestampOpt) body.timestamp_opt = p.timestampOpt;
      return apiRequest(key(ctx), "POST", `/lists/${p.listId}/members`, body);
    },
  });

  rl.registerAction("member.get", {
    description: "Get a list member by email (used directly as subscriber hash)",
    inputSchema: {
      listId: { type: "string", required: true },
      email: { type: "string", required: true, description: "Email address (Mailchimp accepts email or MD5 hash)" },
      fields: { type: "string", required: false, description: "Comma-separated fields to return" },
      excludeFields: { type: "string", required: false, description: "Comma-separated fields to exclude" },
    },
    async execute(input, ctx) {
      const { listId, email, fields, excludeFields } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (fields) qs.fields = fields;
      if (excludeFields) qs.exclude_fields = excludeFields;
      return apiRequest(key(ctx), "GET", `/lists/${listId}/members/${email}`, undefined, qs);
    },
  });

  rl.registerAction("member.list", {
    description: "List members in a list/audience",
    inputSchema: {
      listId: { type: "string", required: true },
      count: { type: "number", required: false, description: "Max results (default 500)" },
      offset: { type: "number", required: false },
      status: { type: "string", required: false, description: "subscribed, unsubscribed, cleaned, pending, transactional" },
      emailType: { type: "string", required: false, description: "html or text" },
      sinceLastChanged: { type: "string", required: false, description: "ISO datetime" },
      beforeLastChanged: { type: "string", required: false, description: "ISO datetime" },
      beforeTimestampOpt: { type: "string", required: false, description: "ISO datetime" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.count) qs.count = p.count;
      if (p.offset) qs.offset = p.offset;
      if (p.status) qs.status = p.status;
      if (p.emailType) qs.email_type = p.emailType;
      if (p.sinceLastChanged) qs.since_last_changed = p.sinceLastChanged;
      if (p.beforeLastChanged) qs.before_last_changed = p.beforeLastChanged;
      if (p.beforeTimestampOpt) qs.before_timestamp_opt = p.beforeTimestampOpt;
      const data = (await apiRequest(key(ctx), "GET", `/lists/${p.listId}/members`, undefined, qs)) as Record<string, unknown>;
      return data.members;
    },
  });

  rl.registerAction("member.update", {
    description: "Update a list member (PUT — full replace)",
    inputSchema: {
      listId: { type: "string", required: true },
      email: { type: "string", required: true, description: "Email address (used as subscriber hash)" },
      status: { type: "string", required: false },
      mergeFields: { type: "object", required: false },
      interests: { type: "object", required: false },
      emailType: { type: "string", required: false },
      language: { type: "string", required: false },
      vip: { type: "boolean", required: false },
      location: { type: "object", required: false },
      ipSignup: { type: "string", required: false },
      ipOpt: { type: "string", required: false },
      timestampSignup: { type: "string", required: false },
      timestampOpt: { type: "string", required: false },
      skipMergeValidation: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { email_address: p.email };
      const qs: Record<string, unknown> = {};
      if (p.status) body.status = p.status;
      if (p.mergeFields) body.merge_fields = p.mergeFields;
      if (p.interests) body.interests = p.interests;
      if (p.emailType) body.email_type = p.emailType;
      if (p.language) body.language = p.language;
      if (p.vip !== undefined) body.vip = p.vip;
      if (p.location) body.location = p.location;
      if (p.ipSignup) body.ip_signup = p.ipSignup;
      if (p.ipOpt) body.ip_opt = p.ipOpt;
      if (p.timestampSignup) body.timestamp_signup = p.timestampSignup;
      if (p.timestampOpt) body.timestamp_opt = p.timestampOpt;
      if (p.skipMergeValidation) qs.skip_merge_validation = p.skipMergeValidation;
      return apiRequest(key(ctx), "PUT", `/lists/${p.listId}/members/${p.email}`, body, Object.keys(qs).length > 0 ? qs : undefined);
    },
  });

  rl.registerAction("member.delete", {
    description: "Permanently delete a list member",
    inputSchema: {
      listId: { type: "string", required: true },
      email: { type: "string", required: true, description: "Email address" },
    },
    async execute(input, ctx) {
      const { listId, email } = input as Record<string, unknown>;
      await apiRequest(key(ctx), "POST", `/lists/${listId}/members/${email}/actions/delete-permanent`);
      return { success: true };
    },
  });

  // ── Member Tag ──────────────────────────────────────

  rl.registerAction("memberTag.add", {
    description: "Add tags to a member",
    inputSchema: {
      listId: { type: "string", required: true },
      email: { type: "string", required: true },
      tags: { type: "array", required: true, description: "Array of tag names" },
      isSyncing: { type: "boolean", required: false, description: "If true, automations based on tags won't fire" },
    },
    async execute(input, ctx) {
      const { listId, email, tags, isSyncing } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { tags: (tags as string[]).map((t) => ({ name: t, status: "active" })) };
      if (isSyncing) body.is_syncing = isSyncing;
      await apiRequest(key(ctx), "POST", `/lists/${listId}/members/${email}/tags`, body);
      return { success: true };
    },
  });

  rl.registerAction("memberTag.remove", {
    description: "Remove tags from a member",
    inputSchema: {
      listId: { type: "string", required: true },
      email: { type: "string", required: true },
      tags: { type: "array", required: true, description: "Array of tag names" },
      isSyncing: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const { listId, email, tags, isSyncing } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { tags: (tags as string[]).map((t) => ({ name: t, status: "inactive" })) };
      if (isSyncing) body.is_syncing = isSyncing;
      await apiRequest(key(ctx), "POST", `/lists/${listId}/members/${email}/tags`, body);
      return { success: true };
    },
  });

  // ── List Group ──────────────────────────────────────

  rl.registerAction("listGroup.list", {
    description: "List interests in a specific interest category for a list",
    inputSchema: {
      listId: { type: "string", required: true },
      categoryId: { type: "string", required: true, description: "Interest category ID" },
      count: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { listId, categoryId, count } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (count) qs.count = count;
      const data = (await apiRequest(key(ctx), "GET", `/lists/${listId}/interest-categories/${categoryId}/interests`, undefined, qs)) as Record<string, unknown>;
      return data.interests;
    },
  });

  // ── Campaign ────────────────────────────────────────

  rl.registerAction("campaign.get", {
    description: "Get a campaign",
    inputSchema: { campaignId: { type: "string", required: true } },
    async execute(input, ctx) { return apiRequest(key(ctx), "GET", `/campaigns/${(input as { campaignId: string }).campaignId}`); },
  });

  rl.registerAction("campaign.list", {
    description: "List campaigns",
    inputSchema: {
      count: { type: "number", required: false, description: "Max results" },
      status: { type: "string", required: false, description: "save, sending, sent, schedule" },
      listId: { type: "string", required: false, description: "Filter by list ID" },
      fields: { type: "array", required: false, description: "Array of field names to return" },
      sinceCreateTime: { type: "string", required: false, description: "ISO datetime" },
      beforeCreateTime: { type: "string", required: false, description: "ISO datetime" },
      sinceSendTime: { type: "string", required: false, description: "ISO datetime" },
      beforeSendTime: { type: "string", required: false, description: "ISO datetime" },
      sortField: { type: "string", required: false, description: "create_time or send_time" },
      sortDirection: { type: "string", required: false, description: "ASC or DESC" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.count) qs.count = p.count;
      if (p.status) qs.status = p.status;
      if (p.listId) qs.list_id = p.listId;
      if (p.fields && Array.isArray(p.fields)) qs.fields = (p.fields as string[]).join(",");
      else qs.fields = "campaigns.id,campaigns.status,campaigns.tracking,campaigns.settings.from_name,campaigns.settings.title,campaigns.settings.reply_to";
      if (p.sinceCreateTime) qs.since_create_time = p.sinceCreateTime;
      if (p.beforeCreateTime) qs.before_create_time = p.beforeCreateTime;
      if (p.sinceSendTime) qs.since_send_time = p.sinceSendTime;
      if (p.beforeSendTime) qs.before_send_time = p.beforeSendTime;
      if (p.sortField) qs.sort_field = p.sortField;
      if (p.sortDirection) qs.sort_dir = p.sortDirection;
      const data = (await apiRequest(key(ctx), "GET", "/campaigns", undefined, qs)) as Record<string, unknown>;
      return data.campaigns;
    },
  });

  rl.registerAction("campaign.send", {
    description: "Send a campaign",
    inputSchema: { campaignId: { type: "string", required: true } },
    async execute(input, ctx) {
      await apiRequest(key(ctx), "POST", `/campaigns/${(input as { campaignId: string }).campaignId}/actions/send`);
      return { success: true };
    },
  });

  rl.registerAction("campaign.replicate", {
    description: "Replicate a campaign",
    inputSchema: { campaignId: { type: "string", required: true } },
    async execute(input, ctx) { return apiRequest(key(ctx), "POST", `/campaigns/${(input as { campaignId: string }).campaignId}/actions/replicate`); },
  });

  rl.registerAction("campaign.resend", {
    description: "Create a resend to non-openers",
    inputSchema: { campaignId: { type: "string", required: true } },
    async execute(input, ctx) { return apiRequest(key(ctx), "POST", `/campaigns/${(input as { campaignId: string }).campaignId}/actions/create-resend`); },
  });

  rl.registerAction("campaign.delete", {
    description: "Delete a campaign",
    inputSchema: { campaignId: { type: "string", required: true } },
    async execute(input, ctx) {
      await apiRequest(key(ctx), "DELETE", `/campaigns/${(input as { campaignId: string }).campaignId}`);
      return { success: true };
    },
  });
}
