import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { agileCrmCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: unknown,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, agileCrmCredential, "agileCrm", {
    target: "api",
    path,
    method,
    query,
    ...(body && method !== "GET" && method !== "DELETE" ? { json: body } : {}),
  });
}

async function paginateAll(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
  limit?: number,
  sendCursorInBody?: boolean,
): Promise<unknown[]> {
  const results: unknown[] = [];
  const _body = { ...body };
  const _qs = { ...qs };

  while (true) {
    const data = (await apiRequest(
      ctx,
      method,
      path,
      Object.keys(_body).length > 0 ? _body : undefined,
      Object.keys(_qs).length > 0 ? _qs : undefined,
    )) as Array<Record<string, unknown>>;

    if (!Array.isArray(data) || data.length === 0) break;
    results.push(...data);

    if (limit && results.length >= limit) return results.slice(0, limit);

    const last = data[data.length - 1];
    if (!last.cursor) break;

    if (sendCursorInBody) {
      _body.cursor = last.cursor;
    } else {
      _qs.cursor = last.cursor;
    }
  }

  return results;
}

export default function agileCrm(rl: RunlinePluginAPI) {
  rl.setName("agileCrm");
  rl.setVersion("0.1.0");
  rl.setCredential(agileCrmCredential);

  rl.setConnectionSchema({
    subdomain: {
      type: "string",
      required: true,
      description:
        "Agile CRM subdomain (e.g. 'mycompany' for mycompany.agilecrm.com)",
      env: "AGILE_CRM_SUBDOMAIN",
    },
    email: {
      type: "string",
      required: true,
      description: "Account email address",
      env: "AGILE_CRM_EMAIL",
    },
    apiKey: {
      type: "string",
      required: true,
      description: "Agile CRM REST API key",
      env: "AGILE_CRM_API_KEY",
    },
  });

  // ── Contact ─────────────────────────────────────────

  rl.registerAction("contact.create", {
    access: "write",
    description: "Create a new contact",
    inputSchema: {
      firstName: { type: "string", required: false, description: "First name" },
      lastName: { type: "string", required: false, description: "Last name" },
      email: { type: "string", required: false, description: "Email address" },
      company: { type: "string", required: false, description: "Company name" },
      title: { type: "string", required: false, description: "Job title" },
      phone: { type: "string", required: false, description: "Phone number" },
      tags: {
        type: "array",
        required: false,
        description: "Array of tag strings",
      },
      starValue: {
        type: "number",
        required: false,
        description: "Star rating (0-5)",
      },
    },
    async execute(input, ctx) {
      const {
        firstName,
        lastName,
        email,
        company,
        title,
        phone,
        tags,
        starValue,
      } = input as Record<string, unknown>;

      const properties: Array<Record<string, unknown>> = [];
      if (firstName)
        properties.push({
          type: "SYSTEM",
          name: "first_name",
          value: firstName,
        });
      if (lastName)
        properties.push({ type: "SYSTEM", name: "last_name", value: lastName });
      if (email)
        properties.push({ type: "SYSTEM", name: "email", value: email });
      if (company)
        properties.push({ type: "SYSTEM", name: "company", value: company });
      if (title)
        properties.push({ type: "SYSTEM", name: "title", value: title });
      if (phone)
        properties.push({ type: "SYSTEM", name: "phone", value: phone });

      const body: Record<string, unknown> = { properties };
      if (tags) body.tags = tags;
      if (starValue !== undefined) body.star_value = starValue;

      return apiRequest(ctx, "POST", "api/contacts", body);
    },
  });

  rl.registerAction("contact.get", {
    access: "read",
    description: "Get a contact by ID",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
    },
    async execute(input, ctx) {
      const { contactId } = input as { contactId: string };
      return apiRequest(ctx, "GET", `api/contacts/${pathSegment(contactId)}`);
    },
  });

  rl.registerAction("contact.list", {
    access: "read",
    description: "List/filter contacts",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      const body = {
        page_size: limit ?? 100,
        filterJson: JSON.stringify({ contact_type: "PERSON" }),
      };
      return paginateAll(
        ctx,
        "POST",
        "api/filters/filter/dynamic-filter",
        body,
        undefined,
        limit,
        true,
      );
    },
  });

  rl.registerAction("contact.update", {
    access: "write",
    description: "Update a contact's properties",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
      firstName: { type: "string", required: false, description: "First name" },
      lastName: { type: "string", required: false, description: "Last name" },
      email: { type: "string", required: false, description: "Email address" },
      company: { type: "string", required: false, description: "Company name" },
      tags: {
        type: "array",
        required: false,
        description: "Array of tag strings",
      },
      starValue: {
        type: "number",
        required: false,
        description: "Star rating (0-5)",
      },
      leadScore: { type: "number", required: false, description: "Lead score" },
    },
    async execute(input, ctx) {
      const {
        contactId,
        firstName,
        lastName,
        email: contactEmail,
        company,
        tags,
        starValue,
        leadScore,
      } = input as Record<string, unknown>;

      const properties: Array<Record<string, unknown>> = [];
      if (firstName)
        properties.push({
          type: "SYSTEM",
          name: "first_name",
          value: firstName,
        });
      if (lastName)
        properties.push({ type: "SYSTEM", name: "last_name", value: lastName });
      if (contactEmail)
        properties.push({ type: "SYSTEM", name: "email", value: contactEmail });
      if (company)
        properties.push({ type: "SYSTEM", name: "company", value: company });

      let result: unknown;
      if (properties.length > 0) {
        result = await apiRequest(ctx, "PUT", "api/contacts/edit-properties", {
          id: contactId,
          properties,
        });
      }
      if (leadScore !== undefined) {
        result = await apiRequest(ctx, "PUT", "api/contacts/edit/lead-score", {
          id: contactId,
          lead_score: leadScore,
        });
      }
      if (tags) {
        result = await apiRequest(ctx, "PUT", "api/contacts/edit/tags", {
          id: contactId,
          tags,
        });
      }
      if (starValue !== undefined) {
        result = await apiRequest(ctx, "PUT", "api/contacts/edit/add-star", {
          id: contactId,
          star_value: starValue,
        });
      }

      return result ?? { success: true };
    },
  });

  rl.registerAction("contact.delete", {
    access: "write",
    description: "Delete a contact",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
    },
    async execute(input, ctx) {
      const { contactId } = input as { contactId: string };
      return apiRequest(
        ctx,
        "DELETE",
        `api/contacts/${pathSegment(contactId)}`,
      );
    },
  });

  // ── Company ─────────────────────────────────────────

  rl.registerAction("company.create", {
    access: "write",
    description: "Create a new company",
    inputSchema: {
      name: { type: "string", required: true, description: "Company name" },
      email: { type: "string", required: false, description: "Company email" },
      phone: { type: "string", required: false, description: "Phone number" },
      tags: {
        type: "array",
        required: false,
        description: "Array of tag strings",
      },
    },
    async execute(input, ctx) {
      const {
        name,
        email: companyEmail,
        phone,
        tags,
      } = input as Record<string, unknown>;

      const properties: Array<Record<string, unknown>> = [];
      if (name) properties.push({ type: "SYSTEM", name: "name", value: name });
      if (companyEmail)
        properties.push({ type: "SYSTEM", name: "email", value: companyEmail });
      if (phone)
        properties.push({ type: "SYSTEM", name: "phone", value: phone });

      const body: Record<string, unknown> = { type: "COMPANY", properties };
      if (tags) body.tags = tags;

      return apiRequest(ctx, "POST", "api/contacts", body);
    },
  });

  rl.registerAction("company.get", {
    access: "read",
    description: "Get a company by ID",
    inputSchema: {
      companyId: { type: "string", required: true, description: "Company ID" },
    },
    async execute(input, ctx) {
      const { companyId } = input as { companyId: string };
      return apiRequest(ctx, "GET", `api/contacts/${pathSegment(companyId)}`);
    },
  });

  rl.registerAction("company.list", {
    access: "read",
    description: "List/filter companies",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      const body = {
        page_size: limit ?? 100,
        filterJson: JSON.stringify({ contact_type: "COMPANY" }),
      };
      return paginateAll(
        ctx,
        "POST",
        "api/filters/filter/dynamic-filter",
        body,
        undefined,
        limit,
        true,
      );
    },
  });

  rl.registerAction("company.update", {
    access: "write",
    description: "Update a company's properties",
    inputSchema: {
      companyId: { type: "string", required: true, description: "Company ID" },
      name: { type: "string", required: false, description: "Company name" },
      email: { type: "string", required: false, description: "Company email" },
      phone: { type: "string", required: false, description: "Phone number" },
      tags: {
        type: "array",
        required: false,
        description: "Array of tag strings",
      },
      starValue: {
        type: "number",
        required: false,
        description: "Star rating (0-5)",
      },
    },
    async execute(input, ctx) {
      const {
        companyId,
        name,
        email: companyEmail,
        phone,
        tags,
        starValue,
      } = input as Record<string, unknown>;

      const properties: Array<Record<string, unknown>> = [];
      if (name) properties.push({ type: "SYSTEM", name: "name", value: name });
      if (companyEmail)
        properties.push({ type: "SYSTEM", name: "email", value: companyEmail });
      if (phone)
        properties.push({ type: "SYSTEM", name: "phone", value: phone });

      let result: unknown;
      if (properties.length > 0) {
        result = await apiRequest(ctx, "PUT", "api/contacts/edit-properties", {
          id: companyId,
          properties,
        });
      }
      if (tags) {
        result = await apiRequest(ctx, "PUT", "api/contacts/edit/tags", {
          id: companyId,
          tags,
        });
      }
      if (starValue !== undefined) {
        result = await apiRequest(ctx, "PUT", "api/contacts/edit/add-star", {
          id: companyId,
          star_value: starValue,
        });
      }

      return result ?? { success: true };
    },
  });

  rl.registerAction("company.delete", {
    access: "write",
    description: "Delete a company",
    inputSchema: {
      companyId: { type: "string", required: true, description: "Company ID" },
    },
    async execute(input, ctx) {
      const { companyId } = input as { companyId: string };
      return apiRequest(
        ctx,
        "DELETE",
        `api/contacts/${pathSegment(companyId)}`,
      );
    },
  });

  // ── Deal ────────────────────────────────────────────

  rl.registerAction("deal.create", {
    access: "write",
    description: "Create a new deal",
    inputSchema: {
      name: { type: "string", required: true, description: "Deal name" },
      expectedValue: {
        type: "number",
        required: true,
        description: "Expected value",
      },
      probability: {
        type: "number",
        required: true,
        description: "Probability (0-100)",
      },
      milestone: {
        type: "string",
        required: true,
        description: "Milestone/stage name",
      },
      closeDate: {
        type: "string",
        required: true,
        description: "Close date (ISO string)",
      },
      contactIds: {
        type: "array",
        required: false,
        description: "Array of contact IDs",
      },
    },
    async execute(input, ctx) {
      const {
        name,
        expectedValue,
        probability,
        milestone,
        closeDate,
        contactIds,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        name,
        expected_value: expectedValue,
        probability,
        milestone,
        close_date: new Date(closeDate as string).getTime(),
      };
      if (contactIds) body.contactIds = contactIds;
      return apiRequest(ctx, "POST", "api/opportunity", body);
    },
  });

  rl.registerAction("deal.get", {
    access: "read",
    description: "Get a deal by ID",
    inputSchema: {
      dealId: { type: "string", required: true, description: "Deal ID" },
    },
    async execute(input, ctx) {
      const { dealId } = input as { dealId: string };
      return apiRequest(ctx, "GET", `api/opportunity/${pathSegment(dealId)}`);
    },
  });

  rl.registerAction("deal.list", {
    access: "read",
    description: "List all deals",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      return paginateAll(
        ctx,
        "GET",
        "api/opportunity",
        undefined,
        { page_size: limit ?? 100 },
        limit,
      );
    },
  });

  rl.registerAction("deal.update", {
    access: "write",
    description: "Update a deal",
    inputSchema: {
      dealId: { type: "string", required: true, description: "Deal ID" },
      name: { type: "string", required: false, description: "Deal name" },
      expectedValue: {
        type: "number",
        required: false,
        description: "Expected value",
      },
      probability: {
        type: "number",
        required: false,
        description: "Probability (0-100)",
      },
      contactIds: {
        type: "array",
        required: false,
        description: "Array of contact IDs",
      },
    },
    async execute(input, ctx) {
      const { dealId, name, expectedValue, probability, contactIds } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = { id: dealId };
      if (name) body.name = name;
      if (expectedValue !== undefined) body.expected_value = expectedValue;
      if (probability !== undefined) body.probability = probability;
      if (contactIds) body.contactIds = contactIds;
      return apiRequest(ctx, "PUT", "api/opportunity/partial-update", body);
    },
  });

  rl.registerAction("deal.delete", {
    access: "write",
    description: "Delete a deal",
    inputSchema: {
      dealId: { type: "string", required: true, description: "Deal ID" },
    },
    async execute(input, ctx) {
      const { dealId } = input as { dealId: string };
      return apiRequest(
        ctx,
        "DELETE",
        `api/opportunity/${pathSegment(dealId)}`,
      );
    },
  });
}
