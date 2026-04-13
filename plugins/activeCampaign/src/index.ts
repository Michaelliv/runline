import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  baseUrl: string,
  apiKey: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${baseUrl}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "Api-Token": apiKey,
    },
  };
  if (body && Object.keys(body).length > 0) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ActiveCampaign API error ${res.status}: ${text}`);
  }
  if (res.status === 204) return { ok: true };
  return res.json();
}

async function paginate(
  baseUrl: string,
  apiKey: string,
  endpoint: string,
  dataKey: string,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const data = (await apiRequest(baseUrl, apiKey, "GET", endpoint, undefined, {
      limit: pageSize,
      offset,
    })) as Record<string, unknown>;

    const items = (data[dataKey] as unknown[]) ?? [];
    results.push(...items);

    if (limit && results.length >= limit) return results.slice(0, limit);

    const meta = data.meta as { total?: number } | undefined;
    if (!meta?.total || results.length >= meta.total) break;
    offset = results.length;
  }

  return results;
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    baseUrl: (ctx.connection.config.apiUrl as string).replace(/\/$/, ""),
    apiKey: ctx.connection.config.apiKey as string,
  };
}

export default function activeCampaign(rl: RunlinePluginAPI) {
  rl.setName("activeCampaign");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiUrl: {
      type: "string",
      required: true,
      description: "ActiveCampaign API URL (e.g. https://youraccountname.api-us1.com)",
      env: "ACTIVE_CAMPAIGN_API_URL",
    },
    apiKey: {
      type: "string",
      required: true,
      description: "ActiveCampaign API key",
      env: "ACTIVE_CAMPAIGN_API_KEY",
    },
  });

  // ── Contact ─────────────────────────────────────────

  rl.registerAction("contact.create", {
    description: "Create a new contact (or update if exists with updateIfExists flag)",
    inputSchema: {
      email: { type: "string", required: true, description: "Contact email" },
      firstName: { type: "string", required: false, description: "First name" },
      lastName: { type: "string", required: false, description: "Last name" },
      phone: { type: "string", required: false, description: "Phone number" },
      updateIfExists: { type: "boolean", required: false, description: "Update if contact exists" },
    },
    async execute(input, ctx) {
      const { email, firstName, lastName, phone, updateIfExists, ...rest } = input as Record<
        string,
        unknown
      >;
      const { baseUrl, apiKey } = getConn(ctx);
      const contact: Record<string, unknown> = { email, ...rest };
      if (firstName) contact.firstName = firstName;
      if (lastName) contact.lastName = lastName;
      if (phone) contact.phone = phone;
      const endpoint = updateIfExists ? "/api/3/contact/sync" : "/api/3/contacts";
      return apiRequest(baseUrl, apiKey, "POST", endpoint, { contact });
    },
  });

  rl.registerAction("contact.get", {
    description: "Get a contact by ID",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
    },
    async execute(input, ctx) {
      const { contactId } = input as { contactId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "GET", `/api/3/contacts/${contactId}`);
    },
  });

  rl.registerAction("contact.list", {
    description: "List all contacts",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      const { baseUrl, apiKey } = getConn(ctx);
      return paginate(baseUrl, apiKey, "/api/3/contacts", "contacts", limit);
    },
  });

  rl.registerAction("contact.update", {
    description: "Update a contact",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
      email: { type: "string", required: false, description: "Email" },
      firstName: { type: "string", required: false, description: "First name" },
      lastName: { type: "string", required: false, description: "Last name" },
      phone: { type: "string", required: false, description: "Phone number" },
    },
    async execute(input, ctx) {
      const { contactId, ...fields } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "PUT", `/api/3/contacts/${contactId}`, {
        contact: fields,
      });
    },
  });

  rl.registerAction("contact.delete", {
    description: "Delete a contact",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
    },
    async execute(input, ctx) {
      const { contactId } = input as { contactId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "DELETE", `/api/3/contacts/${contactId}`);
    },
  });

  // ── Account ─────────────────────────────────────────

  rl.registerAction("account.create", {
    description: "Create a new account",
    inputSchema: {
      name: { type: "string", required: true, description: "Account name" },
    },
    async execute(input, ctx) {
      const { name, ...rest } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "POST", "/api/3/accounts", {
        account: { name, ...rest },
      });
    },
  });

  rl.registerAction("account.get", {
    description: "Get an account by ID",
    inputSchema: {
      accountId: { type: "string", required: true, description: "Account ID" },
    },
    async execute(input, ctx) {
      const { accountId } = input as { accountId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "GET", `/api/3/accounts/${accountId}`);
    },
  });

  rl.registerAction("account.list", {
    description: "List all accounts",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      const { baseUrl, apiKey } = getConn(ctx);
      return paginate(baseUrl, apiKey, "/api/3/accounts", "accounts", limit);
    },
  });

  rl.registerAction("account.update", {
    description: "Update an account",
    inputSchema: {
      accountId: { type: "string", required: true, description: "Account ID" },
      name: { type: "string", required: false, description: "Account name" },
    },
    async execute(input, ctx) {
      const { accountId, ...fields } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "PUT", `/api/3/accounts/${accountId}`, {
        account: fields,
      });
    },
  });

  rl.registerAction("account.delete", {
    description: "Delete an account",
    inputSchema: {
      accountId: { type: "string", required: true, description: "Account ID" },
    },
    async execute(input, ctx) {
      const { accountId } = input as { accountId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "DELETE", `/api/3/accounts/${accountId}`);
    },
  });

  // ── Account Contact ─────────────────────────────────

  rl.registerAction("accountContact.create", {
    description: "Associate a contact with an account",
    inputSchema: {
      contact: { type: "string", required: true, description: "Contact ID" },
      account: { type: "string", required: true, description: "Account ID" },
      jobTitle: { type: "string", required: false, description: "Job title" },
    },
    async execute(input, ctx) {
      const { contact, account, ...rest } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "POST", "/api/3/accountContacts", {
        accountContact: { contact, account, ...rest },
      });
    },
  });

  rl.registerAction("accountContact.update", {
    description: "Update an account-contact association",
    inputSchema: {
      accountContactId: { type: "string", required: true, description: "Account Contact ID" },
      jobTitle: { type: "string", required: false, description: "Job title" },
    },
    async execute(input, ctx) {
      const { accountContactId, ...fields } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "PUT", `/api/3/accountContacts/${accountContactId}`, {
        accountContact: fields,
      });
    },
  });

  rl.registerAction("accountContact.delete", {
    description: "Remove a contact from an account",
    inputSchema: {
      accountContactId: { type: "string", required: true, description: "Account Contact ID" },
    },
    async execute(input, ctx) {
      const { accountContactId } = input as { accountContactId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "DELETE", `/api/3/accountContacts/${accountContactId}`);
    },
  });

  // ── Contact Tag ─────────────────────────────────────

  rl.registerAction("contactTag.add", {
    description: "Add a tag to a contact",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
      tagId: { type: "string", required: true, description: "Tag ID" },
    },
    async execute(input, ctx) {
      const { contactId, tagId } = input as { contactId: string; tagId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "POST", "/api/3/contactTags", {
        contactTag: { contact: contactId, tag: tagId },
      });
    },
  });

  rl.registerAction("contactTag.remove", {
    description: "Remove a tag from a contact",
    inputSchema: {
      contactTagId: { type: "string", required: true, description: "Contact Tag ID" },
    },
    async execute(input, ctx) {
      const { contactTagId } = input as { contactTagId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "DELETE", `/api/3/contactTags/${contactTagId}`);
    },
  });

  // ── Contact List ────────────────────────────────────

  rl.registerAction("contactList.add", {
    description: "Add a contact to a list",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
      listId: { type: "string", required: true, description: "List ID" },
    },
    async execute(input, ctx) {
      const { contactId, listId } = input as { contactId: string; listId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "POST", "/api/3/contactLists", {
        contactList: { list: listId, contact: contactId, status: 1 },
      });
    },
  });

  rl.registerAction("contactList.remove", {
    description: "Remove a contact from a list",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
      listId: { type: "string", required: true, description: "List ID" },
    },
    async execute(input, ctx) {
      const { contactId, listId } = input as { contactId: string; listId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "POST", "/api/3/contactLists", {
        contactList: { list: listId, contact: contactId, status: 2 },
      });
    },
  });

  // ── List ────────────────────────────────────────────

  rl.registerAction("list.list", {
    description: "List all lists",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      const { baseUrl, apiKey } = getConn(ctx);
      return paginate(baseUrl, apiKey, "/api/3/lists", "lists", limit);
    },
  });

  // ── Tag ─────────────────────────────────────────────

  rl.registerAction("tag.create", {
    description: "Create a new tag",
    inputSchema: {
      name: { type: "string", required: true, description: "Tag name" },
      tagType: { type: "string", required: true, description: "Tag type (contact, template, etc)" },
    },
    async execute(input, ctx) {
      const { name, tagType, ...rest } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "POST", "/api/3/tags", {
        tag: { tag: name, tagType, ...rest },
      });
    },
  });

  rl.registerAction("tag.get", {
    description: "Get a tag by ID",
    inputSchema: {
      tagId: { type: "string", required: true, description: "Tag ID" },
    },
    async execute(input, ctx) {
      const { tagId } = input as { tagId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "GET", `/api/3/tags/${tagId}`);
    },
  });

  rl.registerAction("tag.list", {
    description: "List all tags",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      const { baseUrl, apiKey } = getConn(ctx);
      return paginate(baseUrl, apiKey, "/api/3/tags", "tags", limit);
    },
  });

  rl.registerAction("tag.update", {
    description: "Update a tag",
    inputSchema: {
      tagId: { type: "string", required: true, description: "Tag ID" },
      name: { type: "string", required: false, description: "Tag name" },
      tagType: { type: "string", required: false, description: "Tag type" },
    },
    async execute(input, ctx) {
      const { tagId, name, tagType, ...rest } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = getConn(ctx);
      const tag: Record<string, unknown> = { ...rest };
      if (name) tag.tag = name;
      if (tagType) tag.tagType = tagType;
      return apiRequest(baseUrl, apiKey, "PUT", `/api/3/tags/${tagId}`, { tag });
    },
  });

  rl.registerAction("tag.delete", {
    description: "Delete a tag",
    inputSchema: {
      tagId: { type: "string", required: true, description: "Tag ID" },
    },
    async execute(input, ctx) {
      const { tagId } = input as { tagId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "DELETE", `/api/3/tags/${tagId}`);
    },
  });

  // ── Deal ────────────────────────────────────────────

  rl.registerAction("deal.create", {
    description: "Create a new deal",
    inputSchema: {
      title: { type: "string", required: true, description: "Deal title" },
      contact: { type: "string", required: true, description: "Contact ID" },
      value: { type: "number", required: true, description: "Deal value in cents" },
      currency: { type: "string", required: true, description: "Currency code (e.g. USD)" },
      group: { type: "string", required: false, description: "Pipeline/group ID" },
      stage: { type: "string", required: false, description: "Stage ID" },
      owner: { type: "string", required: false, description: "Owner ID" },
    },
    async execute(input, ctx) {
      const { title, contact, value, currency, ...rest } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "POST", "/api/3/deals", {
        deal: { title, contact, value, currency, ...rest },
      });
    },
  });

  rl.registerAction("deal.get", {
    description: "Get a deal by ID",
    inputSchema: {
      dealId: { type: "string", required: true, description: "Deal ID" },
    },
    async execute(input, ctx) {
      const { dealId } = input as { dealId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "GET", `/api/3/deals/${dealId}`);
    },
  });

  rl.registerAction("deal.list", {
    description: "List all deals",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      const { baseUrl, apiKey } = getConn(ctx);
      return paginate(baseUrl, apiKey, "/api/3/deals", "deals", limit);
    },
  });

  rl.registerAction("deal.update", {
    description: "Update a deal",
    inputSchema: {
      dealId: { type: "string", required: true, description: "Deal ID" },
      title: { type: "string", required: false, description: "Deal title" },
      value: { type: "number", required: false, description: "Deal value in cents" },
    },
    async execute(input, ctx) {
      const { dealId, ...fields } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "PUT", `/api/3/deals/${dealId}`, { deal: fields });
    },
  });

  rl.registerAction("deal.delete", {
    description: "Delete a deal",
    inputSchema: {
      dealId: { type: "string", required: true, description: "Deal ID" },
    },
    async execute(input, ctx) {
      const { dealId } = input as { dealId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "DELETE", `/api/3/deals/${dealId}`);
    },
  });

  rl.registerAction("deal.createNote", {
    description: "Add a note to a deal",
    inputSchema: {
      dealId: { type: "string", required: true, description: "Deal ID" },
      note: { type: "string", required: true, description: "Note content" },
    },
    async execute(input, ctx) {
      const { dealId, note } = input as { dealId: string; note: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "POST", `/api/3/deals/${dealId}/notes`, {
        note: { note },
      });
    },
  });

  rl.registerAction("deal.updateNote", {
    description: "Update a note on a deal",
    inputSchema: {
      dealId: { type: "string", required: true, description: "Deal ID" },
      noteId: { type: "string", required: true, description: "Note ID" },
      note: { type: "string", required: true, description: "Note content" },
    },
    async execute(input, ctx) {
      const { dealId, noteId, note } = input as { dealId: string; noteId: string; note: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "PUT", `/api/3/deals/${dealId}/notes/${noteId}`, {
        note: { note },
      });
    },
  });

  // ── Connection ──────────────────────────────────────

  rl.registerAction("connection.create", {
    description: "Create a new connection (e-commerce integration)",
    inputSchema: {
      service: { type: "string", required: true, description: "Service name" },
      externalid: { type: "string", required: true, description: "External ID" },
      name: { type: "string", required: true, description: "Connection name" },
      logoUrl: { type: "string", required: true, description: "Logo URL" },
      linkUrl: { type: "string", required: true, description: "Link URL" },
    },
    async execute(input, ctx) {
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "POST", "/api/3/connections", {
        connection: input as Record<string, unknown>,
      });
    },
  });

  rl.registerAction("connection.get", {
    description: "Get a connection by ID",
    inputSchema: {
      connectionId: { type: "string", required: true, description: "Connection ID" },
    },
    async execute(input, ctx) {
      const { connectionId } = input as { connectionId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "GET", `/api/3/connections/${connectionId}`);
    },
  });

  rl.registerAction("connection.list", {
    description: "List all connections",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      const { baseUrl, apiKey } = getConn(ctx);
      return paginate(baseUrl, apiKey, "/api/3/connections", "connections", limit);
    },
  });

  rl.registerAction("connection.update", {
    description: "Update a connection",
    inputSchema: {
      connectionId: { type: "string", required: true, description: "Connection ID" },
    },
    async execute(input, ctx) {
      const { connectionId, ...fields } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "PUT", `/api/3/connections/${connectionId}`, {
        connection: fields,
      });
    },
  });

  rl.registerAction("connection.delete", {
    description: "Delete a connection",
    inputSchema: {
      connectionId: { type: "string", required: true, description: "Connection ID" },
    },
    async execute(input, ctx) {
      const { connectionId } = input as { connectionId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "DELETE", `/api/3/connections/${connectionId}`);
    },
  });

  // ── E-Commerce Customer ─────────────────────────────

  rl.registerAction("ecomCustomer.create", {
    description: "Create an e-commerce customer",
    inputSchema: {
      connectionid: { type: "string", required: true, description: "Connection ID" },
      externalid: { type: "string", required: true, description: "External customer ID" },
      email: { type: "string", required: true, description: "Customer email" },
      acceptsMarketing: { type: "boolean", required: false, description: "Accepts marketing" },
    },
    async execute(input, ctx) {
      const { acceptsMarketing, ...rest } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = getConn(ctx);
      const customer: Record<string, unknown> = { ...rest };
      if (acceptsMarketing !== undefined) {
        customer.acceptsMarketing = acceptsMarketing ? "1" : "0";
      }
      return apiRequest(baseUrl, apiKey, "POST", "/api/3/ecomCustomers", {
        ecomCustomer: customer,
      });
    },
  });

  rl.registerAction("ecomCustomer.get", {
    description: "Get an e-commerce customer by ID",
    inputSchema: {
      customerId: { type: "string", required: true, description: "Customer ID" },
    },
    async execute(input, ctx) {
      const { customerId } = input as { customerId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "GET", `/api/3/ecomCustomers/${customerId}`);
    },
  });

  rl.registerAction("ecomCustomer.list", {
    description: "List all e-commerce customers",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      const { baseUrl, apiKey } = getConn(ctx);
      return paginate(baseUrl, apiKey, "/api/3/ecomCustomers", "ecomCustomers", limit);
    },
  });

  rl.registerAction("ecomCustomer.update", {
    description: "Update an e-commerce customer",
    inputSchema: {
      customerId: { type: "string", required: true, description: "Customer ID" },
      acceptsMarketing: { type: "boolean", required: false, description: "Accepts marketing" },
    },
    async execute(input, ctx) {
      const { customerId, acceptsMarketing, ...rest } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = getConn(ctx);
      const customer: Record<string, unknown> = { ...rest };
      if (acceptsMarketing !== undefined) {
        customer.acceptsMarketing = acceptsMarketing ? "1" : "0";
      }
      return apiRequest(baseUrl, apiKey, "PUT", `/api/3/ecomCustomers/${customerId}`, {
        ecomCustomer: customer,
      });
    },
  });

  rl.registerAction("ecomCustomer.delete", {
    description: "Delete an e-commerce customer",
    inputSchema: {
      customerId: { type: "string", required: true, description: "Customer ID" },
    },
    async execute(input, ctx) {
      const { customerId } = input as { customerId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "DELETE", `/api/3/ecomCustomers/${customerId}`);
    },
  });

  // ── E-Commerce Order ────────────────────────────────

  rl.registerAction("ecomOrder.create", {
    description: "Create an e-commerce order",
    inputSchema: {
      source: { type: "string", required: true, description: "Order source" },
      email: { type: "string", required: true, description: "Customer email" },
      totalPrice: { type: "number", required: true, description: "Total price in cents" },
      currency: { type: "string", required: true, description: "Currency code (e.g. USD)" },
      externalCreatedDate: { type: "string", required: true, description: "ISO date string" },
      connectionid: { type: "string", required: true, description: "Connection ID" },
      customerid: { type: "string", required: true, description: "Customer ID" },
      orderProducts: { type: "array", required: false, description: "Array of order products" },
    },
    async execute(input, ctx) {
      const { currency, ...rest } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "POST", "/api/3/ecomOrders", {
        ecomOrder: { ...rest, currency: (currency as string).toUpperCase() },
      });
    },
  });

  rl.registerAction("ecomOrder.get", {
    description: "Get an e-commerce order by ID",
    inputSchema: {
      orderId: { type: "string", required: true, description: "Order ID" },
    },
    async execute(input, ctx) {
      const { orderId } = input as { orderId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "GET", `/api/3/ecomOrders/${orderId}`);
    },
  });

  rl.registerAction("ecomOrder.list", {
    description: "List all e-commerce orders",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      const { baseUrl, apiKey } = getConn(ctx);
      return paginate(baseUrl, apiKey, "/api/3/ecomOrders", "ecomOrders", limit);
    },
  });

  rl.registerAction("ecomOrder.update", {
    description: "Update an e-commerce order",
    inputSchema: {
      orderId: { type: "string", required: true, description: "Order ID" },
    },
    async execute(input, ctx) {
      const { orderId, ...fields } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "PUT", `/api/3/ecomOrders/${orderId}`, {
        ecomOrder: fields,
      });
    },
  });

  rl.registerAction("ecomOrder.delete", {
    description: "Delete an e-commerce order",
    inputSchema: {
      orderId: { type: "string", required: true, description: "Order ID" },
    },
    async execute(input, ctx) {
      const { orderId } = input as { orderId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "DELETE", `/api/3/ecomOrders/${orderId}`);
    },
  });

  // ── E-Commerce Order Products ───────────────────────

  rl.registerAction("ecomOrderProduct.getByProductId", {
    description: "Get an order product by product ID",
    inputSchema: {
      productId: { type: "string", required: true, description: "Product ID" },
    },
    async execute(input, ctx) {
      const { productId } = input as { productId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "GET", `/api/3/ecomOrderProducts/${productId}`);
    },
  });

  rl.registerAction("ecomOrderProduct.getByOrderId", {
    description: "Get order products for an order",
    inputSchema: {
      orderId: { type: "string", required: true, description: "Order ID" },
    },
    async execute(input, ctx) {
      const { orderId } = input as { orderId: string };
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "GET", `/api/3/ecomOrders/${orderId}/orderProducts`);
    },
  });

  rl.registerAction("ecomOrderProduct.list", {
    description: "List all e-commerce order products",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      const { baseUrl, apiKey } = getConn(ctx);
      return paginate(baseUrl, apiKey, "/api/3/ecomOrderProducts", "ecomOrderProducts", limit);
    },
  });
}
