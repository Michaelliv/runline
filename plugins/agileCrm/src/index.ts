import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  subdomain: string,
  email: string,
  apiKey: string,
  method: string,
  endpoint: string,
  body?: unknown,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`https://${subdomain}.agilecrm.com/dev/${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const opts: RequestInit = {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${email}:${apiKey}`)}`,
    },
  };
  if (body && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Agile CRM API error ${res.status}: ${text}`);
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") return { success: true };
  return res.json();
}

async function paginateAll(
  subdomain: string,
  email: string,
  apiKey: string,
  method: string,
  endpoint: string,
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
      subdomain,
      email,
      apiKey,
      method,
      endpoint,
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

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    subdomain: ctx.connection.config.subdomain as string,
    email: ctx.connection.config.email as string,
    apiKey: ctx.connection.config.apiKey as string,
  };
}

export default function agileCrm(rl: RunlinePluginAPI) {
  rl.setName("agileCrm");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    subdomain: {
      type: "string",
      required: true,
      description: "Agile CRM subdomain (e.g. 'mycompany' for mycompany.agilecrm.com)",
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
    description: "Create a new contact",
    inputSchema: {
      firstName: { type: "string", required: false, description: "First name" },
      lastName: { type: "string", required: false, description: "Last name" },
      email: { type: "string", required: false, description: "Email address" },
      company: { type: "string", required: false, description: "Company name" },
      title: { type: "string", required: false, description: "Job title" },
      phone: { type: "string", required: false, description: "Phone number" },
      tags: { type: "array", required: false, description: "Array of tag strings" },
      starValue: { type: "number", required: false, description: "Star rating (0-5)" },
    },
    async execute(input, ctx) {
      const { firstName, lastName, email, company, title, phone, tags, starValue } = input as Record<
        string,
        unknown
      >;
      const { subdomain, email: userEmail, apiKey } = getConn(ctx);

      const properties: Array<Record<string, unknown>> = [];
      if (firstName) properties.push({ type: "SYSTEM", name: "first_name", value: firstName });
      if (lastName) properties.push({ type: "SYSTEM", name: "last_name", value: lastName });
      if (email) properties.push({ type: "SYSTEM", name: "email", value: email });
      if (company) properties.push({ type: "SYSTEM", name: "company", value: company });
      if (title) properties.push({ type: "SYSTEM", name: "title", value: title });
      if (phone) properties.push({ type: "SYSTEM", name: "phone", value: phone });

      const body: Record<string, unknown> = { properties };
      if (tags) body.tags = tags;
      if (starValue !== undefined) body.star_value = starValue;

      return apiRequest(subdomain, userEmail, apiKey, "POST", "api/contacts", body);
    },
  });

  rl.registerAction("contact.get", {
    description: "Get a contact by ID",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
    },
    async execute(input, ctx) {
      const { contactId } = input as { contactId: string };
      const { subdomain, email, apiKey } = getConn(ctx);
      return apiRequest(subdomain, email, apiKey, "GET", `api/contacts/${contactId}`);
    },
  });

  rl.registerAction("contact.list", {
    description: "List/filter contacts",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      const { subdomain, email, apiKey } = getConn(ctx);
      const body = {
        page_size: limit ?? 100,
        filterJson: JSON.stringify({ contact_type: "PERSON" }),
      };
      return paginateAll(
        subdomain,
        email,
        apiKey,
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
    description: "Update a contact's properties",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
      firstName: { type: "string", required: false, description: "First name" },
      lastName: { type: "string", required: false, description: "Last name" },
      email: { type: "string", required: false, description: "Email address" },
      company: { type: "string", required: false, description: "Company name" },
      tags: { type: "array", required: false, description: "Array of tag strings" },
      starValue: { type: "number", required: false, description: "Star rating (0-5)" },
      leadScore: { type: "number", required: false, description: "Lead score" },
    },
    async execute(input, ctx) {
      const { contactId, firstName, lastName, email: contactEmail, company, tags, starValue, leadScore } =
        input as Record<string, unknown>;
      const { subdomain, email, apiKey } = getConn(ctx);
      const baseUri = `https://${subdomain}.agilecrm.com/dev/`;

      const properties: Array<Record<string, unknown>> = [];
      if (firstName) properties.push({ type: "SYSTEM", name: "first_name", value: firstName });
      if (lastName) properties.push({ type: "SYSTEM", name: "last_name", value: lastName });
      if (contactEmail) properties.push({ type: "SYSTEM", name: "email", value: contactEmail });
      if (company) properties.push({ type: "SYSTEM", name: "company", value: company });

      let result: unknown;
      const auth = `Basic ${btoa(`${email}:${apiKey}`)}`;
      const headers = { Accept: "application/json", "Content-Type": "application/json", Authorization: auth };

      if (properties.length > 0) {
        const res = await fetch(`${baseUri}api/contacts/edit-properties`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ id: contactId, properties }),
        });
        result = await res.json();
      }
      if (leadScore !== undefined) {
        const res = await fetch(`${baseUri}api/contacts/edit/lead-score`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ id: contactId, lead_score: leadScore }),
        });
        result = await res.json();
      }
      if (tags) {
        const res = await fetch(`${baseUri}api/contacts/edit/tags`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ id: contactId, tags }),
        });
        result = await res.json();
      }
      if (starValue !== undefined) {
        const res = await fetch(`${baseUri}api/contacts/edit/add-star`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ id: contactId, star_value: starValue }),
        });
        result = await res.json();
      }

      return result ?? { success: true };
    },
  });

  rl.registerAction("contact.delete", {
    description: "Delete a contact",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
    },
    async execute(input, ctx) {
      const { contactId } = input as { contactId: string };
      const { subdomain, email, apiKey } = getConn(ctx);
      return apiRequest(subdomain, email, apiKey, "DELETE", `api/contacts/${contactId}`);
    },
  });

  // ── Company ─────────────────────────────────────────

  rl.registerAction("company.create", {
    description: "Create a new company",
    inputSchema: {
      name: { type: "string", required: true, description: "Company name" },
      email: { type: "string", required: false, description: "Company email" },
      phone: { type: "string", required: false, description: "Phone number" },
      tags: { type: "array", required: false, description: "Array of tag strings" },
    },
    async execute(input, ctx) {
      const { name, email: companyEmail, phone, tags } = input as Record<string, unknown>;
      const { subdomain, email, apiKey } = getConn(ctx);

      const properties: Array<Record<string, unknown>> = [];
      if (name) properties.push({ type: "SYSTEM", name: "name", value: name });
      if (companyEmail) properties.push({ type: "SYSTEM", name: "email", value: companyEmail });
      if (phone) properties.push({ type: "SYSTEM", name: "phone", value: phone });

      const body: Record<string, unknown> = { type: "COMPANY", properties };
      if (tags) body.tags = tags;

      return apiRequest(subdomain, email, apiKey, "POST", "api/contacts", body);
    },
  });

  rl.registerAction("company.get", {
    description: "Get a company by ID",
    inputSchema: {
      companyId: { type: "string", required: true, description: "Company ID" },
    },
    async execute(input, ctx) {
      const { companyId } = input as { companyId: string };
      const { subdomain, email, apiKey } = getConn(ctx);
      return apiRequest(subdomain, email, apiKey, "GET", `api/contacts/${companyId}`);
    },
  });

  rl.registerAction("company.list", {
    description: "List/filter companies",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      const { subdomain, email, apiKey } = getConn(ctx);
      const body = {
        page_size: limit ?? 100,
        filterJson: JSON.stringify({ contact_type: "COMPANY" }),
      };
      return paginateAll(
        subdomain,
        email,
        apiKey,
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
    description: "Update a company's properties",
    inputSchema: {
      companyId: { type: "string", required: true, description: "Company ID" },
      name: { type: "string", required: false, description: "Company name" },
      email: { type: "string", required: false, description: "Company email" },
      phone: { type: "string", required: false, description: "Phone number" },
      tags: { type: "array", required: false, description: "Array of tag strings" },
      starValue: { type: "number", required: false, description: "Star rating (0-5)" },
    },
    async execute(input, ctx) {
      const { companyId, name, email: companyEmail, phone, tags, starValue } =
        input as Record<string, unknown>;
      const { subdomain, email, apiKey } = getConn(ctx);
      const baseUri = `https://${subdomain}.agilecrm.com/dev/`;

      const properties: Array<Record<string, unknown>> = [];
      if (name) properties.push({ type: "SYSTEM", name: "name", value: name });
      if (companyEmail) properties.push({ type: "SYSTEM", name: "email", value: companyEmail });
      if (phone) properties.push({ type: "SYSTEM", name: "phone", value: phone });

      let result: unknown;
      const auth = `Basic ${btoa(`${email}:${apiKey}`)}`;
      const headers = { Accept: "application/json", "Content-Type": "application/json", Authorization: auth };

      if (properties.length > 0) {
        const res = await fetch(`${baseUri}api/contacts/edit-properties`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ id: companyId, properties }),
        });
        result = await res.json();
      }
      if (tags) {
        const res = await fetch(`${baseUri}api/contacts/edit/tags`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ id: companyId, tags }),
        });
        result = await res.json();
      }
      if (starValue !== undefined) {
        const res = await fetch(`${baseUri}api/contacts/edit/add-star`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ id: companyId, star_value: starValue }),
        });
        result = await res.json();
      }

      return result ?? { success: true };
    },
  });

  rl.registerAction("company.delete", {
    description: "Delete a company",
    inputSchema: {
      companyId: { type: "string", required: true, description: "Company ID" },
    },
    async execute(input, ctx) {
      const { companyId } = input as { companyId: string };
      const { subdomain, email, apiKey } = getConn(ctx);
      return apiRequest(subdomain, email, apiKey, "DELETE", `api/contacts/${companyId}`);
    },
  });

  // ── Deal ────────────────────────────────────────────

  rl.registerAction("deal.create", {
    description: "Create a new deal",
    inputSchema: {
      name: { type: "string", required: true, description: "Deal name" },
      expectedValue: { type: "number", required: true, description: "Expected value" },
      probability: { type: "number", required: true, description: "Probability (0-100)" },
      milestone: { type: "string", required: true, description: "Milestone/stage name" },
      closeDate: { type: "string", required: true, description: "Close date (ISO string)" },
      contactIds: { type: "array", required: false, description: "Array of contact IDs" },
    },
    async execute(input, ctx) {
      const { name, expectedValue, probability, milestone, closeDate, contactIds } = input as Record<
        string,
        unknown
      >;
      const { subdomain, email, apiKey } = getConn(ctx);
      const body: Record<string, unknown> = {
        name,
        expected_value: expectedValue,
        probability,
        milestone,
        close_date: new Date(closeDate as string).getTime(),
      };
      if (contactIds) body.contactIds = contactIds;
      return apiRequest(subdomain, email, apiKey, "POST", "api/opportunity", body);
    },
  });

  rl.registerAction("deal.get", {
    description: "Get a deal by ID",
    inputSchema: {
      dealId: { type: "string", required: true, description: "Deal ID" },
    },
    async execute(input, ctx) {
      const { dealId } = input as { dealId: string };
      const { subdomain, email, apiKey } = getConn(ctx);
      return apiRequest(subdomain, email, apiKey, "GET", `api/opportunity/${dealId}`);
    },
  });

  rl.registerAction("deal.list", {
    description: "List all deals",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      const { subdomain, email, apiKey } = getConn(ctx);
      return paginateAll(
        subdomain,
        email,
        apiKey,
        "GET",
        "api/opportunity",
        undefined,
        { page_size: limit ?? 100 },
        limit,
      );
    },
  });

  rl.registerAction("deal.update", {
    description: "Update a deal",
    inputSchema: {
      dealId: { type: "string", required: true, description: "Deal ID" },
      name: { type: "string", required: false, description: "Deal name" },
      expectedValue: { type: "number", required: false, description: "Expected value" },
      probability: { type: "number", required: false, description: "Probability (0-100)" },
      contactIds: { type: "array", required: false, description: "Array of contact IDs" },
    },
    async execute(input, ctx) {
      const { dealId, name, expectedValue, probability, contactIds } = input as Record<
        string,
        unknown
      >;
      const { subdomain, email, apiKey } = getConn(ctx);
      const body: Record<string, unknown> = { id: dealId };
      if (name) body.name = name;
      if (expectedValue !== undefined) body.expected_value = expectedValue;
      if (probability !== undefined) body.probability = probability;
      if (contactIds) body.contactIds = contactIds;
      return apiRequest(subdomain, email, apiKey, "PUT", "api/opportunity/partial-update", body);
    },
  });

  rl.registerAction("deal.delete", {
    description: "Delete a deal",
    inputSchema: {
      dealId: { type: "string", required: true, description: "Deal ID" },
    },
    async execute(input, ctx) {
      const { dealId } = input as { dealId: string };
      const { subdomain, email, apiKey } = getConn(ctx);
      return apiRequest(subdomain, email, apiKey, "DELETE", `api/opportunity/${dealId}`);
    },
  });
}
