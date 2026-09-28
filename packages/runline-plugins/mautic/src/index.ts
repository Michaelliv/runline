import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { mauticCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

async function req(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const data = (await credentialJson(ctx, mauticCredential, "mautic", {
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
  })) as Record<string, unknown>;
  if (data.errors) throw new Error("mautic: request failed (API errors)");
  return data;
}

async function pagAll(
  ctx: ActionContext,
  propertyName: string,
  path: string,
  qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  qs.limit = 30;
  qs.start = 0;
  let data: Record<string, unknown>;
  do {
    data = (await req(ctx, "GET", path, undefined, qs)) as Record<
      string,
      unknown
    >;
    const values = Object.values(
      (data[propertyName] ?? {}) as Record<string, unknown>,
    );
    all.push(...values);
    (qs.start as number) += qs.limit as number;
  } while (
    data.total !== undefined &&
    all.length < Number.parseInt(data.total as string, 10)
  );
  return all;
}

export default function mautic(rl: RunlinePluginAPI) {
  rl.setName("mautic");
  rl.setVersion("0.1.0");
  rl.setCredential(mauticCredential);

  rl.setConnectionSchema({
    url: {
      type: "string",
      required: true,
      description: "Mautic instance URL (e.g. https://mautic.example.com)",
      env: "MAUTIC_URL",
    },
    username: {
      type: "string",
      required: true,
      description: "Mautic username",
      env: "MAUTIC_USERNAME",
    },
    password: {
      type: "string",
      required: true,
      description: "Mautic password",
      env: "MAUTIC_PASSWORD",
    },
  });

  // ── Company ─────────────────────────────────────────

  rl.registerAction("company.create", {
    access: "write",
    description: "Create a company",
    inputSchema: {
      companyname: { type: "string", required: true },
      additionalFields: {
        type: "object",
        required: false,
        description:
          "companyemail, companyfax, companyindustry, companyphone, companywebsite, companyannual_revenue, companydescription, companynumber_of_employees, companyaddress1, companyaddress2, companycity, companystate, companycountry, companyzipcode, custom fields",
      },
    },
    async execute(input, ctx) {
      const { companyname, additionalFields } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { companyname };
      if (additionalFields) Object.assign(body, additionalFields);
      const data = (await req(ctx, "POST", "companies/new", body)) as Record<
        string,
        unknown
      >;
      return data.company;
    },
  });

  rl.registerAction("company.update", {
    access: "write",
    description: "Update a company",
    inputSchema: {
      companyId: { type: "string", required: true },
      updateFields: {
        type: "object",
        required: true,
        description: "Fields to update (same keys as create)",
      },
    },
    async execute(input, ctx) {
      const { companyId, updateFields } = input as Record<string, unknown>;
      const data = (await req(
        ctx,
        "PATCH",
        `companies/${seg(companyId)}/edit`,
        updateFields as Record<string, unknown>,
      )) as Record<string, unknown>;
      return data.company;
    },
  });

  rl.registerAction("company.get", {
    access: "read",
    description: "Get a company by ID",
    inputSchema: { companyId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await req(
        ctx,
        "GET",
        `companies/${seg((input as { companyId: string }).companyId)}`,
      )) as Record<string, unknown>;
      return data.company;
    },
  });

  rl.registerAction("company.list", {
    access: "read",
    description: "List companies",
    inputSchema: {
      limit: { type: "number", required: false },
      search: { type: "string", required: false },
      orderBy: { type: "string", required: false },
      orderByDir: {
        type: "string",
        required: false,
        description: "ASC or DESC",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.search) qs.search = p.search;
      if (p.orderBy) qs.orderBy = p.orderBy;
      if (p.orderByDir) qs.orderByDir = p.orderByDir;
      if (p.limit) {
        qs.limit = p.limit;
        qs.start = 0;
        const data = (await req(
          ctx,
          "GET",
          "companies",
          undefined,
          qs,
        )) as Record<string, unknown>;
        return Object.values((data.companies ?? {}) as Record<string, unknown>);
      }
      return pagAll(ctx, "companies", "companies", qs);
    },
  });

  rl.registerAction("company.delete", {
    access: "write",
    description: "Delete a company",
    inputSchema: { companyId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await req(
        ctx,
        "DELETE",
        `companies/${seg((input as { companyId: string }).companyId)}/delete`,
      )) as Record<string, unknown>;
      return data.company;
    },
  });

  // ── Contact ─────────────────────────────────────────

  rl.registerAction("contact.create", {
    access: "write",
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
      tags: {
        type: "string",
        required: false,
        description: "Comma-separated tags",
      },
      stage: { type: "string", required: false, description: "Stage ID" },
      owner: { type: "string", required: false, description: "Owner user ID" },
      ipAddress: { type: "string", required: false },
      additionalFields: {
        type: "object",
        required: false,
        description:
          "Custom fields, address fields (address1, address2, city, state, country, zipcode), social (facebook, twitter, linkedin, skype, instagram, foursquare)",
      },
    },
    async execute(input, ctx) {
      const { additionalFields, ...rest } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined && v !== null && v !== "") body[k] = v;
      }
      if (additionalFields) Object.assign(body, additionalFields);
      const data = (await req(ctx, "POST", "contacts/new", body)) as Record<
        string,
        unknown
      >;
      return data.contact;
    },
  });

  rl.registerAction("contact.update", {
    access: "write",
    description: "Update a contact",
    inputSchema: {
      contactId: { type: "string", required: true },
      updateFields: {
        type: "object",
        required: true,
        description:
          "Fields to update (email, firstname, lastname, company, position, title, phone, mobile, address fields, social fields, custom fields, tags, stage, owner, etc.)",
      },
    },
    async execute(input, ctx) {
      const { contactId, updateFields } = input as Record<string, unknown>;
      const data = (await req(
        ctx,
        "PATCH",
        `contacts/${seg(contactId)}/edit`,
        updateFields as Record<string, unknown>,
      )) as Record<string, unknown>;
      return data.contact;
    },
  });

  rl.registerAction("contact.get", {
    access: "read",
    description: "Get a contact by ID",
    inputSchema: { contactId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await req(
        ctx,
        "GET",
        `contacts/${seg((input as { contactId: string }).contactId)}`,
      )) as Record<string, unknown>;
      return data.contact;
    },
  });

  rl.registerAction("contact.list", {
    access: "read",
    description: "List contacts",
    inputSchema: {
      limit: { type: "number", required: false },
      search: { type: "string", required: false },
      orderBy: {
        type: "string",
        required: false,
        description: "Field to order by (snake_case)",
      },
      orderByDir: {
        type: "string",
        required: false,
        description: "ASC or DESC",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.search) qs.search = p.search;
      if (p.orderBy) qs.orderBy = p.orderBy;
      if (p.orderByDir) qs.orderByDir = p.orderByDir;
      if (p.limit) {
        qs.limit = p.limit;
        qs.start = 0;
        const data = (await req(
          ctx,
          "GET",
          "contacts",
          undefined,
          qs,
        )) as Record<string, unknown>;
        return Object.values((data.contacts ?? {}) as Record<string, unknown>);
      }
      return pagAll(ctx, "contacts", "contacts", qs);
    },
  });

  rl.registerAction("contact.delete", {
    access: "write",
    description: "Delete a contact",
    inputSchema: { contactId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await req(
        ctx,
        "DELETE",
        `contacts/${seg((input as { contactId: string }).contactId)}/delete`,
      )) as Record<string, unknown>;
      return data.contact;
    },
  });

  rl.registerAction("contact.sendEmail", {
    access: "write",
    description: "Send a campaign/template email to a contact",
    inputSchema: {
      contactId: { type: "string", required: true },
      emailId: {
        type: "string",
        required: true,
        description: "Campaign email ID (template type)",
      },
    },
    async execute(input, ctx) {
      const { contactId, emailId } = input as Record<string, unknown>;
      return req(
        ctx,
        "POST",
        `emails/${seg(emailId)}/contact/${seg(contactId)}/send`,
      );
    },
  });

  rl.registerAction("contact.editDoNotContact", {
    access: "write",
    description: "Add or remove a contact from the Do Not Contact list",
    inputSchema: {
      contactId: { type: "string", required: true },
      channel: {
        type: "string",
        required: true,
        description: "email, sms, etc.",
      },
      action: {
        type: "string",
        required: true,
        description: "'add' or 'remove'",
      },
      reason: {
        type: "number",
        required: false,
        description:
          "DNC reason (1=contacted, 2=unsubscribed, 3=bounced, 4=manual)",
      },
      comments: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { contactId, channel, action, reason, comments } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {};
      if (reason) body.reason = reason;
      if (comments) body.comments = comments;
      const data = (await req(
        ctx,
        "POST",
        `contacts/${seg(contactId)}/dnc/${seg(channel)}/${seg(action)}`,
        body,
      )) as Record<string, unknown>;
      return data.contact;
    },
  });

  rl.registerAction("contact.editPoints", {
    access: "write",
    description: "Add or subtract points from a contact",
    inputSchema: {
      contactId: { type: "string", required: true },
      action: {
        type: "string",
        required: true,
        description: "'add' or 'subtract'",
      },
      points: { type: "number", required: true },
    },
    async execute(input, ctx) {
      const { contactId, action, points } = input as Record<string, unknown>;
      const path = action === "add" ? "plus" : "minus";
      return req(
        ctx,
        "POST",
        `contacts/${seg(contactId)}/points/${seg(path)}/${seg(points)}`,
      );
    },
  });

  // ── Contact Segment ─────────────────────────────────

  rl.registerAction("contactSegment.add", {
    access: "write",
    description: "Add a contact to a segment",
    inputSchema: {
      segmentId: { type: "string", required: true },
      contactId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { segmentId, contactId } = input as Record<string, unknown>;
      return req(
        ctx,
        "POST",
        `segments/${seg(segmentId)}/contact/${seg(contactId)}/add`,
      );
    },
  });

  rl.registerAction("contactSegment.remove", {
    access: "write",
    description: "Remove a contact from a segment",
    inputSchema: {
      segmentId: { type: "string", required: true },
      contactId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { segmentId, contactId } = input as Record<string, unknown>;
      return req(
        ctx,
        "POST",
        `segments/${seg(segmentId)}/contact/${seg(contactId)}/remove`,
      );
    },
  });

  // ── Campaign Contact ────────────────────────────────

  rl.registerAction("campaignContact.add", {
    access: "write",
    description: "Add a contact to a campaign",
    inputSchema: {
      campaignId: { type: "string", required: true },
      contactId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { campaignId, contactId } = input as Record<string, unknown>;
      return req(
        ctx,
        "POST",
        `campaigns/${seg(campaignId)}/contact/${seg(contactId)}/add`,
      );
    },
  });

  rl.registerAction("campaignContact.remove", {
    access: "write",
    description: "Remove a contact from a campaign",
    inputSchema: {
      campaignId: { type: "string", required: true },
      contactId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { campaignId, contactId } = input as Record<string, unknown>;
      return req(
        ctx,
        "POST",
        `campaigns/${seg(campaignId)}/contact/${seg(contactId)}/remove`,
      );
    },
  });

  // ── Company Contact ─────────────────────────────────

  rl.registerAction("companyContact.add", {
    access: "write",
    description: "Add a contact to a company",
    inputSchema: {
      companyId: { type: "string", required: true },
      contactId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { companyId, contactId } = input as Record<string, unknown>;
      return req(
        ctx,
        "POST",
        `companies/${seg(companyId)}/contact/${seg(contactId)}/add`,
      );
    },
  });

  rl.registerAction("companyContact.remove", {
    access: "write",
    description: "Remove a contact from a company",
    inputSchema: {
      companyId: { type: "string", required: true },
      contactId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { companyId, contactId } = input as Record<string, unknown>;
      return req(
        ctx,
        "POST",
        `companies/${seg(companyId)}/contact/${seg(contactId)}/remove`,
      );
    },
  });

  // ── Segment Email ───────────────────────────────────

  rl.registerAction("segmentEmail.send", {
    access: "write",
    description: "Send a segment (list) email",
    inputSchema: {
      emailId: {
        type: "string",
        required: true,
        description: "Segment email ID",
      },
    },
    async execute(input, ctx) {
      return req(
        ctx,
        "POST",
        `emails/${seg((input as { emailId: string }).emailId)}/send`,
      );
    },
  });
}
