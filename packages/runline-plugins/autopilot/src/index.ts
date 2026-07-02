import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api2.autopilothq.com/v1";

async function apiRequest(
  apiKey: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      autopilotapikey: apiKey,
    },
  };
  if (
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
  ) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${endpoint}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Autopilot API error ${res.status}: ${text}`);
  }
  if (res.status === 204 || res.headers.get("content-length") === "0")
    return { success: true };
  return res.json();
}

async function paginateAll(
  apiKey: string,
  endpoint: string,
  dataKey: string,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let currentEndpoint = endpoint;

  while (true) {
    const data = (await apiRequest(apiKey, "GET", currentEndpoint)) as Record<
      string,
      unknown
    >;
    const items = (data[dataKey] as unknown[]) ?? [];
    results.push(...items);

    if (limit && results.length >= limit) return results.slice(0, limit);

    const bookmark = data.bookmark as string | undefined;
    if (!bookmark) break;
    currentEndpoint = `${endpoint}/${bookmark}`;
  }

  return results;
}

function getKey(ctx: {
  connection: { config: Record<string, unknown> };
}): string {
  return ctx.connection.config.apiKey as string;
}

export default function autopilot(rl: RunlinePluginAPI) {
  rl.setName("autopilot");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Autopilot API key",
      env: "AUTOPILOT_API_KEY",
    },
  });

  // ── Contact ─────────────────────────────────────────

  rl.registerAction("contact.upsert", {
    access: "write",
    description: "Create or update a contact",
    inputSchema: {
      email: { type: "string", required: true, description: "Contact email" },
      firstName: { type: "string", required: false, description: "First name" },
      lastName: { type: "string", required: false, description: "Last name" },
      company: { type: "string", required: false, description: "Company" },
      phone: { type: "string", required: false, description: "Phone" },
      listId: {
        type: "string",
        required: false,
        description: "Add to this list",
      },
      newEmail: {
        type: "string",
        required: false,
        description: "Change email address",
      },
    },
    async execute(input, ctx) {
      const {
        email,
        firstName,
        lastName,
        company,
        phone,
        listId,
        newEmail,
        ...rest
      } = input as Record<string, unknown>;
      const contact: Record<string, unknown> = { Email: email, ...rest };
      if (firstName) contact.FirstName = firstName;
      if (lastName) contact.LastName = lastName;
      if (company) contact.Company = company;
      if (phone) contact.Phone = phone;
      if (listId) contact._autopilot_list = listId;
      if (newEmail) contact._NewEmail = newEmail;
      return apiRequest(getKey(ctx), "POST", "/contact", { contact });
    },
  });

  rl.registerAction("contact.get", {
    access: "read",
    description: "Get a contact by ID or email",
    inputSchema: {
      contactId: {
        type: "string",
        required: true,
        description: "Contact ID or email",
      },
    },
    async execute(input, ctx) {
      const { contactId } = input as { contactId: string };
      return apiRequest(getKey(ctx), "GET", `/contact/${contactId}`);
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
      const { limit } = (input ?? {}) as { limit?: number };
      return paginateAll(getKey(ctx), "/contacts", "contacts", limit);
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
      await apiRequest(getKey(ctx), "DELETE", `/contact/${contactId}`);
      return { success: true };
    },
  });

  // ── Contact Journey ─────────────────────────────────

  rl.registerAction("contactJourney.add", {
    access: "write",
    description: "Add a contact to a journey/trigger",
    inputSchema: {
      triggerId: {
        type: "string",
        required: true,
        description: "Trigger/journey ID",
      },
      contactId: { type: "string", required: true, description: "Contact ID" },
    },
    async execute(input, ctx) {
      const { triggerId, contactId } = input as {
        triggerId: string;
        contactId: string;
      };
      await apiRequest(
        getKey(ctx),
        "POST",
        `/trigger/${triggerId}/contact/${contactId}`,
      );
      return { success: true };
    },
  });

  // ── Contact List ────────────────────────────────────

  rl.registerAction("contactList.add", {
    access: "write",
    description: "Add a contact to a list",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      contactId: { type: "string", required: true, description: "Contact ID" },
    },
    async execute(input, ctx) {
      const { listId, contactId } = input as {
        listId: string;
        contactId: string;
      };
      await apiRequest(
        getKey(ctx),
        "POST",
        `/list/${listId}/contact/${contactId}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("contactList.remove", {
    access: "write",
    description: "Remove a contact from a list",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      contactId: { type: "string", required: true, description: "Contact ID" },
    },
    async execute(input, ctx) {
      const { listId, contactId } = input as {
        listId: string;
        contactId: string;
      };
      await apiRequest(
        getKey(ctx),
        "DELETE",
        `/list/${listId}/contact/${contactId}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("contactList.exists", {
    access: "read",
    description: "Check if a contact is in a list",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      contactId: { type: "string", required: true, description: "Contact ID" },
    },
    async execute(input, ctx) {
      const { listId, contactId } = input as {
        listId: string;
        contactId: string;
      };
      try {
        await apiRequest(
          getKey(ctx),
          "GET",
          `/list/${listId}/contact/${contactId}`,
        );
        return { exists: true };
      } catch {
        return { exists: false };
      }
    },
  });

  rl.registerAction("contactList.list", {
    access: "read",
    description: "List all contacts in a list",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { listId, limit } = input as { listId: string; limit?: number };
      return paginateAll(
        getKey(ctx),
        `/list/${listId}/contacts`,
        "contacts",
        limit,
      );
    },
  });

  // ── List ────────────────────────────────────────────

  rl.registerAction("list.create", {
    access: "write",
    description: "Create a new list",
    inputSchema: {
      name: { type: "string", required: true, description: "List name" },
    },
    async execute(input, ctx) {
      const { name } = input as { name: string };
      return apiRequest(getKey(ctx), "POST", "/list", { name });
    },
  });

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
      const { limit } = (input ?? {}) as { limit?: number };
      const data = (await apiRequest(getKey(ctx), "GET", "/lists")) as {
        lists: unknown[];
      };
      if (limit) return data.lists.slice(0, limit);
      return data.lists;
    },
  });
}
