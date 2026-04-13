import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  baseUrl: string, username: string, password: string,
  method: string, endpoint: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${baseUrl}/api${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const opts: RequestInit = {
    method,
    headers: { Authorization: `Basic ${btoa(`${username}:${password}`)}`, "Content-Type": "application/json" },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`Mautic API error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (data.errors) throw new Error(`Mautic API error: ${JSON.stringify(data.errors)}`);
  return data;
}

async function paginateAll(
  baseUrl: string, username: string, password: string,
  propertyName: string, endpoint: string, qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  qs.limit = 30;
  qs.start = 0;
  let data: Record<string, unknown>;
  do {
    data = (await apiRequest(baseUrl, username, password, "GET", endpoint, undefined, qs)) as Record<string, unknown>;
    const values = Object.values((data[propertyName] ?? {}) as Record<string, unknown>);
    all.push(...values);
    (qs.start as number) += qs.limit as number;
  } while (data.total !== undefined && all.length < Number.parseInt(data.total as string, 10));
  return all;
}

export default function mautic(rl: RunlinePluginAPI) {
  rl.setName("mautic");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    url: { type: "string", required: true, description: "Mautic instance URL (e.g. https://mautic.example.com)", env: "MAUTIC_URL" },
    username: { type: "string", required: true, description: "Mautic username", env: "MAUTIC_USERNAME" },
    password: { type: "string", required: true, description: "Mautic password", env: "MAUTIC_PASSWORD" },
  });

  const conn = (ctx: { connection: { config: Record<string, unknown> } }) => ({
    baseUrl: (ctx.connection.config.url as string).replace(/\/$/, ""),
    username: ctx.connection.config.username as string,
    password: ctx.connection.config.password as string,
  });

  const req = (ctx: { connection: { config: Record<string, unknown> } }, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>) => {
    const c = conn(ctx);
    return apiRequest(c.baseUrl, c.username, c.password, method, endpoint, body, qs);
  };

  const pagAll = (ctx: { connection: { config: Record<string, unknown> } }, prop: string, endpoint: string, qs?: Record<string, unknown>) => {
    const c = conn(ctx);
    return paginateAll(c.baseUrl, c.username, c.password, prop, endpoint, qs);
  };

  // ── Company ─────────────────────────────────────────

  rl.registerAction("company.create", {
    description: "Create a company",
    inputSchema: {
      companyname: { type: "string", required: true },
      additionalFields: { type: "object", required: false, description: "companyemail, companyfax, companyindustry, companyphone, companywebsite, companyannual_revenue, companydescription, companynumber_of_employees, companyaddress1, companyaddress2, companycity, companystate, companycountry, companyzipcode, custom fields" },
    },
    async execute(input, ctx) {
      const { companyname, additionalFields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { companyname };
      if (additionalFields) Object.assign(body, additionalFields);
      const data = (await req(ctx, "POST", "/companies/new", body)) as Record<string, unknown>;
      return data.company;
    },
  });

  rl.registerAction("company.update", {
    description: "Update a company",
    inputSchema: {
      companyId: { type: "string", required: true },
      updateFields: { type: "object", required: true, description: "Fields to update (same keys as create)" },
    },
    async execute(input, ctx) {
      const { companyId, updateFields } = input as Record<string, unknown>;
      const data = (await req(ctx, "PATCH", `/companies/${companyId}/edit`, updateFields as Record<string, unknown>)) as Record<string, unknown>;
      return data.company;
    },
  });

  rl.registerAction("company.get", {
    description: "Get a company by ID",
    inputSchema: { companyId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await req(ctx, "GET", `/companies/${(input as { companyId: string }).companyId}`)) as Record<string, unknown>;
      return data.company;
    },
  });

  rl.registerAction("company.list", {
    description: "List companies",
    inputSchema: { limit: { type: "number", required: false }, search: { type: "string", required: false }, orderBy: { type: "string", required: false }, orderByDir: { type: "string", required: false, description: "ASC or DESC" } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.search) qs.search = p.search;
      if (p.orderBy) qs.orderBy = p.orderBy;
      if (p.orderByDir) qs.orderByDir = p.orderByDir;
      if (p.limit) {
        qs.limit = p.limit; qs.start = 0;
        const data = (await req(ctx, "GET", "/companies", undefined, qs)) as Record<string, unknown>;
        return Object.values((data.companies ?? {}) as Record<string, unknown>);
      }
      return pagAll(ctx, "companies", "/companies", qs);
    },
  });

  rl.registerAction("company.delete", {
    description: "Delete a company",
    inputSchema: { companyId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await req(ctx, "DELETE", `/companies/${(input as { companyId: string }).companyId}/delete`)) as Record<string, unknown>;
      return data.company;
    },
  });

  // ── Contact ─────────────────────────────────────────

  rl.registerAction("contact.create", {
    description: "Create a contact",
    inputSchema: {
      email: { type: "string", required: false },
      firstname: { type: "string", required: false },
      lastname: { type: "string", required: false },
      company: { type: "string", required: false },
      position: { type: "string", required: false },
      title: { type: "string", required: false },
      phone: { type: "string", required: false },
      mobile: { type: "string", required: false },
      website: { type: "string", required: false },
      tags: { type: "string", required: false, description: "Comma-separated tags" },
      stage: { type: "string", required: false, description: "Stage ID" },
      owner: { type: "string", required: false, description: "Owner user ID" },
      ipAddress: { type: "string", required: false },
      additionalFields: { type: "object", required: false, description: "Custom fields, address fields (address1, address2, city, state, country, zipcode), social (facebook, twitter, linkedin, skype, instagram, foursquare)" },
    },
    async execute(input, ctx) {
      const { additionalFields, ...rest } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) { if (v !== undefined && v !== null && v !== "") body[k] = v; }
      if (additionalFields) Object.assign(body, additionalFields);
      const data = (await req(ctx, "POST", "/contacts/new", body)) as Record<string, unknown>;
      return data.contact;
    },
  });

  rl.registerAction("contact.update", {
    description: "Update a contact",
    inputSchema: {
      contactId: { type: "string", required: true },
      updateFields: { type: "object", required: true, description: "Fields to update (email, firstname, lastname, company, position, title, phone, mobile, address fields, social fields, custom fields, tags, stage, owner, etc.)" },
    },
    async execute(input, ctx) {
      const { contactId, updateFields } = input as Record<string, unknown>;
      const data = (await req(ctx, "PATCH", `/contacts/${contactId}/edit`, updateFields as Record<string, unknown>)) as Record<string, unknown>;
      return data.contact;
    },
  });

  rl.registerAction("contact.get", {
    description: "Get a contact by ID",
    inputSchema: { contactId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await req(ctx, "GET", `/contacts/${(input as { contactId: string }).contactId}`)) as Record<string, unknown>;
      return data.contact;
    },
  });

  rl.registerAction("contact.list", {
    description: "List contacts",
    inputSchema: {
      limit: { type: "number", required: false },
      search: { type: "string", required: false },
      orderBy: { type: "string", required: false, description: "Field to order by (snake_case)" },
      orderByDir: { type: "string", required: false, description: "ASC or DESC" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.search) qs.search = p.search;
      if (p.orderBy) qs.orderBy = p.orderBy;
      if (p.orderByDir) qs.orderByDir = p.orderByDir;
      if (p.limit) {
        qs.limit = p.limit; qs.start = 0;
        const data = (await req(ctx, "GET", "/contacts", undefined, qs)) as Record<string, unknown>;
        return Object.values((data.contacts ?? {}) as Record<string, unknown>);
      }
      return pagAll(ctx, "contacts", "/contacts", qs);
    },
  });

  rl.registerAction("contact.delete", {
    description: "Delete a contact",
    inputSchema: { contactId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await req(ctx, "DELETE", `/contacts/${(input as { contactId: string }).contactId}/delete`)) as Record<string, unknown>;
      return data.contact;
    },
  });

  rl.registerAction("contact.sendEmail", {
    description: "Send a campaign/template email to a contact",
    inputSchema: {
      contactId: { type: "string", required: true },
      emailId: { type: "string", required: true, description: "Campaign email ID (template type)" },
    },
    async execute(input, ctx) {
      const { contactId, emailId } = input as Record<string, unknown>;
      return req(ctx, "POST", `/emails/${emailId}/contact/${contactId}/send`);
    },
  });

  rl.registerAction("contact.editDoNotContact", {
    description: "Add or remove a contact from the Do Not Contact list",
    inputSchema: {
      contactId: { type: "string", required: true },
      channel: { type: "string", required: true, description: "email, sms, etc." },
      action: { type: "string", required: true, description: "'add' or 'remove'" },
      reason: { type: "number", required: false, description: "DNC reason (1=contacted, 2=unsubscribed, 3=bounced, 4=manual)" },
      comments: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { contactId, channel, action, reason, comments } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (reason) body.reason = reason;
      if (comments) body.comments = comments;
      const data = (await req(ctx, "POST", `/contacts/${contactId}/dnc/${channel}/${action}`, body)) as Record<string, unknown>;
      return data.contact;
    },
  });

  rl.registerAction("contact.editPoints", {
    description: "Add or subtract points from a contact",
    inputSchema: {
      contactId: { type: "string", required: true },
      action: { type: "string", required: true, description: "'add' or 'subtract'" },
      points: { type: "number", required: true },
    },
    async execute(input, ctx) {
      const { contactId, action, points } = input as Record<string, unknown>;
      const path = action === "add" ? "plus" : "minus";
      return req(ctx, "POST", `/contacts/${contactId}/points/${path}/${points}`);
    },
  });

  // ── Contact Segment ─────────────────────────────────

  rl.registerAction("contactSegment.add", {
    description: "Add a contact to a segment",
    inputSchema: { segmentId: { type: "string", required: true }, contactId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { segmentId, contactId } = input as Record<string, unknown>;
      return req(ctx, "POST", `/segments/${segmentId}/contact/${contactId}/add`);
    },
  });

  rl.registerAction("contactSegment.remove", {
    description: "Remove a contact from a segment",
    inputSchema: { segmentId: { type: "string", required: true }, contactId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { segmentId, contactId } = input as Record<string, unknown>;
      return req(ctx, "POST", `/segments/${segmentId}/contact/${contactId}/remove`);
    },
  });

  // ── Campaign Contact ────────────────────────────────

  rl.registerAction("campaignContact.add", {
    description: "Add a contact to a campaign",
    inputSchema: { campaignId: { type: "string", required: true }, contactId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { campaignId, contactId } = input as Record<string, unknown>;
      return req(ctx, "POST", `/campaigns/${campaignId}/contact/${contactId}/add`);
    },
  });

  rl.registerAction("campaignContact.remove", {
    description: "Remove a contact from a campaign",
    inputSchema: { campaignId: { type: "string", required: true }, contactId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { campaignId, contactId } = input as Record<string, unknown>;
      return req(ctx, "POST", `/campaigns/${campaignId}/contact/${contactId}/remove`);
    },
  });

  // ── Company Contact ─────────────────────────────────

  rl.registerAction("companyContact.add", {
    description: "Add a contact to a company",
    inputSchema: { companyId: { type: "string", required: true }, contactId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { companyId, contactId } = input as Record<string, unknown>;
      return req(ctx, "POST", `/companies/${companyId}/contact/${contactId}/add`);
    },
  });

  rl.registerAction("companyContact.remove", {
    description: "Remove a contact from a company",
    inputSchema: { companyId: { type: "string", required: true }, contactId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { companyId, contactId } = input as Record<string, unknown>;
      return req(ctx, "POST", `/companies/${companyId}/contact/${contactId}/remove`);
    },
  });

  // ── Segment Email ───────────────────────────────────

  rl.registerAction("segmentEmail.send", {
    description: "Send a segment (list) email",
    inputSchema: { emailId: { type: "string", required: true, description: "Segment email ID" } },
    async execute(input, ctx) {
      return req(ctx, "POST", `/emails/${(input as { emailId: string }).emailId}/send`);
    },
  });
}
