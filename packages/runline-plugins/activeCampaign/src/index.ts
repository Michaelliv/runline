import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { activeCampaignCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, activeCampaignCredential, "activeCampaign", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

async function paginate(
  ctx: ActionContext,
  endpoint: string,
  dataKey: string,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const data = (await apiRequest(ctx, "GET", endpoint, undefined, {
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

export default function activeCampaign(rl: RunlinePluginAPI) {
  rl.setName("activeCampaign");
  rl.setVersion("0.1.0");
  rl.setCredential(activeCampaignCredential);

  rl.setConnectionSchema({
    apiUrl: {
      type: "string",
      required: true,
      description:
        "ActiveCampaign API URL (e.g. https://youraccountname.api-us1.com)",
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
    access: "write",
    description:
      "Create a new contact (or update if exists with updateIfExists flag)",
    inputSchema: {
      email: { type: "string", required: true, description: "Contact email" },
      firstName: { type: "string", required: false, description: "First name" },
      lastName: { type: "string", required: false, description: "Last name" },
      phone: { type: "string", required: false, description: "Phone number" },
      updateIfExists: {
        type: "boolean",
        required: false,
        description: "Update if contact exists",
      },
    },
    async execute(input, ctx) {
      const { email, firstName, lastName, phone, updateIfExists, ...rest } =
        input as Record<string, unknown>;
      const contact: Record<string, unknown> = { email, ...rest };
      if (firstName) contact.firstName = firstName;
      if (lastName) contact.lastName = lastName;
      if (phone) contact.phone = phone;
      const endpoint = updateIfExists ? "contact/sync" : "contacts";
      return apiRequest(ctx, "POST", endpoint, { contact });
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
      return apiRequest(ctx, "GET", `contacts/${seg(contactId)}`);
    },
  });

  rl.registerAction("contact.list", {
    access: "read",
    description: "List all contacts",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      return paginate(ctx, "contacts", "contacts", limit);
    },
  });

  rl.registerAction("contact.update", {
    access: "write",
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
      return apiRequest(ctx, "PUT", `contacts/${seg(contactId)}`, {
        contact: fields,
      });
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
      return apiRequest(ctx, "DELETE", `contacts/${seg(contactId)}`);
    },
  });

  // ── Account ─────────────────────────────────────────

  rl.registerAction("account.create", {
    access: "write",
    description: "Create a new account",
    inputSchema: {
      name: { type: "string", required: true, description: "Account name" },
    },
    async execute(input, ctx) {
      const { name, ...rest } = input as Record<string, unknown>;
      return apiRequest(ctx, "POST", "accounts", {
        account: { name, ...rest },
      });
    },
  });

  rl.registerAction("account.get", {
    access: "read",
    description: "Get an account by ID",
    inputSchema: {
      accountId: { type: "string", required: true, description: "Account ID" },
    },
    async execute(input, ctx) {
      const { accountId } = input as { accountId: string };
      return apiRequest(ctx, "GET", `accounts/${seg(accountId)}`);
    },
  });

  rl.registerAction("account.list", {
    access: "read",
    description: "List all accounts",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      return paginate(ctx, "accounts", "accounts", limit);
    },
  });

  rl.registerAction("account.update", {
    access: "write",
    description: "Update an account",
    inputSchema: {
      accountId: { type: "string", required: true, description: "Account ID" },
      name: { type: "string", required: false, description: "Account name" },
    },
    async execute(input, ctx) {
      const { accountId, ...fields } = input as Record<string, unknown>;
      return apiRequest(ctx, "PUT", `accounts/${seg(accountId)}`, {
        account: fields,
      });
    },
  });

  rl.registerAction("account.delete", {
    access: "write",
    description: "Delete an account",
    inputSchema: {
      accountId: { type: "string", required: true, description: "Account ID" },
    },
    async execute(input, ctx) {
      const { accountId } = input as { accountId: string };
      return apiRequest(ctx, "DELETE", `accounts/${seg(accountId)}`);
    },
  });

  // ── Account Contact ─────────────────────────────────

  rl.registerAction("accountContact.create", {
    access: "write",
    description: "Associate a contact with an account",
    inputSchema: {
      contact: { type: "string", required: true, description: "Contact ID" },
      account: { type: "string", required: true, description: "Account ID" },
      jobTitle: { type: "string", required: false, description: "Job title" },
    },
    async execute(input, ctx) {
      const { contact, account, ...rest } = input as Record<string, unknown>;
      return apiRequest(ctx, "POST", "accountContacts", {
        accountContact: { contact, account, ...rest },
      });
    },
  });

  rl.registerAction("accountContact.update", {
    access: "write",
    description: "Update an account-contact association",
    inputSchema: {
      accountContactId: {
        type: "string",
        required: true,
        description: "Account Contact ID",
      },
      jobTitle: { type: "string", required: false, description: "Job title" },
    },
    async execute(input, ctx) {
      const { accountContactId, ...fields } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "PUT",
        `accountContacts/${seg(accountContactId)}`,
        {
          accountContact: fields,
        },
      );
    },
  });

  rl.registerAction("accountContact.delete", {
    access: "write",
    description: "Remove a contact from an account",
    inputSchema: {
      accountContactId: {
        type: "string",
        required: true,
        description: "Account Contact ID",
      },
    },
    async execute(input, ctx) {
      const { accountContactId } = input as { accountContactId: string };
      return apiRequest(
        ctx,
        "DELETE",
        `accountContacts/${seg(accountContactId)}`,
      );
    },
  });

  // ── Contact Tag ─────────────────────────────────────

  rl.registerAction("contactTag.add", {
    access: "write",
    description: "Add a tag to a contact",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
      tagId: { type: "string", required: true, description: "Tag ID" },
    },
    async execute(input, ctx) {
      const { contactId, tagId } = input as {
        contactId: string;
        tagId: string;
      };
      return apiRequest(ctx, "POST", "contactTags", {
        contactTag: { contact: contactId, tag: tagId },
      });
    },
  });

  rl.registerAction("contactTag.remove", {
    access: "write",
    description: "Remove a tag from a contact",
    inputSchema: {
      contactTagId: {
        type: "string",
        required: true,
        description: "Contact Tag ID",
      },
    },
    async execute(input, ctx) {
      const { contactTagId } = input as { contactTagId: string };
      return apiRequest(ctx, "DELETE", `contactTags/${seg(contactTagId)}`);
    },
  });

  // ── Contact List ────────────────────────────────────

  rl.registerAction("contactList.add", {
    access: "write",
    description: "Add a contact to a list",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
      listId: { type: "string", required: true, description: "List ID" },
    },
    async execute(input, ctx) {
      const { contactId, listId } = input as {
        contactId: string;
        listId: string;
      };
      return apiRequest(ctx, "POST", "contactLists", {
        contactList: { list: listId, contact: contactId, status: 1 },
      });
    },
  });

  rl.registerAction("contactList.remove", {
    access: "write",
    description: "Remove a contact from a list",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
      listId: { type: "string", required: true, description: "List ID" },
    },
    async execute(input, ctx) {
      const { contactId, listId } = input as {
        contactId: string;
        listId: string;
      };
      return apiRequest(ctx, "POST", "contactLists", {
        contactList: { list: listId, contact: contactId, status: 2 },
      });
    },
  });

  // ── List ────────────────────────────────────────────

  rl.registerAction("list.list", {
    access: "read",
    description: "List all lists",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      return paginate(ctx, "lists", "lists", limit);
    },
  });

  // ── Tag ─────────────────────────────────────────────

  rl.registerAction("tag.create", {
    access: "write",
    description: "Create a new tag",
    inputSchema: {
      name: { type: "string", required: true, description: "Tag name" },
      tagType: {
        type: "string",
        required: true,
        description: "Tag type (contact, template, etc)",
      },
    },
    async execute(input, ctx) {
      const { name, tagType, ...rest } = input as Record<string, unknown>;
      return apiRequest(ctx, "POST", "tags", {
        tag: { tag: name, tagType, ...rest },
      });
    },
  });

  rl.registerAction("tag.get", {
    access: "read",
    description: "Get a tag by ID",
    inputSchema: {
      tagId: { type: "string", required: true, description: "Tag ID" },
    },
    async execute(input, ctx) {
      const { tagId } = input as { tagId: string };
      return apiRequest(ctx, "GET", `tags/${seg(tagId)}`);
    },
  });

  rl.registerAction("tag.list", {
    access: "read",
    description: "List all tags",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      return paginate(ctx, "tags", "tags", limit);
    },
  });

  rl.registerAction("tag.update", {
    access: "write",
    description: "Update a tag",
    inputSchema: {
      tagId: { type: "string", required: true, description: "Tag ID" },
      name: { type: "string", required: false, description: "Tag name" },
      tagType: { type: "string", required: false, description: "Tag type" },
    },
    async execute(input, ctx) {
      const { tagId, name, tagType, ...rest } = input as Record<
        string,
        unknown
      >;
      const tag: Record<string, unknown> = { ...rest };
      if (name) tag.tag = name;
      if (tagType) tag.tagType = tagType;
      return apiRequest(ctx, "PUT", `tags/${seg(tagId)}`, {
        tag,
      });
    },
  });

  rl.registerAction("tag.delete", {
    access: "write",
    description: "Delete a tag",
    inputSchema: {
      tagId: { type: "string", required: true, description: "Tag ID" },
    },
    async execute(input, ctx) {
      const { tagId } = input as { tagId: string };
      return apiRequest(ctx, "DELETE", `tags/${seg(tagId)}`);
    },
  });

  // ── Deal ────────────────────────────────────────────

  rl.registerAction("deal.create", {
    access: "write",
    description: "Create a new deal",
    inputSchema: {
      title: { type: "string", required: true, description: "Deal title" },
      contact: { type: "string", required: true, description: "Contact ID" },
      value: {
        type: "number",
        required: true,
        description: "Deal value in cents",
      },
      currency: {
        type: "string",
        required: true,
        description: "Currency code (e.g. USD)",
      },
      group: {
        type: "string",
        required: false,
        description: "Pipeline/group ID",
      },
      stage: { type: "string", required: false, description: "Stage ID" },
      owner: { type: "string", required: false, description: "Owner ID" },
    },
    async execute(input, ctx) {
      const { title, contact, value, currency, ...rest } = input as Record<
        string,
        unknown
      >;
      return apiRequest(ctx, "POST", "deals", {
        deal: { title, contact, value, currency, ...rest },
      });
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
      return apiRequest(ctx, "GET", `deals/${seg(dealId)}`);
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
      return paginate(ctx, "deals", "deals", limit);
    },
  });

  rl.registerAction("deal.update", {
    access: "write",
    description: "Update a deal",
    inputSchema: {
      dealId: { type: "string", required: true, description: "Deal ID" },
      title: { type: "string", required: false, description: "Deal title" },
      value: {
        type: "number",
        required: false,
        description: "Deal value in cents",
      },
    },
    async execute(input, ctx) {
      const { dealId, ...fields } = input as Record<string, unknown>;
      return apiRequest(ctx, "PUT", `deals/${seg(dealId)}`, {
        deal: fields,
      });
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
      return apiRequest(ctx, "DELETE", `deals/${seg(dealId)}`);
    },
  });

  rl.registerAction("deal.createNote", {
    access: "write",
    description: "Add a note to a deal",
    inputSchema: {
      dealId: { type: "string", required: true, description: "Deal ID" },
      note: { type: "string", required: true, description: "Note content" },
    },
    async execute(input, ctx) {
      const { dealId, note } = input as { dealId: string; note: string };
      return apiRequest(ctx, "POST", `deals/${seg(dealId)}/notes`, {
        note: { note },
      });
    },
  });

  rl.registerAction("deal.updateNote", {
    access: "write",
    description: "Update a note on a deal",
    inputSchema: {
      dealId: { type: "string", required: true, description: "Deal ID" },
      noteId: { type: "string", required: true, description: "Note ID" },
      note: { type: "string", required: true, description: "Note content" },
    },
    async execute(input, ctx) {
      const { dealId, noteId, note } = input as {
        dealId: string;
        noteId: string;
        note: string;
      };
      return apiRequest(
        ctx,
        "PUT",
        `deals/${seg(dealId)}/notes/${seg(noteId)}`,
        {
          note: { note },
        },
      );
    },
  });

  // ── Connection ──────────────────────────────────────

  rl.registerAction("connection.create", {
    access: "write",
    description: "Create a new connection (e-commerce integration)",
    inputSchema: {
      service: { type: "string", required: true, description: "Service name" },
      externalid: {
        type: "string",
        required: true,
        description: "External ID",
      },
      name: { type: "string", required: true, description: "Connection name" },
      logoUrl: { type: "string", required: true, description: "Logo URL" },
      linkUrl: { type: "string", required: true, description: "Link URL" },
    },
    async execute(input, ctx) {
      return apiRequest(ctx, "POST", "connections", {
        connection: input as Record<string, unknown>,
      });
    },
  });

  rl.registerAction("connection.get", {
    access: "read",
    description: "Get a connection by ID",
    inputSchema: {
      connectionId: {
        type: "string",
        required: true,
        description: "Connection ID",
      },
    },
    async execute(input, ctx) {
      const { connectionId } = input as { connectionId: string };
      return apiRequest(ctx, "GET", `connections/${seg(connectionId)}`);
    },
  });

  rl.registerAction("connection.list", {
    access: "read",
    description: "List all connections",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      return paginate(ctx, "connections", "connections", limit);
    },
  });

  rl.registerAction("connection.update", {
    access: "write",
    description: "Update a connection",
    inputSchema: {
      connectionId: {
        type: "string",
        required: true,
        description: "Connection ID",
      },
    },
    async execute(input, ctx) {
      const { connectionId, ...fields } = input as Record<string, unknown>;
      return apiRequest(ctx, "PUT", `connections/${seg(connectionId)}`, {
        connection: fields,
      });
    },
  });

  rl.registerAction("connection.delete", {
    access: "write",
    description: "Delete a connection",
    inputSchema: {
      connectionId: {
        type: "string",
        required: true,
        description: "Connection ID",
      },
    },
    async execute(input, ctx) {
      const { connectionId } = input as { connectionId: string };
      return apiRequest(ctx, "DELETE", `connections/${seg(connectionId)}`);
    },
  });

  // ── E-Commerce Customer ─────────────────────────────

  rl.registerAction("ecomCustomer.create", {
    access: "write",
    description: "Create an e-commerce customer",
    inputSchema: {
      connectionid: {
        type: "string",
        required: true,
        description: "Connection ID",
      },
      externalid: {
        type: "string",
        required: true,
        description: "External customer ID",
      },
      email: { type: "string", required: true, description: "Customer email" },
      acceptsMarketing: {
        type: "boolean",
        required: false,
        description: "Accepts marketing",
      },
    },
    async execute(input, ctx) {
      const { acceptsMarketing, ...rest } = input as Record<string, unknown>;
      const customer: Record<string, unknown> = { ...rest };
      if (acceptsMarketing !== undefined) {
        customer.acceptsMarketing = acceptsMarketing ? "1" : "0";
      }
      return apiRequest(ctx, "POST", "ecomCustomers", {
        ecomCustomer: customer,
      });
    },
  });

  rl.registerAction("ecomCustomer.get", {
    access: "read",
    description: "Get an e-commerce customer by ID",
    inputSchema: {
      customerId: {
        type: "string",
        required: true,
        description: "Customer ID",
      },
    },
    async execute(input, ctx) {
      const { customerId } = input as { customerId: string };
      return apiRequest(ctx, "GET", `ecomCustomers/${seg(customerId)}`);
    },
  });

  rl.registerAction("ecomCustomer.list", {
    access: "read",
    description: "List all e-commerce customers",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      return paginate(ctx, "ecomCustomers", "ecomCustomers", limit);
    },
  });

  rl.registerAction("ecomCustomer.update", {
    access: "write",
    description: "Update an e-commerce customer",
    inputSchema: {
      customerId: {
        type: "string",
        required: true,
        description: "Customer ID",
      },
      acceptsMarketing: {
        type: "boolean",
        required: false,
        description: "Accepts marketing",
      },
    },
    async execute(input, ctx) {
      const { customerId, acceptsMarketing, ...rest } = input as Record<
        string,
        unknown
      >;
      const customer: Record<string, unknown> = { ...rest };
      if (acceptsMarketing !== undefined) {
        customer.acceptsMarketing = acceptsMarketing ? "1" : "0";
      }
      return apiRequest(ctx, "PUT", `ecomCustomers/${seg(customerId)}`, {
        ecomCustomer: customer,
      });
    },
  });

  rl.registerAction("ecomCustomer.delete", {
    access: "write",
    description: "Delete an e-commerce customer",
    inputSchema: {
      customerId: {
        type: "string",
        required: true,
        description: "Customer ID",
      },
    },
    async execute(input, ctx) {
      const { customerId } = input as { customerId: string };
      return apiRequest(ctx, "DELETE", `ecomCustomers/${seg(customerId)}`);
    },
  });

  // ── E-Commerce Order ────────────────────────────────

  rl.registerAction("ecomOrder.create", {
    access: "write",
    description: "Create an e-commerce order",
    inputSchema: {
      source: { type: "string", required: true, description: "Order source" },
      email: { type: "string", required: true, description: "Customer email" },
      totalPrice: {
        type: "number",
        required: true,
        description: "Total price in cents",
      },
      currency: {
        type: "string",
        required: true,
        description: "Currency code (e.g. USD)",
      },
      externalCreatedDate: {
        type: "string",
        required: true,
        description: "ISO date string",
      },
      connectionid: {
        type: "string",
        required: true,
        description: "Connection ID",
      },
      customerid: {
        type: "string",
        required: true,
        description: "Customer ID",
      },
      orderProducts: {
        type: "array",
        required: false,
        description: "Array of order products",
      },
    },
    async execute(input, ctx) {
      const { currency, ...rest } = input as Record<string, unknown>;
      return apiRequest(ctx, "POST", "ecomOrders", {
        ecomOrder: { ...rest, currency: (currency as string).toUpperCase() },
      });
    },
  });

  rl.registerAction("ecomOrder.get", {
    access: "read",
    description: "Get an e-commerce order by ID",
    inputSchema: {
      orderId: { type: "string", required: true, description: "Order ID" },
    },
    async execute(input, ctx) {
      const { orderId } = input as { orderId: string };
      return apiRequest(ctx, "GET", `ecomOrders/${seg(orderId)}`);
    },
  });

  rl.registerAction("ecomOrder.list", {
    access: "read",
    description: "List all e-commerce orders",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      return paginate(ctx, "ecomOrders", "ecomOrders", limit);
    },
  });

  rl.registerAction("ecomOrder.update", {
    access: "write",
    description: "Update an e-commerce order",
    inputSchema: {
      orderId: { type: "string", required: true, description: "Order ID" },
    },
    async execute(input, ctx) {
      const { orderId, ...fields } = input as Record<string, unknown>;
      return apiRequest(ctx, "PUT", `ecomOrders/${seg(orderId)}`, {
        ecomOrder: fields,
      });
    },
  });

  rl.registerAction("ecomOrder.delete", {
    access: "write",
    description: "Delete an e-commerce order",
    inputSchema: {
      orderId: { type: "string", required: true, description: "Order ID" },
    },
    async execute(input, ctx) {
      const { orderId } = input as { orderId: string };
      return apiRequest(ctx, "DELETE", `ecomOrders/${seg(orderId)}`);
    },
  });

  // ── E-Commerce Order Products ───────────────────────

  rl.registerAction("ecomOrderProduct.getByProductId", {
    access: "read",
    description: "Get an order product by product ID",
    inputSchema: {
      productId: { type: "string", required: true, description: "Product ID" },
    },
    async execute(input, ctx) {
      const { productId } = input as { productId: string };
      return apiRequest(ctx, "GET", `ecomOrderProducts/${seg(productId)}`);
    },
  });

  rl.registerAction("ecomOrderProduct.getByOrderId", {
    access: "read",
    description: "Get order products for an order",
    inputSchema: {
      orderId: { type: "string", required: true, description: "Order ID" },
    },
    async execute(input, ctx) {
      const { orderId } = input as { orderId: string };
      return apiRequest(ctx, "GET", `ecomOrders/${seg(orderId)}/orderProducts`);
    },
  });

  rl.registerAction("ecomOrderProduct.list", {
    access: "read",
    description: "List all e-commerce order products",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      return paginate(ctx, "ecomOrderProducts", "ecomOrderProducts", limit);
    },
  });
}
